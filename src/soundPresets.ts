import type { SoundAsset } from './soundSettings';

export type SoundPreset = { id: string; name: string; path: string };

// Paths are relative to public/sounds/profiles/default/.
export const soundPresets: readonly SoundPreset[] = [
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
  { id: 'anon', name: '爱音唐哭', path: '爱音.wav' },
];

export async function loadSoundPreset(preset: SoundPreset, signal?: AbortSignal): Promise<SoundAsset> {
  const base = new URL(import.meta.env.BASE_URL, document.baseURI);
  const path = preset.path.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(new URL(`sounds/profiles/default/${path}`, base), { signal });
  if (!response.ok) throw new Error(`无法读取预设音效：${preset.name}`);
  return { id: preset.id, name: preset.name, file: await response.blob() };
}
