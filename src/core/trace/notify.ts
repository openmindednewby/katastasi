/**
 * Outbound notifications: POST a short message to a webhook (Slack/Teams/generic) after a run, so a
 * regression actually reaches a human instead of waiting to be noticed. The payload carries `text`
 * (what Slack/Teams render) plus the structured stats/regressions for generic consumers.
 */
import type { TraceReport } from './types.js';

export type NotifyOn = 'regression' | 'failing' | 'stale' | 'always';

/** Should we send, given the configured trigger level? */
export function shouldNotify(report: TraceReport, on: NotifyOn): boolean {
  const s = report.stats;
  switch (on) {
    case 'always':
      return true;
    case 'failing':
      return s.failing > 0;
    case 'stale':
      return s.stale > 0 || s.failing > 0;
    case 'regression':
    default:
      return s.regressions > 0;
  }
}

/** Build the message + JSON payload for a webhook. Pure. */
export function buildNotification(report: TraceReport): { text: string; payload: Record<string, unknown> } {
  const s = report.stats;
  const g = report.git;
  const commit = g.shortSha ? `${g.shortSha}${g.branch ? ` (${g.branch})` : ''}` : '(no git)';
  const head =
    s.regressions > 0 ? `⛔ ${s.regressions} regression(s)` : s.failing > 0 ? `❌ ${s.failing} failing` : `✅ ${s.coveragePct}% verified`;
  const regs = (report.regressions ?? []).map((c) => `${c.key} ${c.from}→${c.to}`).join(', ');
  const project = report.project ? `${report.project} ` : '';
  const text = `RTM ${project}@ ${commit}: ${head} · coverage ${s.coveragePct}%${regs ? ` · ${regs}` : ''}`;
  return {
    text,
    payload: { text, project: report.project ?? null, commit: g.shortSha, stats: s, regressions: report.regressions ?? [] },
  };
}

/** POST the notification to `url`. Never throws — returns whether it was accepted. */
export async function sendNotification(url: string, report: TraceReport): Promise<boolean> {
  const { payload } = buildNotification(report);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}
