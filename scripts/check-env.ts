async function main(): Promise<void> {
  if (process.env.APP_ENV === 'production') {
    const { env } = await import('../src/lib/env');
    console.log(`env ok (APP_ENV=${env.APP_ENV}, PROVIDER_MODE=${env.PROVIDER_MODE})`);
  } else {
    console.log(`check-env skipped (APP_ENV=${process.env.APP_ENV ?? 'unset'})`);
  }
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Environment validation failed');
  process.exitCode = 1;
});
