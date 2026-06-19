/**
 * Minimal dependency-free glob. Supports `**` (any depth), `*` (one segment), `?`, and `{a,b}`
 * alternation — enough for test-source patterns like `src/**\/*.test.ts` or `Services/**\/*Tests.cs`.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'bin', 'obj']);

/** Compile a glob (forward-slash) to an anchored RegExp matching a forward-slash relative path. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**` (optionally followed by `/`) → any number of segments
        i += 1;
        if (glob[i + 1] === '/') i += 1;
        re += '(?:.*/)?';
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      const end = glob.indexOf('}', i);
      const alts = glob.slice(i + 1, end).split(',').map(escapeLiteral);
      re += `(?:${alts.join('|')})`;
      i = end;
    } else {
      re += escapeLiteral(c);
    }
  }
  return new RegExp(`^${re}$`);
}

function escapeLiteral(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

/** The literal directory prefix of a glob (everything before the first wildcard segment). */
function baseDir(glob: string): string {
  const segments = glob.split('/');
  const literal: string[] = [];
  for (const seg of segments) {
    if (/[*?{]/.test(seg)) break;
    literal.push(seg);
  }
  // Drop a trailing filename segment (no slash after it) — we only want directories to walk from.
  if (literal.length === segments.length) literal.pop();
  return literal.join('/') || '.';
}

/** Return repo-relative (forward-slash) paths of files under `root` matching any of `patterns`. */
export function globFiles(root: string, patterns: string[]): string[] {
  const regexes = patterns.map(globToRegExp);
  const bases = [...new Set(patterns.map(baseDir))];
  const found = new Set<string>();

  for (const base of bases) {
    walk(join(root, base), root, (relPath) => {
      if (regexes.some((re) => re.test(relPath))) found.add(relPath);
    });
  }
  return [...found].sort();
}

/** Recursively visit every file under `dir`, invoking `onFile` with its forward-slash path relative to `root`. */
function walk(dir: string, root: string, onFile: (relPath: string) => void): void {
  const relDir = relative(root, dir).split(sep).join('/');
  if (relDir.split('/').some((seg) => IGNORED_DIRS.has(seg))) return;

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // missing base dir → no matches, not an error
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      walk(full, root, onFile);
    } else if (entry.isFile()) {
      onFile(relative(root, full).split(sep).join('/'));
    } else {
      // symlink or other — stat to decide
      try {
        if (statSync(full).isFile()) onFile(relative(root, full).split(sep).join('/'));
      } catch {
        /* ignore */
      }
    }
  }
}
