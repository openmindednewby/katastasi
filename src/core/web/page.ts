/**
 * The web-wizard single page — self-contained HTML + vanilla JS (no framework, no build step). Slice 1
 * renders the step rail and a working Connect step (enter creds → POST /api/env → writes the local
 * `.env`); the later steps are shown as a roadmap and light up in subsequent slices. Tokens are never
 * pre-filled (the server never sends them back).
 */
const STEPS = ['Connect', 'Source', 'Select', 'Download', 'Design', 'Review', 'Sync'];

export function renderWizardPage(): string {
  const rail = STEPS.map((s, i) => `<li class="${i === 0 ? 'active' : 'todo'}" data-step="${s.toLowerCase()}">${i + 1}. ${s}</li>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Katastasi — feature onboarding</title>
<style>
  :root{--bg:#0f1115;--card:#191c23;--ink:#e7e9ee;--muted:#9aa3b2;--accent:#5b8def;--ok:#3fb950;--bad:#e5534b;--line:#2a2f3a}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,Segoe UI,Roboto,sans-serif}
  header{padding:18px 24px;border-bottom:1px solid var(--line)} header b{font-size:18px}
  .layout{display:flex;gap:0;min-height:calc(100vh - 61px)}
  nav{width:220px;border-right:1px solid var(--line);padding:18px 0}
  nav ol{list-style:none;margin:0;padding:0}
  nav li{padding:10px 24px;color:var(--muted)} nav li.active{color:var(--ink);border-left:3px solid var(--accent);background:#161922}
  nav li.todo{opacity:.55} nav li.done{color:var(--ok)}
  main{flex:1;padding:28px 32px;max-width:760px}
  h1{font-size:22px;margin:.1em 0 .2em} .sub{color:var(--muted);margin:0 0 1.4em}
  .card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin:14px 0}
  .card h3{margin:.1em 0 .6em;display:flex;align-items:center;gap:8px}
  .dot{width:9px;height:9px;border-radius:50%;background:var(--muted);display:inline-block} .dot.ok{background:var(--ok)} .dot.bad{background:var(--bad)}
  label{display:block;font-size:13px;color:var(--muted);margin:.6em 0 .2em}
  input{width:100%;padding:.5em .6em;background:#0c0e12;border:1px solid var(--line);border-radius:6px;color:var(--ink)}
  button{background:var(--accent);color:#fff;border:0;border-radius:6px;padding:.5em 1em;cursor:pointer;margin-top:12px}
  .muted{color:var(--muted)} a{color:var(--accent)} .pill{font-size:12px;border:1px solid var(--line);border-radius:999px;padding:.05em .6em;color:var(--muted)}
</style></head>
<body>
<header><b>Katastasi</b> &nbsp;<span class="muted">feature onboarding — 100% local, no login</span></header>
<div class="layout">
  <nav><ol>${rail}</ol></nav>
  <main>
    <h1>Connect</h1>
    <p class="sub">Enter your Atlassian / GitHub credentials once. They're saved to a local <code>.env</code> on this machine and never sent anywhere else. <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank">Get an Atlassian API token</a>.</p>

    <section class="card" data-group="jira">
      <h3><span class="dot"></span> Jira <span class="pill status">checking…</span></h3>
      <label>Base URL</label><input name="JIRA_BASE_URL" placeholder="https://your-company.atlassian.net">
      <label>Email</label><input name="JIRA_EMAIL" placeholder="you@company.com">
      <label>API token</label><input name="JIRA_API_TOKEN" type="password" placeholder="paste token (write-only)">
      <button>Save Jira</button>
    </section>

    <section class="card" data-group="confluence">
      <h3><span class="dot"></span> Confluence <span class="pill status">checking…</span></h3>
      <label>Base URL</label><input name="CONFLUENCE_BASE_URL" placeholder="https://your-company.atlassian.net/wiki">
      <label>Email</label><input name="CONFLUENCE_EMAIL" placeholder="you@company.com">
      <label>API token</label><input name="CONFLUENCE_API_TOKEN" type="password" placeholder="paste token (write-only)">
      <button>Save Confluence</button>
    </section>

    <section class="card" data-group="github">
      <h3><span class="dot"></span> GitHub <span class="pill status">checking…</span></h3>
      <label>Token</label><input name="GITHUB_TOKEN" type="password" placeholder="ghp_… (repo / issues scope)">
      <button>Save GitHub</button>
    </section>

    <h1 style="margin-top:1.4em">Source</h1>
    <p class="sub">Paste a Jira epic or Confluence page URL. The wizard discovers its children + related/linked issues and pages — then you confirm which to pull.</p>
    <section class="card">
      <label>Jira / Confluence URL (or an issue key)</label>
      <input id="src-url" placeholder="https://you.atlassian.net/browse/PROJ-12">
      <button id="discover-btn">Discover</button>
      <span id="discover-msg" class="muted" style="margin-left:10px"></span>
    </section>

    <div id="select-wrap" style="display:none">
      <h1 style="margin-top:1.2em">Select <span class="pill" id="select-count"></span></h1>
      <p class="sub">Tick what to pull as markdown. <button id="sel-all" style="padding:.2em .6em;font-size:12px">all</button> <button id="sel-none" style="padding:.2em .6em;font-size:12px;background:#333">none</button></p>
      <section class="card"><ul id="discovered" style="list-style:none;padding:0;margin:0"></ul></section>
      <button id="pull-btn">Download ticked → .acp/requirements/</button>
      <span id="pull-msg" class="muted" style="margin-left:10px"></span>
      <div id="pull-result" style="display:none"></div>
    </div>

    <div id="design-wrap" style="display:none">
      <h1 style="margin-top:1.2em">Design</h1>
      <p class="sub">Run the AI analysis over the pulled requirements (+ your code) — system data-flow, DB changes, ordered tasks, tests &amp; curls. Needs an AI key (OpenAI / GitHub token in Connect).</p>
      <section class="card">
        <label>Feature name</label><input id="feat-name" placeholder="e.g. SSO login">
        <label style="margin-top:.8em"><input type="checkbox" id="feat-db" style="width:auto;margin-right:6px">This feature needs database changes</label>
        <button id="design-btn">Generate</button>
        <span id="design-msg" class="muted" style="margin-left:10px"></span>
      </section>
      <div id="design-result"></div>
    </div>

    <div id="sync-wrap" style="display:none">
      <h1 style="margin-top:1.2em">Sync</h1>
      <p class="sub">Reconcile your local tasks with Jira / GitHub issues. Preview shows what would change; Apply writes it (conflicts are flagged, never overwritten). Needs a <code>sync</code> block in <code>acp-trace.json</code> + creds from Connect.</p>
      <section class="card">
        <button id="sync-preview-btn">Preview</button>
        <button id="sync-apply-btn" style="background:#2ea043">Apply</button>
        <span id="sync-msg" class="muted" style="margin-left:10px"></span>
      </section>
      <div id="sync-result"></div>
    </div>
  </main>
</div>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<script>
  var GROUP_KEYS = { jira:['JIRA_BASE_URL','JIRA_EMAIL','JIRA_API_TOKEN'], confluence:['CONFLUENCE_BASE_URL','CONFLUENCE_EMAIL','CONFLUENCE_API_TOKEN'], github:['GITHUB_TOKEN'] };
  function paint(status){
    document.querySelectorAll('section[data-group]').forEach(function(sec){
      var g = sec.getAttribute('data-group'); var ok = !!status[g];
      sec.querySelector('.dot').className = 'dot ' + (ok ? 'ok' : 'bad');
      sec.querySelector('.status').textContent = ok ? 'configured' : 'not set';
    });
  }
  function refresh(){ fetch('/api/env').then(function(r){return r.json();}).then(paint); }
  document.querySelectorAll('section[data-group] button').forEach(function(btn){
    btn.addEventListener('click', function(){
      var sec = btn.closest('section'); var g = sec.getAttribute('data-group'); var kv = {};
      GROUP_KEYS[g].forEach(function(k){ var el = sec.querySelector('[name="'+k+'"]'); if (el && el.value.trim()) kv[k] = el.value.trim(); });
      btn.textContent = 'Saving…';
      fetch('/api/env', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(kv) })
        .then(function(r){return r.json();}).then(function(status){ paint(status); btn.textContent = 'Saved'; setTimeout(function(){ btn.textContent = 'Save ' + g.charAt(0).toUpperCase()+g.slice(1); }, 1200);
          sec.querySelectorAll('input[type=password]').forEach(function(i){ i.value=''; }); });
    });
  });
  refresh();

  // ── Source / Select ──
  function escapeHtml(s){ return String(s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function renderItems(items){
    var wrap = document.getElementById('select-wrap'); var ul = document.getElementById('discovered');
    wrap.style.display = items.length ? 'block' : 'none';
    document.getElementById('select-count').textContent = items.length + ' found';
    document.querySelector('nav li[data-step="select"]').className = items.length ? 'active' : 'todo';
    ul.innerHTML = items.map(function(it, i){
      var badge = it.type === 'jira' ? 'JIRA' : 'PAGE';
      var via = it.via === 'pasted' ? '' : ' <span class="pill">'+it.via+'</span>';
      var link = it.url ? ' <a href="'+escapeHtml(it.url)+'" target="_blank">open</a>' : '';
      return '<li style="padding:.4em 0;border-bottom:1px solid var(--line)"><label><input type="checkbox" class="disc" checked data-i="'+i+'"> <span class="pill">'+badge+'</span> '+escapeHtml(it.id)+' — '+escapeHtml(it.title)+via+link+'</label></li>';
    }).join('');
    try { localStorage.setItem('katastasi-web:discovered', JSON.stringify(items)); } catch(e){}
  }
  document.getElementById('discover-btn').addEventListener('click', function(){
    var url = document.getElementById('src-url').value.trim(); var msg = document.getElementById('discover-msg');
    if (!url) { msg.textContent = 'paste a URL first'; return; }
    msg.textContent = 'discovering…';
    fetch('/api/sources/discover', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url: url }) })
      .then(function(r){ return r.json().then(function(d){ return { ok: r.ok, d: d }; }); })
      .then(function(res){ if (!res.ok) { msg.textContent = res.d.error || 'failed'; return; } msg.textContent = ''; renderItems(res.d.items || []); })
      .catch(function(){ msg.textContent = 'request failed'; });
  });
  document.getElementById('sel-all').addEventListener('click', function(){ document.querySelectorAll('.disc').forEach(function(c){ c.checked = true; }); });
  document.getElementById('sel-none').addEventListener('click', function(){ document.querySelectorAll('.disc').forEach(function(c){ c.checked = false; }); });

  // ── Design ──
  try { if (window.mermaid) mermaid.initialize({ startOnLoad:false, theme:'dark' }); } catch(e){}
  function list(arr, fn){ return (arr||[]).map(fn).join(''); }
  function renderDesign(d){
    var p = d.pack; var h = '';
    h += '<h2 style="border-bottom:1px solid var(--line);padding-bottom:.3em">'+escapeHtml(p.feature)+'</h2>';
    h += '<p class="muted">'+ (p.requirements||[]).length +' requirement(s) · '+ (p.tasks||[]).length +' task(s) · '+ (p.curls||[]).length +' curl(s) · <a href="/' + escapeHtml(d.html) + '" target="_blank">open full feature pack</a></p>';
    if (p.systemMermaid){ h += '<h3>System data-flow</h3><section class="card"><pre class="mermaid">'+escapeHtml(p.systemMermaid)+'</pre></section>'; }
    if (p.dbChanges && p.dbChanges.length){ h += '<h3>Database / migration changes</h3><section class="card"><ul>'+ list(p.dbChanges, function(c){ return '<li><label><input type="checkbox"> '+escapeHtml(c)+'</label></li>'; }) +'</ul></section>'; }
    if (p.tasks && p.tasks.length){ h += '<h3>Tasks (ordered)</h3><section class="card"><ol>'+ list(p.tasks, function(t){ return '<li><b>'+escapeHtml(t.title)+'</b> <span class="pill">'+escapeHtml((t.requirements||[]).join(', '))+'</span></li>'; }) +'</ol></section>'; }
    if (p.curls && p.curls.length){ h += '<h3>Verify — curls</h3><section class="card"><ul class="muted">'+ list(p.curls, function(c){ return '<li>'+escapeHtml(c.method+' '+c.url)+(c.note?' — '+escapeHtml(c.note):'')+'</li>'; }) +'</ul></section>'; }
    document.getElementById('design-result').innerHTML = h;
    try { if (window.mermaid) mermaid.run({ querySelector: '#design-result .mermaid' }); } catch(e){}
  }
  document.getElementById('design-btn').addEventListener('click', function(){
    var feature = document.getElementById('feat-name').value.trim(); var msg = document.getElementById('design-msg');
    if (!feature) { msg.textContent = 'name the feature'; return; }
    msg.textContent = 'analysing… (this calls the AI)';
    fetch('/api/design', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ feature: feature, dbChanges: document.getElementById('feat-db').checked }) })
      .then(function(r){ return r.json().then(function(d){ return { ok:r.ok, d:d }; }); })
      .then(function(res){ if (!res.ok) { msg.textContent = res.d.error || 'failed'; return; } msg.textContent = ''; document.querySelector('nav li[data-step="design"]').className='done'; renderDesign(res.d); document.getElementById('sync-wrap').style.display='block'; document.querySelector('nav li[data-step="sync"]').className='active'; })
      .catch(function(){ msg.textContent = 'request failed'; });
  });

  // ── Sync ──
  function renderSync(d){
    var box = document.getElementById('sync-result');
    if (!d.configured){ box.innerHTML = '<section class="card muted">'+escapeHtml(d.message||'not configured')+'</section>'; return; }
    var h = '<p class="muted">'+(d.applied?'Applied':'Preview')+'</p>';
    h += list(d.results, function(r){
      if (r.error) return '<section class="card"><b>'+escapeHtml(r.bindingId)+'</b> ('+escapeHtml(r.remoteType)+') — <span style="color:var(--bad)">'+escapeHtml(r.error)+'</span></section>';
      var s = r.summary;
      var line = '↑'+(s.push+s['create-remote'])+' pushed · ↓'+(s.pull+s['pull-create'])+' pulled · ='+(s.skip+s.converged)+' in-sync · ⚠️'+s.conflict+' conflict';
      var links = list(r.links, function(l){ return '<li class="muted">linked '+escapeHtml(l.key)+' ↔ '+escapeHtml(l.remoteId)+(l.url?' <a href="'+escapeHtml(l.url)+'" target="_blank">open</a>':'')+'</li>'; });
      var confs = list(r.conflicts, function(c){ return '<li style="color:var(--bad)">⚠️ conflict '+escapeHtml(c.key||c.remoteId||'')+' ['+escapeHtml((c.fields||[]).join(', '))+']</li>'; });
      return '<section class="card"><b>'+escapeHtml(r.bindingId)+'</b> ('+escapeHtml(r.remoteType)+'): '+line+'<ul style="margin:.4em 0">'+links+confs+'</ul></section>';
    });
    box.innerHTML = h;
  }
  function runSyncReq(apply){
    var msg = document.getElementById('sync-msg'); msg.textContent = apply?'applying…':'previewing…';
    fetch('/api/sync', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ apply: apply }) })
      .then(function(r){ return r.json().then(function(d){ return { ok:r.ok, d:d }; }); })
      .then(function(res){ if (!res.ok){ msg.textContent = res.d.error||'failed'; return; } msg.textContent=''; if (apply && res.d.configured) document.querySelector('nav li[data-step="sync"]').className='done'; renderSync(res.d); })
      .catch(function(){ msg.textContent = 'request failed'; });
  }
  document.getElementById('sync-preview-btn').addEventListener('click', function(){ runSyncReq(false); });
  document.getElementById('sync-apply-btn').addEventListener('click', function(){ runSyncReq(true); });

  document.getElementById('pull-btn').addEventListener('click', function(){
    var all = []; try { all = JSON.parse(localStorage.getItem('katastasi-web:discovered') || '[]'); } catch(e){}
    var picked = [];
    document.querySelectorAll('.disc').forEach(function(c){ if (c.checked) { var it = all[parseInt(c.getAttribute('data-i'),10)]; if (it) picked.push({ type: it.type, id: it.id }); } });
    var msg = document.getElementById('pull-msg');
    if (!picked.length) { msg.textContent = 'tick at least one item'; return; }
    msg.textContent = 'downloading ' + picked.length + '…';
    fetch('/api/pull', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ items: picked }) })
      .then(function(r){ return r.json().then(function(d){ return { ok:r.ok, d:d }; }); })
      .then(function(res){
        if (!res.ok) { msg.textContent = res.d.error || 'failed'; return; }
        msg.textContent = '';
        document.querySelector('nav li[data-step="download"]').className = 'done';
        document.getElementById('design-wrap').style.display = 'block';
        document.querySelector('nav li[data-step="design"]').className = 'active';
        var d = res.d; var box = document.getElementById('pull-result'); box.style.display = 'block';
        box.innerHTML = '<section class="card"><b>Downloaded ' + d.written.length + ' file(s)</b> → <code>' + escapeHtml(d.outDir) + '/</code>'
          + (d.skipped && d.skipped.length ? ' <span class="pill">' + d.skipped.length + ' skipped</span>' : '')
          + '<ul class="muted" style="margin:.5em 0">' + d.written.map(function(w){ return '<li>' + escapeHtml(w) + '</li>'; }).join('') + '</ul>'
          + 'Requirements index: <code>' + escapeHtml(d.outDir) + '/' + escapeHtml(d.requirementsFile) + '</code></section>';
      })
      .catch(function(){ msg.textContent = 'request failed'; });
  });
</script>
</body></html>
`;
}
