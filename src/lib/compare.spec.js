import { describe, expect, it } from 'vitest'
import { compareSource, drifted, frameOnA, frameOnB, laneShift, loudnessGap, loudnessText, nextPass, switchKey } from './compare.js'

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

	it('pulls B back only when it is more than a Frame and a half off', () => {
		expect(drifted(1.05, 1.0, PAL)).toBe(false)
		expect(drifted(1.07, 1.0, PAL)).toBe(true)
		// Audio counts a Frame a millisecond; it is not sought, a gap in its sound, for a few of them
		expect(drifted(1.05, 1.0, { num: 1000, den: 1 })).toBe(false)
		expect(drifted(1.07, 1.0, { num: 1000, den: 1 })).toBe(true)
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

	it('shows loudness as measured, the peak\'s unit by how it was measured, and nothing where nothing was', () => {
		expect(loudnessText({ integrated: -16.3, peak: -1, truePeak: true }, 'en')).toBe('−16.3 LUFS · −1.0 dBTP')
		expect(loudnessText({ integrated: -16.3, peak: 0.4, truePeak: false }, 'de')).toBe('−16,3 LUFS · 0,4 dBFS')
		// Silence has no integrated loudness, but maybe a peak
		expect(loudnessText({ integrated: null, peak: -60.2, truePeak: true }, 'en')).toBe('−60.2 dBTP')
		expect(loudnessText({ integrated: null, peak: null, truePeak: true }, 'en')).toBeNull()
		expect(loudnessText(null, 'en')).toBeNull()
		expect(loudnessText(undefined, 'en')).toBeNull()
	})

	it('tells how far apart the two sides are in LU, only where both were measured', () => {
		expect(loudnessGap({ integrated: -16.3 }, { integrated: -14.1 }, 'en')).toBe('Δ 2.2 LU')
		expect(loudnessGap({ integrated: -14.1 }, { integrated: -16.3 }, 'en')).toBe('Δ 2.2 LU')
		expect(loudnessGap({ integrated: -14 }, { integrated: -14 }, 'en')).toBe('Δ 0.0 LU')
		expect(loudnessGap({ integrated: -14 }, { integrated: null }, 'en')).toBeNull()
		expect(loudnessGap(null, { integrated: -14 }, 'en')).toBeNull()
	})
})
