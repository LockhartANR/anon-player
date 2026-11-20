<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import Icon from './Icon.vue';
import VolumeSlider from './VolumeSlider.vue';
import { fetchOpenMsReplay, parseOpenMsReplayId } from './openmsReplay';
import { describeExportReplay, planExport, planReplayAudio } from './exportPlan';
import type { ExportReplay } from './exportPlan';
import type { ClickAudio } from './audio';
import type { Counter } from './counters';
import type { SoundSettings } from './soundSettings';
import { soundStorageBlockedMessage, soundStorageUpgradeBlocked } from './soundSettings';
import { musicTracks } from './musicTracks';

const props = defineProps<{ sound: ClickAudio; settings: SoundSettings; soundsReady: boolean; counters: Counter[] }>();
const dialog = ref<HTMLDialogElement>();
const replays = ref<ExportReplay[]>([]);
const onlineInput = ref('');
const error = ref('');
const status = ref('');
const loading = ref(false);
const exporting = ref(false);
const progress = ref(0);
const musicFile = ref<HTMLInputElement>();
const music = shallowRef<{ selection: string; name: string; buffer: AudioBuffer }>();
const musicSelection = computed(() => music.value?.selection ?? 'none');
const musicVolume = ref(.25);
const resultUrl = ref('');
const presets = [
  { label: '720p · 30 fps', width: 1280, height: 720, fps: 30, mbps: 2.5 },
  { label: '1080p · 60 fps', width: 1920, height: 1080, fps: 60, mbps: 10 },
  { label: '1440p · 60 fps', width: 2560, height: 1440, fps: 60, mbps: 16 },
  { label: '4K · 60 fps', width: 3840, height: 2160, fps: 60, mbps: 28 },
];
const defaultPreset = presets[1];
const width = ref<number | ''>(defaultPreset.width);
const height = ref<number | ''>(defaultPreset.height);
const fps = ref<number | ''>(defaultPreset.fps);
const mbps = ref<number | ''>(defaultPreset.mbps);
let inputController: AbortController | undefined;
let job: AbortController | undefined;
let key = 0;
let exportRevision = 0;

const busy = computed(() => loading.value || exporting.value);
const invalidHold = computed(() => replays.value.some((r) => r.holdSeconds !== ''
  && (!Number.isFinite(r.holdSeconds) || r.holdSeconds < 0)));
const activePreset = computed(() => presets.findIndex((preset) =>
  preset.width === width.value && preset.height === height.value && preset.fps === fps.value && preset.mbps === mbps.value));
const validFps = computed(() => typeof fps.value === 'number' && Number.isFinite(fps.value) && fps.value >= 1);
const bitrate = computed(() => Math.round(Number(mbps.value) * 1e6));
const videoError = computed(() => {
  if (![width.value, height.value].every((size) => typeof size === 'number' && Number.isSafeInteger(size) && size >= 2 && size % 2 === 0)) {
    return '分辨率的宽和高都须为正偶数。';
  }
  if (!validFps.value) return '帧率须为大于或等于 1 的数值。';
  if (!Number.isSafeInteger(bitrate.value) || bitrate.value <= 0) return '请输入有效的正数视频码率。';
  return '';
});
const cues = computed(() => new Map(props.soundsReady ? replays.value.map((replay) => [replay.key,
  planReplayAudio(replay, props.settings, (id) => props.sound.buffer(id))]) : []));
const plan = computed(() => planExport(replays.value, cues.value, validFps.value ? Number(fps.value) : defaultPreset.fps));

function applyPreset(event: Event) {
  const preset = presets[Number((event.target as HTMLSelectElement).value)];
  if (!preset) return;
  width.value = preset.width;
  height.value = preset.height;
  fps.value = preset.fps;
  mbps.value = preset.mbps;
}

function describeError(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason);
  return /[\u3400-\u9fff]/.test(message) ? message : '文件无法读取，请检查格式并重试。';
}

function open() {
  dialog.value?.showModal();
}

