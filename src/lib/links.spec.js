import { describe, expect, it } from 'vitest'
import { downloadUrl, linkify } from './links.js'

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

describe('download URL of an original', () => {
	it('asks Deliver for a download, which the link notes, and leaves a share\'s WebDAV alone', () => {
		expect(downloadUrl('/index.php/apps/deliver/s/abc/media/7/original')).toBe('/index.php/apps/deliver/s/abc/media/7/original?download=1')
		expect(downloadUrl('/apps/deliver/s/abc/media/7/original?x=1')).toBe('/apps/deliver/s/abc/media/7/original?x=1&download=1')
		expect(downloadUrl('https://cloud/public.php/dav/files/abc/cut.mp4')).toBe('https://cloud/public.php/dav/files/abc/cut.mp4')
	})
})
