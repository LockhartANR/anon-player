import { readonly, ref } from 'vue';
import { clickKinds } from './replay';
import type { ClickEvent, ClickKind } from './replay';

export type SoundMode = 'mute' | 'fixed' | 'random' | 'sequence';
export type ResultGroup = `${ClickKind}:${'changed' | 'unchanged'}`;
export const soundCategories = [...clickKinds, 'end'] as const;
export type SoundCategory = (typeof soundCategories)[number];
export type GroupKey = SoundCategory | ResultGroup;
export type SoundGroup = { mode: SoundMode; ids: string[]; fixedId: string; volume: number; clipVolumes: Record<string, number> };
export type SoundAsset = { id: string; name: string; file: Blob };
export type SoundSettings = {
  volume: number;
  muted: boolean;
  groups: Record<GroupKey, SoundGroup>;
  overrides: Record<ResultGroup, boolean>;
  assets: SoundAsset[];
};
export type SoundProfile = { id: string; name: string; updatedAt: number; settings: SoundSettings };
export type SoundProfileInfo = Pick<SoundProfile, 'id' | 'name' | 'updatedAt'>;

export class SoundProfileNameConflict extends Error {
  constructor(readonly profileId: string, name: string) {
    super(`已存在「${name}」。可更新原配置，或输入其他名称另存。`);
  }
}

export const soundLabels: Record<SoundCategory, string> = { left: '左键', right: '右键', double: '合击', end: '结束' };
export const modes: { key: SoundMode; label: string }[] = [
  { key: 'fixed', label: '固定音效' }, { key: 'random', label: '随机' },
  { key: 'sequence', label: '顺序轮播' }, { key: 'mute', label: '静音' },
];

export function resultKey(kind: ClickKind, changed: boolean): ResultGroup {
  return `${kind}:${changed ? 'changed' : 'unchanged'}`;
}

export function defaultSounds(): SoundSettings {
  const groups = {} as SoundSettings['groups'];
  const overrides = {} as SoundSettings['overrides'];
  const createGroup = (id: string): SoundGroup => ({ mode: 'fixed', ids: [id], fixedId: id, volume: 1, clipVolumes: {} });
  groups.end = createGroup('builtin:end');
  for (const kind of clickKinds) {
    const id = `builtin:${kind}`;
    groups[kind] = createGroup(id);
    for (const changed of [true, false]) {
      const result = resultKey(kind, changed);
      groups[result] = createGroup(id);
      overrides[result] = false;
    }
  }
  return { volume: 0.65, muted: false, groups, overrides, assets: [] };
}

/**
 * Copy settings without structuredClone: Vue may pass a reactive Proxy, and
 * imported Blob/File instances are immutable references safe to retain.
 */
