import { describe, expect, it } from 'vitest'
import { initials } from './initials.js'

describe('initials', () => {
	it('take the first and the last word', () => {
		expect(initials('Kim')).toBe('K')
		expect(initials('kim de la Cruz')).toBe('KC')
		expect(initials('Frieda 695')).toBe('F6')
	})

	it('leave out what is no letter or digit', () => {
		expect(initials('  @Kim (Kunde) ')).toBe('KK')
		expect(initials('!!')).toBe('?')
	})
})