function close() {
  if (job) { job.abort(); return; }
  inputController?.abort();
  dialog.value?.close();
}

defineExpose({ open });

async function importInput(read: (signal: AbortSignal) => Promise<void>) {
  if (busy.value) return;
  loading.value = true;
  error.value = '';
  status.value = '';
  const controller = new AbortController();
  inputController = controller;
  try { await read(controller.signal); }
  catch (reason) {
    if (!controller.signal.aborted) error.value = describeError(reason);
  } finally {
    inputController = undefined;
    loading.value = false;
  }
}

function addLocal(event: Event) {
  const field = event.target as HTMLInputElement;
  const files = Array.from(field.files ?? []);
  field.value = '';
  if (!files.length) return;
  void importInput(async (signal) => {
    const rejected: string[] = [];
    for (const file of files) {
      try {
        const bytes = await file.arrayBuffer();
        signal.throwIfAborted();
        replays.value.push(describeExportReplay(++key, file.name, bytes));
      } catch (reason) {
        signal.throwIfAborted();
        rejected.push(`${file.name}：${describeError(reason)}`);
      }
    }
    error.value = rejected.join('\n');
  });
}

function addOnline() {
  void importInput(async (signal) => {
    const id = parseOpenMsReplayId(onlineInput.value);
    const source = await fetchOpenMsReplay(id, signal);
    signal.throwIfAborted();
    replays.value.push(describeExportReplay(++key, source.filename, source.bytes));
    onlineInput.value = '';
  });
}

function chooseMusic(event: Event) {
  const select = event.target as HTMLSelectElement;
  const choice = select.value;
  // Keep showing the last successful selection until decoding succeeds.
  select.value = musicSelection.value;
  if (busy.value) return;

  if (choice === 'none') {
    music.value = undefined;
    error.value = '';
    return;
  }
  if (choice === 'choose-local') {
    musicFile.value?.click();
    return;
  }
  const track = musicTracks.find(({ id }) => `preset:${id}` === choice);
  if (!track) return;
  void importInput(async (signal) => {
    const base = new URL(import.meta.env.BASE_URL, document.baseURI);
    const path = track.path.split('/').map((part) => encodeURIComponent(part)).join('/');
    const response = await fetch(new URL(`audio/music/${path}`, base), { signal });
    if (!response.ok) throw new Error(`无法读取背景音乐「${track.name}」。`);
    await applyMusic(choice, track.name, await response.blob(), signal);
  });
}

async function applyMusic(selection: string, name: string, file: Blob, signal: AbortSignal) {
  let buffer: AudioBuffer;
  try { buffer = await props.sound.decodeFile(file); }
  catch { throw new Error(`无法解码背景音乐「${name}」，请选择其他音频。`); }
  signal.throwIfAborted();
  music.value = { selection, name, buffer };
}

function selectLocalMusic(event: Event) {
  const field = event.target as HTMLInputElement;
  const file = field.files?.[0];
  field.value = '';
  if (!file) return;
  void importInput((signal) => applyMusic('local', file.name, file, signal));
}

function move(index: number, direction: -1 | 1) {
  const list = replays.value;
  const next = index + direction;
  [list[index], list[next]] = [list[next], list[index]];
}

function remove(index: number) { replays.value.splice(index, 1); }

function discardResult() {
  if (resultUrl.value) URL.revokeObjectURL(resultUrl.value);
  resultUrl.value = '';
}

const queueSettings = computed(() => replays.value.map(({ key, holdSeconds }) => [key, holdSeconds]));
watch([width, height, fps, mbps, queueSettings, music, musicVolume, () => props.counters, () => props.settings], () => {
  exportRevision++;
  if (resultUrl.value) {
    discardResult();
    status.value = '导出设置已更改，请重新生成 MP4。';
  }
}, { flush: 'sync' });

watch([width, height, fps, mbps], () => {
  error.value = '';
});

