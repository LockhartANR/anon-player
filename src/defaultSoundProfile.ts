import { defaultSounds } from './soundSettings';
import type { SoundGroup, SoundMode, SoundSettings } from './soundSettings';
import { loadSoundPreset, soundPresets } from './soundPresets';

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

  for (const preset of soundPresets) settings.assets.push(await loadSoundPreset(preset));
  return settings;
}
