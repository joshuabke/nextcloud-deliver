<script setup>
import { useIsMobile } from '@nextcloud/vue/composables/useIsMobile'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import WaveformCard from './WaveformCard.vue'
import { HOLD_MS, TAP_SLOP } from '../lib/gestures.js'
import { avatarRgb } from '../lib/initials.js'
import { t } from '../lib/l10n.js'
import { fpsValue, timeToFrame } from '../lib/timecode.js'
import { acrossOf, barGrid, bars, barsShown, canvasPixels, CIRCLE, circleAt, circleLook, circlesOf, clampSpan, dragged, glided, glideStart, INSET, isWhole, laneBands, loudestOf, pinchSpan, pixelPlace, retarget, secondsAt, shiftPixels, spreadSpan, steadied, stepAt, stepsFor, wheelSeek, wheelZoom, windowAt, writeSpan } from '../lib/waveWindow.js'
import { useCommentsStore } from '../store/comments.js'

// The Waveform of an audio Version on the stage (story 180): a window of it,
// zoomed, scrolling under the playhead fixed in the centre. Drawn on a canvas
// on animation frames while it plays, reading the media element's time, so
// it moves smoothly between its timeupdate events without layout work.
// Compare hands in two lanes instead, one Waveform above the other under the
// one playhead, on side A's clock (A2).

/** The seconds across the stage */
const span = defineModel('span', { type: Number, required: true })

const props = defineProps({
	/** As readWaveform gives it */
	waveform: { type: Object, default: null },
	/**
	 * Compare's lanes in place of the one Waveform: {waveform, shift, audible, label} each, the
	 * Waveform null while missing, shift the seconds its wave is ahead of the playhead; one scale for all
	 */
	lanes: { type: Array, default: null },
	/** Compare's Range, {inFrame, outFrame}, tinted over the lanes */
	marked: { type: Object, default: null },
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
	/** Whether a long press opens the Comment field */
	canComment: { type: Boolean, default: false },
	/** Where the Comment being written goes, {inFrame, outFrame}, while the field holds it */
	pending: { type: Object, default: null },
	/** Whether the field is open at the Waveform, at the place it holds (N12); the view hands it in as the composer slot */
	composing: { type: Boolean, default: false },
})

/**
 * seek: a Frame to go to, keeping the playback state; hold and release: a drag holds playback and lets it go on;
 * comment: a Frame to comment on; jump: a Comment to go to; closeComposer: the field at the Waveform is closed from here
 */
const emit = defineEmits(['seek', 'hold', 'release', 'comment', 'jump', 'closeComposer', 'pick'])

/** Between two lanes, in px */
const LANE_GAP = 8
/** A lane that is not heard */
const SUBDUED = { played: 'rgba(255, 255, 255, 0.5)', rest: 'rgba(255, 255, 255, 0.16)' }
/** Half the card's width, to keep it on the stage */
const CARD_HALF = 180

const store = useCommentsStore()
const isMobile = useIsMobile()

/** The Comment whose card is open, where on the stage, and the Comments of its place where no zoom parts them */
const card = ref(null)
const opened = computed(() => card.value && props.comments.find((comment) => comment.id === card.value.id))

// The card follows the list: another Comment selected there shows in it
watch(() => store.selected, (id) => {
	if (card.value && id !== card.value.id && props.comments.some((comment) => comment.id === id)) {
		card.value = { ...card.value, id, siblings: card.value.siblings?.some((each) => each.id === id) ? card.value.siblings : null }
	}
})

const host = ref(null)
const canvas = ref(null)
const duration = computed(() => props.durationFrames / fpsValue(props.fps))
const steps = computed(() => stepsFor(duration.value))
/** Room above the wave for the zoom buttons; lanes without them need little, in px */
const TOP = computed(() => props.lanes && steps.value.length < 2 ? 12 : 40)
const shown = computed(() => clampSpan(span.value, duration.value))
const lastFrame = computed(() => Math.max(0, props.durationFrames - 1))
/** Whether the Comments have their lane under the wave: not over the whole piece, where the bar's row right below shows the same, nor on lanes */
const circled = computed(() => !props.lanes && !isWhole(shown.value, duration.value))
/** Room below the wave, for the circles' lane where there is one, in px */
const BOTTOM = computed(() => circled.value ? 40 : 8)