export function cloneSoundSettings(settings: SoundSettings): SoundSettings {
  return {
    volume: settings.volume,
    muted: settings.muted,
    groups: Object.fromEntries(Object.entries(settings.groups).map(([key, group]) => [key, {
      mode: group.mode,
      ids: [...group.ids],
      fixedId: group.fixedId,
      volume: group.volume,
      clipVolumes: { ...group.clipVolumes },
    }])) as SoundSettings['groups'],
    overrides: { ...settings.overrides },
    assets: settings.assets.map((asset) => ({ id: asset.id, name: asset.name, file: asset.file })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Fill fields introduced in later versions while preserving legacy choices. */
function normalizeSoundSettings(value: unknown): SoundSettings {
  const defaults = defaultSounds();
  if (!isRecord(value)) return defaults;
  const savedGroups = isRecord(value.groups) ? value.groups : {};
  const groups = {} as SoundSettings['groups'];
  for (const key of Object.keys(defaults.groups) as GroupKey[]) {
    const raw = savedGroups[key];
    if (!isRecord(raw)) {
      groups[key] = { ...defaults.groups[key], ids: [...defaults.groups[key].ids], clipVolumes: {} };
      continue;
    }
    const mode = raw.mode;
    const clipVolumes = isRecord(raw.clipVolumes)
      ? Object.fromEntries(Object.entries(raw.clipVolumes).filter((entry): entry is [string, number] => typeof entry[1] === 'number'))
      : {};
    groups[key] = {
      mode: mode === 'mute' || mode === 'fixed' || mode === 'random' || mode === 'sequence' ? mode : defaults.groups[key].mode,
      ids: Array.isArray(raw.ids) ? raw.ids.filter((id): id is string => typeof id === 'string') : [...defaults.groups[key].ids],
      fixedId: typeof raw.fixedId === 'string' ? raw.fixedId : defaults.groups[key].fixedId,
      volume: typeof raw.volume === 'number' ? raw.volume : defaults.groups[key].volume,
      clipVolumes,
    };
  }
  const savedOverrides = isRecord(value.overrides) ? value.overrides : {};
  const overrides = {} as SoundSettings['overrides'];
  for (const key of Object.keys(defaults.overrides) as ResultGroup[]) {
    overrides[key] = typeof savedOverrides[key] === 'boolean' ? savedOverrides[key] as boolean : defaults.overrides[key];
  }
  const assets: SoundAsset[] = Array.isArray(value.assets) ? value.assets.flatMap((asset): SoundAsset[] => {
    if (!isRecord(asset) || typeof asset.id !== 'string' || typeof asset.name !== 'string') return [];
    if (typeof Blob === 'undefined' || !(asset.file instanceof Blob)) return [];
    return [{ id: asset.id, name: asset.name, file: asset.file }];
  }) : [];
  return {
    volume: typeof value.volume === 'number' ? value.volume : defaults.volume,
    muted: typeof value.muted === 'boolean' ? value.muted : defaults.muted,
    groups,
    overrides,
    assets,
  };
}

export function soundName(settings: SoundSettings, id: string): string {
  if (id === 'builtin:end') return '内置结束提示音';
  const kind = clickKinds.find((key) => id === `builtin:${key}`);
  return kind ? `内置${soundLabels[kind]}` : settings.assets.find((asset) => asset.id === id)?.name ?? '未知音效';
}

export type SoundEvent = { timeMs: number; group: GroupKey; ordinal: number };

export function soundTimeline(clicks: ClickEvent[], settings: SoundSettings): SoundEvent[] {
  const counts: Partial<Record<GroupKey, number>> = {};
  return clicks.filter((event) => event.timeMs >= 0).map((event) => {
    const result = resultKey(event.kind, event.changed);
    const group = settings.overrides[result] ? result : event.kind;
    const ordinal = counts[group] ?? 0;
    counts[group] = ordinal + 1;
    return { timeMs: event.timeMs, group, ordinal };
  });
}

let database: Promise<IDBDatabase> | undefined;
const upgradeBlocked = ref(false);
export const soundStorageUpgradeBlocked = readonly(upgradeBlocked);
export const soundStorageBlockedMessage = '音效设置正在等待升级。请关闭仍打开旧版 Anon Player 的标签页，升级会自动继续。';

function openDatabase(): Promise<IDBDatabase> {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    // Version 1 contains the legacy current-working-settings store. Version 2
    // adds a separate store so named snapshots never overwrite that setting.
    const request = indexedDB.open('anon-player', 2);
    request.onblocked = () => { upgradeBlocked.value = true; };
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
      if (!db.objectStoreNames.contains('soundProfiles')) db.createObjectStore('soundProfiles', { keyPath: 'id' });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        database = undefined;
      };
      db.onclose = () => { database = undefined; };
      upgradeBlocked.value = false;
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  }).catch((error: unknown) => {
    database = undefined;
    upgradeBlocked.value = false;
    throw error;
  });
  return database;
}

export async function readSounds(): Promise<SoundSettings | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('settings').objectStore('settings').get('sounds');
    request.onsuccess = () => resolve(request.result === undefined ? undefined : normalizeSoundSettings(request.result));
    request.onerror = () => reject(request.error);
  });
}

export async function saveSounds(settings: SoundSettings, profileId?: string): Promise<void> {
  const snapshot = cloneSoundSettings(settings);
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('settings', 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
    // Clone before crossing the storage boundary; settings may be a Vue Proxy.
    const store = transaction.objectStore('settings');
    store.put(snapshot, 'sounds');
    // A reload must see either the previous pair or the newly applied pair.
    if (profileId !== undefined) store.put(profileId, selectedProfileKey);
  });
}

