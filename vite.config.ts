import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  base: './',
  plugins: [wasm(), vue()],
  optimizeDeps: { include: ['mediabunny'] },
  build: { target: 'esnext', assetsInlineLimit: 0, license: { fileName: 'licenses/dependencies.md' } },
});
