import { describe, expect, it } from 'vitest'
import { peopleToSuggest } from './people.js'

describe('people to suggest when inviting', () => {
	const reviewers = [
		{ name: 'Leon Green', email: 'Leon@Example.com' },
		{ name: 'Mo Blue', email: 'mo@example.com' },
	]
	const contacts = [
		{ name: 'Leon G.', email: 'leon@example.com', photo: '/photo/leon' },
		{ name: 'Leona Lewis', email: 'leona@example.com', photo: null },
	]

	it('puts the Project\'s Reviewers who match first, then the contacts, each address once', () => {
		expect(peopleToSuggest('leo', reviewers, contacts)).toEqual([
			{ name: 'Leon Green', email: 'Leon@Example.com', photo: '/photo/leon', reviewer: true },
			{ name: 'Leona Lewis', email: 'leona@example.com', photo: null, reviewer: false },
		])
	})

	it('finds Reviewers by address as well', () => {
		expect(peopleToSuggest('MO@', reviewers, []).map((each) => each.name)).toEqual(['Mo Blue'])
	})
})
