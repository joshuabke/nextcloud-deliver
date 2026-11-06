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

	it('moves cues timed against the start timecode back by it', () => {
		expect(toWebVtt(srt, 3600)).toBe('WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\nFirst\n\n2\n00:00:10.500 --> 00:00:12.000\nSecond\n')
	})

	it('leaves cues as they are when one lies before the start, or the start is 0', () => {
		const early = '1\n00:59:59,000 --> 01:00:01,000\nEarly\n\n2\n01:00:05,000 --> 01:00:06,000\nLate\n'
		expect(toWebVtt(early, 3600)).toContain('00:59:59.000 --> 01:00:01.000')
		expect(toWebVtt(srt, 0)).toContain('01:00:00.000 --> 01:00:02.000')
		expect(toWebVtt('1\n00:00:01,000 --> 00:00:02,000\nA\n', 3600)).toContain('00:00:01.000 --> 00:00:02.000')
	})

	it('reads the start timecode as the clock time it shows', () => {
		expect(startOf({ startFrame: 0, fps: PAL })).toBe(0)
		expect(startOf({ startFrame: 90000, fps: PAL })).toBe(3600)
		expect(startOf({ startFrame: 90001, fps: PAL })).toBeCloseTo(3600.04)
		// 01:00:00:00 at 23.976 is frame 86400, an hour on the timecode
		expect(startOf({ startFrame: 86400, fps: FILM })).toBe(3600)
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
