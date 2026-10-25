import { describe, expect, it } from 'vitest'
import { linkTitle } from './linkTitle.js'

describe('the title of a Review Link', () => {
	it('is its label when it has one', () => {
		expect(linkTitle({ label: 'For the agency', assetIds: null, assetName: null })).toBe('For the agency')
	})

	it('says what it shows otherwise: the whole Project, its one Asset, or how many', () => {
		expect(linkTitle({ label: null, assetIds: null, assetName: null })).toBe('Whole Project')
		expect(linkTitle({ label: null, assetIds: [1], assetName: 'still' })).toBe('still')
		expect(linkTitle({ label: null, assetIds: [1, 2], assetName: null })).toBe('2 Assets')
	})

	it('counts an Asset it cannot name', () => {
		expect(linkTitle({ label: null, assetIds: [7], assetName: null })).toBe('1 Asset')
	})
})
