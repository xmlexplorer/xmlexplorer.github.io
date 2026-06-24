import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts (whose rollup `input: app.html` is about the
// app bundle, not tests). These are pure-logic unit tests -- no DOM needed, so the
// default node environment is fine.
export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
  },
});
