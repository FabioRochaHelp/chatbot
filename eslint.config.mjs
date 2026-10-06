import js from '@eslint/js';
import globals from 'globals';

export default [
    { ignores: ['node_modules/', 'tokens/', 'examples/', 'web/dist/'] },
    js.configs.recommended,
    {
        files: ['**/*.js'],
        languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
        rules: {
            'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }]
        }
    },
    {
        files: ['test/**/*.js', '*.mjs'],
        languageOptions: { sourceType: 'module' }
    }
];
