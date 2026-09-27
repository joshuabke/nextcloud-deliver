import { describe, expect, it } from 'vitest'
import { dayOf, daysUntil, urgency } from './due.js'

describe('due dates', () => {
	it('counts calendar days, across months and clock changes', () => {
		expect(daysUntil('2026-11-01', '2026-10-31')).toBe(1)
		expect(daysUntil('2026-10-26', '2026-10-24')).toBe(2)
		expect(daysUntil('2026-10-01', '2026-10-03')).toBe(-2)
	})

	it('tells how urgent it is', () => {
		expect(urgency('2026-10-02', '2026-10-03')).toBe('overdue')
		expect(urgency('2026-10-03', '2026-10-03')).toBe('today')
		expect(urgency('2026-10-04', '2026-10-03')).toBe('tomorrow')
		expect(urgency('2026-10-09', '2026-10-03')).toBe('later')
	})

	it('reads the day where the browser is', () => {
		expect(dayOf(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05')
	})
})