async function startExport() {
  if (busy.value || !replays.value.length || invalidHold.value || videoError.value || !props.soundsReady) return;
  const revision = exportRevision;
  const snapshot = planExport(replays.value.map((replay) => ({ ...replay })), cues.value, Number(fps.value));
  const video = { width: Number(width.value), height: Number(height.value), fps: Number(fps.value), bitrate: bitrate.value };
  const counters = props.counters.map((value) => ({ ...value }));
  const background = music.value ? { buffer: music.value.buffer, volume: musicVolume.value } : undefined;
  const controller = new AbortController();
  job = controller;
  discardResult();
  progress.value = 0;
  error.value = '';
  status.value = '';
  exporting.value = true;
  try {
    const { exportMp4 } = await import('./exportMp4');
    const mp4 = await exportMp4(snapshot, video, counters, background, controller.signal, (ratio) => { progress.value = ratio; });
    controller.signal.throwIfAborted();
    if (revision !== exportRevision) {
      status.value = '导出设置已更改，请重新生成 MP4。';
      return;
    }
    resultUrl.value = URL.createObjectURL(mp4);
    progress.value = 1;
    status.value = 'MP4 已生成，可以下载。';
  } catch (reason) {
    if (controller.signal.aborted) status.value = '导出已取消。';
    else error.value = reason instanceof Error && /[\u3400-\u9fff]/.test(reason.message)
      ? reason.message : 'MP4 编码失败，请尝试调低视频参数、缩短录像列表，或换一个支持编码的浏览器。';
  } finally {
    exporting.value = false;
    job = undefined;
  }
}

onBeforeUnmount(() => {
  inputController?.abort();
  job?.abort();
  discardResult();
});
</script>

