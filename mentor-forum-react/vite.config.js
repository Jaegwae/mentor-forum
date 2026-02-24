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
      },
      output: {
        manualChunks(id) {
          // Vendor chunk: Firebase (largest dependency)
          if (id.includes('node_modules/firebase/') || id.includes('node_modules/@firebase/')) {
            return 'vendor-firebase';
          }
          // Vendor chunk: Radix UI primitives
          if (id.includes('node_modules/@radix-ui/')) {
            return 'vendor-radix';
          }
          // Vendor chunk: Framer Motion
          if (id.includes('node_modules/framer-motion/')) {
            return 'vendor-framer';
          }
          // Vendor chunk: React core + React DOM + React Router
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/react-router')
          ) {
            return 'vendor-react';
          }
        }
      }
    }
  }
});