/** The canvas in CSS px, in device pixels, and the device pixels to a CSS px */
let size = { width: 0, height: 0 }
let pixels = { width: 0, height: 0 }
let ratio = 1
let colors = { played: '#fff', rest: 'rgba(255, 255, 255, 0.3)' }
let visible = true
/** Set by the stage's own continuous seeks (the wheel): the wave follows them without a glide */
let following = false
/** Further than this from where playing would have taken it, in seconds, the playhead was sought */
const SEEK_GAP = 0.25
/** The glide after a seek is decoration: with reduced motion the wave jumps */
const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
/** A glide to a new place under way; the seconds drawn last, which a glide starts from; where the playhead was then, and when */
let glide = null
let drawnAt = null
let last = null
/** What the last frame drew while playing: currentTime moves in coarse steps, so the drawing runs on between them */
let steady = null

/**
 * What only changes with the zoom, the width or the Comments, worked out
 * once for them and not on every frame: the bars, the circles, and over the
 * whole piece, where the wave stands still, the drawing itself.
 */
let kept = {}

/**
 * @template T
 * @param {string} name - what is kept
 * @param {Array} key - what it depends on
 * @param {() => T} make - works it out
 * @return {T} the kept value, made again only when the key changed
 */
function keep(name, key, make) {
	const before = kept[name]
	if (!before || before.key.length !== key.length || before.key.some((part, at) => part !== key[at])) {
		kept[name] = { key, value: make() }
	}
	return kept[name].value
}

/** The Waveforms drawn: Compare's lanes, or the one, heard */
const shownLanes = computed(() => props.lanes ?? [{ waveform: props.waveform, shift: 0, audible: true }])
/** Lanes share one scale, the loudest of them; the one Waveform has its own */
const loudest = computed(() => props.lanes ? loudestOf(props.lanes.map((lane) => lane.waveform)) : null)

/** Room before and after the whole piece, in px, as the bar has it; Compare's bar has none */
const inset = props.lanes ? 0 : INSET

/**
 * @return {number} the seconds across the stage: the span, or the whole piece with the room around it; never read off a sliding window
 */
const across = () => acrossOf(shown.value, duration.value, size.width, inset)

/**
 * @return {number} the seconds of room before and after the whole piece
 */
const margin = () => inset / size.width * across()

/**
 * @return {number} px per Frame at this zoom
 */
const perFrame = () => size.width / across() / fpsValue(props.fps)

/**
 * @return {Array<{comment: object, x: number}|{cluster: object[], x: number}>} the circles, from the start of the piece
 */
