import { AvfVideo, EvfVideo, MvfVideo, RmvVideo } from 'ms-toollib';
import type { GameBoard, VideoActionStateRecorder } from 'ms-toollib';
import type { MouseTraceEvent } from '@putianyi888/vue3-minesweeper-board';
import { boardFields } from './counterFields';

const parsers = { avf: AvfVideo, evf: EvfVideo, mvf: MvfVideo, rmv: RmvVideo };
export const clickKinds = ['left', 'right', 'double'] as const;
export type ClickKind = (typeof clickKinds)[number];
export type ClickEvent = { timeMs: number; index: number; kind: ClickKind; changed: boolean };
type Board = number[][];
type Video = InstanceType<(typeof parsers)[keyof typeof parsers]>;
type Cursor = { x: number; y: number };
const totals = ['bbbv_solved', 'left', 'right', 'double', 'lce', 'rce', 'dce', 'path', 'flag'] as const;
type Totals = Record<(typeof totals)[number], number>;

type BoardValues = Pick<Video, (typeof boardFields)[number]>;
export type Values = ReturnType<typeof calculateValues> & { remaining?: number; solved?: number; total?: number; ces?: number; solved_s?: number };
export type BoardPress = { row: number; column: number; chord: boolean };
export type Frame = {
  board: Board; cursor: Cursor | null; chordHeld: boolean; values: Values;
  press?: BoardPress | null;
  training?: { remaining: number; total: number; foregroundOpacity: number };
  trace?: { events: MouseTraceEvent[]; startIndex: number; endIndex: number };
};
export interface PlayableReplay {
  readonly kind: 'minesweeper' | 'left-click' | 'flag-chord';
  readonly filename: string;
  readonly durationMs: number;
  readonly rows: number;
  readonly columns: number;
  readonly clickEvents: ClickEvent[];
  readonly format: string;
  readonly playerIdentifier: string;
  readonly completed: boolean;
  frameAt(ms: number): Frame;
  close(): void;
}
const zero: Totals = { bbbv_solved: 0, left: 0, right: 0, double: 0, lce: 0, rce: 0, dce: 0, path: 0, flag: 0 };
const stnbCoefficients: Partial<Record<number, number>> = { 3: 36, 4: 162, 5: 435 };
const rightHeldStates = new Set([2, 3, 5, 6]);

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : NaN;
}

function calculateValues(totals: Totals, time: number, duration: number, board: BoardValues) {
  const { flag, ...cumulative } = totals;
  const { bbbv_solved, left, right, double, lce, rce, dce, path } = cumulative;
  const cl = left + right + double;
  const ce = lce + rce + dce;
  const bbbv_s = ratio(bbbv_solved, time);
  const timePower = time > 0 ? time ** 1.7 : NaN;
  const iqg = ratio(bbbv_solved, timePower);
  return {
    ...board, ...cumulative, time, duration, rtime: duration, cl, ce, bbbv_s,
    cl_s: ratio(cl, time),
    ce_s: ratio(ce, time),
    left_s: ratio(left, time),
    right_s: ratio(right, time),
    double_s: ratio(double, time),
    lce_s: ratio(lce, time),
    rce_s: ratio(rce, time),
    dce_s: ratio(dce, time),
    flag_s: ratio(flag, time),
    path_s: ratio(path, time),
    corr: ratio(ce, cl),
    ioe: ratio(bbbv_solved, cl),
    thrp: ratio(bbbv_solved, ce),
    etime: ratio(board.bbbv, bbbv_s),
    rqp: time > 0 ? ratio(time * (time - 1), bbbv_solved) : NaN,
    qg: ratio(timePower, bbbv_solved),
    iqg,
    stnb: (stnbCoefficients[board.level] ?? NaN) * iqg,
  };
}

function isChordHeld(mouseState: number): boolean {
  return mouseState === 5 || mouseState === 6;
}

function readBoard(board: GameBoard): Board {
  try { return board.game_board as Board; } finally { board.free(); }
}

function sameBoard(before: Board, after: Board): boolean {
  return before.length === after.length && before.every((row, y) =>
    row.length === after[y].length && row.every((cell, x) => cell === after[y][x]));
}

function readTotals(record: VideoActionStateRecorder): Totals {
  const params = record.key_dynamic_params;
  try {
    const { bbbv_solved, left, right, double, lce, rce, dce, flag } = params;
    return { bbbv_solved, left, right, double, lce, rce, dce, flag, path: record.path };
  } finally { params.free(); }
}

// First event after the target, or first at the target for an inclusive start.
export function eventBoundary<T>(events: ArrayLike<T>, target: number, timeOf: (value: T) => number, inclusive = false): number {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const time = timeOf(events[middle]);
    if (time < target || (!inclusive && time === target)) low = middle + 1;
    else high = middle;
  }
  return low;
}

export class Replay {
  readonly kind = 'minesweeper' as const;
  readonly durationMs: number;
  readonly rows: number;
  readonly columns: number;
  readonly clickEvents: ClickEvent[];
  readonly format: string;
  readonly playerIdentifier: string;
  readonly completed: boolean;
  private readonly times: Float64Array;
  private readonly baseline: Totals;
  private index = -2;
  private board: Board = [];
  private cursor: Cursor | null = null;
  private chordHeld = false;
  private cumulative: Totals = zero;
  private readonly boardValues: BoardValues;

