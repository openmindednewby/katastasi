/**
 * Scaffold a framework-correct, key-tagged test stub for a requirement — so an agent (or the dashboard)
 * closes the loop "pull ticket → create the test → implement → trace" without guessing the `@KEY` tag
 * convention or the file layout. The stub fails until implemented (a red "definition of done").
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { TestSourceConfig, TraceConfig } from './config.js';
import type { TestTech } from './types.js';

export interface ScaffoldResult {
  path: string;
  tech: TestTech;
  created: boolean; // false if the file already existed (never clobbered)
}

function slug(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'req';
}

function pascal(key: string): string {
  return key.replace(/[^a-z0-9]+/gi, ' ').trim().split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('') || 'Req';
}

/** Turn a test glob into a concrete stub path: dir before the first wildcard + name + the file suffix. */
export function globToStubPath(glob: string, name: string): string {
  const segs = glob.split('/');
  const file = segs[segs.length - 1];
  const dir: string[] = [];
  for (const s of segs.slice(0, -1)) {
    if (/[*?{]/.test(s)) break;
    dir.push(s);
  }
  const m = file.match(/^\*(.*)$/); // e.g. *.spec.ts → .spec.ts ; *Tests.cs → Tests.cs
  const suffix = m ? m[1] : '.test.ts';
  return `${dir.join('/') || '.'}/${name}${suffix}`;
}

/** The stub body for a tech, tagged with the requirement key. */
export function skeleton(tech: TestTech, key: string, title: string): string {
  const t = title.replace(/'/g, '');
  switch (tech) {
    case 'xunit':
      return (
        `using Xunit;\n\n` +
        `public class ${pascal(key)}Tests\n{\n` +
        `    [Fact]\n    [Trait("req", "${key}")]\n` +
        `    public void ${pascal(key)}()\n    {\n` +
        `        // TODO: implement — ${key}: ${t}\n` +
        `        Assert.True(false, "TODO: implement ${key}");\n    }\n}\n`
      );
    case 'node':
      return (
        `import test from 'node:test';\nimport assert from 'node:assert';\n\n` +
        `test('${t} @${key}', () => {\n  // TODO: implement — ${key}\n  assert.fail('TODO: implement ${key}');\n});\n`
      );
    case 'playwright':
      return (
        `import { test } from '@playwright/test';\n\n` +
        `test('${t} @${key}', async ({ page }) => {\n  // TODO: implement — ${key}\n  throw new Error('TODO: implement ${key}');\n});\n`
      );
    default: // jest / vitest / generic
      return `test('${t} @${key}', () => {\n  // TODO: implement — ${key}\n  throw new Error('TODO: implement ${key}');\n});\n`;
  }
}

/** Pick the test group to scaffold into: the requested tech, else the first group with a glob. */
function pickGroup(config: TraceConfig, tech?: string): TestSourceConfig | null {
  const groups = config.scopes.flatMap((s) => s.tests).filter((g) => g.globs.length);
  if (tech) return groups.find((g) => g.tech === tech) ?? null;
  return groups[0] ?? null;
}

/** Write a key-tagged test stub into the right place. Never clobbers an existing file. */
export function scaffoldTest(
  config: TraceConfig,
  baseDir: string,
  opts: { key: string; tech?: string; title?: string },
): ScaffoldResult {
  const key = opts.key.toUpperCase();
  const group = pickGroup(config, opts.tech);
  if (!group) throw new Error(opts.tech ? `no test group with tech "${opts.tech}" in the config` : 'no test groups configured');

  const repoDir = isAbsolute(config.repoDir ?? '.') ? (config.repoDir as string) : resolve(baseDir, config.repoDir ?? '.');
  const name = group.tech === 'xunit' ? pascal(key) : slug(key);
  const rel = globToStubPath(group.globs[0], name);
  const path = join(repoDir, rel);

  if (existsSync(path)) return { path: rel, tech: group.tech, created: false };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, skeleton(group.tech, key, opts.title ?? key), 'utf8');
  return { path: rel, tech: group.tech, created: true };
}
