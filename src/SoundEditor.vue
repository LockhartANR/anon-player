<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import Icon from './Icon.vue';
import VolumeSlider from './VolumeSlider.vue';
import { cloneSoundSettings, listSoundProfiles, modes, readSoundProfile, readSoundProfileSelection, resultKey, saveSoundProfile, saveSounds, SoundProfileNameConflict, soundCategories, soundLabels, soundName, soundStorageBlockedMessage, soundStorageUpgradeBlocked } from './soundSettings';
import type { GroupKey, ResultGroup, SoundCategory, SoundMode, SoundProfileInfo, SoundSettings } from './soundSettings';
import { soundPresets } from './soundPresets';
import type { SoundPreset } from './soundPresets';

type PresetTarget = { key: GroupKey; label: string };
type PresetSelection = { target: PresetTarget; ids: string[] };

const props = defineProps<{
  settings: SoundSettings; ready: boolean; badAssets: Set<string>; error: string; importing: boolean;
  applyProfile: (settings: SoundSettings, id: string) => Promise<void>;
  importSounds: (group: GroupKey, sources: (File | SoundPreset)[]) => Promise<string[] | undefined>;
  previewPreset: (group: GroupKey, preset: SoundPreset, signal: AbortSignal) => Promise<void>;
}>();
const emit = defineEmits<{
  change: [settings: SoundSettings]; switchProfile: [];
  preview: [group: GroupKey, id: string];
  cancelImport: [];
  mix: [settings: SoundSettings]; saveMix: [];
}>();
const kind = ref<SoundCategory>('left');
const outcome = ref<'default' | 'changed' | 'unchanged'>('default');
const profiles = ref<SoundProfileInfo[]>([]);
const profilesLoading = ref(true);
const profileBusy = ref(false);
const selectedProfileId = ref('current');
const savingProfile = ref(false);
const profileName = ref('');
const profileError = ref('');
const nameConflict = ref<SoundProfileNameConflict>();
const presetDialog = ref<HTMLDialogElement>();
const presetTarget = ref<PresetTarget>();
const selectedPresets = ref<string[]>([]);
const presetRetries = reactive(new Map<GroupKey, PresetSelection>());
let pendingPresets: PresetSelection | undefined;
const previewPending = ref<string>();
const presetError = ref('');
let presetPreview: AbortController | undefined;
const editorDisabled = computed(() => !props.ready || profileBusy.value);
const importDisabled = computed(() => editorDisabled.value || props.importing);
const groupKey = computed<GroupKey>(() => kind.value === 'end' || outcome.value === 'default'
  ? kind.value : resultKey(kind.value, outcome.value === 'changed'));
const group = computed(() => props.settings.groups[groupKey.value]);
const inherited = computed(() => kind.value !== 'end' && outcome.value !== 'default' && !props.settings.overrides[groupKey.value as ResultGroup]);
const availableModes = computed(() => kind.value === 'end' ? modes.filter(({ key }) => key !== 'sequence') : modes);
const selectedProfile = computed(() => profiles.value.find(({ id }) => id === selectedProfileId.value));
const updatingSelected = computed(() => selectedProfile.value?.name.trim() === profileName.value.trim());
const targetIds = computed(() => presetTarget.value ? props.settings.groups[presetTarget.value.key].ids : []);

function update(edit: (settings: SoundSettings) => void) {
  const settings = cloneSoundSettings(props.settings);
  edit(settings);
  emit('change', settings);
}

function setOverride(enabled: boolean) {
  update((settings) => { settings.overrides[groupKey.value as ResultGroup] = enabled; });
}

function setMode(mode: SoundMode) {
  update((settings) => { settings.groups[groupKey.value].mode = mode; });
}

function setFixed(id: string) {
  update((settings) => { settings.groups[groupKey.value].fixedId = id; });
}

function setGroupLevel(volume: number, id?: string) {
  const next = id === undefined ? { ...group.value, volume }
    : { ...group.value, clipVolumes: { ...group.value.clipVolumes, [id]: volume } };
  emit('mix', { ...props.settings, groups: { ...props.settings.groups, [groupKey.value]: next } });
}

function move(index: number, direction: number) {
  update((settings) => {
    const ids = settings.groups[groupKey.value].ids;
    const next = index + direction;
    [ids[index], ids[next]] = [ids[next], ids[index]];
  });
}

function remove(id: string) {
  update((settings) => {
    const sound = settings.groups[groupKey.value];
    sound.ids = sound.ids.filter((candidate) => candidate !== id);
    delete sound.clipVolumes[id];
    if (sound.fixedId === id) sound.fixedId = sound.ids[0] ?? '';
    if (!Object.values(settings.groups).some((item) => item.ids.includes(id))) {
      settings.assets = settings.assets.filter((asset) => asset.id !== id);
    }
  });
}

function importFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  if (files.length && !importDisabled.value) return props.importSounds(groupKey.value, files);
}

function openPresetPicker() {
  const result = kind.value === 'end' || outcome.value === 'default' ? ''
    : outcome.value === 'changed' ? '（改变局面）' : '（未改变局面）';
  showPresetPicker({ key: groupKey.value, label: `${soundLabels[kind.value]}音效${result}` });
}

function showPresetPicker(target: PresetTarget, ids: string[] = []) {
  if (importDisabled.value) return;
  presetTarget.value = target;
  selectedPresets.value = [...ids];
  presetError.value = '';
  presetDialog.value?.showModal();
}

function stopPresetPreview() {
  presetPreview?.abort();
  presetPreview = undefined;
  previewPending.value = undefined;
}

function closePresetPicker() {
  stopPresetPreview();
  presetDialog.value?.close();
}

async function auditionPreset(preset: SoundPreset) {
  const target = presetTarget.value;
  if (!target || previewPending.value === preset.id) return;
  stopPresetPreview();
  const controller = new AbortController();
  presetPreview = controller;
  previewPending.value = preset.id;
  presetError.value = '';
  try {
    await props.previewPreset(target.key, preset, controller.signal);
  } catch {
    if (!controller.signal.aborted) presetError.value = `无法试听「${preset.name}」。`;
  } finally {
    if (presetPreview === controller) previewPending.value = undefined;
  }
}

async function addPresets() {
  const target = presetTarget.value;
  if (!target || importDisabled.value) return;
  const presets = soundPresets.filter(({ id }) => selectedPresets.value.includes(id) && !targetIds.value.includes(id));
  if (!presets.length) return;
  const selection = { target, ids: presets.map(({ id }) => id) };
  pendingPresets = selection;
  closePresetPicker();
  const failedIds = await props.importSounds(target.key, presets);
  if (pendingPresets !== selection) return;
  pendingPresets = undefined;
  if (failedIds) updatePresetRetries(selection, failedIds);
}

function updatePresetRetries(selection: PresetSelection, remainingIds: string[]) {
  const { target } = selection;
  const previous = presetRetries.get(target.key);
  const untouchedIds = previous?.ids.filter((id) => !selection.ids.includes(id)) ?? [];
  const ids = [...untouchedIds, ...remainingIds];
  if (ids.length) presetRetries.set(target.key, { target, ids });
  else presetRetries.delete(target.key);
}

function preserveCancelledPresetSelection() {
  if (pendingPresets) updatePresetRetries(pendingPresets, pendingPresets.ids);
  pendingPresets = undefined;
}

function cancelImport() {
  preserveCancelledPresetSelection();
  emit('cancelImport');
}

async function refreshProfiles() {
  profilesLoading.value = true;
  try {
    const [listed, selected] = await Promise.all([listSoundProfiles(), readSoundProfileSelection()]);
    profiles.value = listed;
    if (selected !== undefined && (selected === 'current' || selected === 'default' || listed.some((profile) => profile.id === selected))) {
      selectedProfileId.value = selected;
    }
  } catch {
    profileError.value = '无法读取已保存的音效配置。';
  } finally {
    profilesLoading.value = false;
  }
}

async function selectProfile(event: Event) {
  const select = event.target as HTMLSelectElement;
  const id = select.value;
  if (editorDisabled.value || profilesLoading.value || id === selectedProfileId.value) return;
  select.value = selectedProfileId.value;
  profileError.value = '';
  nameConflict.value = undefined;
  if (id !== 'current' && id !== 'default' && !profiles.value.some((profile) => profile.id === id)) {
    return;
  }

  await applySelectedProfile(id);
  select.value = selectedProfileId.value;
}

async function applySelectedProfile(id: string, fallbackMessage = '无法应用并保存所选音效配置。') {
  preserveCancelledPresetSelection();
  emit('switchProfile');
  profileBusy.value = true;
  try {
    // Read a detached snapshot first. Do not mutate the currently applied settings
    // until the parent has decoded its assets and accepts the profile.
    if (id === 'current') await saveSounds(props.settings, id);
    else {
      await props.applyProfile(await readSoundProfile(id), id);
      presetRetries.clear();
    }
    selectedProfileId.value = id;
  } catch (error) {
    profileError.value = error instanceof Error ? error.message : fallbackMessage;
  } finally {
    profileBusy.value = false;
  }
}

async function restoreDefaultSounds() {
  if (editorDisabled.value || profilesLoading.value) return;
  if (!window.confirm('恢复项目默认音效？当前音量、音效分组和导入的音效将被替换。')) return;
  closeSaveForm();
  await applySelectedProfile('default', '无法恢复默认音效。');
}

function openSaveForm() {
  profileError.value = '';
  nameConflict.value = undefined;
  profileName.value = selectedProfile.value?.name ?? '';
  savingProfile.value = true;
}

