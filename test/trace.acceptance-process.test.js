// Phase 2 step 6: process/CLI executor — spawns node one-liners (portable on win + linux).
import test from 'node:test';
import assert from 'node:assert/strict';
import { executeProcessStep } from '../dist/core/trace/acceptance/processExecutor.js';
import { normalizeStep } from '../dist/core/trace/acceptance/model.js';

test('process: exit 0 + stdout contains', async () => {
  const step = normalizeStep({ run: `node -e "console.log('Usage: foo')"`, expect: { exit: 0, stdoutContains: 'Usage' } }, 'x');
  const r = await executeProcessStep(step, { vars: {} });
  assert.equal(r.ok, true, r.failures.join('; '));
  assert.equal(r.exit, 0);
});

test('process: non-zero exit asserted', async () => {
  const step = normalizeStep({ run: `node -e "process.exit(3)"`, expect: { exit: 3 } }, 'x');
  const r = await executeProcessStep(step, { vars: {} });
  assert.equal(r.ok, true, r.failures.join('; '));
  assert.equal(r.exit, 3);
});

test('process: wrong exit → failure', async () => {
  const step = normalizeStep({ run: `node -e "process.exit(1)"`, expect: { exit: 0 } }, 'x');
  const r = await executeProcessStep(step, { vars: {} });
  assert.equal(r.ok, false);
  assert.match(r.failures[0], /exit: expected 0, got 1/);
});

test('process: capture stdout (trimmed) into vars', async () => {
  const vars = {};
  const step = normalizeStep({ run: `node -e "console.log('hello')"`, expect: { exit: 0 }, capture: { out: 'stdout' } }, 'x');
  const r = await executeProcessStep(step, { vars });
  assert.deepEqual(r.captured, { out: 'hello' });
  assert.equal(vars.out, 'hello');
});

test('process: interpolates {{var}} into the command', async () => {
  const step = normalizeStep({ run: `node -e "console.log('{{name}}')"`, expect: { exit: 0, stdoutContains: 'demetris' } }, 'x');
  const r = await executeProcessStep(step, { vars: { name: 'demetris' } });
  assert.equal(r.ok, true, r.failures.join('; '));
});

test('process: spawn error → error result, not a throw', async () => {
  const step = normalizeStep({ run: 'this-command-does-not-exist-xyz', expect: { exit: 0 } }, 'x');
  const r = await executeProcessStep(step, { vars: {} });
  assert.equal(r.ok, false);
  // either a spawn error or a non-zero shell exit — both are a clean failure result
  assert.ok(r.error || r.failures.length > 0);
});
