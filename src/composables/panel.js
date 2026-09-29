import { ref, watch } from 'vue'

const KEY = 'deliver.panelOpen'

/**
 * Whether the Comment panel beside the player is open. Remembered in this
 * browser, so whoever prefers the bigger picture keeps it.
 *
 * @return {import('vue').Ref<boolean>}
 */
export function usePanelOpen() {
	const open = ref(localStorage.getItem(KEY) !== 'false')
	watch(open, (value) => localStorage.setItem(KEY, String(value)))
	return open
}

/**
 * On a phone (stories 106): whether the Comment list is pulled up over the
 * picture, and whether someone is writing, when the list steps aside so the
 * picture and the field both stay above the keyboard. One Review view is
 * on screen at a time, so the state is shared.
 */
export const sheet = {
	up: ref(false),
	writing: ref(false),
}