  private constructor(readonly filename: string, private readonly video: Video, private readonly records: VideoActionStateRecorder[], extension: string) {
    this.format = extension.toUpperCase();
    this.rows = video.row;
    this.columns = video.column;
    this.playerIdentifier = video.player_identifier.trim();
    this.completed = video.is_completed;
    this.boardValues = Object.fromEntries(boardFields.map((field) => [field, video[field]])) as BoardValues;
    this.durationMs = video.rtime_ms;
    if (!Number.isFinite(this.durationMs) || this.durationMs < 0 || !records.length) {
      throw new Error('录像没有可播放的操作。');
    }
    this.times = new Float64Array(records.length);
    const startOffset = video.video_start_time;
    const clickEvents: ClickEvent[] = [];
    const chordPreludeIndices = new Set<number>();
    let pendingRight: number | undefined;
    let previousMouseState = 1;
    let previous = zero;
    let lastTime = -Infinity;
    records.forEach((record, index) => {
      const normalized = (record.time + startOffset) * 1000;
      if (!Number.isFinite(normalized)) throw new Error('录像包含无效的事件时间。');
      // Normalize floating point noise at zero and preserve record order for equal timestamps.
      const timeMs = Math.max(lastTime, Math.abs(normalized) < 0.000001 ? 0 : normalized);
      lastTime = timeMs;
      this.times[index] = timeMs;
      const current = readTotals(record);
      const mouseState = record.mouse_state;
      const kinds = clickKinds.filter((kind) => current[kind] > previous[kind]);
      if (kinds.length) {
        const changed = !sameBoard(readBoard(record.prior_game_board), readBoard(record.next_game_board));
        // A right press on an opened cell can be counted before the same hold becomes a chord.
        if (kinds.includes('double') && pendingRight !== undefined && isChordHeld(previousMouseState)) {
          chordPreludeIndices.add(pendingRight);
          pendingRight = undefined;
        }
        for (const kind of kinds.includes('double') ? ['double'] as const : kinds) {
          if (kind === 'right') pendingRight = changed ? undefined : index;
          for (let count = previous[kind]; count < current[kind]; count++) {
            clickEvents.push({ timeMs: Math.min(timeMs, this.durationMs), index, kind, changed });
          }
        }
      }
      if (!rightHeldStates.has(mouseState)) pendingRight = undefined;
      previousMouseState = mouseState;
      previous = current;
    });
    this.clickEvents = clickEvents.filter((event) => event.kind !== 'right' || !chordPreludeIndices.has(event.index));
    const beforeStart = eventBoundary(this.times, 0, (time) => time, true) - 1;
    this.baseline = beforeStart < 0 ? zero : readTotals(records[beforeStart]);
  }

  static open(filename: string, bytes: ArrayBuffer): Replay {
    const extension = filename.split('.').at(-1)?.toLowerCase() ?? '';
    if (!Object.hasOwn(parsers, extension)) throw new Error('请选择 EVF、AVF、MVF、RMV 或小游戏 JSON 录像。');
    if (bytes.byteLength === 0) throw new Error('录像文件为空。');
    const Parser = parsers[extension as keyof typeof parsers];
    const video = new Parser(new Uint8Array(bytes), filename);
    let records: VideoActionStateRecorder[] = [];
    try {
      video.parse();
      video.analyse();
      records = video.events as VideoActionStateRecorder[];
      return new Replay(filename, video, records, extension);
    } catch (error) {
      records.forEach((record) => record.free());
      video.free();
      throw error;
    }
  }

  frameAt(ms: number): Frame {
    const index = ms >= this.durationMs ? this.records.length - 1 : eventBoundary(this.times, ms, (time) => time) - 1;
    if (index !== this.index) {
      const record = this.records[index];
      const board = readBoard(record ? record.next_game_board : this.records[0].prior_game_board);
      if (!sameBoard(this.board, board)) this.board = board;
      this.cumulative = record ? readTotals(record) : zero;
      this.chordHeld = record !== undefined && isChordHeld(record.mouse_state);
      this.cursor = null;
      if (record) {
        this.video.current_event_id = index;
        const cursor = this.video.x_y;
        try {
          const x = cursor.x / this.video.pix_size;
          const y = cursor.y / this.video.pix_size;
          if (x >= 0 && x < this.columns && y >= 0 && y < this.rows) this.cursor = { x, y };
        } finally { cursor.free(); }
      }
      this.index = index;
    }
    const current = { ...zero };
    for (const key of totals) current[key] = Math.max(0, this.cumulative[key] - this.baseline[key]);
    const values = calculateValues(current, ms / 1000, this.durationMs / 1000, this.boardValues);
    return { board: this.board, cursor: this.cursor, chordHeld: this.chordHeld, values };
  }

  close() {
    this.records.forEach((record) => record.free());
    this.video.free();
  }
}
