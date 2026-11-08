import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'out/', 'coverage/', 'src/api/generated/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    // The JS service runs on the TV's own Node.js as plain CommonJS.
    files: ['service/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // CLAUDE.md: every API call goes through the generated client and the transport layer, so
    // raw fetch and XMLHttpRequest are banned in src/. The CORS probe is a diagnostic exception
    // (it must see what the engine does with a raw request); the transport layer is the other.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/probe/**', 'src/api/transport/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.name="fetch"], CallExpression[callee.object.name="window"][callee.property.name="fetch"]',
          message:
            'Raw fetch is not allowed here; use the generated API client and the transport layer.',
        },
        {
          selector: 'NewExpression[callee.name="XMLHttpRequest"]',
          message:
            'Raw XMLHttpRequest is not allowed here; use the generated API client and the transport layer.',
        },
      ],
    },
  },
);
