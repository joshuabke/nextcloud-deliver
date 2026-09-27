<script setup>
import menuIcon from '@mdi/svg/svg/chevron-down.svg?raw'
import caretIcon from '@mdi/svg/svg/chevron-up.svg?raw'
import closeIcon from '@mdi/svg/svg/close.svg?raw'
import fullscreenExitIcon from '@mdi/svg/svg/fullscreen-exit.svg?raw'
import fullscreenIcon from '@mdi/svg/svg/fullscreen.svg?raw'
import pauseIcon from '@mdi/svg/svg/pause.svg?raw'
import playIcon from '@mdi/svg/svg/play.svg?raw'
import loopIcon from '@mdi/svg/svg/repeat.svg?raw'
import volumeIcon from '@mdi/svg/svg/volume-high.svg?raw'
import mutedIcon from '@mdi/svg/svg/volume-off.svg?raw'
import { t } from '@nextcloud/l10n'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcAvatar from '@nextcloud/vue/components/NcAvatar'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDateTime from '@nextcloud/vue/components/NcDateTime'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import DrawingLayer from './DrawingLayer.vue'
import DrawToolbar from './DrawToolbar.vue'
import { COLORS, drawingsAt } from '../lib/drawing.js'
import { actionFor } from '../lib/hotkeys.js'
import { formatAt, fpsValue, frameToTime, MODES, timeToFrame } from '../lib/timecode.js'
import { watermarkTile } from '../lib/watermark.js'

/** The drawing being made for the next Comment */
const draft = defineModel('draft', { type: Array, default: () => [] })

const props = defineProps({
	/** The Version to play, with its URLs and frame rate */
	version: { type: Object, required: true },
	/** The Comments, for the marker strip */
	comments: { type: Array, default: () => [] },
	/** How time is shown: { fps, mode, startFrame, dropFrame } */
	clock: { type: Object, required: true },
	canComment: { type: Boolean, default: false },
	/** Text shown across the picture on a Share Link that asks for it (story 94) */
	watermark: { type: String, default: null },
	/** Whether the pointer draws on the picture (story 89) */
	drawing: { type: Boolean, default: false },
})

const emit = defineEmits(['comment', 'jump', 'update:mode', 'update:drawing'])

const SPEEDS = [0.25, 0.5, 1, 1.5, 2]

const root = ref(null)
const video = ref(null)
const muted = ref(false)
const fullscreen = ref(false)
const frame = ref(0)
const durationFrames = ref(0)
const playing = ref(false)
/** Playback rate; negative while J walks backwards */
const speed = ref(1)
const inPoint = ref(null)
const outPoint = ref(null)
const loop = ref(false)
/** Set when the browser could not play the source */
const unplayable = ref(false)
/** Steps backwards while J is held, because media elements refuse a negative rate */
let reverse = null

const fps = computed(() => props.version.fps)
/** The original, where the browser can play it and the share hands it out */
const original = computed(() => props.version.playable === false ? null : props.version.url)
const proxy = computed(() => props.version.derived?.proxy?.url ?? null)
/** The original by default; the Proxy is the lighter choice next to it, or the only one (ADR 0003) */
const useProxy = ref(false)
const source = computed(() => (useProxy.value ? proxy.value : original.value) ?? proxy.value ?? original.value)
/** Where to go once the other source has loaded, so switching keeps the Frame */
let resumeAt = null
const proxyPending = computed(() => ['queued', 'running'].includes(props.version.derived?.proxy?.state))
const lastFrame = computed(() => Math.max(0, durationFrames.value - 1))

/** The Thumbnail Strip, once its index is loaded */
const strip = ref(null)
/** The Waveform, one value per slice of the timeline */
const peaks = ref([])
const hover = ref(null)
const scrubber = ref(null)
/** The Comment whose card shows over the bar, and where */
const peek = ref(null)
/** Comment id → its place in the order Comments were written, as the panel numbers them */
const numbers = computed(() => new Map([...props.comments]
	.sort((a, b) => a.createdAt - b.createdAt || a.id - b.id)
	.map((comment, index) => [comment.id, index + 1])))

/** Half the card's width, to keep it inside the player */
const PEEK_HALF = 160

/**
 * @param {object} comment - the Comment under the pointer
 * @param {Event} event - hovering or focusing its avatar
 */
