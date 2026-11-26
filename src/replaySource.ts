import { Replay } from './replay';
import type { PlayableReplay } from './replay';
import { parseTrainingFile, TrainingReplay } from './trainingReplay';
import type { TrainingFile } from './trainingReplay';

export function isTrainingFilename(filename: string): boolean {
  return filename.split('.').at(-1)?.toLowerCase() === 'json';
}

export function openReplay(filename: string, bytes: ArrayBuffer, file?: TrainingFile): PlayableReplay {
  return isTrainingFilename(filename)
    ? new TrainingReplay(filename, file ?? parseTrainingFile(bytes)) : Replay.open(filename, bytes);
}