function circles() {
	return circled.value ? keep('circles', [props.comments, across(), size.width], () => circlesOf(props.comments, perFrame())) : []
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

/**
 * @param {number} at - where the playhead stands, in seconds
 * @return {{head: number, offset: number}} the playhead's column and the window's left edge, in whole device pixels
 */
function placeAt(at) {
	return pixelPlace(at, across(), pixels.width, isWhole(shown.value, duration.value), Math.round(inset * ratio))
}

/**
 * @param {number} at - where the playhead stands, in seconds
 * @return {number} the window's left edge, in CSS px from the start of the piece, on the same pixel as the wave
 */
function offsetAt(at) {
	return placeAt(at).offset / ratio
}

/**
 * Draws the window around the playhead. The wave is drawn in device pixels
 * and moves by whole ones, so a bar keeps its edges and its height on every
 * frame it shows (no moiré against the screen's pixels); the rest in CSS px.
 */
function draw() {
	const context = canvas.value?.getContext('2d')
	if (!context || !pixels.width) {
		return
	}
	context.setTransform(1, 0, 0, 1, 0, 0)
	context.clearRect(0, 0, pixels.width, pixels.height)
	const at = drawn()
	drawnAt = at
	// What is on screen, readable from outside without reading pixels (browser tests)
	canvas.value.drawnAt = at
	const { head, offset } = placeAt(at)
	if (isWhole(shown.value, duration.value)) {
		// The wave stands: it is drawn once, the played part laid over it up to the playhead
		const layers = keep('layers', [TOP.value, shownLanes.value, props.marked, props.comments, pixels.width, pixels.height, colors.played, props.pending], () => ({
			rest: layer((each) => {
				each.setTransform(ratio, 0, 0, ratio, 0, 0)
				drawSpans(each, offset / ratio)
				each.setTransform(1, 0, 0, 1, 0, 0)
				drawBars(each, offset, -Infinity)
			}),
			played: layer((each) => drawBars(each, offset, Infinity)),
			top: layer((each) => {
				each.setTransform(ratio, 0, 0, ratio, 0, 0)
				drawTop(each, offset / ratio)
			}),
		}))
		context.drawImage(layers.rest, 0, 0)
		if (head > 0) {
			context.drawImage(layers.played, 0, 0, head, pixels.height, 0, 0, head, pixels.height)
		}
		drawHead(context, head)
		context.drawImage(layers.top, 0, 0)
		return
	}
	context.setTransform(ratio, 0, 0, ratio, 0, 0)
	drawSpans(context, offset / ratio)
	context.setTransform(1, 0, 0, 1, 0, 0)
	drawBars(context, offset, head)
	drawHead(context, head)
	context.setTransform(ratio, 0, 0, ratio, 0, 0)
	drawTop(context, offset / ratio)
}

/**
 * @param {(context: CanvasRenderingContext2D) => void} paint - draws on it
 * @return {HTMLCanvasElement} a canvas of the stage's size, drawn once
 */
function layer(paint) {
	const each = document.createElement('canvas')
	each.width = pixels.width
	each.height = pixels.height
	paint(each.getContext('2d'))
	return each
}

/** Room above the wave for the zoom buttons */
const waveTop = computed(() => TOP.value - 4)

/**
 * A Range is a tinted span over the wave, its circle at its start
 *
 * @param {CanvasRenderingContext2D} context - where to draw
 * @param {number} offset - the window's left edge, in px from the start of the piece
 */
function drawSpans(context, offset) {
	const scale = perFrame()
	for (const comment of props.comments) {
		if (comment.outFrame !== null) {
			const from = comment.inFrame * scale - offset
			const to = (comment.outFrame + 1) * scale - offset
			if (to > 0 && from < size.width) {
				context.fillStyle = `rgba(${avatarRgb(comment.author)}, ${comment.resolved ? 0.1 : 0.22})`
				context.fillRect(from, waveTop.value, to - from, size.height - waveTop.value)
			}
		}
	}
	if (props.marked) {
		const from = props.marked.inFrame * scale - offset
		const to = ((props.marked.outFrame ?? props.marked.inFrame) + 1) * scale - offset
		context.fillStyle = 'rgba(255, 255, 255, 0.12)'
		context.fillRect(from, waveTop.value, Math.max(2, to - from), size.height - waveTop.value)
	}
}

/**
 * The bars, in device pixels: bar k at k × pitch − offset, whole pixels
 * wide and high, its height the same on every frame; a lane each
 *
 * @param {CanvasRenderingContext2D} context - where to draw, untransformed
 * @param {number} offset - the window's left edge, in device pixels from the start of the piece
 * @param {number} head - bars before it are played: Infinity for all, -Infinity for none
 */
function drawBars(context, offset, head) {
	// Over the whole piece the wave stands; scrolling, it moves at the playback rate
	const grid = barGrid(across(), pixels.width, ratio, isWhole(shown.value, duration.value) ? 0 : props.media?.playbackRate || 1)
	const bands = laneBands(shownLanes.value.length, pixels.height, Math.round(TOP.value * ratio), Math.round(BOTTOM.value * ratio), Math.round(LANE_GAP * ratio))
	shownLanes.value.forEach((lane, index) => {
		if (lane.waveform) {
			const levels = keep('bars' + index, [lane.waveform, grid.seconds, loudest.value], () => bars(lane.waveform, grid.seconds, loudest.value))
			// A lane ahead of the playhead stands that much to the left, on whole pixels too
			drawLane(context, levels, grid, bands[index], offset + shiftPixels(lane.shift, across(), pixels.width), head, lane.audible ? colors : SUBDUED)
		}
	})
}

/**
 * @param {CanvasRenderingContext2D} context - where to draw, untransformed
 * @param {Float32Array} levels - as bars gives them
 * @param {{pitch: number, width: number}} grid - as barGrid gives it
 * @param {{top: number, height: number}} band - the lane, in device pixels
 * @param {number} offset - the lane's left edge, in device pixels from the start of its piece
 * @param {number} head - bars before it are played
 * @param {{played: string, rest: string}} tints - its colours
 */
function drawLane(context, levels, grid, band, offset, head, tints) {
	const room = Math.max(8, band.height) / 2
	const middle = Math.round(band.top + room)
	// The loudest bar keeps a margin above and below
	const half = room * 0.85
	const { first, last } = barsShown(offset, grid.pitch, pixels.width, levels.length)
	let played = true
	context.fillStyle = tints.played
	for (let bar = first; bar <= last; bar++) {
		const x = bar * grid.pitch - offset
		if (played && x + grid.width / 2 > head) {
			played = false
			context.fillStyle = tints.rest
		}
		const level = Math.max(1, Math.round(levels[bar] * half))
		context.fillRect(x, middle - level, grid.width, 2 * level)
	}
}

/**
 * The playhead, from under the zoom buttons down to the lane of the circles, on whole device pixels: no circle covers it
 *
 * @param {CanvasRenderingContext2D} context - where to draw, untransformed
 * @param {number} head - its x, in device pixels
 */
function drawHead(context, head) {
	const width = Math.max(2, Math.round(2 * ratio))
	const top = Math.round(waveTop.value * ratio)
	context.fillStyle = '#fff'
	const bottom = circled.value ? Math.round((BOTTOM.value - 4) * ratio) : 0
	context.fillRect(head - Math.floor(width / 2), top, width, pixels.height - bottom - top)
}

/**
 * The circles, and the place of the Comment being written
 *
 * @param {CanvasRenderingContext2D} context - where to draw
 * @param {number} offset - the window's left edge, in px from the start of the piece
 */
function drawTop(context, offset) {
	drawCircles(context, circles(), offset, size.height - BOTTOM.value / 2)
	if (props.pending) {
		drawPending(context, props.pending, perFrame(), offset, size.height)
	}
}

/**
 * The place the Comment being written goes: a line over the wave, its Range tinted, and an open circle on the lane, or over the whole piece at the wave's foot
 *
 * @param {CanvasRenderingContext2D} context - the canvas
 * @param {{inFrame: number, outFrame: ?number}} pending - the place
 * @param {number} scale - px per Frame at this zoom
 * @param {number} offset - the window's left edge, in px from the start of the piece
 * @param {number} height - the canvas's height
 */
function drawPending(context, pending, scale, offset, height) {
	const x = pending.inFrame * scale - offset
	const foot = height - BOTTOM.value
	const y = height - Math.max(BOTTOM.value, CIRCLE + 4) / 2
	context.fillStyle = colors.played
	if (pending.outFrame !== null) {
		context.globalAlpha = 0.25
		context.fillRect(x, waveTop.value, (pending.outFrame + 1) * scale - offset - x, foot - waveTop.value)
		context.globalAlpha = 1
	}
	context.fillRect(x - 1, waveTop.value, 2, foot - waveTop.value)
	context.beginPath()
	context.arc(x, y, CIRCLE / 2 - 1, 0, 2 * Math.PI)
	context.fillStyle = '#000'
	context.fill()
	context.strokeStyle = colors.played
	context.setLineDash([3, 3])
	context.stroke()
	context.setLineDash([])
	context.fillStyle = colors.played
	context.fillText('+', x, y + 0.5)
}

/**
 * The Comments' circles, as circleLook has them
 *
 * @param {CanvasRenderingContext2D} context - the canvas
 * @param {Array<{comment: object, x: number}|{cluster: object[], x: number}>} list - the circles
 * @param {number} offset - the window's left edge, in px from the start of the piece
 * @param {number} y - the circles' centre line
 */
function drawCircles(context, list, offset, y) {
	const radius = CIRCLE / 2
	context.font = 'bold 10px sans-serif'
	context.textAlign = 'center'
	context.textBaseline = 'middle'
	context.lineWidth = 2
	for (const circle of list) {
		const x = circle.x - offset
		if (x < -radius || x > size.width + radius) {
			continue
		}
		const look = circleLook(circle, [store.selected, card.value?.id])
		context.globalAlpha = look.pale ? 0.45 : 1
		context.beginPath()
		context.arc(x, y, radius - 1, 0, 2 * Math.PI)
		context.fillStyle = '#000'
		context.fill()
		context.fillStyle = look.fill
		context.fill()
		context.strokeStyle = look.line
		context.stroke()
		context.fillStyle = '#fff'
		context.fillText(look.text, x, y + 0.5)
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

/**
 * The seconds to draw: where the playhead is, or on the way there after a
 * seek that was no drag (a click on the wave or the bar, a skip, a jump to a
 * Comment). The sound is there at once; only the drawing glides, from where
 * it stood but never from further than a window away (N13). A seek shows as
 * the playhead standing elsewhere than playing on from the last frame would
 * have taken it, whatever made it.
 *
 * @return {number} the seconds to draw
 */
function drawn() {
	const at = now()
	const time = performance.now()
	let exact = false
	if (following) {
		// The stage's own continuous seeks, a sideways wheel or swipe, are followed at once, as a drag is
		following = false
		exact = true
		glide = null
	} else if (last !== null && dragAt === null && drawnAt !== null && !motion.matches) {
		const expected = last.at + (props.playing ? (time - last.time) / 1000 * (props.media?.playbackRate || 1) : 0)
		if (Math.abs(at - expected) > SEEK_GAP) {
			const running = glide && glide.span === shown.value && glided(glide, time, at) !== null
			glide = running ? retarget(glide, at, across()) : { from: glideStart(drawnAt, at, across()), at: time, span: shown.value }
		}
	}
	last = { at, time }
	// Followed only from a media element; a drag or the stored Frame is exact
	const live = props.media && dragAt === null && !exact ? steadied(steady, at, time, !props.media.paused && !props.media.seeking && props.media.readyState >= 3, props.media.playbackRate || 1) : at
	steady = { seconds: live, time }
	const seconds = glide && glide.span === shown.value ? glided(glide, time, live) : null
	if (seconds === null) {
		glide = null
		return live
	}
	return seconds
}

/** One animation frame */
function tick() {
	frameRequest = 0
	draw()
	if ((props.playing || dragAt !== null || glide !== null) && visible) {
		schedule()
	}
}

watch([() => props.playing, () => props.frame, shownLanes, () => props.marked, shown, () => props.comments, () => store.selected, () => props.pending, card], schedule)

// A seek that settles after the last prop change (a drag's final seek) still moves the time drawn from
watch(() => props.media, (media, before) => {
	before?.removeEventListener('seeked', schedule)
	media?.addEventListener('seeked', schedule)
}, { immediate: true })
onBeforeUnmount(() => props.media?.removeEventListener('seeked', schedule))

/** The stage's size in CSS px, and the browser's count of its device pixels, as last measured */
let measured = { width: 0, height: 0, device: null }

/**
 * The canvas takes as many device pixels as it covers on the screen, so that
 * one of its pixels is one of the screen's and nothing is resampled on the
 * way (canvasPixels)
 */
function measure() {
	const fit = canvasPixels(measured.width, measured.height, window.devicePixelRatio || 1, measured.device)
	pixels = { width: fit.width, height: fit.height }
	ratio = fit.ratio
	size = fit.css ?? { width: measured.width, height: measured.height }
	canvas.value.style.width = fit.css ? fit.css.width + 'px' : ''
	canvas.value.style.height = fit.css ? fit.css.height + 'px' : ''
	canvas.value.width = pixels.width
	canvas.value.height = pixels.height
	const style = getComputedStyle(host.value)
	colors = {
		played: style.getPropertyValue('--color-primary-element').trim() || colors.played,
		rest: colors.rest,
	}
	kept = {}
	draw()
}

const resized = new ResizeObserver(([entry]) => {
	const device = entry.devicePixelContentBoxSize?.[0]
	measured = { width: entry.contentRect.width, height: entry.contentRect.height, device: device ? { width: device.inlineSize, height: device.blockSize } : null }
	measure()
})

/** The pixel ratio changes while the view is open: the window went to another screen, or the browser zooms */
let resolution = null

/** Measures again, and listens for the next change of the ratio */
function onResolution() {
	resolution?.removeEventListener('change', onResolution)
	resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
	resolution.addEventListener('change', onResolution)
	if (measured.width) {
		// The browser counts the device pixels anew with its next report; until then the ratio decides
		measured = { ...measured, device: null }
		measure()
	}
}

/** Off screen, as under a phone's Comment list pulled up, the loop stops */
const seen = new IntersectionObserver(([entry]) => {
	visible = entry.isIntersecting
	schedule()
})

onMounted(() => {
	// The stage, not the canvas, whose CSS box may be cut down to whole device pixels
	try {
		resized.observe(host.value, { box: 'device-pixel-content-box' })
	} catch {
		resized.observe(host.value)
	}
	seen.observe(host.value)
	onResolution()
})
onBeforeUnmount(() => {
	resolution?.removeEventListener('change', onResolution)
	resized.disconnect()
	seen.disconnect()
	cancelAnimationFrame(frameRequest)
})

/** Where the field at the Waveform stands: at its place when it opened, kept on the stage */
const composeLeft = ref(0)
watch(() => props.composing && props.pending?.inFrame, () => {
	if (props.composing && props.pending) {
		card.value = null
		// Where the place stands once the wave has come to rest: a glide after a seek brings the mark under the card, which does not move
		const x = props.pending.inFrame * perFrame() - offsetAt(now())
		composeLeft.value = Math.min(size.width - CARD_HALF - 8, Math.max(CARD_HALF + 8, x))
	}
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
		// Two fingers zoom: whatever the first one began is over
		clearTimeout(press?.timer)
		endDrag()
		press = null
		pinch = { distance: spread(), span: shown.value }
		return
	}
	press = { id: event.pointerId, x: event.clientX, y: event.clientY, from: onScreen(), moved: false, long: false }
	// A finger or a pen resting on a circle opens its card, as a tap does; elsewhere, where one may comment, the Comment field for that place
	if (event.pointerType !== 'mouse') {
		const at = press
		at.timer = setTimeout(() => {
			const circle = hit(at.x, at.y, event.pointerType)
			if (circle || props.canComment) {
				at.long = true
			}
			if (circle) {
				openCircle(circle, at.x - left)
			} else if (props.canComment) {
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
	return frameOf(secondsAt(x, windowAt(onScreen(), shown.value, duration.value, margin()), size.width, duration.value))
}

/**
 * @return {number} the seconds the stage shows: during a glide where the wave is drawn, not where the sound already is
 */
function onScreen() {
	return glide !== null && drawnAt !== null ? drawnAt : now()
}

/**
 * @param {number} clientX - the pointer's x in the window
 * @param {number} clientY - the pointer's y in the window
 * @param {string} pointerType - a finger reaches wider than a mouse
 * @return {object|null} the circle there, the nearest
 */
function hit(clientX, clientY, pointerType) {
	const box = host.value.getBoundingClientRect()
	const x = clientX - box.left + offsetAt(onScreen())
	return circleAt(circles(), x, clientY - box.top - (size.height - BOTTOM.value / 2), pointerType === 'mouse' ? CIRCLE / 2 : CIRCLE)
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
	// Moving past the slop either way is no resting finger
	if (Math.hypot(dx, event.clientY - press.y) > TAP_SLOP) {
		clearTimeout(press.timer)
	}
	if (!press.moved && !press.long && Math.abs(dx) > TAP_SLOP) {
		press.moved = true
		// Playback holds while the wave is dragged, and goes on where it is let go
		emit('hold')
	}
	if (press.moved) {
		dragAt = dragged({ from: press.from, dx, x: xOf(event), span: shown.value, width: size.width, duration: duration.value, margin: margin() })
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

/**
 * A click or a tap: on a circle it opens the Comment's card; with a card
 * open it only closes it; elsewhere it only seeks, and playback goes on as it was
 *
 * @param {PointerEvent} event - the pointer lifts where it came down
 */
function tap(event) {
	const circle = hit(event.clientX, event.clientY, event.pointerType)
	if (circle) {
		openCircle(circle, xOf(event))
	} else if (card.value) {
		card.value = null
	} else {
		emit('seek', frameAtX(xOf(event)))
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
 * A circle opens its Comment's card. A count circle zooms in on its place
 * until its Comments stand apart; where even the closest zoom leaves them
 * together, it opens the card on the first, to step through them there.
 *
 * @param {{comment?: object, cluster?: object[]}} circle - the circle hit
 * @param {number} x - where it was hit, from the stage's left edge
 */
function openCircle(circle, x) {
	if (circle.comment) {
		open(circle.comment, x, null)
		return
	}
	const { cluster } = circle
	const parted = spreadSpan(cluster, fpsValue(props.fps), size.width, duration.value)
	if (parted === null) {
		open(cluster[0], x, cluster)
		return
	}
	zoom(parted)
	emit('seek', Math.round((cluster[0].inFrame + cluster.at(-1).inFrame) / 2))
}

/**
 * Opens a Comment's card at its circle, on the wave or above the bar, and selects it in the list too; opening does not seek
 *
 * @param {object} comment - the Comment
 * @param {number} x - where it was hit, from the stage's left edge
 * @param {?object[]} siblings - the Comments of its place to step through, where no zoom parts them
 */
function open(comment, x, siblings) {
	// A Comment's card and the field never show at once
	if (props.composing) {
		emit('closeComposer')
	}
	card.value = { id: comment.id, left: Math.min(size.width - CARD_HALF - 8, Math.max(CARD_HALF + 8, x)), siblings }
	store.selected = comment.id
}

defineExpose({ open })

/**
 * @param {object} comment - another Comment of the same place
 */
function show(comment) {
	card.value = { ...card.value, id: comment.id }
	store.selected = comment.id
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
		zoom(wheelZoom(shown.value, event.deltaY, event.deltaMode, duration.value))
		return
	}
	if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
		event.preventDefault()
		const target = frameOf(wheelSeek(now(), event.deltaX, event.deltaMode, across(), size.width, duration.value))
		// A swipe against the start or the end moves nothing, and must not keep the next seek from gliding
		if (target !== frameOf(now())) {
			following = true
			emit('seek', target)
		}
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
		@pointermove="onMove($event); onHover($event)"
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
		<!-- Each lane's name; a tap on it plays its sound, a tap on its wave seeks as anywhere -->
		<button
			v-for="(lane, index) in lanes ?? []"
			:key="index"
			type="button"
			class="deliver-wave__lane"
			:class="{ 'deliver-wave__lane--audible': lane.audible }"
			:style="{ top: `calc(${TOP + 4}px + ${index} * (100% - ${TOP + BOTTOM - LANE_GAP}px) / ${lanes.length})` }"
			:aria-pressed="lane.audible ? 'true' : 'false'"
			:aria-label="t('deliver', 'Listen to {version}', { version: lane.label })"
			:title="t('deliver', 'Listen to {version}', { version: lane.label })"
			@pointerdown.stop
			@click="emit('pick', index)">
			{{ lane.label }}
		</button>
		<!-- Toasts of the field at the Waveform, in the stage's top corner: clear of the transport buttons and of a sheet -->
		<div id="deliver-wave-toasts" class="deliver-wave__toasts" @pointerdown.stop />
		<!-- The Comment at its circle, with its Replies and a field to answer; on a phone a sheet from below -->
		<WaveformCard
			v-if="opened"
			:comment="opened"
			:clock="clock"
			:left="isMobile ? null : card.left"
			:siblings="card.siblings"
			:inside="[host]"
			@close="card = null"
			@jump="goTo"
			@show="show" />
		<!-- The field at the Waveform, while the Comment list is out of sight (N12) -->
		<WaveformCard
			v-else-if="composing && pending"
			:label="t('deliver', 'New Comment')"
			:left="isMobile ? null : composeLeft"
			:inside="[host]"
			@close="emit('closeComposer')">
			<slot name="composer" />
		</WaveformCard>
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

.deliver-wave__toasts {
	position: absolute;
	top: 48px;
	inset-inline-end: 8px;
	z-index: 4;
	max-width: min(360px, calc(100% - 16px));
	cursor: auto;
}

.deliver-wave__toasts:empty {
	display: none;
}

/* The toasts' own container (@nextcloud/dialogs) is fixed to the window's bottom corner: here it stands in the holder */
.deliver-wave__toasts :deep([class*='_toastContainer']) {
	position: static;
	padding: 0;
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

.deliver-wave__step:hover,
.deliver-wave__step:focus {
	background: none;
	color: #fff;
}

.deliver-wave__step[aria-pressed='true'] {
	background: rgba(255, 255, 255, 0.2);
	color: #fff;
}

.deliver-wave__step:focus-visible {
	outline: 2px solid #fff;
}

.deliver-wave__lane {
	position: absolute;
	inset-inline-start: 8px;
	z-index: 1;
	min-height: 0;
	margin: 0;
	padding: 2px 10px;
	border: none;
	border-radius: var(--border-radius-pill);
	background: rgba(0, 0, 0, 0.6);
	color: rgba(255, 255, 255, 0.7);
	font-size: 13px;
	font-weight: bold;
	cursor: pointer;
}

.deliver-wave__lane:not(.deliver-wave__lane--audible) {
	box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
}

.deliver-wave__lane--audible {
	background: var(--color-primary-element);
	color: var(--color-primary-element-text);
}

.deliver-wave__lane:focus-visible {
	outline: 2px solid #fff;
}

</style>
