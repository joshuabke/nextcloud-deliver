import { describe, expect, it } from 'vitest'
import { contactOptions, pickedContact } from './contacts.js'

describe('contact suggestions', () => {
	const found = [
		{ name: 'Kim Novak', email: 'kim@studio.test' },
		{ name: 'Kim Novak', email: 'kim@home.test' },
	]

	it('labels each address on its own, so two of one person stay apart', () => {
		expect(contactOptions(found).map((each) => each.label)).toEqual(['Kim Novak <kim@studio.test>', 'Kim Novak <kim@home.test>'])
	})

	it('knows a picked option by its label and nothing else', () => {
		const options = contactOptions(found)
		expect(pickedContact(options, 'Kim Novak <kim@home.test>')).toEqual({ name: 'Kim Novak', email: 'kim@home.test' })
		expect(pickedContact(options, 'Kim Novak')).toBeNull()
		expect(pickedContact(options, 'Kim Novak <kim@home.tes')).toBeNull()
	})
})
