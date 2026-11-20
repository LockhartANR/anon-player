<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import Board from './Board.vue';
import ExportDialog from './ExportDialog.vue';
import Icon from './Icon.vue';
import SoundEditor from './SoundEditor.vue';
import { ClickAudio } from './audio';
import CounterEditor from './CounterEditor.vue';
import { readCounters } from './counters';
import { fetchOpenMsReplay, parseOpenMsReplayId } from './openmsReplay';
import { Replay } from './replay';
import type { Frame } from './replay';
import { cloneSoundSettings, defaultSounds, readSoundProfile, readSounds, saveSounds } from './soundSettings';
import type { GroupKey, SoundAsset, SoundSettings } from './soundSettings';

const fileInput = ref<HTMLInputElement>();
const exportDialog = ref<InstanceType<typeof ExportDialog>>();
const onlineDialog = ref<HTMLDialogElement>();
const onlineInput = ref('');
const onlineError = ref('');
const replay = shallowRef<Replay>();
const frame = shallowRef<Frame>();
const loadSource = ref<'local' | 'openms'>();
const loading = computed(() => loadSource.value !== undefined);
const onlineLoading = computed(() => loadSource.value === 'openms');
const fileError = ref('');
const audioError = ref('');
const dragDepth = ref(0);
const position = ref(0);
const rate = ref(1);
const playing = ref(false);
const seeking = ref(false);
const tab = ref<'stats' | 'audio'>('stats');
const settings = shallowRef(defaultSounds());
const soundsReady = ref(false);
const badAssets = shallowRef(new Set<string>());
const sound = new ClickAudio();
const rates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];
let activeLoad: AbortController | undefined;
let animation = 0;
let anchor = { wallTime: 0, position: 0, rate: 1 };
let includeStart = true;
let resumeAfterSeek = false;
let audioLoadId = 0;
let soundProfileRevision = 0;
let disposed = false;

const duration = computed(() => replay.value?.durationMs ?? 0);
const progress = computed(() => duration.value ? 100 * position.value / duration.value : 0);
const values = computed(() => frame.value?.values);

function elapsedTime(ms: number) {
  return (ms / 1000).toFixed(3);
}

function setPosition(ms: number) {
  position.value = Math.max(0, Math.min(ms, duration.value));
  frame.value = replay.value?.frameAt(position.value);
}

function runningPosition(now = performance.now()) {
  return Math.min(duration.value, anchor.position + Math.max(0, now - anchor.wallTime) * anchor.rate);
}

function draw(now: number) {
  const at = runningPosition(now);
  setPosition(at);
  if (at >= duration.value) {
    playing.value = false;
    sound.finish();
    return;
  }
  animation = requestAnimationFrame(draw);
}

function startClock(allowStartEvent: boolean) {
  anchor = { wallTime: performance.now(), position: position.value, rate: rate.value };
  playing.value = true;
  sound.start(anchor, allowStartEvent);
  includeStart = false;
  animation = requestAnimationFrame(draw);
}

function pauseClock() {
  audioLoadId++;
  if (playing.value) setPosition(runningPosition());
  cancelAnimationFrame(animation);
  playing.value = false;
  sound.stop();
}

async function togglePlayback() {
  if (!replay.value || seeking.value || loading.value) return;
  if (playing.value) { pauseClock(); return; }
  if (position.value >= duration.value) {
    setPosition(0);
    includeStart = true;
  }
  const pending = ++audioLoadId;
  if (!settings.value.muted) {
    try { await sound.unlock(); }
    catch { audioError.value = '无法启动音频，录像仍可播放。'; }
  }
  if (pending === audioLoadId && !disposed) startClock(includeStart);
}

function restart() {
  const resume = playing.value;
  pauseClock();
  setPosition(0);
  includeStart = true;
  if (resume) startClock(true);
}

function setRate(next: number) {
  const resume = playing.value;
  if (resume) pauseClock();
  rate.value = next;
  if (resume && position.value < duration.value) startClock(false);
}

function beginSeek() {
  if (seeking.value || !duration.value) return;
  resumeAfterSeek = playing.value;
  pauseClock();
  seeking.value = true;
}

function seek(ms: number) {
  const resume = playing.value;
  if (!seeking.value) pauseClock();
  setPosition(ms);
  includeStart = false;
  if (resume && position.value < duration.value) startClock(false);
}

function endSeek() {
  if (!seeking.value) return;
  seeking.value = false;
  if (resumeAfterSeek && position.value < duration.value) startClock(false);
  resumeAfterSeek = false;
}

