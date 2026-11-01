// ESLint flat config for all workspaces. See docs/DEVELOPMENT.md §13.3.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '**/build/',
      '**/coverage/',
      '**/playwright-report/',
      '**/test-results/',
      // Generated Prisma client
      'apps/api/src/generated/',
    ],
  },
  js.configs.recommended,
  // Type-aware rules for TypeScript files (catches floating promises, unsafe any, etc.)
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // NestJS reads constructor parameter types at runtime (emitDecoratorMetadata). Telling the parser
  // makes consistent-type-imports leave imports in decorated files alone, so its autofix cannot turn
  // an injected class into `import type` and break dependency injection.
  {
    files: ['apps/api/**/*.{ts,mts}'],
    languageOptions: {
      parserOptions: { emitDecoratorMetadata: true, experimentalDecorators: true },
    },
  },
  // Tenant isolation (docs/DEVELOPMENT.md §11.1): the business scope comes only from
  // @CurrentAuth() (req.auth), never from anything the client sends.
  {
    files: ['apps/api/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[property.name='businessId'][object.type='MemberExpression'][object.property.name=/^(body|query|params|headers|cookies)$/]",
          message:
            'Never read businessId from the request. Use @CurrentAuth() / req.auth (docs/DEVELOPMENT.md §11.1).',
        },
        {
          selector:
            "CallExpression[callee.name=/^(Body|Query|Param|Headers)$/] > Literal[value='businessId']",
          message:
            'Never take businessId from the request. Use @CurrentAuth() (docs/DEVELOPMENT.md §11.1).',
        },
      ],
    },
  },
  // The browser uses Supabase for authentication only and never queries app tables
  // (docs/DEVELOPMENT.md §8, §23 rule 9). Only src/lib/supabase.ts may create a client, and it
  // exports the auth client alone. Type-only imports are fine.
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: ['apps/web/src/lib/supabase.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@supabase/supabase-js',
              message:
                'Use the auth client from useAuth() (src/lib/supabase.ts). The browser must never query app tables.',
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
  // React hooks rules for the web app. The two core rules are listed directly because the plugin's
  // preset names have changed between major versions.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  // Plain JavaScript config files and scripts run in Node
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    rules: {
      eqeqeq: ['error', 'always'],
      'no-console': 'warn',
    },
  },
  {
    files: ['scripts/**'],
    rules: { 'no-console': 'off' },
  },
  // Keep last: turns off rules that conflict with Prettier
  prettier,
);
