import { describe, expect, it } from 'vitest'
import { conflictMessage } from './conflict.js'

const conflict = (reason, message = 'from the server') => ({ response: { status: 409, data: { reason, message } } })

describe('a conflict on naming oneself, in the page\'s own language', () => {
	it('says which is taken, the name or the address', () => {
		expect(conflictMessage(conflict('name'), { name: 'Kim', email: 'kim@example.test' })).toBe('Someone in this review is already called "Kim".')
		expect(conflictMessage(conflict('address'), { name: 'Kim', email: 'kim@example.test' })).toBe('Someone in this review already has the address kim@example.test.')
	})

	it('says to ask the Member when name and address cannot be changed here', () => {
		expect(conflictMessage(conflict('identityLocked'), {})).toBe('You review on several links: ask whoever invited you to change your name or address.')
	})

	it('leaves anything else to the caller', () => {
		expect(conflictMessage(conflict(undefined), {})).toBeNull()
		expect(conflictMessage({ response: { status: 400, data: { reason: 'name' } } }, {})).toBeNull()
	})
})
