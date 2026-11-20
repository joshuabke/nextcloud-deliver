import { describe, expect, it } from 'vitest'
import { bars, barSeconds, CIRCLE, circleAt, clampSpan, DEFAULT_SPAN, dragged, isWhole, overviewWindow, pinchSpan, readSpan, secondsAt, spreadSpan, stack, STACK_STEP, stepAt, stepsFor, wheelSeek, wheelZoom, windowAt, writeSpan, xAt } from './waveWindow.js'

describe('the window of the scrolling Waveform', () => {
	it('centres the playhead, the wave left empty before the start and after the end', () => {
		expect(windowAt(0, 60, 3600)).toEqual({ start: -30, end: 30 })
		expect(windowAt(1800, 60, 3600)).toEqual({ start: 1770, end: 1830 })
		expect(xAt(1800, windowAt(1800, 60, 3600), 400)).toBe(200)
	})

	it('shows a piece whole that is not longer than the window', () => {
		expect(windowAt(5, 60, 40)).toEqual({ start: 0, end: 40 })
		expect(isWhole(clampSpan(60, 40), 40)).toBe(true)
		expect(clampSpan(15, 8)).toBe(8)
	})

	it('zooms no closer than the first step and no wider than the piece', () => {
		expect(clampSpan(3, 3600)).toBe(15)
		expect(clampSpan(9000, 3600)).toBe(3600)
		expect(clampSpan(90, 3600)).toBe(90)
	})

	it('offers the steps narrower than the piece, then the whole', () => {
		expect(stepsFor(3600)).toEqual([15, 60, 300, 3600])
		expect(stepsFor(120)).toEqual([15, 60, 120])
		expect(stepsFor(10)).toEqual([10])
	})

	it('zooms out for a wheel pulled towards the user, in by as much the other way, a mouse notch at a time, within the steps', () => {
		expect(wheelZoom(60, 100, 0, 3600)).toBeCloseTo(60 * Math.exp(0.5))
		expect(wheelZoom(wheelZoom(60, -10, 0, 3600), 10, 0, 3600)).toBeCloseTo(60)
		expect(wheelZoom(60, 3, 1, 3600)).toBeCloseTo(wheelZoom(60, 48, 0, 3600))
		expect(wheelZoom(16, -100, 0, 3600)).toBe(15)
		expect(wheelZoom(3500, 100, 0, 3600)).toBe(3600)
	})

	it('zooms in as two fingers move apart, within the steps', () => {
		expect(pinchSpan(60, 100, 200, 3600)).toBe(30)
		expect(pinchSpan(60, 100, 50, 3600)).toBe(120)
		expect(pinchSpan(60, 100, 1000, 3600)).toBe(15)
		expect(pinchSpan(60, 100, 1, 100)).toBe(100)
	})

	it('presses one step at a time, the nearest within half a second', () => {
		expect(stepAt([15, 60, 60.3], 60)).toBe(60)
		expect(stepAt([15, 60, 60.3], 60.3)).toBe(60.3)
		expect(stepAt([15, 60, 300, 3600], 90)).toBe(null)
	})
})

describe('a place on the scrolling Waveform', () => {
	it('is a moment within the piece', () => {
		const view = windowAt(10, 60, 3600)
		expect(secondsAt(200, view, 400, 3600)).toBe(10)
		expect(secondsAt(300, view, 400, 3600)).toBe(25)
		expect(secondsAt(0, view, 400, 3600)).toBe(0)
	})

	it('moves later as the wave is dragged to the left, the playhead fixed', () => {
		expect(dragged({ from: 100, dx: -200, x: 0, span: 60, width: 400, duration: 3600 })).toBe(130)
		expect(dragged({ from: 10, dx: 400, x: 0, span: 60, width: 400, duration: 3600 })).toBe(0)
	})

	it('moves as a drag for a sideways wheel, in lines as Firefox counts them, within the piece', () => {
		expect(wheelSeek(100, 100, 0, 60, 400, 3600)).toBe(115)
		expect(wheelSeek(100, 3, 1, 60, 400, 3600)).toBeCloseTo(107.2)
		expect(wheelSeek(10, -400, 0, 60, 400, 3600)).toBe(0)
		expect(wheelSeek(30, 400, 0, 60, 400, 40)).toBe(40)
	})

	it('follows the pointer over the whole piece', () => {
		expect(dragged({ from: 0, dx: 50, x: 300, span: 40, width: 400, duration: 40 })).toBe(30)
	})
})

describe('the bars of the scrolling Waveform', () => {
	it('are the loudest of their peaks, scaled to the loudest of the piece', () => {
		const waveform = { rate: 4, peaks: Uint8Array.from([10, 100, 20, 30, 200, 0]) }
		expect(Array.from(bars(waveform, 0.5))).toEqual([0.5, 0.15, 1].map((level) => expect.closeTo(level, 5)))
	})

	it('stretch over a peak where a bar is shorter than one', () => {
		expect(Array.from(bars({ rate: 1, peaks: Uint8Array.from([255, 0]) }, 0.5))).toEqual([1, 1, 0, 0])
	})

	it('keep near silence thin instead of scaling it up', () => {
		expect(bars({ rate: 1, peaks: Uint8Array.from([19]) }, 1)[0]).toBeCloseTo(0.5, 1)
	})

	it('are three pixels apart, an hour at 50 a second staying a few thousand values per zoom', () => {
		expect(barSeconds(60, 390)).toBeCloseTo(60 / 130)
		const hour = { rate: 50, peaks: new Uint8Array(180000) }
		expect(bars(hour, barSeconds(15, 1200)).length).toBe(96000)
	})
})

