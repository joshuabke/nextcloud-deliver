import { describe, expect, it } from 'vitest'
import { linkify } from './links.js'

describe('links in Comments', () => {
	it('leaves plain text alone', () => {
		expect(linkify('warmer, please')).toEqual([{ text: 'warmer, please' }])
	})

	it('turns URLs into links and keeps the text around them', () => {
		expect(linkify('see https://example.test/ref.png for the grade')).toEqual([
			{ text: 'see ' },
			{ text: 'https://example.test/ref.png', href: 'https://example.test/ref.png' },
			{ text: ' for the grade' },
		])
	})

	it('does not swallow the punctuation that ends a sentence', () => {
		expect(linkify('like https://example.test/a.')).toEqual([
			{ text: 'like ' },
			{ text: 'https://example.test/a', href: 'https://example.test/a' },
			{ text: '.' },
		])
	})

	it('only links web addresses', () => {
		expect(linkify('javascript:alert(1)')).toEqual([{ text: 'javascript:alert(1)' }])
	})
})
