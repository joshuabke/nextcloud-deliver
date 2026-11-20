<script setup>
import closeIcon from '@mdi/svg/svg/close.svg?raw'
import { useIsMobile } from '@nextcloud/vue/composables/useIsMobile'
import { usernameToColor } from '@nextcloud/vue/functions/usernameToColor'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import CommentItem from './CommentItem.vue'
import { HOLD_MS, TAP_SLOP } from '../lib/gestures.js'
import { avatarSeed, initials } from '../lib/initials.js'
import { t } from '../lib/l10n.js'
import { fpsValue, timeToFrame } from '../lib/timecode.js'
import { bars, barSeconds, CIRCLE, circleAt, clampSpan, dragged, isWhole, secondsAt, stack, stepsFor, wheelZoom, windowAt, xAt } from '../lib/waveWindow.js'
import { useCommentsStore } from '../store/comments.js'

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
	/** The top-level Comments with their Replies, as circles on the wave (story 181) */
	comments: { type: Array, default: () => [] },
	/** How time is shown, for the card */
	clock: { type: Object, required: true },
	/** Whether a double click or a long press opens the Comment field */
	canComment: { type: Boolean, default: false },
})

/**
 * seek: a Frame to go to, keeping the playback state; hold and release: a drag holds playback and lets it go on;
 * comment: a Frame to comment on; jump: a Comment to go to
 */
const emit = defineEmits(['seek', 'hold', 'release', 'comment', 'jump'])

/** Room above the wave for the zoom buttons, and below it for the Comments' circles, in px */
const TOP = 40
const BOTTOM = 40
/** Half the card's width, to keep it on the stage */
const CARD_HALF = 180

const store = useCommentsStore()
const isMobile = useIsMobile()

/** The Comment whose card is open, and where on the stage */
const card = ref(null)
const cardEl = ref(null)
const opened = computed(() => card.value && props.comments.find((comment) => comment.id === card.value.id))

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
/** Reduced motion pages a window at a time instead of scrolling */
const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
let paged = motion.matches
let visible = true

/** The circles at the current zoom, worked out again only when it or the Comments change */
let circles = { comments: null, perFrame: 0, list: [] }
/** Each author's colour, as their avatar has it */
const tints = new Map()

/**
 * @param {object} author - a Comment's author
 * @return {string} the rgb of their avatar
 */
function tint(author) {
	const seed = avatarSeed(author)
	if (!tints.has(seed)) {
		const { r, g, b } = usernameToColor(seed)
		tints.set(seed, `${r}, ${g}, ${b}`)
	}
	return tints.get(seed)
}

/**
 * @param {{start: number, end: number}} view - the window
 * @return {number} px per Frame at this zoom
 */
const perFrameIn = (view) => size.width / (view.end - view.start) / fpsValue(props.fps)

/**
 * @param {number} perFrame - px per Frame at this zoom
 * @return {Array<{comment: object, x: number}>} the circles, from the start of the piece
 */
function circlesAt(perFrame) {
	if (circles.comments !== props.comments || circles.perFrame !== perFrame) {
		circles = { comments: props.comments, perFrame, list: stack(props.comments, perFrame) }
	}
	return circles.list
}

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
	const view = windowAt(at, shown.value, duration.value, paged)
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
	const perFrame = perFrameIn(view)
	const offset = view.start * fpsValue(props.fps) * perFrame
	// A Range is a tinted span over the wave, its circle at its start
	for (const comment of props.comments) {
		if (comment.outFrame !== null) {
			const from = comment.inFrame * perFrame - offset
			const to = (comment.outFrame + 1) * perFrame - offset
			if (to > 0 && from < width) {
				context.fillStyle = `rgba(${tint(comment.author)}, ${comment.resolved ? 0.1 : 0.22})`
				context.fillRect(from, TOP - 4, to - from, height - TOP + 4)
			}
		}
	}
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
	drawCircles(context, circlesAt(perFrame), offset, height - BOTTOM / 2)
}

/**
 * The Comments as their authors' initials in circles, in their avatars' colour; resolved ones paler
 *
 * @param {CanvasRenderingContext2D} context - the canvas
 * @param {Array<{comment: object, x: number}>} list - the circles
 * @param {number} offset - the window's left edge, in px from the start of the piece
 * @param {number} y - the circles' centre line
 */
