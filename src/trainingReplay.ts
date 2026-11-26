// Derived from eee555/open-minesweeper, commit 6795eef09bfe16eacf18a871402a92fe89d36902.
// Copyright (c) 2023 eee555. MIT license: licenses/open-minesweeper.txt.
import { valueNames } from './counterFields';
import type { BoardPress, ClickEvent, Frame, PlayableReplay, Values } from './replay';
import type { MouseTraceEvent } from '@putianyi888/vue3-minesweeper-board';

export type TrainingGame = 'left-click' | 'flag-chord';
export type TrainingMode = { game: TrainingGame; key: string; label: string; rows: number; columns: number; total: number; mines: number };
const levels = [
  { key: 'b', label: '初级', rows: 8, columns: 8 },
  { key: 'i', label: '中级', rows: 16, columns: 16 },
  { key: 'e', label: '高级', rows: 16, columns: 30 },
];
export const trainingModes: TrainingMode[] = [...levels.flatMap((level) => [50, 75, 87.5].map((density) => ({
  game: 'left-click' as const, key: `left-click-${level.key}-${density}-v1`,
  label: `${level.label} · ${density === 50 ? '1/2' : density === 75 ? '3/4' : '7/8'}`,
  rows: level.rows, columns: level.columns, total: level.rows * level.columns * (1 - density / 100),
  mines: level.rows * level.columns * density / 100,
}))), ...levels.slice(0, 2).map((level, index) => ({
  game: 'flag-chord' as const, key: `flag-chord-${level.key}-v1`, label: level.label,
  rows: level.rows, columns: level.columns, total: index === 0 ? 4 : 15, mines: index === 0 ? 4 : 15,
}))];

export interface TrainingFile {
  recording: Record<string, unknown>;
  game?: TrainingGame;
  rankingKey?: string;
  scoreMs?: number;
  playerIdentifier: string;
}
export type TrainingMetadata = { game: TrainingGame; rankingKey: string; scoreMs: number };
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`小游戏录像：${message}`);
}
function object(value: unknown): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), '应为 JSON 对象。');
  return value as Record<string, unknown>;
}
function integer(value: unknown, nonnegative = false): number {
  requireValue(typeof value === 'number' && Number.isSafeInteger(value) && (!nonnegative || value >= 0), '时间、坐标和事件编号须为有效整数。');
  return value;
}
function tuple(value: unknown, length: number): number[] {
  requireValue(Array.isArray(value) && value.length === length, '事件或棋盘元组长度无效。');
  return value.map((item: unknown) => integer(item));
}

export function parseTrainingFile(bytes: ArrayBuffer): TrainingFile {
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('小游戏录像的 JSON 或 UTF-8 编码无效。'); }
  const data = object(parsed);
  const recording = object(data.replay ?? data);
  const rankingKey = data.rankingKey ?? data.ranking_key;
  const keyGame = typeof rankingKey === 'string' ? trainingModes.find((mode) => mode.key === rankingKey)?.game : undefined;
  const game = data.game ?? keyGame;
  requireValue(game === undefined || game === 'left-click' || game === 'flag-chord', '目前只支持左键训练和标双训练。');
  let resolvedKey = rankingKey;
  if (resolvedKey === undefined && data.mode !== undefined && game !== undefined) {
    const mode = object(data.mode);
    resolvedKey = mode.rankingKey ?? (game === 'left-click' ? `${game}-${String(mode.key)}-${String(mode.density)}-v1` : `${game}-${String(mode.key)}-v1`);
  }
  requireValue(resolvedKey === undefined || typeof resolvedKey === 'string' && trainingModes.some((mode) => mode.key === resolvedKey && (game === undefined || mode.game === game)), '游戏模式无效或尚未支持。');
  const scoreMs = data.scoreMs ?? data.score;
  if (scoreMs !== undefined) requireValue(integer(scoreMs, true) > 0, '总时长须为正整数毫秒。');
  const playerIdentifier = data.playerIdentifier ?? '';
  requireValue(typeof playerIdentifier === 'string', '玩家标识须为字符串。');
  requireValue(Array.isArray(recording.events) && recording.initialBoard !== undefined, '缺少初始棋盘或事件数组。');
  return { recording, game, rankingKey: resolvedKey as string | undefined, scoreMs: scoreMs as number | undefined, playerIdentifier };
}

