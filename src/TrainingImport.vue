<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { suggestTrainingMetadata, trainingModes } from './trainingReplay';
import type { TrainingFile, TrainingGame, TrainingMetadata } from './trainingReplay';

const props = defineProps<{ file: TrainingFile }>();
const emit = defineEmits<{ confirm: [metadata: TrainingMetadata]; cancel: [] }>();
const suggested = suggestTrainingMetadata(props.file);
const dialog = ref<HTMLDialogElement>();
const game = ref<TrainingGame>(suggested.game);
const rankingKey = ref(suggested.rankingKey);
const seconds = ref(String(suggested.scoreMs / 1000));
const modes = computed(() => trainingModes.filter((mode) => mode.game === game.value));
const error = ref('');
function changeGame() { rankingKey.value = modes.value[0].key; }
function confirm() {
  const duration = Number(seconds.value) * 1000;
  const scoreMs = Math.round(duration);
  if (!seconds.value.trim() || !Number.isFinite(duration) || Math.abs(duration - scoreMs) > 0.000001 || !Number.isSafeInteger(scoreMs) || scoreMs <= 0) {
    error.value = '请输入大于 0 的总时长，最多保留三位小数。';
    return;
  }
  emit('confirm', { game: game.value, rankingKey: rankingKey.value, scoreMs });
}
onMounted(() => dialog.value?.showModal());
</script>

<template>
  <dialog ref="dialog" class="online-dialog" aria-labelledby="training-import-title" @cancel.prevent="emit('cancel')">
    <form class="online-form" @submit.prevent="confirm">
      <h2 id="training-import-title">补全小游戏录像信息</h2>
      <p class="muted-text">这份 JSON 缺少完整播放信息，请核对游戏、模式和总时长。</p>
      <label for="training-game">游戏</label>
      <select id="training-game" v-model="game" :disabled="file.game !== undefined" @change="changeGame">
        <option value="left-click">左键训练</option><option value="flag-chord">标双训练</option>
      </select>
      <label for="training-mode">模式</label>
      <select id="training-mode" v-model="rankingKey" :disabled="file.rankingKey !== undefined">
        <option v-for="mode in modes" :key="mode.key" :value="mode.key">{{ mode.label }}</option>
      </select>
      <label for="training-duration">总时长（秒）</label>
      <input id="training-duration" v-model="seconds" type="number" min="0.001" step="0.001" required :readonly="file.scoreMs !== undefined" />
      <p v-if="file.scoreMs === undefined" class="muted-text">已按最后事件估算，请以原录像成绩为准。</p>
      <p v-if="error" class="error-message" role="alert">{{ error }}</p>
      <div class="form-actions">
        <button class="button secondary" type="button" @click="emit('cancel')">取消</button>
        <button class="button primary" type="submit">打开录像</button>
      </div>
    </form>
  </dialog>
</template>
