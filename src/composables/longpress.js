import { HOLD_MS, TAP_SLOP } from '../lib/gestures.js'

/**
 * A long press opens what a right click opens (story 109): mobile Safari
 * sends no contextmenu event for it. The click that follows the press is
 * swallowed, so a card's link does not open as well. A phone also gets a
 * button for the menu, which opens under it.
 *
 * @param {(where: {clientX: number, clientY: number}) => void} open - shows the menu there
 * @return {{press: object, fromButton: (event: MouseEvent) => void}} listeners for the element that answers to the press, and the menu button's click
 */
export function useLongPress(open) {
	let timer = null
	let start = null
	let pressed = false

	/**
	 *
	 */
	function cancel() {
		clearTimeout(timer)
		start = null
	}

	const press = {
		pointerdown(event) {
			if (event.pointerType === 'mouse') {
				return
			}
			pressed = false
			start = { clientX: event.clientX, clientY: event.clientY }
			timer = setTimeout(() => {
				pressed = true
				open(start)
			}, HOLD_MS)
		},
		pointermove(event) {
			if (start && Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) > TAP_SLOP) {
				cancel()
			}
		},
		pointerup: cancel,
		pointercancel: cancel,
		clickCapture(event) {
			if (pressed) {
				pressed = false
				event.preventDefault()
				event.stopPropagation()
			}
		},
	}

	return {
		press,
		fromButton(event) {
			const box = event.currentTarget.getBoundingClientRect()
			open({ clientX: box.left, clientY: box.bottom })
		},
	}
}