export function hasTrainingMetadata(file: TrainingFile): file is TrainingFile & TrainingMetadata {
  return file.game !== undefined && file.rankingKey !== undefined && file.scoreMs !== undefined;
}
export function packTrainingFile(file: TrainingFile, metadata: TrainingMetadata): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify({ ...metadata, playerIdentifier: file.playerIdentifier, replay: file.recording })).buffer;
}
/** Suggestions are editable in the import dialog; they never silently supply metadata. */
export function suggestTrainingMetadata(file: TrainingFile): TrainingMetadata {
  const { recording } = file;
  const board = recording.initialBoard;
  const flagBoard = Array.isArray(board) && (recording.version === 1
    ? board.every((row: unknown) => Array.isArray(row) && row.length === 3)
    : board.some((row: unknown) => Array.isArray(row) && row.some((cell: unknown) => cell === 1)));
  const game = file.game ?? (flagBoard ? 'flag-chord' : 'left-click');
  const matching = trainingModes.filter((mode) => mode.game === game);
  const mode = matching.find((mode) => mode.key === file.rankingKey) ?? matching.find((mode) =>
    typeof board === 'string' ? board.length === Math.ceil(mode.rows * mode.columns / 6)
      : Array.isArray(board) && (game === 'flag-chord' && recording.version === 1 ? board.length === mode.total : board.length === mode.rows)) ?? matching[0];
  let time = 0;
  let end = 0;
  for (const item of recording.events as unknown[]) {
    if (Array.isArray(item) && typeof item[0] === 'number' && item[0] >= 0) end = time += item[0];
    else if (item && typeof item === 'object' && 'timeMs' in item && typeof item.timeMs === 'number') end = Math.max(end, item.timeMs);
  }
  time = 0;
  if (Array.isArray(recording.specialEvents)) for (const item of recording.specialEvents as unknown[]) {
    if (Array.isArray(item) && typeof item[0] === 'number' && item[0] >= 0) end = Math.max(end, time += item[0]);
  }
  return { game, rankingKey: mode.key, scoreMs: file.scoreMs ?? (Number.isSafeInteger(end) ? Math.max(1, end) : 1) };
}

const directions = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]] as const;
type Action = 'left' | 'right' | 'double';
const actions = ['mv', 'lc', 'lr', 'rc', 'rr'] as const;
type MouseAction = typeof actions[number];
type MouseState = 'idle' | 'left' | 'right' | 'both' | 'chord-left' | 'chord-right';
const transitions: Record<MouseState, Partial<Record<MouseAction, [MouseState, Action?]>>> = {
  idle: { lc: ['left'], rc: ['right', 'right'] },
  left: { lr: ['idle', 'left'], rc: ['both'] },
  right: { rr: ['idle'], lc: ['both'] },
  both: { lr: ['chord-right', 'double'], rr: ['chord-left', 'double'] },
  'chord-left': { lr: ['idle'], rc: ['both'] },
  'chord-right': { rr: ['idle'], lc: ['both'] },
};
type Event = MouseTraceEvent & { timeMs: number; trigger: Action | null; press: BoardPress | null; positionKnown: boolean };

function readInitialBoard(mode: TrainingMode, source: unknown, legacy: boolean): number[][] {
  if (legacy) {
    requireValue(Array.isArray(source) && source.length === mode.rows, '初始棋盘行数不符。');
    const board = source.map((row: unknown) => {
      requireValue(Array.isArray(row) && row.length === mode.columns, '初始棋盘列数不符。');
      return row.map((cell: unknown) => integer(cell));
    });
    if (mode.game === 'left-click') requireValue(board.flat().every((cell) => cell === 10 || cell === 16), '左键训练初始棋盘编码无效。');
    else {
      const questions: number[][] = [];
      board.forEach((row, r) => row.forEach((cell, c) => {
        if (cell !== 1) return;
        const mines = directions.flatMap(([dr, dc], index) => board[r + dr]?.[c + dc] === 16 ? [index] : []);
        requireValue(mines.length === 1, '每道标双题目须恰好有一颗雷。');
        questions.push([r, c, mines[0]]);
      }));
      const restored = readInitialBoard(mode, questions, false);
      requireValue(board.every((row, r) => row.every((cell, c) => cell === restored[r][c])), '标双初始棋盘布局无效。');
    }
    return board;
  }
  if (mode.game === 'left-click') {
    requireValue(typeof source === 'string' && source.length === Math.ceil(mode.rows * mode.columns / 6) && /^[A-Za-z0-9+/]+$/.test(source), '雷位 Base64 字符串无效。');
    const bytes = atob(source + '='.repeat((4 - source.length % 4) % 4));
    requireValue(bytes.length * 8 === mode.rows * mode.columns && btoa(bytes).replace(/=+$/, '') === source, '雷位字符串长度或补位无效。');
    return Array.from({ length: mode.rows }, (_, row) => Array.from({ length: mode.columns }, (_, column) => {
      const index = row * mode.columns + column;
      return bytes.charCodeAt(index >> 3) & (1 << (7 - index % 8)) ? 16 : 10;
    }));
  }
  requireValue(Array.isArray(source) && source.length === mode.total, '标双题目数量不符。');
  const board = Array.from({ length: mode.rows }, () => Array<number>(mode.columns).fill(0));
  for (const item of source as unknown[]) {
    const [row, column, direction] = tuple(item, 3);
    requireValue(row > 0 && column > 0 && row < mode.rows - 1 && column < mode.columns - 1 && direction >= 0 && direction < 8, '标双题目或雷方向越界。');
    for (let r = row - 1; r <= row + 1; r++) for (let c = column - 1; c <= column + 1; c++) {
      requireValue(board[r][c] === 0, '标双题目不能重叠。');
      board[r][c] = 10;
    }
    board[row][column] = 1;
    const [dr, dc] = directions[direction];
    board[row + dr][column + dc] = 16;
  }
  return board;
}

