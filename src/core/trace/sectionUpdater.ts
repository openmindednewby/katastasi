/**
 * Idempotent in-place section replacement, so the RTM can be folded into an EXISTING document
 * (roadmap.md, a Confluence page body, …) without clobbering the rest. Content lives between
 * marker comments; re-running replaces only what's between them, appending the block if absent.
 */
const START = (id: string) => `<!-- acp:trace:start ${id} -->`;
const END = (id: string) => `<!-- acp:trace:end ${id} -->`;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when `doc` already contains the marked section for `id`. */
export function hasSection(doc: string, id: string): boolean {
  return doc.includes(START(id)) && doc.includes(END(id));
}

/**
 * Replace (or append) the `id` section of `doc` with `content`.
 * The markers themselves are preserved so the next run is a clean replace.
 */
export function updateSection(doc: string, id: string, content: string): string {
  const block = `${START(id)}\n${content.trim()}\n${END(id)}`;
  if (hasSection(doc, id)) {
    const re = new RegExp(`${escapeRe(START(id))}[\\s\\S]*?${escapeRe(END(id))}`);
    return doc.replace(re, block);
  }
  const sep = doc.trim() === '' ? '' : doc.endsWith('\n') ? '\n' : '\n\n';
  return `${doc}${sep}${block}\n`;
}
