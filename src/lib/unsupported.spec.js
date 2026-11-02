import { describe, expect, it } from 'vitest'
import { browserName, codecName, unsupported } from './unsupported.js'

const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0'
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
const CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const EDGE = `${CHROME} Edg/130.0.0.0`
const OPERA = `${CHROME} OPR/115.0.0.0`

describe('what a browser is called', () => {
	it.each([[FIREFOX, 'Firefox'], [SAFARI, 'Safari'], [CHROME, 'Chrome'], [EDGE, 'Edge'], [OPERA, null], ['curl/8', null]])('%s', (agent, name) => {
		expect(browserName(agent)).toBe(name)
	})

	it.each([['hevc', 'H.265'], ['avc', 'H.264'], ['prores', 'ProRes'], ['av1', 'AV1'], ['vp9', 'VP9'], ['eac3', 'E-AC-3'], ['mp3', 'MP3']])('%s is %s', (id, name) => {
		expect(codecName(id)).toBe(name)
	})
})

describe('why a file does not become a Proxy', () => {
	it('names the codec and the browser', () => {
		expect(unsupported({ readable: true, codec: 'hevc' }, FIREFOX)).toBe('H.265 is not supported in Firefox. Please use another browser.')
		expect(unsupported({ readable: true, codec: 'prores' }, 'curl/8')).toBe('ProRes is not supported in this browser. Please use another browser.')
	})

	it('names no codec of a format it cannot read', () => {
		expect(unsupported({ readable: false, codec: null }, SAFARI)).toBe('This format is not supported in Safari. Please use another browser.')
		expect(unsupported(null, CHROME)).toBe('This format is not supported in Chrome. Please use another browser.')
	})

	it('says the browser cannot make Proxies where the codec decodes', () => {
		expect(unsupported({ readable: true, codec: null }, EDGE)).toBe('Edge cannot make Proxies. Please use another browser.')
		expect(unsupported({ readable: true, codec: null }, 'curl/8')).toBe('This browser cannot make Proxies. Please use another browser.')
	})
})
