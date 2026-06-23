import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `index.html` at the project root is the existing, live marketing/download
// page for the old Windows app -- left untouched. The new React app's entry
// point is `app.html`, a separate page, so local development never disturbs
// the deployed site. `native/tauri.conf.json` points at this same file.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: 'app.html',
    },
  },
});
