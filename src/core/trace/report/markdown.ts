/**
 * Render a TraceReport as portable markdown — the canonical sink. Because it's plain markdown it
 * round-trips through `markdownToAdf` / `markdownToStorage`, so the same text can land in a committed
 * RTM.md, a Confluence page, or a Jira description.
 */
import type { RequirementState, TraceReport, TracedRequirement } from '../types.js';

const STATE_META: Record<RequirementState, { emoji: string; label: string }> = {
  verified: { emoji: '✅', label: 'verified' },
  failing: { emoji: '❌', label: 'failing' },
  unverified: { emoji: '🧪', label: 'unverified' },
  specified: { emoji: '📋', label: 'specified' },
};

/** State emoji + label, e.g. `✅ verified`. Exported so other sinks share the vocabulary. */
export function stateBadge(state: RequirementState): string {
  const m = STATE_META[state];
  return `${m.emoji} ${m.label}`;
}

/** Escape a cell value for a markdown table. */
function cell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function link(text: string, url?: string): string {
  return url ? `[${cell(text)}](${url})` : cell(text);
}

function commitLine(report: TraceReport): string {
  const { git } = report;
  const sha = git.shortSha ? `\`${git.shortSha}\`` : '`(no git)`';
  const branch = git.branch ? ` (${git.branch})` : '';
  const dirty = git.dirty ? ' ⚠️ uncommitted changes' : '';
  return `**Commit:** ${sha}${branch}${dirty} · **Generated:** ${report.generatedAt}`;
}

function statsTable(report: TraceReport): string {
  const s = report.stats;
  return [
    '| Metric | Count |',
    '|--------|------:|',
    `| ✅ Verified | ${s.verified} |`,
    `| ❌ Failing | ${s.failing} |`,
    `| 🧪 Unverified | ${s.unverified} |`,
    `| 📋 Specified | ${s.specified} |`,
    `| ⚠️ Drift | ${s.drift} |`,
    `| 👻 Orphan tests | ${s.orphanTests} |`,
    `| **Verified coverage** | **${s.coveragePct}%** |`,
  ].join('\n');
}

function requirementRow(r: TracedRequirement): string {
  const tests = r.tests.length ? String(r.tests.length) : '—';
  const lastRun = r.result.lastRun ? r.result.lastRun.slice(0, 10) : '—';
  const declared = r.declaredStatus ? cell(r.declaredStatus) : '—';
  return `| ${link(r.key, r.url)} | ${cell(r.title)} | ${declared} | ${stateBadge(r.state)} | ${tests} | ${lastRun} |`;
}

function matrix(report: TraceReport): string {
  const header = ['| Key | Requirement | Declared | State | Tests | Last run |', '|-----|-------------|----------|-------|------:|----------|'];
  return [...header, ...report.requirements.map(requirementRow)].join('\n');
}

function driftSection(report: TraceReport): string {
  const drifted = report.requirements.filter((r) => r.drift);
  if (!drifted.length) return '';
  const items = drifted.map(
    (r) => `- **${link(r.key, r.url)}** — declared "${cell(r.declaredStatus ?? 'complete')}", but ${stateBadge(r.state)}`,
  );
  return ['', '## ⚠️ Drift — declared done but not verified', '', ...items].join('\n');
}

function orphanSection(report: TraceReport): string {
  if (!report.orphanTests.length) return '';
  const items = report.orphanTests.map(
    (o) => `- \`${o.key}\` — ${cell(o.source)}${o.status ? ` (${o.status})` : ''}`,
  );
  return ['', '## 👻 Orphan tests — reference a requirement that does not exist', '', ...items].join('\n');
}

/** Render the whole report to markdown. */
export function renderMarkdown(report: TraceReport): string {
  const title = report.project ? `Requirements Traceability — ${report.project}` : 'Requirements Traceability';
  const parts = [
    `# ${title}`,
    '',
    commitLine(report),
    '',
    statsTable(report),
    '',
    '## Requirements',
    '',
    matrix(report),
    driftSection(report),
    orphanSection(report),
    '',
  ];
  return parts.filter((p) => p !== undefined).join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
