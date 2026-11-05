import { describe, expect, it } from 'vitest'
import { browserName, codecName, refusal, unsupported } from './unsupported.js'

const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0'
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
const CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const EDGE = `${CHROME} Edg/130.0.0.0`
const OPERA = `${CHROME} OPR/115.0.0.0`
const SAMSUNG = `${CHROME.replace('X11; Linux x86_64', 'Linux; Android 14')} SamsungBrowser/25.0`
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1'

describe('what a browser is called', () => {
	it.each([[FIREFOX, 'Firefox'], [SAFARI, 'Safari'], [CHROME, 'Chrome'], [EDGE, 'Edge'], [IPHONE_CHROME, 'Chrome'], [OPERA, null], [SAMSUNG, null], ['curl/8', null]])('%s', (agent, name) => {
		expect(browserName(agent)).toBe(name)
	})

	it.each([['hevc', 'H.265'], ['avc', 'H.264'], ['prores', 'ProRes'], ['av1', 'AV1'], ['vp9', 'VP9'], ['eac3', 'E-AC-3'], ['mp3', 'MP3']])('%s is %s', (id, name) => {
		expect(codecName(id)).toBe(name)
	})
})

describe('why a file does not become a Proxy', () => {
	it('names the codec and the browser where another browser may decode it', () => {
		expect(unsupported({ reason: 'codec', codec: 'hevc' }, FIREFOX)).toBe('H.265 is not supported in Firefox. Please use another browser.')
		expect(unsupported({ reason: 'codec', codec: 'prores' }, 'curl/8')).toBe('ProRes is not supported in this browser. Please use another browser.')
	})

	it('sends nobody to another browser on an iPhone, where all are WebKit', () => {
		expect(unsupported({ reason: 'codec', codec: 'av1' }, IPHONE_CHROME)).toBe('AV1 is not supported on this device.')
		expect(unsupported({ reason: 'encoder' }, IPHONE_CHROME)).toBe('This device cannot make Proxies.')
	})

	it('takes an iPad that reports a Mac for one', () => {
		expect(unsupported({ reason: 'codec', codec: 'av1' }, SAFARI, 5)).toBe('AV1 is not supported on this device.')
		expect(unsupported({ reason: 'codec', codec: 'av1' }, SAFARI, 0)).toBe('AV1 is not supported in Safari. Please use another browser.')
	})

	it('says the browser cannot make Proxies where it has no H.264 encoder', () => {
		expect(unsupported({ reason: 'encoder', codec: null }, EDGE)).toBe('Edge cannot make Proxies. Please use another browser.')
		expect(unsupported({ reason: 'encoder', codec: null }, OPERA)).toBe('This browser cannot make Proxies. Please use another browser.')
	})

	it('needs ffmpeg where no browser helps', () => {
		expect(unsupported({ reason: 'format', codec: null }, CHROME)).toBe('This format needs ffmpeg, which this Nextcloud lacks.')
	})

	it('claims nothing about a file it could not look at', () => {
		expect(unsupported(null, CHROME)).toBe('Could not read the file.')
	})

	it('says Proxies need https on a page that is not a secure context, whatever the browser', () => {
		expect(unsupported({ reason: 'codec', codec: 'hevc' }, FIREFOX, 0, false)).toBe('Proxies need https. Please open Deliver over https.')
		expect(unsupported({ reason: 'encoder', codec: null }, IPHONE_CHROME, 5, false)).toBe('Proxies need https. Please open Deliver over https.')
		expect(unsupported({ reason: 'format', codec: null }, CHROME, 0, false)).toBe('This format needs ffmpeg, which this Nextcloud lacks.')
	})
})

describe('whether an upload is refused', () => {
	const browser = { userAgent: CHROME, touchPoints: 0, secure: true }
	const no = () => ''
	const yes = () => 'maybe'
	const seen = (over) => ({ readable: true, playable: false, convertible: false, reason: 'codec', codec: 'hevc', ...over })

	it('takes a file it could not look at', () => {
		expect(refusal(null, 'video/mp4', no, browser)).toBeNull()
	})

	it('takes what plays and a video it can convert', () => {
		expect(refusal(seen({ playable: true }), 'video/mp4', no, browser)).toBeNull()
		expect(refusal(seen({ convertible: true }), 'video/quicktime', no, browser)).toBeNull()
	})

	it('refuses audio that only converts, as a Proxy is made of video', () => {
		expect(refusal(seen({ convertible: true }), 'audio/flac', no, browser)).toBe('H.265 is not supported in Chrome. Please use another browser.')
	})

	it('takes what Mediabunny cannot read when the browser plays the type, and refuses it otherwise', () => {
		expect(refusal(seen({ readable: false }), 'audio/aiff', yes, browser)).toBeNull()
		expect(refusal(seen({ readable: false, reason: 'format', codec: null }), 'audio/aiff', no, browser)).toBe('This format needs ffmpeg, which this Nextcloud lacks.')
	})
})
