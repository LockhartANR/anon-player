<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import Icon from './Icon.vue';
import VolumeSlider from './VolumeSlider.vue';
import { planExport, planReplayAudio } from './exportPlan';
import type { ExportReplay } from './exportPlan';
import type { ClickAudio } from './audio';
import type { Counter } from './counters';
import type { SoundSettings } from './soundSettings';
import { soundStorageBlockedMessage, soundStorageUpgradeBlocked } from './soundSettings';
import { musicTracks } from './musicTracks';

const props = defineProps<{ sound: ClickAudio; settings: SoundSettings; soundsReady: boolean; counters: Counter[] }>();
const emit = defineEmits<{ start: [] }>();
const replays = defineModel<ExportReplay[]>('queue', { required: true });
const error = ref('');
const status = ref('');
const musicController = shallowRef<AbortController>();
const musicDownload = ref<{ name: string; received: number; total?: number; decoding: boolean }>();
const job = shallowRef<AbortController>();
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
let exportRevision = 0;

const musicLoading = computed(() => !!musicController.value);
const exporting = computed(() => !!job.value);
const busy = computed(() => musicLoading.value || exporting.value);
defineExpose({ busy });
const musicDownloadPercent = computed(() => {
  const download = musicDownload.value;
  if (!download?.total) return undefined;
  return Math.min(100, Math.floor(download.received / download.total * 100));
});
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
const canExport = computed(() => !busy.value && replays.value.length > 0 && !invalidHold.value && !videoError.value && props.soundsReady);
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

async function loadMusic(selection: string, name: string, read: (signal: AbortSignal) => Promise<Blob>) {
  if (busy.value) return;
  const controller = new AbortController();
  musicController.value = controller;
  error.value = '';
  status.value = '';
  try {
    const file = await read(controller.signal);
    controller.signal.throwIfAborted();
    const buffer = await props.sound.decodeFile(file).catch(() => {
      throw new Error(`无法解码背景音乐「${name}」，请选择其他音频。`);
    });
    controller.signal.throwIfAborted();
    music.value = { selection, name, buffer };
  }
  catch (reason) {
    if (!controller.signal.aborted) {
      const message = reason instanceof Error ? reason.message : String(reason);
      error.value = /[\u3400-\u9fff]/.test(message) ? message : '无法读取音频，请检查格式并重试。';
    }
  } finally {
    if (musicController.value === controller) {
      musicDownload.value = undefined;
      musicController.value = undefined;
    }
  }
}

function cancelMusic() {
  musicController.value?.abort();
  musicController.value = undefined;
  musicDownload.value = undefined;
  status.value = '背景音乐读取已取消。';
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
  void loadMusic(choice, track.name, async (signal) => {
    musicDownload.value = { name: track.name, received: 0, decoding: false };
    const download = musicDownload.value;
    const base = new URL(import.meta.env.BASE_URL, document.baseURI);
    const path = track.path.split('/').map((part) => encodeURIComponent(part)).join('/');
    const response = await fetch(new URL(`audio/music/${path}`, base), { signal });
    if (!response.ok || !response.body) throw new Error(`无法读取背景音乐「${track.name}」。`);

    const length = Number(response.headers.get('Content-Length'));
    const encoding = response.headers.get('Content-Encoding');
    if ((!encoding || encoding === 'identity') && Number.isSafeInteger(length) && length > 0) {
      download.total = length;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        download.received += value.byteLength;
      }
    } finally {
      reader.releaseLock();
    }
    signal.throwIfAborted();
    download.decoding = true;
    return new Blob(chunks);
  });
}

function selectLocalMusic(event: Event) {
  const field = event.target as HTMLInputElement;
  const file = field.files?.[0];
  field.value = '';
  if (!file) return;
  void loadMusic('local', file.name, async () => file);
}

function move(index: number, direction: -1 | 1) {
  const list = [...replays.value];
  const next = index + direction;
  [list[index], list[next]] = [list[next], list[index]];
  replays.value = list;
}

function remove(index: number) { replays.value = replays.value.filter((_, i) => i !== index); }

