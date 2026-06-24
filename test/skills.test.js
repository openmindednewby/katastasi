// Agent skills installer: per-action Claude skills + idempotent Copilot upsert.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installSkills } from '../dist/core/skills/install.js';
import { SKILLS } from '../dist/core/skills/content.js';

test('installSkills: writes a SKILL.md per action + a copilot block', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skills-'));
  const { written } = installSkills(dir);
  // one skill dir per action
  for (const s of SKILLS) {
    const p = join(dir, '.claude', 'skills', s.name, 'SKILL.md');
    assert.ok(existsSync(p), `${s.name} missing`);
    assert.match(readFileSync(p, 'utf8'), new RegExp(`name: ${s.name}`));
  }
  assert.ok(written.some((w) => w.includes('copilot-instructions.md')));
  assert.match(readFileSync(join(dir, '.github', 'copilot-instructions.md'), 'utf8'), /katastasi:start[\s\S]*katastasi:end/);
});

test('installSkills: re-run refreshes the copilot block, does not duplicate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skills-idem-'));
  installSkills(dir);
  installSkills(dir);
  const content = readFileSync(join(dir, '.github', 'copilot-instructions.md'), 'utf8');
  assert.equal(content.match(/katastasi:start/g).length, 1); // exactly one block
});

test('installSkills: preserves existing copilot content around the block', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skills-keep-'));
  mkdirSync(join(dir, '.github'), { recursive: true });
  writeFileSync(join(dir, '.github', 'copilot-instructions.md'), '# My rules\n\nUse 2-space indent.\n');
  installSkills(dir);
  const content = readFileSync(join(dir, '.github', 'copilot-instructions.md'), 'utf8');
  assert.match(content, /Use 2-space indent/); // kept
  assert.match(content, /## Katastasi/); // appended
});
