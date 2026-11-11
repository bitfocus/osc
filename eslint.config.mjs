// @ts-check

// Based on the Companion repository's ESLint config, so code moves between the two without reformatting or new warnings.

import eslint from '@eslint/js'
import neslint from 'eslint-plugin-n'
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended'
import tseslint from 'typescript-eslint'

export default [
	{
		ignores: ['dist/**', 'coverage/**', '.yarn/**'],
	},

	// setup the parser first
	{
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},

	neslint.configs['flat/recommended-module'],
	{
		plugins: {
			'@typescript-eslint': tseslint.plugin,
		},
		rules: {
			...eslint.configs.recommended.rules,

			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', varsIgnorePattern: '^_(.+)' },
			],
			'no-warning-comments': ['error', { terms: ['nocommit', '@nocommit', '@no-commit'] }],
			'n/prefer-node-protocol': 'error',
		},
	},
	...tseslint.configs.recommendedTypeChecked,
	{
		// disable type-aware linting on JS files
		files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
		...tseslint.configs.disableTypeChecked,
	},
	{
		files: ['**/*.ts'],
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-floating-promises': 'error',
			'@typescript-eslint/promise-function-async': 'error',
			'@typescript-eslint/require-await': 'off', // conflicts with 'promise-function-async'
			'@typescript-eslint/consistent-type-imports': 'error',

			/** Disable some annoyingly strict rules from the 'recommended-requiring-type-checking' pack */
			'@typescript-eslint/no-unsafe-assignment': 0,
			'@typescript-eslint/no-unsafe-member-access': 0,
			'@typescript-eslint/no-unsafe-argument': 0,
			'@typescript-eslint/no-unsafe-return': 0,
			'@typescript-eslint/no-unsafe-call': 0,
			'@typescript-eslint/restrict-template-expressions': 0,
			'@typescript-eslint/restrict-plus-operands': 0,
			'@typescript-eslint/no-redundant-type-constituents': 0,
			/** End 'recommended-requiring-type-checking' overrides */

			'@typescript-eslint/explicit-module-boundary-types': 'error',
		},
	},
	{
		files: ['tests/**/*', 'vitest.config.ts', 'eslint.config.mjs'],
		rules: {
			'@typescript-eslint/ban-ts-comment': 'off',
			'@typescript-eslint/unbound-method': 'off',
			'@typescript-eslint/explicit-module-boundary-types': 'off',
			'n/no-unpublished-import': 'off',
		},
	},

	eslintPluginPrettierRecommended,
]
