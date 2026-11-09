import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const RAW_REQUEST_SELECTORS = [
  {
    selector:
      'CallExpression[callee.name="fetch"], CallExpression[callee.object.name="window"][callee.property.name="fetch"]',
    message: 'Raw fetch is not allowed here; use the generated API client and the transport layer.',
  },
  {
    selector: 'NewExpression[callee.name="XMLHttpRequest"]',
    message:
      'Raw XMLHttpRequest is not allowed here; use the generated API client and the transport layer.',
  },
];

// webOS globals and Luna belong to src/platform/webos only.
const PLATFORM_SELECTORS = [
  {
    selector: 'Identifier[name=/^(webOSSystem|PalmSystem|WebOSServiceBridge|PalmServiceBridge)$/]',
    message: 'webOS globals are only allowed inside src/platform; use getPlatform().',
  },
  {
    selector: 'Literal[value=/luna:/], TemplateElement[value.raw=/luna:/]',
    message: 'Luna calls are only allowed inside src/platform; use getPlatform().',
  },
];

const PLATFORM_IMPORTS = {
  group: [
    '**/platform/webos',
    '**/platform/webos/**',
    '**/platform/browser',
    '**/platform/browser/**',
    '**/platform/shared',
    '**/platform/shared/**',
  ],
  message: 'Import from the platform adapter (src/platform), not from its internals.',
};

const NAV_IMPORT = {
  name: '@noriginmedia/norigin-spatial-navigation',
  message: 'Import navigation from src/app/nav; only that folder talks to the library.',
};

export default tseslint.config(
  { ignores: ['dist/', 'dist-perf/', 'out/', 'coverage/', 'src/api/generated/'] },
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
    // The platform selectors apply here too: one no-restricted-syntax list per file.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/platform/**', 'src/probe/**', 'src/api/transport/**', 'src/test/**'],
    rules: { 'no-restricted-syntax': ['error', ...RAW_REQUEST_SELECTORS, ...PLATFORM_SELECTORS] },
  },
  {
    files: ['src/probe/**/*.{ts,tsx}', 'src/api/transport/**/*.{ts,tsx}'],
    rules: { 'no-restricted-syntax': ['error', ...PLATFORM_SELECTORS] },
  },
  {
    // The shared test helpers fake the webOS bridge, so they may name it and Luna URIs.
    files: ['src/test/**/*.{ts,tsx}'],
    rules: { 'no-restricted-syntax': ['error', ...RAW_REQUEST_SELECTORS] },
  },
  {
    // Everything platform-specific sits behind the Platform adapter (src/platform/index.ts), so
    // a Samsung Tizen port adds an adapter instead of touching screens, features or the API layer.
    // The spatial navigation library is wrapped the same way, by src/app/nav. One
    // no-restricted-imports list per file, so the three blocks below split the two bans.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/platform/**', 'src/app/nav/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [PLATFORM_IMPORTS], paths: [NAV_IMPORT] }],
    },
  },
  {
    files: ['src/platform/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { paths: [NAV_IMPORT] }] },
  },
  {
    files: ['src/app/nav/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { patterns: [PLATFORM_IMPORTS] }] },
  },
);
