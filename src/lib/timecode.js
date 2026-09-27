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
 * A Frame as text, in one of the three display modes. SMPTE starts at the
 * Version's embedded start timecode; the frame counter and seconds count from
 * the first frame of the file.
 *
 * @param {number} frame - frame index, zero-based
 * @param {{num: number, den: number}} fps - frame rate
 * @param {string} mode - 'smpte', 'frames' or 'seconds'
 * @param {{startFrame?: number, dropFrame?: boolean}} timecode - the Version's start timecode, in Frames
 * @return {string} the position as text
 */
export function formatFrame(frame, fps, mode = 'smpte', { startFrame = 0, dropFrame = false } = {}) {
	if (mode === 'frames') {
		return String(frame)
	}
	if (mode === 'seconds') {
		return (frame / fpsValue(fps)).toFixed(2) + ' s'
	}
	return smpte(frame + startFrame, fps, dropFrame)
}

/** The display modes, in the order the player's toggle steps through them */
export const MODES = ['smpte', 'frames', 'seconds']

/**
 * @param {number} frame - frame index, zero-based
 * @param {{fps: {num: number, den: number}, mode: string, startFrame?: number, dropFrame?: boolean}} clock - how the Review view shows time
 * @return {string} the Frame as the Review view shows it
 */
export function formatAt(frame, clock) {
	return formatFrame(frame, clock.fps, clock.mode, clock)
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
