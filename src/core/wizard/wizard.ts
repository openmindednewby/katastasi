/**
 * Feature Lifecycle Wizard orchestrator (slice 1). Resolves the source, gathers/creates the
 * requirements, runs `analyze` (the AI step — injectable for tests), and assembles a `FeaturePack`
 * (requirements + system & per-use-case mermaid + ordered context-rich tasks + tests + ready-made curls),
 * then writes the markdown + the self-contained HTML feature pack. Generates only — the executing agent +
 * developer run and verify. Network-free testable on `source: none` with an injected chat.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { TraceConfig } from '../trace/config.js';
import { gatherRequirements } from '../trace/index.js';
import { writeRequirementsFolder } from '../trace/requirements/folder.js';
import { resolveStoreDir } from '../trace/store.js';
import { slugify } from '../pull.js';
import { isHttpMethod } from '../trace/acceptance/model.js';
import { analyze, type AnalyzeResult, type AnalyzeTask } from '../analyze/analyze.js';
import { publishConfluence } from '../confluence.js';
import type { ChatFn } from '../analyze/ai.js';
import {
  renderFeaturePack, renderFeaturePackMarkdown,
  type FeatureCurl, type FeaturePack, type FeatureTest,
} from './featurePack.js';

export type WizardSource = 'jira' | 'confluence' | 'both' | 'none';

export interface WizardOptions {
  feature: string;
  source?: WizardSource;
  requirements?: 'new' | 'pull' | 'clean';
  analyze?: boolean; // default true
  chat?: ChatFn; // inject the AI (tests)
  publishConfluence?: boolean;
  baseUrl?: string; // woven into the curls
  now?: () => string; // injectable timestamp
}

export interface WizardResult {
  dir: string;
  htmlPath: string;
  mdPath: string;
  pack: FeaturePack;
  confluenceUrl?: string;
}

/** First fenced ```mermaid block in a markdown string. */
export function extractFirstMermaid(md: string | undefined): string | undefined {
  if (!md) return undefined;
  const m = /```mermaid\s*\n([\s\S]*?)```/.exec(md);
  return m ? m[1].trim() : undefined;
}

