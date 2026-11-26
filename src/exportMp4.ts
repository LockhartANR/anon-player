import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, canEncodeAudio, canEncodeVideo } from 'mediabunny';
import type { Counter } from './counters';
import { exportSampleRate, writeExportAudio } from './exportAudio';
import type { ExportMusic } from './exportAudio';
import { createExportPicture } from './exportPicture';
import type { ExportPlan, ExportVideoSettings } from './exportPlan';
import type { PlayableReplay } from './replay';
import { openReplay } from './replaySource';

export async function exportMp4(plan: ExportPlan, settings: ExportVideoSettings, counters: Counter[], music: ExportMusic | undefined, signal: AbortSignal, progress: (ratio: number) => void, trainingCounters: Counter[]): Promise<Blob> {
  signal.throwIfAborted();
  const { width, height, fps, bitrate } = settings;
  const frameDuration = 1 / fps;
  const frameCount = Math.ceil(plan.duration * fps - 1e-8);
  if (!plan.segments.length || !Number.isSafeInteger(frameCount) || frameCount < 1) throw new Error('请检查录像列表和停留时间。');
  const withAudio = plan.cues.length > 0 || (music !== undefined && music.volume > 0);
  const videoEncoding = { bitrate, latencyMode: 'quality' } as const;
  const audioEncoding = { bitrate: 160_000 };
  const [videoSupported, audioSupported] = await Promise.all([
    canEncodeVideo('avc', { width, height, frameRate: fps, ...videoEncoding }),
    withAudio ? canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: exportSampleRate, ...audioEncoding }) : true,
  ]);
  signal.throwIfAborted();
  if (!videoSupported) {
    throw new Error(`当前浏览器无法以 ${width}×${height}、${fps} fps、${bitrate / 1e6} Mbps 编码 H.264，请调低视频参数或换一个支持 H.264 编码的浏览器。`);
  }
  if (!audioSupported) throw new Error('当前浏览器无法使用 AAC 编码，请用支持 AAC 编码的浏览器打开。');

  const picture = createExportPicture(counters, width, height, trainingCounters);
  try {
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target });
    const video = new CanvasSource(picture.canvas, { codec: 'avc', ...videoEncoding });
    const audio = withAudio ? new AudioBufferSource({ codec: 'aac', ...audioEncoding }) : undefined;
    output.addVideoTrack(video, { frameRate: fps });
    if (audio) output.addAudioTrack(audio);

    let cancellation: Promise<void> | undefined;
    function cancel() {
      cancellation ??= output.cancel();
      void cancellation.catch(() => undefined);
    }
    signal.addEventListener('abort', cancel, { once: true });

    async function writeVideo() {
      let segmentIndex = 0;
      let activeSegment = -1;
      let replay: PlayableReplay | undefined;
      let lastYield = performance.now();
      try {
        for (let index = 0; index < frameCount; index++) {
          signal.throwIfAborted();
          const timestamp = index / fps;
          while (segmentIndex < plan.segments.length - 1 && timestamp >= plan.segments[segmentIndex].end) segmentIndex++;
          // Even with zero hold, commit the final replay state to the final video frame.
          if (index === frameCount - 1) segmentIndex = plan.segments.length - 1;
          const { replay: input, start } = plan.segments[segmentIndex];
          if (activeSegment !== segmentIndex) {
            replay?.close();
            replay = undefined;
            replay = openReplay(input.filename, input.bytes);
            activeSegment = segmentIndex;
          }
          const localMs = index === frameCount - 1 ? input.durationMs : Math.min(input.durationMs, (timestamp - start) * 1000);
          await picture.draw(replay!, localMs, signal);
          await video.add(timestamp, Math.min(frameDuration, plan.duration - timestamp));
          if (performance.now() - lastYield >= 40 || index === frameCount - 1) {
            progress((index + 1) / frameCount * .98);
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            lastYield = performance.now();
          }
        }
        video.close();
      } finally {
        replay?.close();
      }
    }

    const writers: Promise<void>[] = [];
    try {
      signal.throwIfAborted();
      await output.start();
      if (audio) writers.push(writeExportAudio(audio, plan.duration, plan.cues, music, signal).then(() => audio.close()));
      writers.push(writeVideo());
      await Promise.all(writers);
      signal.throwIfAborted();
      await output.finalize();
      signal.throwIfAborted();
      if (!target.buffer) throw new Error('编码器没有生成视频文件。');
      return new Blob([target.buffer], { type: 'video/mp4' });
    } catch (error) {
      cancel();
      await Promise.allSettled([...writers, cancellation]);
      throw error;
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  } finally { picture.close(); }
}
