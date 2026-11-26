import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  base: './',
  plugins: [
    wasm(),
    vue(),
    {
      name: 'project-license',
      apply: 'build',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'licenses/anon-player.txt',
          source: readFileSync(new URL('./LICENSE', import.meta.url), 'utf8'),
        });
        this.emitFile({
          type: 'asset',
          fileName: 'licenses/open-minesweeper.txt',
          source: readFileSync(new URL('./licenses/open-minesweeper.txt', import.meta.url), 'utf8'),
        });
      },
    },
  ],
  optimizeDeps: { include: ['mediabunny'] },
  build: { target: 'esnext', assetsInlineLimit: 0, license: { fileName: 'licenses/dependencies.md' } },
});
