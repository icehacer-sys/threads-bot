// Run the actual workflow shell with built-in fakes only: no APIs, real Git or sleeps.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workflow = readFileSync(new URL('../.github/workflows/reply.yml', import.meta.url), 'utf8');
const match = workflow.match(/      - name: Poll on a tapering cadence[^\n]*\n[\s\S]*?        run: \|\n([\s\S]*?)\n      - name: Preserve state after failure/);
assert.ok(match, 'locate the production polling shell without duplicating its logic');
const shell = match[1].split('\n').map(line => {
  assert.ok(!line || line.startsWith('          '), 'workflow block indentation');
  return line.slice(10);
}).join('\n');
const syntax = spawnSync('/bin/bash', ['-n'], { input: shell, encoding: 'utf8' });
assert.equal(syntax.status, 0, syntax.stderr);
assert.match(workflow, /BOT_ACTIVE_TZ: "Africa\/Cairo"/);
assert.match(workflow, /BOT_ACTIVE_WINDOWS: \$\{\{ github\.event\.inputs\.window \|\| '22-10' \}\}/);
assert.match(workflow, /MAXSECS: "19800"/);
assert.match(workflow, /if: failure\(\)[\s\S]*actions\/upload-artifact@v4[\s\S]*retention-days: 7/);

const fakes = String.raw`
event() { local now kind="$1"; shift; read -r now < clock; printf '%s|%s|%s\n' "$kind" "$now" "$*" >> trace; }
advance() { local now; read -r now < clock; printf '%s\n' "$((now + $1))" > clock; }
date() {
  local now seconds hour minute
  read -r now < clock
  event date "$1"
  case "$1" in
    +%s) printf '%s\n' "$now" ;;
    +%-H|+%-M|+%H:%M)
      if [ "$1" = '+%-H' ] && [ "$CALC_SECONDS" -gt 0 ]; then advance "$CALC_SECONDS"; fi
      seconds=$(( (CAIRO_HOUR * 3600 + CAIRO_MINUTE * 60 + now) % 86400 ))
      hour=$(( seconds / 3600 )); minute=$(( seconds / 60 % 60 ))
      case "$1" in
        +%-H) printf '%s\n' "$hour" ;;
        +%-M) printf '%s\n' "$minute" ;;
        +%H:%M) printf '%02d:%02d\n' "$hour" "$minute" ;;
      esac ;;
    *) event unexpected-date "$*"; return 90 ;;
  esac
}
sleep() {
  if [ "$1" -le 0 ]; then event invalid-sleep "$*"; return 91; fi
  event sleep "$1"
  advance "$(( $1 + OVERSLEEP_SECONDS ))"
}
seq() { local n; for ((n=$1; n<=$2; n++)); do printf '%s\n' "$n"; done; }
git() {
  local value count
  event git "$*"
  case "$1" in
    config|add|rebase) return 0 ;;
    status) read -r value < dirty; [ "$value" = 0 ] || printf ' M state.json\n'; return 0 ;;
    commit)
      read -r value < state.json; printf '%s\n' "$value" > committed
      printf '0\n' > dirty; return 0 ;;
    pull) advance "$SYNC_SECONDS"; return 0 ;;
    push)
      read -r count < pushes; count=$((count+1)); printf '%s\n' "$count" > pushes
      if [ "$FAIL_PUSH_FROM" -gt 0 ] && [ "$count" -ge "$FAIL_PUSH_FROM" ]; then return 1; fi
      read -r value < committed; printf '%s\n' "$value" > remote; return 0 ;;
    *) event unexpected-git "$*"; return 92 ;;
  esac
}
npm() {
  local count
  event npm "$*"
  case "$*" in
    'run live')
      read -r count < polls; count=$((count+1)); printf '%s\n' "$count" > polls
      printf '{"generation":%s,"pending":{"creationId":"saved-container"}}\n' "$count" > state.json
      printf '1\n' > dirty; advance "$LIVE_SECONDS"; return "$LIVE_RC" ;;
    'run preflight') advance "$PREFLIGHT_SECONDS"; return 0 ;;
    'run dry'|'run fb:dry') return 0 ;;
    *) event unexpected-npm "$*"; return 93 ;;
  esac
}
gh() {
  local local_state remote_state
  event gh "$*"
  if [ "$*" != 'workflow run reply.yml -f mode=live' ]; then return 94; fi
  read -r local_state < state.json; read -r remote_state < remote
  [ "$local_state" = "$remote_state" ] || { event unsynced-handoff; return 95; }
  return "$GH_RC"
}
`;

