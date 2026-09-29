import { describe, expect, it } from 'vitest'
import { clampZoom, swipeStep, tapSide } from './gestures.js'

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
