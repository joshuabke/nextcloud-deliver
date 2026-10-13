/**
 * Frames are the anchor (CONTEXT.md); seconds are derived here and nowhere
 * else. A frame rate is a fraction, so 24000/1001 stays exact.
 */

/**
 * @param {{num: number, den: number}} fps - frame rate as a fraction
 * @return {number} frames per second as a float
 */
export function fpsValue(fps) {
	return fps.num / fps.den
}

/**
 * The frame a playback position falls into.
 *
 * @param {number} seconds - position of the media element
 * @param {{num: number, den: number}} fps - frame rate
 * @return {number} frame index, zero-based
 */
export function timeToFrame(seconds, fps) {
	return Math.max(0, Math.floor(seconds * fpsValue(fps) + 1e-6))
}

/**
 * The position to seek to for a frame: its middle, because seeking to its
 * start can land on the frame before.
 *
 * @param {number} frame - frame index, zero-based
 * @param {{num: number, den: number}} fps - frame rate
 * @return {number} position in seconds
 */
export function frameToTime(frame, fps) {
	return (frame + 0.5) / fpsValue(fps)
}

/**
 * @param {number} value - number to pad
 * @param {number} width - target width
 * @return {string} zero-padded
 */
function pad(value, width = 2) {
	return String(Math.floor(value)).padStart(width, '0')
}

/**
 * A Frame as text, in one of the display modes. SMPTE and milliseconds start
 * at the Version's embedded start timecode; the frame counter and seconds
 * count from the first frame of the file. Audio counts in milliseconds and
 * carries the Project's frame rate as `displayFps`, at which its timecode and
 * frames are read (ADR 0007).
 *
 * @param {number} frame - frame index, zero-based
 * @param {{fps: {num: number, den: number}, displayFps?: {num: number, den: number}, mode?: string, startFrame?: number, dropFrame?: boolean}} clock - how the Review view shows time: 'smpte', 'frames', 'seconds' or 'ms', and the Version's start timecode in Frames
 * @return {string} the Frame as the Review view shows it
 */
export function formatAt(frame, { fps, displayFps, mode = 'smpte', startFrame = 0, dropFrame = false }) {
	const rate = displayFps ?? fps
	const shown = (at) => displayFps ? Math.floor(at * fpsValue(displayFps) / fpsValue(fps) + 1e-6) : at
	if (mode === 'frames') {
		return String(shown(frame))
	}
	if (mode === 'seconds') {
		return (frame / fpsValue(fps)).toFixed(2) + ' s'
	}
	if (mode === 'ms') {
		return clockTime(Math.round((frame + startFrame) * 1000 / fpsValue(fps)))
	}
	return smpte(shown(frame + startFrame), rate, dropFrame && !displayFps)
}

/**
 * @param {number} ms - milliseconds
 * @return {string} m:ss.mmm, or h:mm:ss.mmm from an hour on
 */
function clockTime(ms) {
	const seconds = Math.floor(ms / 1000)
	const rest = pad(seconds % 60) + '.' + pad(ms % 1000, 3)
	return seconds < 3600
		? Math.floor(seconds / 60) + ':' + rest
		: Math.floor(seconds / 3600) + ':' + pad((seconds / 60) % 60) + ':' + rest
}

/**
 * @param {{inFrame: number, outFrame: ?number}} anchor - a Frame, or a Range when it has an out Frame
 * @param {object} clock - as for formatAt
 * @return {string} the Frame, or the Range from its in to its out Frame
 */
export function formatRange({ inFrame, outFrame }, clock) {
	return formatAt(inFrame, clock) + (outFrame === null ? '' : ' – ' + formatAt(outFrame, clock))
}

/** The display modes, in the order the player's toggle steps through them */
export const MODES = ['smpte', 'frames', 'seconds']
/** Audio shows milliseconds unless someone switches to the Project's timecode or frames */
export const AUDIO_MODES = ['ms', 'smpte', 'frames']

/**
 * @param {{displayFps?: object}} clock - as for formatAt
 * @return {string[]} the display modes this clock offers
 */
export function modesFor(clock) {
	return clock.displayFps ? AUDIO_MODES : MODES
}

/**
 * @param {{fps: {num: number, den: number}, displayFps?: {num: number, den: number}}} clock - as for formatAt
 * @return {number} Frames in one step: one Frame, or for audio one Frame of the Project in milliseconds
 */
export function stepOf({ fps, displayFps }) {
	return displayFps ? Math.max(1, Math.round(fpsValue(fps) / fpsValue(displayFps))) : 1
}

/**
 * SMPTE timecode. Fractional rates count whole frames per timecode second
 * (23.976 counts 24), as NLEs do.
 *
 * @param {number} frame - frame index, zero-based
 * @param {{num: number, den: number}} fps - frame rate
 * @param {boolean} dropFrame - drop-frame counting for 29.97 and 59.94
 * @return {string} HH:MM:SS:FF, with a semicolon before the frames when dropping
 */
export function smpte(frame, fps, dropFrame = false) {
	const nominal = Math.round(fpsValue(fps))
	let counted = frame
	if (dropFrame && (nominal === 30 || nominal === 60)) {
		counted = addDroppedFrames(frame, nominal)
	}
	const frames = counted % nominal
	const totalSeconds = Math.floor(counted / nominal)
	const separator = dropFrame ? ';' : ':'
	return [
		pad(totalSeconds / 3600),
		pad((totalSeconds / 60) % 60),
		pad(totalSeconds % 60),
	].join(':') + separator + pad(frames)
}

/**
 * Drop-frame counting skips two frame numbers (four at 59.94) at the start of
 * every minute except every tenth, so the timecode keeps up with the clock.
 *
 * @param {number} frame - frame index, zero-based
 * @param {number} nominal - 30 or 60
 * @return {number} the frame number to display
 */
function addDroppedFrames(frame, nominal) {
	const dropped = nominal / 15 // 2 at 29.97, 4 at 59.94
	const framesPerMinute = nominal * 60 - dropped
	// Nine minutes that drop, plus the tenth that does not
	const framesPerTenMinutes = framesPerMinute * 10 + dropped
	const tens = Math.floor(frame / framesPerTenMinutes)
	const rest = frame % framesPerTenMinutes
	const minutes = rest < dropped ? 0 : Math.floor((rest - dropped) / framesPerMinute)
	return frame + dropped * (9 * tens + minutes)
}

/**
 * A Version's length on its card, as m:ss or h:mm:ss (story 130).
 *
 * @param {?number} durationFrames - its length in Frames, null until probed
 * @param {{num: ?number, den: ?number}} fps - its frame rate, milliseconds for audio
 * @return {string|null} the runtime, or null while unknown
 */
export function runtime(durationFrames, fps) {
	if (!durationFrames || !fps?.num || !fps?.den) {
		return null
	}
	const seconds = Math.round(durationFrames / fpsValue(fps))
	const hours = Math.floor(seconds / 3600)
	const rest = `${pad(seconds / 60 % 60, hours ? 2 : 1)}:${pad(seconds % 60)}`
	return hours ? `${hours}:${rest}` : rest
}
