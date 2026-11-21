<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import Icon from './Icon.vue';
import { compileCounters, createDefaultCounters, formatCounterValue, parseCounterConfig, saveCounters, serializeCounters, validateCounter } from './counters';
import type { Counter } from './counters';
import { counterFieldGroups } from './counterFields';
import type { Values } from './replay';

const props = defineProps<{ counters: Counter[]; values?: Values }>();
const emit = defineEmits<{ change: [counters: Counter[]] }>();
const draft = ref<Counter>();
const developer = ref(false);
const configDraft = ref('');
const error = ref('');
const counterTable = ref<HTMLTableElement>();
const reorderThreshold = 6;
const scrollEdge = 64;
type DropTarget = { id: string; after: boolean };
const reorder = ref<{
  pointerId: number; sourceId: string; target?: DropTarget; dragging: boolean;
  x: number; y: number;
}>();
let reorderScrollFrame = 0;
const compiled = computed(() => compileCounters(props.counters));
const rows = computed(() => {
  const values = props.values;
  const displayed = compiled.value.map(({ evaluate, ...counter }) => ({
    ...counter, value: formatCounterValue(values && evaluate?.(values)),
  }));
  const editing = draft.value;
  if (editing && !displayed.some(({ id }) => id === editing.id)) displayed.push({ ...editing, value: '—' });
  return displayed;
});

function commit(next: Counter[]) {
  try { saveCounters(next); }
  catch { error.value = '计数器配置无法保存到此浏览器。'; return false; }
  emit('change', next);
  error.value = '';
  return true;
}
function edit(counter?: Counter) {
  error.value = '';
  draft.value = counter ? { ...counter } : { id: crypto.randomUUID(), name: '', formula: '' };
}
function cancel() { draft.value = undefined; error.value = ''; }
function save() {
  const row = draft.value;
  if (!row) return;
  try {
    validateCounter(row.name, row.formula);
    const next = [...props.counters];
    const index = next.findIndex((value) => value.id === row.id);
    const saved = { ...row, name: row.name.trim(), formula: row.formula.trim() };
    if (index < 0) next.push(saved); else next[index] = saved;
    if (commit(next)) draft.value = undefined;
  } catch (reason) { error.value = reason instanceof Error ? reason.message : '表达式无效。'; }
}
function remove(id: string) {
  if (commit(props.counters.filter((row) => row.id !== id)) && draft.value?.id === id) draft.value = undefined;
}
function restoreDefaults() {
  if (!window.confirm('恢复默认计数器？当前计数器和排序将被默认列表替换。')) return;
  if (commit(createDefaultCounters())) {
    draft.value = undefined;
    developer.value = false;
    configDraft.value = '';
  }
}
function moveTo(sourceId: string, target: DropTarget) {
  const sourceIndex = props.counters.findIndex(({ id }) => id === sourceId);
  const targetIndex = props.counters.findIndex(({ id }) => id === target.id);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
  const destination = targetIndex + Number(target.after) - Number(sourceIndex < targetIndex);
  if (destination === sourceIndex) return;
  const next = [...props.counters];
  const [source] = next.splice(sourceIndex, 1);
  next.splice(destination, 0, source);
  commit(next);
}
function startReorder(event: PointerEvent, id: string) {
  if (reorder.value || !event.isPrimary || event.button !== 0) return;
  reorder.value = {
    pointerId: event.pointerId, sourceId: id, dragging: false,
    x: event.clientX, y: event.clientY,
  };
  (event.currentTarget as HTMLButtonElement).setPointerCapture(event.pointerId);
}
function trackReorder(event: PointerEvent) {
  const active = reorder.value;
  if (!active || event.pointerId !== active.pointerId) return;
  if (!active.dragging) {
    const distance = Math.hypot(event.clientX - active.x, event.clientY - active.y);
    if (distance < reorderThreshold) return;
    active.dragging = true;
  }
  active.x = event.clientX;
  active.y = event.clientY;
  active.target = dropTargetAt(active.x, active.y);
  if (!reorderScrollFrame) reorderScrollFrame = requestAnimationFrame(scrollWhileReordering);
}
function dropTargetAt(x: number, y: number): DropTarget | undefined {
  const table = counterTable.value;
  if (!table) return;
  const { left, right, top, bottom } = table.getBoundingClientRect();
  if (x < left || x > right || y < top || y > bottom) return;

  let closest: DropTarget | undefined;
  let nearest = Infinity;
  for (const row of table.querySelectorAll<HTMLElement>('[data-counter-id]')) {
    const id = row.dataset.counterId;
    if (!id) continue;
    const { top, bottom } = row.getBoundingClientRect();
    const offset = y - (top + bottom) / 2;
    if (y >= top && y < bottom) return { id, after: offset >= 0 };
    // The inline editor isn't sortable. Use the nearest sortable row.
    if (Math.abs(offset) < nearest) {
      nearest = Math.abs(offset);
      closest = { id, after: offset >= 0 };
    }
  }
  return closest;
}
function scrollWhileReordering() {
  reorderScrollFrame = 0;
  const active = reorder.value;
  if (!active?.dragging || !counterTable.value) return;
  const { x, y } = active;
  const distance = y < scrollEdge ? y - scrollEdge : Math.max(0, y - window.innerHeight + scrollEdge);
  if (!distance) return;

  const previousScrollY = window.scrollY;
  window.scrollBy(0, Math.sign(distance) * Math.ceil(Math.abs(distance) / scrollEdge * 18));
  if (window.scrollY === previousScrollY) return;

  active.target = dropTargetAt(x, y);
  const { top, bottom } = counterTable.value.getBoundingClientRect();
  if (distance < 0 ? top < y : bottom > y) reorderScrollFrame = requestAnimationFrame(scrollWhileReordering);
}
function finishReorder(event: PointerEvent) {
  const active = reorder.value;
  if (!active || event.pointerId !== active.pointerId) return;
  const target = active.dragging ? dropTargetAt(event.clientX, event.clientY) : undefined;
  clearReorder();
  if (target) moveTo(active.sourceId, target);
}
function cancelReorder(event: PointerEvent) {
  if (event.pointerId === reorder.value?.pointerId) clearReorder();
}
function clearReorder() {
  if (reorderScrollFrame) cancelAnimationFrame(reorderScrollFrame);
  reorderScrollFrame = 0;
  reorder.value = undefined;
}
function reorderFromKeyboard(event: KeyboardEvent, index: number) {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  event.preventDefault();
  const after = event.key === 'ArrowDown';
  const source = props.counters[index];
  const target = props.counters[index + (after ? 1 : -1)];
  if (source && target) moveTo(source.id, { id: target.id, after });
}
onBeforeUnmount(clearReorder);
function toggleDeveloper(event: Event) {
  developer.value = (event.target as HTMLInputElement).checked;
  error.value = '';
  draft.value = undefined;
  if (developer.value) configDraft.value = serializeCounters(props.counters);
}
function saveConfig() {
  try { if (commit(parseCounterConfig(configDraft.value))) developer.value = false; }
  catch (reason) { error.value = reason instanceof Error ? reason.message : '配置无效。'; }
}
</script>

