import { execSync } from 'node:child_process';

export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST must be set (see .env.test)');
  const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url };
  execSync('pnpm prisma migrate reset --force --skip-seed --skip-generate', { env, stdio: 'inherit' });
  process.env.DATABASE_URL = url;
  process.env.DIRECT_URL = url;
  const { seedReference } = await import('../../prisma/seed/index');
  await seedReference();
}
