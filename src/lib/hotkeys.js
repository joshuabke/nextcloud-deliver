/**
 * The keyboard map of the Review view (spec: Playback and Comments). Free of
 * the DOM so Vitest can check it; the player runs the action it gets back.
 */
const KEYS = {
	' ': 'playPause',
	k: 'playPause',
	arrowright: 'stepForward',
	'.': 'stepForward',
	arrowleft: 'stepBack',
	',': 'stepBack',
	j: 'shuttleBack',
	l: 'shuttleForward',
	i: 'markIn',
	o: 'markOut',
	c: 'comment',
	escape: 'clearRange',
}

/**
 * Keys typed into a field are text, not hotkeys.
 *
 * @param {EventTarget|null} target - the event's target
 * @return {boolean} whether the keystroke belongs to a text field
 */
export function isTyping(target) {
	const element = /** @type {HTMLElement|null} */ (target)
	return element?.isContentEditable === true
		|| ['INPUT', 'TEXTAREA', 'SELECT'].includes(element?.tagName ?? '')
}

/**
 * @param {KeyboardEvent} event - the keystroke
 * @return {string|null} the action to run, or null when the key means nothing here
 */
export function actionFor(event) {
	if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) {
		return null
	}
	return KEYS[event.key.toLowerCase()] ?? null
}