async function loadReplay(source: 'local' | 'openms', read: (signal: AbortSignal) => Promise<{ filename: string; bytes: ArrayBuffer }>): Promise<boolean> {
  activeLoad?.abort();
  const request = new AbortController();
  activeLoad = request;
  pauseClock();
  seeking.value = false;
  resumeAfterSeek = false;
  fileError.value = '';
  loadSource.value = source;
  try {
    const { filename, bytes } = await read(request.signal);
    request.signal.throwIfAborted();
    const next = Replay.open(filename, bytes);
    try {
      const first = next.frameAt(0);
      replay.value?.close();
      replay.value = next;
      position.value = 0;
      includeStart = true;
      frame.value = first;
      sound.configure(next.clickEvents, settings.value);
    } catch (error) {
      if (replay.value !== next) next.close();
      throw error;
    }
    return true;
  } catch (error) {
    if (!request.signal.aborted) {
      const detail = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
      const message = detail && /[\u3400-\u9fff]/.test(detail) ? detail : '无法读取这份录像，请检查格式或尝试其他文件。';
      if (source === 'openms') onlineError.value = message;
      else fileError.value = message;
    }
    return false;
  } finally {
    if (activeLoad === request) {
      activeLoad = undefined;
      loadSource.value = undefined;
    }
  }
}

function loadFiles(files: File[]) {
  if (!files.length) return;
  if (files.length !== 1) { fileError.value = '一次请选择一份录像。'; return; }
  const [file] = files;
  void loadReplay('local', async () => ({ filename: file.name, bytes: await file.arrayBuffer() }));
}

function openOnlineDialog() {
  onlineError.value = '';
  onlineDialog.value?.showModal();
}

function openExportDialog() {
  if (playing.value) pauseClock();
  exportDialog.value?.open();
}

function closeOnlineDialog() {
  if (onlineLoading.value) activeLoad?.abort();
  onlineDialog.value?.close();
}

async function openOnlineReplay() {
  if (onlineLoading.value) return;
  onlineError.value = '';
  let id: string;
  try { id = parseOpenMsReplayId(onlineInput.value); }
  catch (error) {
    onlineError.value = (error as Error).message;
    return;
  }
  const opened = await loadReplay('openms', (signal) => fetchOpenMsReplay(id, signal));
  if (opened) onlineDialog.value?.close();
}

function chooseFile(event: Event) {
  const input = event.target as HTMLInputElement;
  loadFiles(Array.from(input.files ?? []));
  input.value = '';
}

function dropFile(event: DragEvent) {
  dragDepth.value = 0;
  loadFiles(Array.from(event.dataTransfer?.files ?? []));
}

function persistSound(next: SoundSettings) {
  void saveSounds(next).catch(() => { audioError.value = '音效设置无法保存到此浏览器。'; });
}

function changeSounds(next: SoundSettings, persist = true) {
  const wasMuted = settings.value.muted;
  for (const asset of settings.value.assets) {
    if (!next.assets.some((candidate) => candidate.id === asset.id)) {
      sound.forget(asset.id);
      const errors = new Set(badAssets.value);
      errors.delete(asset.id);
      badAssets.value = errors;
    }
  }
  settings.value = next;
  sound.configure(replay.value?.clickEvents ?? [], next);
  if (next.muted) sound.stop();
  else if (wasMuted && playing.value) sound.start(anchor, false, runningPosition());
  if (persist) persistSound(next);
}

function invalidateSoundImports() { soundProfileRevision++; }

async function switchSoundProfile(next: SoundSettings, id: string) {
  await applySoundProfile(next, { profileId: id });
}

async function applySoundProfile(next: SoundSettings, { profileId, fallbackToBuiltins = false }:
  { profileId?: string; fallbackToBuiltins?: boolean } = {}) {
  const revision = ++soundProfileRevision;
  soundsReady.value = false;
  audioError.value = '';
  try {
    const broken = new Set<string>();
    const decoded = new Map<string, AudioBuffer>();
    await Promise.all(next.assets.map(async (asset) => {
      try { decoded.set(asset.id, await sound.decodeFile(asset.file)); } catch { broken.add(asset.id); }
    }));
    if (disposed || revision !== soundProfileRevision) return;
    if (fallbackToBuiltins && broken.size) {
      changeSounds(defaultSounds(), false);
      badAssets.value = new Set();
      audioError.value = '无法解码项目默认音效，已使用内置音效。';
      return;
    }
    // Commit settings and selection together only after decoding. Until this
    // transaction completes, a refresh must restore the previously applied pair.
    if (profileId !== undefined) await saveSounds(next, profileId);
    if (disposed || revision !== soundProfileRevision) return;
    for (const id of broken) sound.forget(id);
    for (const [id, buffer] of decoded) sound.rememberDecoded(id, buffer);
    // Stop already scheduled voices, then resume the scheduler at the current position.
    sound.stop();
    changeSounds(next, false);
    badAssets.value = broken;
    if (broken.size) audioError.value = `无法解码 ${next.assets.filter((asset) => broken.has(asset.id)).map((asset) => asset.name).join('、')}`;
    if (playing.value && !next.muted) sound.start(anchor, false, runningPosition());
  } finally {
    if (!disposed && revision === soundProfileRevision) soundsReady.value = true;
  }
}

