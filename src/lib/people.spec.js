import { describe, expect, it } from 'vitest'
import { peopleToSuggest, reviewerWithAddress } from './people.js'

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

describe('the Reviewer an address belongs to', () => {
	it('is found whatever the case and the spaces around it', () => {
		const reviewers = [{ name: 'Leon Green', email: 'Leon@Example.com' }, { name: 'Noa', email: null }]
		expect(reviewerWithAddress(reviewers, ' leon@example.COM ')?.name).toBe('Leon Green')
		expect(reviewerWithAddress(reviewers, 'mo@example.com')).toBeUndefined()
		expect(reviewerWithAddress(reviewers, '')).toBeUndefined()
	})
})

describe('people to suggest, with Reviewers who share an address from before (ADR 0014)', () => {
	it('offers each address once', () => {
		const twins = [{ name: 'Leon Green', email: 'leon@example.com' }, { name: 'Leon', email: 'LEON@example.com' }]
		expect(peopleToSuggest('leon', twins, []).map((each) => each.name)).toEqual(['Leon Green'])
	})
})
