/** The skip buttons and Shift+arrow jump this far (spec: Playback) */
export const SKIP_SECONDS = 10

/**
 * Frames stay the anchor: the seconds become Frames at the Version's rate.
 *
 * @param {number} direction - -1 back, 1 forward
 * @param {number} rate - frames per second
 * @return {number} the Frames to move, negative going back
 */
export function skipFrames(direction, rate) {
	return direction * Math.round(SKIP_SECONDS * rate)
}
