/**
 * Render a TraceReport as a single self-contained HTML dashboard — the "live status" view.
 * No external assets: inline CSS + a little vanilla JS for filter-by-state and text search.
 * Open it directly, commit it, or publish it via the pipeline.
 */
import type { RequirementState, TraceReport, TracedRequirement } from '../types.js';

const STATE_COLOR: Record<RequirementState | 'drift', string> = {
  verified: '#1a7f37',
  failing: '#cf222e',
  unverified: '#9a6700',
  specified: '#57606a',
  drift: '#bc4c00',
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

function row(r: TracedRequirement): string {
  const tests = r.tests.length ? String(r.tests.length) : '—';
  const lastRun = r.result.lastRun ? r.result.lastRun.slice(0, 10) : '—';
  const drift = r.drift ? ' ⚠️' : '';
  const search = esc(`${r.key} ${r.title} ${r.declaredStatus ?? ''}`.toLowerCase());
  return (
    `<tr data-state="${r.state}" data-drift="${r.drift}" data-search="${search}">` +
    `<td class="key">${keyCell(r)}${drift}</td>` +
    `<td>${esc(r.title)}</td>` +
    `<td>${esc(r.declaredStatus ?? '—')}</td>` +
    `<td>${pill(r.state)}</td>` +
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
  return [
    statCard('Total', s.total, '#24292f', 'all'),
    statCard('Verified', s.verified, STATE_COLOR.verified, 'verified'),
    statCard('Failing', s.failing, STATE_COLOR.failing, 'failing'),
    statCard('Unverified', s.unverified, STATE_COLOR.unverified, 'unverified'),
    statCard('Specified', s.specified, STATE_COLOR.specified, 'specified'),
    statCard('Drift', s.drift, STATE_COLOR.drift, 'drift'),
    statCard('Coverage', `${s.coveragePct}%`, STATE_COLOR.verified, 'all'),
  ].join('');
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
tr.hidden{display:none}`;

const SCRIPT = `
const rows=[...document.querySelectorAll('tbody tr')];
const cards=[...document.querySelectorAll('.card')];
const search=document.getElementById('q');
let active='all';
function apply(){const q=search.value.trim().toLowerCase();
  for(const r of rows){const st=r.dataset.state,dr=r.dataset.drift==='true';
    const okFilter=active==='all'||st===active||(active==='drift'&&dr);
    const okText=!q||r.dataset.search.includes(q);
    r.classList.toggle('hidden',!(okFilter&&okText));}}
cards.forEach(c=>c.addEventListener('click',()=>{active=c.dataset.filter;
  cards.forEach(x=>x.classList.toggle('active',x===c&&active!=='all'));apply();}));
search.addEventListener('input',apply);`;

/** Render the whole report to a standalone HTML document. */
export function renderHtml(report: TraceReport): string {
  const title = report.project ? `RTM — ${esc(report.project)}` : 'Requirements Traceability';
  const head = `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${STYLE}</style></head>`;
  const body =
    `<div class="wrap"><h1>${title}</h1>` +
    `<div class="sub">${commitBadge(report)} · generated ${esc(report.generatedAt)}</div>` +
    `<div class="cards">${cards(report)}</div>` +
    '<div class="toolbar"><input id="q" type="search" placeholder="Search key, title, status…"></div>' +
    '<table><thead><tr><th>Key</th><th>Requirement</th><th>Declared</th><th>State</th><th>Tests</th><th>P/F/S</th><th>Last run</th></tr></thead>' +
    `<tbody>${report.requirements.map(row).join('')}</tbody></table>` +
    orphanBlock(report) +
    `</div><script type="application/json" id="rtm-data">${JSON.stringify(report).replace(/</g, '\\u003c')}</script><script>${SCRIPT}</script>`;
  return `<!doctype html><html lang="en">${head}<body>${body}</body></html>\n`;
}
