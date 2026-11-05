import { describe, expect, it } from 'vitest'
import { convertible, fits, heavy, lowerTarget, needsProxy, plays, proxyBytes, proxySize, thumbGrid, thumbSlot, videoBitrate, whyNot } from './proxyPlan.js'

const video = (codec, codecString) => ({ type: 'video', codec, codecString })
const audio = (codec) => ({ type: 'audio', codec })

describe('what browsers play, as the server decides it', () => {
	it.each([
		['MP4', [video('avc', 'avc1.64001f'), audio('aac')], true],
		['QuickTime File Format', [video('avc', 'avc1.4d401e')], true],
		['QuickTime File Format', [video('prores', 'apch'), audio('pcm-s16')], false],
		['MP4', [video('avc', 'avc1.6e0028'), audio('aac')], false],
		['MP4', [video('avc', 'avc1.7a0028'), audio('aac')], false],
		['MP4', [video('hevc', 'hvc1.1.6.L93.B0'), audio('aac')], false],
		['MP4', [video('avc', 'avc1.640028'), audio('aac'), audio('ac3')], false],
		['WebM', [video('vp9', 'vp09.00.10.08'), audio('opus')], true],
		['WebM', [video('av1', 'av01.0.04M.08'), audio('opus')], false],
		['Matroska', [video('avc', 'avc1.640028'), audio('flac')], true],
		['MPEG Transport Stream', [video('avc', 'avc1.640028'), audio('aac')], false],
		['WAVE', [audio('pcm-s24')], true],
		['MP3', [audio('mp3')], true],
		['FLAC', [audio('flac')], true],
		['Ogg', [audio('opus')], true],
		['ADTS', [audio('aac')], true],
		['WAVE', [audio('ulaw')], false],
	])('%s %o plays: %s', (format, tracks, expected) => {
		expect(plays(format, tracks)).toBe(expected)
	})

	it('converts only what the server reads the Frames of without ffmpeg', () => {
		expect(convertible('QuickTime File Format')).toBe(true)
		expect(convertible('Matroska')).toBe(true)
		expect(convertible('MPEG Transport Stream')).toBe(false)
	})
})

describe('who gets a Proxy', () => {
	it('gets one when browsers cannot play it, however light', () => {
		expect(needsProxy(false, 1000, 10, 20)).toBe(true)
	})
	it('gets one above the Proxy bitrate threshold', () => {
		expect(needsProxy(true, 30e6, 10, 20)).toBe(true)
		expect(needsProxy(true, 20e6, 10, 20)).toBe(false)
	})
})

describe('the Proxy', () => {
	it('keeps the short side within the Proxy resolution, portrait too, in even pixels', () => {
		expect(proxySize({ width: 3840, height: 2160 }, 1080)).toEqual({ width: 1920, height: 1080 })
		expect(proxySize({ width: 1080, height: 1920 }, 720)).toEqual({ width: 720, height: 1280 })
		expect(proxySize({ width: 2048, height: 858 }, 720)).toEqual({ width: 1718, height: 720 })
		expect(proxySize({ width: 640, height: 360 }, 1080)).toEqual({ width: 640, height: 360 })
		expect(proxySize({ width: 3840, height: 2160 }, 1081).height).toBe(1080)
	})

	it('takes about 8 Mbit/s at 1080p and stays a tenth below the threshold with its sound', () => {
		expect(videoBitrate({ width: 1920, height: 1080 }, 20)).toBe(8e6)
		expect(videoBitrate({ width: 1280, height: 720 }, 20)).toBeCloseTo(3.56e6, -4)
		expect(videoBitrate({ width: 3840, height: 2160 }, 20)).toBe(18e6 - 160e3)
		expect(videoBitrate({ width: 1920, height: 1080 }, 5)).toBe(4.5e6 - 160e3)
	})

	it('needs room for ten minutes at 1080p of about 750 MB', () => {
		expect(proxyBytes(600, 8e6) / 1e6).toBeCloseTo(767, -1)
	})

	it('fits when it has the Frames of the original within half a Frame of its length', () => {
		const original = { frames: 1800, seconds: 1800 / 29.9985 }
		expect(fits({ frames: 1800, seconds: 1800 / 29.9985 + 0.01 }, original)).toBe(true)
		expect(fits({ frames: 1800, seconds: 1800 * 1001 / 30000 }, original), 'snapped to 29.97, it drifts a Frame').toBe(false)
		expect(fits({ frames: 1799, seconds: original.seconds }, original)).toBe(false)
	})
})