<template>
  <dialog ref="dialog" class="online-dialog export-dialog" aria-labelledby="export-title" @cancel.self.prevent="close">
    <header class="export-header">
      <h2 id="export-title">导出 MP4</h2>
      <button type="button" class="icon-button small" aria-label="关闭导出面板" :disabled="exporting" @click="close"><Icon name="close" :size="18" /></button>
    </header>
    <div class="export-body">
      <div class="export-columns">
        <section class="export-list-section" aria-label="录像列表">
          <h3>录像列表</h3>
          <div class="export-import">
            <label class="button secondary file-button" :class="{ disabled: busy }"><Icon name="plus" :size="16" /> 添加本地录像
              <input type="file" accept=".evf,.avf,.mvf,.rmv" aria-label="添加本地录像" multiple :disabled="busy" @change="addLocal" />
            </label>
            <form class="export-openms" @submit.prevent="addOnline">
              <input v-model="onlineInput" type="text" aria-label="OpenMS 录像 ID 或链接" placeholder="OpenMS ID 或链接" autocomplete="off" :disabled="busy" />
              <button class="button secondary" type="submit" :disabled="busy || !onlineInput.trim()">添加</button>
            </form>
          </div>
          <p v-if="!replays.length" class="export-empty muted-text">添加录像后，可调整播放顺序和每局的末帧停留时间。</p>
          <ol v-else class="export-queue">
            <li v-for="(entry, index) in replays" :key="entry.key" class="export-item">
              <div class="export-replay-text">
                <strong :title="entry.filename">{{ entry.playerIdentifier || entry.filename }}</strong>
                <span>{{ (entry.durationMs / 1000).toFixed(3) }} s<span v-if="entry.playerIdentifier"> · {{ entry.filename }}</span></span>
              </div>
              <label class="hold-control">停留 <input v-model.number="entry.holdSeconds" type="number" min="0" step="0.001"
                :disabled="busy" :aria-label="`第 ${index + 1} 局停留时间`" /> s</label>
              <div class="export-order">
                <button class="icon-button small" type="button" :aria-label="`上移第 ${index + 1} 局`" :disabled="busy || index === 0" @click="move(index, -1)"><Icon name="up" :size="14" /></button>
                <button class="icon-button small" type="button" :aria-label="`下移第 ${index + 1} 局`" :disabled="busy || index === replays.length - 1" @click="move(index, 1)"><Icon name="down" :size="14" /></button>
                <button class="icon-button small" type="button" :aria-label="`移除第 ${index + 1} 局`" :disabled="busy" @click="remove(index)"><Icon name="trash" :size="14" /></button>
              </div>
            </li>
          </ol>
        </section>
        <section class="export-options" aria-label="视频设置、背景音乐与时长">
          <h3>视频设置</h3>
          <div class="export-video">
            <label class="export-preset">预设
              <select :value="activePreset" :disabled="busy" @change="applyPreset">
                <option :value="-1" disabled>自定义</option>
                <option v-for="(preset, index) in presets" :key="preset.label" :value="index">{{ preset.label }}</option>
              </select>
            </label>
            <label>宽度 (px)<input v-model.number="width" type="number" min="2" step="2" :disabled="busy" /></label>
            <label>高度 (px)<input v-model.number="height" type="number" min="2" step="2" :disabled="busy" /></label>
            <label>帧率 (fps)<input v-model.number="fps" type="number" min="1" step="any" :disabled="busy" /></label>
            <label>码率 (Mbps)<input v-model.number="mbps" type="number" min="0.000001" step="any" :disabled="busy" /></label>
          </div>
          <p v-if="videoError" class="error-message" role="alert">{{ videoError }}</p>
          <h3>背景音乐</h3>
          <div class="export-music">
            <select aria-label="背景音乐" :value="musicSelection" :disabled="busy" @change="chooseMusic">
              <option value="none">无背景音乐</option>
              <option v-for="track in musicTracks" :key="track.id" :value="`preset:${track.id}`">{{ track.name }}</option>
              <option v-if="music?.selection === 'local'" value="local" disabled>{{ music.name }}</option>
              <option value="choose-local">选择本地音乐</option>
            </select>
            <input ref="musicFile" type="file" accept="audio/*,.wav,.mp3,.ogg,.m4a,.flac" hidden :disabled="busy"
              @change="selectLocalMusic" @cancel.stop />
          </div>
          <VolumeSlider label="音乐音量" :value="musicVolume" :disabled="busy || !music" @input="musicVolume = $event" />
          <div class="export-duration">
            <span>预计总时长</span>
            <strong aria-live="polite">{{ invalidHold ? '—' : `${plan.duration.toFixed(3)} s` }}</strong>
            <p v-if="!invalidHold && plan.tailSeconds >= .0005" class="muted-text">含尾音 {{ plan.tailSeconds.toFixed(3) }} s</p>
          </div>
        </section>
      </div>
      <p v-if="invalidHold" class="error-message" role="alert">停留时间须为大于或等于零的秒数。</p>
      <p v-if="error" class="error-message export-error" role="alert">{{ error }}</p>
      <p v-if="loading" class="muted-text" role="status">正在读取文件…</p>
      <p v-if="soundStorageUpgradeBlocked" class="error-message" role="status">{{ soundStorageBlockedMessage }}</p>
      <p v-if="status" class="muted-text" role="status">{{ status }}</p>
      <div v-if="exporting" class="export-progress">
        <progress max="1" :value="progress" aria-label="MP4 编码进度" />
        <span>{{ progress >= .98 ? '正在写入 MP4…' : `正在编码 ${Math.round(progress * 100)}%` }}</span>
      </div>
    </div>
    <footer class="export-footer">
      <button v-if="exporting" class="button secondary" type="button" @click="job?.abort()">取消导出</button>
      <template v-else>
        <button class="button" :class="resultUrl ? 'secondary' : 'primary'" type="button" :disabled="busy || !replays.length || invalidHold || !!videoError || !soundsReady" @click="startExport">{{ resultUrl ? '重新生成' : '生成 MP4' }}</button>
        <a v-if="resultUrl" class="button primary" :href="resultUrl" download="Anon Player.mp4">下载 MP4</a>
      </template>
    </footer>
  </dialog>
</template>

<style scoped>
.export-music select {
  width: 100%;
  min-width: 0;
  height: 36px;
  padding: 0 .45rem;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--surface);
  text-overflow: ellipsis;
}
</style>
