import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
import { bytes, deltas, flagFixture, leftFixture } from './training-fixtures.mjs';

const source = async (name) => readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
const asModule = (text) => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(text, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
}).outputText).toString('base64')}`;
const fields = asModule(await source('counterFields'));
const { TrainingReplay, trainingModes, parseTrainingFile, hasTrainingMetadata, packTrainingFile, suggestTrainingMetadata } = await import(asModule(
  (await source('trainingReplay')).replace("'./counterFields'", JSON.stringify(fields))));
const { chordCell, pressedBackground } = await import(asModule(await source('boardPress')));
const open = (file) => new TrainingReplay('test.json', parseTrainingFile(bytes(file)));

test('left training starts with a release, restores presses, seeks both ways and completes all cells', () => {
  const replay = open(leftFixture());
  assert.equal(replay.completed, true);
  assert.equal(replay.frameAt(0).values.solved, 1);
  assert.equal(replay.frameAt(0).values.remaining, 31);
  assert.equal(replay.frameAt(0).values.ces, 0);
  const pressed = replay.frameAt(15);
  assert.deepEqual(pressed.press, { row: 0, column: 1, chord: false });
  const background = pressedBackground(pressed.board, chordCell(pressed));
  assert.equal(background[0][1], true);
  assert.equal(background[0][2], false, 'single press must not depress neighbors');
  assert.equal(replay.frameAt(20).board[0][1], 0);
  assert.equal(replay.frameAt(620).values.remaining, 0);
  assert.equal(replay.frameAt(620).values.ces, 50);
  assert.ok(Number.isNaN(replay.frameAt(620).values.bbbv));
  assert.equal(replay.frameAt(0).board[0][1], 10);
  assert.equal(replay.frameAt(620).trace.endIndex, 63);
  assert.equal(replay.clickEvents.filter((event) => event.changed).length, 32);
});

test('flag training preserves flag toggles, 3x3 press and first-release chord timing', () => {
  const replay = open(flagFixture());
  assert.equal(replay.completed, true);
  assert.equal(replay.frameAt(0).board[0][0], 11);
  assert.equal(replay.frameAt(19).values.remaining, 4);
  const pressed = replay.frameAt(20);
  assert.deepEqual(pressed.press, { row: 1, column: 1, chord: true });
  assert.equal(pressedBackground(pressed.board, chordCell(pressed))[0][0], false, 'flag stays raised');
  assert.equal(pressedBackground(pressed.board, chordCell(pressed))[2][2], true);
  assert.equal(replay.frameAt(40).values.remaining, 3);
  assert.equal(replay.frameAt(40).board[2][2], 0);
  assert.equal(replay.frameAt(40).press, null);
  assert.equal(replay.frameAt(340).values.remaining, 0);
  assert.equal(replay.frameAt(0).values.remaining, 4);
  assert.equal(replay.clickEvents.filter((event) => event.kind === 'double' && event.changed).length, 4);
});

test('wrong flags explode the mine and mark incorrect flags on failed chords', () => {
  const file = flagFixture();
  file.replay.events = deltas([[0, 1.5, .5, 3], [20, 1.5, 1.5, 1], [40, 1.5, 1.5, 2]]);
  const replay = open(file);
  assert.equal(replay.completed, false);
  assert.equal(replay.frameAt(40).board[0][0], 15);
  assert.equal(replay.frameAt(40).board[0][1], 14);
  assert.equal(replay.frameAt(40).values.remaining, 4);
});

test('special cancellation at an insertion index prevents the following release from triggering a chord', () => {
  const file = flagFixture();
  file.replay.events = deltas([[0, .5, .5, 3], [20, 1.5, 1.5, 1], [25, 1.5, 1.5, 2]]);
  file.replay.specialEvents = [[25, 2, 0]];
  const replay = open(file);
  assert.equal(replay.frameAt(24).press.chord, true);
  assert.equal(replay.frameAt(25).press, null);
  assert.equal(replay.frameAt(25).values.remaining, 4);
  assert.equal(replay.clickEvents.length, 1);
});

test('equal millisecond events keep their insertion order and final cursor', () => {
  const file = flagFixture();
  file.scoreMs = 1;
  file.replay.events = deltas([[0, .5, .5, 3], [0, 1.5, 1.5, 1], [0, 1.5, 1.5, 2], [0, 2.5, 1.5, 4]]);
  const replay = open(file);
  assert.equal(replay.frameAt(0).values.remaining, 3);
  assert.deepEqual(replay.frameAt(0).cursor, { x: 2.5, y: 1.5 });
});

test('out-of-board coordinates update mouse state without opening cells', () => {
  const file = leftFixture();
  file.replay.events = deltas([[0, .5, .5, 2], [10, -1, 0, 1], [20, -1, 0, 2], [30, 1.5, .5, 2]]);
  const replay = open(file);
  assert.equal(replay.frameAt(10).press, null);
  assert.equal(replay.frameAt(30).values.solved, 1);
  assert.equal(replay.frameAt(10).cursor.x, -1);
});

test('legacy v0 replays discard persisted derived state and use the native reference size', () => {
  const file = leftFixture();
  file.replay = { initialBoard: Array.from({ length: 8 }, (_, row) => Array(8).fill(row < 4 ? 10 : 16)),
    events: [
      { timeMs: 0, row: .5, column: .5, action: 'lr', trigger: null },
      { timeMs: 10, row: .5, column: 1.5, action: 'lc' },
      { timeMs: 12, cancelled: true },
      { timeMs: 15, row: .5, column: 1.5, action: 'lr', trigger: 'left' },
    ] };
  const replay = open(file);
  assert.equal(replay.frameAt(620).values.solved, 1);
  assert.equal(replay.frameAt(0).values.pix_size, 32);
});

test('raw payloads require metadata and a packed file preserves it when reopened for export', () => {
  const fixture = leftFixture();
  const raw = parseTrainingFile(bytes(fixture.replay));
  assert.equal(hasTrainingMetadata(raw), false);
  assert.throws(() => new TrainingReplay('raw.json', raw), /需要游戏/);
  const metadata = suggestTrainingMetadata(raw);
  assert.deepEqual(metadata, { game: fixture.game, rankingKey: fixture.rankingKey, scoreMs: fixture.scoreMs });
  const packed = parseTrainingFile(packTrainingFile(raw, metadata));
  assert.equal(hasTrainingMetadata(packed), true);
  assert.equal(new TrainingReplay('raw.json', packed).frameAt(620).values.remaining, 0);
  const local = parseTrainingFile(bytes({ game: fixture.game, mode: { key: 'b', density: 50 }, scoreMs: 620, replay: fixture.replay }));
  assert.equal(local.rankingKey, fixture.rankingKey);
});

test('malformed versions, deltas, dimensions, modes and special ordering fail explicitly', () => {
  const cases = [
    (file) => { file.replay.version = 2; },
    (file) => { file.replay.version = null; },
    (file) => { delete file.replay.cellSize; },
    (file) => { file.replay.events[0][0] = -1; },
    (file) => { file.replay.events[0][3] = 5; },
    (file) => { file.replay.events[1][1] = Number.MAX_SAFE_INTEGER; },
    (file) => { file.replay.initialBoard = 'AAAAAP////9'; },
    (file) => { file.replay.specialEvents = [[10, 999, 0]]; },
    (file) => { file.replay.specialEvents = [[100, 1, 0]]; },
    (file) => { file.scoreMs = 1; },
    (file) => { file.rankingKey = 'left-click-b-75-v1'; },
    (file) => { file.game = 'reaction'; },
  ];
  for (const mutate of cases) { const file = leftFixture(); mutate(file); assert.throws(() => open(file), /小游戏录像/); }
  assert.throws(() => parseTrainingFile(bytes([])), /JSON 对象/);
  const flags = flagFixture(); flags.replay.initialBoard[1] = [1, 1, 0];
  assert.throws(() => open(flags), /重叠/);
});

test('all nine left training modes reconstruct completion with the correct dimensions and density', () => {
  for (const mode of trainingModes.filter((mode) => mode.game === 'left-click')) {
    const mines = new Uint8Array(mode.rows * mode.columns / 8);
    for (let index = mode.total; index < mode.rows * mode.columns; index++) mines[index >> 3] |= 1 << (7 - index % 8);
    const events = [[0, .5, .5, 2]];
    for (let index = 1; index < mode.total; index++) {
      const column = index % mode.columns + .5, row = Math.floor(index / mode.columns) + .5;
      events.push([index * 10 - 5, column, row, 1], [index * 10, column, row, 2]);
    }
    const file = { game: mode.game, rankingKey: mode.key, scoreMs: (mode.total - 1) * 10,
      replay: { version: 1, cellSize: null, initialBoard: Buffer.from(mines).toString('base64').replace(/=+$/, ''), events: deltas(events), specialEvents: [] } };
    const replay = open(file);
    assert.equal(replay.rows, mode.rows); assert.equal(replay.columns, mode.columns);
    assert.equal(replay.completed, true, mode.key);
    assert.equal(replay.frameAt(replay.durationMs).values.solved, mode.total, mode.key);
    assert.equal(replay.frameAt(replay.durationMs).values.mine_num, mode.mines, mode.key);
  }
});

test('intermediate flag training reconstructs all fifteen questions, including alternate release order', () => {
  const questions = Array.from({ length: 15 }, (_, index) => [Math.floor(index / 5) * 4 + 1, index % 5 * 3 + 1, 0]);
  const events = questions.flatMap(([row, column], index) => [
    [index * 50, column - .5, row - .5, 3], [index * 50 + 10, column + .5, row + .5, 1],
    [index * 50 + 20, column + .5, row + .5, 4],
    ...(index < 14 ? [[index * 50 + 25, column + .5, row + .5, 2]] : []),
  ]);
  const file = { game: 'flag-chord', rankingKey: 'flag-chord-i-v1', scoreMs: 720,
    replay: { version: 1, cellSize: 32, initialBoard: questions, events: deltas(events), specialEvents: [] } };
  const replay = open(file);
  assert.equal(replay.completed, true);
  assert.equal(replay.frameAt(720).values.solved, 15);
  assert.equal(replay.frameAt(0).values.remaining, 15);
  assert.equal(replay.frameAt(20).values.remaining, 14);
  assert.equal(replay.frameAt(20).press, null);
  // The original v0 format uses full boards and object events.
  const board = Array.from({ length: 16 }, () => Array(16).fill(0));
  for (const [row, column] of questions) {
    for (let r = row - 1; r <= row + 1; r++) for (let c = column - 1; c <= column + 1; c++) board[r][c] = 10;
    board[row][column] = 1; board[row - 1][column - 1] = 16;
  }
  file.replay = { initialBoard: board, events: events.map(([timeMs, column, row, action]) => ({ timeMs, row, column, action: ['mv', 'lc', 'lr', 'rc', 'rr'][action] })) };
  const legacy = open(file);
  assert.deepEqual(legacy.frameAt(720).board, replay.frameAt(720).board);
  assert.deepEqual(suggestTrainingMetadata(parseTrainingFile(bytes(file.replay))), {
    game: 'flag-chord', rankingKey: file.rankingKey, scoreMs: 720,
  });
});
