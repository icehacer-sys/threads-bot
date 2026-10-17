// Late sweep selection, timing and once-per-cap-day marker. Pure functions plus a temp state file only.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.ANTHROPIC_API_KEY = 'offline-fixture';
process.env.BOT_USAGE_LOG = 'off';
const { lateSweepKind, windowCloseAfter, lateSweepWindowOpen, selectLateSweep, LATE_SWEEP_NOTE } = await import('../src/late-sweep');
const { config } = await import('../src/config');

// What gets swept: genuine case questions and personal or family stories. Never jokes, politics or AI.
const questions = ['What causes these diverticulosis pouches to form? Was it due to poor diet?', 'So what did the ct scan show? Where was the fx?',
  'Did the patient remember fracturing the base of his skull?', "Regardless of the hydronephrisis, where's the blockage coming from?",
  'Patient didn\'t have any pain?', 'could this be a complication of BPH?', 'How long can someone live with an AAA like that?'];
for (const q of questions) assert.equal(lateSweepKind(q), 'question', q);
const stories = ['My late husband passed away with a stroke, but he had ESRD for years', 'My dad had one of these repaired in 2019 and he is still golfing',
  'I had a CSF leak after a fall and it took months to stop', 'Survivor here. Mine was found by accident on a scan'];
for (const s of stories) assert.equal(lateSweepKind(s), 'story', s);
for (const n of ['lol', 'Wow', 'Triple A???', 'A touch of the MAGAs?', 'Patient is a White House. Spokesperson?', 'AI slop', 'Is this AI generated slop?',
  'Did he eat a cassette tape lol?', 'Truly empty headed.', 'Thanos Snapped it seems', 'Sigmoid diverticulosis'])
  assert.equal(lateSweepKind(n), undefined, n);
assert.match(LATE_SWEEP_NOTE, /Skip jokes, banter, political remarks and anything about AI/);
assert.ok(!/,/.test(LATE_SWEEP_NOTE.replace(/jokes, banter, political/, '')), 'note follows the house no-comma style apart from its list');

// Window close: the first 10:00 Cairo after the 22:00 post (Cairo is UTC+3 in October 2026).
const post = '2026-10-16T19:00:00Z'; // 22:00 Cairo
assert.equal(windowCloseAfter(post, 10, 'Africa/Cairo').toISOString(), '2026-10-17T07:00:00.000Z');
assert.equal(windowCloseAfter('2026-10-17T06:59:00Z', 10, 'Africa/Cairo').toISOString(), '2026-10-17T07:00:00.000Z', 'same morning');
assert.equal(windowCloseAfter('2026-10-17T07:00:00Z', 10, 'Africa/Cairo').toISOString(), '2026-10-18T07:00:00.000Z', 'strictly after');
assert.equal(windowCloseAfter('2026-01-10T20:00:00Z', 10, 'Africa/Cairo').toISOString(), '2026-01-11T08:00:00.000Z', 'winter offset UTC+2');

// Sweep slot: 21:30 until the 22:00 open, Cairo time.
const cairo = (iso: string) => lateSweepWindowOpen(new Date(iso), '21:30', 22, 'Africa/Cairo');
assert.equal(cairo('2026-10-17T18:29:00Z'), false, '21:29');
assert.equal(cairo('2026-10-17T18:30:00Z'), true, '21:30');
assert.equal(cairo('2026-10-17T18:59:00Z'), true, '21:59');
assert.equal(cairo('2026-10-17T19:00:00Z'), false, '22:00 belongs to the window');
assert.equal(cairo('2026-10-17T09:00:00Z'), false, 'noon');
assert.equal(lateSweepWindowOpen(new Date('2026-10-17T18:45:00Z'), 'nonsense', 22, 'Africa/Cairo'), false, 'bad config never sweeps');

