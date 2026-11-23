/**
 * Seeks that follow a drag without flooding the media element: one is on
 * its way at a time, and what the pointer reached meanwhile goes next, only
 * the latest of it.
 *
 * @param {(frame: number) => boolean} apply - starts a seek; false when nothing was started (already there), so none is awaited
 * @return {{want: (frame: number) => void, settled: () => void, reset: () => void}} the seeker
 */
export function liveSeek(apply) {
	let busy = false
	let pending = null

	const start = (frame) => {
		busy = apply(frame) !== false
	}

	return {
		/** @param {number} frame - where the pointer is now */
		want(frame) {
			if (busy) {
				pending = frame
			} else {
				start(frame)
			}
		},
		/** The element finished the seek that was on its way */
		settled() {
			busy = false
			if (pending !== null) {
				const frame = pending
				pending = null
				start(frame)
			}
		},
		/** The drag is over: nothing waits any more */
		reset() {
			busy = false
			pending = null
		},
	}
}
