<script setup lang="ts">
const paths: Record<string, string> = {
  upload: 'M12 16V4 M7 9l5-5 5 5 M4 16v4h16v-4',
  close: 'M6 6l12 12 M18 6 6 18',
  link: 'M10 14l4-4 M8.5 15.5 7 17a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0 M15.5 8.5 17 7a3.5 3.5 0 0 1 5 5l-4 4a3.5 3.5 0 0 1-5 0',
  file: 'M6 3h8l4 4v14H6z M14 3v5h4 M9 13h6 M9 17h4',
  play: 'M8 5l12 7-12 7z', pause: 'M9 5v14 M15 5v14', restart: 'M3 11a9 9 0 1 1 2 7 M3 5v6h6',
  volume: 'M4 9h4l5-4v14l-5-4H4z M16 9a4 4 0 0 1 0 6 M18.5 6.5a8 8 0 0 1 0 11',
  muted: 'M4 9h4l5-4v14l-5-4H4z M16 9l5 6 M21 9l-5 6',
  stats: 'M4 19h16 M6 15v-4 M12 15V5 M18 15V8',
  sound: 'M3 12h3l3-7 4 14 3-7h5', plus: 'M12 5v14 M5 12h14',
  edit: 'M5 16l11-11 3 3L8 19H5z M14 7l3 3', trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 10v6 M14 10v6',
  up: 'M6 14l6-6 6 6', down: 'M6 10l6 6 6-6',
  grip: 'M9 5h.01 M15 5h.01 M9 12h.01 M15 12h.01 M9 19h.01 M15 19h.01',
};
defineProps<{ name: string; size?: number }>();
</script>

<template>
  <svg :width="size ?? 18" :height="size ?? 18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">
    <path :d="paths[name]" :fill="name === 'play' ? 'currentColor' : undefined" />
  </svg>
</template>
