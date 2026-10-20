import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: './tests/globalSetup.ts',
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'file:./test.db',
      UPLOAD_DIR: './storage/test-uploads',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '2526',
      SMTP_SECURE: 'false',
      SMTP_IGNORE_TLS: 'true',
      SMTP_USER: '',
      SMTP_FROM: 'DYA Test <noreply@test.local>',
      APP_URL: 'http://localhost:5173',
      DATA_ENCRYPTION_KEY: 'test-key-test-key-test-key-1234567890',
    },
  },
});