function changeMix(next: SoundSettings) {
  settings.value = next;
  sound.setMix(next);
}

async function toggleMute() {
  if (!settings.value.muted) {
    changeSounds({ ...settings.value, muted: true });
    return;
  }
  try { await sound.unlock(); }
  catch { audioError.value = '无法启动音频。'; }
  changeSounds({ ...settings.value, muted: false });
}

function makeId() {
  return Array.from(crypto.getRandomValues(new Uint32Array(3)), (part) => part.toString(36)).join('-');
}

async function importSounds(groupKey: GroupKey, files: File[]) {
  if (!soundsReady.value) return;
  const revision = soundProfileRevision;
  audioError.value = '';
  const imported: { asset: SoundAsset; buffer: AudioBuffer }[] = [];
  const failed: string[] = [];
  for (const file of files) {
    const asset = { id: makeId(), name: file.name, file };
    try { imported.push({ asset, buffer: await sound.decodeFile(file) }); }
    catch { failed.push(file.name); }
    if (disposed || revision !== soundProfileRevision) return;
  }
  if (failed.length) audioError.value = `无法解码 ${failed.join('、')}`;
  if (!imported.length) return;
  const next = cloneSoundSettings(settings.value);
  const group = next.groups[groupKey];
  for (const { asset, buffer } of imported) {
    sound.rememberDecoded(asset.id, buffer);
    next.assets.push(asset);
    group.ids.push(asset.id);
  }
  if (!group.fixedId) group.fixedId = group.ids[0];
  changeSounds(next);
}

async function previewSound(group: GroupKey, id: string) {
  audioError.value = '';
  try { await sound.preview(group, id); }
  catch { audioError.value = '无法试听这条音效。'; }
}

const counters = ref(readCounters());

onMounted(async () => {
  window.addEventListener('pointerup', endSeek);
  window.addEventListener('pointercancel', endSeek);
  try {
    const saved = await readSounds();
    if (disposed) return;
    if (saved) await applySoundProfile(saved);
    else {
      try {
        const defaults = await readSoundProfile('default');
        if (!disposed) await applySoundProfile(defaults, { fallbackToBuiltins: true });
      } catch { if (!disposed) audioError.value = '无法读取项目默认音效，已使用内置音效。'; }
    }
  } catch { if (!disposed) audioError.value = '无法读取本地音效设置。'; }
  finally { if (!disposed) soundsReady.value = true; }
});

onBeforeUnmount(() => {
  disposed = true;
  activeLoad?.abort();
  audioLoadId++;
  cancelAnimationFrame(animation);
  window.removeEventListener('pointerup', endSeek);
  window.removeEventListener('pointercancel', endSeek);
  sound.dispose();
  replay.value?.close();
});
</script>

