<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { TAP_SLOP } from '../lib/gestures.js'
import { t } from '../lib/l10n.js'
import { fpsValue, timeToFrame } from '../lib/timecode.js'
import { bars, barSeconds, clampSpan, dragged, isWhole, pinchSpan, secondsAt, stepAt, stepsFor, wheelSeek, wheelZoom, windowAt, writeSpan, xAt } from '../lib/waveWindow.js'

// The Waveform of an audio Version on the stage (story 180): a window of it,
// zoomed, scrolling under the playhead fixed in the centre. Drawn on a canvas
// on animation frames while it plays, reading the media element's time, so
// it moves smoothly between its timeupdate events without layout work.

/** The seconds across the stage */
const span = defineModel('span', { type: Number, required: true })

const props = defineProps({
	/** As readWaveform gives it */
	waveform: { type: Object, required: true },
	fps: { type: Object, required: true },
	durationFrames: { type: Number, required: true },
	/** The Frame the player stands on, for a redraw when it seeks while standing */
	frame: { type: Number, required: true },
	/** The media element, whose time the playhead follows */
	media: { type: Object, default: null },
	playing: { type: Boolean, default: false },
})

/** seek: a Frame to go to, keeping the playback state; hold and release: a drag holds playback and lets it go on */
const emit = defineEmits(['seek', 'hold', 'release'])

/** Room above the wave for the zoom buttons, and below it, in px */
const TOP = 40
const BOTTOM = 12

const host = ref(null)
const canvas = ref(null)
const duration = computed(() => props.durationFrames / fpsValue(props.fps))
const steps = computed(() => stepsFor(duration.value))
const shown = computed(() => clampSpan(span.value, duration.value))
const lastFrame = computed(() => Math.max(0, props.durationFrames - 1))

/** The canvas in CSS px, and the device pixels to each */
let size = { width: 0, height: 0 }
let ratio = 1
let colors = { played: '#fff', rest: 'rgba(255, 255, 255, 0.3)' }
/** Bars of the current length, kept while the window slides */
let cache = { waveform: null, seconds: 0, levels: new Float32Array(0) }
let visible = true

/** Where a drag has taken the playhead, until it lets go */
let dragAt = null

/**
 * @return {number} where the playhead stands, in seconds
 */
function now() {
	if (dragAt !== null) {
		return dragAt
	}
	return props.media ? props.media.currentTime : props.frame / fpsValue(props.fps)
}

/**
 * @param {number} seconds - a moment of the piece
 * @return {number} its Frame, within the Version
 */
function frameOf(seconds) {
	return Math.min(lastFrame.value, timeToFrame(seconds, props.fps))
}

/** Draws the window around the playhead */
function draw() {
	const context = canvas.value?.getContext('2d')
	const { width, height } = size
	if (!context || !width) {
		return
	}
	context.setTransform(ratio, 0, 0, ratio, 0, 0)
	context.clearRect(0, 0, width, height)
	const at = now()
	const view = windowAt(at, shown.value, duration.value)
	const across = view.end - view.start
	const seconds = barSeconds(across, width)
	if (cache.waveform !== props.waveform || cache.seconds !== seconds) {
		cache = { waveform: props.waveform, seconds, levels: bars(props.waveform, seconds) }
	}
	const { levels } = cache
	const step = seconds / across * width
	const barWidth = Math.max(1, step - 1)
	const room = Math.max(8, height - TOP - BOTTOM) / 2
	const middle = TOP + room
	// The loudest bar keeps a margin above and below
	const half = room * 0.85
	const head = xAt(at, view, width)
	const last = Math.min(levels.length - 1, Math.ceil(view.end / seconds))
	let played = true
	context.fillStyle = colors.played
	for (let bar = Math.max(0, Math.floor(view.start / seconds)); bar <= last; bar++) {
		const x = (bar * seconds - view.start) / across * width
		if (played && x + barWidth / 2 > head) {
			played = false
			context.fillStyle = colors.rest
		}
		const level = Math.max(0.5, levels[bar] * half)
		context.fillRect(x, middle - level, barWidth, 2 * level)
	}
	// The playhead, under the zoom buttons
	context.fillStyle = '#fff'
	context.fillRect(head - 1, TOP - 4, 2, height - TOP + 4)
}

