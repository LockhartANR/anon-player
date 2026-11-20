<script setup lang="ts">
import { computed, ref } from 'vue';
import Icon from './Icon.vue';
import { compileCounters, formatCounterValue, parseCounterConfig, saveCounters, serializeCounters, validateCounter } from './counters';
import type { Counter } from './counters';
import { counterFieldGroups } from './counterFields';
import type { Values } from './replay';

const props = defineProps<{ counters: Counter[]; values?: Values }>();
const emit = defineEmits<{ change: [counters: Counter[]] }>();
const draft = ref<Counter>();
const developer = ref(false);
const configDraft = ref('');
const error = ref('');
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
function move(index: number, step: number) {
  const next = [...props.counters];
  if (index + step < 0 || index + step >= next.length) return;
  [next[index], next[index + step]] = [next[index + step], next[index]];
  commit(next);
}
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
      <button v-if="!developer" type="button" class="icon-button add-counter" aria-label="添加计数器" title="添加计数器" @click="edit()"><Icon name="plus" :size="18" /></button>
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
      <table class="counter-table">
        <thead><tr><th scope="col">名称</th><th scope="col">结果 / 表达式</th><th scope="col"><span class="sr-only">操作</span></th></tr></thead>
        <tbody>
          <template v-for="(counter, index) in rows" :key="counter.id">
            <tr v-if="draft?.id === counter.id" class="counter-edit-row">
              <td><input v-model="draft.name" maxlength="48" aria-label="计数器名称" placeholder="名称" @keydown.enter.prevent="save" @keydown.esc="cancel" /></td>
              <td><input v-model="draft.formula" maxlength="2048" aria-label="计数器表达式" placeholder="roundTo(ce_s, 3)" @keydown.enter.prevent="save" @keydown.esc="cancel" /></td>
              <td><button type="button" class="text-button" @click="save">保存</button><button type="button" class="text-button" @click="cancel">取消</button></td>
            </tr>
            <tr v-else>
              <td class="counter-name" :title="counter.name">{{ counter.name }}</td>
              <td class="counter-result timecode" :title="counter.formula">{{ counter.value }}</td>
              <td class="counter-row-actions">
                <button type="button" class="icon-button small" :aria-label="`上移 ${counter.name}`" :disabled="index === 0" @click="move(index, -1)"><Icon name="up" :size="13" /></button>
                <button type="button" class="icon-button small" :aria-label="`下移 ${counter.name}`" :disabled="index === counters.length - 1" @click="move(index, 1)"><Icon name="down" :size="13" /></button>
                <button type="button" class="icon-button small" :aria-label="`编辑 ${counter.name}`" @click="edit(counter)"><Icon name="edit" :size="13" /></button>
                <button type="button" class="icon-button small" :aria-label="`删除 ${counter.name}`" @click="remove(counter.id)"><Icon name="trash" :size="13" /></button>
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