function showPeek(comment, event) {
	const box = scrubber.value.getBoundingClientRect()
	const marker = event.currentTarget.getBoundingClientRect()
	const centre = marker.left + marker.width / 2 - box.left
	peek.value = { comment, left: Math.min(box.width - PEEK_HALF - 4, Math.max(PEEK_HALF + 4, centre)) }
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
const duration = computed(() => formatAt(durationFrames.value, props.clock))
const range = computed(() => inPoint.value === null ? null : { inFrame: inPoint.value, outFrame: outPoint.value })
const progress = computed(() => durationFrames.value ? (frame.value / durationFrames.value) * 100 : 0)

defineExpose({ seekTo, frame, pause })

watch(() => props.version.id, async (id) => {
	pause()
	useProxy.value = false
	resumeAt = null
	frame.value = 0
	// The server knows the length already; the media element confirms it once it loads
	durationFrames.value = props.version.durationFrames ?? 0
	inPoint.value = null
	outPoint.value = null
	loop.value = false
	unplayable.value = false
	strip.value = null
	peaks.value = []
	hover.value = null
	const [loadedStrip, loadedPeaks] = await Promise.all([loadStrip(), loadWaveform()])
	// A later Version may have been opened in the meantime
	if (props.version.id === id) {
		strip.value = loadedStrip
		peaks.value = loadedPeaks
	}
}, { immediate: true })

watch(source, () => {
	unplayable.value = false
})

/** Switches between the original and the Proxy at the same Frame */
function toggleSource() {
	resumeAt = frame.value
	pause()
	useProxy.value = !useProxy.value
}

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
 * @return {Promise<number[]>} the Waveform, or nothing when there is none
 */
async function loadWaveform() {
	const waveform = props.version.derived?.waveform
	if (waveform?.state !== 'ready') {
		return []
	}
	try {
		return (await (await fetch(waveform.url)).json()).peaks ?? []
	} catch {
		return []
	}
}

/**
 * @param {MouseEvent} event - a click or a move on the timeline
 * @return {number} the Frame under the pointer
 */
function frameAt(event) {
	const box = event.currentTarget.getBoundingClientRect()
	const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
	return Math.min(lastFrame.value, Math.floor(ratio * durationFrames.value))
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
 * video, the lighter Proxy where there is one, seeks there and is copied
 * into a canvas. One seek at a time; the pointer's latest Frame goes next.
 * Until the first copy, the Thumbnail Strip's nearest picture stands in.
 */
const scrubVideo = ref(null)
const scrubCanvas = ref(null)
const scrubSource = computed(() => props.version.audioOnly ? null : (proxy.value ?? source.value))
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

/** The hidden video stands on the Frame: copy it and go on to the next */
function onScrubSeeked() {
	scrubCanvas.value?.getContext('2d')?.drawImage(scrubVideo.value, 0, 0, scrubSize.value.width, scrubSize.value.height)
	scrubDrawn.value = true
	nextScrub()
}

/** The pointer left the bar */
function leaveScrubber() {
	hover.value = null
	peek.value = null
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
	const top = peaks.value.map((peak, i) => `${(i * step).toFixed(3)},${(50 - height(peak)).toFixed(2)}`)
	const bottom = peaks.value.map((peak, i) => `${(i * step).toFixed(3)},${(50 + height(peak)).toFixed(2)}`).reverse()
	return [...top, ...bottom].join(' ')
})

/** Follows the browser's own fullscreen state, which Escape also leaves */
function onFullscreenChange() {
	fullscreen.value = document.fullscreenElement === root.value
}

/** The whole player goes fullscreen, controls and timeline included */
function toggleFullscreen() {
	if (fullscreen.value) {
		document.exitFullscreen()
	} else {
		root.value?.requestFullscreen()
	}
}

onMounted(() => {
	window.addEventListener('keydown', onKey)
	document.addEventListener('fullscreenchange', onFullscreenChange)
})
onBeforeUnmount(() => {
	window.removeEventListener('keydown', onKey)
	document.removeEventListener('fullscreenchange', onFullscreenChange)
	stopReverse()
})

/** Follows the media element, and sends a looped Range back to its in Frame */
function onTimeUpdate() {
	frame.value = timeToFrame(video.value.currentTime, fps.value)
	if (loop.value && outPoint.value !== null && frame.value > outPoint.value) {
		seekTo(inPoint.value ?? 0)
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
}

/**
 * @param {number} by - Frames to move; negative moves back
 */
function step(by) {
	pause()
	seekTo(frame.value + by)
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
	if (Math.abs(speed.value) > 2 || speed.value < 0) {
		speed.value = 1
	}
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
		shuttleForward: () => shuttle(1),
		shuttleBack: () => shuttle(-1),
		markIn: () => {
			inPoint.value = frame.value
			if (outPoint.value !== null && outPoint.value < frame.value) {
				outPoint.value = null
			}
		},
		markOut: () => {
			outPoint.value = Math.max(frame.value, inPoint.value ?? 0)
			inPoint.value ??= frame.value
		},
		comment,
		clearRange: () => {
			inPoint.value = null
			outPoint.value = null
			loop.value = false
		},
	}
	actions[action]()
}

/** C, or the Comment button: the Range if one is set, else the current Frame */
function comment() {
	pause()
	emit('comment', range.value ?? { inFrame: frame.value, outFrame: null })
}

/**
 * @param {MouseEvent} event - click on the timeline
 */
function scrub(event) {
	pause()
	seekTo(frameAt(event))
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

/** The time display: timecode, frame counter or seconds (story 22) */
const MODE_LABELS = {
	smpte: t('deliver', 'Timecode'),
	frames: t('deliver', 'Frames'),
	seconds: t('deliver', 'Seconds'),
}

/** Where the other source is, for the quality menu */
const sources = computed(() => [
	{ proxy: false, label: t('deliver', 'Original'), resolution: props.version.resolution },
	{ proxy: true, label: t('deliver', 'Proxy'), resolution: props.version.derived?.proxy?.resolution },
])

/**
 * @param {boolean} wanted - whether the Proxy should play
 */
function pickSource(wanted) {
	if (wanted !== useProxy.value) {
		toggleSource()
	}
}

/** Loops the Range when one is set, else the whole Version */
const loopsWhole = computed(() => loop.value && outPoint.value === null)
</script>

<template>
	<div ref="root" class="deliver-player" :class="{ 'deliver-player--fullscreen': fullscreen }">
		<div class="deliver-player__stage">
			<video
				v-if="source"
				ref="video"
				class="deliver-player__video"
				:src="source"
				:muted="muted"
				:loop="loopsWhole"
				preload="metadata"
				@loadedmetadata="onLoaded"
				@timeupdate="onTimeUpdate"
				@play="playing = true"
				@pause="playing = reverse !== null"
				@ended="pause"
				@error="unplayable = true"
				@click="playPause" />
			<DrawingLayer
				v-if="source && !version.audioOnly"
				v-model:draft="draft"
				:pictureWidth="picture.width"
				:pictureHeight="picture.height"
				:shown="shownDrawings"
				:editing="drawing"
				:tool="tool"
				:color="color" />
			<div v-if="watermark" class="deliver-player__watermark" :style="{ backgroundImage: watermarkTile(watermark) }" />
			<DrawToolbar
				v-if="drawing"
				v-model:tool="tool"
				v-model:color="color"
				v-model:draft="draft"
				@done="emit('update:drawing', false)" />
			<!-- Audio has no picture, so its Waveform takes the stage -->
			<div v-if="version.audioOnly && peaks.length" class="deliver-player__sound" @click="scrub">
				<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
					<defs>
						<clipPath :id="`deliver-played-${version.id}`">
							<rect
								x="0"
								y="0"
								:width="progress"
								height="100" />
						</clipPath>
					</defs>
					<polygon class="deliver-player__sound-all" :points="waveformPoints" />
					<polygon class="deliver-player__sound-played" :points="waveformPoints" :clip-path="`url(#deliver-played-${version.id})`" />
				</svg>
				<div class="deliver-player__sound-head" :style="{ left: progress + '%' }" />
			</div>
			<p v-if="!source || unplayable" class="deliver-player__notice">
				<template v-if="!proxyPending">
					{{ t('deliver', 'This file cannot be played in this browser.') }}
				</template>
				<template v-else-if="version.derived.progress !== null">
					{{ t('deliver', 'Deliver is preparing a version of this file that the browser can play: {percent} %', { percent: version.derived.progress }) }}
				</template>
				<template v-else>
					{{ t('deliver', 'Deliver is preparing a version of this file that the browser can play.') }}
				</template>
			</p>
		</div>

		<!-- The bar, its Comments and, on hover, its Waveform and a thicker bar to follow thumbnails -->
		<div ref="scrubber" class="deliver-player__scrubber" @mouseleave="leaveScrubber">
			<video
				v-if="scrubSource"
				ref="scrubVideo"
				class="deliver-player__scrub-video"
				:src="scrubSource"
				muted
				preload="metadata"
				aria-hidden="true"
				@loadedmetadata="onScrubLoaded"
				@seeked="onScrubSeeked" />
			<div
				class="deliver-player__timeline"
				@click="scrub"
				@mousemove="onHover">
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
				<div class="deliver-player__playhead" :style="{ left: progress + '%' }" />
				<div v-show="hover" class="deliver-player__hover" :style="{ left: (hover?.left ?? 0) + 'px' }">
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

			<!-- One avatar per Comment, centred under its Frame; hovering shows the Comment -->
			<div class="deliver-player__markers">
				<svg
					v-if="peaks.length && !version.audioOnly"
					class="deliver-player__waveform"
					viewBox="0 0 100 100"
					preserveAspectRatio="none"
					aria-hidden="true">
					<polygon :points="waveformPoints" />
				</svg>
				<button
					v-for="each in comments"
					:key="each.id"
					type="button"
					class="deliver-player__marker"
					:class="{ 'deliver-player__marker--resolved': each.resolved }"
					:style="{ left: leftOf(each) + '%' }"
					:aria-label="each.author.name + ': ' + each.body"
					@mouseenter="showPeek(each, $event)"
					@mouseleave="peek = null"
					@focus="showPeek(each, $event)"
					@blur="peek = null"
					@click="seekTo(each.inFrame); emit('jump', each)">
					<NcAvatar
						:user="each.author.type === 'user' ? each.author.id : undefined"
						:displayName="each.author.name"
						:isNoUser="each.author.type !== 'user'"
						:size="20"
						hideStatus
						disableMenu
						disableTooltip />
				</button>
				<div v-if="peek" class="deliver-player__peek" :style="{ left: peek.left + 'px' }">
					<NcAvatar
						:user="peek.comment.author.type === 'user' ? peek.comment.author.id : undefined"
						:displayName="peek.comment.author.name"
						:isNoUser="peek.comment.author.type !== 'user'"
						:size="32"
						hideStatus
						disableMenu
						disableTooltip />
					<div class="deliver-player__peek-content">
						<div class="deliver-player__peek-head">
							<strong>{{ peek.comment.author.name }}</strong>
							<NcDateTime :timestamp="peek.comment.createdAt * 1000" relativeTime="short" />
							<span class="deliver-player__peek-number">#{{ numbers.get(peek.comment.id) }}</span>
						</div>
						<p>
							<span class="deliver-player__peek-time">{{ formatAt(peek.comment.inFrame, clock) }}</span>
							{{ peek.comment.body }}
						</p>
					</div>
				</div>
			</div>
		</div>

		<div class="deliver-player__controls">
			<div class="deliver-player__group">
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
					:pressed="loop"
					:aria-label="range?.outFrame != null ? t('deliver', 'Loop the Range') : t('deliver', 'Loop')"
					:title="range?.outFrame != null ? t('deliver', 'Loop the Range') : t('deliver', 'Loop')"
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
							v-for="each in MODES"
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
						@click="inPoint = null; outPoint = null; loop = false">
						<NcIconSvgWrapper :svg="closeIcon" :size="16" inline />
					</button>
				</div>
				<NcActions
					v-if="original && proxy"
					variant="tertiary"
					class="deliver-player__quality"
					:menuName="(useProxy ? version.derived.proxy.resolution : version.resolution) ? (useProxy ? version.derived.proxy.resolution : version.resolution) + 'p' : t('deliver', 'Original')"
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
						{{ each.resolution ? each.label + ' · ' + each.resolution + 'p' : each.label }}
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
	background: var(--color-main-background);
}

/* The picture on black, as large as the room allows, in its own shape */
.deliver-player__stage {
	position: relative;
	flex: 1;
	min-height: 160px;
	background: #000;
}

.deliver-player__video {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	object-fit: contain;
	cursor: pointer;
}

.deliver-player__sound {
	position: absolute;
	inset: 15% calc(4 * var(--default-grid-baseline, 4px));
	cursor: pointer;
}

.deliver-player__sound svg {
	width: 100%;
	height: 100%;
}

.deliver-player__sound-all {
	fill: rgba(255, 255, 255, 0.25);
}

.deliver-player__sound-played {
	fill: var(--color-primary-element);
}

.deliver-player__sound-head {
	position: absolute;
	inset-block: 0;
	width: 2px;
	margin-inline-start: -1px;
	background: #fff;
	pointer-events: none;
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
	padding: calc(4 * var(--default-grid-baseline, 4px));
	text-align: center;
	color: var(--color-text-maxcontrast);
}

/* A thin line across the whole width; on hover it grows, to follow thumbnails */
.deliver-player__scrubber {
	position: relative;
}

.deliver-player__timeline {
	position: relative;
	height: 16px;
	cursor: pointer;
}

.deliver-player__track {
	position: absolute;
	inset-inline: 0;
	top: 6px;
	height: 4px;
	background: rgba(255, 255, 255, 0.14);
	transition: height 0.12s, top 0.12s;
}

.deliver-player__scrubber:hover .deliver-player__track {
	top: 2px;
	height: 12px;
}

/* Where the player stands: a white line, right above the centre of an avatar on that Frame */
.deliver-player__playhead {
	position: absolute;
	top: 0;
	bottom: 0;
	width: 2px;
	margin-inline-start: -1px;
	border-radius: 1px;
	background: #fff;
	pointer-events: none;
}

/* The Waveform, faint, behind the avatars */
.deliver-player__waveform {
	position: absolute;
	inset: 2px 0;
	width: 100%;
	height: calc(100% - 4px);
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

.deliver-player__scrub-video {
	position: absolute;
	width: 1px;
	height: 1px;
	opacity: 0;
	pointer-events: none;
}

.deliver-player__tile {
	border: 2px solid #fff;
	border-radius: var(--border-radius, 4px);
	background-color: #000;
}

.deliver-player__hover-time {
	padding: 1px 6px;
	border-radius: var(--border-radius, 4px);
	background: rgba(0, 0, 0, 0.85);
	color: #fff;
	font-family: var(--font-face-monospace, monospace);
	font-size: 12px;
}

.deliver-player__markers {
	position: relative;
	height: 28px;
}

/* The resets keep Nextcloud's button style away */
.deliver-player__marker {
	position: absolute;
	top: 2px;
	min-height: 0;
	z-index: 1;
	width: 24px;
	height: 24px;
	margin: 0;
	padding: 0;
	border: 2px solid var(--color-main-background);
	border-radius: 50%;
	background: none;
	cursor: pointer;
	/* Centred on its Frame; a negative margin loses against Nextcloud's button style */
	transform: translateX(-50%);
}

.deliver-player__marker:hover {
	z-index: 2;
	border-color: var(--color-main-text);
}

.deliver-player__marker--resolved {
	opacity: 0.45;
}

/* The Comment under the pointer, as a card over the bar */
.deliver-player__peek {
	position: absolute;
	bottom: calc(100% + 22px);
	z-index: 2;
	display: flex;
	gap: 10px;
	width: 320px;
	padding: 12px 14px;
	border: 1px solid var(--color-border-dark);
	border-radius: var(--border-radius-large, 12px);
	background: var(--deliver-card, #19191c);
	box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
	transform: translateX(-50%);
	pointer-events: none;
}

.deliver-player__peek-content {
	flex: 1;
	min-width: 0;
}

.deliver-player__peek-head {
	display: flex;
	align-items: baseline;
	gap: 6px;
	color: var(--color-text-maxcontrast);
	font-size: 13px;
}

.deliver-player__peek-head strong {
	overflow: hidden;
	color: var(--color-main-text);
	font-size: 15px;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.deliver-player__peek-number {
	margin-inline-start: auto;
}

.deliver-player__peek p {
	display: -webkit-box;
	margin: 6px 0 0;
	overflow: hidden;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 3;
	line-height: 1.6;
	overflow-wrap: anywhere;
}

.deliver-player__peek-time {
	margin-inline-end: 4px;
	padding: 2px 6px;
	border-radius: var(--border-radius, 6px);
	background: rgba(245, 197, 24, 0.16);
	color: #f5c518;
	font-family: var(--font-face-monospace, monospace);
	font-size: 13px;
}

.deliver-player__controls {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
	align-items: center;
	gap: calc(2 * var(--default-grid-baseline, 4px));
	padding: var(--default-grid-baseline, 4px) calc(2 * var(--default-grid-baseline, 4px));
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
	padding-inline-start: calc(3 * var(--default-grid-baseline, 4px));
	border-radius: var(--border-radius-element, 8px);
	background: var(--color-background-dark);
	font-family: var(--font-face-monospace, monospace);
	font-size: 16px;
	letter-spacing: 0.04em;
}

.deliver-player__chip {
	display: flex;
	align-items: center;
	gap: 2px;
	padding: 2px 4px 2px 10px;
	border-radius: var(--border-radius-pill, 20px);
	background: var(--color-primary-element-light);
	font-family: var(--font-face-monospace, monospace);
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

.deliver-player__quality :deep(.button-vue__wrapper) {
	flex-direction: row-reverse;
}

.deliver-player--fullscreen {
	background: #000;
}
</style>
