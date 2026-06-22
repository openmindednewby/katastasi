// Phase 1 step 2: the .acp/ store resolver + migrate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveStoreDir, tasksDir, manifestPath, migrateStore, acpDir } from '../dist/core/trace/store.js';

function repo() {
  return mkdtempSync(join(tmpdir(), 'rtm-store-'));
}

test('resolveStoreDir: prefers .acp/, falls back to legacy root, else defaults to .acp/', () => {
  const root = repo();
  // default (neither exists) → .acp/requirements
  assert.equal(resolveStoreDir(root, 'requirements'), join(root, '.acp', 'requirements'));
  // legacy root exists → use it
  mkdirSync(join(root, 'runs'));
  assert.equal(resolveStoreDir(root, 'runs'), join(root, 'runs'));
  // .acp/ exists → wins over legacy
  mkdirSync(join(root, '.acp', 'runs'), { recursive: true });
  assert.equal(resolveStoreDir(root, 'runs'), join(root, '.acp', 'runs'));
});

test('tasksDir + manifestPath + acpDir', () => {
  const root = repo();
  assert.equal(acpDir(root), join(root, '.acp'));
  assert.equal(tasksDir(root), join(root, '.acp', 'tasks'));
  assert.equal(tasksDir(root, 'custom/tasks'), join(root, 'custom', 'tasks'));
  assert.equal(manifestPath(root), join(root, '.acp', 'manifest.json'));
});

test('migrateStore: moves legacy dirs into .acp/, idempotent + skip-on-conflict', () => {
  const root = repo();
  mkdirSync(join(root, 'requirements'));
  writeFileSync(join(root, 'requirements', 'PROJ-1.md'), '# PROJ-1');
  mkdirSync(join(root, 'runs'));
  writeFileSync(join(root, 'runs', 'run1.json'), '{}');
  // tech-analysis absent → not moved

  const r1 = migrateStore(root);
  assert.deepEqual(r1.moved.sort(), ['requirements', 'runs']);
  assert.ok(existsSync(join(root, '.acp', 'requirements', 'PROJ-1.md')));
  assert.ok(existsSync(join(root, '.acp', 'runs', 'run1.json')));
  assert.ok(!existsSync(join(root, 'requirements'))); // moved, not copied

  // idempotent: nothing left to move
  const r2 = migrateStore(root);
  assert.equal(r2.moved.length, 0);

  // conflict: a new legacy dir whose .acp/ target already exists → skipped (not clobbered)
  mkdirSync(join(root, 'requirements'));
  writeFileSync(join(root, 'requirements', 'NEW.md'), 'x');
  const r3 = migrateStore(root);
  assert.equal(r3.moved.length, 0);
  assert.match(r3.skipped.join(' '), /requirements/);
  assert.equal(readFileSync(join(root, '.acp', 'requirements', 'PROJ-1.md'), 'utf8'), '# PROJ-1'); // untouched
});
