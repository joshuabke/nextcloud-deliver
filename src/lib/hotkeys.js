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
 * NcModal listens for Escape through @nextcloud/vue's useHotKey, which ignores
 * inputs, textareas, selects and contentEditable elements. From any of those,
 * bare Escape closes the dialog unless a child control already handled it (#306).
 *
 * @param {KeyboardEvent} event - a keydown bubbling out of a dialog
 * @return {boolean} whether the dialog should close
 */
export function closesDialog(event) {
	return event.key === 'Escape'
		&& !event.defaultPrevented
		&& !event.isComposing
		&& !event.repeat
		&& !event.ctrlKey
		&& !event.metaKey
		&& !event.altKey
		&& isTyping(event.target)
}

/**
 * @param {KeyboardEvent} event - the keystroke
 * @return {string|null} the action to run, or null when the key means nothing here
 */
export function actionFor(event) {
	if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) {
		return null
	}
	const key = event.key.toLowerCase()
	if (event.shiftKey && (key === 'arrowright' || key === 'arrowleft')) {
		return key === 'arrowright' ? 'skipForward' : 'skipBack'
	}
	return KEYS[key] ?? null
}