function decodeEvents(mode: TrainingMode, recording: Record<string, unknown>, legacy: boolean): { events: Event[]; cellSize: number } {
  const size = legacy || recording.cellSize === null ? 32 : integer(recording.cellSize);
  requireValue(size > 0, 'cellSize 须为正整数或 null。');
  requireValue(Array.isArray(recording.events), '缺少鼠标事件数组。');
  const ordinary: { timeMs: number; row: number; column: number; action: MouseAction }[] = [];
  const special: { timeMs: number; index: number }[] = [];
  if (legacy) {
    for (const item of recording.events as unknown[]) {
      const event = object(item);
      const timeMs = integer(event.timeMs, true);
      if (event.cancelled === true) { special.push({ timeMs, index: ordinary.length }); continue; }
      requireValue(typeof event.row === 'number' && Number.isFinite(event.row) && typeof event.column === 'number' && Number.isFinite(event.column), '旧版鼠标坐标无效。');
      requireValue(actions.some((action) => action === event.action), '鼠标事件类型无效。');
      ordinary.push({ timeMs, row: integer(Math.floor(event.row * size)) / size, column: integer(Math.floor(event.column * size)) / size, action: event.action as MouseAction });
    }
  } else {
    let timeMs = 0, x = 0, y = 0;
    for (const item of recording.events as unknown[]) {
      const [dt, dx, dy, action] = tuple(item, 4);
      requireValue(dt >= 0 && action >= 0 && action < actions.length, '时间差或鼠标事件类型无效。');
      timeMs = integer(timeMs + dt, true); x = integer(x + dx); y = integer(y + dy);
      ordinary.push({ timeMs, row: y / size, column: x / size, action: actions[action] });
    }
    requireValue(Array.isArray(recording.specialEvents), '缺少 specialEvents 数组。');
    timeMs = 0;
    for (const item of recording.specialEvents as unknown[]) {
      const [dt, index, type] = tuple(item, 3);
      requireValue(dt >= 0 && type === 0, '特殊事件类型或时间差无效。');
      special.push({ timeMs: timeMs = integer(timeMs + dt, true), index });
    }
  }
  requireValue(ordinary.every((event, index) => index === 0 || event.timeMs >= ordinary[index - 1].timeMs), '鼠标事件时间顺序无效。');
  special.forEach((event, index) => {
    const i = event.index;
    requireValue(i >= 0 && i <= ordinary.length && (index === 0 || i >= special[index - 1].index && event.timeMs >= special[index - 1].timeMs), '特殊事件插入顺序无效。');
    requireValue((i === 0 || ordinary[i - 1].timeMs <= event.timeMs) && (i === ordinary.length || event.timeMs <= ordinary[i].timeMs), '特殊事件与鼠标事件时间冲突。');
  });
  let state: MouseState = mode.game === 'left-click' ? 'left' : 'idle';
  const events: Event[] = [];
  let specialIndex = 0;
  for (let index = 0; index <= ordinary.length; index++) {
    while (special[specialIndex]?.index === index) {
      const event = special[specialIndex++];
      state = 'idle';
      const previous = ordinary[index - 1];
      events.push({ timeMs: event.timeMs, row: previous?.row ?? 0, column: previous?.column ?? 0, action: 'mv', state: 'uu', press: null, trigger: null, positionKnown: previous !== undefined });
    }
    const event = ordinary[index];
    if (!event) continue;
    const transition: [MouseState, Action?] | undefined = transitions[state][event.action];
    if (transition) state = transition[0];
    const row = Math.floor(event.row), column = Math.floor(event.column);
    const inside = row >= 0 && row < mode.rows && column >= 0 && column < mode.columns;
    events.push({ ...event,
      state: state === 'both' ? 'dd' : state === 'left' || state === 'chord-left' ? 'du' : state === 'right' || state === 'chord-right' ? 'ud' : 'uu',
      press: inside && (state === 'left' || state === 'both') ? { row, column, chord: state === 'both' } : null,
      trigger: inside ? transition?.[1] ?? null : null, positionKnown: true,
    });
  }
  return { events, cellSize: size };
}

