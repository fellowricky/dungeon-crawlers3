/* Crash-class lint only. This is not a style gate: it exists because the
   September 2026 sweep found calls to undefined functions, a method defined
   twice (the second silently replacing the first) and duplicate object keys —
   none of which any test reached. Every rule here catches something that is
   a bug in every context. Run with `npm run lint`; CI runs it before tests. */
import globals from 'globals';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'backupjul24/**', 'Open-LLM-VTuber/**', 'public/**', '3d/**', 'lpc_repo/**']
  },
  {
    files: ['src/**/*.js', 'sim/**/*.mjs', 'scripts/**/*.mjs', 'electron/**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2025,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node }
    },
    rules: {
      'no-undef': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-class-members': 'error',
      'no-dupe-else-if': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'no-self-assign': 'error',
      'no-unsafe-negation': 'error',
      'no-cond-assign': 'error',
      'no-func-assign': 'error',
      'no-import-assign': 'error',
      'no-redeclare': 'error',
      'no-loss-of-precision': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      'no-constant-condition': ['error', { checkLoops: false }]
    }
  },
  {
    files: ['electron/**/*.cjs', 'scripts/**/*.mjs', 'sim/**/*.mjs'],
    languageOptions: { sourceType: 'script', globals: { ...globals.node } }
  },
  {
    files: ['scripts/**/*.mjs', 'sim/**/*.mjs'],
    languageOptions: { sourceType: 'module' }
  }
];
