import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Integration tests create repositories and invoke real Git, including on Windows.
    testTimeout: 30000,
  },
});
