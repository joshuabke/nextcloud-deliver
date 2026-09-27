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