describe('the Thumbnail Strip the browser makes in the same pass', () => {
	it('has the grid of the server: a picture a second up to the cap, then fewer', () => {
		expect(thumbGrid(24, 600, { width: 1920, height: 1080 })).toEqual({ every: 1, count: 24, columns: 5, rows: 5, tileHeight: 90 })
		expect(thumbGrid(3600, 600, { width: 1920, height: 1080 })).toEqual({ every: 6, count: 600, columns: 25, rows: 24, tileHeight: 90 })
		expect(thumbGrid(0.5, 600, { width: 1080, height: 1920 })).toEqual({ every: 1, count: 1, columns: 1, rows: 1, tileHeight: 284 })
	})

	it('rounds the height to even as ffmpeg does', () => {
		expect(thumbGrid(10, 600, { width: 2048, height: 858 }).tileHeight).toBe(68)
	})

	it('puts each picture where the fps filter of ffmpeg does, the last before half past each mark winning', () => {
		// fps=1 on 25 fps takes frames 12, 37, 62: 0.48 s, 1.48 s, 2.48 s
		const second = { every: 1, count: 3 }
		expect(thumbSlot(second, 0)).toBe(0)
		expect(thumbSlot(second, 0.48)).toBe(0)
		expect(thumbSlot(second, 0.52)).toBe(1)
		expect(thumbSlot(second, 1.48)).toBe(1)
		expect(thumbSlot(second, 2.52)).toBeNull()
		// fps=1/6 takes 2.96 s, 8.96 s
		expect(thumbSlot({ every: 6, count: 600 }, 2.96)).toBe(0)
		expect(thumbSlot({ every: 6, count: 600 }, 3)).toBe(1)
	})
})

describe('why this browser makes no Proxy', () => {
	const hevc = { codec: 'hevc' }
	it.each([
		['a codec other browsers may decode', { video: true, container: 'MP4', undecodable: hevc }, 'codec'],
		['a track Mediabunny cannot name', { video: true, container: 'QuickTime File Format', undecodable: { codec: null } }, 'format'],
		['HEVC in MPEG-TS, which the server cannot read', { video: true, container: 'MPEG Transport Stream', undecodable: hevc }, 'format'],
		['E-AC-3 in an audio-only .m4a', { video: false, container: 'MP4', undecodable: { codec: 'eac3' } }, 'format'],
		['nothing in the way before the encoder', { video: true, container: 'MP4', undecodable: undefined }, null],
	])('%s', (_, file, reason) => {
		expect(whyNot(file)).toBe(reason)
	})
})

describe('a Proxy above the Proxy bitrate threshold', () => {
	it('is measured by its bytes and length', () => {
		expect(heavy(3_000_000, 1, 20)).toBe(true)
		expect(heavy(3_000_000, 1, 25)).toBe(false)
		expect(heavy(1, 0, 2)).toBe(false)
	})

	it('is made again with the picture bitrate scaled by the overshoot, below the threshold', () => {
		// 10 Mbit/s came out as 30 with the sound: a third, aiming at 85 % of 20 Mbit/s
		const next = lowerTarget(10e6, 3.75e6, 1, 30)
		expect(next).toBeLessThan(10e6)
		expect(next).toBeCloseTo(10e6 * (25.5e6 - 160e3) / (30e6 - 160e3), -3)
		expect(lowerTarget(1, 1e9, 1, 2)).toBe(100_000)
	})
})
