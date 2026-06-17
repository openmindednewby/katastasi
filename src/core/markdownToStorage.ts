/**
 * Convert markdown to Confluence storage-format XHTML.
 *
 * Forward counterpart of `storageToMarkdown`. Ported from the n8n `markdown-to-confluence` Code
 * node (the canonical converter, incl. the XML-escape fix for bare & / < / > in prose) so the
 * direct-REST `push` path produces the same storage XML without needing n8n running.
 */

/** Convert a markdown string to Confluence storage-format XHTML. */
export function markdownToStorage(md: string): string {
  const lines = (md ?? '').replace(/\r/g, '').split('\n');
  let html = '';
  let inCodeBlock = false;
  let codeContent = '';
  let codeLang = 'text';
  let inList = false;

  // Escape XML special chars in text BEFORE applying inline markdown, otherwise a bare
  // & / < / > in prose produces invalid storage XML that Confluence rejects.
  const fmt = (raw: string): string => {
    const escaped = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return escaped
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  };
  const closeList = (): void => {
    if (inList) {
      html += '</ul>';
      inList = false;
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (line.startsWith('```') && !inCodeBlock) {
      closeList();
      inCodeBlock = true;
      codeLang = line.slice(3).trim() || 'text';
      codeContent = '';
      continue;
    }
    if (line.startsWith('```') && inCodeBlock) {
      inCodeBlock = false;
      html +=
        `<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">${codeLang}</ac:parameter>` +
        `<ac:plain-text-body><![CDATA[${codeContent.trim()}]]></ac:plain-text-body></ac:structured-macro>`;
      continue;
    }
    if (inCodeBlock) {
      codeContent += `${line}\n`;
      continue;
    }

    if (/^\|.+\|$/.test(line) && i + 1 < lines.length && /^\|[-| :]+\|$/.test(lines[i + 1])) {
      closeList();
      const headers = splitRow(line).map((c) => `<th>${fmt(c)}</th>`).join('');
      html += `<table><thead><tr>${headers}</tr></thead><tbody>`;
      i += 1;
      while (i + 1 < lines.length && /^\|.+\|$/.test(lines[i + 1])) {
        i += 1;
        html += `<tr>${splitRow(lines[i]).map((c) => `<td>${fmt(c)}</td>`).join('')}</tr>`;
      }
      html += '</tbody></table>';
      continue;
    }

    const heading = line.match(/^(#{1,6}) (.+)$/);
    if (heading) {
      closeList();
      html += `<h${heading[1].length}>${fmt(heading[2])}</h${heading[1].length}>`;
      continue;
    }

    if (/^---+$/.test(line)) {
      closeList();
      html += '<hr/>';
      continue;
    }

    if (line.startsWith('> ')) {
      closeList();
      html += `<blockquote><p>${fmt(line.slice(2))}</p></blockquote>`;
      continue;
    }

    if (/^- \[([ xX])\] /.test(line)) {
      closeList();
      html += '<ac:task-list>';
      while (i < lines.length && /^- \[([ xX])\] /.test(lines[i])) {
        const cm = lines[i].match(/^- \[([ xX])\] (.+)/);
        const status = cm && (cm[1] === 'x' || cm[1] === 'X') ? 'complete' : 'incomplete';
        html += `<ac:task><ac:task-status>${status}</ac:task-status><ac:task-body>${fmt(cm ? cm[2] : '')}</ac:task-body></ac:task>`;
        i += 1;
      }
      html += '</ac:task-list>';
      i -= 1;
      continue;
    }

    if (/^[-*] /.test(line)) {
      if (!inList) {
        html += '<ul>';
        inList = true;
      }
      html += `<li>${fmt(line.replace(/^[-*] /, ''))}</li>`;
      continue;
    }

    if (line.trim() === '') {
      closeList();
      continue;
    }

    closeList();
    html += `<p>${fmt(line)}</p>`;
  }

  closeList();
  return html;
}

/** Split a markdown table row into trimmed cell strings. */
function splitRow(line: string): string[] {
  return line.split('|').filter((c) => c.trim()).map((c) => c.trim());
}