<template>
  <section class="counter-section" aria-label="计数器">
    <div class="panel-heading">
      <h2>计数器</h2>
      <div class="counter-panel-actions">
        <button type="button" class="text-button counter-reset" @click="restoreDefaults">恢复默认计数器</button>
        <button v-if="!developer" type="button" class="icon-button add-counter" aria-label="添加计数器" title="添加计数器" @click="edit()"><Icon name="plus" :size="18" /></button>
      </div>
    </div>
    <label class="checkbox-line developer-toggle"><input type="checkbox" :checked="developer" @change="toggleDeveloper" /> 开发者模式</label>
    <form v-if="developer" class="counter-config" @submit.prevent="saveConfig">
      <label for="counter-config">完整配置（JSON 数组）</label>
      <textarea id="counter-config" v-model="configDraft" rows="18" spellcheck="false" aria-label="计数器完整配置" />
      <div class="form-actions">
        <button class="button secondary" type="button" @click="developer = false; error = ''">取消</button>
        <button class="button primary" type="submit">保存配置</button>
      </div>
    </form>
    <template v-else>
      <table ref="counterTable" class="counter-table">
        <colgroup><col /><col /></colgroup>
        <thead class="visually-hidden"><tr><th scope="col">名称</th><th scope="col">结果 / 表达式</th></tr></thead>
        <tbody>
          <template v-for="(counter, index) in rows" :key="counter.id">
            <tr v-if="draft?.id === counter.id" class="counter-edit-row">
              <td><input v-model="draft.name" maxlength="48" aria-label="计数器名称" placeholder="名称" @keydown.enter.prevent="save" @keydown.esc="cancel" /></td>
              <td class="counter-edit-result">
                <input v-model="draft.formula" maxlength="2048" aria-label="计数器表达式" placeholder="roundTo(ce_s, 3)" @keydown.enter.prevent="save" @keydown.esc="cancel" />
                <div class="counter-edit-actions"><button type="button" class="text-button" @click="save">保存</button><button type="button" class="text-button" @click="cancel">取消</button></div>
              </td>
            </tr>
            <tr v-else :data-counter-id="counter.id" :class="{
              'is-dragging': reorder?.dragging && reorder.sourceId === counter.id,
              'is-drop-before': reorder?.target?.id === counter.id && !reorder.target.after,
              'is-drop-after': reorder?.target?.id === counter.id && reorder.target.after,
            }">
              <td class="counter-name" :title="counter.name">{{ counter.name }}</td>
              <td>
                <div class="counter-result-cell">
                  <span class="counter-result timecode" :title="counter.formula">{{ counter.value }}</span>
                  <div class="counter-row-actions">
                    <button type="button" class="icon-button small" :aria-label="`编辑 ${counter.name}`" @click="edit(counter)"><Icon name="edit" :size="13" /></button>
                    <button type="button" class="icon-button small" :aria-label="`删除 ${counter.name}`" @click="remove(counter.id)"><Icon name="trash" :size="13" /></button>
                    <button type="button" class="icon-button small counter-drag-handle" :aria-label="`拖动排序 ${counter.name}`" title="按住拖动，也可用方向键调整顺序" aria-keyshortcuts="ArrowUp ArrowDown"
                      @pointerdown="startReorder($event, counter.id)" @pointermove="trackReorder" @pointerup="finishReorder"
                      @pointercancel="cancelReorder" @lostpointercapture="cancelReorder" @keydown="reorderFromKeyboard($event, index)"><Icon name="grip" :size="15" /></button>
                  </div>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      <p v-if="!rows.length && !draft" class="muted-text">暂无计数器，点击添加创建一行。</p>
    </template>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <details class="formula-help">
      <summary>可用字段</summary>
      <section v-for="group in counterFieldGroups" :key="group.label">
        <h3>{{ group.label }}</h3><div><code v-for="key in group.fields" :key="key">{{ key }}</code></div>
      </section>
      <p>支持算术和括号；用 || 拼接字符串或数值，roundTo(value, 0–6) 保留小数位。rtime 与 duration 均为整局秒数。</p>
    </details>
  </section>
</template>
