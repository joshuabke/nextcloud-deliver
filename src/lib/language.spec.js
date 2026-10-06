import { describe, expect, it } from 'vitest'
import { languageRedirect, withLanguage } from './language.js'

describe('the language a Reviewer chose', () => {
	const page = 'https://cloud.example/apps/deliver/s/abc?r=key'

	it('goes into the address, next to the Personal Link', () => {
		expect(withLanguage(page, 'en')).toBe('https://cloud.example/apps/deliver/s/abc?r=key&forceLanguage=en')
	})

	it('brings a later visit to it', () => {
		expect(languageRedirect(page, 'en', 'de')).toBe('https://cloud.example/apps/deliver/s/abc?r=key&forceLanguage=en')
	})

	it('stays where the page already speaks it, or was asked for one', () => {
		expect(languageRedirect(page, null, 'de')).toBeNull()
		expect(languageRedirect(page, 'de', 'de_DE')).toBeNull()
		expect(languageRedirect(page + '&forceLanguage=de', 'en', 'de')).toBeNull()
	})
})
