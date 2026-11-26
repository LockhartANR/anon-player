import { defaultMouseTraceMarkers, mouseTraceMarkerActions } from '@putianyi888/vue3-minesweeper-board';
import type { MouseTraceMarkers } from '@putianyi888/vue3-minesweeper-board';

export const trainingAppearance = {
  opacity: 0,
  lineWidth: 0.08,
  markers: Object.fromEntries(mouseTraceMarkerActions.map((action) => [action, { ...defaultMouseTraceMarkers[action], size: 0.25 }])) as MouseTraceMarkers,
};
