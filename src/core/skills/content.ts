/**
 * Canonical agent skills for driving Katastasi — one per action. `init-skills` installs these into any
 * repo so Claude Code (`.claude/skills/<name>/SKILL.md`) and GitHub Copilot
 * (`.github/copilot-instructions.md`) can run the whole flow as one-liners. Embedded as strings so the
 * installer has no asset-path dependency.
 */
export interface Skill {
  name: string;
  description: string;
  body: string;
}

export const SKILLS: Skill[] = [
  {
    name: 'katastasi-onboard',
    description: 'Pull requirements from Jira / Confluence / markdown into the local .acp store.',
    body: `Use when a developer is starting on a feature and the requirements live in Jira/Confluence (or markdown).

Steps:
1. Make sure \`acp-trace.json\` lists the requirement sources (a Jira epic, a Confluence page id, or a markdown file). Creds come from \`.env\` (\`JIRA_*\` / \`CONFLUENCE_*\`); if missing run \`katastasi wizard check --source both\`.
2. Pull them locally:  \`katastasi trace pull-requirements\`  → writes \`.acp/requirements/\`.
   (Or pull a specific tree:  \`katastasi pull-jira PROJ-12 ./out\`  /  \`katastasi pull-confluence 123456 ./out\`.)
3. Confirm what came down:  \`katastasi trace --no-save\`  (lists requirements + status).

MCP equivalent: \`pull_requirements\`.`,
  },
  {
    name: 'katastasi-design',
    description: 'Turn a feature + requirements + code into a dev-ready pack (system design, DB changes, ordered tasks, tests, curls).',
    body: `Use to produce the full plan an implementer follows. Needs an AI key (\`OPENAI_API_KEY\` or \`GITHUB_TOKEN\`).

Run the wizard:
  \`katastasi wizard --feature "<name>" --source <jira|confluence|none> --requirements <pull|new|clean>\`
  Add \`--db-changes\` if the feature touches the database (the AI then enumerates every migration).

It generates, under \`.acp/features/<name>/feature-pack.html\` (+ markdown, + optional Confluence):
- a system + per-use-case data-flow mermaid diagram,
- a "Database / migration changes" checklist (when --db-changes),
- dependency-ordered tasks, each with inline code/Jira/Confluence context,
- unit/e2e/acceptance test stubs + ready-made curls.

The developer opens the HTML, reads the diagram, approves the tasks, runs the curls, ticks verify.
MCP equivalent: \`feature_wizard\`.`,
  },
  {
    name: 'katastasi-sync',
    description: 'Sync local .acp/tasks with Jira / GitHub issues, bidirectionally and conflict-safe.',
    body: `Use to reconcile local tasks with their Jira/GitHub issues (e.g. after merging work, to flip status).

1. Preview (never writes):  \`katastasi sync\`
2. Apply the safe changes:  \`katastasi sync --apply\`  (pushes local-only edits, pulls remote-only, flags conflicts)
   - one direction only:  \`--push-only\` / \`--pull-only\`
   - just one binding:  \`--binding <id>\`
3. If conflicts are reported, open \`.acp/sync/conflicts/<binding>/<id>.md\`, edit the local task (or the remote) to the intended value, then re-run \`katastasi sync --apply\`.

Status round-trips via the binding's \`statusMap\` (e.g. local \`done\` ⇄ GitHub \`closed\`). Creds: \`GITHUB_TOKEN\` / \`JIRA_*\` in \`.env\`. Config: the \`sync\` block in \`acp-trace.json\`.
MCP equivalents: \`sync_preview\`, \`sync_apply\`.`,
  },
  {
    name: 'katastasi-trace',
    description: 'Requirements traceability — which requirements are actually verified at this commit.',
    body: `Use to answer "is this really done?" — links tests ↔ requirements ↔ results at the current git commit.

- Build the report:  \`katastasi trace\`  (✅ verified / ❌ failing / 🧪 unverified / 📋 specified, + drift + regressions)
- Re-run the suites first:  \`katastasi trace --run\`
- CI gate:  \`katastasi trace --run --fail-on regression\`
- Live dashboard:  \`katastasi trace serve\`  → http://127.0.0.1:8787

A test verifies a requirement when its name carries the key (e.g. \`test('… @PROJ-1')\`).
MCP equivalents: \`requirements_trace\`, \`requirement_status\`.`,
  },
  {
    name: 'katastasi-test',
    description: 'Run requirement-first acceptance tests (HTTP + CLI) and feed results to trace.',
    body: `Use to verify a requirement with an executable acceptance test instead of (or alongside) a unit test.

- Run them:  \`katastasi test\`  (runs \`.acp/tests/*.acp.{json,yml,md}\` + inline \`\\\`\\\`\\\`acp-test\` blocks → JUnit)
- One requirement:  \`katastasi test --req PROJ-1\`
- Then fold into status:  \`katastasi trace\`

Author a spec inline under a requirement, terse:  \`POST /login {"u":"x"} -> 401\`  or as JSON for chained/captured cases. \`katastasi wizard\` / \`analyze\` also generate these.
MCP equivalent: \`test_run\`. Full guide: docs/ACCEPTANCE.md.`,
  },
  {
    name: 'katastasi-tasks',
    description: 'Manage the local markdown task board (.acp/tasks): add / list / status / board.',
    body: `Use to track work locally in markdown, linked to requirements.

- Add:  \`katastasi task add "Implement login" --req PROJ-1\`
- Move:  \`katastasi task set TASK-1 done\`
- Board:  \`katastasi task board\`  (→ .acp/BOARD.md)
- Honesty check:  \`katastasi task verify --fail-on drift\`  (a "done" task whose requirements aren't verified fails)

MCP equivalents: \`task_add\`, \`task_list\`, \`task_set_status\`, \`task_board\`.`,
  },
];

/** Master overview installed as the Copilot instruction block + a top-level skill. */
export const KATASTASI_OVERVIEW = `Katastasi is a local-first documentation / task-tracking / testing toolkit (CLI \`katastasi\`, aliases \`kat\`/\`acp\`, + an MCP server). Everything stays in this repo's \`.acp/\` markdown; Jira/Confluence/GitHub are optional projections. Drive it with these actions:

- **Onboard** — pull requirements from Jira/Confluence/markdown:  \`katastasi trace pull-requirements\`
- **Design** — feature → system design + DB changes + ordered tasks + tests + curls:  \`katastasi wizard --feature "X" [--db-changes]\`
- **Sync** — tasks ⇄ Jira/GitHub issues (status round-trips):  \`katastasi sync\` (preview) → \`--apply\`
- **Trace** — which requirements are verified now:  \`katastasi trace [--run]\`
- **Test** — requirement-first acceptance tests:  \`katastasi test\`
- **Tasks** — local board:  \`katastasi task add/set/board\`

Credentials live in \`.env\` (\`JIRA_*\` / \`CONFLUENCE_*\` / \`GITHUB_TOKEN\`) — see docs/SOURCES_SETUP.md. Prefer the MCP tools (requirements_trace, feature_wizard, sync_preview/sync_apply, test_run, task_*) when available.`;
