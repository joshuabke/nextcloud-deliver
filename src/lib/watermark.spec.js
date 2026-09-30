import { describe, expect, it } from 'vitest'
import { watermarkTile } from './watermark.js'

describe('watermark', () => {
	it('puts the text into an SVG tile, escaped', () => {
		const tile = decodeURIComponent(watermarkTile('Mara <Client> · 27.9.2026'))
		expect(tile).toMatch(/^url\("data:image\/svg\+xml/)
		expect(tile).toContain('Mara &lt;Client&gt; · 27.9.2026</text>')
	})
})
