import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: '/kpop-chart-race/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        prototype: resolve(__dirname, 'prototype.html'),
      },
    },
  },
});
