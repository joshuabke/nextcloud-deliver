import { describe, expect, it } from 'vitest'
import { averageError, compareSource, fadeCurve, follower, frameOnA, frameOnB, laneShift, loudnessGap, loudnessParts, loudnessText, nextPass, outOfStep, SETTLE, switchKey, SYNC_TOLERANCE, toleranceFor } from './compare.js'

const PAL = { num: 25, den: 1 }
const FILM = { num: 24000, den: 1001 }

describe('compare', () => {
	it('keeps both sides on the same moment, B shifted by its offset', () => {
		expect(frameOnB(100, PAL, PAL, 0)).toBe(100)
		expect(frameOnB(100, PAL, PAL, 12)).toBe(112)
		expect(frameOnB(5, PAL, PAL, -12)).toBe(0)
		expect(frameOnA(112, PAL, PAL, 12)).toBe(100)
	})

	it('maps through time where the frame rates differ', () => {
		// Four seconds: 100 Frames at 25, about 96 at 23.976
		expect(frameOnB(100, PAL, FILM, 0)).toBe(96)
		expect(frameOnA(96, PAL, FILM, 0)).toBe(100)
	})

	it('lets the heard side lead and corrects only the other, A leading where the heard side has nothing there', () => {
		const side = (time, duration = 10, ended = false) => ({ time, duration, ended })
		expect(follower('a', side(3), side(5), 2)).toEqual({ side: 'b', target: 5 })
		expect(follower('b', side(3), side(5), 2)).toEqual({ side: 'a', target: 3 })
		// B has run out: A leads, and B, out of its length, is left alone
		expect(follower('b', side(9), side(10, 10, true), 2)).toBeNull()
		// B heard before A's start: A leads, B follows
		expect(follower('b', side(0.5), side(1), 2)).toEqual({ side: 'b', target: 2.5 })
		expect(follower('a', side(9), side(10, 10), 2)).toBeNull()
	})

	it('brings the side not heard back only when it is out of step on average, and not again before the last has settled', () => {
		let average = null
		// Readings off by a few milliseconds either way average out
		for (const error of [0.006, -0.004, 0.009, -0.002, 0.005, 0.001]) {
			average = averageError(average, error)
		}
		expect(outOfStep(average, 1, SYNC_TOLERANCE)).toBe(false)
		for (let at = 0; at < 10; at++) {
			average = averageError(average, 0.02)
		}
		expect(outOfStep(average, 1, SYNC_TOLERANCE)).toBe(true)
		expect(outOfStep(average, SETTLE / 2, SYNC_TOLERANCE)).toBe(false)
		expect(outOfStep(-0.01, 1, SYNC_TOLERANCE)).toBe(true)
		// A video lands on its Frames: held within a little more than half of one, tighter than the Frame and a half before
		expect(toleranceFor({ audioOnly: false, fps: PAL })).toBeCloseTo(0.024, 6)
		expect(toleranceFor({ audioOnly: false, fps: { num: 120, den: 1 } })).toBe(SYNC_TOLERANCE)
		expect(toleranceFor({ audioOnly: true, fps: { num: 1000, den: 1 } })).toBe(SYNC_TOLERANCE)
		expect(outOfStep(-0.0187, 1, toleranceFor({ audioOnly: false, fps: PAL }))).toBe(false)
	})

	it('crossfades linearly, the two gains summing to 1 throughout, from wherever the gain stands', () => {
		const up = fadeCurve(0, 1, 5)
		const down = fadeCurve(1, 0, 5)
		expect(Array.from(up)).toEqual([0, 0.25, 0.5, 0.75, 1])
		for (let at = 0; at < 5; at++) {
			expect(up[at] + down[at]).toBeCloseTo(1, 6)
		}
		// Turned back halfway, both curves still meet at 1
		expect(Array.from(fadeCurve(up[2], 0, 3))).toEqual([0.5, 0.25, 0])
		expect(Array.from(fadeCurve(down[2], 1, 3))).toEqual([0.5, 0.75, 1])
	})

	it('plays the Proxy where there is one', () => {
		expect(compareSource({ url: '/o', derived: { proxy: { state: 'ready', url: '/p' } } })).toBe('/p')
		expect(compareSource({ url: '/o', derived: { proxy: { state: 'queued' } } })).toBe('/o')
		expect(compareSource({ url: '/o', playable: false, derived: {} })).toBeNull()
	})

	it('shifts lane B by the offset in its own Frames', () => {
		expect(laneShift(50, PAL)).toBe(2)
		expect(laneShift(-24, FILM)).toBeCloseTo(-1.001, 6)
		// The playhead's moment on B is A's moment plus the shift, as frameOnB has it
		expect(laneShift(12, PAL) * 25 + 100).toBe(frameOnB(100, PAL, PAL, 12))
	})

	it('takes 1 and 2 anywhere but in a field, and Tab only while the player itself has the focus', () => {
		const player = { tagName: 'DIV' }
		const button = { tagName: 'BUTTON' }
		const field = { tagName: 'INPUT' }
		const key = (key, target, extra = {}) => switchKey({ key, target, ...extra }, player)
		expect(key('1', button)).toBe('a')
		expect(key('2', player)).toBe('b')
		expect(key('1', field)).toBeNull()
		expect(key('2', button, { ctrlKey: true })).toBeNull()
		expect(key('Tab', player)).toBe('toggle')
		// Moving through the page by keyboard: the focus is on a control, or on nothing yet
		expect(key('Tab', button)).toBeNull()
		expect(key('Tab', { tagName: 'BODY' })).toBeNull()
		expect(key('Tab', player, { shiftKey: true })).toBeNull()
		expect(switchKey({ key: 'Tab', target: null }, null)).toBeNull()
		expect(key('3', player)).toBeNull()
	})

	it('plays the other side on every pass while alternating, the same one otherwise', () => {
		expect(nextPass('a', true)).toBe('b')
		expect(nextPass('b', true)).toBe('a')
		expect(nextPass('b', false)).toBe('b')
	})

	it('shows loudness as measured, the peak in dBTP, and nothing where nothing was', () => {
		expect(loudnessText({ integrated: -16.3, peak: -1 }, 'en')).toBe('−16.3 LUFS · −1.0 dBTP')
		expect(loudnessText({ integrated: -16.3, peak: 0.4 }, 'de')).toBe('−16,3 LUFS · 0,4 dBTP')
		// Silence has no integrated loudness, but maybe a peak
		expect(loudnessText({ integrated: null, peak: -60.2 }, 'en')).toBe('−60.2 dBTP')
		expect(loudnessText({ integrated: null, peak: null }, 'en')).toBeNull()
		expect(loudnessText(null, 'en')).toBeNull()
		expect(loudnessText(undefined, 'en')).toBeNull()
		expect(loudnessParts({ integrated: -16.3, peak: -1 }, 'en')).toEqual(['−16.3 LUFS', '−1.0 dBTP'])
		expect(loudnessParts({ integrated: null, peak: -1 }, 'en')).toEqual(['−1.0 dBTP'])
	})

	it('tells how far apart the two sides are in LU, only where both were measured', () => {
		expect(loudnessGap({ integrated: -16.3 }, { integrated: -14.1 }, 'en')).toBe('Δ 2.2 LU')
		expect(loudnessGap({ integrated: -14.1 }, { integrated: -16.3 }, 'en')).toBe('Δ 2.2 LU')
		expect(loudnessGap({ integrated: -14 }, { integrated: -14 }, 'en')).toBe('Δ 0.0 LU')
		expect(loudnessGap({ integrated: -14 }, { integrated: null }, 'en')).toBeNull()
		expect(loudnessGap(null, { integrated: -14 }, 'en')).toBeNull()
	})
})
