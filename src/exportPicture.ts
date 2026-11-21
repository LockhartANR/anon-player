import { createBoardRenderer } from '@putianyi888/vue3-minesweeper-board';
import type { BoardRenderFrame } from '@putianyi888/vue3-minesweeper-board';
import { chordCell, pressedBackground } from './boardPress';
import { compileCounters, formatCounterValue } from './counters';
import type { Counter } from './counters';
import logoUrl from './favicon.png';
import type { Frame, Replay } from './replay';

const width = 1280;
const sideX = 842;
const sideWidth = 406;
const nameWidth = 138;
const rowHeight = 34;
const font = 'system-ui, "Microsoft YaHei", sans-serif';
const muted = '#536176';
const text = '#283344';
const accent = '#18579f';
const line = '#9aa8b8';
const nameFill = '#e8edf4';
const valueFill = '#fff';

export function createExportPicture(counters: Counter[], outputWidth: number, outputHeight: number) {
  const canvas = document.createElement('canvas');
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const bodyHeight = 179 + counters.length * rowHeight;
  const height = Math.max(720, bodyHeight);
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('无法创建视频绘制画布。');
  const ctx = context;
  const logo = new Image();
  logo.src = logoUrl;
  let logoReady: Promise<void> | undefined;
  const scale = Math.min(outputWidth / width, outputHeight / height);
  ctx.fillStyle = '#f4f6f9';
  ctx.fillRect(0, 0, outputWidth, outputHeight);
  ctx.setTransform(scale, 0, 0, scale, (outputWidth - width * scale) / 2, (outputHeight - height * scale) / 2);
  const formulas = compileCounters(counters);
  const boardRenderer = createBoardRenderer();
  let cachedBoard: BoardRenderFrame<HTMLCanvasElement> | undefined;
  let lastBoard: Frame['board'] | undefined;
  let lastPress: ReturnType<typeof chordCell>;
  let lastReplay: Replay | undefined;
  let lastMs = -1;

  function rect(color: string, x: number, y: number, w: number, h: number) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }

  function label(content: string, x: number, y: number, maxWidth: number, color = text) {
    ctx.fillStyle = color;
    ctx.fillText(content, x, y, maxWidth);
  }

  function row(name: string, value: string, y: number) {
    rect(line, sideX, y, sideWidth, rowHeight);
    rect(nameFill, sideX + 1, y + 1, nameWidth - 2, rowHeight - 2);
    rect(valueFill, sideX + nameWidth + 1, y + 1, sideWidth - nameWidth - 2, rowHeight - 2);
    ctx.font = `16px ${font}`;
    label(name, sideX + 10, y + 22, nameWidth - 20, muted);
    ctx.textAlign = 'right';
    ctx.font = `600 17px ${font}`;
    label(value, sideX + sideWidth - 10, y + 22, sideWidth - nameWidth - 20);
    ctx.textAlign = 'left';
  }

  return {
    canvas,
    async draw(replay: Replay, ms: number, signal: AbortSignal) {
      if (lastReplay === replay && lastMs === ms) return;
      await (logoReady ??= logo.decode());
      signal.throwIfAborted();
      const frame = replay.frameAt(ms);
      const press = chordCell(frame);
      const size = Math.min(42, 774 / replay.columns, (height - 204) / replay.rows);
      if (lastReplay !== replay || lastBoard !== frame.board || press?.row !== lastPress?.row || press?.column !== lastPress?.column) {
        cachedBoard?.release();
        cachedBoard = await boardRenderer.render({
          board: frame.board, size: size * scale,
          layers: press ? { background: { board: pressedBackground(frame.board, press) } } : undefined,
        }, { signal });
        lastBoard = frame.board;
        lastPress = press;
      }
      signal.throwIfAborted();
      const board = cachedBoard!;
      rect('#f4f6f9', 0, 0, width, height);
      rect('#fff', 24, 18, width - 48, 62);
      ctx.drawImage(logo, 38, 30, 34, 34);
      ctx.font = `700 23px ${font}`;
      label('Anon Player', 82, 55, 158, accent);
      ctx.font = `17px ${font}`;
      label(replay.filename, 260, 55, 680);
      ctx.textAlign = 'right';
      const result = replay.completed ? '完成' : '未完成';
      label(`${replay.format}  ·  ${replay.columns} × ${replay.rows}  ·  ${result}`, 1237, 55, 268, muted);
      ctx.textAlign = 'left';
      rect('#fff', 24, 92, 794, height - 117);
      rect('#fff', 830, 92, 430, height - 117);

      const boardWidth = board.width / scale;
      const boardHeight = board.height / scale;
      const x = 421 - boardWidth / 2;
      const y = 103 + (height - 200 - boardHeight) / 2;
      rect('#858585', x - 1, y - 1, boardWidth + 2, boardHeight + 2);
      if (board.layers.background) ctx.drawImage(board.layers.background, x, y, boardWidth, boardHeight);
      if (board.layers.foreground) ctx.drawImage(board.layers.foreground, x, y, boardWidth, boardHeight);
      if (frame.cursor) {
        ctx.beginPath();
        ctx.arc(x + frame.cursor.x * size, y + frame.cursor.y * size, Math.max(2, size * .1875), 0, Math.PI * 2);
        ctx.fillStyle = '#ffdf00';
        ctx.fill();
        ctx.strokeStyle = '#202634';
        ctx.lineWidth = Math.max(1, size * .06);
        ctx.stroke();
      }
      if (replay.playerIdentifier) {
        ctx.textAlign = 'center';
        ctx.font = `19px ${font}`;
        label(replay.playerIdentifier, 421, y + boardHeight + 28, 760);
        ctx.textAlign = 'left';
      }

      ctx.font = `600 20px ${font}`;
      label('计数器', sideX, 128, 170);
      ctx.textAlign = 'right';
      ctx.font = `600 17px ${font}`;
      label(`${frame.values.time.toFixed(3)} / ${frame.values.duration.toFixed(3)} s`, sideX + sideWidth, 128, 220, accent);
      ctx.textAlign = 'left';
      let rowY = 146;
      for (const counter of formulas) {
        row(counter.name, formatCounterValue(counter.evaluate?.(frame.values)), rowY);
        rowY += rowHeight;
      }
      lastReplay = replay;
      lastMs = ms;
    },
    close() {
      cachedBoard?.release();
      boardRenderer.destroy();
    },
  };
}
