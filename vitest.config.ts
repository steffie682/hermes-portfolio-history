import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'jsdom', testTimeout: 15_000 },
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
});