function closeSaveForm() {
  savingProfile.value = false;
  profileName.value = '';
  profileError.value = '';
  nameConflict.value = undefined;
}

function onProfileNameInput() {
  nameConflict.value = undefined;
  profileError.value = '';
}

async function saveCurrentProfile(overwriteId?: string) {
  if (importDisabled.value || !profileName.value.trim() || (nameConflict.value && !overwriteId)) return;
  profileError.value = '';
  profileBusy.value = true;
  try {
    const targetId = overwriteId ?? (updatingSelected.value ? selectedProfile.value?.id : undefined);
    const saved = await saveSoundProfile(profileName.value, props.settings, targetId);
    profiles.value = [...profiles.value.filter(({ id }) => id !== saved.id), saved]
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    selectedProfileId.value = saved.id;
    closeSaveForm();
  } catch (error) {
    nameConflict.value = error instanceof SoundProfileNameConflict ? error : undefined;
    profileError.value = error instanceof Error ? error.message : '无法保存此音效配置。';
  } finally {
    profileBusy.value = false;
  }
}

onMounted(() => { void refreshProfiles(); });
onBeforeUnmount(stopPresetPreview);
</script>

<template>
  <section class="sound-editor" aria-label="音效设置">
    <div class="panel-heading"><h2>回放音效</h2></div>
    <VolumeSlider class="master-volume" label="总音量" :value="settings.volume" :disabled="editorDisabled"
      @input="emit('mix', { ...settings, volume: $event })" @commit="emit('saveMix')" />
    <section class="sound-profile-section" aria-label="音效配置">
      <div class="panel-heading"><h3>配置</h3><button class="text-button sound-reset" type="button" :disabled="editorDisabled || profilesLoading" @click="restoreDefaultSounds">恢复默认音效</button></div>
      <label class="field-label" for="sound-profile">选择配置</label>
      <select id="sound-profile" :value="selectedProfileId" :disabled="editorDisabled || profilesLoading" @change="selectProfile">
        <option value="current">当前工作设置</option>
        <option value="default">默认配置</option>
        <option v-for="profile in profiles" :key="profile.id" :value="profile.id">{{ profile.name }}</option>
      </select>
      <template v-if="savingProfile">
        <label class="field-label" for="sound-profile-name">配置名称</label>
        <input id="sound-profile-name" v-model="profileName" type="text" maxlength="80" autocomplete="off"
          :disabled="editorDisabled" @input="onProfileNameInput" @keydown.enter.prevent="saveCurrentProfile()" />
        <div class="form-actions">
          <button class="button secondary" type="button" :disabled="editorDisabled" @click="closeSaveForm">取消</button>
          <button v-if="nameConflict" class="button primary" type="button" :disabled="importDisabled" @click="saveCurrentProfile(nameConflict.profileId)">更新原配置</button>
          <button v-else class="button primary" type="button" :disabled="importDisabled || !profileName.trim()" @click="saveCurrentProfile()">{{ updatingSelected ? '更新当前配置' : '保存' }}</button>
        </div>
      </template>
      <button v-else class="button secondary" type="button" :disabled="importDisabled" @click="openSaveForm">保存当前配置</button>
      <p v-if="soundStorageUpgradeBlocked" class="error-message" role="status">{{ soundStorageBlockedMessage }}</p>
      <p v-else-if="profilesLoading" class="muted-text" role="status">正在读取配置列表…</p>
      <p v-if="profileError" class="error-message" role="status">{{ profileError }}</p>
    </section>
    <div class="segmented" aria-label="音效类型">
      <button v-for="key in soundCategories" :key="key" type="button" :disabled="editorDisabled" :aria-pressed="kind === key" @click="kind = key">{{ soundLabels[key] }}</button>
    </div>
    <template v-if="kind !== 'end'">
      <label class="field-label" for="sound-result">操作结果</label>
      <select id="sound-result" v-model="outcome" :disabled="editorDisabled">
        <option value="default">{{ soundLabels[kind] }}默认</option>
        <option value="changed">改变局面</option>
        <option value="unchanged">未改变局面</option>
      </select>
      <label v-if="outcome !== 'default'" class="checkbox-line">
        <input type="checkbox" :checked="!inherited" :disabled="editorDisabled" @change="setOverride(($event.target as HTMLInputElement).checked)" /> 单独配置该结果
      </label>
    </template>
    <p v-if="inherited" class="muted-text">使用{{ soundLabels[kind] }}默认音效。</p>
    <template v-else>
      <VolumeSlider class="group-volume" label="本组音量" :value="group.volume" :disabled="editorDisabled"
        @input="setGroupLevel($event)" @commit="emit('saveMix')" />
      <label class="field-label" for="sound-mode">播放方式</label>
      <select id="sound-mode" :value="group.mode" :disabled="editorDisabled" @change="setMode(($event.target as HTMLSelectElement).value as SoundMode)">
        <option v-for="mode in availableModes" :key="mode.key" :value="mode.key">{{ mode.label }}</option>
      </select>
      <template v-if="group.mode === 'fixed' && group.ids.length > 1">
        <label class="field-label" for="fixed-sound">固定使用</label>
        <select id="fixed-sound" :value="group.fixedId" :disabled="editorDisabled" @change="setFixed(($event.target as HTMLSelectElement).value)">
          <option v-for="id in group.ids" :key="id" :value="id">{{ soundName(settings, id) }}</option>
        </select>
      </template>
      <ul v-if="group.ids.length" class="sound-list">
        <li v-for="(id, index) in group.ids" :key="id">
          <div class="clip-actions">
            <span class="clip-name" :title="soundName(settings, id)">{{ soundName(settings, id) }}<small v-if="badAssets.has(id)">无法解码</small></span>
            <button type="button" class="icon-button small" :disabled="badAssets.has(id) || editorDisabled" :aria-label="`试听 ${soundName(settings, id)}`" @click="emit('preview', groupKey, id)"><Icon name="play" :size="14" /></button>
            <button type="button" class="icon-button small" :disabled="index === 0 || editorDisabled" aria-label="上移音效" @click="move(index, -1)"><Icon name="up" :size="14" /></button>
            <button type="button" class="icon-button small" :disabled="index === group.ids.length - 1 || editorDisabled" aria-label="下移音效" @click="move(index, 1)"><Icon name="down" :size="14" /></button>
            <button type="button" class="icon-button small" :disabled="editorDisabled" aria-label="移除音效" @click="remove(id)"><Icon name="trash" :size="14" /></button>
          </div>
          <VolumeSlider label="音量" :accessible-label="`${soundName(settings, id)}的音量`" :value="group.clipVolumes[id] ?? 1" :disabled="editorDisabled"
            @input="setGroupLevel($event, id)" @commit="emit('saveMix')" />
        </li>
      </ul>
      <p v-else class="muted-text">这组还没有音效。</p>
      <div class="sound-import-actions">
        <button class="button secondary" type="button" aria-haspopup="dialog" :disabled="importDisabled" @click="openPresetPicker"><Icon name="plus" :size="16" /> 从预设选取</button>
        <label class="button secondary file-button" :class="{ disabled: importDisabled }"><Icon name="upload" :size="16" /> 选择本地文件<input type="file" accept="audio/*,.wav,.mp3,.ogg,.m4a,.flac" multiple :disabled="importDisabled" @change="importFiles" /></label>
      </div>
    </template>
    <div v-if="importing" class="sound-import-status">
      <span class="muted-text" role="status">正在导入音效…</span>
      <button class="text-button sound-reset" type="button" @click="cancelImport">取消导入</button>
    </div>
    <p v-if="error" class="error-message" role="status">{{ error }}</p>
    <template v-if="!importing">
      <div v-for="retry in presetRetries.values()" :key="retry.target.key" class="sound-import-status" role="group" :aria-label="retry.target.label">
        <button class="button secondary" type="button" aria-haspopup="dialog" :disabled="editorDisabled"
          @click="showPresetPicker(retry.target, retry.ids)">重试预设导入</button>
        <span class="muted-text">{{ retry.target.label }} · {{ retry.ids.length }} 条待导入</span>
      </div>
    </template>

    <dialog ref="presetDialog" class="sound-preset-dialog" aria-labelledby="sound-preset-title" @cancel.prevent="closePresetPicker">
      <form class="sound-preset-picker" @submit.prevent="addPresets">
        <h2 id="sound-preset-title">选择预设音效</h2>
        <ul class="sound-preset-list">
          <li v-for="preset in soundPresets" :key="preset.id">
            <label class="checkbox-line">
              <input v-model="selectedPresets" type="checkbox" :value="preset.id" :disabled="targetIds.includes(preset.id)" />
              {{ preset.name }}
              <small v-if="targetIds.includes(preset.id)" class="sound-preset-added">已添加</small>
            </label>
            <button class="icon-button small" type="button" :aria-label="`试听预设 ${preset.name}`"
              :aria-disabled="previewPending === preset.id || undefined" @click="auditionPreset(preset)"><Icon name="play" :size="14" /></button>
          </li>
        </ul>
        <p v-if="previewPending" class="muted-text" role="status">正在加载试听…</p>
        <p v-if="presetError" class="error-message" role="alert">{{ presetError }}</p>
        <div class="form-actions">
          <button class="button secondary" type="button" @click="closePresetPicker">取消</button>
          <button class="button primary" type="submit" :disabled="!selectedPresets.length || importDisabled">添加到{{ presetTarget?.label }}</button>
        </div>
      </form>
    </dialog>
  </section>
</template>
