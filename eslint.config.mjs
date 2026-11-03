import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

const jsxLiteralRule = {
  selector: 'JSXText[value=/\\S/]',
  message:
    'Storefront JSX must not contain literal text. Use useTranslations()/getTranslations() (07-i18n-currency.md §1).',
};

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'next-env.d.ts',
      'prisma/migrations/**',
      'design/**',
      'linear-planning/**',
      'Course Exercise Files/**',
      '*.config.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs['core-web-vitals'].rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@prisma/client'], importNames: ['PrismaClient'], message: 'Import db from @/lib/db.' },
          ],
        },
      ],
    },
  },
  {
    files: ['src/app/[locale]/**/*.tsx', 'src/components/**/*.tsx'],
    // shadcn/ui primitives ship their own a11y copy (e.g. "Close", "Previous") verbatim from the
    // registry; Task 17 of the phase plan assumed this rule already excluded them — it didn't.
    ignores: ['src/components/admin/**', 'src/components/ui/**'],
    rules: { 'no-restricted-syntax': ['error', jsxLiteralRule] },
  },
  {
    files: ['src/lib/db.ts', 'prisma/seed/**', 'tests/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['tests/**', 'scripts/**', 'prisma/seed/**', '*.config.*'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
  prettier,
);