function createProfileId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    return Array.from(globalThis.crypto.getRandomValues(new Uint32Array(3)), (part) => part.toString(36)).join('-');
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function asProfile(value: unknown): SoundProfile | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || !isRecord(value.settings)) return undefined;
  return {
    id: value.id,
    name: value.name,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
    settings: normalizeSoundSettings(value.settings),
  };
}

const selectedProfileKey = 'sound-profile-selection';

export async function readSoundProfileSelection(): Promise<string | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('settings').objectStore('settings').get(selectedProfileKey);
    request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function listSoundProfiles(): Promise<SoundProfileInfo[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('soundProfiles').objectStore('soundProfiles').getAll();
    request.onsuccess = () => {
      const profiles = (request.result as unknown[]).flatMap((value) => {
        const profile = asProfile(value);
        return profile ? [{ id: profile.id, name: profile.name, updatedAt: profile.updatedAt }] : [];
      });
      profiles.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
      resolve(profiles);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function readSoundProfile(id: string): Promise<SoundSettings> {
  if (id === 'default') {
    const { loadDefaultSoundProfile } = await import('./defaultSoundProfile');
    return loadDefaultSoundProfile();
  }
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('soundProfiles').objectStore('soundProfiles').get(id);
    request.onsuccess = () => {
      const profile = asProfile(request.result);
      if (!profile) { reject(new Error('找不到所选音效配置。')); return; }
      resolve(cloneSoundSettings(profile.settings));
    };
    request.onerror = () => reject(request.error);
  });
}

export async function saveSoundProfile(name: string, settings: SoundSettings, overwriteId?: string): Promise<SoundProfileInfo> {
  const cleanName = name.trim();
  if (!cleanName) throw new Error('请输入配置名称。');
  if (cleanName === '默认配置') throw new Error('该名称已留给项目默认配置。');
  if (cleanName === '当前工作设置') throw new Error('该名称已留给当前工作设置，请使用其他名称。');
  const snapshot = cloneSoundSettings(settings);
  const db = await openDatabase();
  return new Promise<SoundProfileInfo>((resolve, reject) => {
    // Name checks, the snapshot, working settings and selection commit together.
    // Resolve only after commit; any failed write must roll back an overwrite too.
    const transaction = db.transaction(['soundProfiles', 'settings'], 'readwrite');
    const store = transaction.objectStore('soundProfiles');
    let result: SoundProfileInfo | undefined;
    let failure: unknown;
    transaction.oncomplete = () => {
      if (result) resolve(result);
      else reject(new Error('无法保存此音效配置。'));
    };
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('无法保存此音效配置。'));
    const abort = (reason: unknown) => {
      failure = reason;
      try { transaction.abort(); } catch { reject(reason); }
    };
    const existing = store.getAll();
    existing.onsuccess = () => {
      try {
        const matches = (existing.result as SoundProfile[]).filter((profile) => profile.name?.trim() === cleanName);
        if (overwriteId && !matches.some(({ id }) => id === overwriteId)) {
          abort(new Error('要更新的配置已变更。请重新输入名称后保存。'));
          return;
        }
        if (!overwriteId && matches.length) {
          const message = matches.length > 1 ? new Error('存在多个同名配置。请使用其他名称，或先选择要更新的配置。')
            : new SoundProfileNameConflict(matches[0].id, cleanName);
          abort(message);
          return;
        }
        const profileId = overwriteId ?? createProfileId();
        const profile: SoundProfile = {
          id: profileId,
          name: cleanName,
          updatedAt: Date.now(),
          settings: snapshot,
        };
        store.put(profile);
        const working = transaction.objectStore('settings');
        working.put(snapshot, 'sounds');
        working.put(profileId, selectedProfileKey);
        result = { id: profileId, name: cleanName, updatedAt: profile.updatedAt };
      } catch (reason) { abort(reason); }
    };
  });
}
