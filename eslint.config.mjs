import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-function': 'off',
      'no-console': 'off',
    },
  },
  {
    ignores: [
      'dist/**',
      'dist-electron/**',
      'dist-cli/**',
      'node_modules/**',
      'vscode-extension/**',
      'build/**',
      '*.config.js',
      '*.config.ts',
    ],
  },
)
