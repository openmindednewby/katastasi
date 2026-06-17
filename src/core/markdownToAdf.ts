/**
 * Convert markdown to Atlassian Document Format (ADF).
 *
 * Forward counterpart of `adfToMarkdown`. Ported from the n8n `markdown-to-jira` Code node
 * (the canonical converter) so the direct-REST `push` path produces byte-compatible ADF without
 * needing n8n running. Handles headings, paragraphs, bold/italic/code/links, bullet/ordered/task
 * lists, code blocks, blockquotes, rules and pipe tables.
 */
import type { AdfNode } from './adfToMarkdown.js';

interface AdfDoc {
  type: 'doc';
  version: 1;
  content: AdfNode[];
}

/** Convert a markdown string to an ADF document node. */
export function markdownToAdf(md: string): AdfDoc {
  const lines = (md ?? '').replace(/\r/g, '').split('\n');
  const nodes: AdfNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      const lang = line.slice(3).trim() || null;
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      i += 1;
      const cb: AdfNode = { type: 'codeBlock', content: [{ type: 'text', text: codeLines.join('\n') }] };
      if (lang) cb.attrs = { language: lang };
      nodes.push(cb);
      continue;
    }

    const heading = line.match(/^(#{1,6}) (.+)$/);
    if (heading) {
      nodes.push({ type: 'heading', attrs: { level: heading[1].length }, content: inlineToAdf(heading[2]) });
      i += 1;
      continue;
    }

    if (/^---+$/.test(line)) {
      nodes.push({ type: 'rule' });
      i += 1;
      continue;
    }

    if (line.startsWith('> ')) {
      const quoted: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoted.push(lines[i].slice(2));
        i += 1;
      }
      nodes.push({ type: 'blockquote', content: [{ type: 'paragraph', content: inlineToAdf(quoted.join(' ')) }] });
      continue;
    }

    if (/^- \[([ xX])\] /.test(line)) {
      let uid = 0;
      const items: AdfNode[] = [];
      while (i < lines.length && /^- \[([ xX])\] /.test(lines[i])) {
        const cm = lines[i].match(/^- \[([ xX])\] (.+)/);
        const state = cm && (cm[1] === 'x' || cm[1] === 'X') ? 'DONE' : 'TODO';
        items.push({ type: 'taskItem', attrs: { localId: `task-${uid}`, state }, content: inlineToAdf(cm ? cm[2] : '') });
        uid += 1;
        i += 1;
      }
      nodes.push({ type: 'taskList', attrs: { localId: `tl-${uid}` }, content: items });
      continue;
    }

    if (/^[-*] /.test(line)) {
      const items: AdfNode[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i]) && !/^- \[([ xX])\] /.test(lines[i])) {
        items.push({ type: 'listItem', content: [{ type: 'paragraph', content: inlineToAdf(lines[i].replace(/^[-*] /, '')) }] });
        i += 1;
      }
      nodes.push({ type: 'bulletList', content: items });
      continue;
    }

    if (/^\d+[.)]/.test(line)) {
      const items: AdfNode[] = [];
      while (i < lines.length && /^\d+[.)]/.test(lines[i])) {
        items.push({ type: 'listItem', content: [{ type: 'paragraph', content: inlineToAdf(lines[i].replace(/^\d+[.)] ?/, '')) }] });
        i += 1;
      }
      nodes.push({ type: 'orderedList', content: items });
      continue;
    }

    if (/^\|.+\|$/.test(line) && i + 1 < lines.length && /^\|[-| :]+\|$/.test(lines[i + 1])) {
      const headerCells = splitRow(line).map((c) => tableCell('tableHeader', c));
      const rows: AdfNode[] = [{ type: 'tableRow', content: headerCells }];
      i += 2;
      while (i < lines.length && /^\|.+\|$/.test(lines[i])) {
        rows.push({ type: 'tableRow', content: splitRow(lines[i]).map((c) => tableCell('tableCell', c)) });
        i += 1;
      }
      nodes.push({ type: 'table', attrs: { isNumberColumnEnabled: false, layout: 'default' }, content: rows });
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }

    nodes.push({ type: 'paragraph', content: inlineToAdf(line) });
    i += 1;
  }

  return { type: 'doc', version: 1, content: nodes.length > 0 ? nodes : [{ type: 'paragraph', content: [{ type: 'text', text: ' ' }] }] };
}

/** Split a markdown table row into trimmed cell strings. */
function splitRow(line: string): string[] {
  return line.split('|').filter((c) => c.trim()).map((c) => c.trim());
}

/** Build a table header/data cell node. */
function tableCell(type: 'tableHeader' | 'tableCell', text: string): AdfNode {
  return { type, attrs: {}, content: [{ type: 'paragraph', content: inlineToAdf(text) }] };
}

/** Convert inline markdown (bold/italic/code/link) to an array of ADF text nodes. */
function inlineToAdf(text: string): AdfNode[] {
  const parts: AdfNode[] = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: 'text', text: text.slice(last, m.index) });
    if (m[2]) parts.push({ type: 'text', text: m[2], marks: [{ type: 'strong' }] });
    else if (m[3]) parts.push({ type: 'text', text: m[3], marks: [{ type: 'em' }] });
    else if (m[4]) parts.push({ type: 'text', text: m[4], marks: [{ type: 'code' }] });
    else if (m[5] && m[6]) parts.push({ type: 'text', text: m[5], marks: [{ type: 'link', attrs: { href: m[6] } }] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) });
  if (parts.length === 0 && text) parts.push({ type: 'text', text });
  return parts;
}
