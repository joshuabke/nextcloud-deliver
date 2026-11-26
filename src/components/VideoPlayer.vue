<script setup>
import menuIcon from '@mdi/svg/svg/chevron-down.svg?raw'
import caretIcon from '@mdi/svg/svg/chevron-up.svg?raw'
import closeIcon from '@mdi/svg/svg/close.svg?raw'
import captionsOffIcon from '@mdi/svg/svg/closed-caption-outline.svg?raw'
import captionsIcon from '@mdi/svg/svg/closed-caption.svg?raw'
import moreIcon from '@mdi/svg/svg/dots-horizontal.svg?raw'
import skipForwardIcon from '@mdi/svg/svg/fast-forward-10.svg?raw'
import fullscreenExitIcon from '@mdi/svg/svg/fullscreen-exit.svg?raw'
import fullscreenIcon from '@mdi/svg/svg/fullscreen.svg?raw'
import pauseIcon from '@mdi/svg/svg/pause.svg?raw'
import playIcon from '@mdi/svg/svg/play.svg?raw'
import loopIcon from '@mdi/svg/svg/repeat.svg?raw'
import skipBackIcon from '@mdi/svg/svg/rewind-10.svg?raw'
import stepBackIcon from '@mdi/svg/svg/step-backward.svg?raw'
import stepForwardIcon from '@mdi/svg/svg/step-forward.svg?raw'
import volumeIcon from '@mdi/svg/svg/volume-high.svg?raw'
import mutedIcon from '@mdi/svg/svg/volume-off.svg?raw'
import { getLanguage } from '@nextcloud/l10n'
import { useIsMobile } from '@nextcloud/vue/composables/useIsMobile'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcActionSeparator from '@nextcloud/vue/components/NcActionSeparator'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import CommentCard from './CommentCard.vue'
import DrawingLayer from './DrawingLayer.vue'
import DrawToolbar from './DrawToolbar.vue'
import WaveformStage from './WaveformStage.vue'
import { useFullscreen } from '../composables/fullscreen.js'
import { useGestures } from '../composables/gestures.js'
import { useLongPress } from '../composables/longpress.js'
import { useRange } from '../composables/range.js'
import { languageName, toWebVtt } from '../lib/captions.js'
import { COLORS, drawingsAt } from '../lib/drawing.js'
import { TAP_SLOP } from '../lib/gestures.js'
import { actionFor } from '../lib/hotkeys.js'
import { n, t } from '../lib/l10n.js'
import { liveSeek } from '../lib/liveSeek.js'
import { loupeFrame, loupePart, openLoupe } from '../lib/loupe.js'
import { hoverSource } from '../lib/media.js'
import { SKIP_SECONDS, skipFrames } from '../lib/skip.js'
import { formatAt, formatLength, fpsValue, frameToTime, modesFor, stepOf, timeToFrame } from '../lib/timecode.js'
import { watermarkTile } from '../lib/watermark.js'
import { fetchWaveform, overview } from '../lib/waveform.js'
import { circleLook, circlesOf, isWhole, overviewWindow, readSpan } from '../lib/waveWindow.js'
import { useCommentsStore } from '../store/comments.js'

/** The drawing being made for the next Comment */
const draft = defineModel('draft', { type: Array, default: () => [] })

const props = defineProps({
	/** The Version to play, with its URLs and frame rate */
	version: { type: Object, required: true },
	/** The Comments, as circles on the bar */
	comments: { type: Array, default: () => [] },
	/** How time is shown: { fps, mode, startFrame, dropFrame } */
	clock: { type: Object, required: true },
	canComment: { type: Boolean, default: false },
	/** Text shown across the picture on a Review Link that asks for it (story 94) */
	watermark: { type: String, default: null },
	/** Whether the pointer draws on the picture (story 89) */
	drawing: { type: Boolean, default: false },
	/** Where the Comment being written goes, once the field holds it: marked on the Waveform */
	pending: { type: Object, default: null },
	/** Whether the field is open at the Waveform (N12): the view hands it in as the composer slot */
	composing: { type: Boolean, default: false },
})

const emit = defineEmits(['comment', 'jump', 'reply', 'swipe', 'seeked', 'closeComposer', 'update:mode', 'update:drawing'])

const SPEEDS = [0.25, 0.5, 1, 1.5, 2]

/** For the Comment selected in the list */
const store = useCommentsStore()
const root = ref(null)
const video = ref(null)
const muted = ref(false)
/** On a phone the bar is shorter and the picture answers to fingers */
const isMobile = useIsMobile()
const { fullscreen, filling, toggle: toggleFullscreen } = useFullscreen(root)
const frame = ref(0)
const durationFrames = ref(0)
const playing = ref(false)
/** Playback rate; negative while J walks backwards */
const speed = ref(1)
const { outPoint, loop, range, loopsWhole, markIn, markOut, clearRange, wrapFrom } = useRange(frame)
/** Set when the browser could not play the source */
const unplayable = ref(false)
/** Steps backwards while J is held, because media elements refuse a negative rate */
let reverse = null

const fps = computed(() => props.version.fps)
/** The original, where the browser can play it and the link hands it out */
const original = computed(() => props.version.playable === false ? null : props.version.url)
const proxy = computed(() => props.version.derived?.proxy?.url ?? null)
/** The original by default; the Proxy is the lighter choice next to it, or the only one (ADR 0003) */
const useProxy = ref(false)
const source = computed(() => (useProxy.value ? proxy.value : original.value) ?? proxy.value ?? original.value)
/** Where to go once the other source has loaded, so switching keeps the Frame */
let resumeAt = null
/** Why nothing plays: no browser can and nothing converts it, or only this browser cannot (MKV in Safari, say) */
const unplayableReason = computed(() => {
	if (props.version.playable !== false) {
		return t('deliver', 'This browser cannot play this file. Open it in another browser, such as Chrome or Firefox.')
	}
	return props.version.derived?.proxy?.state === 'failed'
		? t('deliver', 'Browsers cannot play this file, and Deliver could not convert it.')
		: t('deliver', 'Browsers cannot play this file, and this Nextcloud lacks ffmpeg to convert it.')
})
const proxyPending = computed(() => ['queued', 'running'].includes(props.version.derived?.proxy?.state))
const lastFrame = computed(() => Math.max(0, durationFrames.value - 1))

/** The Thumbnail Strip, once its index is loaded */
const strip = ref(null)
/** The Waveform at its own rate, once loaded */
const waveform = ref(null)
/** The Waveform, one value per slice of the timeline */
const peaks = computed(() => waveform.value ? overview(waveform.value, fps.value?.num ? durationFrames.value * fps.value.den / fps.value.num : 0) : [])
/** Audio with its Waveform plays on a scrolling one; the seconds it shows across the stage */
const scrolling = computed(() => props.version.audioOnly && waveform.value !== null && durationFrames.value > 0)
const span = ref(readSpan())
/** The part of the piece on the stage, shown on the bar under it */
const shownWindow = computed(() => scrolling.value ? overviewWindow(frame.value / fpsValue(fps.value), span.value, durationFrames.value / fpsValue(fps.value)) : null)
const hover = ref(null)
/** The zoomed section of the bar a finger or pen held still on it opens (#273), while it stays down */
const loupe = ref(null)
const scrubber = ref(null)
/** Whether a mouse is over the bar: a tap's :hover would stay */
const pointed = ref(false)
/** The bar's width, in px */
const barWidth = ref(0)
const barResized = new ResizeObserver(([entry]) => {
	barWidth.value = entry.contentRect.width
})
/** The Comments' circles on the bar, as on the Waveform; none where that shows the whole piece, and all of them */
const marks = computed(() => !barWidth.value || !durationFrames.value || (scrolling.value && isWhole(span.value, durationFrames.value / fpsValue(fps.value)))
	? []
	: circlesOf(props.comments, barWidth.value / durationFrames.value).map((circle) => ({ ...circle, ...circleLook(circle, [store.selected]) })))

