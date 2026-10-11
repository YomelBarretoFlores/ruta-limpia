import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['**/dist/', '**/coverage/', 'odd/']),

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Plain JavaScript config files are not part of any tsconfig project.
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },

  {
    files: ['apps/api/**/*.ts', '*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // Hexagonal rule: the domain stays pure (no frameworks, no I/O, no outer layers).
    files: ['apps/api/src/**/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'fastify', 'fastify/*', '@fastify/*', 'kysely', 'pg', 'web-push'],
              message: 'Domain code must stay pure: no frameworks, drivers or Node built-ins.',
            },
            {
              group: ['**/application/**', '**/infrastructure/**'],
              message: 'Domain code must not depend on outer layers.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest'], reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
  },

  // Must stay last: turns off stylistic rules that conflict with Prettier.
  prettier,
);
