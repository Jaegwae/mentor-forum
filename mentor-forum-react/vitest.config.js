import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup-vitest.js'],
    include: ['tests/**/*.test.{js,jsx}']
  }
});

