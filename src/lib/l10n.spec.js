import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { n, t } from './l10n.js'

describe('translations', () => {
	// German ships (story 83): every t() and n() in src/ and lib/ is translated, nothing stale
	it('cover every source string', () => {
		expect(() => execFileSync('node', ['dev/l10n.mjs'], { stdio: 'pipe' })).not.toThrow()
	})

	// Vue escapes on render; escaped here too, a name would show its entities (#93)
	it('fill in placeholders as they are', () => {
		const name = 'Smith & O\'Neil <Co>'
		expect(t('deliver', 'Delete "{project}" for good?', { project: name })).toBe(`Delete "${name}" for good?`)
		expect(n('deliver', '{name} and %n other', '{name} and %n others', 2, { name })).toBe(`${name} and 2 others`)
	})
})
