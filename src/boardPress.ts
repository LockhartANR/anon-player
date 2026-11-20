import type { Frame } from './replay';

type Cell = { row: number; column: number };
const flatCells = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 14, 15, 18]);

export function chordCell({ board, cursor, chordHeld }: Frame): Cell | undefined {
  if (!chordHeld || !cursor) return undefined;
  const row = Math.floor(cursor.y);
  const column = Math.floor(cursor.x);
  return board[row]?.[column] === undefined ? undefined : { row, column };
}

export function pressedBackground(board: Frame['board'], press: Cell): boolean[][] {
  return board.map((row, y) => row.map((cell, x) => cell !== 11 &&
    (flatCells.has(cell) || (Math.abs(y - press.row) <= 1 && Math.abs(x - press.column) <= 1))));
}
