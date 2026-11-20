import { computed, ref } from 'vue'

/**
 * The Range a player marks with I and O (story 107) and its loop, for the
 * Review view's player and for Compare alike.
 *
 * @param {import('vue').Ref<number>} frame - the Frame the player stands on
 * @return {object} the Range's state and what changes it
 */
export function useRange(frame) {
	const inPoint = ref(null)
	const outPoint = ref(null)
	const loop = ref(false)
	const range = computed(() => inPoint.value === null ? null : { inFrame: inPoint.value, outFrame: outPoint.value })
	/** Loops the Range when one is set, else the whole Version */
	const loopsWhole = computed(() => loop.value && outPoint.value === null)

	/** I, or the Range button: the Range starts here */
	function markIn() {
		inPoint.value = frame.value
		if (outPoint.value !== null && outPoint.value < frame.value) {
			outPoint.value = null
		}
	}

	/** O, or the Range button again: the Range ends here */
	function markOut() {
		outPoint.value = Math.max(frame.value, inPoint.value ?? 0)
		inPoint.value ??= frame.value
	}

	/** Escape, or the Range's ✕ */
	function clearRange() {
		inPoint.value = null
		outPoint.value = null
		loop.value = false
	}

	/**
	 * @param {number} at - the Frame playing now
	 * @return {number|null} where a looped Range goes back to once played past its out Frame; null to play on
	 */
	function wrapFrom(at) {
		return loop.value && outPoint.value !== null && at > outPoint.value ? inPoint.value ?? 0 : null
	}

	return { inPoint, outPoint, loop, range, loopsWhole, markIn, markOut, clearRange, wrapFrom }
}