/**
 * @param {{comment?: object, cluster?: object[]}} mark - a circle on the bar
 * @return {string} its name, for the keyboard and a screen reader
 */
function markName({ comment, cluster }) {
	const time = formatAt((comment ?? cluster[0]).inFrame, props.clock)
	return comment
		? t('deliver', 'Comment by {author} at {time}', { author: comment.author.name, time })
		: n('deliver', '%n Comment at {time}', '%n Comments at {time}', cluster.length, { time })
}

/** The Comment whose card a circle on the bar opened, the circle in the window, and the Comments of a count circle (#273) */
const barCard = ref(null)
const barOpened = computed(() => barCard.value && props.comments.find((comment) => comment.id === barCard.value.id))

/**
 * Opens the card of a circle on the bar over it, and selects its Comment in the list too; it does not seek
 *
 * @param {{comment?: object, cluster?: object[]}} mark - the circle
 * @param {Element} element - the circle on screen
 */
function openMark(mark, element) {
	// A Comment's card and the field never show at once
	if (props.composing) {
		emit('closeComposer')
	}
	const box = element.getBoundingClientRect()
	const comment = mark.comment ?? mark.cluster[0]
	barCard.value = { id: comment.id, siblings: mark.cluster ?? null, at: { x: box.left + box.width / 2, y: box.top, line: null } }
	store.selected = comment.id
}

/**
 * @param {object} comment - another Comment of the same place
 */
function showOnBar(comment) {
	barCard.value = { ...barCard.value, id: comment.id }
	store.selected = comment.id
}
const tool = ref('pen')
const color = ref(COLORS[0])
/** The picture's own size, for placing drawings on it */
const picture = ref({ width: 0, height: 0 })
/** Drawings of the Comments on this Frame, while the picture stands still */
const shownDrawings = computed(() => playing.value || props.drawing
	? []
	: drawingsAt(props.comments, frame.value).map((comment) => comment.annotation))

const position = computed(() => formatAt(frame.value, props.clock))
const duration = computed(() => formatLength(durationFrames.value, props.clock))
const progress = computed(() => durationFrames.value ? (frame.value / durationFrames.value) * 100 : 0)

defineExpose({ seekTo, frame, pause, range, markIn, markOut, clearRange })

/** What a gesture did, shown for a moment over the picture */
const flash = ref(null)
let flashTimer = null

/**
 * @param {string} text - what to show
 * @param {number} side - -1 on the left, 1 on the right, 0 in the middle
 */
function showFlash(text, side = 0) {
	clearTimeout(flashTimer)
	flash.value = { text, side }
	flashTimer = setTimeout(() => {
		flash.value = null
	}, 600)
}

/** The speed and state to go back to when a held finger lifts */
let beforeHold = null

/**
 * A double tap: the skip of the buttons, shown for a moment
 *
 * @param {number} side - -1 back, 1 on, 0 nothing
 */
function skipTap(side) {
	if (side === 0) {
		return
	}
	skip(side)
	showFlash(side < 0 ? t('deliver', '−{seconds} s', { seconds: SKIP_SECONDS }) : t('deliver', '+{seconds} s', { seconds: SKIP_SECONDS }), side)
}

/** Touch on the picture (story 104); drawing takes the fingers for itself */
const { zoom, touched, reset: resetZoom, listeners: gestures } = useGestures({
	// On a phone a tap goes in and out of fullscreen, as in the Frame.io app
	tap: () => {
		if (isMobile.value) {
			toggleFullscreen()
		} else {
			playPause()
		}
	},
	doubleTap: skipTap,
	holdStart: () => {
		beforeHold = { playing: playing.value, speed: speed.value }
		speed.value = 2
		play()
		showFlash('2×')
	},
	holdEnd: () => {
		if (beforeHold) {
			setSpeed(beforeHold.speed)
			if (!beforeHold.playing) {
				pause()
			}
			beforeHold = null
		}
	},
	swipe: (step) => emit('swipe', step),
}, computed(() => !props.drawing))

watch(() => props.version.id, async (id) => {
	pause()
	useProxy.value = false
	resumeAt = null
	frame.value = 0
	// The server knows the length already; the media element confirms it once it loads
	durationFrames.value = props.version.durationFrames ?? 0
	clearRange()
	unplayable.value = false
	strip.value = null
	waveform.value = null
	hover.value = null
	resetZoom()
	const [loadedStrip, loadedWaveform] = await Promise.all([loadStrip(), fetchWaveform(props.version)])
	// A later Version may have been opened in the meantime
	if (props.version.id === id) {
		strip.value = loadedStrip
		waveform.value = loadedWaveform
	}
}, { immediate: true })

// Derived media that becomes ready while the Version is open shows without opening it again
watch(() => props.version.derived?.waveform?.state, async (state) => {
	const id = props.version.id
	const loaded = state === 'ready' && waveform.value === null ? await fetchWaveform(props.version) : null
	if (loaded !== null && props.version.id === id) {
		waveform.value = loaded
	}
})
watch(() => props.version.derived?.thumbs?.state, async (state) => {
	const id = props.version.id
	const loaded = state === 'ready' && strip.value === null ? await loadStrip() : null
	if (loaded !== null && props.version.id === id) {
		strip.value = loaded
	}
})

watch(source, () => {
	unplayable.value = false
})

/** The language whose Captions show; off until someone picks one (#54) */
const captionLanguage = ref(null)
/** The shown Captions as WebVTT in a blob, for the <track> */
const captionTrack = ref(null)
const trackEl = ref(null)
const captions = computed(() => props.version.captions ?? [])
const locale = getLanguage()

watch([captionLanguage, () => props.version.id], async () => {
	if (captionTrack.value) {
		URL.revokeObjectURL(captionTrack.value)
		captionTrack.value = null
	}
	const id = props.version.id
	// Another Version keeps the language where it has Captions in it
	const chosen = captions.value.find((each) => each.language === captionLanguage.value)
	if (!chosen) {
		captionLanguage.value = null
		return
	}
	const text = await fetch(chosen.url).then((response) => response.ok ? response.text() : '').catch(() => '')
	const vtt = toWebVtt(text, props.version)
	if (vtt !== null && props.version.id === id && captionLanguage.value === chosen.language) {
		captionTrack.value = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }))
	}
})
// A track added to a playing element starts hidden
watch(trackEl, (track) => {
	if (track) {
		track.track.mode = 'showing'
	}
})

/**
 * @return {Promise<object|null>} the tile grid of the Thumbnail Strip, for hover previews
 */
async function loadStrip() {
	const thumbs = props.version.derived?.thumbs
	if (thumbs?.state !== 'ready') {
		return null
	}
	try {
		const index = await (await fetch(thumbs.index)).json()
		const image = new Image()
		image.src = thumbs.url
		await image.decode()
		return {
			...index,
			url: thumbs.url,
			tileWidth: image.naturalWidth / index.columns,
			tileHeight: image.naturalHeight / index.rows,
			sheetWidth: image.naturalWidth,
			sheetHeight: image.naturalHeight,
		}
	} catch {
		return null
	}
}

/**
 * @param {MouseEvent} event - a click or a move on the timeline
 * @return {number} the Frame under the pointer
 */
function frameAt(event) {
	const box = event.currentTarget.getBoundingClientRect()
	const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
	return loupe.value ? loupeFrame(loupe.value, ratio, lastFrame.value) : Math.min(lastFrame.value, Math.floor(ratio * durationFrames.value))
}

/**
 * @param {MouseEvent} event - moving along the timeline
 */
function onHover(event) {
	if (!durationFrames.value) {
		return
	}
	const at = frameAt(event)
	const box = event.currentTarget.getBoundingClientRect()
	hover.value = { frame: at, left: event.clientX - box.left, tile: tileFor(at) }
	peekFrame(at)
}

/*
 * The exact Frame under the pointer, as Frame.io shows it: a hidden second
 * video, the Scrub Proxy or else the lighter Proxy where there is one, seeks there and is copied
 * into a canvas. One seek at a time; the pointer's latest Frame goes next.
 * Until the first copy, the Thumbnail Strip's nearest picture stands in.
 */