/** Pull ready-made curls out of a task's executable acceptance cases (the HTTP steps). */
export function curlsFromAcceptance(tasks: AnalyzeTask[]): FeatureCurl[] {
  const curls: FeatureCurl[] = [];
  for (const t of tasks) {
    if (!Array.isArray(t.acceptanceTests)) continue;
    for (const c of t.acceptanceTests as Array<Record<string, unknown>>) {
      const name = typeof c.name === 'string' ? c.name : t.title;
      const steps = Array.isArray(c.steps) ? (c.steps as Array<Record<string, unknown>>) : [];
      for (const s of steps) {
        const methodKey = Object.keys(s).find((k) => isHttpMethod(k));
        if (!methodKey) continue;
        const url = String(s[methodKey]);
        const curl: FeatureCurl = { name: `${t.key} — ${name}`, method: methodKey.toUpperCase(), url };
        if (s.body !== undefined) curl.body = s.body;
        if (/\{|:id|<|>/.test(url)) curl.note = 'replace the id placeholder with a real id that has data';
        curls.push(curl);
      }
    }
  }
  return curls;
}

function taskContext(t: AnalyzeTask, outDirRel: string): string[] {
  const ctx: string[] = [];
  for (const c of t.acceptanceCriteria) ctx.push(`criterion: ${c}`);
  ctx.push(`task doc: ${outDirRel}/tasks/${t.key}.md`);
  if (Array.isArray(t.acceptanceTests) && t.acceptanceTests.length) ctx.push('executable acceptance spec: .acp/tests/' + t.key + '.acp.json');
  if (t.flowMermaid) ctx.push('implements the use-case diagram above');
  return ctx;
}

function buildTests(tasks: AnalyzeTask[], acceptanceSpecs: string[]): FeatureTest[] {
  const tests: FeatureTest[] = [];
  for (const t of tasks) for (const x of t.tests) tests.push({ tech: x.tech, title: x.title, key: t.key });
  for (const spec of acceptanceSpecs) {
    const key = /([A-Z][A-Z0-9]+-\d+)/.exec(spec)?.[1] ?? '';
    tests.push({ tech: 'acceptance', title: spec, key });
  }
  return tests;
}

interface BuildArgs {
  feature: string;
  source: string;
  requirements: Array<{ key: string; title: string; declaredStatus: string | null }>;
  analyzeResult?: AnalyzeResult;
  techMd?: string;
  gapMd?: string;
  outDirRel: string;
  confluenceUrl?: string;
  generatedAt?: string;
}

/** Assemble a FeaturePack from the gathered requirements + the analyze output. Pure. */
export function buildFeaturePack(args: BuildArgs): FeaturePack {
  const tasks = args.analyzeResult?.tasks ?? [];
  return {
    feature: args.feature,
    source: args.source,
    generatedAt: args.generatedAt,
    requirements: args.requirements.map((r) => ({ key: r.key, title: r.title, status: r.declaredStatus ?? undefined })),
    systemMermaid: args.analyzeResult?.systemDiagram ?? extractFirstMermaid(args.techMd),
    useCases: tasks.filter((t) => t.flowMermaid).map((t) => ({ key: t.key, title: t.title, mermaid: t.flowMermaid })),
    gapAnalysis: args.gapMd ? args.gapMd.replace(/^#\s+Gap Analysis\s*/i, '').trim() : undefined,
    tasks: tasks.map((t) => ({ key: t.key, title: t.title, requirements: [t.key], context: taskContext(t, args.outDirRel) })),
    tests: buildTests(tasks, args.analyzeResult?.acceptanceSpecs ?? []),
    curls: curlsFromAcceptance(tasks),
    docs: { mdDir: 'feature-pack.md', confluenceUrl: args.confluenceUrl },
  };
}

function readMaybe(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

/** Run the wizard end to end and write the feature pack. */
export async function runWizard(config: TraceConfig, baseDir: string, opts: WizardOptions): Promise<WizardResult> {
  const source = opts.source ?? 'none';
  const slug = slugify(opts.feature);

  // ── Requirements ──────────────────────────────────────────────────────────
  const requirements = await gatherRequirements(config, baseDir);
  if (opts.requirements === 'pull') {
    writeRequirementsFolder(requirements, resolveStoreDir(baseDir, 'requirements'), true);
  }

  // ── Analyze (AI) ──────────────────────────────────────────────────────────
  let analyzeResult: AnalyzeResult | undefined;
  let techMd: string | undefined;
  let gapMd: string | undefined;
  if (opts.analyze !== false) {
    analyzeResult = await analyze(config, baseDir, { chat: opts.chat, scaffold: true });
    techMd = readMaybe(join(analyzeResult.outDir, 'technical-analysis.md'));
    gapMd = readMaybe(join(analyzeResult.outDir, 'gap-analysis.md'));
  }
  const outDirRel = analyzeResult ? relative(baseDir, analyzeResult.outDir) || '.' : '.acp/tech-analysis';

  // ── Confluence (live, optional) ───────────────────────────────────────────
  let confluenceUrl: string | undefined;
  if (opts.publishConfluence && techMd) {
    const res = await publishConfluence({ pageMarkdown: techMd });
    confluenceUrl = res.page?.url;
  }

  // ── Assemble + write ──────────────────────────────────────────────────────
  const pack = buildFeaturePack({ feature: opts.feature, source, requirements, analyzeResult, techMd, gapMd, outDirRel, confluenceUrl, generatedAt: opts.now?.() });
  const dir = join(baseDir, '.acp', 'features', slug);
  mkdirSync(dir, { recursive: true });
  const htmlPath = join(dir, 'feature-pack.html');
  const mdPath = join(dir, 'feature-pack.md');
  writeFileSync(htmlPath, renderFeaturePack(pack, { baseUrl: opts.baseUrl }), 'utf8');
  writeFileSync(mdPath, renderFeaturePackMarkdown(pack), 'utf8');

  return { dir, htmlPath, mdPath, pack, confluenceUrl };
}

/** Credential doctor for the wizard's source step — what's set, what's missing, how to fix. */
export function wizardCheck(source: WizardSource): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  let ok = true;
  const need = (label: string, vars: string[]): void => {
    const missing = vars.filter((v) => !process.env[v]);
    if (missing.length) {
      ok = false;
      lines.push(`✗ ${label}: set ${missing.join(', ')} in .env  (see docs/SOURCES_SETUP.md)`);
    } else {
      lines.push(`✓ ${label}: configured`);
    }
  };
  if (source === 'jira' || source === 'both') need('Jira', ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN']);
  if (source === 'confluence' || source === 'both') need('Confluence', ['CONFLUENCE_BASE_URL', 'CONFLUENCE_EMAIL', 'CONFLUENCE_API_TOKEN']);
  if (source === 'none') lines.push('✓ none (local markdown): no credentials needed');
  return { ok, lines };
}

/** True if a requirements doc exists; the wizard scaffolds one for `new`/`clean` when missing. */
export function ensureRequirementsDoc(baseDir: string, path = 'docs/requirements.md'): boolean {
  const full = join(baseDir, path);
  if (existsSync(full)) return true;
  mkdirSync(join(baseDir, path, '..'), { recursive: true });
  writeFileSync(full, '# Requirements\n\n- [ ] FEAT-1 Describe the first requirement\n', 'utf8');
  return false;
}