type Counts = { left: number; right: number; double: number; lce: number; rce: number; dce: number; path: number };
type Snapshot = { board: number[][]; remaining: number; phase: 'playing' | 'won' | 'lost' };
function boundary<T>(items: T[], time: number, timeOf: (item: T) => number): number {
  let low = 0, high = items.length;
  while (low < high) { const mid = (low + high) >>> 1; if (timeOf(items[mid]) <= time) low = mid + 1; else high = mid; }
  return low;
}

export class TrainingReplay implements PlayableReplay {
  readonly kind: TrainingGame;
  readonly rows: number;
  readonly columns: number;
  readonly durationMs: number;
  readonly format: string;
  readonly playerIdentifier: string;
  readonly completed: boolean;
  readonly clickEvents: ClickEvent[] = [];
  private readonly events: Event[];
  private readonly counts: Counts[] = [];
  private readonly snapshots: (Snapshot & { eventIndex: number })[] = [];
  private readonly mode: TrainingMode;
  private readonly cellSize: number;
  private readonly traceStart: number;

  constructor(readonly filename: string, file: TrainingFile) {
    requireValue(hasTrainingMetadata(file), '需要游戏、模式和总时长。');
    const mode = trainingModes.find((mode) => mode.key === file.rankingKey && mode.game === file.game);
    requireValue(mode, '游戏模式无效。');
    const version = Object.hasOwn(file.recording, 'version') ? integer(file.recording.version, true) : 0;
    requireValue(version === 0 || version === 1, `不支持录像版本 ${version}。`);
    this.mode = mode; this.kind = mode.game; this.rows = mode.rows; this.columns = mode.columns;
    this.durationMs = file.scoreMs; this.playerIdentifier = file.playerIdentifier.trim();
    this.format = `JSON · ${mode.game === 'left-click' ? '左键训练' : '标双训练'} · ${mode.label}`;
    let board = readInitialBoard(mode, file.recording.initialBoard, version === 0);
    if (mode.game === 'left-click') requireValue(board.flat().filter((cell) => cell === 16).length === mode.mines, '雷数与选择的密度不符。');
    const decoded = decodeEvents(mode, file.recording, version === 0);
    this.events = decoded.events; this.cellSize = decoded.cellSize;
    requireValue((this.events.at(-1)?.timeMs ?? 0) <= this.durationMs, '总时长不能早于最后一个事件。');
    this.traceStart = this.events.findIndex((event) => event.positionKnown);
    let remaining = mode.total;
    let phase: Snapshot['phase'] = 'playing';
    const questions: { row: number; column: number; completed: boolean }[] = [];
    board.forEach((row, r) => row.forEach((cell, c) => { if (cell === 1) questions.push({ row: r, column: c, completed: false }); }));
    this.snapshots.push({ eventIndex: -1, board, remaining, phase });
    let counts: Counts = { left: 0, right: 0, double: 0, lce: 0, rce: 0, dce: 0, path: 0 };
    let previous: Event | undefined;
    this.events.forEach((event, index) => {
      counts = { ...counts };
      if (event.positionKnown && previous) counts.path += Math.hypot(event.row - previous.row, event.column - previous.column) * this.cellSize;
      if (event.positionKnown) previous = event;
      const { trigger } = event;
      if (trigger !== null) {
        counts[trigger]++;
        const row = Math.floor(event.row), column = Math.floor(event.column);
        let changed = false;
        let next = board;
        if (phase === 'playing') {
          if (mode.game === 'left-click' && trigger === 'left' && board[row][column] !== 0) {
            next = board.map((cells) => [...cells]);
            if (board[row][column] === 16) { next[row][column] = 15; phase = 'lost'; }
            else { next[row][column] = 0; remaining--; if (remaining === 0) phase = 'won'; }
            changed = true;
          } else if (mode.game === 'flag-chord') {
            const question = questions.find((question) => Math.abs(question.row - row) <= 1 && Math.abs(question.column - column) <= 1);
            if (question && !question.completed) {
              const center = question.row === row && question.column === column;
              if (trigger === 'right' && !center) {
                next = board.map((cells) => [...cells]);
                // Mine visibility is encoded as 16; removing its flag must restore it.
                const mine = this.snapshots[0].board[row][column] === 16;
                next[row][column] = board[row][column] === 11 ? mine ? 16 : 10 : 11;
                changed = true;
              } else if (trigger === 'double' && center) {
                const neighbors = directions.map(([dr, dc]) => [row + dr, column + dc]);
                const flags = neighbors.filter(([r, c]) => board[r][c] === 11);
                if (flags.length === 1) {
                  next = board.map((cells) => [...cells]);
                  const [r, c] = flags[0];
                  if (this.snapshots[0].board[r][c] === 16) {
                    question.completed = true; remaining--;
                    for (const [r, c] of neighbors) if (next[r][c] === 10) next[r][c] = 0;
                    if (remaining === 0) phase = 'won';
                  } else {
                    phase = 'lost';
                    for (const q of questions) for (const [dr, dc] of directions) {
                      const r = q.row + dr, c = q.column + dc;
                      if (next[r][c] === 11 && this.snapshots[0].board[r][c] !== 16) next[r][c] = 14;
                    }
                    const mine = neighbors.find(([r, c]) => this.snapshots[0].board[r][c] === 16)!;
                    next[mine[0]][mine[1]] = 15;
                  }
                  changed = true;
                }
              }
            }
          }
        }
        if (changed) {
          counts[trigger === 'left' ? 'lce' : trigger === 'right' ? 'rce' : 'dce']++;
          board = next;
          this.snapshots.push({ eventIndex: index, board, remaining, phase });
        }
        this.clickEvents.push({ timeMs: event.timeMs, index, kind: trigger, changed });
      }
      this.counts.push(counts);
    });
    this.completed = this.snapshots.at(-1)?.phase === 'won';
  }