const scrubVideo = ref(null)
const scrubCanvas = ref(null)
/** This browser cannot play the Scrub Proxy (no H.264 decoder), so the hover goes back to what plays */
const scrubBroken = ref(false)
const scrubSource = computed(() => props.version.audioOnly ? null : hoverSource(props.version.derived?.scrub?.url, proxy.value ?? source.value, scrubBroken.value))
/** Whether the canvas holds a Frame from this hover */
const scrubDrawn = ref(false)
const scrubSize = ref({ width: 176, height: 99 })
let scrubBusy = false
let scrubWanted = null

/**
 * @param {number} at - the Frame to show
 */
function peekFrame(at) {
	scrubWanted = at
	if (!scrubBusy) {
		nextScrub()
	}
}

/** Sends the hidden video to the Frame asked for last */
function nextScrub() {
	const element = scrubVideo.value
	if (scrubWanted === null || !element || element.readyState < 1) {
		scrubBusy = false
		return
	}
	scrubBusy = true
	element.currentTime = frameToTime(scrubWanted, fps.value)
	scrubWanted = null
}

/** The hidden video knows its size: the canvas takes its shape */
function onScrubLoaded() {
	const element = scrubVideo.value
	if (element.videoWidth) {
		scrubSize.value = { width: 176, height: Math.round(176 * element.videoHeight / element.videoWidth) }
	}
	nextScrub()
}

/** The hidden video cannot be read: a Scrub Proxy gives way to what plays; else the Thumbnail Strip stays */
function onScrubError() {
	scrubBusy = false
	if (scrubSource.value !== (proxy.value ?? source.value)) {
		scrubBroken.value = true
	}
}

/** The hidden video stands on the Frame: copy it and go on to the next */
function onScrubSeeked() {
	scrubCanvas.value?.getContext('2d')?.drawImage(scrubVideo.value, 0, 0, scrubSize.value.width, scrubSize.value.height)
	scrubDrawn.value = true
	nextScrub()
}

/** Set while a finger drags along the bar */
const dragging = ref(false)
/** Set while a drag holds playback, a finger's on the bar or one on the Waveform */
let holding = false
/** Whether it played when the drag began: it goes on when the drag lets go */
let heldWhilePlaying = false

/** A drag holds playback; a second finger on a drag that holds it already changes nothing */
function hold() {
	if (!holding) {
		holding = true
		heldWhilePlaying = playing.value
	}
	pause()
}

/** The drag lets go: playback goes on if it played, unless the drag went to the end, where it stays as the natural end does */
function release() {
	if (holding && heldWhilePlaying && frame.value < lastFrame.value) {
		play()
	}
	holding = false
	heldWhilePlaying = false
}

/** The Frame a press on the bar came down on */
let pressedAt = null
/** A press that came down on a circle, until it moves past the slop: lifted there it opens the circle's card instead of seeking */
let circlePress = null

/**
 * By where the pointer is: the circles take no pointer, so that a touch near one stays the bar's, and beside a circle
 * the bar seeks to the Frame under the finger
 *
 * @param {PointerEvent} event - a pointer comes down on the bar
 * @return {{mark: object, element: Element}|null} the circle it came down in
 */
function circleUnder(event) {
	const elements = [...event.currentTarget.querySelectorAll('.deliver-player__circles > .deliver-player__circle')]
	const index = elements.findIndex((element) => {
		const box = element.getBoundingClientRect()
		return Math.hypot(event.clientX - box.left - box.width / 2, event.clientY - box.top - box.height / 2) <= box.width / 2
	})
	return index < 0 ? null : { mark: marks.value[index], element: elements[index] }
}

const live = liveSeek((target) => {
	const element = video.value
	const time = frameToTime(target, fps.value)
	if (!element || element.currentTime === time) {
		return false
	}
	element.currentTime = time
	return true
})

/** A finger or pen held still on the bar opens the zoomed section (#273) */
const { press: loupePress } = useLongPress(() => {
	if (!dragging.value || !barWidth.value) {
		return
	}
	// From the Frame under the finger: on a circle the press has not moved the player yet, and it is a hold now, not a tap
	circlePress = null
	const at = hover.value?.frame ?? pressedAt
	loupe.value = openLoupe(at, Math.min(1, Math.max(0, (hover.value?.left ?? 0) / barWidth.value)), durationFrames.value, fpsValue(fps.value))
	// Seeking through it holds playback as a drag does; it stays on the Frame it opened on, not where playback went meanwhile
	hold()
	frame.value = at
	live.want(at)
})
/** The Range and the Comments' Ranges within the section */
const loupeParts = computed(() => !loupe.value
	? []
	: [
			...(range.value && range.value.outFrame !== null ? [{ key: 'range', kind: 'deliver-player__range', anchor: range.value }] : []),
			...props.comments.filter((each) => each.outFrame !== null).map((each) => ({ key: 'r' + each.id, kind: 'deliver-player__span', anchor: each })),
		].map(({ anchor, ...part }) => ({ ...part, at: loupePart(loupe.value, anchor.inFrame, anchor.outFrame + 1) })).filter((part) => part.at))
/** The Comments' circles within the section, as on the bar */
const loupeMarks = computed(() => {
	if (!loupe.value || !barWidth.value) {
		return []
	}
	const { start, frames } = loupe.value
	const perFrame = barWidth.value / frames
	return circlesOf(props.comments.filter((each) => each.inFrame >= start && each.inFrame <= start + frames), perFrame)
		.map((circle) => ({ ...circle, ...circleLook(circle, [store.selected]), x: circle.x - start * perFrame }))
})
/** Where the player stands in the section, in percent */
const loupeAt = computed(() => loupe.value ? (loupePart(loupe.value, 0, frame.value)?.width ?? 0) : 0)

/** Chrome hands a touch near a button, the controls right under the bar, to it, unless what is touched answers a click itself */
function keepTouch() {}

/**
 * Pressing on the bar takes the playhead there, and it follows the pointer
 * while the button or finger is down (story 105, decision L3): the element
 * is sought live, one seek at a time. Playback is held meanwhile and goes on
 * after, as it did before (N2).
 *
 * @param {PointerEvent} event - a pointer comes down on the bar
 */
function onDragStart(event) {
	if (!durationFrames.value || (event.pointerType === 'mouse' && event.button !== 0)) {
		return
	}
	// Only the first pointer can hold still for the zoomed section; a second one ends that wait
	if (dragging.value) {
		loupePress.pointerup()
	} else {
		loupePress.pointerdown(event)
	}
	dragging.value = true
	pressedAt = frameAt(event)
	const circle = circleUnder(event)
	circlePress = circle && { ...circle, x: event.clientX, y: event.clientY }
	event.currentTarget.setPointerCapture(event.pointerId)
	follow(event)
}

/**
 * The pointer shows the Frame under it; a drag takes the player there
 *
 * @param {PointerEvent} event - the pointer moves
 */
function follow(event) {
	onHover(event)
	// On a circle the press waits: lifted within the slop it opens the card, moved past it it drags as anywhere
	if (circlePress && Math.hypot(event.clientX - circlePress.x, event.clientY - circlePress.y) <= TAP_SLOP) {
		return
	}
	circlePress = null
	if (dragging.value) {
		const at = frameAt(event)
		// A click only seeks and keeps the playback state, shuttle included; once the pointer leaves its Frame it is a drag
		if (at !== pressedAt && !holding) {
			hold()
		}
		frame.value = at
		live.want(at)
		emit('seeked')
	}
}

/**
 * The mouse hovers and a drag follows; a tap leaves no hover behind, not
 * even through the mouse events a touch browser sends after it
 *
 * @param {PointerEvent} event - the pointer moves
 */
function onPointerMove(event) {
	if (event.pointerType === 'mouse' || dragging.value) {
		loupePress.pointermove(event)
		follow(event)
	}
}

