#!/usr/bin/env node
// Deploy the "Create or Update" n8n workflows from this repo into the running
// n8n container, UPDATING the active workflow in place (never creating a duplicate).
//
//   npm run deploy:workflows                 # deploy the default targets (confluence + jira)
//   npm run deploy:workflows -- <file.json>  # deploy specific workflow file(s)
//
// n8n is DB-backed (volume n8n_data), so editing the JSON in workflows/ does nothing
// until it is re-imported. This script: resolves the ACTIVE workflow id by matching the
// file's `name`, injects that id, imports (= update in place), re-activates, restarts
// n8n so the webhook re-registers, then verifies the webhook answers.
//
// Match-by-name is deliberate: the repo has many duplicate experimental workflows with
// the same names; only the *active* one is the live MCP-backed pipeline.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTAINER = process.env.N8N_CONTAINER || 'ai-confluence-pipeline-n8n-1';
const PORT = process.env.N8N_PORT || '10353';

// Default targets = the two live, MCP-backed pipelines. Override by passing file paths.
const DEFAULT_TARGETS = [
  'workflows/markdown-to-confluence-pipeline.json',
  'workflows/markdown-to-jira-pipeline.json',
];

// The confluence webhook path used for the health check after restart.
const HEALTHCHECK_PATH = '/webhook/markdown-to-confluence';

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}
function log(msg) { process.stdout.write(`${msg}\n`); }
function die(msg) { process.stderr.write(`\n✖ ${msg}\n`); process.exit(1); }

// --- preflight: is the container up? ---
let ps;
try { ps = sh('docker', ['ps', '--filter', `name=${CONTAINER}`, '--format', '{{.Names}}']); }
catch { die(`Could not run docker. Is Docker Desktop running?`); }
if (!ps.includes(CONTAINER)) {
  die(`Container "${CONTAINER}" is not running. Start it with: docker compose up -d (from ${REPO})`);
}

// --- map of currently-active workflows: name -> id ---
function activeWorkflows() {
  const out = sh('docker', ['exec', CONTAINER, 'n8n', 'list:workflow', '--active=true']);
  const map = new Map();
  for (const line of out.split('\n')) {
    const i = line.indexOf('|');
    if (i > 0) map.set(line.slice(i + 1).trim(), line.slice(0, i).trim());
  }
  return map;
}
const active = activeWorkflows();
log(`Active workflows in n8n: ${active.size}`);

// --- resolve targets ---
const targets = (process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_TARGETS)
  .map((t) => resolve(REPO, t));

const tmp = mkdtempSync(join(tmpdir(), 'acp-deploy-'));
let deployed = 0;

for (const file of targets) {
  let wf;
  try { wf = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { die(`Cannot read workflow file ${file}: ${e.message}`); }

  const name = wf.name;
  const id = active.get(name);
  if (!id) {
    log(`\n⚠ "${name}" has no ACTIVE workflow in n8n — skipping to avoid creating a duplicate.`);
    log(`  (Activate one in the n8n UI first, or this is a brand-new workflow — import it via the UI once.)`);
    continue;
  }

  log(`\n→ Deploying "${name}"  (id ${id})`);
  // inject the id so import UPDATES in place rather than inserting a copy
  wf.id = id;
  const hostFile = join(tmp, basename(file));
  writeFileSync(hostFile, JSON.stringify(wf, null, 2));
  const ctrFile = `/tmp/${basename(file)}`;

  sh('docker', ['cp', hostFile, `${CONTAINER}:${ctrFile}`]);
  sh('docker', ['exec', CONTAINER, 'n8n', 'import:workflow', `--input=${ctrFile}`]);
  // import deactivates the workflow — turn it back on
  sh('docker', ['exec', CONTAINER, 'n8n', 'update:workflow', `--id=${id}`, '--active=true']);
  log(`  imported + reactivated.`);
  deployed++;
}

if (deployed === 0) die('Nothing deployed.');

// --- restart so webhooks re-register ---
log(`\n↻ Restarting n8n so webhooks re-register…`);
sh('docker', ['compose', 'restart', 'n8n'], { cwd: REPO });

// --- verify the webhook answers (poll; n8n takes a few seconds to come back) ---
log(`\n⏳ Verifying webhook http://localhost:${PORT}${HEALTHCHECK_PATH} …`);
const url = `http://localhost:${PORT}${HEALTHCHECK_PATH}`;
let ok = false;
for (let attempt = 1; attempt <= 20 && !ok; attempt++) {
  try {
    const res = await fetch(url, { method: 'GET' });
    const body = await res.text();
    // A live webhook answers a GET with "not registered for GET requests".
    if (/not registered for GET/i.test(body) || res.status === 200) {
      ok = true; break;
    }
  } catch { /* container still restarting */ }
  await new Promise((r) => setTimeout(r, 1500));
}

if (ok) {
  log(`\n✓ Deployed ${deployed} workflow(s) and the webhook is live.`);
} else {
  die(`Deployed ${deployed} workflow(s) but the webhook did not respond after restart.\n` +
      `  Check: docker compose logs --tail=50 n8n`);
}
