import { clickKinds, eventBoundary } from './replay';
import { soundTimeline } from './soundSettings';
import type { ClickEvent } from './replay';
import type { GroupKey, SoundEvent, SoundGroup, SoundSettings } from './soundSettings';

type PlaybackAnchor = { wallTime: number; position: number; rate: number };
type Voice = { source: AudioBufferSourceNode; gain: GainNode; group: GroupKey; id: string };
const lookAheadSeconds = 0.12;
const maximumLateness = 0.1;

export function soundLevel(group: SoundGroup | undefined, id: string): number {
  return (group?.volume ?? 1) * (group?.clipVolumes[id] ?? 1);
}

export function selectSound(group: SoundGroup, ordinal: number, getBuffer: (id: string) => AudioBuffer | undefined) {
  if (group.mode === 'mute') return undefined;
  if (group.mode === 'fixed') {
    const buffer = getBuffer(group.fixedId);
    return buffer ? { id: group.fixedId, buffer } : undefined;
  }
  const available = group.ids.flatMap((id) => {
    const buffer = getBuffer(id);
    return buffer ? [{ id, buffer }] : [];
  });
  const index = group.mode === 'random' ? Math.floor(Math.random() * available.length) : ordinal % available.length;
  return available[index];
}

function defaultClip(context: BaseAudioContext, index: number): AudioBuffer {
  const duration = index === 2 ? 0.09 : 0.06;
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const data = buffer.getChannelData(0);
  const frequency = [880, 510, 670][index];
  for (let sample = 0; sample < data.length; sample++) {
    const t = sample / context.sampleRate;
    const envelope = Math.sin(Math.PI * Math.min(1, t / 0.004) / 2) * Math.exp(-t * 67) * (1 - t / duration);
    const phase = 2 * Math.PI * frequency * t;
    const harmonics = Math.sin(phase) + 0.3 * Math.sin(phase * (index === 2 ? 1.48 : 2.6));
    data[sample] = 0.55 * envelope * harmonics;
  }
  return buffer;
}

function completionClip(context: BaseAudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.28), context.sampleRate);
  const data = buffer.getChannelData(0);
  for (const [offset, frequency] of [[0, 660], [0.09, 880]]) {
    const firstSample = Math.round(offset * context.sampleRate);
    const length = Math.floor(context.sampleRate * 0.18);
    for (let sample = 0; sample < length; sample++) {
      const t = sample / context.sampleRate;
      const envelope = Math.min(1, t / 0.008) * Math.exp(-20 * t) * (1 - sample / length);
      data[firstSample + sample] += 0.36 * envelope * Math.sin(2 * Math.PI * frequency * t);
    }
  }
  return buffer;
}

export class ClickAudio {
  private context?: AudioContext;
  private gain?: GainNode;
  private decoder?: OfflineAudioContext;
  private buffers = new Map<string, AudioBuffer>();
  private active = new Set<Voice>();
  private audition?: Voice;
  private events: SoundEvent[] = [];
  private timer?: number;
  private anchor?: PlaybackAnchor;
  private nextEvent = 0;
  private settings?: SoundSettings;
  private volume = 0.65;

  private decodingContext(): OfflineAudioContext {
    return this.decoder ??= new OfflineAudioContext(1, 1, 44100);
  }