<template>
  <header class="topbar">
    <div class="brand">
      <img class="brand-mark" src="./favicon.png" width="34" height="34" alt="" />
      <h1>Anon Player</h1>
    </div>
    <input ref="fileInput" type="file" accept=".evf,.avf,.mvf,.rmv" hidden aria-label="录像文件" @change="chooseFile" />
    <div class="topbar-actions">
      <button class="button secondary" type="button" @click="openExportDialog"><Icon name="film" :size="17" /> 导出 MP4</button>
      <button class="button primary" type="button" @click="fileInput?.click()"><Icon name="upload" :size="17" /> 导入录像</button>
    </div>
  </header>

  <dialog ref="onlineDialog" class="online-dialog" aria-labelledby="openms-dialog-title" @cancel.prevent="closeOnlineDialog">
    <form class="online-form" @submit.prevent="openOnlineReplay">
      <h2 id="openms-dialog-title">打开 OpenMS 录像</h2>
      <label for="openms-replay-input">录像 ID 或链接</label>
      <input id="openms-replay-input" v-model="onlineInput" type="text" placeholder="107 或 https://openms.top/#/video/107"
        autofocus autocomplete="off" :readonly="onlineLoading" :aria-invalid="!!onlineError" @input="onlineError = ''" />
      <p v-if="onlineError" class="error-message" role="alert">{{ onlineError }}</p>
      <p v-if="onlineLoading" class="muted-text" role="status">正在读取录像…</p>
      <div class="form-actions">
        <button class="button secondary" type="button" @click="closeOnlineDialog">取消</button>
        <button class="button primary" type="submit" :disabled="onlineLoading">打开录像</button>
      </div>
    </form>
  </dialog>

  <ExportDialog ref="exportDialog" :sound="sound" :settings="settings" :sounds-ready="soundsReady" :counters="counters" />

  <main class="workspace">
    <section class="player" aria-label="录像播放器">
      <header class="player-heading">
        <span class="file-mark"><Icon name="file" :size="18" /></span>
        <div class="file-caption">
          <h2 :title="replay?.filename">{{ replay?.filename ?? '录像播放器' }}</h2>
          <span v-if="replay" class="file-detail">{{ replay.format }} <span>·</span> {{ replay.columns }} × {{ replay.rows }} <span>·</span> {{ replay.completed ? '完成' : '未完成' }}</span>
        </div>
        <span class="player-state" :class="{ active: playing }">{{ loading ? '读取中' : playing ? '播放中' : replay ? (position >= duration && duration > 0 ? '播放完毕' : '已暂停') : '等待录像' }}</span>
      </header>

      <div class="stage" :class="{ 'drag-active': dragDepth > 0 }" @dragenter.prevent="dragDepth++" @dragover.prevent @dragleave.prevent="dragDepth = Math.max(0, dragDepth - 1)" @drop.prevent="dropFile">
        <div v-if="frame && replay" class="board-wrap">
          <Board :frame="frame" :rows="replay.rows" :columns="replay.columns" />
          <p v-if="replay.playerIdentifier" class="replay-identifier"><bdi>{{ replay.playerIdentifier }}</bdi></p>
        </div>
        <div v-else class="empty-workbench">
          <div class="empty-icon"><Icon name="upload" :size="30" /></div>
          <h3>{{ loading ? '正在读取录像' : '拖入扫雷录像' }}</h3>
          <div class="empty-actions">
            <button type="button" class="button secondary" :disabled="loading" @click="fileInput?.click()"><Icon name="upload" :size="17" /> 选择本地文件</button>
            <button type="button" class="button secondary" :disabled="loading" @click="openOnlineDialog"><Icon name="link" :size="17" /> 打开 OpenMS 录像</button>
          </div>
          <div class="formats" aria-label="支持格式"><span v-for="format in ['EVF', 'AVF', 'MVF', 'RMV']" :key="format">{{ format }}</span></div>
        </div>
        <div v-if="dragDepth > 0 && frame" class="drop-overlay">松开以打开录像</div>
      </div>

      <div v-if="fileError" class="load-error" role="alert">{{ fileError }}</div>
      <div class="transport">
        <div class="timeline">
          <input class="seek-slider" type="range" min="0" :max="duration || 1" step="1" :value="position" :disabled="!duration || loading" :style="{ '--progress': `${progress}%` }" aria-label="播放进度" @pointerdown="beginSeek" @input="seek(Number(($event.target as HTMLInputElement).value))" @change="endSeek" />
          <span class="timecode timeline-times"><span class="current-time">{{ elapsedTime(position) }}</span> / {{ elapsedTime(duration) }} s</span>
        </div>
        <div class="transport-buttons">
          <button type="button" class="button play-button" :disabled="!replay || loading" :aria-label="playing ? '暂停' : '播放'" @click="togglePlayback"><Icon :name="playing ? 'pause' : 'play'" :size="20" /> <span>{{ playing ? '暂停' : '播放' }}</span></button>
          <button type="button" class="icon-button transport-icon" :disabled="!replay || loading" aria-label="回到开头" title="回到开头" @click="restart"><Icon name="restart" /></button>
          <label class="speed-select"><select aria-label="播放倍速" :value="rate" @change="setRate(Number(($event.target as HTMLSelectElement).value))"><option v-for="speed in rates" :key="speed" :value="speed">{{ speed }}×</option></select></label>
          <button type="button" class="icon-button transport-icon" :disabled="!soundsReady" :aria-label="settings.muted ? '取消静音' : '静音'" :title="settings.muted ? '取消静音' : '静音'" :aria-pressed="settings.muted" @click="toggleMute"><Icon :name="settings.muted ? 'muted' : 'volume'" /></button>
        </div>
      </div>
    </section>

    <aside class="side-panel" aria-label="数据和音效">
      <nav class="panel-tabs" aria-label="播放器面板">
        <button type="button" :aria-pressed="tab === 'stats'" @click="tab = 'stats'"><Icon name="stats" :size="17" /> 数据</button>
        <button type="button" :aria-pressed="tab === 'audio'" @click="tab = 'audio'"><Icon name="sound" :size="17" /> 音效</button>
      </nav>

      <div v-show="tab === 'stats'" class="stats-panel">
        <CounterEditor :counters="counters" :values="values" @change="counters = $event" />
      </div>

      <SoundEditor v-show="tab === 'audio'" :settings="settings" :ready="soundsReady" :bad-assets="badAssets" :error="audioError" :apply-profile="switchSoundProfile"
        @change="changeSounds" @switch-profile="invalidateSoundImports" @import="importSounds" @preview="previewSound" @mix="changeMix" @save-mix="persistSound(settings)" />
    </aside>
  </main>
</template>
