import { describe, expect, it } from 'vitest'
import { day as date } from './day.js'
import { delivered } from './delivered.js'

describe('delivered', () => {
	it('joins who and when', () => {
		expect(delivered({ deliveredBy: { name: 'Anna' }, createdAt: 1761436800 })).toBe('Anna · ' + date(1761436800))
	})

	it('has only the date with nobody', () => {
		expect(delivered({ createdAt: 1761436800 })).toBe(date(1761436800))
	})

	it('has only the name without a date', () => {
		expect(delivered({ deliveredBy: { name: 'Anna' } })).toBe('Anna')
	})

	it('is empty on a Review Link, which tells neither', () => {
		expect(delivered({})).toBe('')
	})
})
