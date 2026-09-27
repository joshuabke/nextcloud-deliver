/**
 * Two Versions in step (story 87). Side A leads; side B follows at the same
 * moment plus an offset in B's own Frames, for a cut that was trimmed or
 * lengthened in front. Frame rates may differ, so moments map through time.
 */

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

/**
 * While both play, side B drifts; it is pulled back once it is more than a
 * Frame and a half off, which a viewer does not notice but a seek fixes.
 *
 * @param {number} actual - B's playback position, in seconds
 * @param {number} expected - where B should be, in seconds
 * @param {{num: number, den: number}} fps - B's frame rate
 * @return {boolean} whether to seek B
 */
export function drifted(actual, expected, fps) {
	return Math.abs(actual - expected) > 1.5 * fps.den / fps.num
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
