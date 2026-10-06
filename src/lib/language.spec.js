import { describe, expect, it } from 'vitest'
import { addressOf, withLanguage } from './language.js'

describe('the review page address', () => {
	const page = 'https://cloud.example/apps/deliver/s/abc?r=key'

	it('takes the language next to the Personal Link', () => {
		expect(withLanguage(page, 'en')).toBe('https://cloud.example/apps/deliver/s/abc?r=key&forceLanguage=en')
		expect(withLanguage(page + '&forceLanguage=de', 'en')).toBe('https://cloud.example/apps/deliver/s/abc?r=key&forceLanguage=en')
	})

	it('names the Version in the player, or none for the grid', () => {
		expect(addressOf(page, 12)).toBe('https://cloud.example/apps/deliver/s/abc/versions/12?r=key')
		expect(addressOf('https://cloud.example/apps/deliver/s/abc/versions/12?forceLanguage=en', 13)).toBe('https://cloud.example/apps/deliver/s/abc/versions/13?forceLanguage=en')
		expect(addressOf('https://cloud.example/apps/deliver/s/abc/versions/12', null)).toBe('https://cloud.example/apps/deliver/s/abc')
	})
})
