import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset URLs, so the same build works from any path: `shipgate demo --serve`,
  // a static file server, or a subdirectory.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
