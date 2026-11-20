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

/** How far the side not heard may be off, on average, before it is brought back, in seconds: below what a switch lets one hear */
export const SYNC_TOLERANCE = 0.008
/** The least time between two corrections, in seconds, so one settles before the next is judged */
export const SETTLE = 0.5

/**
 * The heard side leads and is never corrected; the other follows it (A7).
 * Where the heard side has run out, or the other has no sound at the place,
 * A leads as before.
 *
 * @param {'a'|'b'} heard - whose sound plays
 * @param {{time: number, duration: number, ended: boolean}} a - side A's element
 * @param {{time: number, duration: number, ended: boolean}} b - side B's element
 * @param {number} shift - how far B is ahead, in seconds, as laneShift gives it
 * @return {?{side: 'a'|'b', target: number}} the side to correct and where it belongs, in its own seconds; null where none can be
 */
export function follower(heard, a, b, shift) {
	const within = (time, duration) => time >= 0 && time < duration
	if (heard === 'b' && !b.ended && within(b.time - shift, a.duration)) {
		return { side: 'a', target: b.time - shift }
	}
	return within(a.time + shift, b.duration) ? { side: 'b', target: a.time + shift } : null
}

/**
 * The following side's offset, read on every animation frame, averaged:
 * a single reading of a media element's time is off by some milliseconds.
 *
 * @param {?number} average - the average so far, null after a seek or a switch
 * @param {number} error - how far the following side is ahead of where it belongs now, in seconds
 * @return {number} the average with it
 */
export const averageError = (average, error) => average === null ? error : average * 0.8 + error * 0.2

/**
 * Both sides play on the one output clock (A7), so they keep in step; only
 * a hiccup of the machine puts one out. The side not heard is then sought
 * back, which nobody hears and which lands it exactly. Its speed is never
 * changed: Chrome moves a media element's time by some 20 ms on every change
 * of its playback rate.
 *
 * @param {number} average - the following side's offset, as averageError keeps it
 * @param {number} since - seconds since the last correction, the last seek or the last switch
 * @param {number} tolerance - as toleranceFor gives it
 * @return {boolean} whether to seek it
 */
export const outOfStep = (average, since, tolerance) => Math.abs(average) > tolerance && since >= SETTLE

/** Without the AudioContext the muted side's clock runs some 40 ms ahead of the heard one's: it is left that much */
export const FALLBACK_TOLERANCE = 0.1

/**
 * A playing video element comes back from a seek late by a varying amount
 * (−13 to +5 ms measured), so a video is held to a little more than half a
 * Frame (40 ms Frames: 24 ms; main held it to a Frame and a half), audio to
 * SYNC_TOLERANCE
 *
 * @param {{audioOnly: ?boolean, fps: {num: number, den: number}}} version - the following side's Version
 * @return {number} how far it may be off on average, in seconds
 */
export function toleranceFor(version) {
	return version.audioOnly ? SYNC_TOLERANCE : Math.max(SYNC_TOLERANCE, 0.6 * version.fps.den / version.fps.num)
}

/**
 * A linear crossfade, from where a gain stands to where it goes, so a switch
 * half done can turn back from there. The two gains sum to 1 throughout:
 * two Versions of one mix are nearly the same signal, which an equal-power
 * fade would raise by up to 3 dB in the middle.
 *
 * @param {number} from - the gain now, 0 to 1
 * @param {number} to - the gain wanted, 0 or 1
 * @param {number} [points] - how many values
 * @return {Float32Array} the gain's values over the fade
 */
export function fadeCurve(from, to, points = 16) {
	const start = Math.min(1, Math.max(0, from))
	return Float32Array.from({ length: points }, (_, at) => start + (to - start) * at / (points - 1))
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
 * @return {string[]} "−16.3 LUFS" and "−1.0 dBTP", the peak in dBFS where it is no true peak; each only where it was measured
 */
export function loudnessParts(loudness, locale) {
	const format = decibels(locale)
	return [
		typeof loudness?.integrated === 'number' ? `${format(loudness.integrated)} LUFS` : null,
		typeof loudness?.peak === 'number' ? `${format(loudness.peak)} ${loudness.truePeak ? 'dBTP' : 'dBFS'}` : null,
	].filter(Boolean)
}

/**
 * @param {?object} loudness - as loudnessParts takes it
 * @param {string} locale - the user's language
 * @return {?string} "−16.3 LUFS · −1.0 dBTP"; null where nothing was measured
 */
export function loudnessText(loudness, locale) {
	return loudnessParts(loudness, locale).join(' · ') || null
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