/**
 * The pointer lets go: the player is exactly on the Frame it showed, and playback goes on if it played
 *
 * @param {PointerEvent} event - the pointer lets go or is taken away
 */
function onDragEnd(event) {
	if (!dragging.value) {
		return
	}
	dragging.value = false
	live.reset()
	loupePress.pointerup()
	const circle = circlePress
	circlePress = null
	if (event.type === 'pointerup') {
		if (circle) {
			openMark(circle.mark, circle.element)
		} else {
			seekTo(frameAt(event))
		}
	}
	loupe.value = null
	release()
	if (event.pointerType !== 'mouse') {
		leaveScrubber()
	}
}

/** The pointer left the bar */
function leaveScrubber() {
	hover.value = null
	scrubDrawn.value = false
	scrubWanted = null
}

/**
 * @param {number} at - the Frame under the pointer
 * @return {object|null} the style that shows that Frame's tile of the Thumbnail Strip
 */
function tileFor(at) {
	if (strip.value === null) {
		return null
	}
	const seconds = at * fps.value.den / fps.value.num
	const index = Math.min(strip.value.count - 1, Math.floor(seconds / strip.value.every))
	const column = index % strip.value.columns
	const row = Math.floor(index / strip.value.columns)
	return {
		width: strip.value.tileWidth + 'px',
		height: strip.value.tileHeight + 'px',
		backgroundImage: `url("${strip.value.url}")`,
		backgroundSize: `${strip.value.sheetWidth}px ${strip.value.sheetHeight}px`,
		backgroundPosition: `-${column * strip.value.tileWidth}px -${row * strip.value.tileHeight}px`,
	}
}

/**
 * The Waveform as one shape, mirrored around the middle and scaled to its
 * own loudest peak, so quiet dialogue does not flatten into a line.
 */
const waveformPoints = computed(() => {
	if (peaks.value.length === 0) {
		return ''
	}
	// Scaled to its loudest peak, but near-silence stays a thin line rather than a band
	const loudest = Math.max(0.15, ...peaks.value)
	const step = 100 / peaks.value.length
	const height = (peak) => (peak / loudest) * 48
	// Each peak stands for a bucket of the timeline: drawn at its middle, with the
	// first and last peak held out to the edges so the shape spans all of it
	const xs = [0, ...peaks.value.map((peak, i) => (i + 0.5) * step), 100]
	const ys = [peaks.value[0], ...peaks.value, peaks.value[peaks.value.length - 1]]
	const top = ys.map((peak, i) => `${xs[i].toFixed(3)},${(50 - height(peak)).toFixed(2)}`)
	const bottom = ys.map((peak, i) => `${xs[i].toFixed(3)},${(50 + height(peak)).toFixed(2)}`).reverse()
	return [...top, ...bottom].join(' ')
})

onMounted(() => {
	barResized.observe(scrubber.value)
	window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
	if (captionTrack.value) {
		URL.revokeObjectURL(captionTrack.value)
	}
	barResized.disconnect()
	window.removeEventListener('keydown', onKey)
	stopReverse()
	clearTimeout(flashTimer)
})

/** Follows the media element, and sends a looped Range back to its in Frame */
function onTimeUpdate() {
	if (dragging.value) {
		return
	}
	frame.value = timeToFrame(video.value.currentTime, fps.value)
	const wrap = wrapFrom(frame.value, fpsValue(fps.value))
	if (wrap !== null) {
		seekTo(wrap)
	}
}

/**
 * Seeks to the middle of a Frame, so the browser shows that Frame and not
 * the one before it.
 *
 * @param {number} target - Frame index
 */
function seekTo(target) {
	const clamped = Math.max(0, durationFrames.value ? Math.min(target, lastFrame.value) : target)
	if (video.value) {
		video.value.currentTime = frameToTime(clamped, fps.value)
	}
	frame.value = clamped
	emit('seeked')
}

/**
 * @param {number} by - Frames to move; negative moves back
 */
function step(by) {
	pause()
	seekTo(frame.value + by * stepOf(props.clock))
}

/** Plays forward at the chosen speed */
function play() {
	stopReverse()
	if (!video.value) {
		return
	}
	video.value.playbackRate = Math.abs(speed.value) || 1
	video.value.play().catch(() => {
		playing.value = false
	})
}

/** Stops, and drops any shuttle speed */
function pause() {
	stopReverse()
	video.value?.pause()
	playing.value = false
	// timeupdate comes only a few times a second, so the Frame on screen is read now: C and typing pin it
	if (video.value) {
		frame.value = timeToFrame(video.value.currentTime, fps.value)
	}
	if (Math.abs(speed.value) > 2 || speed.value < 0) {
		speed.value = 1
	}
}

/**
 * Shift+arrows and the skip buttons; the playback state stays, as when seeking
 *
 * @param {number} direction - -1 back, 1 forward
 */
function skip(direction) {
	seekTo(frameNow() + skipFrames(direction * SKIP_SECONDS, fpsValue(fps.value)))
}

/**
 * @return {number} the Frame playing right now: timeupdate comes only a few times a second
 */
function frameNow() {
	return video.value ? timeToFrame(video.value.currentTime, fps.value) : frame.value
}

/** Space and K */
function playPause() {
	if (playing.value) {
		pause()
	} else {
		play()
	}
}

/**
 * J and L step through 1×, 2× and 4×; J plays backwards.
 * ponytail: backwards is a seek every 100 ms; smooth reverse needs frame-by-frame decoding
 *
 * @param {number} direction - 1 forward, -1 backwards
 */
function shuttle(direction) {
	if (!video.value) {
		return
	}
	const same = Math.sign(speed.value) === direction && playing.value
	const next = same ? Math.min(Math.abs(speed.value) * 2, 4) : 1
	speed.value = next * direction
	if (direction > 0) {
		play()
		return
	}
	video.value.pause()
	stopReverse()
	playing.value = true
	reverse = setInterval(() => {
		if (frame.value <= 0) {
			pause()
			return
		}
		seekTo(frame.value - Math.max(1, Math.round(fpsValue(fps.value) / 10) * next))
	}, 100)
}

/** Ends a backwards shuttle */
function stopReverse() {
	clearInterval(reverse)
	reverse = null
}

/**
 * @param {number} rate - the playback speed picked in the bar
 */
function setSpeed(rate) {
	speed.value = rate
	if (video.value) {
		video.value.playbackRate = rate
	}
}

/**
 * @param {KeyboardEvent} event - the keystroke
 */
function onKey(event) {
	const action = actionFor(event)
	if (action === null || (action === 'comment' && !props.canComment)) {
		return
	}
	event.preventDefault()
	const actions = {
		playPause,
		stepForward: () => step(1),
		stepBack: () => step(-1),
		skipForward: () => skip(1),
		skipBack: () => skip(-1),
		shuttleForward: () => shuttle(1),
		shuttleBack: () => shuttle(-1),
		markIn,
		markOut,
		comment,
		clearRange,
	}
	actions[action]()
}

/** C, or the Comment button: the Range if one is set, else the current Frame; the picture or the sound stops, audio too */
function comment() {
	pause()
	emit('comment', range.value ?? { inFrame: frame.value, outFrame: null })
}

/**
 * A long press on the Waveform comments on that place; the sound stops there too
 *
 * @param {number} inFrame - the place pressed
 */
function commentAt(inFrame) {
	pause()
	emit('comment', { inFrame, outFrame: null })
}

/** The media element knows the length once its metadata is in */
function onLoaded() {
	durationFrames.value = timeToFrame(video.value.duration, fps.value)
	picture.value = { width: video.value.videoWidth, height: video.value.videoHeight }
	if (resumeAt !== null) {
		seekTo(resumeAt)
		resumeAt = null
	}
}

/**
 * @param {{inFrame: number}} anchor - a Comment or the Range
 * @return {number} where it starts on the timeline, in percent
 */
function leftOf(anchor) {
	return durationFrames.value ? (anchor.inFrame / durationFrames.value) * 100 : 0
}

