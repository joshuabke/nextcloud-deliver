import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('translations', () => {
	// German ships (story 83): every t() and n() in src/ and lib/ is translated, nothing stale
	it('cover every source string', () => {
		expect(() => execFileSync('node', ['dev/l10n.mjs'], { stdio: 'pipe' })).not.toThrow()
	})
})
