import { describe, expect, it } from 'vitest'
import { compareSource, drifted, frameOnA, frameOnB } from './compare.js'

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
	})

	it('plays the Proxy where there is one', () => {
		expect(compareSource({ url: '/o', derived: { proxy: { state: 'ready', url: '/p' } } })).toBe('/p')
		expect(compareSource({ url: '/o', derived: { proxy: { state: 'queued' } } })).toBe('/o')
		expect(compareSource({ url: '/o', playable: false, derived: {} })).toBeNull()
	})
})
