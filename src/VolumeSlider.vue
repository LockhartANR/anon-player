<script setup lang="ts">
defineProps<{ label: string; accessibleLabel?: string; value: number; disabled: boolean }>();
const emit = defineEmits<{ input: [value: number]; commit: [] }>();
</script>

<template>
  <label class="volume-setting">
    <span>{{ label }}</span>
    <input type="range" min="0" max="1" step="0.01" :aria-label="accessibleLabel ?? label"
      :value="value" :disabled="disabled"
      @input="emit('input', ($event.target as HTMLInputElement).valueAsNumber)" @change="emit('commit')" />
    <span class="volume-percent" aria-hidden="true">{{ Math.round(value * 100) }}%</span>
  </label>
</template>
