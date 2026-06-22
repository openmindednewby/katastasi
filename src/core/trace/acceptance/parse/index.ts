/**
 * Spec-file dispatcher: pick the front-end by file extension (`.acp.json` / `.acp.yml` / `.acp.yaml` /
 * `.acp.md` or `.md`), falling back to a content sniff. Inline ` ```acp-test ` blocks inside requirement
 * markdown are handled separately (see ./inline.ts, added in step 3).
 */
import { AcceptanceParseError, type AcceptanceSpec } from '../model.js';
import { parseJsonSpec } from './json.js';
import { parseYamlSpec } from './yaml.js';
import { parseTableSpec } from './mdTable.js';

export { parseJsonSpec, parseYamlSpec, parseTableSpec };

/** Parse a spec FILE by extension (then content). `fallbackReq` is used by formats that allow omitting it. */
export function parseSpecFile(path: string, text: string, fallbackReq?: string): AcceptanceSpec[] {
  const lower = path.toLowerCase();
  if (lower.endsWith('.json')) return parseJsonSpec(text, path);
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return parseYamlSpec(text, path);
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return parseTableSpec(text, path, fallbackReq);
  // content sniff for unknown extensions
  const t = text.trimStart();
  if (t.startsWith('{') || t.startsWith('[')) return parseJsonSpec(text, path);
  if (t.includes('|')) return parseTableSpec(text, path, fallbackReq);
  if (t) return parseYamlSpec(text, path);
  throw new AcceptanceParseError(`${path}: empty or unrecognised spec file`);
}
