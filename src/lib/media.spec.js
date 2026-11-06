import { describe, expect, it } from 'vitest'
import { acceptFor, extensionOf, hoverSource, isStill, mediaKind, reviewable, stackKind } from './media.js'

describe('media kinds', () => {
	it('reviews video, audio and the stills browsers show', () => {
		expect(['video/mp4', 'audio/wav', 'image/png', 'image/webp'].every(reviewable)).toBe(true)
		expect(['image/svg+xml', 'image/tiff', 'application/pdf', undefined].some(reviewable)).toBe(false)
		expect(['audio/mpegurl', 'audio/x-mpegurl', 'audio/x-scpls'].some(reviewable), 'playlists only point at other files').toBe(false)
	})

	it('names the kind a Version Stack keeps to, and what a picker for its next Version accepts', () => {
		expect([mediaKind('video/quicktime'), mediaKind('audio/wav'), mediaKind('image/png'), mediaKind(null)]).toEqual(['video', 'audio', 'image', null])
		expect([acceptFor('audio/mpeg'), acceptFor(undefined)]).toEqual(['audio/*', 'video/*,audio/*,image/*'])
		expect([stackKind([{ mimeType: null }, { mimeType: 'video/mp4' }]), stackKind([{ mimeType: null }])]).toEqual(['video', null])
	})

	it('scrubs on hover through the Scrub Proxy once it is ready, else through what plays', () => {
		expect(hoverSource('/scrub', '/proxy')).toBe('/scrub')
		expect(hoverSource(null, '/proxy')).toBe('/proxy')
		expect(hoverSource(undefined, null)).toBe(null)
		expect(hoverSource('/scrub', '/original', true), 'a browser without H.264 goes back to what plays').toBe('/original')
	})

	it('tells stills apart', () => {
		expect(isStill({ mimeType: 'image/jpeg' })).toBe(true)
		expect(isStill({ mimeType: 'video/mp4' })).toBe(false)
		expect(isStill(null)).toBe(false)
	})

	it('reads the extension a rename keeps', () => {
		expect(['cut.MP4', 'cut.v2.mov', 'cut', '.hidden'].map(extensionOf)).toEqual(['.mp4', '.mov', '', ''])
	})
})
