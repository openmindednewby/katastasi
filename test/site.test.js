// Landing page (site/index.html): the command + SEO baseline must be present.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'site', 'index.html'), 'utf8');

test('landing page: shows the npx command + the flow', () => {
  assert.match(html, /npx katastasi web/);
  assert.match(html, /CONNECT[\s\S]*SOURCE[\s\S]*DESIGN[\s\S]*SYNC/);
});

test('landing page: SEO baseline (title, description, canonical, OG)', () => {
  assert.match(html, /<title>[^<]{10,}<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]{30,}">/);
  assert.match(html, /<link rel="canonical"/);
  assert.match(html, /property="og:title"/);
});

test('landing page: robots.txt + sitemap.xml served at the site root', () => {
  assert.ok(existsSync(join(root, 'site', 'robots.txt')));
  assert.ok(existsSync(join(root, 'site', 'sitemap.xml')));
});
