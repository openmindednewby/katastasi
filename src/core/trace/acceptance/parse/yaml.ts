/**
 * YAML-lite spec-file front-end: parse a `.acp.yml` document (a single spec map, or a top-level list of
 * specs) into `AcceptanceSpec`s via the shared `normalizeSpec`.
 */
import { normalizeSpec, type AcceptanceSpec } from '../model.js';
import { parseYamlLite } from './yamlLite.js';

export function parseYamlSpec(text: string, source: string): AcceptanceSpec[] {
  const raw = parseYamlLite(text);
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((entry, i) => normalizeSpec(entry, list.length > 1 ? `${source}[${i}]` : source));
}
