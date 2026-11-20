/**
 * The geometry of the scrolling Waveform on the audio stage (story 180): a
 * window of the piece, seconds wide, with the playhead fixed in its centre,
 * or the whole piece where it is not longer than the window. Seconds are
 * only for drawing; what the stage hands back is a Frame.
 */

/** The zoom steps, in seconds shown across the stage; the last step is the whole piece */
export const STEPS = [15, 60, 300]
/** What a Version opens with */
export const DEFAULT_SPAN = 60
/** CSS pixels from one bar of the wave to the next */
export const BAR_PITCH = 3

/**
 * @param {number} span - the seconds wanted across the stage
 * @param {number} duration - the length of the piece
 * @return {number} the span within the zoom steps: no narrower than the first, no wider than the piece
 */
export function clampSpan(span, duration) {
	return Math.min(duration, Math.max(STEPS[0], span))
}

/**
 * @param {number} span - the seconds across the stage
 * @param {number} duration - the length of the piece
 * @return {boolean} whether the stage shows the whole piece, the playhead moving over a wave that stands
 */
export const isWhole = (span, duration) => span >= duration

/**
 * @param {number} duration - the length of the piece
 * @return {number[]} the zoom steps that are narrower than the piece, the whole piece after them
 */
export function stepsFor(duration) {
	return [...STEPS.filter((step) => step < duration), duration]
}

/**
 * @param {number} seconds - where the playhead stands
 * @param {number} span - the seconds across the stage
 * @param {number} duration - the length of the piece
 * @return {{start: number, end: number}} the seconds at the left and right edge; before 0 and after the end there is no wave
 */
export function windowAt(seconds, span, duration) {
	if (isWhole(span, duration)) {
		return { start: 0, end: duration }
	}
	return { start: seconds - span / 2, end: seconds + span / 2 }
}

/**
 * @param {number} seconds - a moment of the piece
 * @param {{start: number, end: number}} view - the window
 * @param {number} width - the stage's width, in px
 * @return {number} its x on the stage
 */
export const xAt = (seconds, view, width) => (seconds - view.start) / (view.end - view.start) * width

/**
 * @param {number} x - a place on the stage, from its left edge, in px
 * @param {{start: number, end: number}} view - the window
 * @param {number} width - the stage's width, in px
 * @param {number} duration - the length of the piece
 * @return {number} the moment there, within the piece
 */
export function secondsAt(x, view, width, duration) {
	return Math.min(duration, Math.max(0, view.start + x / width * (view.end - view.start)))
}

/**
 * Where a drag along the stage leads: a scrolling wave moves under the
 * fixed playhead, so dragging it to the left goes later; over the whole
 * piece the playhead follows the pointer.
 *
 * @param {object} drag - the drag
 * @param {number} drag.from - where the playhead stood when it began, in seconds
 * @param {number} drag.dx - how far the pointer has moved since, in px
 * @param {number} drag.x - where the pointer is now, from the stage's left edge
 * @param {number} drag.span - the seconds across the stage
 * @param {number} drag.width - the stage's width, in px
 * @param {number} drag.duration - the length of the piece
 * @return {number} the seconds the playhead stands at now
 */
export function dragged({ from, dx, x, span, width, duration }) {
	if (isWhole(span, duration)) {
		return secondsAt(x, { start: 0, end: duration }, width, duration)
	}
	return Math.min(duration, Math.max(0, from - dx / width * span))
}

/**
 * @param {number} delta - a wheel's delta
 * @param {number} deltaMode - 0 for pixels, 1 for lines (Firefox's wheel), 2 for pages
 * @param {number} page - a page's width or height, in px
 * @return {number} the delta in px
 */
const wheelPixels = (delta, deltaMode, page) => delta * [1, 16, page][deltaMode]

/**
 * @param {number} span - the seconds across the stage now
 * @param {number} deltaY - a wheel's vertical delta; a trackpad pinch comes as one with Ctrl
 * @param {number} deltaMode - as WheelEvent has it
 * @param {number} duration - the length of the piece
 * @return {number} the span after it, wider for a pull towards the user, within the zoom steps
 */
export function wheelZoom(span, deltaY, deltaMode, duration) {
	return clampSpan(span * Math.exp(Math.max(-50, Math.min(50, wheelPixels(deltaY, deltaMode, 800))) * 0.01), duration)
}

/**
 * A sideways wheel or a trackpad's swipe moves the wave as a drag does.
 *
 * @param {number} seconds - where the playhead stands
 * @param {number} deltaX - the wheel's sideways delta; to the right goes later
 * @param {number} deltaMode - as WheelEvent has it
 * @param {number} span - the seconds across the stage
 * @param {number} width - the stage's width, in px
 * @param {number} duration - the length of the piece
 * @return {number} the seconds the playhead stands at after it
 */
export function wheelSeek(seconds, deltaX, deltaMode, span, width, duration) {
	return Math.min(duration, Math.max(0, seconds + wheelPixels(deltaX, deltaMode, width) / width * Math.min(span, duration)))
}

/**
 * @param {number} span - the span when the two fingers came down
 * @param {number} from - their distance then
 * @param {number} to - their distance now
 * @param {number} duration - the length of the piece
 * @return {number} the span now: fingers apart zoom in, within the zoom steps
 */
export function pinchSpan(span, from, to, duration) {
	return clampSpan(span * from / Math.max(1, to), duration)
}

