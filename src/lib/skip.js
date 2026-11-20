/** The skip buttons and Shift+arrow jump this far (spec: Playback) */
export const SKIP_SECONDS = 10

/**
 * Frames stay the anchor: the seconds become Frames at the Version's rate.
 *
 * @param {number} seconds - how far to jump; negative goes back
 * @param {number} rate - frames per second
 * @return {number} the Frames to move, negative going back
 */
export function skipFrames(seconds, rate) {
	return Math.round(seconds * rate)
}
