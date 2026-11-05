/**
 * What the browser says when it cannot make a Proxy of a file, in the names
 * people know (ADR 0019); pure, so Vitest can check it.
 */
import { t } from './l10n.js'

const CODECS = { hevc: 'H.265', avc: 'H.264', prores: 'ProRes', av1: 'AV1', vp9: 'VP9', vp8: 'VP8', ac3: 'AC-3', eac3: 'E-AC-3' }

/**
 * @param {string} id - Mediabunny's codec id
 * @return {string} the codec as people know it
 */
export const codecName = (id) => CODECS[id] ?? id.toUpperCase()

/**
 * @param {string} userAgent - the browser's
 * @return {?string} its name, null for one not named here
 */
export function browserName(userAgent) {
	if (/Edg(e|A|iOS)?\//.test(userAgent)) {
		return 'Edge'
	}
	if (/Firefox\/|FxiOS\//.test(userAgent)) {
		return 'Firefox'
	}
	if (/OPR\/|Opera|SamsungBrowser|Vivaldi|YaBrowser/.test(userAgent)) {
		return null
	}
	if (/Chrome\/|Chromium\/|CriOS\//.test(userAgent)) {
		return 'Chrome'
	}
	return /Safari\//.test(userAgent) ? 'Safari' : null
}

/**
 * @param {?object} seen - what inspect() found, null when it could not look
 * @param {string} userAgent - the browser's
 * @param {number} [touchPoints] - the screen's, to tell an iPad that reports a Mac
 * @param {boolean} [secure] - whether the page is a secure context; WebCodecs exists on none else
 * @return {string} why this browser cannot make a Proxy of the file
 */
export function unsupported(seen, userAgent, touchPoints = 0, secure = true) {
	if (!seen) {
		return t('deliver', 'Could not read the file.')
	}
	if (seen.reason === 'format') {
		return t('deliver', 'This format needs ffmpeg, which this Nextcloud lacks.')
	}
	// No other browser has WebCodecs on a page over plain http; https does
	if (!secure) {
		return t('deliver', 'Proxies need https. Please open Deliver over https.')
	}
	// Every browser on an iPhone or iPad is WebKit, so another one would not help
	if (/iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1)) {
		return seen.reason === 'codec'
			? t('deliver', '{codec} is not supported on this device.', { codec: codecName(seen.codec) })
			: t('deliver', 'This device cannot make Proxies.')
	}
	const name = browserName(userAgent)
	return seen.reason === 'codec'
		? t('deliver', '{codec} is not supported in {browser}. Please use another browser.', { codec: codecName(seen.codec), browser: name ?? t('deliver', 'this browser') })
		: t('deliver', '{browser} cannot make Proxies. Please use another browser.', { browser: name ?? t('deliver', 'This browser') })
}

/**
 * Why a file is not taken where the server has no ffmpeg: this browser can
 * neither play nor convert it (ADR 0019), so it would not play for anyone.
 *
 * @param {?object} seen - what inspect() found, null when it could not look
 * @param {string} type - the file's type
 * @param {(type: string) => string} canPlayType - the browser's, for the kind of the file
 * @param {object} browser - the browser's
 * @param {string} browser.userAgent - its user agent
 * @param {number} browser.touchPoints - its screen's
 * @param {boolean} browser.secure - whether the page is a secure context
 * @return {?string} the reason, or null when it is taken
 */
export function refusal(seen, type, canPlayType, { userAgent, touchPoints, secure }) {
	if (seen === null || seen.playable || (seen.convertible && type.startsWith('video/'))) {
		return null
	}
	// Mediabunny reads no such container; the browser may still play it as it is, as Safari does AIFF
	if (!seen.readable && canPlayType(type)) {
		return null
	}
	return unsupported(seen, userAgent, touchPoints, secure)
}
