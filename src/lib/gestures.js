/** How far a finger may wander and still tap, in px */
export const TAP_SLOP = 10
/** How long a finger rests before a hold starts, in ms */
export const HOLD_MS = 450
/** How soon a second tap makes a double tap, in ms */
export const DOUBLE_TAP_MS = 280

/**
 * A quick, mostly horizontal stroke across the picture (story 104).
 *
 * @param {number} dx - horizontal travel, in px
 * @param {number} dy - vertical travel, in px
 * @param {number} ms - how long the stroke took
 * @return {number} 1 for the next Asset (a stroke to the left), -1 for the previous one, 0 for no swipe
 */
export function swipeStep(dx, dy, ms) {
	if (Math.abs(dx) < 60 || Math.abs(dx) < 2 * Math.abs(dy) || ms > 600) {
		return 0
	}
	return dx < 0 ? 1 : -1
}

/**
 * @param {number} x - where the tap was, from the picture's left edge
 * @param {number} width - the picture's width
 * @return {number} -1 on the left third, 1 on the right third, 0 in the middle
 */
export function tapSide(x, width) {
	if (x < width / 3) {
		return -1
	}
	return x > (width * 2) / 3 ? 1 : 0
}

/**
 * Keeps a zoomed picture covering its frame: never smaller than itself,
 * never pulled so far that an edge shows inside.
 *
 * @param {{scale: number, x: number, y: number}} zoom - the wanted zoom and offset, in px
 * @param {number} width - the frame's width
 * @param {number} height - the frame's height
 * @return {{scale: number, x: number, y: number}} the zoom as it may be
 */
export function clampZoom({ scale, x, y }, width, height) {
	const s = Math.min(4, Math.max(1, scale))
	const maxX = (width * (s - 1)) / 2
	const maxY = (height * (s - 1)) / 2
	return { scale: s, x: Math.min(maxX, Math.max(-maxX, x)), y: Math.min(maxY, Math.max(-maxY, y)) }
}
