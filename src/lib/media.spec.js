import { describe, expect, it } from 'vitest'
import { acceptFor, isStill, mediaKind, reviewable, stackKind } from './media.js'

describe('media kinds', () => {
	it('reviews video, audio and the stills browsers show', () => {
		expect(['video/mp4', 'audio/wav', 'image/png', 'image/webp'].every(reviewable)).toBe(true)
		expect(['image/svg+xml', 'image/tiff', 'application/pdf', undefined].some(reviewable)).toBe(false)
	})

	it('names the kind a Version Stack keeps to, and what a picker for its next Version accepts', () => {
		expect([mediaKind('video/quicktime'), mediaKind('audio/wav'), mediaKind('image/png'), mediaKind(null)]).toEqual(['video', 'audio', 'image', null])
		expect([acceptFor('audio/mpeg'), acceptFor(undefined)]).toEqual(['audio/*', 'video/*,audio/*,image/*'])
		expect([stackKind([{ mimeType: null }, { mimeType: 'video/mp4' }]), stackKind([{ mimeType: null }])]).toEqual(['video', null])
	})

	it('tells stills apart', () => {
		expect(isStill({ mimeType: 'image/jpeg' })).toBe(true)
		expect(isStill({ mimeType: 'video/mp4' })).toBe(false)
		expect(isStill(null)).toBe(false)
	})
})
