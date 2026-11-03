import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

// Load committed test env (no secrets) for both projects.
process.loadEnvFile('.env.test');

// These are end-of-project targets (`12-testing.md` §5): most `src/features/**` directories
// here (pricing, payments, orders, coupons, inventory, loyalty) don't exist until later phases,
// so enforcing them from Phase 0 would fail every CI run on code that hasn't been built yet.
// Thresholds stay configured (and `ENFORCE_COVERAGE=true` opts back into enforcing them locally
// or in a later phase's CI once the codebase has grown into these targets) but are not enforced
// by default; `--coverage` still produces the report either way.
const coverage = {
  provider: 'v8' as const,
  reporter: ['text', 'lcov', 'json'],
  reportsDirectory: './coverage',
  include: ['src/**/*.{ts,tsx}'],
  exclude: ['src/app/**', 'src/components/ui/**', 'src/types/**', 'src/**/*.d.ts', 'src/instrumentation*.ts'],
  ...(process.env.ENFORCE_COVERAGE === 'true'
    ? {
        thresholds: {
          lines: 70,
          'src/features/pricing/**': { lines: 90 },
          'src/features/payments/**': { lines: 90 },
          'src/features/orders/**': { lines: 90 },
          'src/features/coupons/**': { lines: 90 },
          'src/features/inventory/**': { lines: 90 },
          'src/features/loyalty/**': { lines: 90 },
          'src/features/**': { lines: 80 },
        },
      }
    : {}),
};

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    globals: true,
    coverage,
    // next-auth / next-intl (and their next/server imports) ships extension-less deep imports that only
    // resolve when Vite transforms the package itself, instead of passing it through to
    // Node's native ESM resolver as an external dependency.
    server: { deps: { inline: ['next-auth', '@auth/prisma-adapter', 'next-intl'] } },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.{ts,tsx}'],
          environment: 'node',
          environmentMatchGlobs: [['tests/unit/components/**', 'jsdom']],
          setupFiles: ['tests/setup/jsdom.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['tests/integration/setup.ts'],
          setupFiles: ['tests/integration/env.ts'],
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
          testTimeout: 20_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