  unlock(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
      this.gain = this.context.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.context.destination);
    }
    return this.context.state === 'running' ? Promise.resolve() : this.context.resume();
  }

  rememberDecoded(id: string, buffer: AudioBuffer) {
    this.buffers.set(id, buffer);
  }

  async decodeFile(file: Blob) {
    return this.decodingContext().decodeAudioData(await file.arrayBuffer());
  }

  forget(id: string) { this.buffers.delete(id); }

  buffer(id: string): AudioBuffer | undefined {
    if (id === 'builtin:end' && !this.buffers.has(id)) this.buffers.set(id, completionClip(this.decodingContext()));
    const index = clickKinds.findIndex((kind) => id === `builtin:${kind}`);
    if (index >= 0 && !this.buffers.has(id)) this.buffers.set(id, defaultClip(this.decodingContext(), index));
    return this.buffers.get(id);
  }

  configure(clicks: ClickEvent[], settings: SoundSettings) {
    this.events = soundTimeline(clicks, settings);
    this.setMix(settings);
  }

  setMix(settings: SoundSettings) {
    this.settings = settings;
    this.volume = settings.muted ? 0 : settings.volume;
    if (!this.context || !this.gain) return;
    const now = this.context.currentTime;
    this.gain.gain.setTargetAtTime(this.volume, now, 0.012);
    for (const voice of this.active) voice.gain.gain.setTargetAtTime(this.level(voice.group, voice.id), now, 0.012);
    if (this.audition) {
      const { gain, group, id } = this.audition;
      gain.gain.setTargetAtTime(this.level(group, id), now, 0.012);
    }
  }

  private level(group: GroupKey, id: string): number {
    return soundLevel(this.settings?.groups[group], id);
  }

  async preview(group: GroupKey, id: string, { signal, loadBuffer }: {
    signal?: AbortSignal; loadBuffer?: () => Promise<AudioBuffer>;
  } = {}) {
    await this.unlock();
    signal?.throwIfAborted();
    const buffer = this.buffer(id) ?? await loadBuffer?.();
    signal?.throwIfAborted();
    if (!buffer) throw new Error('此音效无法播放。');
    this.audition?.source.stop();
    const voice = this.makeVoice(group, id, buffer);
    this.audition = voice;
    const stop = () => voice.source.stop();
    signal?.addEventListener('abort', stop, { once: true });
    voice.source.onended = () => {
      signal?.removeEventListener('abort', stop);
      if (this.audition === voice) this.audition = undefined;
      this.disconnect(voice);
    };
    voice.source.start();
  }

  private makeVoice(group: GroupKey, id: string, buffer: AudioBuffer): Voice {
    const source = this.context!.createBufferSource();
    const gain = this.context!.createGain();
    source.buffer = buffer;
    gain.gain.value = this.level(group, id);
    source.connect(gain);
    gain.connect(this.gain!);
    return { source, gain, group, id };
  }

  private disconnect(voice: Voice) {
    voice.source.disconnect();
    voice.gain.disconnect();
  }

  private playVoice(group: GroupKey, id: string, buffer: AudioBuffer, startTime: number) {
    const voice = this.makeVoice(group, id, buffer);
    voice.source.onended = () => {
      this.active.delete(voice);
      this.disconnect(voice);
    };
    this.active.add(voice);
    voice.source.start(startTime);
  }

  private playGroup(key: GroupKey, ordinal: number, startTime: number) {
    const group = this.settings?.groups[key];
    const clip = group && selectSound(group, ordinal, (id) => this.buffer(id));
    if (clip) this.playVoice(key, clip.id, clip.buffer, startTime);
  }

  start(anchor: PlaybackAnchor, includeStart: boolean, fromMs = anchor.position) {
    this.stop();
    if (this.settings?.muted || !this.events.length) return;
    this.anchor = anchor;
    this.nextEvent = eventBoundary(this.events, fromMs, (event) => event.timeMs, includeStart);
    this.tick();
    this.timer = window.setInterval(() => this.tick(), 24);
  }

  private tick() {
    const context = this.context;
    const anchor = this.anchor;
    if (!anchor || !context || context.state !== 'running') return;
    const position = anchor.position + (performance.now() - anchor.wallTime) * anchor.rate;
    const horizon = position + lookAheadSeconds * 1000 * anchor.rate;
    while (this.nextEvent < this.events.length && this.events[this.nextEvent].timeMs <= horizon) {
      const event = this.events[this.nextEvent++];
      const offset = (event.timeMs - position) / (1000 * anchor.rate);
      if (offset < -maximumLateness) continue;
      this.playGroup(event.group, event.ordinal, context.currentTime + Math.max(0, offset));
    }
  }

  finish() {
    this.tick();
    this.stop(false);
    if (!this.settings?.muted && this.context?.state === 'running') {
      this.playGroup('end', 0, this.context.currentTime);
    }
  }

  stop(cancelScheduled = true) {
    window.clearInterval(this.timer);
    this.timer = undefined;
    this.anchor = undefined;
    if (!cancelScheduled) return;
    for (const voice of this.active) {
      voice.source.onended = null;
      voice.source.stop();
      this.disconnect(voice);
    }
    this.active.clear();
  }

  dispose() {
    this.stop();
    this.audition?.source.stop();
    void this.context?.close().catch(() => {});
  }
}