/**
 * @param {{inFrame: number, outFrame: ?number}} anchor - a Comment or the Range
 * @return {number} how wide its Range is, in percent; the out Frame counts
 */
function widthOf(anchor) {
	if (anchor.outFrame === null || !durationFrames.value) {
		return 0
	}
	return ((anchor.outFrame - anchor.inFrame + 1) / durationFrames.value) * 100
}

/** A click right after a finger lifted was that finger's tap, handled already */
function onVideoClick() {
	if (touched.value) {
		touched.value = false
		return
	}
	playPause()
}

/** The time display: timecode, frame counter or seconds (story 22) */
const MODE_LABELS = {
	smpte: t('deliver', 'Timecode'),
	frames: t('deliver', 'Frames'),
	seconds: t('deliver', 'Seconds'),
	ms: t('deliver', 'Milliseconds'),
}

/** Where the other source is, for the quality menu */
const sources = computed(() => [
	{ proxy: false, label: t('deliver', 'Original'), resolution: props.version.resolution },
	{ proxy: true, label: t('deliver', 'Proxy'), resolution: props.version.derived?.proxy?.resolution },
])
const currentSource = computed(() => sources.value.find((each) => each.proxy === useProxy.value))

/**
 * @param {{label: string, resolution: ?number}} each - one of the sources
 * @return {string} its name in the quality menu, with its height when known
 */
function sourceLabel(each) {
	return each.resolution ? each.label + ' · ' + each.resolution + 'p' : each.label
}

/**
 * Switches between the original and the Proxy at the same Frame
 *
 * @param {boolean} wanted - whether the Proxy should play
 */
function pickSource(wanted) {
	if (wanted !== useProxy.value) {
		resumeAt = frame.value
		pause()
		useProxy.value = wanted
	}
}

const loopLabel = computed(() => outPoint.value === null ? t('deliver', 'Loop') : t('deliver', 'Loop the Range'))
</script>

