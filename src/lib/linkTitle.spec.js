import { describe, expect, it } from 'vitest'
import { linkTitle } from './linkTitle.js'

describe('the title of a Review Link', () => {
	const assets = [{ id: 1, name: 'still' }, { id: 2, name: 'cut' }]

	it('is its label when it has one', () => {
		expect(linkTitle({ label: 'For the agency', assetIds: null }, assets)).toBe('For the agency')
	})

	it('says what it shows otherwise: the whole Project, its one Asset, or how many', () => {
		expect(linkTitle({ label: null, assetIds: null }, assets)).toBe('Whole Project')
		expect(linkTitle({ label: null, assetIds: [1] }, assets)).toBe('still')
		expect(linkTitle({ label: null, assetIds: [1, 2] }, assets)).toBe('2 Assets')
	})

	it('counts an Asset it cannot name', () => {
		expect(linkTitle({ label: null, assetIds: [7] }, [])).toBe('1 Asset')
	})
})
