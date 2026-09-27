import { describe, expect, it } from 'vitest'
import { isStill, reviewable } from './media.js'

describe('media kinds', () => {
	it('reviews video, audio and the stills browsers show', () => {
		expect(['video/mp4', 'audio/wav', 'image/png', 'image/webp'].every(reviewable)).toBe(true)
		expect(['image/svg+xml', 'image/tiff', 'application/pdf', undefined].some(reviewable)).toBe(false)
	})

	it('tells stills apart', () => {
		expect(isStill({ mimeType: 'image/jpeg' })).toBe(true)
		expect(isStill({ mimeType: 'video/mp4' })).toBe(false)
		expect(isStill(null)).toBe(false)
	})
})
