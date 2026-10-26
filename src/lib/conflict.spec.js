import { describe, expect, it } from 'vitest'
import { conflictMessage, deletedProjectOf } from './conflict.js'

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

describe('a folder or file a Deleted Project holds', () => {
	const refused = (data) => ({ response: { status: 409, data: { ocs: { data } } } })

	it('names that Project, to restore it or delete it for good', () => {
		expect(deletedProjectOf(refused({ reason: 'deleted', projectId: 7, projectName: 'Spot', message: 'x' }))).toEqual({ id: 7, name: 'Spot' })
	})

	it('is nothing for any other refusal', () => {
		expect(deletedProjectOf(refused({ reason: 'name', message: 'x' }))).toBeNull()
		expect(deletedProjectOf({ response: { status: 404, data: { ocs: { data: { reason: 'deleted' } } } } })).toBeNull()
		expect(deletedProjectOf(new Error('offline'))).toBeNull()
	})
})
