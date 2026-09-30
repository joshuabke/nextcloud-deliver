import { ref } from 'vue'
import { clampZoom, DOUBLE_TAP_MS, HOLD_MS, swipeStep, TAP_SLOP, tapSide } from '../lib/gestures.js'

/** What a gesture without a handler does */
function noop() {}

/**
 * Touch on the picture, as in the Frame.io app (story 104): a tap, a double
 * tap on the left or right third, a hold, a swipe sideways, two fingers to
 * zoom and, once zoomed, one to pan. Only fingers and pens count; the mouse
 * keeps its clicks.
 *
 * @param {object} handlers - what to do; a gesture without one does nothing
 * @param {() => void} [handlers.tap] - a single tap
 * @param {(side: number) => void} [handlers.doubleTap] - a double tap, with -1, 0 or 1 for the third it hit
 * @param {() => void} [handlers.holdStart] - a finger rests
 * @param {() => void} [handlers.holdEnd] - the resting finger lifts
 * @param {(step: number) => void} [handlers.swipe] - a swipe, with 1 for the next Asset and -1 for the previous
 * @param {import('vue').Ref<boolean>} enabled - false while drawing
 * @return {object} the zoom to apply, the pointer listeners, and whether the last pointer was a finger
 */
export function useGestures({ tap = noop, doubleTap = noop, holdStart = noop, holdEnd = noop, swipe = noop }, enabled) {
	const zoom = ref({ scale: 1, x: 0, y: 0 })
	/** Set while fingers are on the picture, so the click that follows a tap is ignored */
	const touched = ref(false)
	const pointers = new Map()
	let start = null
	let pinch = null
	let holdTimer = null
	let holding = false
	let tapTimer = null
	let lastTap = null

	/**
	 *
	 */
	function reset() {
		zoom.value = { scale: 1, x: 0, y: 0 }
	}

	/**
	 * @param {PointerEvent} event - a finger comes down
	 */
	function down(event) {
		if (event.pointerType === 'mouse') {
			touched.value = false
			return
		}
		if (!enabled.value) {
			return
		}
		touched.value = true
		try {
			// Keeps the finger's moves coming when it leaves the picture
			event.currentTarget.setPointerCapture(event.pointerId)
		} catch {
			// A pointer the browser does not track, as in synthetic tests
		}
		pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
		if (pointers.size === 2) {
			clearTimeout(holdTimer)
			const [a, b] = [...pointers.values()]
			pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: { ...zoom.value } }
			start = null
			return
		}
		start = { x: event.clientX, y: event.clientY, t: event.timeStamp, zoom: { ...zoom.value }, moved: false }
		holdTimer = setTimeout(() => {
			holding = true
			holdStart()
		}, HOLD_MS)
	}

	/**
	 * @param {PointerEvent} event - a finger moves
	 */
	function move(event) {
		if (!pointers.has(event.pointerId)) {
			return
		}
		pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
		const box = event.currentTarget.getBoundingClientRect()
		if (pinch && pointers.size === 2) {
			const [a, b] = [...pointers.values()]
			const scale = pinch.zoom.scale * Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance
			zoom.value = clampZoom({ ...pinch.zoom, scale }, box.width, box.height)
			return
		}
		if (!start) {
			return
		}
		const dx = event.clientX - start.x
		const dy = event.clientY - start.y
		if (Math.hypot(dx, dy) > TAP_SLOP) {
			start.moved = true
			if (!holding) {
				clearTimeout(holdTimer)
			}
		}
		// Zoomed in, one finger moves the picture
		if (start.zoom.scale > 1) {
			zoom.value = clampZoom({ scale: start.zoom.scale, x: start.zoom.x + dx, y: start.zoom.y + dy }, box.width, box.height)
		}
	}

	/**
	 * @param {PointerEvent} event - a finger lifts
	 */
	function up(event) {
		if (!pointers.delete(event.pointerId)) {
			return
		}
		clearTimeout(holdTimer)
		if (pinch) {
			if (pointers.size === 0) {
				pinch = null
				// Let go close to the original size and it snaps back
				if (zoom.value.scale < 1.05) {
					reset()
				}
			}
			return
		}
		if (holding) {
			holding = false
			holdEnd()
			start = null
			return
		}
		if (!start || event.type === 'pointercancel') {
			start = null
			return
		}
		const { x, y, t, moved, zoom: before } = start
		start = null
		if (moved) {
			const step = before.scale === 1 ? swipeStep(event.clientX - x, event.clientY - y, event.timeStamp - t) : 0
			if (step) {
				swipe(step)
			}
			return
		}
		const box = event.currentTarget.getBoundingClientRect()
		if (lastTap && event.timeStamp - lastTap < DOUBLE_TAP_MS) {
			clearTimeout(tapTimer)
			lastTap = null
			doubleTap(tapSide(event.clientX - box.left, box.width))
			return
		}
		lastTap = event.timeStamp
		tapTimer = setTimeout(() => {
			lastTap = null
			tap()
		}, DOUBLE_TAP_MS)
	}

	return { zoom, touched, reset, listeners: { pointerdown: down, pointermove: move, pointerup: up, pointercancel: up } }
}
