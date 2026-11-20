import { defaultSounds } from './soundSettings';
import type { SoundSettings } from './soundSettings';

const DEFAULT_SOUND_RESOURCE_DIRECTORY = 'sounds/profiles/default';

export type DefaultSoundResource = { id: string; name: string; path: string };

/**
 * Project-owned resource manifest. Populate this list when default audio files
 * are provided; paths are relative to public/sounds/profiles/default/.
 */
export const DEFAULT_SOUND_RESOURCES: readonly DefaultSoundResource[] = [
  { id: 'bingbingbing', name: '冰冰冰', path: '冰冰冰.mp3' },
  { id: 'ng', name: '嗯', path: '嗯.mp3' },
  { id: 'angry', name: '怒', path: '怒.mp3' },
  { id: 'fart', name: '屁', path: '屁.mp3' },
  { id: 'nailong1', name: '奶龙1', path: '奶龙1.mp3' },
  { id: 'nailong2', name: '奶龙2', path: '奶龙2.mp3' },
  { id: 'nailong3', name: '奶龙3', path: '奶龙3.mp3' },
  { id: 'nailong4', name: '奶龙4', path: '奶龙4.mp3' },
  { id: 'nailong5', name: '奶龙5', path: '奶龙5.mp3' },
  { id: 'kskbl', name: '真的很帅', path: '真的很帅.wav' },
  { id: 'wow', name: 'wow', path: 'wow.mp3' },
  { id: 'anon', name: '爱音唐哭', path: '爱音.wav' }
];

/**
 * Apply the project sound profile on top of the built-in group settings.
 */
export async function loadDefaultSoundProfile(): Promise<SoundSettings> {
  const settings = defaultSounds();
  settings.volume = 0.65;

  settings.groups.left = {
    mode: 'fixed',
    ids: ['bingbingbing'],
    fixedId: 'bingbingbing',
    volume: 1,
    clipVolumes: {},
  };

  settings.groups.right = {
    mode: 'random',
    ids: ['ng', 'angry', 'fart'],
    fixedId: '',
    volume: 1,
    clipVolumes: {},
  };

  settings.groups.double = {
    mode: 'sequence',
    ids: ['nailong1', 'nailong2', 'nailong3', 'nailong4', 'nailong5'],
    fixedId: '',
    volume: 1,
    clipVolumes: {},
  };

  settings.groups.end = {
    mode: 'random',
    ids: ['kskbl', 'wow', 'anon'],
    fixedId: '',
    volume: 1,
    clipVolumes: {},
  };

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
