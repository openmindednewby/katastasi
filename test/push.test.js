// Unit + integration tests for the push-folder (re-publish) path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markdownToAdf } from '../dist/core/markdownToAdf.js';
import { markdownToStorage } from '../dist/core/markdownToStorage.js';
import { parseIssueMarkdown, parsePageMarkdown, pushFolder } from '../dist/core/push.js';

test('markdownToAdf: heading + paragraph + bullet list', () => {
  const doc = markdownToAdf('## Title\n\nHello **world**\n\n- one\n- two');
  assert.equal(doc.type, 'doc');
  assert.equal(doc.content[0].type, 'heading');
  assert.equal(doc.content[0].attrs.level, 2);
  assert.equal(doc.content[1].content[1].marks[0].type, 'strong');
  assert.equal(doc.content[2].type, 'bulletList');
  assert.equal(doc.content[2].content.length, 2);
});

test('markdownToAdf: code block keeps language', () => {
  const doc = markdownToAdf('```ts\nconst a = 1;\n```');
  assert.equal(doc.content[0].type, 'codeBlock');
  assert.equal(doc.content[0].attrs.language, 'ts');
  assert.equal(doc.content[0].content[0].text, 'const a = 1;');
});

test('markdownToAdf: empty input yields a non-empty doc', () => {
  const doc = markdownToAdf('');
  assert.equal(doc.content.length, 1);
  assert.equal(doc.content[0].type, 'paragraph');
});

test('markdownToStorage: escapes XML specials in prose', () => {
  assert.equal(markdownToStorage('Hunt & Thomas <x>'), '<p>Hunt &amp; Thomas &lt;x&gt;</p>');
});

test('markdownToStorage: heading + list + code macro', () => {
  const html = markdownToStorage('# Title\n\n- a\n- b\n\n```js\nx\n```');
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<ul><li>a<\/li><li>b<\/li><\/ul>/);
  assert.match(html, /ac:name="code"/);
});

test('markdownToStorage: text after a task list is not dropped', () => {
  const html = markdownToStorage('- [x] done\n- [ ] todo\n\nAfter text');
  assert.match(html, /<p>After text<\/p>/);
});

test('parseIssueMarkdown: splits body from metadata sections', () => {
  const md = '# Build API\n\nDo the thing.\n\n### Acceptance Criteria\n\n- works\n\n## Priority\nHigh\n\n## Component\nbackend\n\n## Labels\nauth, n8n-pipeline-generated\n';
  const p = parseIssueMarkdown(md);
  assert.equal(p.title, 'Build API');
  assert.equal(p.priority, 'High');
  assert.equal(p.component, 'backend');
  assert.deepEqual(p.labels, ['auth']); // auto label stripped
  assert.match(p.body, /Do the thing\./);
  assert.match(p.body, /### Acceptance Criteria/); // AC stays in description body
  assert.doesNotMatch(p.body, /## Priority/);
});

test('parsePageMarkdown: title from heading, body after it', () => {
  const p = parsePageMarkdown('# Docs\n\nBody here\nmore');
  assert.equal(p.title, 'Docs');
  assert.equal(p.body, 'Body here\nmore');
});

/** Mock server that records every request and serves canned responses. */
function startRecordingServer(handler) {
  const calls = [];
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const body = raw ? JSON.parse(raw) : null;
        calls.push({ method: req.method, url: req.url, body });
        const out = handler(req.method, req.url, body);
        res.writeHead(out.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out.body ?? {}));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, calls }));
  });
}

