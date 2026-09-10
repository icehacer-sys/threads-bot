import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { State } from '../src/state';

const dir = mkdtempSync(join(tmpdir(), 'reveal-holds-'));
try {
  const file = join(dir, 'state.json');
  writeFileSync(file, JSON.stringify({ repliedCommentIds: [], answeredPostIds: [], postCounts: {}, daily: { date: '2026-09-10', count: 0 } }));
  const state = new State(file);
  assert.equal(state.isWaitingForReveal('guess', 'Coin', false), false);
  state.holdUntilReveal('guess', 'Coin');
  let calls = 0;
  for (let poll = 0; poll < 12; poll++) {
    const restarted = new State(file);
    if (!restarted.isWaitingForReveal('guess', 'Coin', false)) calls++;
  }
  assert.equal(calls, 0, 'Unchanged held guesses must not reach classification on later polls or restarts');
  const restarted = new State(file);
  assert.equal(restarted.isWaitingForReveal('guess', 'Coin', true), false, 'Actual reveal releases the guess');
  assert.equal(restarted.isWaitingForReveal('guess', 'Thanks for sharing', false), false, 'An edited comment gets reconsidered');
  assert.equal(restarted.isWaitingForReveal('fresh', 'Coin', false), false, 'Another commenter is not suppressed');
  assert.equal(restarted.hasSkipped('guess'), false, 'A reveal hold is not a permanent skip');
  console.log('PASS reveal holds survive restarts, avoid repeated classification, and release on reveal or edits');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
