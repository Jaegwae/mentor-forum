import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    port: 5174
  },
  build: {
    rollupOptions: {
      onwarn(warning, warn) {
        if (
          warning.code === 'MODULE_LEVEL_DIRECTIVE'
          && String(warning.message || '').includes('"use client"')
        ) {
          return;
        }
        warn(warning);
      }
    }
  }
});