function drawCircles(context, list, offset, y) {
	const radius = CIRCLE / 2
	context.font = 'bold 10px sans-serif'
	context.textAlign = 'center'
	context.textBaseline = 'middle'
	context.lineWidth = 2
	for (const { comment, x: at } of list) {
		const x = at - offset
		if (x < -radius || x > size.width + radius) {
			continue
		}
		const rgb = tint(comment.author)
		context.globalAlpha = comment.resolved ? 0.45 : 1
		context.beginPath()
		context.arc(x, y, radius - 1, 0, 2 * Math.PI)
		context.fillStyle = '#000'
		context.fill()
		context.fillStyle = `rgba(${rgb}, 0.3)`
		context.fill()
		context.strokeStyle = comment.id === store.selected || comment.id === card.value?.id ? '#fff' : `rgb(${rgb})`
		context.stroke()
		context.fillStyle = '#fff'
		context.fillText(initials(comment.author.name), x, y + 0.5)
	}
	context.globalAlpha = 1
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

watch([() => props.playing, () => props.frame, () => props.waveform, shown, () => props.comments, () => store.selected], schedule)

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

/** @param {MediaQueryListEvent} event - reduced motion switched */
function onMotion(event) {
	paged = event.matches
	schedule()
}

onMounted(() => {
	resized.observe(host.value)
	seen.observe(host.value)
	motion.addEventListener('change', onMotion)
})
onBeforeUnmount(() => {
	resized.disconnect()
	seen.disconnect()
	motion.removeEventListener('change', onMotion)
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
	// No mouse events after a finger: their mousedown would take the focus from the Comment field a long press opens
	if (event.pointerType !== 'mouse') {
		event.preventDefault()
	}
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
	press = { id: event.pointerId, x: event.clientX, y: event.clientY, from: now(), moved: false, long: false }
	// A finger or a pen resting on the wave opens the Comment field for that place
	if (event.pointerType !== 'mouse' && props.canComment) {
		const at = press
		at.timer = setTimeout(() => {
			at.long = true
			if (!hit(at.x, at.y, event.pointerType)) {
				emit('comment', frameAtX(at.x - left))
			}
		}, HOLD_MS)
	}
}

/**
 * @param {number} x - a place on the stage, from its left edge
 * @return {number} the Frame there
 */
function frameAtX(x) {
	return frameOf(secondsAt(x, windowAt(now(), shown.value, duration.value, paged), size.width, duration.value))
}

/**
 * @param {number} clientX - the pointer's x in the window
 * @param {number} clientY - the pointer's y in the window
 * @param {string} pointerType - a finger reaches wider than a mouse
 * @return {object|null} the Comment whose circle is there
 */
function hit(clientX, clientY, pointerType) {
	const box = host.value.getBoundingClientRect()
	const view = windowAt(now(), shown.value, duration.value, paged)
	const perFrame = perFrameIn(view)
	const x = clientX - box.left + view.start * fpsValue(props.fps) * perFrame
	return circleAt(circlesAt(perFrame), x, clientY - box.top - (size.height - BOTTOM / 2), pointerType === 'mouse' ? CIRCLE / 2 : CIRCLE)
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
		span.value = clampSpan(pinch.span * pinch.distance / Math.max(1, spread()), duration.value)
		return
	}
	if (press?.id !== event.pointerId) {
		return
	}
	const dx = event.clientX - press.x
	if (!press.moved && !press.long && Math.abs(dx) > TAP_SLOP) {
		clearTimeout(press.timer)
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
	clearTimeout(press.timer)
	if (press.moved) {
		endDrag()
	} else if (event.type === 'pointerup' && !press.long) {
		tap(event)
	}
	press = null
}

/** The last click or tap that sought, for the double click after it */
let lastTap = null
/** How long a double click may take; the system's own setting is out of reach */
const DOUBLE_CLICK_MS = 500

/**
 * A click or a tap: on a circle it opens the Comment's card; with a card
 * open it only closes it; elsewhere it only seeks, and playback goes on as it was
 *
 * @param {PointerEvent} event - the pointer lifts where it came down
 */
function tap(event) {
	const comment = hit(event.clientX, event.clientY, event.pointerType)
	const again = lastTap !== null && event.timeStamp - lastTap.at < DOUBLE_CLICK_MS && Math.abs(event.clientX - lastTap.x) < TAP_SLOP
	if (comment) {
		open(comment, xOf(event))
	} else if (card.value) {
		card.value = null
	} else if (!again) {
		// The wave moves under the pointer once it seeks: the second click of a double stays on the first one's Frame
		lastTap = { at: event.timeStamp, x: event.clientX, frame: frameAtX(xOf(event)) }
		emit('seek', lastTap.frame)
	}
}

/**
 * A double click comments on that place; the first click went there already
 *
 * @param {MouseEvent} event - the second click
 */
function onDoubleClick(event) {
	if (props.canComment && !hit(event.clientX, event.clientY, 'mouse')) {
		const recent = lastTap !== null && event.timeStamp - lastTap.at < 2 * DOUBLE_CLICK_MS
		emit('comment', recent ? lastTap.frame : frameAtX(event.clientX - host.value.getBoundingClientRect().left))
	}
}

/**
 * @param {PointerEvent} event - the mouse moves over the stage
 */
function onHover(event) {
	if (event.pointerType === 'mouse' && press === null) {
		host.value.style.cursor = hit(event.clientX, event.clientY, 'mouse') ? 'pointer' : ''
	}
}

/**
 * Opens a Comment's card at its circle, and selects it in the list too; the circle does not seek
 *
 * @param {object} comment - the circle's Comment
 * @param {number} x - where it was hit, from the stage's left edge
 */
function open(comment, x) {
	card.value = { id: comment.id, left: Math.min(size.width - CARD_HALF - 8, Math.max(CARD_HALF + 8, x)) }
	store.selected = comment.id
	nextTick(() => cardEl.value?.focus())
}

/**
 * @param {object} comment - the Comment of the card
 */
function goTo(comment) {
	card.value = null
	emit('jump', comment)
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
		span.value = clampSpan(wheelZoom(shown.value, event.deltaY, event.deltaMode), duration.value)
		return
	}
	if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
		event.preventDefault()
		const across = Math.min(shown.value, duration.value)
		const seconds = Math.min(duration.value, Math.max(0, now() + event.deltaX / size.width * across))
		emit('seek', frameOf(seconds))
	}
}

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
		@pointermove="onMove($event); onHover($event)"
		@pointerup="onUp"
		@pointercancel="onUp"
		@wheel="onWheel"
		@dblclick="onDoubleClick"
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
				:aria-pressed="Math.abs(shown - step) < 0.5 ? 'true' : 'false'"
				@click="span = step">
				{{ label(step) }}
			</button>
		</div>
		<!-- The Comment at its circle, with its Replies and a field to answer; on a phone a sheet from below -->
		<div
			v-if="opened"
			ref="cardEl"
			class="deliver-wave__card"
			:class="{ 'deliver-wave__card--sheet': isMobile }"
			:style="isMobile ? null : { left: card.left + 'px' }"
			role="dialog"
			:aria-label="t('deliver', 'Comment #{number}', { number: store.numbers.get(opened.id) })"
			tabindex="-1"
			@pointerdown.stop
			@dblclick.stop
			@wheel.stop
			@keydown.esc.stop="card = null">
			<ul class="deliver-wave__thread">
				<CommentItem
					:comment="opened"
					:clock="clock"
					:number="store.numbers.get(opened.id) ?? null"
					replyOpen
					@jump="goTo" />
			</ul>
			<div class="deliver-wave__card-actions">
				<NcButton variant="secondary" @click="goTo(opened)">
					{{ t('deliver', 'Go to') }}
				</NcButton>
				<NcButton variant="tertiary" :aria-label="t('deliver', 'Close')" @click="card = null">
					<template #icon>
						<NcIconSvgWrapper :svg="closeIcon" />
					</template>
				</NcButton>
			</div>
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
	inset-inline-end: 8px;
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

/* The card at the wave, over the circles, as the marker's card over the bar but grown up */
.deliver-wave__card {
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
.deliver-wave__card--sheet {
	position: fixed;
	inset: auto 0 0;
	z-index: 10001;
	width: auto;
	max-height: 70vh;
	padding-bottom: calc(2 * var(--default-grid-baseline) + env(safe-area-inset-bottom));
	border-radius: var(--border-radius-large) var(--border-radius-large) 0 0;
	transform: none;
}

.deliver-wave__card:focus {
	outline: none;
}

.deliver-wave__card-actions {
	display: flex;
	justify-content: flex-end;
	gap: var(--default-grid-baseline);
}
</style>
