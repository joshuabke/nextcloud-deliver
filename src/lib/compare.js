/**
 * Two Versions in step (story 87). Side A leads; side B follows at the same
 * moment plus an offset in B's own Frames, for a cut that was trimmed or
 * lengthened in front. Frame rates may differ, so moments map through time.
 */

import { isTyping } from './hotkeys.js'

/**
 * @param {number} frameA - the Frame side A stands on
 * @param {{num: number, den: number}} fpsA - A's frame rate
 * @param {{num: number, den: number}} fpsB - B's frame rate
 * @param {number} offset - Frames B is ahead of A, negative when behind
 * @return {number} the Frame side B shows, never before its first
 */
export function frameOnB(frameA, fpsA, fpsB, offset) {
	return Math.max(0, Math.round(frameA * (fpsB.num * fpsA.den) / (fpsB.den * fpsA.num)) + offset)
}

/**
 * @param {number} frameB - a Frame of side B, such as a Comment's
 * @param {{num: number, den: number}} fpsA - A's frame rate
 * @param {{num: number, den: number}} fpsB - B's frame rate
 * @param {number} offset - Frames B is ahead of A
 * @return {number} the Frame of side A that shows it
 */
export function frameOnA(frameB, fpsA, fpsB, offset) {
	return Math.max(0, Math.round((frameB - offset) * (fpsA.num * fpsB.den) / (fpsA.den * fpsB.num)))
}

/** Never pulled back for less than this, in seconds: audio counts in milliseconds, and every seek is a gap in its sound */
export const DRIFT_FLOOR = 0.06

/**
 * While both play, side B drifts; it is pulled back once it is more than a
 * Frame and a half off, which a viewer does not notice but a seek fixes, and
 * at least DRIFT_FLOOR (a Frame and a half at 25 fps).
 *
 * @param {number} actual - B's playback position, in seconds
 * @param {number} expected - where B should be, in seconds
 * @param {{num: number, den: number}} fps - B's frame rate
 * @return {boolean} whether to seek B
 */
export function drifted(actual, expected, fps) {
	return Math.abs(actual - expected) > Math.max(DRIFT_FLOOR, 1.5 * fps.den / fps.num)
}

/**
 * Two streams at once weigh double, so the comparison takes the Proxy
 * where there is one and the original otherwise.
 *
 * @param {object} version - a Version as the API describes it
 * @return {string|null} the URL to play
 */
export function compareSource(version) {
	const proxy = version.derived?.proxy
	if (proxy?.state === 'ready' && proxy.url) {
		return proxy.url
	}
	return version.playable === false ? null : version.url
}

/**
 * @param {number} offset - Frames B is ahead of A
 * @param {{num: number, den: number}} fpsB - B's frame rate
 * @return {number} how far B's Waveform is ahead of A's under the shared playhead, in seconds
 */
export const laneShift = (offset, fpsB) => offset * fpsB.den / fpsB.num

/**
 * The keys of the A/B switch (A4): 1 and 2 pick a side wherever the focus is
 * but in a field; Tab toggles only while the player itself holds the focus,
 * which a click or a tap on it gives and the keyboard never does (it is no
 * stop in the tab order), so Tab and Shift+Tab move through the page as ever.
 *
 * @param {KeyboardEvent} event - the keystroke
 * @param {?EventTarget} player - the player's own element
 * @return {'a'|'b'|'toggle'|null} what to do, or null to leave the key alone
 */
export function switchKey(event, player) {
	if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) {
		return null
	}
	if (event.key === 'Tab') {
		return !event.shiftKey && player !== null && event.target === player ? 'toggle' : null
	}
	return { 1: 'a', 2: 'b' }[event.key] ?? null
}

/**
 * @param {'a'|'b'} side - whose sound the pass that just ended played
 * @param {boolean} alternate - whether each pass of the loop plays the other side
 * @return {'a'|'b'} whose sound the next pass plays
 */
export const nextPass = (side, alternate) => alternate ? (side === 'a' ? 'b' : 'a') : side

/**
 * @param {string} locale - the user's language, for the decimal separator
 * @return {(value: number) => string} one decimal, with a true minus
 */
function decibels(locale) {
	const format = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
	return (value) => format.format(value).replace('-', '−')
}

/**
 * A Version's loudness, shown and never applied (A1)
 *
 * @param {?{integrated: ?number, peak: ?number, truePeak: boolean}} loudness - as its Waveform carries it, if measured
 * @param {string} locale - the user's language
 * @return {?string} "−16.3 LUFS · −1.0 dBTP", the peak in dBFS where it is no true peak; null where nothing was measured
 */
export function loudnessText(loudness, locale) {
	const format = decibels(locale)
	const parts = [
		typeof loudness?.integrated === 'number' ? `${format(loudness.integrated)} LUFS` : null,
		typeof loudness?.peak === 'number' ? `${format(loudness.peak)} ${loudness.truePeak ? 'dBTP' : 'dBFS'}` : null,
	].filter(Boolean)
	return parts.length ? parts.join(' · ') : null
}

/**
 * @param {?object} a - side A's loudness
 * @param {?object} b - side B's
 * @param {string} locale - the user's language
 * @return {?string} "Δ 2.2 LU", how far apart their integrated loudness is; null unless both have one
 */
export function loudnessGap(a, b, locale) {
	if (typeof a?.integrated !== 'number' || typeof b?.integrated !== 'number') {
		return null
	}
	return `Δ ${decibels(locale)(Math.abs(Math.round((a.integrated - b.integrated) * 10) / 10))} LU`
}