describe('the window on the overview bar', () => {
	it('is the part of the piece on the stage, cut at its ends', () => {
		expect(overviewWindow(1800, 60, 3600)).toEqual({ left: 49.166666666666664, width: 1.6666666666666667 })
		expect(overviewWindow(0, 60, 3600).left).toBe(0)
		expect(overviewWindow(0, 60, 3600).width).toBeCloseTo(30 / 36)
		expect(overviewWindow(5, 60, 40)).toEqual({ left: 0, width: 100 })
	})
})

describe('the Comments on the scrolling Waveform', () => {
	const comment = (id, inFrame) => ({ id, inFrame })
	const xs = (circles) => circles.map((circle) => circle.comment ? [circle.comment.id, circle.x] : [circle.cluster.map((each) => each.id), circle.x])

	it('sit at their Frames, up to three close ones a little to the right of the one before', () => {
		// 0.1 px a Frame: Frame 1000 at 100 px
		const circles = stack([comment(3, 1100), comment(1, 1000), comment(2, 5000), comment(4, 1150)], 0.1)
		expect(xs(circles)).toEqual([[1, 100], [3, 110], [4, 117], [2, 500]])
	})

	it('become one count circle at their place where more than three share it, and stay at their Frames after it', () => {
		const circles = stack(Array.from({ length: 8 }, (_, at) => comment(at, at * 5)), 1)
		expect(xs(circles)).toEqual([[[0, 1, 2, 3, 4], 0], [5, 25], [6, 32], [7, 39]])
	})

	it('never run on in a chain: 59 Comments over an hour on a phone each stay near their own Frame', () => {
		const many = Array.from({ length: 59 }, (_, at) => comment(at, Math.round(at * at * 1000)))
		const perFrame = 390 / 3600000
		for (const circle of stack(many, perFrame)) {
			const own = (circle.comment ?? circle.cluster[0]).inFrame * perFrame
			expect(circle.x - own).toBeLessThanOrEqual(2 * STACK_STEP)
		}
	})

	it('hit the circle whose centre is nearest, by mouse and by finger', () => {
		// Four in 1.5 s at 15 s across a 390 px phone: 26 px a second
		const three = stack([comment(1, 0), comment(2, 400), comment(3, 1000)], 0.026)
		expect(xs(three)).toEqual([[1, 0], [2, 10.4], [3, 26]])
		expect(circleAt(three, 0, 0, CIRCLE).comment.id).toBe(1)
		expect(circleAt(three, 11, 4, CIRCLE).comment.id).toBe(2)
		expect(circleAt(three, 24, 0, CIRCLE).comment.id).toBe(3)
		expect(circleAt(three, 0, 0, CIRCLE / 2).comment.id).toBe(1)
		expect(circleAt(three, 60, 0, CIRCLE)).toBe(null)
		expect(circleAt(three, 0, CIRCLE + 1, CIRCLE)).toBe(null)
	})

	it('of two circles as near, hit the one on top', () => {
		const circles = [{ comment: comment(1, 0), x: 10 }, { comment: comment(2, 0), x: 10 }]
		expect(circleAt(circles, 10, 0, CIRCLE / 2).comment.id).toBe(2)
	})

	it('part a count circle\'s Comments at the widest zoom that draws each of them, or say they cannot be parted', () => {
		// Five a second apart, in Frames of a millisecond, on 390 px: parted at 15 s (26 px a second)
		const spread = Array.from({ length: 5 }, (_, at) => comment(at, 600000 + at * 1000))
		expect(spreadSpan(spread, 1000, 390, 3600)).toBe(15)
		expect(stack(spread, 390 / 15 / 1000).every((circle) => circle.comment)).toBe(true)
		// Three seconds apart they fit with a margin of half their extent
		expect(spreadSpan(Array.from({ length: 5 }, (_, at) => comment(at, 600000 + at * 3000)), 1000, 390, 3600)).toBe(18)
		// Five within 0.4 s stay a count even at 15 s
		expect(spreadSpan(Array.from({ length: 5 }, (_, at) => comment(at, 600000 + at * 100)), 1000, 390, 3600)).toBe(null)
	})
})

describe('the zoom this browser remembers', () => {
	const memory = () => {
		const kept = new Map()
		return () => ({ getItem: (key) => kept.get(key) ?? null, setItem: (key, value) => kept.set(key, value) })
	}

	it('is a minute until one is chosen, and where storage throws', () => {
		expect(readSpan(memory())).toBe(DEFAULT_SPAN)
		expect(readSpan(() => {
			throw new Error('closed')
		})).toBe(DEFAULT_SPAN)
		expect(() => writeSpan(15, 3600, () => {
			throw new Error('closed')
		})).not.toThrow()
	})

	it('keeps a span, and the whole as the whole of the next piece', () => {
		const storage = memory()
		writeSpan(300, 3600, storage)
		expect(readSpan(storage)).toBe(300)
		writeSpan(3600, 3600, storage)
		expect(readSpan(storage)).toBe(Infinity)
		expect(clampSpan(readSpan(storage), 7200)).toBe(7200)
	})

	it('keeps the whole only where it was a choice, on a piece longer than a minute', () => {
		const storage = memory()
		writeSpan(300, 3600, storage)
		writeSpan(20, 20, storage)
		expect(readSpan(storage)).toBe(300)
		writeSpan(90, 90, storage)
		expect(readSpan(storage)).toBe(Infinity)
	})

	it('takes nothing it did not write', () => {
		const storage = memory()
		storage().setItem('deliver.waveformZoom', 'nonsense')
		expect(readSpan(storage)).toBe(DEFAULT_SPAN)
		storage().setItem('deliver.waveformZoom', '2')
		expect(readSpan(storage)).toBe(DEFAULT_SPAN)
	})
})
