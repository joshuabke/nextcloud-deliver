<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

// The field a new Comment is written in at the Waveform, while the Comment
// list is out of sight (story 182, N12), handed in as the default slot. At
// the wave, or on a phone a sheet from below that sits on the keyboard.

const props = defineProps({
	/** Its name for a screen reader */
	label: { type: String, required: true },
	/** Where on the stage it stands, its middle; null for the sheet */
	left: { type: Number, default: null },
	/** Elements whose clicks are not outside: the stage handles its own */
	inside: { type: Array, default: () => [] },
})

/** close: the card goes */
const emit = defineEmits(['close'])

const root = ref(null)
/** Where the focus was, to have it back when the card goes */
const before = document.activeElement

/**
 * @return {boolean} whether something in the card is under way: text written or a menu open
 */
function busy() {
	return [...root.value.querySelectorAll('textarea')].some((field) => field.value.trim() !== '')
		|| root.value.querySelector('[aria-expanded="true"]') !== null
}

/**
 * Escape closes the card wherever the focus is, but not while text is written or a menu is open
 *
 * @param {KeyboardEvent} event - a key
 */
function onKey(event) {
	if (event.key === 'Escape' && !busy()) {
		emit('close')
	}
}

/**
 * A click outside closes it: on the bar, the page, anywhere but the card, its
 * menus, the stage, which handles its own, and the Comment list. Its place is
 * kept while it holds text, until the Comment is sent or the field emptied.
 *
 * @param {PointerEvent} event - a pointer comes down
 */
function onOutside(event) {
	const target = event.target
	if (!(target instanceof Element) || root.value.contains(target) || target.closest('.v-popper__popper, .deliver-comments__list')
		|| props.inside.some((element) => element?.contains(target))) {
		return
	}
	if (!busy()) {
		emit('close')
	}
}

/**
 * A phone's keyboard covers the bottom of the layout viewport without
 * shrinking it (iOS): the sheet sits on the keyboard's top edge, so its
 * field stays visible while one writes in it
 */
const keyboardRoom = ref(null)
const viewport = window.visualViewport

/** The visual viewport moved or shrank */
function onViewport() {
	const covered = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
	keyboardRoom.value = covered > 0 ? { bottom: covered + 'px' } : null
}

onMounted(() => {
	viewport?.addEventListener('resize', onViewport)
	viewport?.addEventListener('scroll', onViewport)
	root.value.focus()
	window.addEventListener('keydown', onKey)
	document.addEventListener('pointerdown', onOutside, true)
})
onBeforeUnmount(() => {
	viewport?.removeEventListener('resize', onViewport)
	viewport?.removeEventListener('scroll', onViewport)
	window.removeEventListener('keydown', onKey)
	document.removeEventListener('pointerdown', onOutside, true)
	// The focus goes back where it was, unless it has moved on elsewhere meanwhile
	const focus = document.activeElement
	if ((focus === document.body || root.value.contains(focus)) && before?.isConnected) {
		before.focus({ preventScroll: true })
	}
})
</script>

<template>
	<div
		ref="root"
		class="deliver-wave-card"
		:class="{ 'deliver-wave-card--sheet': left === null }"
		:style="left === null ? keyboardRoom : { left: left + 'px' }"
		role="dialog"
		:aria-label="label"
		tabindex="-1"
		@pointerdown.stop
		@wheel.stop>
		<slot />
	</div>
</template>

<style scoped>
/* At the wave, over the circles */
.deliver-wave-card {
	position: absolute;
	bottom: calc(40px + 4px);
	z-index: 3;
	display: flex;
	flex-direction: column;
	gap: var(--default-grid-baseline);
	width: 360px;
	max-height: calc(100% - 52px);
	padding: calc(2 * var(--default-grid-baseline));
	overflow-y: auto;
	border: 1px solid var(--color-border-dark);
	border-radius: var(--border-radius-large);
	background: var(--deliver-card, var(--color-main-background));
	color: var(--color-main-text);
	box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
	transform: translateX(-50%);
	cursor: auto;
	user-select: text;
	-webkit-user-select: text;
}

/* A phone: a sheet from below, over the whole width */
.deliver-wave-card--sheet {
	position: fixed;
	inset: auto 0 0;
	z-index: 10001;
	width: auto;
	max-height: 70vh;
	padding-bottom: calc(2 * var(--default-grid-baseline) + env(safe-area-inset-bottom));
	border-radius: var(--border-radius-large) var(--border-radius-large) 0 0;
	transform: none;
}

.deliver-wave-card:focus {
	outline: none;
}
</style>