let frameRequest = 0

/** Draws on the next animation frame; while playing and on screen, on every one */
function schedule() {
	if (!frameRequest) {
		frameRequest = requestAnimationFrame(tick)
	}
}

/** One animation frame */
function tick() {
	frameRequest = 0
	draw()
	if ((props.playing || dragAt !== null) && visible) {
		schedule()
	}
}

watch([() => props.playing, () => props.frame, () => props.waveform, shown], schedule)

/** The canvas takes the stage's size in device pixels, so the wave stays sharp */
const resized = new ResizeObserver(([entry]) => {
	size = { width: entry.contentRect.width, height: entry.contentRect.height }
	ratio = window.devicePixelRatio || 1
	canvas.value.width = Math.round(size.width * ratio)
	canvas.value.height = Math.round(size.height * ratio)
	const style = getComputedStyle(host.value)
	colors = {
		played: style.getPropertyValue('--color-primary-element').trim() || colors.played,
		rest: colors.rest,
	}
	draw()
})
/** Off screen, as under a phone's Comment list pulled up, the loop stops */
const seen = new IntersectionObserver(([entry]) => {
	visible = entry.isIntersecting
	schedule()
})

onMounted(() => {
	resized.observe(host.value)
	seen.observe(host.value)
})
onBeforeUnmount(() => {
	resized.disconnect()
	seen.disconnect()
	cancelAnimationFrame(frameRequest)
})

/** The pointers on the stage, for a pinch */
const pointers = new Map()
/** The pointer that came down, until it lifts: a tap, or a drag once it moves */
let press = null
/** Two fingers: their distance and the span when they came down */
let pinch = null

/** The stage's left edge, read once a pointer comes down */
let left = 0

/**
 * @param {PointerEvent} event - a pointer on the stage
 * @return {number} its x from the stage's left edge
 */
const xOf = (event) => event.clientX - left

/**
 * @return {number} the distance between the two fingers
 */
function spread() {
	const [a, b] = [...pointers.values()]
	return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * The stage's own gestures, not the picture's: they stop here
 *
 * @param {PointerEvent} event - a pointer comes down
 */
function onDown(event) {
	event.stopPropagation()
	if (event.pointerType === 'mouse' && event.button !== 0) {
		return
	}
	try {
		host.value.setPointerCapture(event.pointerId)
	} catch {
		// A pointer the browser does not track, as in synthetic tests
	}
	left = host.value.getBoundingClientRect().left
	pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
	if (pointers.size === 2) {
		endDrag()
		press = null
		pinch = { distance: spread(), span: shown.value }
		return
	}
	press = { id: event.pointerId, x: event.clientX, from: now(), moved: false }
}

/**
 * @param {PointerEvent} event - a pointer moves
 */
function onMove(event) {
	if (!pointers.has(event.pointerId)) {
		return
	}
	event.stopPropagation()
	pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
	if (pinch && pointers.size === 2) {
		zoom(pinchSpan(pinch.span, pinch.distance, spread(), duration.value))
		return
	}
	if (press?.id !== event.pointerId) {
		return
	}
	const dx = event.clientX - press.x
	if (!press.moved && Math.abs(dx) > TAP_SLOP) {
		press.moved = true
		// Playback holds while the wave is dragged, and goes on where it is let go
		emit('hold')
	}
	if (press.moved) {
		dragAt = dragged({ from: press.from, dx, x: xOf(event), span: shown.value, width: size.width, duration: duration.value })
		emit('seek', frameOf(dragAt))
		schedule()
	}
}

/** A drag lets go: playback goes on from there if it played */
function endDrag() {
	if (press?.moved) {
		dragAt = null
		emit('release')
	}
}

/**
 * @param {PointerEvent} event - a pointer lifts, or the browser takes it for scrolling the page
 */
function onUp(event) {
	if (!pointers.delete(event.pointerId)) {
		return
	}
	event.stopPropagation()
	if (pinch) {
		if (pointers.size === 0) {
			pinch = null
		}
		return
	}
	if (press?.id !== event.pointerId) {
		return
	}
	if (press.moved) {
		endDrag()
	} else if (event.type === 'pointerup') {
		// A click or a tap only seeks, and playback goes on as it was
		const view = windowAt(now(), shown.value, duration.value)
		emit('seek', frameOf(secondsAt(xOf(event), view, size.width, duration.value)))
	}
	press = null
}

/**
 * Ctrl and the wheel, or a trackpad's pinch, zoom; a sideways wheel or a
 * trackpad's swipe moves through time; an upright wheel is the page's.
 *
 * @param {WheelEvent} event - the wheel turns
 */
function onWheel(event) {
	if (event.ctrlKey || event.metaKey) {
		event.preventDefault()
		zoom(wheelZoom(shown.value, event.deltaY, event.deltaMode, duration.value))
		return
	}
	if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
		event.preventDefault()
		emit('seek', frameOf(wheelSeek(now(), event.deltaX, event.deltaMode, shown.value, size.width, duration.value)))
	}
}

