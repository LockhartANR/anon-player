import { defaultSounds } from './soundSettings';
import type { SoundGroup, SoundMode, SoundSettings } from './soundSettings';

const DEFAULT_SOUND_RESOURCE_DIRECTORY = 'sounds/profiles/default';

type DefaultSoundResource = { id: string; name: string; path: string };

// Paths are relative to public/sounds/profiles/default/.
const DEFAULT_SOUND_RESOURCES: readonly DefaultSoundResource[] = [
  { id: 'bing', name: '冰', path: '冰.wav' },
  { id: 'ng', name: '嗯？', path: '嗯？.wav' },
  { id: 'angry', name: '怒', path: '怒.wav' },
  { id: 'fart', name: '屁', path: '屁.wav' },
  { id: 'sigh', name: '叹气', path: '叹气.wav' },
  { id: 'nailong1', name: '奶龙1', path: '奶龙1.mp3' },
  { id: 'nailong2', name: '奶龙2', path: '奶龙2.mp3' },
  { id: 'nailong3', name: '奶龙3', path: '奶龙3.mp3' },
  { id: 'nailong4', name: '奶龙4', path: '奶龙4.mp3' },
  { id: 'nailong5', name: '奶龙5', path: '奶龙5.mp3' },
  { id: 'kskbl', name: '真的很帅', path: '真的很帅.wav' },
  { id: 'wow', name: 'wow', path: 'wow.mp3' },
  { id: 'anon', name: '爱音唐哭', path: '爱音.wav' }
];

function createGroup(mode: SoundMode, ids: string[]): SoundGroup {
  return { mode, ids, fixedId: mode === 'fixed' ? ids[0] ?? '' : '', volume: 1, clipVolumes: {} };
}

export async function loadDefaultSoundProfile(): Promise<SoundSettings> {
  const settings = defaultSounds();
  settings.volume = 0.65;

  settings.groups.left = createGroup('fixed', ['bing']);
  settings.groups.right = createGroup('random', ['ng', 'angry', 'fart', 'sigh']);
  settings.groups.double = createGroup('sequence', ['nailong1', 'nailong2', 'nailong3', 'nailong4', 'nailong5']);
  settings.groups.end = createGroup('random', ['kskbl', 'wow', 'anon']);

  const baseUrl = import.meta.env.BASE_URL;
  for (const resource of DEFAULT_SOUND_RESOURCES) {
    const path = resource.path.replace(/^\/+/, '');
    const url = new URL(`${baseUrl}${DEFAULT_SOUND_RESOURCE_DIRECTORY}/${path}`, document.baseURI);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`无法读取默认音效：${resource.name}`);
    settings.assets.push({ id: resource.id, name: resource.name, file: await response.blob() });
  }
  return settings;
}
