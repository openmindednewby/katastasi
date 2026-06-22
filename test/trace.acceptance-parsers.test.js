// Phase 2 step 2: YAML-lite + markdown-table spec parsers + file dispatcher.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYamlLite } from '../dist/core/trace/acceptance/parse/yamlLite.js';
import { parseYamlSpec } from '../dist/core/trace/acceptance/parse/yaml.js';
import { parseTableSpec } from '../dist/core/trace/acceptance/parse/mdTable.js';
import { parseSpecFile } from '../dist/core/trace/acceptance/parse/index.js';
import { AcceptanceParseError } from '../dist/core/trace/acceptance/model.js';

// ── YAML-lite core ──────────────────────────────────────────────────────────────────────────

test('yamlLite: scalars coerce (number/bool/null/string)', () => {
  const v = parseYamlLite('a: 200\nb: true\nc: ~\nd: /login\ne: exists');
  assert.deepEqual(v, { a: 200, b: true, c: null, d: '/login', e: 'exists' });
});

test('yamlLite: inline flow map + list', () => {
  const v = parseYamlLite('expect: { status: 200, json: { $.id: exists } }\ntags: [a, b, c]');
  assert.deepEqual(v, { expect: { status: 200, json: { '$.id': 'exists' } }, tags: ['a', 'b', 'c'] });
});

test('yamlLite: nested block map', () => {
  const v = parseYamlLite('runner:\n  baseUrl: http://x\n  headers:\n    X-A: "1"');
  assert.deepEqual(v, { runner: { baseUrl: 'http://x', headers: { 'X-A': '1' } } });
});

test('yamlLite: list of maps (dash + aligned keys)', () => {
  const v = parseYamlLite('cases:\n  - name: a\n    steps:\n      - GET: /a\n        expect: { status: 200 }');
  assert.deepEqual(v, { cases: [{ name: 'a', steps: [{ GET: '/a', expect: { status: 200 } }] }] });
});

test('yamlLite: comments + quoted value with colon', () => {
  const v = parseYamlLite('# header comment\nAuthorization: "Bearer {{tok}}" # inline');
  assert.deepEqual(v, { Authorization: 'Bearer {{tok}}' });
});

// ── YAML spec front-end ─────────────────────────────────────────────────────────────────────

test('parseYamlSpec: full spec with chaining/capture', () => {
  const yaml = [
    'req: PROJ-1',
    'cases:',
    '  - name: token then me',
    '    steps:',
    '      - POST: /login',
    '        body: { user: a, pass: b }',
    '        expect: { status: 200 }',
    '        capture: { tok: $.token }',
    '      - GET: /me',
    '        headers: { Authorization: "Bearer {{tok}}" }',
    '        expect: { status: 200, json: { $.id: exists } }',
  ].join('\n');
  const specs = parseYamlSpec(yaml, 's.yml');
  assert.equal(specs.length, 1);
  const c = specs[0].cases[0];
  assert.equal(c.steps.length, 2);
  assert.equal(c.steps[0].method, 'POST');
  assert.deepEqual(c.steps[0].capture, { tok: '$.token' });
  assert.equal(c.steps[1].headers.Authorization, 'Bearer {{tok}}');
  assert.deepEqual(c.steps[1].expect.json, { '$.id': 'exists' });
});

// ── markdown-table front-end ────────────────────────────────────────────────────────────────

test('parseTableSpec: rows → single-step cases, grouped by req column', () => {
  const md = [
    '| req | case | method | path | status |',
    '|-----|------|--------|------|--------|',
    '| P-1 | bad creds | POST | /login | 401 |',
    '| P-1 | health | GET | /health | 200 |',
    '| P-2 | me | GET | /me | 200 |',
  ].join('\n');
  const specs = parseTableSpec(md, 't.md');
  assert.equal(specs.length, 2);
  const p1 = specs.find((s) => s.req === 'P-1');
  assert.equal(p1.cases.length, 2);
  assert.equal(p1.cases[0].name, 'bad creds');
  assert.equal(p1.cases[0].steps[0].method, 'POST');
  assert.equal(p1.cases[0].steps[0].expect.status, 401);
});

test('parseTableSpec: leading "req:" line as default key + body JSON cell', () => {
  const md = [
    'req: ORD-9',
    '| method | path | body | status |',
    '|--------|------|------|--------|',
    '| POST | /orders | {"qty":2} | 201 |',
  ].join('\n');
  const specs = parseTableSpec(md, 't.md');
  assert.equal(specs[0].req, 'ORD-9');
  assert.deepEqual(specs[0].cases[0].steps[0].body, { qty: 2 });
  assert.equal(specs[0].cases[0].steps[0].expect.status, 201);
});

test('parseTableSpec: run column → process step', () => {
  const md = [
    '| req | run | exit | contains |',
    '|-----|-----|------|----------|',
    '| CLI-1 | node cli.js --help | 0 | Usage |',
  ].join('\n');
  const specs = parseTableSpec(md, 't.md');
  const step = specs[0].cases[0].steps[0];
  assert.equal(step.kind, 'process');
  assert.equal(step.run, 'node cli.js --help');
  assert.equal(step.expect.exit, 0);
  assert.deepEqual(step.expect.bodyContains, ['Usage']);
});

test('parseTableSpec: missing req anywhere → error', () => {
  const md = '| method | path | status |\n|--|--|--|\n| GET | /x | 200 |';
  assert.throws(() => parseTableSpec(md, 't.md'), AcceptanceParseError);
});

// ── dispatcher ──────────────────────────────────────────────────────────────────────────────

test('parseSpecFile: dispatches by extension', () => {
  const json = parseSpecFile('a.acp.json', '{"req":"P-1","steps":[{"GET":"/a","expect":{"status":200}}]}');
  assert.equal(json[0].req, 'P-1');
  const yaml = parseSpecFile('a.acp.yml', 'req: P-2\nsteps:\n  - GET: /b\n    expect: { status: 200 }');
  assert.equal(yaml[0].req, 'P-2');
  const md = parseSpecFile('a.acp.md', 'req: P-3\n| method | path | status |\n|--|--|--|\n| GET | /c | 200 |');
  assert.equal(md[0].req, 'P-3');
});

test('parseSpecFile: content sniff for unknown extension', () => {
  const specs = parseSpecFile('weird.txt', '{"req":"P-9","steps":[{"GET":"/z","expect":{"status":200}}]}');
  assert.equal(specs[0].req, 'P-9');
});