/**
 * Zooms, and this browser remembers it for every audio Version
 *
 * @param {number} value - the seconds across the stage
 */
function zoom(value) {
	span.value = value
	writeSpan(value, duration.value)
}

/** The step shown now, pressed; none while zoomed freely between them */
const pressed = computed(() => stepAt(steps.value, shown.value))

/**
 * @param {number} step - one of the zoom steps, in seconds
 * @return {string} its label on the button
 */
function label(step) {
	if (isWhole(step, duration.value) && steps.value.length > 1) {
		return t('deliver', 'Whole')
	}
	return step < 60 ? t('deliver', '{seconds} s', { seconds: Math.round(step) }) : t('deliver', '{minutes} min', { minutes: Math.round(step / 60) })
}
</script>

<template>
	<div
		ref="host"
		class="deliver-wave"
		@pointerdown="onDown"
		@pointermove="onMove"
		@pointerup="onUp"
		@pointercancel="onUp"
		@wheel="onWheel"
		@contextmenu.prevent>
		<canvas ref="canvas" class="deliver-wave__canvas" aria-hidden="true" />
		<div
			v-if="steps.length > 1"
			class="deliver-wave__zoom"
			role="group"
			:aria-label="t('deliver', 'Zoom the Waveform')"
			@pointerdown.stop>
			<button
				v-for="step in steps"
				:key="step"
				type="button"
				class="deliver-wave__step"
				:aria-pressed="step === pressed ? 'true' : 'false'"
				@click="zoom(step)">
				{{ label(step) }}
			</button>
		</div>
	</div>
</template>

<style scoped>
.deliver-wave {
	position: absolute;
	inset: 0;
	cursor: grab;
	/* A finger dragging sideways moves through time, upright it scrolls the page; two fingers zoom the wave, not the page */
	touch-action: pan-y;
}

.deliver-wave:active {
	cursor: grabbing;
}

.deliver-wave__canvas {
	display: block;
	width: 100%;
	height: 100%;
}

.deliver-wave__zoom {
	position: absolute;
	top: 6px;
	/* The start side: on a phone held sideways the layout's Comments button sits in the top end corner */
	inset-inline-start: 8px;
	display: flex;
	gap: 2px;
	padding: 2px;
	border-radius: var(--border-radius-pill);
	background: rgba(255, 255, 255, 0.08);
	cursor: default;
}

/* The resets keep Nextcloud's button style away */
.deliver-wave__step {
	min-height: 0;
	margin: 0;
	padding: 4px 10px;
	border: none;
	border-radius: var(--border-radius-pill);
	background: none;
	color: rgba(255, 255, 255, 0.75);
	font-size: 13px;
	font-weight: normal;
	cursor: pointer;
}

.deliver-wave__step:hover {
	color: #fff;
}

.deliver-wave__step[aria-pressed='true'] {
	background: rgba(255, 255, 255, 0.2);
	color: #fff;
}

.deliver-wave__step:focus-visible {
	outline: 2px solid #fff;
}
</style>
