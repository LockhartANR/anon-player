import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

// Load the browser's actual TypeScript evaluator without loading the WASM replay parser.
const source = async (name) => readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
const asModule = (text) => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(text, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
}).outputText).toString('base64')}`;
const fields = asModule(await source('counterFields'));
const counters = await import(asModule((await source('counters'))
  .replace("'./counterFields'", JSON.stringify(fields))
  .replace("'jsep'", JSON.stringify(import.meta.resolve('jsep')))));
const { compileCounter, formatCounterValue, defaultCounterRows, parseCounterConfig, readCounters, saveCounters, serializeCounters } = counters;
const display = (formula, values = {}) => formatCounterValue(compileCounter(formula)(values));
const storage = new Map();
globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };

test('arithmetic, unary operators, concatenation, escaped strings, and numeric zero', () => {
  assert.equal(display('-((2 + 3) ** 2)'), '-25');
  assert.equal(display('0 || "/" || roundTo(2 / 3, 3)'), '0/0.667');
  assert.equal(display('"引号 \\\" 与 \\\\" || " / " || 0'), '引号 " 与 \\ / 0');
  assert.equal(display('roundTo(roundTo(1.256, 2) * 2, 3)'), '2.520');
  assert.equal(display('rtime || "/" || duration', { rtime: 12, duration: 12 }), '12/12');
});

test('invalid or missing numeric fragments display a dash and preserve other fragments', () => {
  for (const formula of ['1 / 0', '0 % 0', '10 ** 1000', 'ce', 'roundTo(ce, 3)', '"x" * 2']) {
    assert.equal(display(formula), '—', formula);
  }
  assert.equal(display('roundTo(1 / 0, 3) || "@" || 0 || "/ok"'), '—@0/ok');
});

test('roundTo preserves signed zero in display and concatenation, and uses the rounded value in arithmetic', () => {
  assert.equal(display('roundTo(-0.004, 2)'), '-0.00');
  assert.equal(display('roundTo(-0.004, 2) || " / " || roundTo(0.004, 2)'), '-0.00 / 0.00');
  assert.equal(display('1 + roundTo(-0.004, 2)'), '1');
});

test('controlled parser rejects unknown fields, arbitrary calls, access and invalid precision', () => {
  for (const formula of ['missing', 'Math.random()', 'ce.constructor', 'roundTo(1, 7)', 'roundTo(1, -1)',
    'roundTo(1, 1.5)', 'roundTo(1)', 'true', '[1, 2]', 'ce = 1', '1; 2', '!ce', 'ce && cl']) {
    assert.throws(() => compileCounter(formula), undefined, formula);
  }
});

test('default rows round-trip as JSON and evaluate', () => {
  const rows = parseCounterConfig(JSON.stringify(defaultCounterRows));
  assert.deepEqual(JSON.parse(serializeCounters(rows)), defaultCounterRows);
  for (const row of rows) assert.equal(typeof display(row.formula), 'string');
});

test('JSON validation reports row number, accepts empty list, and rejects malformed rows', () => {
  assert.deepEqual(parseCounterConfig('[]'), []);
  assert.throws(() => parseCounterConfig('['), /JSON/);
  assert.throws(() => parseCounterConfig('{}'), /数组/);
  assert.throws(() => parseCounterConfig('[["ok", "0"], ["bad", "missing"]]'), /第 2 行.*missing/);
  for (const row of [['name'], ['name', '0', 'extra'], ['', '0'], ['x', 0]]) {
    assert.throws(() => parseCounterConfig(JSON.stringify([row])), /第 1 行/);
  }
});

test('migration appends legacy rows in order with exact precision and persists only once', () => {
  storage.clear();
  storage.set('anon-player:counters', JSON.stringify([
    { id: 'old1', name: '旧比例', formula: '100 * bbbv_solved / bbbv', digits: 4 },
    { id: 'old3', name: '旧差值', formula: 'etime - duration', digits: 2 },
    { id: 'old2', name: '旧点击', formula: 'cl', digits: 0 },
  ]));
  const rows = readCounters();
  const migrated = rows.slice(defaultCounterRows.length);
  assert.equal(migrated.length, 3);
  assert.equal(display(migrated[0].formula, { bbbv_solved: 1, bbbv: 3 }), '33.3333');
  assert.equal(display(migrated[1].formula, { etime: 0.996, duration: 1 }), '-0.00');
  assert.equal(display(migrated[2].formula, { cl: 5 }), '5');
  assert.deepEqual(serializeCounters(readCounters()), serializeCounters(rows));
  saveCounters([]);
  assert.deepEqual(readCounters(), []);
});
