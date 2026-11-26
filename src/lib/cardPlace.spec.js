import { describe, expect, it } from 'vitest'
import { CARD, cardPlace } from './cardPlace.js'

describe('cardPlace', () => {
	it('centres the card over the circle where it has room', () => {
		expect(cardPlace(600, 1280)).toEqual({ left: 600 - CARD.width / 2, width: CARD.width })
	})

	it('keeps it inside the window at either edge', () => {
		expect(cardPlace(10, 1280)).toEqual({ left: CARD.margin, width: CARD.width })
		expect(cardPlace(1275, 1280)).toEqual({ left: 1280 - CARD.margin - CARD.width, width: CARD.width })
		// A window narrower than the card: as wide as it is, less the margins
		expect(cardPlace(100, 240)).toEqual({ left: CARD.margin, width: 240 - 2 * CARD.margin })
	})

	it('stands beside the playhead, on the circle\'s side, never across it', () => {
		// The circle under the playhead in the middle of a desktop: to its right
		expect(cardPlace(640, 1280, 640)).toEqual({ left: 640 + CARD.gap, width: CARD.width })
		// Left of it, the card ends before it
		const left = cardPlace(630, 1280, 640)
		expect(left.left + left.width).toBe(640 - CARD.gap)
		// Far from the playhead it is centred as without
		expect(cardPlace(200, 1280, 640)).toEqual(cardPlace(200, 1280))
	})

	it('narrows beside the playhead on a phone, and takes the other side where the circle\'s is too narrow', () => {
		// Upright, the playhead in the middle: the half beside it
		expect(cardPlace(200, 390, 195)).toEqual({ left: 195 + CARD.gap, width: 390 - CARD.margin - 195 - CARD.gap })
		// The playhead near the right edge, the circle beyond it: the card goes left of it
		const other = cardPlace(375, 390, 360)
		expect(other.left + other.width).toBe(360 - CARD.gap)
		expect(other.width).toBe(CARD.width)
		// No side wide enough: the card takes the window and covers it
		expect(cardPlace(140, 280, 140)).toEqual({ left: CARD.margin, width: 280 - 2 * CARD.margin })
	})
})
