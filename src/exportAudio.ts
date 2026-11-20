import type { AudioBufferSource } from 'mediabunny';
import type { AudioCue } from './exportPlan';

export type ExportMusic = { buffer: AudioBuffer; volume: number };
export const exportSampleRate = 48000;

export async function writeExportAudio(source: AudioBufferSource, duration: number, cues: AudioCue[], music: ExportMusic | undefined, signal: AbortSignal) {
  const sampleCount = Math.max(1, Math.round(duration * exportSampleRate));
  const blockSize = 2 * exportSampleRate;
  let nextCue = 0;
  let active: AudioCue[] = [];
  for (let offset = 0; offset < sampleCount; offset += blockSize) {
    signal.throwIfAborted();
    const size = Math.min(blockSize, sampleCount - offset);
    const start = offset / exportSampleRate;
    const end = (offset + size) / exportSampleRate;
    const mix = new OfflineAudioContext(2, size, exportSampleRate);
    active = active.filter((cue) => cue.start + cue.buffer.duration > start);
    while (nextCue < cues.length && cues[nextCue].start < end) active.push(cues[nextCue++]);

    function connect(buffer: AudioBuffer, level: number) {
      const clip = mix.createBufferSource();
      const gain = mix.createGain();
      clip.buffer = buffer;
      gain.gain.value = level;
      clip.connect(gain).connect(mix.destination);
      return clip;
    }

    if (music && music.volume > 0) {
      const background = connect(music.buffer, music.volume);
      background.loop = true;
      background.start(0, start % music.buffer.duration);
    }
    for (const cue of active) connect(cue.buffer, cue.gain).start(Math.max(0, cue.start - start), Math.max(0, start - cue.start));
    const audio = await mix.startRendering();
    signal.throwIfAborted();
    await source.add(audio);
  }
}
