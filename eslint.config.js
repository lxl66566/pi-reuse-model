// Flat ESLint config.
//
// Layers (last wins):
//   1. eslint recommended + import-x             — generic bugs, import hygiene
//   2. typescript-eslint strict/stylistic (type-aware) — needs type info, catches
//      floating promises, unsafe `any` leakage, etc.
//   3. perfectionist + regexp                    — opinionated consistency
//   4. eslint-config-prettier                    — disable formatting conflicts
//
// Fast rule-only feedback also runs via oxlint (see .oxlintrc.json); ESLint is
// kept for the type-aware rules oxlint can't do yet.
import js from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import prettier from 'eslint-config-prettier';
import { importX } from 'eslint-plugin-import-x';
import { configs as perfectionist } from 'eslint-plugin-perfectionist';
import { configs as regexpConfigs } from 'eslint-plugin-regexp';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  importX.flatConfigs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  perfectionist['recommended-natural'],
  regexpConfigs['flat/recommended'],
  {
    files: ['**/*.{ts,mts,cts}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['src/**/*.test.ts'],
    ...vitest.configs.recommended,
  },
  {
    rules: {
      // --- low-value typescript-eslint rules ---
      '@typescript-eslint/no-dynamic-delete': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-for-in-array': 'off',
      '@typescript-eslint/no-invalid-void-type': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'off',
      '@typescript-eslint/require-await': 'off',
      // Tool/user-facing messages interpolate line numbers everywhere.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true },
      ],
      'import-x/no-named-as-default': 'off',
      'import-x/no-unresolved': 'off',
      'no-unassigned-vars': 'off',
      'no-undef': 'off',
      'no-underscore-dangle': 'off',
      // --- rules from plugins not loaded in ESLint ---
      'oxc/no-map-spread': 'off',
      // Import ordering is owned by oxfmt's built-in sortImports (run via
      // `oxfmt`, which executes *after* `eslint --fix` in lint-staged).
      // Perfectionist's sort-imports rules can conflict, so disable the
      // redundant ESLint rules; all other Perfectionist rules
      // (sort-objects, sort-object-types, …) stay.
      'perfectionist/sort-imports': 'off',
      'perfectionist/sort-named-imports': 'off',
      'prefer-const': 'error',
      'promise/always-return': 'off',
    },
  },
  // Plain JS files (like this config) have no project type info; must come
  // after the global rules block so type-aware re-enables are still disabled.
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
