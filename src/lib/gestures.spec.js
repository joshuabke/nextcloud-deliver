import { describe, expect, it } from 'vitest'
import { clampZoom, DOUBLE_TAP_MS, swipeStep, tapSide, waveTap } from './gestures.js'

describe('gestures', () => {
	it('reads a quick sideways stroke as a step to another Asset', () => {
		expect(swipeStep(-120, 10, 200)).toBe(1)
		expect(swipeStep(120, -10, 200)).toBe(-1)
		expect(swipeStep(-40, 0, 200)).toBe(0)
		expect(swipeStep(-120, 90, 200)).toBe(0)
		expect(swipeStep(-120, 0, 900)).toBe(0)
	})

	it('splits the picture into thirds for double taps', () => {
		expect([tapSide(10, 300), tapSide(150, 300), tapSide(290, 300)]).toEqual([-1, 0, 1])
	})

	it('keeps a zoomed picture covering its frame', () => {
		expect(clampZoom({ scale: 0.5, x: 30, y: 0 }, 400, 200)).toEqual({ scale: 1, x: 0, y: 0 })
		expect(clampZoom({ scale: 2, x: 500, y: -500 }, 400, 200)).toEqual({ scale: 2, x: 200, y: -100 })
		expect(clampZoom({ scale: 9, x: 0, y: 0 }, 400, 200).scale).toBe(4)
	})
})

describe('waveTap', () => {
	const tap = { circle: false, card: false, since: null, x: 290, width: 300 }
	it('never seeks on a first tap, and skips to the side of a second one', () => {
		expect(waveTap(tap)).toEqual({ action: 'first', side: 0 })
		expect(waveTap({ ...tap, since: DOUBLE_TAP_MS - 1 })).toEqual({ action: 'skip', side: 1 })
		expect(waveTap({ ...tap, since: 10, x: 10 })).toEqual({ action: 'skip', side: -1 })
		expect(waveTap({ ...tap, since: 10, x: 150 }).side).toBe(0)
		expect(waveTap({ ...tap, since: DOUBLE_TAP_MS })).toEqual({ action: 'first', side: 0 })
	})
	it('opens a circle or closes a card instead of skipping', () => {
		expect(waveTap({ ...tap, since: 10, circle: true }).action).toBe('open')
		expect(waveTap({ ...tap, since: 10, card: true }).action).toBe('close')
		expect(waveTap({ ...tap, since: 10, field: true }).action).toBe('close')
	})
	it('seeks by mouse in the strip, twice for two quick clicks, but not on a circle or to close a card', () => {
		const click = { ...tap, seeks: true }
		expect(waveTap(click).action).toBe('seek')
		expect(waveTap({ ...click, since: 10 }).action).toBe('seek')
		expect(waveTap({ ...click, field: true }).action).toBe('seek')
		expect(waveTap({ ...click, circle: true }).action).toBe('open')
		expect(waveTap({ ...click, card: true }).action).toBe('close')
	})
})