  frameAt(ms: number): Frame {
    const timeMs = Math.max(0, Math.min(this.durationMs, ms));
    const index = boundary(this.events, timeMs, (event) => event.timeMs) - 1;
    const event = this.events[index];
    const snapshot = this.snapshots[Math.max(0, boundary(this.snapshots, index, (snapshot) => snapshot.eventIndex) - 1)];
    const counts = this.counts[index] ?? { left: 0, right: 0, double: 0, lce: 0, rce: 0, dce: 0, path: 0 };
    const time = timeMs / 1000;
    const solved = this.mode.total - snapshot.remaining;
    const values = Object.fromEntries(valueNames.map((name) => [name, NaN])) as Values;
    const cl = counts.left + counts.right + counts.double, ce = counts.lce + counts.rce + counts.dce;
    const speed = (count: number) => time > 0 ? count / time : NaN;
    Object.assign(values, counts, { time, duration: this.durationMs / 1000, rtime: this.durationMs / 1000,
      row: this.rows, column: this.columns, mine_num: this.mode.mines, pix_size: this.cellSize,
      total: this.mode.total, remaining: snapshot.remaining, solved, solved_s: speed(solved),
      ces: this.kind === 'left-click' ? time > 0 ? Math.max(0, solved - 1) / time : 0 : NaN,
      cl, ce, cl_s: speed(cl), ce_s: speed(ce), left_s: speed(counts.left), right_s: speed(counts.right), double_s: speed(counts.double),
      lce_s: speed(counts.lce), rce_s: speed(counts.rce), dce_s: speed(counts.dce), path_s: speed(counts.path),
    });
    return { board: snapshot.board, cursor: event?.positionKnown ? { x: event.column, y: event.row } : null,
      chordHeld: event?.press?.chord ?? false, press: event?.press ?? null, values,
      training: { remaining: snapshot.remaining, total: this.mode.total, foregroundOpacity: this.kind === 'left-click' ? 0.5 : 1 },
      trace: { events: this.events, startIndex: this.traceStart < 0 ? this.events.length : this.traceStart, endIndex: index + 1 },
    };
  }
  close() { /* This replay owns only JavaScript data. */ }
}
