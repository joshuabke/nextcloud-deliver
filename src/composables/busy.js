import { ref } from 'vue'
import { errorMessage } from '../api.js'

/**
 * One request at a time: busy while it runs, its error message afterwards.
 *
 * @return {{busy: import('vue').Ref<boolean>, error: import('vue').Ref<string|null>, run: (action: () => Promise<unknown>) => Promise<void>}}
 */
export function useBusy() {
	const busy = ref(false)
	const error = ref(null)

	/**
	 * @param {() => Promise<unknown>} action - what to run while busy
	 */
	async function run(action) {
		busy.value = true
		error.value = null
		try {
			await action()
		} catch (e) {
			error.value = errorMessage(e)
		} finally {
			busy.value = false
		}
	}

	return { busy, error, run }
}