// Selection: after-window questions first, then stories, then in-window leftovers with a recorded skip.
const me = 'mdnoteslab';
const close = windowCloseAfter(post, 10, 'Africa/Cairo');
const c = (id: string, text: string, at: string, extra: object = {}) => ({ id, text, timestamp: at, username: `u${id}`, replied_to: { id: 'post' }, ...extra });
const comments = [
  c('late-story', 'My dad had one of these repaired in 2019 and he is still golfing', '2026-10-17T12:00:00Z'),
  c('late-q-new', 'How long can someone live with an AAA like that?', '2026-10-17T15:00:00Z'),
  c('late-q-old', 'Patient didn\'t have any pain?', '2026-10-17T09:00:00Z'),
  c('late-joke', 'Did he eat a cassette tape lol?', '2026-10-17T10:00:00Z'),
  c('late-political', 'A touch of the MAGAs?', '2026-10-17T10:00:00Z'),
  c('in-skipped', 'could this be a complication of BPH?', '2026-10-16T20:00:00Z'),
  c('in-unseen', 'What causes these pouches to form?', '2026-10-16T21:00:00Z'),
  c('late-replied', 'Where was the fracture exactly?', '2026-10-17T11:00:00Z'),
  c('self', 'Answer: Infrarenal AAA and what it means?', '2026-10-17T11:00:00Z', { username: me }),
  c('late-q-new', 'duplicate id must not be swept twice?', '2026-10-17T16:00:00Z'),
];
const replied = new Set(['late-replied']);
const skipped = new Set(['in-skipped']);
const picked = selectLateSweep(comments as never, { me, windowClose: close, max: 15, eligible: (x) => !replied.has(x.id), hadSkip: (id) => skipped.has(id) });
assert.deepEqual(picked.map((x) => x.id), ['late-q-old', 'late-q-new', 'in-skipped', 'late-story']);
assert.ok(!picked.some((x) => x.id === 'in-unseen'), 'in-window comments without a recorded skip are left to the overnight run');
assert.equal(selectLateSweep(comments as never, { me, windowClose: close, max: 2, eligible: () => true, hadSkip: () => false }).length, 2, 'hard cap');
assert.equal(selectLateSweep(comments as never, { me, windowClose: close, max: 0, eligible: () => true, hadSkip: () => false }).length, 0);
assert.equal(selectLateSweep(comments as never, { me, windowClose: close, max: 15, eligible: () => false, hadSkip: () => true }).length, 0, 'caller eligibility (replied, owner review, thread limit) always wins');

// Config: off by default with a hard cap of at most 20; reply.yml turns it on.
assert.equal(config.lateSweep, false, 'off unless BOT_LATE_SWEEP=on');
assert.equal(config.lateSweepAt, '21:30');
assert.equal(config.lateSweepMax, 15);
const workflow = readFileSync(new URL('../.github/workflows/reply.yml', import.meta.url), 'utf8');
assert.match(workflow, /BOT_LATE_SWEEP: "on"/);
assert.match(workflow, /BOT_LATE_SWEEP_AT: "21:30"/);
assert.match(workflow, /LATE_SWEEP_LEAD: "1800"/, 'the worker poll lands at 21:30 for a 22:00 open');

// Once per cap-day, persisted in state without touching other history.
const dir = mkdtempSync(join(tmpdir(), 'late-sweep-'));
config.stateFile = join(dir, 'state.json');
writeFileSync(config.stateFile, JSON.stringify({ repliedCommentIds: ['kept'], answeredPostIds: [], postCounts: {}, daily: { date: '2020-01-01', count: 0 }, skippedCommentIds: ['s1'], skipStrikes: { s2: 1 } }));
const { State } = await import('../src/state');
const state = new State();
assert.equal(state.lateSweepDoneToday(), false);
assert.equal(state.hasSkipRecord('s1'), true); assert.equal(state.hasSkipRecord('s2'), true); assert.equal(state.hasSkipRecord('s3'), false);
state.markLateSweepDone(4);
assert.equal(new State().lateSweepDoneToday(), true, 'survives a restart on the same cap-day');
const saved = JSON.parse(readFileSync(config.stateFile, 'utf8'));
assert.equal(saved.lateSweep.replies, 4); assert.deepEqual(saved.repliedCommentIds, ['kept']);
writeFileSync(config.stateFile, JSON.stringify({ ...saved, lateSweep: { date: '2020-01-01', replies: 3 } }));
assert.equal(new State().lateSweepDoneToday(), false, 'a new cap-day sweeps again');
writeFileSync(config.stateFile, JSON.stringify({ ...saved, lateSweep: { date: 7 } }));
assert.throws(() => new State(), /refusing to reset/, 'malformed sweep marker refuses to load');
console.log('PASS late sweep: questions and stories only, after-window first, in-window only with a recorded skip, hard cap, 21:30-22:00 Cairo slot, window close with DST, once per cap-day.');