<template>
	<div
		ref="root"
		class="deliver-player"
		:class="{ 'deliver-player--fullscreen': fullscreen, 'deliver-player--filling': filling, 'deliver-player--mobile': isMobile }">
		<div class="deliver-player__stage" v-on="gestures">
			<!-- Two fingers zoom the picture and its drawings together -->
			<div
				class="deliver-player__zoom"
				:style="zoom.scale > 1 ? { transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})` } : null">
				<video
					v-if="source"
					ref="video"
					class="deliver-player__video"
					:src="source"
					:muted="muted"
					:loop="loopsWhole"
					playsinline
					preload="metadata"
					@loadedmetadata="onLoaded"
					@timeupdate="onTimeUpdate"
					@seeked="live.settled()"
					@play="playing = true"
					@pause="playing = reverse !== null"
					@ended="pause"
					@error="unplayable = true"
					@click="onVideoClick">
					<track
						v-if="captionTrack"
						:key="captionTrack"
						ref="trackEl"
						kind="subtitles"
						:src="captionTrack"
						:srclang="captionLanguage"
						:label="languageName(captionLanguage, locale)"
						default>
				</video>
				<DrawingLayer
					v-if="source && !version.audioOnly"
					v-model:draft="draft"
					:pictureWidth="picture.width"
					:pictureHeight="picture.height"
					:shown="shownDrawings"
					:editing="drawing"
					:tool="tool"
					:color="color" />
			</div>
			<div
				v-if="flash"
				class="deliver-player__flash"
				:class="`deliver-player__flash--${flash.side < 0 ? 'left' : flash.side > 0 ? 'right' : 'middle'}`">
				{{ flash.text }}
			</div>
			<div v-if="watermark" class="deliver-player__watermark" :style="{ backgroundImage: watermarkTile(watermark) }" />
			<DrawToolbar
				v-if="drawing"
				v-model:tool="tool"
				v-model:color="color"
				v-model:draft="draft"
				@done="emit('update:drawing', false)" />
			<!-- Audio has no picture, so its Waveform takes the stage, zoomed and scrolling under the playhead -->
			<WaveformStage
				v-if="scrolling"
				v-model:span="span"
				:waveform="waveform"
				:fps="fps"
				:durationFrames="durationFrames"
				:frame="frame"
				:media="video"
				:playing="playing"
				:comments="comments"
				:clock="clock"
				:canComment="canComment"
				:pending="pending"
				:composing="composing"
				@seek="seekTo"
				@skip="skipTap"
				@hold="hold"
				@release="release"
				@comment="commentAt"
				@jump="emit('jump', $event)"
				@reply="emit('reply', $event)"
				@closeComposer="emit('closeComposer')">
				<template #composer>
					<slot name="composer" />
				</template>
			</WaveformStage>
			<p v-if="!source || unplayable" class="deliver-player__notice">
				<template v-if="!proxyPending">
					{{ unplayableReason }}
				</template>
				<template v-else-if="version.derived.progress !== null">
					{{ t('deliver', 'Deliver is preparing a version of this file that the browser can play: {percent} %', { percent: version.derived.progress }) }}
				</template>
				<template v-else>
					{{ t('deliver', 'Deliver is preparing a version of this file that the browser can play.') }}
				</template>
			</p>
		</div>

		<!-- The bar, thicker on hover to follow thumbnails, with the Waveform behind it and the Comments on it -->
		<div
			ref="scrubber"
			class="deliver-player__scrubber"
			:class="{ 'deliver-player__scrubber--pointed': pointed }"
			@pointerenter="pointed = $event.pointerType === 'mouse'"
			@pointerleave="pointed = false"
			@mouseleave="leaveScrubber">
			<video
				v-if="scrubSource"
				ref="scrubVideo"
				class="deliver-player__scrub-video"
				:src="scrubSource"
				muted
				playsinline
				preload="metadata"
				aria-hidden="true"
				@loadedmetadata="onScrubLoaded"
				@seeked="onScrubSeeked"
				@error="onScrubError" />
			<div
				class="deliver-player__timeline"
				@pointerdown="onDragStart"
				@pointermove="onPointerMove"
				@pointerup="onDragEnd"
				@pointercancel="onDragEnd"
				@click="keepTouch">
				<svg
					v-if="peaks.length && !version.audioOnly"
					class="deliver-player__waveform"
					viewBox="0 0 100 100"
					preserveAspectRatio="none"
					aria-hidden="true">
					<polygon :points="waveformPoints" />
				</svg>
				<!-- The part of the piece on the scrolling Waveform: a band the bar's height, wide enough to see beside the playhead's knob -->
				<div
					v-if="shownWindow"
					class="deliver-player__window"
					:style="{ left: shownWindow.left + shownWindow.width / 2 + '%', width: `max(24px, ${shownWindow.width}%)` }" />
				<div class="deliver-player__track">
					<div class="deliver-player__progress" :style="{ width: progress + '%' }" />
					<div
						v-if="range"
						class="deliver-player__range"
						:style="{ left: leftOf(range) + '%', width: widthOf(range) + '%' }" />
					<div
						v-for="each in comments.filter((c) => c.outFrame !== null)"
						:key="'r' + each.id"
						class="deliver-player__span"
						:style="{ left: leftOf(each) + '%', width: widthOf(each) + '%' }" />
				</div>
				<!-- A circle per Comment, centred on its Frame, as on the Waveform; close ones are one with their count.
					A tap or Enter opens its card; a press that moves drags as anywhere on the bar. A pointer goes to the bar -->
				<div class="deliver-player__circles">
					<button
						v-for="mark in marks"
						:key="(mark.comment ?? mark.cluster[0]).id"
						type="button"
						class="deliver-player__circle"
						:class="{ 'deliver-player__circle--resolved': mark.pale, 'deliver-player__circle--ringed': mark.ringed }"
						:style="{ left: mark.x + 'px', '--deliver-circle-fill': mark.fill, '--deliver-circle-line': mark.line }"
						:aria-label="markName(mark)"
						@click="$event.detail === 0 && openMark(mark, $event.currentTarget)">
						{{ mark.text }}
					</button>
				</div>
				<!-- Over the circles; while a finger drags, the playhead follows it, in the zoomed section only there -->
				<div class="deliver-player__playhead" :style="{ left: dragging && hover && !loupe ? hover.left + 'px' : progress + '%' }" />
				<!-- A finger held on the bar zooms into it: this section, above the bar and across it, which the finger then seeks through -->
				<div v-if="loupe" class="deliver-player__loupe" aria-hidden="true">
					<div class="deliver-player__loupe-bar">
						<div class="deliver-player__loupe-track">
							<div class="deliver-player__progress" :style="{ width: loupeAt + '%' }" />
							<div
								v-for="part in loupeParts"
								:key="part.key"
								:class="part.kind"
								:style="{ left: part.at.left + '%', width: part.at.width + '%' }" />
						</div>
						<span
							v-for="mark in loupeMarks"
							:key="(mark.comment ?? mark.cluster[0]).id"
							class="deliver-player__circle"
							:class="{ 'deliver-player__circle--resolved': mark.pale, 'deliver-player__circle--ringed': mark.ringed }"
							:style="{ left: mark.x + 'px', '--deliver-circle-fill': mark.fill, '--deliver-circle-line': mark.line }">
							{{ mark.text }}
						</span>
						<div class="deliver-player__playhead" :style="{ left: loupeAt + '%' }" />
					</div>
					<!-- As far as the finger reaches either way -->
					<div class="deliver-player__loupe-ends">
						<span>{{ formatAt(loupeFrame(loupe, 0, lastFrame), clock) }}</span>
						<span>{{ formatAt(loupeFrame(loupe, 1, lastFrame), clock) }}</span>
					</div>
				</div>
				<div
					v-show="hover"
					class="deliver-player__hover"
					:class="{ 'deliver-player__hover--loupe': loupe }"
					:style="{ left: (hover?.left ?? 0) + 'px' }">
					<canvas
						v-show="scrubDrawn"
						ref="scrubCanvas"
						class="deliver-player__tile"
						:width="scrubSize.width"
						:height="scrubSize.height" />
					<div v-if="hover?.tile && !scrubDrawn" class="deliver-player__tile" :style="hover.tile" />
					<span v-if="hover" class="deliver-player__hover-time">{{ formatAt(hover.frame, clock) }}</span>
				</div>
			</div>
		</div>

		<!-- A circle's card on the bar, as on the Waveform (#273) -->
		<CommentCard
			v-if="barOpened"
			:comment="barOpened"
			:siblings="barCard.siblings"
			:clock="clock"
			:at="barCard.at"
			@close="barCard = null"
			@show="showOnBar"
			@jump="barCard = null; emit('jump', $event)"
			@reply="barCard = null; emit('reply', $event)" />

		<!-- A phone: one row, Play and the time on the left; skipping, Frame steps and the settings in one menu -->
		<div v-if="isMobile" class="deliver-player__controls">
			<div class="deliver-player__group">
				<NcButton
					variant="tertiary"
					:disabled="!source"
					:aria-label="playing ? t('deliver', 'Pause') : t('deliver', 'Play')"
					@click="playPause">
					<template #icon>
						<NcIconSvgWrapper :svg="playing ? pauseIcon : playIcon" />
					</template>
				</NcButton>
				<span class="deliver-player__time">{{ position }}<span class="deliver-player__duration"> / {{ duration }}</span></span>
			</div>

			<div class="deliver-player__group deliver-player__group--end">
				<NcButton
					variant="tertiary"
					:aria-label="muted ? t('deliver', 'Sound on') : t('deliver', 'Mute')"
					@click="muted = !muted">
					<template #icon>
						<NcIconSvgWrapper :svg="muted ? mutedIcon : volumeIcon" />
					</template>
				</NcButton>
				<!-- In the browser's own fullscreen only what is inside the player shows -->
				<NcActions variant="tertiary" :container="fullscreen && !filling ? root : 'body'" :aria-label="t('deliver', 'Playback settings')">
					<template #icon>
						<NcIconSvgWrapper :svg="moreIcon" />
					</template>
					<!-- The menu stays open: one steps several times -->
					<NcActionButton :disabled="!source" @click="skip(-1)">
						<template #icon>
							<NcIconSvgWrapper :svg="skipBackIcon" />
						</template>
						{{ t('deliver', 'Back 10 seconds') }}
					</NcActionButton>
					<NcActionButton :disabled="!source" @click="skip(1)">
						<template #icon>
							<NcIconSvgWrapper :svg="skipForwardIcon" />
						</template>
						{{ t('deliver', 'Forward 10 seconds') }}
					</NcActionButton>
					<NcActionButton :disabled="!source" @click="step(-1)">
						<template #icon>
							<NcIconSvgWrapper :svg="stepBackIcon" />
						</template>
						{{ t('deliver', 'One Frame back') }}
					</NcActionButton>
					<NcActionButton :disabled="!source" @click="step(1)">
						<template #icon>
							<NcIconSvgWrapper :svg="stepForwardIcon" />
						</template>
						{{ t('deliver', 'One Frame forward') }}
					</NcActionButton>
					<NcActionSeparator />
					<NcActionButton :modelValue="loop" type="checkbox" @click="loop = !loop">
						{{ loopLabel }}
					</NcActionButton>
					<NcActionSeparator />
					<NcActionButton
						v-for="rate in SPEEDS"
						:key="rate"
						:modelValue="Math.abs(speed) === rate"
						type="radio"
						closeAfterClick
						@click="setSpeed(rate)">
						{{ t('deliver', 'Speed {rate}×', { rate }) }}
					</NcActionButton>
					<template v-if="original && proxy">
						<NcActionSeparator />
						<NcActionButton
							v-for="each in sources"
							:key="each.label"
							:modelValue="useProxy === each.proxy"
							type="radio"
							closeAfterClick
							@click="pickSource(each.proxy)">
							{{ sourceLabel(each) }}
						</NcActionButton>
					</template>
					<template v-if="captions.length">
						<NcActionSeparator />
						<NcActionButton
							:modelValue="captionLanguage === null"
							type="radio"
							closeAfterClick
							@click="captionLanguage = null">
							{{ t('deliver', 'Captions off') }}
						</NcActionButton>
						<NcActionButton
							v-for="each in captions"
							:key="each.language"
							:modelValue="captionLanguage === each.language"
							type="radio"
							closeAfterClick
							@click="captionLanguage = each.language">
							{{ t('deliver', 'Captions: {language}', { language: languageName(each.language, locale) }) }}
						</NcActionButton>
					</template>
					<NcActionSeparator />
					<NcActionButton
						v-for="each in modesFor(clock)"
						:key="each"
						:modelValue="clock.mode === each"
						type="radio"
						closeAfterClick
						@click="emit('update:mode', each)">
						{{ MODE_LABELS[each] }}
					</NcActionButton>
				</NcActions>
				<NcButton
					variant="tertiary"
					:aria-label="fullscreen ? t('deliver', 'Leave fullscreen') : t('deliver', 'Fullscreen')"
					@click="toggleFullscreen">
					<template #icon>
						<NcIconSvgWrapper :svg="fullscreen ? fullscreenExitIcon : fullscreenIcon" />
					</template>
				</NcButton>
			</div>
		</div>

		<div v-else class="deliver-player__controls">
			<div class="deliver-player__group">
				<NcButton
					variant="tertiary"
					:disabled="!source"
					:aria-label="t('deliver', 'Back 10 seconds (Shift+←)')"
					:title="t('deliver', 'Back 10 seconds (Shift+←)')"
					@click="skip(-1)">
					<template #icon>
						<NcIconSvgWrapper :svg="skipBackIcon" />
					</template>
				</NcButton>
				<NcButton
					variant="tertiary"
					:disabled="!source"
					:aria-label="playing ? t('deliver', 'Pause (Space)') : t('deliver', 'Play (Space)')"
					:title="playing ? t('deliver', 'Pause (Space)') : t('deliver', 'Play (Space)')"
					@click="playPause">
					<template #icon>
						<NcIconSvgWrapper :svg="playing ? pauseIcon : playIcon" />
					</template>
				</NcButton>
				<NcButton
					variant="tertiary"
					:disabled="!source"
					:aria-label="t('deliver', 'Forward 10 seconds (Shift+→)')"
					:title="t('deliver', 'Forward 10 seconds (Shift+→)')"
					@click="skip(1)">
					<template #icon>
						<NcIconSvgWrapper :svg="skipForwardIcon" />
					</template>
				</NcButton>
				<NcButton
					variant="tertiary"
					:pressed="loop"
					:aria-label="loopLabel"
					:title="loopLabel"
					@click="loop = !loop">
					<template #icon>
						<NcIconSvgWrapper :svg="loopIcon" />
					</template>
				</NcButton>
				<NcButton
					variant="tertiary"
					class="deliver-player__speed"
					:aria-label="t('deliver', 'Playback speed')"
					:title="t('deliver', 'Playback speed')"
					@click="setSpeed(SPEEDS[(SPEEDS.indexOf(Math.abs(speed)) + 1) % SPEEDS.length])">
					{{ Math.abs(speed) }}×
				</NcButton>
				<NcButton
					variant="tertiary"
					:aria-label="muted ? t('deliver', 'Sound on') : t('deliver', 'Mute')"
					:title="muted ? t('deliver', 'Sound on') : t('deliver', 'Mute')"
					@click="muted = !muted">
					<template #icon>
						<NcIconSvgWrapper :svg="muted ? mutedIcon : volumeIcon" />
					</template>
				</NcButton>
			</div>

			<div class="deliver-player__group deliver-player__group--center">
				<div class="deliver-player__timecode" :title="t('deliver', 'Position of {duration}', { duration })">
					<span>{{ position }}</span>
					<NcActions variant="tertiary" :aria-label="t('deliver', 'Time display')">
						<template #icon>
							<NcIconSvgWrapper :svg="caretIcon" :size="18" />
						</template>
						<NcActionButton
							v-for="each in modesFor(clock)"
							:key="each"
							:modelValue="clock.mode === each"
							type="radio"
							closeAfterClick
							@click="emit('update:mode', each)">
							{{ MODE_LABELS[each] }}
						</NcActionButton>
					</NcActions>
				</div>
			</div>

			<div class="deliver-player__group deliver-player__group--end">
				<div v-if="range" class="deliver-player__chip">
					<span>{{ formatAt(range.inFrame, clock) }} – {{ range.outFrame === null ? '…' : formatAt(range.outFrame, clock) }}</span>
					<button
						type="button"
						:aria-label="t('deliver', 'Clear the Range (Esc)')"
						:title="t('deliver', 'Clear the Range (Esc)')"
						@click="clearRange">
						<NcIconSvgWrapper :svg="closeIcon" :size="16" inline />
					</button>
				</div>
				<NcActions
					v-if="captions.length"
					variant="tertiary"
					:pressed="captionLanguage !== null"
					:aria-label="t('deliver', 'Captions')"
					:title="t('deliver', 'Captions')">
					<template #icon>
						<NcIconSvgWrapper :svg="captionLanguage ? captionsIcon : captionsOffIcon" />
					</template>
					<NcActionButton
						:modelValue="captionLanguage === null"
						type="radio"
						closeAfterClick
						@click="captionLanguage = null">
						{{ t('deliver', 'Off') }}
					</NcActionButton>
					<NcActionButton
						v-for="each in captions"
						:key="each.language"
						:modelValue="captionLanguage === each.language"
						type="radio"
						closeAfterClick
						@click="captionLanguage = each.language">
						{{ languageName(each.language, locale) }}
					</NcActionButton>
				</NcActions>
				<NcActions
					v-if="original && proxy"
					variant="tertiary"
					class="deliver-player__quality deliver-caret-after"
					:menuName="currentSource.resolution ? currentSource.resolution + 'p' : currentSource.label"
					:aria-label="t('deliver', 'Quality')">
					<template #icon>
						<NcIconSvgWrapper :svg="menuIcon" :size="18" />
					</template>
					<NcActionButton
						v-for="each in sources"
						:key="each.label"
						:modelValue="useProxy === each.proxy"
						type="radio"
						closeAfterClick
						@click="pickSource(each.proxy)">
						{{ sourceLabel(each) }}
					</NcActionButton>
				</NcActions>
				<NcButton
					variant="tertiary"
					:aria-label="fullscreen ? t('deliver', 'Leave fullscreen') : t('deliver', 'Fullscreen')"
					:title="fullscreen ? t('deliver', 'Leave fullscreen') : t('deliver', 'Fullscreen')"
					@click="toggleFullscreen">
					<template #icon>
						<NcIconSvgWrapper :svg="fullscreen ? fullscreenExitIcon : fullscreenIcon" />
					</template>
				</NcButton>
			</div>
		</div>
	</div>
