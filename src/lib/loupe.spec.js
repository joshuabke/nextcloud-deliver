import { describe, expect, it } from 'vitest'
import { loupeFrame, loupePart, openLoupe } from './loupe.js'

const HOUR = 3600 * 25

describe('openLoupe', () => {
	it('shows a tenth of the piece, at most a minute and at least a second', () => {
		expect(openLoupe(0, 0, HOUR, 25).frames).toBe(60 * 25)
		expect(openLoupe(0, 0, 750, 25).frames).toBe(75)
		expect(openLoupe(0, 0, 100, 25).frames).toBe(25)
		expect(openLoupe(0, 0, 10, 25).frames).toBe(10)
	})

	it('keeps the Frame under the finger under it, its ends the piece\'s at the bar\'s', () => {
		const middle = openLoupe(HOUR / 2, 0.5, HOUR, 25)
		expect(middle.start).toBe(HOUR / 2 - 750)
		expect(loupeFrame(middle, 0.5, HOUR - 1)).toBe(HOUR / 2)
		const first = openLoupe(0, 0, HOUR, 25)
		expect(first.start).toBe(0)
		const last = openLoupe(HOUR - 1, 1, HOUR, 25)
		expect(last.start).toBe(HOUR - 1501)
	})
})

describe('loupeFrame', () => {
	it('moves through the section as far as the finger moves along the bar, never a jump', () => {
		const loupe = openLoupe(375, 0.5, 750, 25)
		expect(loupeFrame(loupe, 0.5, 749)).toBe(375)
		expect(loupeFrame(loupe, 0.9, 749)).toBe(405)
		expect(loupeFrame(loupe, 0, 749)).toBe(338)
		expect(loupeFrame(loupe, 1, 749)).toBe(413)
	})

	it('stays within the piece', () => {
		const loupe = openLoupe(2, 0.01, 750, 25)
		expect(loupeFrame(loupe, 0, 749)).toBe(1)
		expect(loupeFrame(openLoupe(749, 0.999, 750, 25), 1, 749)).toBe(749)
	})
})

describe('loupePart', () => {
	const loupe = { start: 100, frames: 50 }

	it('places a part in the section, cut at its ends', () => {
		expect(loupePart(loupe, 0, 125)).toEqual({ left: 0, width: 50 })
		expect(loupePart(loupe, 110, 120)).toEqual({ left: 20, width: 20 })
		expect(loupePart(loupe, 140, 400)).toEqual({ left: 80, width: 20 })
	})

	it('shows nothing of a part outside it', () => {
		expect(loupePart(loupe, 0, 100)).toBeNull()
		expect(loupePart(loupe, 150, 160)).toBeNull()
	})
})
