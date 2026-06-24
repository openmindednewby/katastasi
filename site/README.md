# site/ — the Katastasi front page

A self-contained static landing page for **katastasi.dloizides.com** — it documents the tool and the
one-line command (`npx katastasi web`). It is *not* the working wizard (the wizard runs locally on each
dev's machine via `npx katastasi web`); this page just points people there.

## Files
- `index.html` — the page (no build step, no framework, inline CSS/JS).
- `robots.txt` / `sitemap.xml` — served at the site root.

## Deploy
Serve this folder as static files behind `katastasi.dloizides.com`. With the personal-server tooling that
means dropping it in as a static landing (e.g. an nginx static site / `manage.sh` static app) pointed at
this directory. Before going live, add the **Umami analytics** snippet in `index.html` (a `data-website-id`
created in the analytics dashboard) and run **Lighthouse** (target ≥ 80) — the standard web-app baseline.
