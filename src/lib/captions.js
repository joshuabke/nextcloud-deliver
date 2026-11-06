/**
 * Captions (#54): SRT or WebVTT as the server stores them, made into the
 * WebVTT a <track> plays. Display only, nothing goes back to the server.
 */
import { fpsValue } from './timecode.js'

/** The largest file Deliver takes, as the server checks it */
export const MAX_BYTES = 1024 * 1024

/** The languages the dialog offers when the file name carries none */
export const COMMON_LANGUAGES = ['ar', 'cs', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr', 'he', 'hi', 'hu', 'it', 'ja', 'ko', 'nl', 'no', 'pl', 'pt', 'ru', 'sv', 'tr', 'uk', 'zh']

/** A cue's timing line: `00:00:01,000 --> 00:00:02,500`, hours optional, a comma or a period before the milliseconds, then WebVTT's cue settings */
const TIMING = /^\s*((?:\d+:)?\d{1,2}:\d{1,2}[,.]\d{1,3})\s*-->\s*((?:\d+:)?\d{1,2}:\d{1,2}[,.]\d{1,3})(.*)$/

/**
 * @param {string} stamp - `h:mm:ss,mmm`, `mm:ss.mmm` and the like
 * @return {number} seconds
 */
function seconds(stamp) {
	const [clock, fraction] = stamp.split(/[,.]/)
	return clock.split(':').reduce((sum, part) => sum * 60 + Number(part), 0) + Number(fraction.padEnd(3, '0')) / 1000
}

/**
 * @param {number} value - seconds, not below 0
 * @return {string} `hh:mm:ss.mmm`, as WebVTT writes it
 */
function stamp(value) {
	const ms = Math.max(0, Math.round(value * 1000))
	const pad = (n, width = 2) => String(Math.floor(n)).padStart(width, '0')
	return `${pad(ms / 3600000)}:${pad((ms / 60000) % 60)}:${pad((ms / 1000) % 60)}.${pad(ms % 1000, 3)}`
}

/**
 * Captions as WebVTT for the player. When the Version starts at a timecode
 * above 0 and every cue lies at or after it, the cues were timed against
 * that timecode, so they move back by it; otherwise they stay as they are.
 *
 * @param {string} text - SRT or WebVTT, a byte order mark allowed
 * @param {?{startFrame?: number, fps: {num: number, den: number}}} version - the Version they play on; null takes the cues as they are
 * @return {?string} WebVTT, or null when not a single cue can be read
 */
export function toWebVtt(text, version = null) {
	const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)
	const vtt = /^WEBVTT(\s|$)/.test(lines[0])
	const timings = lines.map((line) => TIMING.exec(line))
	const starts = timings.filter(Boolean).map((timing) => seconds(timing[1]))
	if (starts.length === 0) {
		return null
	}
	const start = version ? startOf(version) : 0
	// Half a Frame of slack: an editing application writes the first Frame's time cut to the millisecond (3603.599 for 3603.6)
	const slack = version ? 0.5 / fpsValue(version.fps) : 0
	const shift = start > 0 && starts.every((each) => each >= start - slack) ? start : 0
	const body = lines.map((line, i) => {
		const timing = timings[i]
		// SRT carries coordinates after the times that WebVTT would misread as cue settings
		return timing ? `${stamp(seconds(timing[1]) - shift)} --> ${stamp(seconds(timing[2]) - shift)}${vtt ? timing[3] : ''}` : line
	})
	// An SRT cue's number reads as a WebVTT cue identifier
	return (vtt ? body : ['WEBVTT', '', ...body]).join('\n')
}

/**
 * The start timecode as media time, its Frames over the true rate, as
 * Resolve and Premiere time captions: `01:00:00:00` at 23.976 is 3603.6
 * seconds, exact at every rate, drop-frame included.
 *
 * @param {{startFrame?: number, fps: {num: number, den: number}}} version - the Version
 * @return {number} seconds
 */
export function startOf({ startFrame = 0, fps }) {
	return startFrame ? startFrame * fps.den / fps.num : 0
}

/**
 * @param {string} name - the file's name, such as `cut_v3.de.srt`
 * @return {?string} the language it names before the extension, as a BCP 47 tag, or null
 */
export function languageOfName(name) {
	const match = /\.([a-z]{2,3}(?:[-_][a-z0-9]{2,8})?)\.(?:srt|vtt)$/i.exec(name)
	if (!match) {
		return null
	}
	try {
		const [tag] = Intl.getCanonicalLocales(match[1].replace('_', '-'))
		// `cut.v3.srt` or `cut.mov.srt` names no language anybody knows
		return new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' }).of(tag) ? tag : null
	} catch {
		return null
	}
}

/**
 * @param {string} tag - a language, such as de or pt-BR
 * @param {string} locale - the user's language, as Nextcloud names it (de_DE)
 * @return {string} its name in the user's language
 */
export function languageName(tag, locale) {
	try {
		return new Intl.DisplayNames([locale.replace('_', '-')], { type: 'language' }).of(tag) ?? tag
	} catch {
		return tag
	}
}

/**
 * @param {string} name - the file's name
 * @return {boolean} whether Deliver takes it as Captions
 */
export const isCaptionsFile = (name) => /\.(srt|vtt)$/i.test(name)