function fixture(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'worker-lifecycle-'));
  const initial = '{"generation":0,"pending":{"creationId":"saved-container"}}\n';
  for (const file of ['state.json', 'committed', 'remote']) writeFileSync(join(dir, file), initial);
  for (const file of ['clock', 'dirty', 'polls', 'pushes']) writeFileSync(join(dir, file), '0\n');
  writeFileSync(join(dir, 'trace'), '');
  const env = {
    // Empty PATH and an allowlist of shell functions prevent accidental real operations.
    PATH: '/nonexistent-worker-fixture-path', MODE: 'live', GITHUB_REF_NAME: 'fixture-only', GH_RC: '0',
    BOT_FACEBOOK_REPLY: 'off', BOT_ACTIVE_START: '22', MAXSECS: '100',
    PREFLIGHT_LEAD: '300', FATAL_COOLDOWN: '1800', CAIRO_HOUR: '14', CAIRO_MINUTE: '0',
    LIVE_SECONDS: '0', LIVE_RC: '0', SYNC_SECONDS: '0', CALC_SECONDS: '0',
    PREFLIGHT_SECONDS: '0', OVERSLEEP_SECONDS: '0', FAIL_PUSH_FROM: '0', ...overrides,
  };
  try {
    const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail'], {
      input: fakes + '\n' + shell, cwd: dir, env, encoding: 'utf8', timeout: 5000,
    });
    assert.ifError(result.error);
    const events = readFileSync(join(dir, 'trace'), 'utf8').trim().split('\n').map(line => {
      const [kind, time, args = ''] = line.split('|'); return { kind, time: Number(time), args };
    });
    assert.ok(!events.some(e => /^(unexpected|invalid|unsynced)/.test(e.kind)), result.stdout + result.stderr);
    const state = readFileSync(join(dir, 'state.json'), 'utf8');
    const remote = readFileSync(join(dir, 'remote'), 'utf8');
    assert.equal(JSON.parse(state).pending.creationId, 'saved-container', 'never discard pending state');
    const polls = events.filter(e => e.kind === 'npm' && e.args === 'run live');
    const start = Number(env.SYNC_SECONDS); // Initial sync occurs before the production start clock.
    for (const poll of polls) assert.ok(poll.time - start < Number(env.MAXSECS), 'deadline before every poll');
    return { ...result, events, polls, state, remote, start, env };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function normal(result, expectedPolls, expectedSleeps) {
  assert.equal(result.status, Number(result.env.LIVE_RC) ? 1 : 0, result.stdout + result.stderr);
  assert.equal(result.polls.length, expectedPolls);
  assert.deepEqual(result.events.filter(e => e.kind === 'sleep').map(e => Number(e.args)), expectedSleeps);
  assert.equal(result.remote, result.state, 'all completed poll state is pushed');
  assert.equal(JSON.parse(result.state).generation, expectedPolls, 'no skipped completed state');
  const dispatches = result.events.filter(e => e.kind === 'gh');
  assert.equal(dispatches.length, 1, 'one normal successor dispatch');
  const index = result.events.indexOf(dispatches[0]);
  assert.equal(result.events[index - 1].kind, 'git');
  assert.equal(result.events[index - 1].args, 'push', 'final successful sync directly precedes handoff');
  for (const sleep of result.events.filter(e => e.kind === 'sleep')) {
    assert.ok(Number(sleep.args) > 0, 'never busy-loop with zero or negative sleep');
    assert.ok(Number(sleep.args) <= Number(result.env.MAXSECS) - (sleep.time - result.start), 'sleep fits remaining budget');
  }
}

normal(fixture({ MAXSECS: '0' }), 0, []);
normal(fixture({ MAXSECS: '1' }), 1, [1]);
normal(fixture(), 1, [100]);
normal(fixture({ MAXSECS: '950', CAIRO_HOUR: '23', LIVE_SECONDS: '60', SYNC_SECONDS: '20' }), 1, [870]);
normal(fixture({ MAXSECS: '2700', CAIRO_HOUR: '23' }), 3, [900, 900, 900]);
normal(fixture({ OVERSLEEP_SECONDS: '7' }), 1, [100]);
normal(fixture({ CALC_SECONDS: '120' }), 1, []);
normal(fixture({ LIVE_RC: '1' }), 1, [100]);
console.log('PASS expired, 1s, clipped, normal cadence, sync cost, oversleep, calculation delay and error exit');

