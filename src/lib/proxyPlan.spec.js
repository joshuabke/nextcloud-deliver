import { describe, expect, it } from 'vitest'
import { frameRate, needsProxy, plays, proxyBytes, proxySize, videoBitrate } from './proxyPlan.js'

describe('what browsers play, as the server decides it', () => {
	it.each([
		[{ format: 'MP4', video: 'avc', videoCodec: 'avc1.64001f', audio: 'aac' }, true],
		[{ format: 'QuickTime File Format', video: 'avc', videoCodec: 'avc1.4d401e', audio: null }, true],
		[{ format: 'QuickTime File Format', video: 'prores', videoCodec: 'apch', audio: 'pcm-s16' }, false],
		[{ format: 'MP4', video: 'avc', videoCodec: 'avc1.6e0028', audio: 'aac' }, false],
		[{ format: 'MP4', video: 'avc', videoCodec: 'avc1.7a0028', audio: 'aac' }, false],
		[{ format: 'MP4', video: 'hevc', videoCodec: 'hvc1.1.6.L93.B0', audio: 'aac' }, false],
		[{ format: 'WebM', video: 'vp9', videoCodec: 'vp09.00.10.08', audio: 'opus' }, true],
		[{ format: 'WebM', video: 'av1', videoCodec: 'av01.0.04M.08', audio: 'opus' }, false],
		[{ format: 'Matroska', video: 'avc', videoCodec: 'avc1.640028', audio: 'flac' }, true],
		[{ format: 'MPEG-TS', video: 'avc', videoCodec: 'avc1.640028', audio: 'aac' }, false],
	])('%o plays: %s', (file, expected) => {
		expect(plays(file)).toBe(expected)
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
	})

	it('takes about 8 Mbit/s at 1080p and stays below the threshold with its sound', () => {
		expect(videoBitrate({ width: 1920, height: 1080 }, 20)).toBe(8e6)
		expect(videoBitrate({ width: 1280, height: 720 }, 20)).toBeCloseTo(3.56e6, -4)
		expect(videoBitrate({ width: 3840, height: 2160 }, 20)).toBe(20e6 - 160e3)
		expect(videoBitrate({ width: 1920, height: 1080 }, 5)).toBe(5e6 - 160e3)
	})

	it('needs room for ten minutes at 1080p of about 750 MB', () => {
		expect(proxyBytes(600, 8e6) / 1e6).toBeCloseTo(767, -1)
	})
})

describe('the frame rate', () => {
	it('stays an exact fraction for the rates of film and broadcast', () => {
		expect(frameRate(48, 2.002)).toEqual({ num: 24000, den: 1001 })
		expect(frameRate(2997, 100)).toEqual({ num: 30000, den: 1001 })
		expect(frameRate(50, 2)).toEqual({ num: 25, den: 1 })
	})
	it('keeps another rate to a thousandth', () => {
		expect(frameRate(125, 10)).toEqual({ num: 25, den: 2 })
	})
})
