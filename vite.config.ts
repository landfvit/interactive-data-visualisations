import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // cache chart dependencies separately from the application
        manualChunks: { charts: ['recharts'], math: ['katex'] },
      },
    },
  },
});
