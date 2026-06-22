// Phase 2 step 3: inline ```acp-test blocks — terse one-liners + JSON fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInlineBlocks } from '../dist/core/trace/acceptance/parse/inline.js';
import { AcceptanceParseError } from '../dist/core/trace/acceptance/model.js';

test('terse: METHOD path -> status (one case per line)', () => {
  const md = [
    '## Acceptance',
    '```acp-test',
    'POST /login {"user":"x","pass":"bad"} -> 401',
    'GET /me -> 200',
    '```',
  ].join('\n');
  const specs = parseInlineBlocks(md, 'PROJ-1');
  assert.equal(specs.length, 1);
  assert.equal(specs[0].req, 'PROJ-1');
  assert.equal(specs[0].cases.length, 2);
  assert.equal(specs[0].cases[0].steps[0].method, 'POST');
  assert.deepEqual(specs[0].cases[0].steps[0].body, { user: 'x', pass: 'bad' });
  assert.equal(specs[0].cases[0].steps[0].expect.status, 401);
  assert.equal(specs[0].cases[1].steps[0].method, 'GET');
});

test('terse: run command -> exit + contains', () => {
  const md = '```acp-test\nrun node cli.js --help -> 0 contains "Usage"\n```';
  const specs = parseInlineBlocks(md, 'CLI-1');
  const step = specs[0].cases[0].steps[0];
  assert.equal(step.kind, 'process');
  assert.equal(step.run, 'node cli.js --help');
  assert.equal(step.expect.exit, 0);
  assert.deepEqual(step.expect.bodyContains, ['Usage']);
});

test('terse: comments and blank lines ignored', () => {
  const md = '```acp-test\n# smoke checks\n\nGET /health -> 200\n```';
  const specs = parseInlineBlocks(md, 'P-1');
  assert.equal(specs[0].cases.length, 1);
});

test('terse: no requirement key → error', () => {
  const md = '```acp-test\nGET /a -> 200\n```';
  assert.throws(() => parseInlineBlocks(md), AcceptanceParseError);
});

test('terse: missing arrow → error', () => {
  const md = '```acp-test\nGET /a 200\n```';
  assert.throws(() => parseInlineBlocks(md, 'P-1'), AcceptanceParseError);
});

test('JSON fallback: full {cases} block with chaining', () => {
  const md = [
    '```acp-test',
    '{ "cases": [ { "name": "login", "steps": [',
    '  { "POST": "/login", "expect": { "status": 200 }, "capture": { "tok": "$.token" } },',
    '  { "GET": "/me", "headers": { "Authorization": "Bearer {{tok}}" }, "expect": { "status": 200 } }',
    '] } ] }',
    '```',
  ].join('\n');
  const specs = parseInlineBlocks(md, 'PROJ-2');
  assert.equal(specs[0].req, 'PROJ-2');
  assert.equal(specs[0].cases[0].steps.length, 2);
  assert.deepEqual(specs[0].cases[0].steps[0].capture, { tok: '$.token' });
});

test('JSON fallback: a single step object becomes one case', () => {
  const md = '```acp-test\n{ "GET": "/ping", "expect": { "status": 204 } }\n```';
  const specs = parseInlineBlocks(md, 'P-9');
  assert.equal(specs[0].cases.length, 1);
  assert.equal(specs[0].cases[0].steps[0].expect.status, 204);
});

test('JSON fallback: array of steps becomes one case', () => {
  const md = '```acp-test\n[ { "GET": "/a", "expect": { "status": 200 } }, { "GET": "/b", "expect": { "status": 200 } } ]\n```';
  const specs = parseInlineBlocks(md, 'P-3');
  assert.equal(specs[0].cases.length, 1);
  assert.equal(specs[0].cases[0].steps.length, 2);
});

test('JSON block req overrides the enclosing key', () => {
  const md = '```acp-test\n{ "req": "OVR-1", "steps": [ { "GET": "/x", "expect": { "status": 200 } } ] }\n```';
  const specs = parseInlineBlocks(md, 'ENCLOSING-1');
  assert.equal(specs[0].req, 'OVR-1');
});

test('multiple blocks in one document', () => {
  const md = [
    '```acp-test\nGET /a -> 200\n```',
    'prose',
    '```acp-test\nGET /b -> 200\n```',
  ].join('\n');
  const specs = parseInlineBlocks(md, 'P-1');
  assert.equal(specs.length, 2);
});

test('no acp-test blocks → empty', () => {
  assert.deepEqual(parseInlineBlocks('# just prose\n```js\ncode\n```', 'P-1'), []);
});
