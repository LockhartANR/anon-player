<script setup lang="ts">
import { computed } from 'vue';
import { BoardBackground, BoardForeground, Counter, MinesweeperBoard, MouseTrace } from '@putianyi888/vue3-minesweeper-board';
import '@putianyi888/vue3-minesweeper-board/style.css';
import { chordCell, pressedBackground } from './boardPress';
import type { Frame } from './replay';
import { trainingAppearance } from './trainingAppearance';

const props = defineProps<{ frame: Frame; rows: number; columns: number }>();
const board = computed(() => props.frame.board);
const cursorPosition = computed(() => {
  const cursor = props.frame.cursor;
  return cursor ? { rowIndex: cursor.y, columnIndex: cursor.x } : undefined;
});

const pressedCell = computed<ReturnType<typeof chordCell>>((previous) => {
  const cell = chordCell(props.frame);
  return cell && previous?.row === cell.row && previous.column === cell.column && previous.chord === cell.chord ? previous : cell;
});

const background = computed(() => {
  const press = pressedCell.value;
  return press ? pressedBackground(board.value, press) : undefined;
});
</script>

<template>
  <div class="board-surface" :style="{ '--cols': columns, '--rows': rows }">
    <div v-if="frame.training" class="training-readout">
      <span :aria-label="`剩余 ${frame.training.remaining}`" title="剩余安全格或题目"><Counter :value="frame.training.remaining" :fixed="0" :digits="3" :size="16" /></span>
      <span :aria-label="`用时 ${frame.values.time.toFixed(3)} 秒`" title="用时（秒）"><Counter :value="frame.values.time" :fixed="3" :digits="3" :size="16" /></span>
    </div>
    <div class="mine-board" role="img" :aria-label="`${columns} 列 × ${rows} 行${frame.training ? '训练' : '扫雷'}棋盘`">
      <MinesweeperBoard :board="board" size="auto" :cursor-position="cursorPosition">
        <template #background><BoardBackground :board="background" /></template>
        <template v-if="frame.training" #foreground>
          <div class="training-layers">
            <BoardForeground :style="{ opacity: frame.training.foregroundOpacity }" />
            <MouseTrace v-if="frame.trace" v-bind="{ ...frame.trace, ...trainingAppearance }" />
          </div>
        </template>
      </MinesweeperBoard>
    </div>
  </div>
</template>
