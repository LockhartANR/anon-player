import { selectSound, soundLevel } from './audio';
import type { ClickEvent, PlayableReplay } from './replay';
import { soundTimeline } from './soundSettings';
import type { GroupKey, SoundSettings } from './soundSettings';

export type ExportVideoSettings = { width: number; height: number; fps: number; bitrate: number };

export type ExportReplay = {
  key: symbol;
  filename: string;
  bytes: ArrayBuffer;
  durationMs: number;
  playerIdentifier: string;
  clickEvents: ClickEvent[];
  holdSeconds: number | '';
};

export type AudioCue = { start: number; buffer: AudioBuffer; gain: number };
type ExportSegment = { replay: ExportReplay; start: number; end: number };

export function createExportReplay(replay: PlayableReplay, bytes: ArrayBuffer): ExportReplay {
  return {
    key: Symbol(), filename: replay.filename, bytes, durationMs: replay.durationMs,
    playerIdentifier: replay.playerIdentifier, clickEvents: replay.clickEvents, holdSeconds: 1,
  };
}

export function planReplayAudio(replay: ExportReplay, settings: SoundSettings, getBuffer: (id: string) => AudioBuffer | undefined): AudioCue[] {
  if (settings.muted || settings.volume <= 0) return [];
  const cues: AudioCue[] = [];
  function add(key: GroupKey, ordinal: number, timeMs: number) {
    const group = settings.groups[key];
    const clip = selectSound(group, ordinal, getBuffer);
    if (!clip) return;
    const gain = settings.volume * soundLevel(group, clip.id);
    if (gain > 0) cues.push({ start: timeMs / 1000, buffer: clip.buffer, gain });
  }
  for (const event of soundTimeline(replay.clickEvents, settings)) add(event.group, event.ordinal, event.timeMs);
  add('end', 0, replay.durationMs);
  return cues;
}

export function planExport(replays: ExportReplay[], cuesByReplay: ReadonlyMap<symbol, AudioCue[]>, fps: number) {
  const segments: ExportSegment[] = [];
  const cues: AudioCue[] = [];
  let position = 0;
  let audioEnd = 0;
  for (const replay of replays) {
    const hold = replay.holdSeconds === '' ? 0 : Math.max(0, replay.holdSeconds);
    const end = position + replay.durationMs / 1000 + hold;
    segments.push({ replay, start: position, end });
    for (const cue of cuesByReplay.get(replay.key) ?? []) {
      const start = position + cue.start;
      cues.push({ ...cue, start });
      audioEnd = Math.max(audioEnd, start + cue.buffer.duration);
    }
    position = end;
  }
  const tailSeconds = Math.max(0, audioEnd - position);
  const duration = segments.length ? Math.max(position, audioEnd, 1 / fps) : 0;
  return { segments, cues, duration, tailSeconds };
}

export type ExportPlan = ReturnType<typeof planExport>;
