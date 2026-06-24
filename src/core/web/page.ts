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

    <p class="muted">Next: <b>Source</b> — paste a Jira epic or Confluence page URL and the wizard will discover the related issues + pages for you to confirm. <span class="pill">coming in the next slice</span></p>
  </main>
</div>
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
</script>
</body></html>
`;
}
