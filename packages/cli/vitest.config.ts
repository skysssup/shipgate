import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    // Integration tests create repositories and invoke real Git, including on Windows.
    testTimeout: 30000,
  },
});
