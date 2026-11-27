<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

// A sheet from below on a phone, as high as what it holds and at most up to a strip of the page:
// a tap on that strip, a stroke down and Escape close it, and nothing under it gets the tap.
// The default slot scrolls; the header slot stays above it
defineProps({
	/** What the sheet is about, for a screen reader */
	label: { type: String, required: true },
})

const emit = defineEmits(['close'])

const panel = ref(null)
/** The part that scrolls */
const body = ref(null)
/** Where the focus was before, the button that opened the sheet, so it goes back there */
const opener = document.activeElement
/** Whether the finger or the mouse came down on the strip, so the click that follows closes the sheet; the release of a long press that opened it does not */
let downOnStrip = false
/** Where a stroke down began, while the sheet is scrolled to its top */
let strokeFrom = null
/** How far the sheet follows the finger down, in pixels */
const pulled = ref(0)

/**
 * The strip closes the sheet on the click, not on the press: removed at the
 * press, the sheet would leave the click to whatever lies under the finger (#298)
 */
function stripClick() {
	if (downOnStrip) {
		emit('close')
	}
	downOnStrip = false
}

/**
 * A stroke from the grabber or the header, or from the body while it is at its top
 *
 * @param {TouchEvent} event - a finger on the sheet
 */
function strokeStart(event) {
	strokeFrom = body.value.scrollTop <= 0 || !body.value.contains(event.target) ? event.touches[0].clientY : null
}

/**
 * @param {TouchEvent} event - the finger moves
 */
function strokeMove(event) {
	if (strokeFrom !== null) {
		pulled.value = Math.max(0, event.touches[0].clientY - strokeFrom)
	}
}

/** A stroke down by more than a fifth of the sheet, or 80 px, closes it; a shorter one lets it spring back */
function strokeEnd() {
	const height = panel.value?.offsetHeight ?? 0
	if (strokeFrom !== null && pulled.value > Math.min(80, height / 5)) {
		emit('close')
	}
	strokeFrom = null
	pulled.value = 0
}

/**
 * Escape closes, Tab stays inside the sheet
 *
 * @param {KeyboardEvent} event - the key
 */
function onKey(event) {
	if (event.key === 'Escape') {
		event.preventDefault()
		event.stopPropagation()
		emit('close')
	} else if (event.key === 'Tab') {
		const focusable = [...panel.value.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')]
		if (!focusable.length) {
			event.preventDefault()
			return
		}
		const [first, last] = [focusable[0], focusable.at(-1)]
		if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) {
			event.preventDefault()
			last.focus()
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault()
			first.focus()
		}
	}
}

onMounted(async () => {
	await nextTick()
	panel.value?.focus({ preventScroll: true })
})
// Before the next view mounts: a dialog opened from the sheet takes the focus after this
onBeforeUnmount(() => {
	if (opener?.isConnected) {
		opener.focus({ preventScroll: true })
	}
})
</script>

<template>
	<Teleport to="body">
		<div
			class="deliver-sheet"
			@pointerdown.self="downOnStrip = true"
			@click.self="stripClick"
			@contextmenu.prevent>
			<div
				ref="panel"
				class="deliver-sheet__panel"
				:class="{ 'deliver-sheet__panel--pulled': pulled > 0 }"
				:style="pulled ? { transform: `translateY(${pulled}px)` } : undefined"
				role="dialog"
				aria-modal="true"
				:aria-label="label"
				tabindex="-1"
				@keydown="onKey"
				@touchstart.passive="strokeStart"
				@touchmove.passive="strokeMove"
				@touchend="strokeEnd"
				@touchcancel="strokeEnd">
				<div class="deliver-sheet__grabber" aria-hidden="true" />
				<div v-if="$slots.header" class="deliver-sheet__header">
					<slot name="header" />
				</div>
				<div ref="body" class="deliver-sheet__body">
					<slot />
				</div>
			</div>
		</div>
	</Teleport>
</template>

<style scoped>
/* The page behind, dimmed; it takes every tap meant for the strip, and the page does not scroll under it */
.deliver-sheet {
	position: fixed;
	inset: 0;
	z-index: 10000;
	display: flex;
	flex-direction: column;
	justify-content: flex-end;
	background: rgba(0, 0, 0, 0.4);
	touch-action: none;
}

.deliver-sheet__panel {
	box-sizing: border-box;
	display: flex;
	flex-direction: column;
	width: 100%;
	max-width: 640px;
	/* Up to a strip of the page, below the notch; dvh follows the toolbars of the browser */
	max-height: calc(100dvh - max(48px, env(safe-area-inset-top) + 24px));
	margin: 0 auto;
	padding: 0 max(calc(3 * var(--default-grid-baseline)), env(safe-area-inset-right)) max(calc(3 * var(--default-grid-baseline)), env(safe-area-inset-bottom)) max(calc(3 * var(--default-grid-baseline)), env(safe-area-inset-left));
	border-radius: var(--border-radius-container-large, 16px) var(--border-radius-container-large, 16px) 0 0;
	background: var(--color-main-background);
	color: var(--color-main-text);
	box-shadow: 0 -2px 16px var(--color-box-shadow);
	animation: deliver-sheet-in 0.2s ease-out;
	outline: none;
}

.deliver-sheet__panel--pulled {
	transition: none;
}

.deliver-sheet__header {
	flex: none;
	padding-bottom: calc(3 * var(--default-grid-baseline));
	font-size: 16px;
	font-weight: bold;
	text-align: center;
}

.deliver-sheet__body {
	flex: 1 1 auto;
	min-height: 0;
	overflow-y: auto;
	overscroll-behavior: contain;
	touch-action: pan-y;
}

/* The bar to pull at, as the Comment sheet of the Review view has it */
.deliver-sheet__grabber {
	flex: none;
	position: relative;
	height: 20px;
}

.deliver-sheet__grabber::after {
	content: '';
	position: absolute;
	top: 8px;
	left: 50%;
	width: 40px;
	height: 4px;
	border-radius: 2px;
	background: var(--color-border-maxcontrast);
	transform: translateX(-50%);
}

@keyframes deliver-sheet-in {
	from {
		transform: translateY(100%);
	}
}

@media (prefers-reduced-motion: reduce) {
	.deliver-sheet__panel {
		animation: none;
	}
}
</style>
