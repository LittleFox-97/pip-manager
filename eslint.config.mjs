import antfu from '@antfu/eslint-config'

export default antfu({
  stylistic: true,
  typescript: {
    tsconfigPath: './tsconfig.json',
  },
  jsonc: true,
  vue: false,
  astro: false,
}, {
  files: ['src/**/*.ts'],
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  },
  rules: {
    'no-console': 'warn',
    'curly': ['error', 'all'],
    'style/brace-style': ['error', '1tbs'],
    'complexity': ['warn', 8],
    'node/prefer-global/process': ['error', 'always'],
    'node/prefer-global/buffer': ['error', 'always'],
    'ts/strict-boolean-expressions': 'off',
  },
})
