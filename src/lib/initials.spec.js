import { describe, expect, it } from 'vitest'
import { avatarSeed, initials } from './initials.js'

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

describe('the colour of an avatar', () => {
	it('follows an account by its name and a Reviewer by who they are', () => {
		expect(avatarSeed({ type: 'user', id: 'kim', name: 'Kim Berg' })).toBe('Kim Berg')
		expect(avatarSeed({ type: 'reviewer', id: 7, name: 'Kim' })).toBe('deliver-reviewer-7')
	})
})
