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
