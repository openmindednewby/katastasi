# Local Web Wizard — design (the "link" for devs)

*Scoped 2026-06-24. The browser front end your devs open to onboard onto a feature step-by-step — paste a
Jira/Confluence URL, pick epics/pages, download as markdown, get the system design + DB changes + ordered
tasks + tests/curls, and sync status back. **100% local, no login.** Built on the existing CLI core +
the `trace serve` local-server pattern.*

## 1. Why a local server (the hard constraint)

A browser page **cannot call Jira/Confluence directly** (Atlassian blocks cross-origin browser requests,
and a dev's token must never leave their machine). So a live "paste a link → see your epics" flow needs a
**tiny process on the dev's own PC** that does the fetch and writes files. That process is the wizard.
This keeps everything local — nothing is uploaded anywhere.

## 2. Delivery (all three, per the owner)

- **`npx katastasi serve`** — one command, no clone/install; opens `http://localhost:8799` with the
  wizard. The recommended path for devs.
- **Clone / download the repo** — `git clone … && npm start` runs the same server. For devs who want the
  source.
- **`dloizides.com` front page** — a static page that explains the tool, shows the one-line command, and
  (optionally) a read-only demo on bundled sample data. It documents/launches the local tool; it can't be
  the live fetcher itself (constraint §1).

No login anywhere — it's the dev's own machine. State persists in the browser's `localStorage` + local
markdown files.

## 3. Architecture

```
browser (self-contained SPA)  ──HTTP──▶  local server (Node, extends src/core/trace/serve.ts)
  localStorage (UI state)                  /api/* endpoints call the existing core:
  no token in the page* ───────────────▶    pull-requirements · analyze (wizard) · sync · trace · test
                                           writes .acp/ markdown on the dev's disk
                                           reads/writes .env for creds
```
\* The token is entered once via a form that **writes the local `.env`**; the server (not the page) uses
it. Loopback-only bind by default.

### Endpoints (the testable layer — node:test over `http`)
- `GET  /api/env` / `POST /api/env` — which creds are set; save creds to `.env` (Jira/Confluence/GitHub).
- `POST /api/sources/list` — given a Jira project / Confluence space (or a pasted URL), **list the epics /
  pages** to choose from. *(New capability — see §5.)*
- `POST /api/pull` — pull the selected epics/pages → `.acp/requirements/` (chosen output dir).
- `POST /api/analyze` — run the wizard/analyze (system design + DB changes + ordered tasks + tests/curls)
  → returns the FeaturePack JSON.
- `GET  /api/feature/:slug` — the generated FeaturePack (to render in the SPA).
- `POST /api/sync/preview` / `POST /api/sync/apply` — reconcile tasks ⇄ Jira/GitHub.

### The SPA (one self-contained page, vendored mermaid)
A step rail: **Connect → Source → Select → Download → Design (+ DB changes?) → Review → Sync.** Each step
calls an endpoint and unlocks the next; progress + answers in `localStorage`. The Review step renders the
existing FeaturePack (diagram, DB-changes checklist, ordered tasks, curls with copy buttons,
approve/verify ticks) inline instead of as a downloaded file.

## 4. Build plan (phased — each endpoint testable via node:test)
1. **`katastasi serve --wizard` (or `katastasi web`)** — serve a static SPA shell + the `/api/env` +
   `/api/feature` endpoints (reuse FeaturePack rendering). Loopback bind, no auth.
2. **Source listing** — `/api/sources/list` + the new adapter methods to **enumerate Jira epics in a
   project / Confluence pages in a space** (see §5); the Select screen (checkboxes).
3. **Pull + Download** — `/api/pull` wired to the chosen selection + output dir; the Download screen.
4. **Design** — `/api/analyze` with the DB-changes gate; the Design + Review screens (render FeaturePack).
5. **Sync** — `/api/sync/preview|apply`; the Sync screen + conflict display.
6. **Polish + `dloizides.com` front page** — copy, sample-data demo, the landing page.

## 5. Net-new capability needed
Today the pull is **by a known epic key / page id** (config-driven). The wizard needs **discovery**:
- Jira: `GET /rest/api/3/search?jql=project=X AND issuetype=Epic` → list epics to pick.
- Confluence: `GET /rest/api/3/space/{key}/content` (or child pages of a page) → list pages to pick.
These become `list`-style methods on the requirement providers / a small `discover` module.

## 6. Out of scope / later
Multi-user or hosted-with-accounts (explicitly not wanted); real-time collaboration; editing the remote
from the SPA beyond sync; a packaged desktop app (Electron) — `npx` covers it.

## 7. Open questions — RESOLVED 2026-06-24
1. **Command** → `katastasi web` (dedicated; "the full web"). ✅ Built (slice 1).
2. **Source input** → paste any Jira/Confluence **URL** + **deep discovery**: an epic pulls its children
   *and* related Confluence pages, *and* follows links found in descriptions to further epics/pages —
   then the dev **confirms** (ticks/unticks) everything discovered before pulling. *(The meaty net-new
   slice; see §5 — needs recursive discovery + link extraction.)*
3. **Output** → default to `.acp/` and show the dev where it landed (override later).
4. **Review** → render inline in the SPA **and** still write `feature-pack.html` (both).
5. **Testing** → `/api/*` endpoints via `node:test` (real http, no new dep); SPA checked in a browser.
   No Playwright.

## 8. Build status
- **Slice 1 ✅ (2026-06-24):** `katastasi web` → loopback `node:http` server + self-contained SPA shell
  (step rail) + working **Connect** step (`/api/env` get-status / write-`.env`). Endpoints unit-tested
  over a real ephemeral server.
- **Slice 2 ✅ (2026-06-24):** **deep discovery** — `src/core/web/discover.ts` (parseSourceUrl +
  extractRefs + a bounded BFS following children + Jira-keys/Confluence-links found in descriptions,
  de-duplicated) over an injectable `DiscoverClient` (real `atlassianClient.ts`; fake in tests). Endpoint
  `POST /api/sources/discover`; SPA Source step (paste URL) + Select step (tick/untick what was found).
- **Slice 3 ✅ (2026-06-24):** **pull** — `src/core/web/pull.ts` `pullSelected()` writes a per-item
  markdown file (content) + an `index.md` (Jira items as requirement checkbox lines, Confluence pages as
  reference docs) into `.acp/requirements/`; broken items skipped. Endpoint `POST /api/pull`; SPA
  Download step.
- **Next:** slice 4 = **Design** (run analyze → render the FeaturePack inline, incl. DB-changes), then
  review → sync.