/**
 * @param {number[]} steps - as stepsFor gives them
 * @param {number} span - the seconds across the stage
 * @return {number|null} the one step shown now, the nearest within half a second; none in between
 */
export function stepAt(steps, span) {
	const nearest = steps.reduce((best, step) => Math.abs(step - span) < Math.abs(best - span) ? step : best, steps[0])
	return Math.abs(nearest - span) < 0.5 ? nearest : null
}

const SPAN_KEY = 'deliver.waveformZoom'

/**
 * The zoom this browser last chose, for every audio Version; a minute until
 * it chose, and where storage is closed or throws.
 *
 * @param {() => Storage} [storage] - gives localStorage, unless a test brings its own; asked inside the try, as the accessor itself may throw
 * @return {number} the span, Infinity for the whole piece
 */
export function readSpan(storage = () => globalThis.localStorage) {
	try {
		const value = storage().getItem(SPAN_KEY)
		if (value === 'whole') {
			return Infinity
		}
		const span = Number(value)
		return value !== null && Number.isFinite(span) && span >= STEPS[0] ? span : DEFAULT_SPAN
	} catch {
		return DEFAULT_SPAN
	}
}

/**
 * The whole counts as a choice only on a piece longer than the window it opens with;
 * on a shorter one it is all there is, and the zoom kept stays.
 *
 * @param {number} span - the span chosen
 * @param {number} duration - the length of the piece it was chosen on: the whole stays the whole on another
 * @param {() => Storage} [storage] - as for readSpan
 */
export function writeSpan(span, duration, storage = () => globalThis.localStorage) {
	const whole = isWhole(span, duration)
	if (whole && duration <= DEFAULT_SPAN) {
		return
	}
	try {
		storage().setItem(SPAN_KEY, whole ? 'whole' : String(span))
	} catch {
		// The zoom then lasts until the page is left
	}
}

/**
 * @param {number} span - the seconds across the stage
 * @param {number} width - the stage's width, in px
 * @return {number} the seconds one bar of the wave stands for
 */
export const barSeconds = (span, width) => span / Math.max(1, Math.round(width / BAR_PITCH))

/**
 * The wave in bars of a fixed length of time, counted from the start of the
 * piece, so they keep their heights while the window slides over them.
 * Each is the loudest of its peaks, scaled to the loudest of the piece so
 * quiet dialogue does not flatten into a line; near silence stays thin.
 *
 * @param {{rate: number, peaks: Uint8Array}} waveform - as readWaveform gives it
 * @param {number} seconds - the length of one bar
 * @return {Float32Array} 0 to 1 for each bar, the first at 0 s
 */
export function bars({ rate, peaks }, seconds) {
	const per = seconds * rate
	const levels = new Float32Array(Math.max(1, Math.ceil(peaks.length / per)))
	let loudest = 0.15 * 255
	for (let bar = 0; bar < levels.length; bar++) {
		const from = Math.floor(bar * per)
		const to = Math.min(peaks.length, Math.max(from + 1, Math.floor((bar + 1) * per)))
		let level = 0
		for (let at = from; at < to; at++) {
			if (peaks[at] > level) {
				level = peaks[at]
			}
		}
		levels[bar] = level
		loudest = Math.max(loudest, level)
	}
	for (let bar = 0; bar < levels.length; bar++) {
		levels[bar] /= loudest
	}
	return levels
}

/**
 * @param {number} seconds - where the playhead stands
 * @param {number} span - the seconds across the stage
 * @param {number} duration - the length of the piece
 * @return {{left: number, width: number}} the window on the overview bar, in percent of the piece
 */
export function overviewWindow(seconds, span, duration) {
	if (!(duration > 0)) {
		return { left: 0, width: 100 }
	}
	const { start, end } = windowAt(seconds, span, duration)
	const from = Math.max(0, start)
	const to = Math.min(duration, end)
	return { left: from / duration * 100, width: Math.max(0, to - from) / duration * 100 }
}

/** A Comment's circle on the wave, across, in px (story 181) */
export const CIRCLE = 24
/** How far a circle in a stack sits from the one under it, in px */
export const STACK_STEP = 7

/**
 * The Comments' circles at this zoom: each at its Frame, the ones too close
 * to the one before stacked a little to the right of it, the later on top.
 *
 * @param {Array<{id: number, inFrame: number}>} comments - the top-level Comments
 * @param {number} perFrame - px per Frame at this zoom
 * @return {Array<{comment: object, x: number}>} in drawing order, x in px from the start of the piece
 */
export function stack(comments, perFrame) {
	let before = -Infinity
	return [...comments]
		.sort((a, b) => a.inFrame - b.inFrame || a.id - b.id)
		.map((comment) => {
			const at = comment.inFrame * perFrame
			before = at - before < CIRCLE ? before + STACK_STEP : at
			return { comment, x: before }
		})
}

/**
 * @param {Array<{comment: object, x: number}>} circles - as stack gives them
 * @param {number} x - the pointer, in px from the start of the piece
 * @param {number} dy - the pointer's distance from the circles' centre line, in px
 * @param {number} reach - how far from a centre still hits it; a finger's is wider than a mouse's
 * @return {object|null} the Comment of the topmost circle there
 */
export function circleAt(circles, x, dy, reach) {
	for (let at = circles.length - 1; at >= 0; at--) {
		if (Math.hypot(circles[at].x - x, dy) <= reach) {
			return circles[at].comment
		}
	}
	return null
}
