import type { Values } from './replay';

export const boardFields = ['row', 'column', 'mine_num', 'pix_size', 'level', 'mode', 'bbbv', 'op', 'isl', 'zini', 'hzini',
  'cell0', 'cell1', 'cell2', 'cell3', 'cell4', 'cell5', 'cell6', 'cell7', 'cell8'] as const;

export const counterFieldGroups = [
  { label: '用时与累计操作', fields: ['time', 'duration', 'rtime', 'bbbv_solved', 'left', 'right', 'double', 'lce', 'rce', 'dce', 'ce', 'cl', 'path'] },
  { label: '平均速度', fields: ['bbbv_s', 'cl_s', 'ce_s', 'left_s', 'right_s', 'double_s', 'lce_s', 'rce_s', 'dce_s', 'flag_s', 'path_s'] },
  { label: '效率', fields: ['corr', 'ioe', 'thrp'] },
  { label: '速度评分与折算用时', fields: ['stnb', 'etime', 'rqp', 'qg', 'iqg'] },
  { label: '棋盘与难度', fields: boardFields },
  { label: '小游戏训练', fields: ['total', 'solved', 'remaining', 'solved_s', 'ces'] },
] as const satisfies readonly { label: string; fields: readonly (keyof Values)[] }[];
export const valueNames = counterFieldGroups.flatMap(({ fields }) => [...fields]);
