<script setup lang="ts">
import { computed } from 'vue';
import { BoardBackground, MinesweeperBoard } from '@putianyi888/vue3-minesweeper-board';
import '@putianyi888/vue3-minesweeper-board/style.css';
import { chordCell, pressedBackground } from './boardPress';
import type { Frame } from './replay';

const props = defineProps<{ frame: Frame; rows: number; columns: number }>();
const board = computed(() => props.frame.board);
const cursorPosition = computed(() => {
  const cursor = props.frame.cursor;
  return cursor ? { rowIndex: cursor.y, columnIndex: cursor.x } : undefined;
});

const pressedCell = computed<{ row: number; column: number } | undefined>((previous) => {
  const cell = chordCell(props.frame);
  return cell && previous?.row === cell.row && previous.column === cell.column ? previous : cell;
});

const background = computed(() => {
  const press = pressedCell.value;
  return press ? pressedBackground(board.value, press) : undefined;
});
</script>

<template>
  <div class="mine-board" role="img" :aria-label="`${columns} 列 × ${rows} 行扫雷棋盘`" :style="{ '--cols': columns, '--rows': rows }">
    <MinesweeperBoard :board="board" size="auto" :cursor-position="cursorPosition">
      <template #background><BoardBackground :board="background" /></template>
    </MinesweeperBoard>
  </div>
</template>
