import { describe, expect, it } from 'vitest'
import { acrossOf, barGrid, bars, barsShown, canvasPixels, CIRCLE, circleAt, circleLook, circlesOf, clampSpan, DEFAULT_SPAN, dragged, easeOut, GLIDE_MS, glided, glideStart, INSET, isWhole, laneBands, loudestOf, MOTION_PER_PITCH, overviewWindow, pinchSpan, pixelPlace, readSpan, retarget, secondsAt, shiftPixels, spreadSpan, steadied, stepAt, stepsFor, wheelSeek, wheelZoom, windowAt, writeSpan, xAt } from './waveWindow.js'

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

	it('are about three CSS px apart on whole device pixels, at every pixel ratio and zoom', () => {
		for (const ratio of [1, 1.25, 1.5, 2, 2.625, 3]) {
			for (const across of [60, 300, 3600]) {
				const pixels = Math.floor(390 * ratio)
				const grid = barGrid(across, pixels, ratio)
				expect(Number.isInteger(grid.pitch) && Number.isInteger(grid.width)).toBe(true)
				expect(grid.pitch - grid.width).toBeGreaterThanOrEqual(1)
				expect(grid.pitch / ratio).toBeGreaterThan(2)
				expect(grid.pitch / ratio).toBeLessThan(4)
				// A bar's seconds are its pitch at this zoom
				expect(grid.seconds / across * pixels).toBeCloseTo(grid.pitch)
			}
		}
		expect(barGrid(60, 1170, 3)).toEqual({ pitch: 9, width: 6, seconds: 60 * 9 / 1170 })
		expect([barGrid(60, 487, 1.25), barGrid(60, 1023, 2.625)].map(({ pitch, width }) => [pitch, width])).toEqual([[4, 3], [8, 5]])
	})

	it('grow apart, bar and gap alike, where the wave would move more than a quarter of a pitch a frame', () => {
		const perFrame = (across, pixels, rate) => pixels / across * rate / 60
		// The cases recorded on #227: 15 s on a 1480 px stage, 15 s at 2× on 840 px, 15 s on 840 px
		for (const [across, pixels, ratio, rate] of [[15, 1480, 1, 1], [15, 840, 1, 2], [15, 840, 1, 1], [15, 840, 1, 4], [15, 1170, 3, 1], [60, 3840, 2, 4]]) {
			const grid = barGrid(across, pixels, ratio, rate)
			expect(perFrame(across, pixels, rate) / grid.pitch).toBeLessThanOrEqual(MOTION_PER_PITCH)
			expect(grid.width / grid.pitch).toBeCloseTo(2 / 3, 1)
		}
		expect(barGrid(15, 1480, 1, 1).pitch).toBe(12)
		expect(barGrid(60, 840, 1, 1).pitch).toBe(3)
		// Standing over the whole piece, it keeps the base pitch
		expect(barGrid(3600, 840, 1, 0).pitch).toBe(3)
	})

	it('stand the playhead on one pixel and take the window from it, at odd and even widths alike', () => {
		for (const pixels of [840, 841, 1125, 1170, 1179]) {
			const heads = new Set()
			for (let at = 600; at < 602; at += 0.0167) {
				const { head, offset } = pixelPlace(at, 60, pixels, false)
				heads.add(head)
				expect(offset + head).toBe(Math.round(at / 60 * pixels))
			}
			expect([...heads]).toEqual([Math.floor(pixels / 2)])
		}
		expect(pixelPlace(1800, 3600, 841, true)).toEqual({ head: 421, offset: 0 })
	})

	it('size the canvas to whole device pixels, never resampled', () => {
		expect(canvasPixels(840, 657, 2, { width: 1680, height: 1314 })).toEqual({ width: 1680, height: 1314, ratio: 2, css: null })
		// An emulated ratio, where the browser counts CSS pixels: the ratio decides
		expect(canvasPixels(840, 657, 2, { width: 840, height: 657 })).toEqual({ width: 1680, height: 1314, ratio: 2, css: null })
		// 1283 px at 1.25 is 1603.75 device pixels: 1603, and the CSS box cut to them
		const cut = canvasPixels(1283, 800, 1.25, null)
		expect([cut.width, cut.height]).toEqual([1603, 1000])
		expect(cut.css.width * 1.25).toBeCloseTo(1603)
		expect(canvasPixels(412, 300, 2.625, null).width).toBe(1081)
		expect(canvasPixels(1280, 800, 1.5, null).css).toBe(null)
	})

	it('stay the same bars with the same heights wherever the window starts, moved by whole device pixels', () => {
		const waveform = { rate: 50, peaks: Uint8Array.from({ length: 180000 }, (_, at) => (at * 7919) % 256) }
		const pixels = 1170
		const across = 60
		const grid = barGrid(across, pixels, 3)
		const levels = bars(waveform, grid.seconds)
		const drawn = (start) => {
			const { offset } = pixelPlace(start, across, pixels, false)
			const { first, last } = barsShown(offset, grid.pitch, pixels, levels.length)
			return new Map(Array.from({ length: last - first + 1 }, (_, at) => [first + at, { x: (first + at) * grid.pitch - offset, level: levels[first + at] }]))
		}
		for (const [from, to] of [[600, 600.0173], [600, 601.3], [1234.567, 1240.001]]) {
			const before = drawn(from)
			const after = drawn(to)
			const shift = pixelPlace(to, across, pixels, false).offset - pixelPlace(from, across, pixels, false).offset
			let common = 0
			for (const [bar, { x, level }] of before) {
				if (after.has(bar)) {
					common++
					expect(after.get(bar).level).toBe(level)
					expect(Number.isInteger(after.get(bar).x)).toBe(true)
					expect(x - after.get(bar).x).toBe(shift)
				}
			}
			expect(common).toBeGreaterThan(100)
		}
	})

	it('keep an hour at 50 peaks a second to a few thousand values per zoom', () => {
		const hour = { rate: 50, peaks: new Uint8Array(180000) }
		expect(bars(hour, barGrid(60, 1200, 1).seconds).length).toBe(24000)
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

describe('the Comments on the scrolling Waveform and above the bar', () => {
	const comment = (id, inFrame) => ({ id, inFrame })
	const xs = (circles) => circles.map((circle) => circle.comment ? [circle.comment.id, circle.x] : [circle.cluster.map((each) => each.id), circle.x])

	it('sit at their Frames, close ones one circle with their count at the first of them', () => {
		// 0.1 px a Frame: Frame 1000 at 100 px
		const circles = circlesOf([comment(3, 1100), comment(1, 1000), comment(2, 5000), comment(4, 1150), comment(5, 1240)], 0.1)
		expect(xs(circles)).toEqual([[[1, 3, 4], 100], [5, 124], [2, 500]])
	})

	it('never cover each other: 59 Comments over an hour on a phone, however close', () => {
		const many = Array.from({ length: 59 }, (_, at) => comment(at, Math.round(at * at * 1000)))
		const circles = circlesOf(many, 390 / 3600000)
		for (let at = 1; at < circles.length; at++) {
			expect(circles[at].x - circles[at - 1].x).toBeGreaterThanOrEqual(CIRCLE)
		}
		expect(circles.flatMap((circle) => circle.cluster ?? [circle.comment])).toHaveLength(59)
	})

	it('stand at the same place on the whole Waveform and above the bar, which is inset', () => {
		const [width, duration, perSecond] = [393, 360, 1000]
		const across = acrossOf(duration, duration, width, INSET)
		const { offset } = pixelPlace(0, across, width, true, INSET)
		const comments = [comment(1, 0), comment(2, 152000), comment(3, 360000)]
		const wave = circlesOf(comments, width / across / perSecond).map((circle) => circle.x - offset)
		const bar = circlesOf(comments, (width - 2 * INSET) / duration / perSecond).map((circle) => INSET + circle.x)
		wave.forEach((x, at) => expect(x).toBeCloseTo(bar[at], 6))
		// The first and the last stay whole on the stage, and a click there is their moment
		expect(wave[0]).toBe(INSET)
		expect(wave[2]).toBeCloseTo(width - INSET, 6)
		const view = windowAt(0, duration, duration, INSET / width * across)
		expect(secondsAt(wave[1], view, width, duration)).toBeCloseTo(152, 6)
		expect(dragged({ from: 0, dx: 0, x: wave[1], span: duration, width, duration, margin: INSET / width * across })).toBeCloseTo(152, 6)
		expect(acrossOf(60, duration, width, INSET)).toBe(60)
	})

	it('look alike wherever they show: initials in the author\'s colour, a neutral count, paler resolved, ringed selected', () => {
		const by = (id, resolved = false) => ({ id, resolved, author: { type: 'user', id: 'kim', name: 'Kim Berg' } })
		const one = circleLook({ comment: by(1) }, [null])
		expect(one).toMatchObject({ text: 'KB', pale: false })
		expect(one.fill.replace(', 0.3)', ', 1)')).toBe(one.line)
		expect(circleLook({ comment: by(1, true) }, [1])).toMatchObject({ line: '#fff', pale: true })
		expect(circleLook({ cluster: [by(1, true), by(2)] }, [])).toEqual({ text: '2', fill: 'rgba(255, 255, 255, 0.18)', line: 'rgba(255, 255, 255, 0.6)', pale: false })
		expect(circleLook({ cluster: [by(1, true), by(2, true)] }, [2])).toMatchObject({ line: '#fff', pale: true })
	})

	it('hit the circle whose centre is nearest, by mouse and by finger', () => {
		const three = circlesOf([comment(1, 0), comment(2, 30), comment(3, 60)], 1)
		expect(circleAt(three, 0, 0, CIRCLE).comment.id).toBe(1)
		expect(circleAt(three, 20, 4, CIRCLE).comment.id).toBe(2)
		expect(circleAt(three, 46, 0, CIRCLE).comment.id).toBe(3)
		expect(circleAt(three, 14, 0, CIRCLE / 2)).toBe(null)
		expect(circleAt(three, 90, 0, CIRCLE)).toBe(null)
		expect(circleAt(three, 0, CIRCLE + 1, CIRCLE)).toBe(null)
	})

	it('part a count circle\'s Comments at the widest zoom that draws each of them, or say they cannot be parted', () => {
		// Five a second apart, in Frames of a millisecond, on 390 px: parted at 15 s (26 px a second)
		const spread = Array.from({ length: 5 }, (_, at) => comment(at, 600000 + at * 1000))
		expect(spreadSpan(spread, 1000, 390, 3600)).toBe(15)
		expect(circlesOf(spread, 390 / 15 / 1000).every((circle) => circle.comment)).toBe(true)
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

describe('the glide to a new place (N13)', () => {
	it('eases out from where the wave stood to where the playhead is', () => {
		expect(easeOut(0)).toBe(0)
		expect(easeOut(1)).toBe(1)
		expect(easeOut(0.5)).toBeGreaterThan(0.5)
		const glide = { from: 100, at: 1000 }
		expect(glided(glide, 1000, 115)).toBe(100)
		const half = glided(glide, 1000 + GLIDE_MS / 2, 115)
		expect(half).toBeGreaterThan(107.5)
		expect(half).toBeLessThan(115)
		expect(glided(glide, 1000 + GLIDE_MS, 115)).toBe(null)
	})

	it('lands on a playhead that moves on meanwhile, without a snap at the end', () => {
		const glide = { from: 100, at: 0 }
		const near = glided(glide, GLIDE_MS - 1, 115 + (GLIDE_MS - 1) / 1000)
		expect(Math.abs(near - (115 + (GLIDE_MS - 1) / 1000))).toBeLessThan(0.001)
	})

	it('keeps its clock when another seek comes while it runs, heading for the new place', () => {
		const glide = { from: 100, at: 0 }
		const again = retarget(glide, 125, 60)
		expect(again.at).toBe(0)
		expect(glided(again, GLIDE_MS / 2, 125)).toBeGreaterThan(glided(glide, GLIDE_MS / 2, 115))
		expect(glided(again, GLIDE_MS, 125)).toBe(null)
		// Held long, it never starts further than a window behind
		expect(retarget(glide, 400, 60).from).toBe(340)
	})

	it('starts at most a window from a far target', () => {
		expect(glideStart(100, 3000, 60)).toBe(2940)
		expect(glideStart(3000, 100, 60)).toBe(160)
		expect(glideStart(100, 115, 60)).toBe(100)
	})
})

describe('Compare\'s lanes', () => {
	it('scales several Waveforms to the loudest of them, so the louder looks louder', () => {
		const loud = { rate: 1, peaks: Uint8Array.from([200, 100]) }
		const soft = { rate: 1, peaks: Uint8Array.from([100, 50]) }
		const scale = loudestOf([loud, soft, null])
		expect(scale).toBe(200)
		expect(Array.from(bars(soft, 1, scale))).toEqual([0.5, 0.25])
		expect(Array.from(bars(soft, 1))).toEqual([1, 0.5])
		// Near silence on both stays thin
		expect(loudestOf([{ rate: 1, peaks: Uint8Array.from([3]) }])).toBeCloseTo(0.15 * 255, 5)
	})

	it('shares the stage out into lanes of whole pixels with a gap between them', () => {
		const bands = laneBands(2, 301, 40, 8, 8)
		expect(bands).toEqual([{ top: 40, height: 123 }, { top: 171, height: 122 }])
		expect(bands[1].top + bands[1].height).toBe(301 - 8)
		expect(laneBands(1, 300, 40, 40, 8)).toEqual([{ top: 40, height: 220 }])
		for (const band of laneBands(2, 427, 120, 24, 24)) {
			expect(Number.isInteger(band.top) && Number.isInteger(band.height)).toBe(true)
		}
	})

	it('moves a lane by its shift in whole device pixels', () => {
		expect(shiftPixels(2, 60, 1200)).toBe(40)
		expect(shiftPixels(-1.001, 60, 1201)).toBe(-20)
	})
})

describe('the time drawn while playing', () => {
	it('moves every frame although currentTime moves in coarse steps', () => {
		let before = null
		const drawn = []
		for (let frame = 0; frame < 30; frame++) {
			const time = frame * 16
			const at = Math.floor(time / 40) * 0.04
			const seconds = steadied(before, at, time, true, 1)
			drawn.push(seconds)
			before = { seconds, time }
		}
		const steps = drawn.slice(1).map((seconds, i) => seconds - drawn[i])
		expect(Math.min(...steps)).toBeGreaterThan(0)
		expect(Math.max(...steps)).toBeLessThan(0.02)
	})

	it('takes currentTime at once on a seek, a pause and after a gap', () => {
		expect(steadied({ seconds: 10, time: 0 }, 50, 16, true, 1)).toBe(50)
		expect(steadied({ seconds: 10, time: 0 }, 10, 16, false, 1)).toBe(10)
		expect(steadied({ seconds: 10, time: 0 }, 10.05, 500, true, 1)).toBe(10.05)
		expect(steadied(null, 3, 0, true, 1)).toBe(3)
		// a paused element (J shuttle, the end) stays where currentTime is, however fresh the last frame
		expect(steadied({ seconds: 10, time: 0 }, 9.9, 16, false, 1)).toBe(9.9)
	})

	it('never leads a stalled currentTime by more than the gap, nor takes long to follow a small seek', () => {
		let before = { seconds: 10, time: 0 }
		let lead = 0
		for (let frame = 1; frame < 60; frame++) {
			const seconds = steadied(before, 10, frame * 16, true, 1)
			lead = Math.max(lead, seconds - 10)
			before = { seconds, time: frame * 16 }
		}
		expect(lead).toBeLessThanOrEqual(0.06)
		// a seek of 0.2 s during playback shows at once, as does one of 0.1 s
		expect(steadied({ seconds: 10, time: 0 }, 10.2, 16, true, 1)).toBe(10.2)
		expect(steadied({ seconds: 10, time: 0 }, 9.9, 16, true, 1)).toBe(9.9)
	})
})
