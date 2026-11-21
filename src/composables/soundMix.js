import { onBeforeUnmount, ref } from 'vue'
import { fadeCurve } from '../lib/compare.js'

/** The crossfade of a switch, linear, in seconds */
const FADE = 0.008

/**
 * Compare's two sides into one AudioContext (A7): both media elements play
 * unmuted, each through a gain of 0 or 1, so both run on the one output
 * clock and a switch is a linear crossfade of a few milliseconds, with nothing
 * sought or restarted. The gains are only ever 0 or 1 on the way between:
 * no level is applied to either side (A1).
 *
 * Browsers start audio only from a gesture, so the context is made on the
 * first one; until it runs, or where there is no Web Audio, the sides fall
 * back to muting the one not heard.
 *
 * @return {{mixing: import('vue').Ref<boolean>, start: (elements: HTMLMediaElement[], heard: () => number) => ?Promise<void>, hear: (elements: HTMLMediaElement[], heard: number) => void, late: {refused: boolean}}} whether the gains decide, what starts and switches them, and whether this page starts the sides within the gesture
 */
/** Whether this page's browser refused a play() once the context ran, outside the gesture: from then on, for the page, the sides start within it */
const late = { refused: false }

/**
 *
 */
export function useSoundMix() {
	const mixing = ref(false)
	let context = null
	/** Each element's gain; an element joins a context once and for good */
	const gains = new WeakMap()

	/**
	 * @param {HTMLMediaElement[]} elements - the sides, A first
	 * @param {number} heard - the index of the side heard
	 */
	function connect(elements, heard) {
		elements.forEach((element, index) => {
			if (element && !gains.has(element)) {
				const gain = context.createGain()
				gain.gain.value = index === heard ? 1 : 0
				context.createMediaElementSource(element).connect(gain).connect(context.destination)
				gains.set(element, gain)
				// What is heard, readable from outside (browser tests)
				element.deliverGain = gain
			}
		})
		mixing.value = true
	}

	/**
	 * From a gesture: makes the context or wakes it, and once it runs routes the sides through it
	 *
	 * @param {HTMLMediaElement[]} elements - the sides, A first
	 * @param {() => number} heard - gives the index of the side heard when they join, which a switch while waiting may have changed
	 * @return {?Promise<void>} settled once the context runs with both sides in it, or will not run; null without Web Audio
	 */
	function start(elements, heard) {
		const Context = window.AudioContext ?? window.webkitAudioContext
		if (!Context || elements.some((element) => !element)) {
			return null
		}
		try {
			context ??= new Context()
		} catch {
			return null
		}
		// Called within the gesture; until it runs, muting stands in
		return context.resume().then(() => {
			if (context?.state === 'running') {
				connect(elements, heard())
			}
		}).catch(() => {})
	}

	/**
	 * @param {HTMLMediaElement[]} elements - the sides, A first
	 * @param {number} heard - the index of the side heard now
	 */
	function hear(elements, heard) {
		if (!mixing.value) {
			return
		}
		// A side that came since (a still that became a video) joins first
		connect(elements, heard)
		elements.forEach((element, index) => {
			const gain = gains.get(element)?.gain
			if (gain) {
				fade(gain, index === heard ? 1 : 0)
			}
		})
	}

	/**
	 * @param {AudioParam} gain - a side's gain
	 * @param {number} to - 0 or 1
	 */
	function fade(gain, to) {
		const now = context.currentTime
		const from = gain.value
		try {
			if (gain.cancelAndHoldAtTime) {
				gain.cancelAndHoldAtTime(now)
			} else {
				gain.cancelScheduledValues(now)
			}
			gain.setValueCurveAtTime(fadeCurve(from, to), now, FADE)
		} catch {
			// A fade still under way where the browser cannot hold it: the switch is then a cut
			gain.cancelScheduledValues(0)
			gain.setValueAtTime(to, now)
		}
	}

	onBeforeUnmount(() => {
		context?.close().catch(() => {})
		context = null
	})

	return { mixing, start, hear, late }
}