const clippedPreflight = fixture({ MAXSECS: '120', CAIRO_HOUR: '21', CAIRO_MINUTE: '50' });
normal(clippedPreflight, 1, [120]);
assert.ok(!clippedPreflight.events.some(e => e.kind === 'npm' && e.args === 'run preflight'));
const oversleptPreflight = fixture({ MAXSECS: '400', CAIRO_HOUR: '21', CAIRO_MINUTE: '50', OVERSLEEP_SECONDS: '150' });
normal(oversleptPreflight, 1, [300]);
assert.ok(!oversleptPreflight.events.some(e => e.kind === 'npm' && e.args === 'run preflight'),
  'an overdue wake cannot start a preflight even when the original nap was not clipped');
const preflightBudget = fixture({ MAXSECS: '400', CAIRO_HOUR: '21', CAIRO_MINUTE: '50', PREFLIGHT_SECONDS: '150' });
normal(preflightBudget, 1, [300]);
assert.equal(preflightBudget.events.filter(e => e.kind === 'npm' && e.args === 'run preflight').length, 1);
console.log('PASS clipped or overdue preflight is skipped; preflight consuming budget prevents a new poll');

const failedFinalSync = fixture({ FAIL_PUSH_FROM: '3' });
assert.equal(failedFinalSync.status, 1);
assert.equal(failedFinalSync.polls.length, 1);
assert.ok(!failedFinalSync.events.some(e => e.kind === 'gh'), 'failed final sync must block handoff');
assert.equal(failedFinalSync.remote, failedFinalSync.state, 'previous checkpoint remains intact');
console.log('PASS final sync failure keeps saved state and never hands off');

const calls = (result, kind) => result.events.filter(event => event.kind === kind);
const sleeps = result => calls(result, 'sleep').map(event => Number(event.args));
const fatal = fixture({ LIVE_RC: '3' });
assert.equal(fatal.status, 1);
assert.equal(fatal.polls.length, 1);
assert.deepEqual(sleeps(fatal), [1800]);
assert.equal(calls(fatal, 'gh').length, 1);
assert.ok(fatal.events.indexOf(calls(fatal, 'gh')[0]) < fatal.events.indexOf(calls(fatal, 'sleep')[0]),
  'fatal dispatch still precedes its unchanged cooldown');
assert.equal(fatal.remote, fatal.state);
const persistenceFailure = fixture({ LIVE_RC: '4' });
assert.equal(persistenceFailure.status, 4);
assert.equal(persistenceFailure.polls.length, 1);
assert.deepEqual(sleeps(persistenceFailure), []);
assert.equal(calls(persistenceFailure, 'gh').length, 0);

for (const [overrides, polls] of [
  [{ FAIL_PUSH_FROM: '1' }, 0], // Initial sync.
  [{ FAIL_PUSH_FROM: '2' }, 1], // Per-poll sync.
  [{ FAIL_PUSH_FROM: '2', LIVE_RC: '3' }, 1], // Fatal path sync.
]) {
  const failure = fixture(overrides);
  assert.equal(failure.status, 1);
  assert.equal(failure.polls.length, polls);
  assert.deepEqual(sleeps(failure), [3, 3, 3], 'existing sync retry sleeps are unchanged');
  assert.equal(calls(failure, 'gh').length, 0);
}
const sixFailures = fixture({ MAXSECS: '10000', CAIRO_HOUR: '23', LIVE_RC: '1' });
assert.equal(sixFailures.status, 1);
assert.equal(sixFailures.polls.length, 6);
assert.deepEqual(sleeps(sixFailures), [900, 900, 900, 900, 900]);
assert.equal(calls(sixFailures, 'gh').length, 0);
assert.equal(sixFailures.remote, sixFailures.state);
const dry = fixture({ MODE: 'dry' });
assert.equal(dry.status, 0);
assert.equal(dry.polls.length, 0);
assert.deepEqual(sleeps(dry), []);
assert.equal(calls(dry, 'gh').length, 0);
assert.equal(calls(dry, 'git').length, 0);
assert.deepEqual(calls(dry, 'npm').map(event => event.args), ['run dry', 'run fb:dry']);
const dispatchFailure = fixture({ GH_RC: '17' });
assert.equal(dispatchFailure.status, 17);
assert.equal(dispatchFailure.polls.length, 1);
assert.equal(dispatchFailure.remote, dispatchFailure.state);
assert.equal(calls(dispatchFailure, 'gh').length, 1);
normal(fixture({ LIVE_SECONDS: '101' }), 1, []);
console.log('PASS fatal cooldown, persistence halt, sync failures, six-error stop, dry mode, dispatch failure and completed over-budget poll checkpoint');
console.log('PASS actual workflow lifecycle shell; no long sleeps, provider calls or production state access');