</template>

<style scoped>
.deliver-player {
	display: flex;
	flex-direction: column;
	height: 100%;
	/* The bar asks how wide the player is, not the window: beside a list it is narrower */
	container: deliver-player / inline-size;
	background: var(--color-main-background);
	/* Holding a finger down plays faster; it must not select text or open the callout */
	user-select: none;
	-webkit-user-select: none;
	-webkit-touch-callout: none;
}

/* The picture on black, as large as the room allows, in its own shape */
.deliver-player__stage {
	position: relative;
	flex: 1;
	min-height: 160px;
	overflow: hidden;
	background: #000;
	/* Fingers are the player's: no page scrolling or browser zoom on the picture */
	touch-action: none;
}

/* What a double tap or a hold did, for a moment */
.deliver-player__flash {
	position: absolute;
	top: 50%;
	z-index: 2;
	padding: 6px 14px;
	border-radius: var(--border-radius-pill);
	background: rgba(0, 0, 0, 0.6);
	color: #fff;
	font-size: 15px;
	font-weight: bold;
	transform: translate(-50%, -50%);
	pointer-events: none;
}

.deliver-player__flash--left {
	left: 20%;
}

.deliver-player__flash--middle {
	left: 50%;
}

.deliver-player__flash--right {
	left: 80%;
}

.deliver-player__zoom {
	position: absolute;
	inset: 0;
	transform-origin: center;
}

.deliver-player__video {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	object-fit: contain;
	cursor: pointer;
}

/* Over the picture and the drawings, under the tools; the pointer goes through */
.deliver-player__watermark {
	position: absolute;
	inset: 0;
	pointer-events: none;
}

.deliver-player__notice {
	position: absolute;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	margin: 0;
	padding: calc(4 * var(--default-grid-baseline));
	text-align: center;
	color: var(--color-text-maxcontrast);
}

/* A thin line across the whole width; on hover it grows, to follow thumbnails. Inset so circles at either end stay whole */
.deliver-player__scrubber {
	position: relative;
	margin-inline: 12px;
}

.deliver-player__timeline {
	position: relative;
	height: 16px;
	cursor: pointer;
	/* A finger drags along the bar instead of scrolling the page */
	touch-action: none;
}

/* The half of a circle at either end that stands beyond the bar; no higher than the circle, or it takes touches from the buttons */
.deliver-player__timeline::before {
	content: '';
	position: absolute;
	inset: max(0px, 50% - 10px) -10px;
}

/* On a phone the bar is taller for a finger, and the playhead has a knob to take hold of */
.deliver-player--mobile .deliver-player__timeline {
	height: 32px;
}

.deliver-player--mobile .deliver-player__track {
	top: 13px;
	height: 6px;
}

.deliver-player--mobile .deliver-player__playhead::after {
	content: '';
	position: absolute;
	top: 50%;
	left: 50%;
	width: 14px;
	height: 14px;
	border-radius: 50%;
	background: #fff;
	box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
	transform: translate(-50%, -50%);
}