test('pushFolder (jira): updates each issue in the manifest', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acp-push-jira-'));
  writeFileSync(join(dir, 'epic.md'), '# Epic\n\nBody.\n\n## Priority\nHigh\n');
  writeFileSync(join(dir, 'task-01-a-story.md'), '# A Story\n\nStory body.\n');
  mkdirSync(join(dir, 'task-01-a-story'), { recursive: true });
  writeFileSync(join(dir, 'task-01-a-story', 'subtask-01-x.md'), '# Sub\n\nSub body.\n');
  writeFileSync(
    join(dir, 'acp-pull.json'),
    JSON.stringify({
      kind: 'jira',
      issues: [
        { file: 'epic.md', key: 'PROJ-1', type: 'epic', parentKey: null },
        { file: 'task-01-a-story.md', key: 'PROJ-2', type: 'Story', parentKey: 'PROJ-1' },
        { file: 'task-01-a-story/subtask-01-x.md', key: 'PROJ-3', type: 'Sub-task', parentKey: 'PROJ-2' },
      ],
    }),
  );

  const { server, calls } = await startRecordingServer((method) => ({ status: method === 'PUT' ? 204 : 200, body: {} }));
  const { port } = server.address();
  process.env.JIRA_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.JIRA_EMAIL = 'a@b.co';
  process.env.JIRA_API_TOKEN = 'tok';
  try {
    const result = await pushFolder(dir);
    assert.equal(result.kind, 'jira');
    assert.equal(result.issues.length, 3);
    assert.ok(result.issues.every((i) => i.action === 'updated'));
    const puts = calls.filter((c) => c.method === 'PUT');
    assert.deepEqual(puts.map((p) => p.url).sort(), ['/rest/api/3/issue/PROJ-1', '/rest/api/3/issue/PROJ-2', '/rest/api/3/issue/PROJ-3']);
    const epicPut = puts.find((p) => p.url.endsWith('PROJ-1'));
    assert.equal(epicPut.body.fields.summary, 'Epic');
    assert.equal(epicPut.body.fields.description.type, 'doc');
    assert.equal(epicPut.body.fields.priority.name, 'High');
  } finally {
    server.close();
  }
});

test('pushFolder (jira): --dry-run makes no HTTP calls', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acp-push-dry-'));
  writeFileSync(join(dir, 'epic.md'), '# Epic\n\nBody.\n');
  writeFileSync(join(dir, 'acp-pull.json'), JSON.stringify({ kind: 'jira', issues: [{ file: 'epic.md', key: 'PROJ-1', type: 'epic', parentKey: null }] }));
  const { server, calls } = await startRecordingServer(() => ({ status: 200, body: {} }));
  const { port } = server.address();
  process.env.JIRA_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.JIRA_EMAIL = 'a@b.co';
  process.env.JIRA_API_TOKEN = 'tok';
  try {
    const result = await pushFolder(dir, { dryRun: true });
    assert.equal(result.issues[0].action, 'would-update');
    assert.equal(calls.length, 0);
  } finally {
    server.close();
  }
});

test('pushFolder (confluence): bumps version and updates each page', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acp-push-conf-'));
  writeFileSync(join(dir, 'page.md'), '# Root\n\nRoot body\n');
  mkdirSync(join(dir, '01-child'), { recursive: true });
  writeFileSync(join(dir, '01-child', 'page.md'), '# Child\n\nChild body\n');
  writeFileSync(
    join(dir, 'acp-pull.json'),
    JSON.stringify({
      kind: 'confluence',
      pages: [
        { dir: '.', pageId: '100', parentPageId: null, title: 'Root' },
        { dir: '01-child', pageId: '101', parentPageId: '100', title: 'Child' },
      ],
    }),
  );
  const versions = { 100: 3, 101: 1 };
  const { server, calls } = await startRecordingServer((method, url) => {
    const id = /content\/(\d+)/.exec(url)?.[1];
    if (method === 'GET') return { status: 200, body: { id, version: { number: versions[id] } } };
    return { status: 200, body: { id } };
  });
  const { port } = server.address();
  process.env.CONFLUENCE_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.CONFLUENCE_EMAIL = 'a@b.co';
  process.env.CONFLUENCE_API_TOKEN = 'tok';
  process.env.CONFLUENCE_SPACE_KEY = 'T';
  try {
    const result = await pushFolder(dir);
    assert.equal(result.pages.length, 2);
    assert.ok(result.pages.every((p) => p.action === 'updated'));
    const puts = calls.filter((c) => c.method === 'PUT');
    const rootPut = puts.find((p) => p.url.endsWith('/100'));
    assert.equal(rootPut.body.version.number, 4);
    assert.match(rootPut.body.body.storage.value, /<p>Root body<\/p>/);
    const childPut = puts.find((p) => p.url.endsWith('/101'));
    assert.equal(childPut.body.version.number, 2);
  } finally {
    server.close();
  }
});

test('pushFolder: errors when no manifest is present', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acp-push-none-'));
  await assert.rejects(() => pushFolder(dir), /No acp-pull.json/);
});
