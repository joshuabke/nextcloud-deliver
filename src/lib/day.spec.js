import { describe, expect, it, vi } from 'vitest'

const locale = vi.hoisted(() => ({ current: 'en-US' }))
vi.mock('@nextcloud/l10n', () => ({ getCanonicalLocale: () => locale.current }))

const { day } = await import('./day.js')

// Noon UTC, so that every time zone is on the same date
const NOON = 1761480000

describe('day', () => {
	it('is the medium date in the user\'s language', () => {
		locale.current = 'en-US'
		expect(day(NOON)).toBe('Oct 26, 2025')
		locale.current = 'de-DE'
		expect(day(NOON)).toBe('26.10.2025')
	})
})
