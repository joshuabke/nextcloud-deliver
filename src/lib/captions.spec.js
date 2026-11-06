import { describe, expect, it } from 'vitest'
import { isCaptionsFile, languageName, languageOfName, startOf, toWebVtt } from './captions.js'

const PAL = { num: 25, den: 1 }
const FILM = { num: 24000, den: 1001 }

describe('SRT and WebVTT for the player', () => {
	it('makes WebVTT of an SRT, its numbers as cue identifiers', () => {
		const srt = '1\r\n00:00:01,000 --> 00:00:02,500\r\nHello\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\n<i>World</i>\r\n'
		expect(toWebVtt(srt)).toBe('WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.500\nHello\n\n2\n00:00:03.000 --> 00:00:04.000\n<i>World</i>\n')
	})

	it('reads SRT variants: periods, short hours, short milliseconds, coordinates', () => {
		const srt = '1\n0:00:01.5 --> 0:00:02.25  X1:10 X2:20 Y1:5 Y2:9\nA\n'
		expect(toWebVtt(srt)).toBe('WEBVTT\n\n1\n00:00:01.500 --> 00:00:02.250\nA\n')
	})

	it('drops a byte order mark', () => {
		expect(toWebVtt('\uFEFF1\n00:00:01,000 --> 00:00:02,000\nA\n')).toBe('WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nA\n')
	})

	it('keeps a WebVTT as it is, with its cue settings', () => {
		const vtt = '\uFEFFWEBVTT\n\nNOTE made by hand\n\n00:01.000 --> 00:02.000 line:0 align:start\nTop\n'
		expect(toWebVtt(vtt)).toBe('WEBVTT\n\nNOTE made by hand\n\n00:00:01.000 --> 00:00:02.000 line:0 align:start\nTop\n')
	})

	it('reads nothing from an empty file or one without a cue', () => {
		expect(toWebVtt('')).toBeNull()
		expect(toWebVtt('WEBVTT\n\n')).toBeNull()
		expect(toWebVtt('some text\nwithout timing\n')).toBeNull()
	})
})

describe('the start timecode', () => {
	const srt = '1\n01:00:00,000 --> 01:00:02,000\nFirst\n\n2\n01:00:10,500 --> 01:00:12,000\nSecond\n'
	const at = (startFrame, fps = PAL) => ({ startFrame, fps })

	it('moves cues timed against the start timecode back by it', () => {
		expect(toWebVtt(srt, at(90000))).toBe('WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\nFirst\n\n2\n00:00:10.500 --> 00:00:12.000\nSecond\n')
	})

	it('leaves cues as they are when one lies before the start, or the start is 0', () => {
		const early = '1\n00:59:59,000 --> 01:00:01,000\nEarly\n\n2\n01:00:05,000 --> 01:00:06,000\nLate\n'
		expect(toWebVtt(early, at(90000))).toContain('00:59:59.000 --> 01:00:01.000')
		expect(toWebVtt(srt, at(0))).toContain('01:00:00.000 --> 01:00:02.000')
		expect(toWebVtt(srt)).toContain('01:00:00.000 --> 01:00:02.000')
		expect(toWebVtt('1\n00:00:01,000 --> 00:00:02,000\nA\n', at(90000))).toContain('00:00:01.000 --> 00:00:02.000')
	})

	it('reads the start timecode as media time, its Frames over the true rate', () => {
		expect(startOf(at(0))).toBe(0)
		expect(startOf(at(90000))).toBe(3600)
		expect(startOf(at(90001))).toBeCloseTo(3600.04)
		// 01:00:00:00 at 23.976 is frame 86400, 3603.6 seconds into the media
		expect(startOf(at(86400, FILM))).toBeCloseTo(3603.6, 6)
		// 01:00:00;00 drop-frame at 29.97 is frame 107892
		expect(startOf(at(107892, { num: 30000, den: 1001 }))).toBeCloseTo(3599.9964, 4)
	})

	it('shifts a cue on the first Frame, written cut to the millisecond', () => {
		// Premiere: 10:00:00:00 at 23.976, a cue at 10:00:02:05 written as 10:00:38,210
		const film = '1\n01:00:03,599 --> 01:00:05,000\nFirst Frame\n\n2\n01:00:05,810 --> 01:00:07,000\nLater\n'
		expect(toWebVtt(film, at(86400, FILM))).toBe('WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.400\nFirst Frame\n\n2\n00:00:02.210 --> 00:00:03.400\nLater\n')
		expect(toWebVtt('1\n10:00:38,210 --> 10:00:40,000\nA\n', at(864000, FILM))).toContain('00:00:02.210 --> 00:00:04.000')
	})
})

describe('languages', () => {
	it('takes the language from the file name where it names one', () => {
		expect(languageOfName('cut_v3.de.srt')).toBe('de')
		expect(languageOfName('cut_v3.en.vtt')).toBe('en')
		expect(languageOfName('cut.pt_br.srt')).toBe('pt-BR')
		expect(languageOfName('cut_v3.srt')).toBeNull()
		expect(languageOfName('cut.v3.srt')).toBeNull()
		expect(languageOfName('cut.final.srt')).toBeNull()
	})

	it('names a language in the user\'s language', () => {
		expect(languageName('de', 'de_DE')).toBe('Deutsch')
		expect(languageName('de', 'en')).toBe('German')
	})

	it('takes .srt and .vtt only', () => {
		expect(isCaptionsFile('a.SRT')).toBe(true)
		expect(isCaptionsFile('a.vtt')).toBe(true)
		expect(isCaptionsFile('a.ass')).toBe(false)
	})
})
