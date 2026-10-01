import { describe, expect, it } from 'vitest'
import { AUDIO_MODES, formatAt, formatRange, frameToTime, MODES, modesFor, smpte, stepOf, timeToFrame } from './timecode.js'

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
		expect(formatAt(50, { fps: PAL, mode: 'frames' })).toBe('50')
		expect(formatAt(50, { fps: PAL, mode: 'seconds' })).toBe('2.00 s')
		expect(formatAt(50, { fps: PAL, mode: 'smpte' })).toBe('00:00:02:00')
	})

	it('starts SMPTE at the embedded start timecode, and only SMPTE', () => {
		const hourOne = { fps: PAL, startFrame: 90000 }
		expect(formatAt(50, { ...hourOne, mode: 'smpte' })).toBe('01:00:02:00')
		expect(formatAt(50, { ...hourOne, mode: 'frames' })).toBe('50')
		expect(formatAt(50, { ...hourOne, mode: 'seconds' })).toBe('2.00 s')
	})

	it('writes a Range from its in to its out Frame', () => {
		expect(formatRange({ inFrame: 25, outFrame: null }, { fps: PAL })).toBe('00:00:01:00')
		expect(formatRange({ inFrame: 25, outFrame: 50 }, { fps: PAL, mode: 'frames' })).toBe('25 – 50')
	})
})

describe('audio in milliseconds (ADR 0007)', () => {
	const MS = { num: 1000, den: 1 }
	// A Take that starts 4:12.350 into the session, read in a 25 fps Project
	const audio = { fps: MS, displayFps: PAL, startFrame: 252350 }

	it('shows session time to the millisecond', () => {
		expect(formatAt(1234, { ...audio, mode: 'ms' })).toBe('4:13.584')
		expect(formatAt(0, { ...audio, mode: 'ms', startFrame: 3600000 })).toBe('1:00:00.000')
	})

	it('shows timecode and frames at the Project frame rate', () => {
		expect(formatAt(1234, { ...audio, mode: 'smpte' })).toBe('00:04:13:14')
		expect(formatAt(1234, { ...audio, mode: 'frames' })).toBe('30')
	})

	it('offers milliseconds first for audio, and the old modes for video', () => {
		expect(modesFor(audio)).toEqual(AUDIO_MODES)
		expect(AUDIO_MODES[0]).toBe('ms')
		expect(modesFor({ fps: PAL })).toEqual(MODES)
	})

	it('steps by a Frame of the Project, not by a millisecond', () => {
		expect(stepOf(audio)).toBe(40)
		expect(stepOf({ fps: MS, displayFps: FILM })).toBe(42)
		expect(stepOf({ fps: PAL })).toBe(1)
	})
})