function setHold(index: number, event: Event) {
  const input = event.target as HTMLInputElement;
  const holdSeconds = input.value === '' ? '' : input.valueAsNumber;
  replays.value = replays.value.with(index, { ...replays.value[index], holdSeconds });
}

function discardResult() {
  if (resultUrl.value) URL.revokeObjectURL(resultUrl.value);
  resultUrl.value = '';
}

watch([width, height, fps, mbps, replays, music, musicVolume, () => props.counters, () => props.settings], () => {
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
  if (!canExport.value) return;
  const revision = exportRevision;
  const snapshot = planExport(replays.value.map((replay) => ({ ...replay })), cues.value, Number(fps.value));
  const video = { width: Number(width.value), height: Number(height.value), fps: Number(fps.value), bitrate: bitrate.value };
  const counters = props.counters.map((value) => ({ ...value }));
  const background = music.value ? { buffer: music.value.buffer, volume: musicVolume.value } : undefined;
  const controller = new AbortController();
  job.value = controller;
  emit('start');
  discardResult();
  progress.value = 0;
  error.value = '';
  status.value = '';
  try {
    const { exportMp4 } = await import('./exportMp4');
    const mp4 = await exportMp4(snapshot, video, counters, background, controller.signal, (ratio) => { progress.value = ratio; });
    controller.signal.throwIfAborted();
    resultUrl.value = URL.createObjectURL(mp4);
    progress.value = 1;
    status.value = revision === exportRevision
      ? 'MP4 已生成，可以下载。'
      : 'MP4 已按开始导出时的设置生成，可以下载；期间的修改将在下次生成时生效。';
  } catch (reason) {
    if (controller.signal.aborted) status.value = '导出已取消。';
    else error.value = reason instanceof Error && /[\u3400-\u9fff]/.test(reason.message)
      ? reason.message : 'MP4 编码失败，请尝试调低视频参数、缩短录像列表，或换一个支持编码的浏览器。';
  } finally {
    job.value = undefined;
  }
}

onBeforeUnmount(() => {
  musicController.value?.abort();
  job.value?.abort();
  discardResult();
});
</script>

<template>
  <section class="export-panel" aria-labelledby="export-title">
    <header class="export-header">
      <h2 id="export-title">导出 MP4</h2>
      <span class="muted-text" role="status">{{ replays.length }} 局录像</span>
    </header>
    <div class="export-body">
      <p v-if="!replays.length" class="export-empty muted-text">打开录像后，点击播放器中的「加入导出队列」。</p>
      <ol v-else class="export-queue" aria-label="录像列表">
        <li v-for="(entry, index) in replays" :key="entry.key" class="export-item">
          <div class="export-replay-text">
            <strong :title="entry.filename">{{ entry.filename }}</strong>
            <span>{{ (entry.durationMs / 1000).toFixed(3) }} s<span v-if="entry.playerIdentifier"> · {{ entry.playerIdentifier }}</span></span>
          </div>
          <label class="hold-control">停留 <input :value="entry.holdSeconds" type="number" min="0" step="0.001"
            :disabled="busy" :aria-label="'第 ' + (index + 1) + ' 局停留时间'" @input="setHold(index, $event)" /> s</label>
          <div class="export-order">
            <button class="icon-button small" type="button" :aria-label="'上移第 ' + (index + 1) + ' 局'" :disabled="busy || index === 0" @click="move(index, -1)"><Icon name="up" :size="14" /></button>
            <button class="icon-button small" type="button" :aria-label="'下移第 ' + (index + 1) + ' 局'" :disabled="busy || index === replays.length - 1" @click="move(index, 1)"><Icon name="down" :size="14" /></button>
            <button class="icon-button small" type="button" :aria-label="'移除第 ' + (index + 1) + ' 局'" :disabled="busy" @click="remove(index)"><Icon name="trash" :size="14" /></button>
          </div>
        </li>
      </ol>
      <section class="export-options" aria-labelledby="export-settings-title">
        <h3 id="export-settings-title">导出设置</h3>
        <div class="export-settings">
          <div class="export-video">
            <label class="export-preset">视频预设
              <select aria-label="视频预设" :value="activePreset" :disabled="busy" @change="applyPreset">
                <option :value="-1" disabled>自定义</option>
                <option v-for="(preset, index) in presets" :key="preset.label" :value="index">{{ preset.label }}</option>
              </select>
            </label>
            <label>宽度 (px)<input v-model.number="width" type="number" min="2" step="2" :disabled="busy" /></label>
            <label>高度 (px)<input v-model.number="height" type="number" min="2" step="2" :disabled="busy" /></label>
            <label>帧率 (fps)<input v-model.number="fps" type="number" min="1" step="any" :disabled="busy" /></label>
            <label>码率 (Mbps)<input v-model.number="mbps" type="number" min="0.000001" step="any" :disabled="busy" /></label>
          </div>
          <div>
            <label class="export-music">背景音乐
              <select aria-label="背景音乐" :value="musicSelection" :disabled="busy" @change="chooseMusic">
                <option value="none">无背景音乐</option>
                <option v-for="track in musicTracks" :key="track.id" :value="'preset:' + track.id">{{ track.name }}</option>
                <option v-if="music?.selection === 'local'" value="local" disabled>{{ music.name }}</option>
                <option value="choose-local">选择本地音乐</option>
              </select>
            </label>
            <input ref="musicFile" type="file" accept="audio/*,.wav,.mp3,.ogg,.m4a,.flac" hidden :disabled="busy" @change="selectLocalMusic" />
            <VolumeSlider label="音乐音量" :value="musicVolume" :disabled="busy || !music" @input="musicVolume = $event" />
          </div>
        </div>
      </section>
      <div v-if="musicDownload" class="export-download-status" role="status">
        <span>
          <template v-if="musicDownload.decoding">正在解码「{{ musicDownload.name }}」…</template>
          <template v-else-if="musicDownloadPercent !== undefined">正在下载「{{ musicDownload.name }}」 {{ musicDownloadPercent }}%</template>
          <template v-else>正在下载「{{ musicDownload.name }}」，已接收 {{ (musicDownload.received / 1024).toFixed(0) }} KiB</template>
        </span>
        <progress v-if="!musicDownload.decoding" :value="musicDownloadPercent" max="100" aria-label="背景音乐下载进度" />
      </div>
      <p v-if="videoError" class="error-message" role="alert">{{ videoError }}</p>
      <p v-if="invalidHold" class="error-message" role="alert">停留时间须为大于或等于零的秒数。</p>
      <p v-if="error" class="error-message" role="alert">{{ error }}</p>
      <p v-if="musicLoading && !musicDownload" class="muted-text" role="status">正在读取背景音乐…</p>
      <p v-if="soundStorageUpgradeBlocked" class="error-message" role="status">{{ soundStorageBlockedMessage }}</p>
      <p v-if="status" class="muted-text" role="status">{{ status }}</p>
      <div v-if="exporting" class="export-progress">
        <progress max="1" :value="progress" aria-label="MP4 编码进度" />
        <span>{{ progress >= .98 ? '正在写入 MP4…' : '正在编码 ' + Math.round(progress * 100) + '%' }}</span>
      </div>
    </div>
    <footer class="export-footer">
      <div class="export-duration">
        <span>预计总时长</span>
        <strong>{{ invalidHold ? '—' : plan.duration.toFixed(3) + ' s' }}</strong>
        <span v-if="!invalidHold && plan.tailSeconds >= .0005">含尾音 {{ plan.tailSeconds.toFixed(3) }} s</span>
      </div>
      <div class="export-actions">
        <button v-if="musicLoading" class="button secondary" type="button" @click="cancelMusic">取消读取音乐</button>
        <button v-else-if="exporting" class="button secondary" type="button" @click="job?.abort()">取消导出</button>
        <template v-else>
          <button class="button" :class="resultUrl ? 'secondary' : 'primary'" type="button" :disabled="!canExport" @click="startExport">{{ resultUrl ? '重新生成' : '生成 MP4' }}</button>
          <a v-if="resultUrl" class="button primary" :href="resultUrl" download="Anon Player.mp4">下载 MP4</a>
        </template>
      </div>
    </footer>
  </section>
</template>
