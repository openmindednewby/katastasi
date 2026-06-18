// Mermaid support: markdown <-> Jira (ADF) and markdown <-> Confluence (storage), both ways.
import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownToAdf } from '../dist/core/markdownToAdf.js';
import { adfToMarkdown } from '../dist/core/adfToMarkdown.js';
import { markdownToStorage } from '../dist/core/markdownToStorage.js';
import { storageToMarkdown } from '../dist/core/storageToMarkdown.js';

const DIAGRAM = 'graph TD;\n  A-->B;\n  B-->C;';
const FENCE = '```mermaid\n' + DIAGRAM + '\n```';

/* ── Jira (ADF) ── */

test('jira forward: ```mermaid → ADF codeBlock language=mermaid', () => {
  const doc = markdownToAdf(FENCE);
  assert.equal(doc.content[0].type, 'codeBlock');
  assert.equal(doc.content[0].attrs.language, 'mermaid');
  assert.equal(doc.content[0].content[0].text, DIAGRAM);
});

test('jira reverse: ADF mermaid codeBlock → ```mermaid fence', () => {
  const doc = { type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'mermaid' }, content: [{ type: 'text', text: DIAGRAM }] }] };
  assert.equal(adfToMarkdown(doc), FENCE);
});

test('jira round-trip: markdown → ADF → markdown preserves the diagram', () => {
  assert.equal(adfToMarkdown(markdownToAdf(FENCE)), FENCE);
});

/* ── Confluence (storage) ── */

test('confluence forward: ```mermaid → mermaid macro (default name) with source in body', () => {
  const html = markdownToStorage(FENCE);
  assert.match(html, /ac:name="mermaid-cloud"/);
  assert.match(html, /<!\[CDATA\[graph TD;/);
  assert.doesNotMatch(html, /ac:name="code"/); // not a plain code macro
});

test('confluence forward: macro name is configurable', () => {
  const html = markdownToStorage(FENCE, 'mermaid');
  assert.match(html, /ac:name="mermaid"/);
});

test('confluence forward: non-mermaid code still uses the code macro', () => {
  const html = markdownToStorage('```js\nconst a = 1;\n```');
  assert.match(html, /ac:name="code"/);
  assert.match(html, /ac:name="language">js/);
});

test('confluence reverse: mermaid macro → ```mermaid fence (any mermaid* name)', () => {
  const html = '<ac:structured-macro ac:name="mermaid-cloud"><ac:plain-text-body><![CDATA[' + DIAGRAM + ']]></ac:plain-text-body></ac:structured-macro>';
  assert.equal(storageToMarkdown(html), FENCE);
});

test('confluence round-trip: markdown → storage → markdown preserves the diagram', () => {
  assert.equal(storageToMarkdown(markdownToStorage(FENCE)), FENCE);
});

test('confluence round-trip: custom macro name still round-trips to mermaid fence', () => {
  assert.equal(storageToMarkdown(markdownToStorage(FENCE, 'mermaid')), FENCE);
});
