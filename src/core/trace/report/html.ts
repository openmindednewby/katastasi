/**
 * Render a TraceReport as a single self-contained HTML dashboard — the "live status" view.
 * No external assets: inline CSS + a little vanilla JS for filter-by-state and text search.
 * Open it directly, commit it, or publish it via the pipeline.
 */
import type { RequirementState, TraceReport, TracedRequirement } from '../types.js';

const STATE_COLOR: Record<RequirementState | 'drift' | 'stale', string> = {
  verified: '#1a7f37',
  failing: '#cf222e',
  unverified: '#9a6700',
  specified: '#57606a',
  drift: '#bc4c00',
  stale: '#8250df',
};

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pill(state: RequirementState): string {
  return `<span class="pill" style="background:${STATE_COLOR[state]}1a;color:${STATE_COLOR[state]}">${state}</span>`;
}

function keyCell(r: TracedRequirement): string {
  return r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.key)}</a>` : esc(r.key);
}

function row(r: TracedRequirement, regressedFrom?: RequirementState): string {
  const tests = r.tests.length ? String(r.tests.length) : '—';
  const lastRun = r.result.lastRun ? r.result.lastRun.slice(0, 10) : '—';
  const drift = r.drift ? ' ⚠️' : '';
  const regressed = regressedFrom !== undefined;
  const wasMarker = regressed ? ` <span class="was">↩ was ${regressedFrom}</span>` : '';
  const staleMarker = r.stale ? ' <span class="stale" title="results predate the tests / commit">⏳ stale</span>' : '';
  const search = esc(`${r.key} ${r.title} ${r.declaredStatus ?? ''}`.toLowerCase());
  return (
    `<tr data-state="${r.state}" data-drift="${r.drift}" data-regressed="${regressed}" data-stale="${r.stale}" data-search="${search}">` +
    `<td class="key">${keyCell(r)}${drift}</td>` +
    `<td>${esc(r.title)}</td>` +
    `<td>${esc(r.declaredStatus ?? '—')}</td>` +
    `<td>${pill(r.state)}${wasMarker}${staleMarker}</td>` +
    `<td class="num">${tests}</td>` +
    `<td class="num">${r.result.passed}/${r.result.failed}/${r.result.skipped}</td>` +
    `<td>${lastRun}</td>` +
    '</tr>'
  );
}

function statCard(label: string, value: number | string, color: string, filter: string): string {
  return (
    `<button class="card" data-filter="${filter}" style="--c:${color}">` +
    `<span class="card-val">${value}</span><span class="card-lbl">${esc(label)}</span></button>`
  );
}

function cards(report: TraceReport): string {
  const s = report.stats;
  const list = [
    statCard('Total', s.total, '#24292f', 'all'),
    statCard('Verified', s.verified, STATE_COLOR.verified, 'verified'),
    statCard('Failing', s.failing, STATE_COLOR.failing, 'failing'),
    statCard('Unverified', s.unverified, STATE_COLOR.unverified, 'unverified'),
    statCard('Specified', s.specified, STATE_COLOR.specified, 'specified'),
    statCard('Drift', s.drift, STATE_COLOR.drift, 'drift'),
    statCard('Stale', s.stale, STATE_COLOR.stale, 'stale'),
  ];
  if (report.comparedTo) list.push(statCard('Regressions', s.regressions, STATE_COLOR.failing, 'regression'));
  list.push(statCard('Coverage', `${s.coveragePct}%`, STATE_COLOR.verified, 'all'));
  return list.join('');
}

function regressionBanner(report: TraceReport): string {
  const n = report.regressions?.length ?? 0;
  if (!n) return '';
  const ref = report.comparedTo?.ref ?? 'the last run';
  const items = (report.regressions ?? [])
    .map((c) => `<li><code>${esc(c.key)}</code> ${esc(c.title)} — ${esc(c.from)} → <b>${esc(c.to)}</b></li>`)
    .join('');
  return `<section class="banner"><h2>⛔ ${n} regression${n === 1 ? '' : 's'} since ${esc(ref)}</h2><ul>${items}</ul></section>`;
}

function commitBadge(report: TraceReport): string {
  const { git } = report;
  const sha = git.shortSha ?? 'no-git';
  const branch = git.branch ? `@${git.branch}` : '';
  const dirty = git.dirty ? ' <span class="dirty">uncommitted</span>' : '';
  return `<code>${esc(sha)}</code> <span class="muted">${esc(branch)}</span>${dirty}`;
}

function orphanBlock(report: TraceReport): string {
  if (!report.orphanTests.length) return '';
  const items = report.orphanTests
    .map((o) => `<li><code>${esc(o.key)}</code> — ${esc(o.source)}${o.status ? ` (${esc(o.status)})` : ''}</li>`)
    .join('');
  return `<section class="callout"><h2>👻 Orphan tests (${report.orphanTests.length})</h2><ul>${items}</ul></section>`;
}

const STYLE = `
:root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#24292f}
*{box-sizing:border-box}body{margin:0;background:#f6f8fa}
.wrap{max-width:1100px;margin:0 auto;padding:32px 20px}
h1{font-size:22px;margin:0 0 4px}.sub{color:#57606a;font-size:13px;margin-bottom:20px}
.muted{color:#57606a}.dirty{color:#bc4c00;font-weight:600}
.cards{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:18px}
.card{flex:1;min-width:120px;border:1px solid #d0d7de;border-left:4px solid var(--c);border-radius:8px;background:#fff;padding:12px 14px;cursor:pointer;text-align:left;transition:.1s}
.card:hover{box-shadow:0 1px 6px #0000001a}.card.active{outline:2px solid var(--c)}
.card-val{display:block;font-size:24px;font-weight:700;color:var(--c)}.card-lbl{font-size:12px;color:#57606a}
.toolbar{display:flex;gap:10px;margin-bottom:10px}
input[type=search]{flex:1;padding:8px 12px;border:1px solid #d0d7de;border-radius:8px;font-size:14px}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d0d7de;border-radius:8px;overflow:hidden;font-size:13px}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #eaeef2;vertical-align:top}
th{background:#f6f8fa;font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:#57606a}
td.num{text-align:right;font-variant-numeric:tabular-nums}.key{font-family:ui-monospace,Menlo,Consolas,monospace;white-space:nowrap}
.pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:600}
.callout{margin-top:20px;padding:14px 16px;background:#fff;border:1px solid #d0d7de;border-radius:8px}
.callout h2{font-size:15px;margin:0 0 8px}.callout ul{margin:0;padding-left:18px}.callout code{background:#f6f8fa;padding:1px 5px;border-radius:4px}
.banner{margin-bottom:16px;padding:12px 16px;background:#fff5f5;border:1px solid #ffc1c1;border-left:4px solid #cf222e;border-radius:8px}
.banner h2{font-size:15px;margin:0 0 6px;color:#cf222e}.banner ul{margin:0;padding-left:18px}.banner code{background:#fff;padding:1px 5px;border-radius:4px}
.was{display:inline-block;margin-left:6px;font-size:11px;color:#cf222e;font-weight:600}
.stale{display:inline-block;margin-left:6px;font-size:11px;color:#8250df;font-weight:600}
tr.hidden{display:none}`;

const SCRIPT = `
const rows=[...document.querySelectorAll('tbody tr')];
const cards=[...document.querySelectorAll('.card')];
const search=document.getElementById('q');
let active='all';
function apply(){const q=search.value.trim().toLowerCase();
  for(const r of rows){const st=r.dataset.state,dr=r.dataset.drift==='true',rg=r.dataset.regressed==='true',sl=r.dataset.stale==='true';
    const okFilter=active==='all'||st===active||(active==='drift'&&dr)||(active==='regression'&&rg)||(active==='stale'&&sl);
    const okText=!q||r.dataset.search.includes(q);
    r.classList.toggle('hidden',!(okFilter&&okText));}}
cards.forEach(c=>c.addEventListener('click',()=>{active=c.dataset.filter;
  cards.forEach(x=>x.classList.toggle('active',x===c&&active!=='all'));apply();}));
search.addEventListener('input',apply);`;

/** Render the whole report to a standalone HTML document. */
export function renderHtml(report: TraceReport): string {
  const title = report.project ? `RTM — ${esc(report.project)}` : 'Requirements Traceability';
  const head = `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${STYLE}</style></head>`;
  const regMap = new Map((report.regressions ?? []).map((c) => [c.key.toUpperCase(), c.from]));
  const rows = report.requirements.map((r) => row(r, regMap.get(r.key.toUpperCase()))).join('');
  const compared = report.comparedTo ? ` · vs <code>${esc(report.comparedTo.ref ?? 'prior')}</code>` : '';
  const body =
    `<div class="wrap"><h1>${title}</h1>` +
    `<div class="sub">${commitBadge(report)} · generated ${esc(report.generatedAt)}${compared}</div>` +
    regressionBanner(report) +
    `<div class="cards">${cards(report)}</div>` +
    '<div class="toolbar"><input id="q" type="search" placeholder="Search key, title, status…"></div>' +
    '<table><thead><tr><th>Key</th><th>Requirement</th><th>Declared</th><th>State</th><th>Tests</th><th>P/F/S</th><th>Last run</th></tr></thead>' +
    `<tbody>${rows}</tbody></table>` +
    orphanBlock(report) +
    `</div><script type="application/json" id="rtm-data">${JSON.stringify(report).replace(/</g, '\\u003c')}</script><script>${SCRIPT}</script>`;
  return `<!doctype html><html lang="en">${head}<body>${body}</body></html>\n`;
}
