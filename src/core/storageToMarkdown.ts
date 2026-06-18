/**
 * Convert Confluence storage-format XHTML to markdown.
 *
 * The reverse of the forward `mdToConfluenceHtml` (n8n `markdown-to-confluence` Code node).
 * Confluence storage format is well-formed XML-ish HTML, so we use a small tolerant tokenizer
 * rather than a full DOM library (the package is intentionally dependency-light). It handles the
 * subset the forward path emits — headings, paragraphs, bold/italic/code/links, bullet/numbered
 * lists, tables, code macros, task lists, blockquotes, rules — and strips unknown tags safely.
 */

const NEWLINE_TAGS = new Set(['p', 'br', 'div']);

/** Convert a storage-format XHTML string to a trimmed markdown string. */
export function storageToMarkdown(html: string | null | undefined): string {
  if (!html) return '';
  let out = html.replace(/\r/g, '');

  // Strip the pipeline's own "Published from markdown by …" footer if present.
  out = out.replace(/<hr\s*\/?>\s*<p><em>Published from markdown[\s\S]*?<\/em><\/p>\s*$/i, '');

  out = convertMermaidMacros(out);
  out = convertCodeMacros(out);
  out = convertTaskLists(out);
  out = convertTables(out);
  out = convertLists(out);
  out = convertBlocks(out);
  out = convertInline(out);
  out = decodeEntities(out);

  return out
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim();
}

/** Any mermaid macro (`mermaid-cloud`, `mermaid`, …) → a ```mermaid fenced block. */
function convertMermaidMacros(html: string): string {
  const macro = /<ac:structured-macro[^>]*ac:name="(mermaid[^"]*)"[^>]*>([\s\S]*?)<\/ac:structured-macro>/gi;
  return html.replace(macro, (_m, _name: string, inner: string) => {
    const body = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(inner)?.[1] ?? stripTags(inner);
    return `\n\n\`\`\`mermaid\n${body.trim()}\n\`\`\`\n\n`;
  });
}

/** `<ac:structured-macro ac:name="code">…<![CDATA[…]]></ac:structured-macro>` → fenced block. */
function convertCodeMacros(html: string): string {
  const macro = /<ac:structured-macro[^>]*ac:name="code"[^>]*>([\s\S]*?)<\/ac:structured-macro>/gi;
  return html.replace(macro, (_m, inner: string) => {
    const lang = /ac:name="language"[^>]*>([^<]*)</i.exec(inner)?.[1]?.trim() ?? '';
    const body = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(inner)?.[1] ?? stripTags(inner);
    return `\n\n\`\`\`${lang}\n${body.trim()}\n\`\`\`\n\n`;
  });
}

/** `<ac:task-list>` → `- [ ] ` / `- [x] ` checkbox list. */
function convertTaskLists(html: string): string {
  const list = /<ac:task-list>([\s\S]*?)<\/ac:task-list>/gi;
  return html.replace(list, (_m, inner: string) => {
    const tasks = [...inner.matchAll(/<ac:task>([\s\S]*?)<\/ac:task>/gi)];
    const lines = tasks.map((t) => {
      const status = /<ac:task-status>([^<]*)<\/ac:task-status>/i.exec(t[1])?.[1]?.trim();
      const bodyHtml = /<ac:task-body>([\s\S]*?)<\/ac:task-body>/i.exec(t[1])?.[1] ?? '';
      const box = status === 'complete' ? '[x]' : '[ ]';
      return `- ${box} ${convertInline(stripBlockTags(bodyHtml)).trim()}`;
    });
    return `\n\n${lines.join('\n')}\n\n`;
  });
}

/** `<table>…</table>` → markdown pipe table (first row treated as header). */
function convertTables(html: string): string {
  return html.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_m, inner: string) => {
    const rows = [...inner.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) => r[1]);
    if (rows.length === 0) return '';
    const cells = (row: string): string[] =>
      [...row.matchAll(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map((c) =>
        convertInline(stripBlockTags(c[1])).replace(/\|/g, '\\|').trim(),
      );
    const header = cells(rows[0]);
    const sep = `| ${header.map(() => '---').join(' | ')} |`;
    const lines = [`| ${header.join(' | ')} |`, sep, ...rows.slice(1).map((r) => `| ${cells(r).join(' | ')} |`)];
    return `\n\n${lines.join('\n')}\n\n`;
  });
}

/** `<ul>`/`<ol>` → markdown lists (one level; nested handled by recursion on inner content). */
function convertLists(html: string): string {
  const replaceOnce = (input: string): { out: string; changed: boolean } => {
    let changed = false;
    const out = input.replace(/<(ul|ol)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, tag: string, inner: string) => {
      changed = true;
      const ordered = tag.toLowerCase() === 'ol';
      let n = 0;
      const items = [...inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((li) => {
        n += 1;
        const marker = ordered ? `${n}.` : '-';
        // Recurse for nested lists, indenting the result.
        const recursed = convertLists(li[1]);
        const nestedMatch = /\n[-\d]/.test(recursed);
        if (nestedMatch) {
          const [first, ...rest] = recursed.split('\n');
          const body = rest.map((l) => (l ? `  ${l}` : l)).join('\n');
          return `${marker} ${convertInline(stripBlockTags(first)).trim()}\n${body}`;
        }
        return `${marker} ${convertInline(stripBlockTags(recursed)).trim()}`;
      });
      return `\n\n${items.join('\n')}\n\n`;
    });
    return { out, changed };
  };
  let result = html;
  for (let i = 0; i < 6; i += 1) {
    const { out, changed } = replaceOnce(result);
    result = out;
    if (!changed) break;
  }
  return result;
}

/** Headings, paragraphs, blockquotes, rules → markdown block syntax. */
function convertBlocks(html: string): string {
  let out = html;
  out = out.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, lvl: string, inner: string) => {
    const hashes = '#'.repeat(Number(lvl));
    return `\n\n${hashes} ${convertInline(stripBlockTags(inner)).trim()}\n\n`;
  });
  out = out.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner: string) => {
    const text = convertInline(stripBlockTags(inner)).trim();
    return `\n\n${text
      .split('\n')
      .map((l) => `> ${l}`.trimEnd())
      .join('\n')}\n\n`;
  });
  out = out.replace(/<hr\s*\/?>/gi, '\n\n---\n\n');
  out = out.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_m, inner: string) => `\n\n${inner}\n\n`);
  out = out.replace(/<br\s*\/?>/gi, '\n');
  return out;
}

/** Inline formatting: strong/em/code/links. Leaves text content, strips remaining tags. */
function convertInline(html: string): string {
  let out = html;
  out = out.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) => `**${inner.trim()}**`);
  out = out.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) => `*${inner.trim()}*`);
  out = out.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_m, inner: string) => `\`${inner.trim()}\``);
  out = out.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => `[${inner.trim()}](${href})`);
  return stripTags(out);
}

/** Remove block-level wrappers but keep inline markup (used inside cells / list items). */
function stripBlockTags(html: string): string {
  return html.replace(/<\/?(p|div|span)[^>]*>/gi, ' ').replace(/[ \t]{2,}/g, ' ');
}

/** Strip any remaining tags. */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

/** Decode the handful of HTML entities Confluence emits. */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}
