/** The longest stretch the zoomed section of the bar shows, in seconds */
export const LOUPE_SECONDS = 60
/** The shortest, in seconds */
export const LOUPE_LEAST = 1

/**
 * The zoomed section of the bar that a finger held on it opens (#273): a
 * tenth of the piece, between a second and a minute (an hour on a phone's bar
 * is some 10 s a pixel, the section 0.2 s). It lies across the bar so that the
 * Frame under the finger stays under it, so nothing jumps, and so that its ends
 * are the piece's where the finger is at the bar's.
 *
 * @param {number} frame - the Frame under the finger as it opens
 * @param {number} ratio - where the finger is along the bar, 0 to 1
 * @param {number} durationFrames - the piece's length, in Frames
 * @param {number} fps - Frames a second
 * @return {{start: number, frames: number, frame: number, ratio: number}} the section's first Frame (fractional) and length, and where it opened
 */
export function openLoupe(frame, ratio, durationFrames, fps) {
	const frames = Math.min(durationFrames, Math.round(Math.min(LOUPE_SECONDS * fps, Math.max(LOUPE_LEAST * fps, durationFrames / 10))))
	const start = Math.min(durationFrames - frames, Math.max(0, frame - ratio * frames))
	return { start, frames, frame, ratio }
}

/**
 * The Frame under the finger in the open section: the one it opened on moved
 * by as much of the section as the finger moved along the bar, so its ends
 * are the farthest a finger reaches until it lets go.
 *
 * @param {{frames: number, frame: number, ratio: number}} loupe - as openLoupe gives it
 * @param {number} ratio - where the finger is along the bar now, 0 to 1
 * @param {number} lastFrame - the piece's last Frame
 * @return {number} the Frame
 */
export function loupeFrame(loupe, ratio, lastFrame) {
	return Math.min(lastFrame, Math.max(0, loupe.frame + Math.round((ratio - loupe.ratio) * loupe.frames)))
}

/**
 * @param {{start: number, frames: number}} loupe - as openLoupe gives it
 * @param {number} from - the first Frame of a part of the piece
 * @param {number} to - the Frame after its last
 * @return {{left: number, width: number}|null} what of it the section shows, in percent of the section; null if nothing
 */
export function loupePart({ start, frames }, from, to) {
	const left = Math.max(0, from - start)
	const right = Math.min(frames, to - start)
	return right > left ? { left: (left / frames) * 100, width: ((right - left) / frames) * 100 } : null
}
