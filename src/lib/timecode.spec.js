import { describe, expect, it } from 'vitest'
import { formatFrame, frameToTime, smpte, timeToFrame } from './timecode.js'

const PAL = { num: 25, den: 1 }
const FILM = { num: 24000, den: 1001 }
const NTSC = { num: 30000, den: 1001 }

describe('frames and seconds', () => {
	it('reads the frame a position falls into', () => {
		expect(timeToFrame(0, PAL)).toBe(0)
		expect(timeToFrame(0.039, PAL)).toBe(0)
		expect(timeToFrame(0.04, PAL)).toBe(1)
		expect(timeToFrame(-1, PAL)).toBe(0)
	})

	it('seeks to the middle of a frame so the browser shows that frame', () => {
		expect(frameToTime(0, PAL)).toBeCloseTo(0.02)
		expect(timeToFrame(frameToTime(37, PAL), PAL)).toBe(37)
		expect(timeToFrame(frameToTime(37, FILM), FILM)).toBe(37)
	})
})

describe('timecode display', () => {
	it('counts whole frames per timecode second, also at 23.976', () => {
		expect(smpte(0, PAL)).toBe('00:00:00:00')
		expect(smpte(24, PAL)).toBe('00:00:00:24')
		expect(smpte(25, PAL)).toBe('00:00:01:00')
		expect(smpte(1500, PAL)).toBe('00:01:00:00')
		expect(smpte(24, FILM)).toBe('00:00:01:00')
	})

	it('skips the dropped frame numbers at 29.97', () => {
		expect(smpte(1798, NTSC, true)).toBe('00:00:59;28')
		expect(smpte(1800, NTSC, true)).toBe('00:01:00;02')
		expect(smpte(17982, NTSC, true)).toBe('00:10:00;00')
	})

	it('follows the Project setting', () => {
		expect(formatFrame(50, PAL, 'frames')).toBe('50')
		expect(formatFrame(50, PAL, 'seconds')).toBe('2.00 s')
		expect(formatFrame(50, PAL, 'smpte')).toBe('00:00:02:00')
	})

	it('starts SMPTE at the embedded start timecode, and only SMPTE', () => {
		const hourOne = { startFrame: 90000 }
		expect(formatFrame(50, PAL, 'smpte', hourOne)).toBe('01:00:02:00')
		expect(formatFrame(50, PAL, 'frames', hourOne)).toBe('50')
		expect(formatFrame(50, PAL, 'seconds', hourOne)).toBe('2.00 s')
	})
})
