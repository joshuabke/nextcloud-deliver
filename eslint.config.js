import { recommended } from '@nextcloud/eslint-config'

export default [
	...recommended,
	{
		files: ['src/**'],
		ignores: ['src/lib/l10n.js'],
		rules: {
			// Their escaping doubles Vue's: src/lib/l10n.js has them without (#93)
			'no-restricted-imports': ['error', {
				paths: [{ name: '@nextcloud/l10n', importNames: ['t', 'n', 'translate', 'translatePlural'], message: 'Import t and n from src/lib/l10n.js.' }],
			}],
		},
	},
]
