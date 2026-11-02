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
 * @return {string} why this browser cannot make a Proxy of the file
 */
export function unsupported(seen, userAgent) {
	if (!seen) {
		return t('deliver', 'Could not read the file.')
	}
	if (seen.reason === 'format') {
		return t('deliver', 'This format needs ffmpeg, which this server does not have.')
	}
	// Every browser on an iPhone or iPad is WebKit, so another one would not help
	if (/iPhone|iPad|iPod/.test(userAgent)) {
		return seen.reason === 'codec'
			? t('deliver', '{codec} is not supported on this device.', { codec: codecName(seen.codec) })
			: t('deliver', 'This device cannot make Proxies.')
	}
	const name = browserName(userAgent)
	return seen.reason === 'codec'
		? t('deliver', '{codec} is not supported in {browser}. Please use another browser.', { codec: codecName(seen.codec), browser: name ?? t('deliver', 'this browser') })
		: t('deliver', '{browser} cannot make Proxies. Please use another browser.', { browser: name ?? t('deliver', 'This browser') })
}