.deliver-player__track {
	position: absolute;
	inset-inline: 0;
	top: 6px;
	height: 4px;
	background: rgba(255, 255, 255, 0.14);
	transition: height 0.12s, top 0.12s;
}

.deliver-player__scrubber--pointed .deliver-player__track {
	top: 2px;
	height: 12px;
}

/* In the middle of the taller bar, where its knob is */
.deliver-player--mobile .deliver-player__scrubber--pointed .deliver-player__track {
	top: 10px;
	height: 12px;
}

/* Where the player stands: a white line over the circles, edged dark to stand out from them */
.deliver-player__playhead {
	position: absolute;
	top: 0;
	bottom: 0;
	width: 2px;
	margin-inline-start: -1px;
	border-radius: 1px;
	background: #fff;
	box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
	pointer-events: none;
}

/* The Waveform, faint, behind the bar */
.deliver-player__waveform {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	pointer-events: none;
}

.deliver-player__waveform polygon {
	fill: rgba(255, 255, 255, 0.16);
}

.deliver-player__progress {
	height: 100%;
	background: var(--color-primary-element);
}

.deliver-player__range,
.deliver-player__span {
	position: absolute;
	inset-block: 0;
}

.deliver-player__range {
	background: rgba(255, 255, 255, 0.55);
}

/* The part of the piece the scrolling Waveform shows, bracketed */
.deliver-player__window {
	position: absolute;
	inset-block: 1px;
	border: 2px solid rgba(255, 255, 255, 0.75);
	border-radius: var(--border-radius);
	background: rgba(255, 255, 255, 0.12);
	transform: translateX(-50%);
	pointer-events: none;
}

.deliver-player__span {
	background: rgba(255, 196, 0, 0.45);
}

.deliver-player__hover {
	position: absolute;
	bottom: calc(100% + 6px);
	transform: translateX(-50%);
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 2px;
	pointer-events: none;
	z-index: 1;
}

/* The zoomed section a held finger opens: over the picture, as wide as the bar, so a finger at either end reaches the section's */
.deliver-player__loupe {
	position: absolute;
	bottom: calc(100% + 8px);
	inset-inline: -10px;
	z-index: 1;
	box-sizing: border-box;
	height: 46px;
	padding: 4px 10px;
	border-radius: var(--border-radius-large);
	/* Opaque: the Waveform's circles under it would read as its own */
	background: #000;
	box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.25);
	pointer-events: none;
}

.deliver-player__loupe-bar {
	position: relative;
	height: 22px;
}

.deliver-player__loupe-track {
	position: absolute;
	inset-inline: 0;
	top: 8px;
	height: 6px;
	background: rgba(255, 255, 255, 0.22);
}

.deliver-player__loupe-ends {
	display: flex;
	justify-content: space-between;
	color: #fff;
	font-family: monospace;
	font-size: 11px;
	line-height: 14px;
}

/* The Frame over the finger stands above the section */
.deliver-player__hover--loupe {
	bottom: calc(100% + 60px);
}

.deliver-player__scrub-video {
	position: absolute;
	width: 1px;
	height: 1px;
	opacity: 0;
	pointer-events: none;
}

.deliver-player__tile {
	border: 2px solid #fff;
	border-radius: var(--border-radius);
	background-color: #000;
}

.deliver-player__hover-time {
	padding: 1px 6px;
	border-radius: var(--border-radius);
	background: rgba(0, 0, 0, 0.85);
	color: #fff;
	font-family: monospace;
	font-size: 12px;
}

/*
 * A circle as the Waveform draws it (circleLook, drawCircles), but the bar shows through. 20 px: it stands only 2 px over a
 * desktop's bar, short of the buttons below and the picture's captions; two are 24 px apart at least. Buttons for the keyboard
 * only, and the resets keep Nextcloud's button style away: a pointer goes to the bar, which finds the circle by its place
 * (circleUnder), as a target of its own beside the bar would take a finger's touch from the bar and give it to the picture.
 */
.deliver-player__circles {
	position: absolute;
	inset: 0;
	pointer-events: none;
}

.deliver-player__circle {
	--deliver-circle-back: rgba(0, 0, 0, 0.55);
	position: absolute;
	top: 50%;
	display: flex;
	/* The initials' baseline is that of the strut before them */
	align-items: baseline;
	justify-content: center;
	box-sizing: border-box;
	width: 20px;
	height: 20px;
	min-height: 0;
	padding: 0;
	border: 2px solid var(--deliver-circle-line);
	border-radius: 50%;
	background: linear-gradient(var(--deliver-circle-fill) 0 0) var(--deliver-circle-back);
	color: #fff;
	font: bold 9px/0 sans-serif;
	text-shadow: 0 0 2px #000;
	transform: translate(-50%, -50%);
}

/* Nextcloud gives a button a margin by a rule that outweighs a class */
.deliver-player__circles > .deliver-player__circle {
	margin: 0;
}

.deliver-player__circle:focus-visible {
	outline: 2px solid #fff;
	outline-offset: 1px;
}

/* Half of the room inside the ring and half a capital's height: the capitals stand in the middle, whatever the font */
.deliver-player__circle::before {
	content: '';
	height: calc(8px + 0.5cap);
}

.deliver-player__circle--resolved {
	opacity: 0.45;
}

.deliver-player__circle--ringed {
	--deliver-circle-back: #000;
	opacity: 1;
}

.deliver-player__controls {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
	align-items: center;
	gap: calc(2 * var(--default-grid-baseline));
	padding: var(--default-grid-baseline) calc(2 * var(--default-grid-baseline));
}

/* Whatever one side needs it gets; the time sits in the middle where there is room */
.deliver-player__controls {
	grid-template-columns: minmax(max-content, 1fr) auto minmax(0, 1fr);
}

.deliver-player--mobile .deliver-player__controls {
	display: flex;
	justify-content: space-between;
}

/* Beside Play; smaller type on a phone held upright, so that a timecode and its length fit */
.deliver-player__time {
	font-family: monospace;
	font-size: 15px;
	white-space: nowrap;
}

.deliver-player__duration {
	color: var(--color-text-maxcontrast);
}

@container deliver-player (max-width: 430px) {
	.deliver-player__time {
		font-size: 13px;
	}
}

@container deliver-player (max-width: 370px) {
	.deliver-player__time {
		font-size: 12px;
	}
}

/* The narrowest have room for where the player stands only */
@container deliver-player (max-width: 345px) {
	.deliver-player__duration {
		display: none;
	}
}

.deliver-player__group {
	display: flex;
	align-items: center;
	gap: 2px;
	min-width: 0;
}

.deliver-player__group--end {
	justify-content: flex-end;
}

.deliver-player__timecode {
	display: flex;
	align-items: center;
	padding-inline-start: calc(3 * var(--default-grid-baseline));
	border-radius: var(--border-radius-element);
	background: var(--color-background-dark);
	font-family: monospace;
	font-size: 16px;
	letter-spacing: 0.04em;
}

.deliver-player__chip {
	display: flex;
	align-items: center;
	gap: 2px;
	padding: 2px 4px 2px 10px;
	border-radius: var(--border-radius-pill);
	background: var(--color-primary-element-light);
	font-family: monospace;
	font-size: 13px;
}

.deliver-player__chip button {
	display: flex;
	min-height: 0;
	margin: 0;
	padding: 2px;
	border: none;
	border-radius: 50%;
	background: none;
	color: inherit;
	cursor: pointer;
}

.deliver-player__speed {
	font-weight: normal;
	font-variant-numeric: tabular-nums;
}

/* The quality reads as an outlined select, its arrow after the text */
.deliver-player__quality :deep(.button-vue) {
	border: 1px solid var(--color-border-dark);
	font-weight: normal;
}

.deliver-player--fullscreen {
	background: #000;
}

/* Fullscreen without the browser's help: the player covers the window */
.deliver-player--filling {
	position: fixed;
	inset: 0;
	padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
	z-index: 10000;
}
</style>
