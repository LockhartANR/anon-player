import jsep from 'jsep';
import { valueNames } from './counterFields';
import type { Values } from './replay';

export type Counter = { id: string; name: string; formula: string };
type Rounded = { value: number; text: string };
export type CounterValue = number | string | Rounded;
type Evaluate = (values: Values) => CounterValue;
const variables = new Set<string>(valueNames);
const storageKey = 'anon-player:counters:v2';
const legacyKey = 'anon-player:counters';
const binary: Record<string, (a: number, b: number) => number> = {
  '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b,
  '/': (a, b) => b === 0 ? NaN : a / b, '%': (a, b) => a % b, '**': (a, b) => a ** b,
};

export const defaultCounterRows: readonly (readonly [string, string])[] = [
  ['time', 'roundTo(etime, 3) || "/" || roundTo(rtime, 3)'],
  ['3bv', 'bbbv_solved || "/" || bbbv'],
  ['bvs', 'roundTo(bbbv_s, 3)'],
  ['stnb', 'roundTo(stnb, 3)'],
  ['opis', 'op || "op " || isl || "is"'],
  ['left', 'left || "@" || roundTo(left_s, 3)'],
  ['right', 'right || "@" || roundTo(right_s, 3)'],
  ['double', 'double || "@" || roundTo(double_s, 3)'],
  ['ce', 'ce || "@" || roundTo(ce_s, 3)'],
  ['cl', 'cl || "@" || roundTo(cl_s, 3)'],
  ['corr*thrp', 'roundTo(corr, 3) || "*" || roundTo(thrp, 3)'],
  ['ioe', 'roundTo(ioe, 3)'],
  ['mov', 'roundTo(path / 16, 3) || "@" || roundTo(path / 16 / bbbv_solved * bbbv_s, 3)'],
];

export function createDefaultCounters(): Counter[] {
  return defaultCounterRows.map(([name, formula]) => ({ id: crypto.randomUUID(), name, formula }));
}

function numeric(value: CounterValue): number {
  return typeof value === 'number' ? value : typeof value === 'object' ? value.value : NaN;
}

export function formatCounterValue(value: CounterValue | undefined): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return value.text;
  return value !== undefined && Number.isFinite(value) ? String(value) : '—';
}

function compile(node: jsep.Expression): Evaluate {
  if (node.type === 'Literal' && (typeof node.value === 'number' || typeof node.value === 'string')) {
    const value = node.value;
    return () => value;
  }
  if (node.type === 'Identifier') {
    const name = (node as jsep.Identifier).name;
    if (!variables.has(name)) throw new Error(`未知字段 ${name}`);
    return (values) => values[name as keyof Values] ?? NaN;
  }
  if (node.type === 'UnaryExpression') {
    const { operator, argument } = node as jsep.UnaryExpression;
    if (operator === '+' || operator === '-') {
      const evaluate = compile(argument);
      return (values) => (operator === '-' ? -1 : 1) * numeric(evaluate(values));
    }
  }
  if (node.type === 'BinaryExpression') {
    const { operator, left, right } = node as jsep.BinaryExpression;
    if (operator === '||') {
      const a = compile(left), b = compile(right);
      return (values) => formatCounterValue(a(values)) + formatCounterValue(b(values));
    }
    if (Object.hasOwn(binary, operator)) {
      const evaluateLeft = compile(left), evaluateRight = compile(right);
      return (values) => {
        const a = numeric(evaluateLeft(values)), b = numeric(evaluateRight(values));
        return Number.isFinite(a) && Number.isFinite(b) ? binary[operator](a, b) : NaN;
      };
    }
  }
  if (node.type === 'CallExpression') {
    const { callee, arguments: args } = node as jsep.CallExpression;
    if (callee.type !== 'Identifier' || (callee as jsep.Identifier).name !== 'roundTo') {
      throw new Error('只支持 roundTo(value, digits) 函数。');
    }
    if (args.length !== 2) throw new Error('roundTo 需要数值和小数位数两个参数。');
    const digitsNode = args[1] as jsep.Literal;
    const digits = digitsNode.value;
    if (digitsNode.type !== 'Literal' || typeof digits !== 'number' || !Number.isInteger(digits) || digits < 0 || digits > 6) {
      throw new Error('roundTo 的小数位数须为 0 到 6 的整数常量。');
    }
    const evaluate = compile(args[0]);
    return (values) => {
      const number = numeric(evaluate(values));
      const text = formatNumber(number, digits);
      return { value: Number(text), text };
    };
  }
  throw new Error('表达式只接受数字、字符串、字段、算术、|| 拼接和 roundTo 函数。');
}

export function compileCounter(formula: string): Evaluate {
  if (!formula.trim()) throw new Error('请输入表达式。');
  if (formula.length > 2048) throw new Error('表达式最多 2048 个字符。');
  return compile(jsep(formula));
}

export function compileCounters(counters: readonly Counter[]) {
  return counters.map((counter) => {
    let evaluate: Evaluate | undefined;
    try { evaluate = compileCounter(counter.formula); }
    catch { /* Unavailable formulas display as a dash. */ }
    return { ...counter, evaluate };
  });
}

function formatNumber(value: number, digits: number): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

export function validateCounter(name: string, formula: string) {
  if (!name.trim()) throw new Error('请输入名称。');
  if (name.trim().length > 48) throw new Error('名称最多 48 个字符。');
  compileCounter(formula);
}

export function parseCounterConfig(text: string): Counter[] {
  let rows: unknown;
  try { rows = JSON.parse(text); } catch { throw new Error('JSON 格式无效，请检查引号、逗号和括号。'); }
  if (!Array.isArray(rows)) throw new Error('配置须为 JSON 数组。');
  return rows.map((row: unknown, index: number) => {
    try {
      if (!Array.isArray(row) || row.length !== 2 || !row.every((value) => typeof value === 'string')) {
        throw new Error('每行须为 ["名称", "表达式"] 两个字符串。');
      }
      const [name, formula] = row as [string, string];
      validateCounter(name, formula);
      return { id: crypto.randomUUID(), name: name.trim(), formula: formula.trim() };
    } catch (error) { throw new Error(`第 ${index + 1} 行：${error instanceof Error ? error.message : '配置无效。'}`); }
  });
}

export function serializeCounters(counters: readonly Counter[]): string {
  return JSON.stringify(counters.map(({ name, formula }) => [name, formula]), null, 2);
}

export function saveCounters(counters: readonly Counter[]) {
  localStorage.setItem(storageKey, serializeCounters(counters));
}

export function readCounters(): Counter[] {
  try {
    const saved = localStorage.getItem(storageKey);
    // A saved empty array is intentional, and must not be replaced by defaults.
    if (saved !== null) return parseCounterConfig(saved);
    const counters = createDefaultCounters();
    const legacy: unknown = JSON.parse(localStorage.getItem(legacyKey) ?? '[]');
    if (Array.isArray(legacy)) for (const row of legacy) {
      if (typeof row?.name !== 'string' || typeof row.formula !== 'string'
        || !Number.isInteger(row.digits) || row.digits < 0 || row.digits > 6) continue;
      const formula = `roundTo((${row.formula}), ${row.digits})`;
      try {
        validateCounter(row.name, formula);
        counters.push({ id: crypto.randomUUID(), name: row.name, formula });
      } catch { /* Invalid old formulas were unavailable in the previous player too. */ }
    }
    try { saveCounters(counters); } catch { /* Keep migrated rows usable even when browser storage is full. */ }
    return counters;
  } catch { return createDefaultCounters(); }
}
