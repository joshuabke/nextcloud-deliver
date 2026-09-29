import { useIsMobile } from '@nextcloud/vue/composables/useIsMobile'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import './fullscreen.css'

/**
 * Fullscreen for a player and everything on it: markers, Drawings and the
 * Watermark. The browser's own fullscreen where it takes any element; where
 * it does not (the iPhone's Safari takes only a bare video, which would drop
 * all of that), or without a tap to allow it, the player fills the window
 * instead. On a phone, turning it sideways goes fullscreen and upright
 * leaves it (story 104).
 *
 * @param {import('vue').Ref<HTMLElement|null>} root - the element to show fullscreen
 * @return {{fullscreen: import('vue').Ref<boolean>, filling: import('vue').Ref<boolean>, toggle: () => void}}
 */
export function useFullscreen(root) {
	const fullscreen = ref(false)
	/** Fullscreen by filling the window rather than by the browser */
	const filling = ref(false)
	const isMobile = useIsMobile()
	const sideways = window.matchMedia('(orientation: landscape)')
	watch(filling, (on) => document.body.classList.toggle('deliver-filling', on))

	/**
	 *
	 */
	function fill() {
		filling.value = true
		fullscreen.value = true
	}

	/**
	 *
	 */
	function enter() {
		if (!document.fullscreenEnabled || !root.value?.requestFullscreen) {
			fill()
			return
		}
		root.value.requestFullscreen().catch(fill)
	}

	/**
	 *
	 */
	function exit() {
		if (filling.value) {
			filling.value = false
			fullscreen.value = false
		} else if (document.fullscreenElement) {
			document.exitFullscreen()
		}
	}

	/**
	 *
	 */
	function toggle() {
		if (fullscreen.value) {
			exit()
		} else {
			enter()
		}
	}

	/** Follows the browser's own fullscreen, which Escape and the system also leave */
	function onChange() {
		if (!filling.value) {
			fullscreen.value = document.fullscreenElement === root.value
		}
	}

	/**
	 *
	 */
	function onTurn() {
		if (!isMobile.value) {
			return
		}
		if (sideways.matches) {
			enter()
		} else {
			exit()
		}
	}

	/**
	 * @param {KeyboardEvent} event - a key anywhere
	 */
	function onKey(event) {
		if (filling.value && event.key === 'Escape') {
			exit()
		}
	}

	onMounted(() => {
		// Opened on a phone held sideways: straight to fullscreen, without a tap to allow the browser's own
		if (isMobile.value && sideways.matches) {
			fill()
		}
		document.addEventListener('fullscreenchange', onChange)
		sideways.addEventListener('change', onTurn)
		window.addEventListener('keydown', onKey)
	})
	onBeforeUnmount(() => {
		document.body.classList.remove('deliver-filling')
		document.removeEventListener('fullscreenchange', onChange)
		sideways.removeEventListener('change', onTurn)
		window.removeEventListener('keydown', onKey)
	})

	return { fullscreen, filling, toggle }
}
