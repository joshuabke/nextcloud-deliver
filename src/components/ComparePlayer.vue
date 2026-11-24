<script setup>
import alternateIcon from '@mdi/svg/svg/ab-testing.svg?raw'
import closeIcon from '@mdi/svg/svg/close.svg?raw'
import moreIcon from '@mdi/svg/svg/dots-horizontal.svg?raw'
import pauseIcon from '@mdi/svg/svg/pause.svg?raw'
import playIcon from '@mdi/svg/svg/play.svg?raw'
import rangeIcon from '@mdi/svg/svg/ray-start-end.svg?raw'
import loopIcon from '@mdi/svg/svg/repeat.svg?raw'
import backIcon from '@mdi/svg/svg/step-backward.svg?raw'
import forwardIcon from '@mdi/svg/svg/step-forward.svg?raw'
import volumeIcon from '@mdi/svg/svg/volume-high.svg?raw'
import mutedIcon from '@mdi/svg/svg/volume-off.svg?raw'
import wavesIcon from '@mdi/svg/svg/waveform.svg?raw'
import { getLanguage } from '@nextcloud/l10n'
import { useIsMobile } from '@nextcloud/vue/composables/useIsMobile'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import WaveformStage from './WaveformStage.vue'
import { useRange } from '../composables/range.js'
import { useSoundMix } from '../composables/soundMix.js'
import { averageError, compareSource, FALLBACK_TOLERANCE, follower, frameOnA, frameOnB, laneShift, loudnessGap, loudnessParts, nextPass, outOfStep, switchKey, toleranceFor } from '../lib/compare.js'
import { actionFor, isTyping } from '../lib/hotkeys.js'
import { t } from '../lib/l10n.js'
import { liveSeek } from '../lib/liveSeek.js'
import { isStill } from '../lib/media.js'
import { SKIP_SECONDS, skipFrames } from '../lib/skip.js'
import { formatAt, fpsValue, frameToTime, timeToFrame } from '../lib/timecode.js'
import { fetchWaveform } from '../lib/waveform.js'
import { overviewWindow, readSpan } from '../lib/waveWindow.js'

/** Frames B is ahead of A */
const offset = defineModel('offset', { type: Number, default: 0 })
/** Whose sound plays: a or b */
const audio = defineModel('audio', { type: String, default: 'a' })

const props = defineProps({
	/** side by side, or wipe */
	mode: { type: String, default: 'side' },
	/** The leading side */
	a: { type: Object, required: true },
	/** The side that follows, shifted by the offset */
	b: { type: Object, required: true },
	/** How time is shown, on side A's clock */
	clock: { type: Object, required: true },
	/** Comments of each side, for the marker strip */
	commentsA: { type: Array, default: () => [] },
	commentsB: { type: Array, default: () => [] },
})

const isMobile = useIsMobile()
const locale = getLanguage()
const root = ref(null)
const videoA = ref(null)
const videoB = ref(null)
const stage = ref(null)
const frame = ref(0)
const durationFrames = ref(0)
const playing = ref(false)
/** Where the wipe divides, from 0 to 100 */
const wipe = ref(50)
const { outPoint, loop, range, loopsWhole, markIn, markOut, clearRange, wrapFrom } = useRange(frame)
/** Both sides into one AudioContext, the one heard at a gain of 1 (A7); muting stands in until it runs */
const { mixing, start: startMix, hear, together, late } = useSoundMix()
/** Each pass of the loop plays the other side (A2c); off until asked for, every time */
const alternate = ref(false)
/** Each side's Waveform, once loaded, with its loudness where it was measured */
const waveforms = ref({ a: null, b: null })
/** The seconds across the lanes: the Review view's zoom, remembered alike */
const span = ref(readSpan())
/** Video shows the lanes under the pictures only when asked to (A4) */
const showLanes = ref(false)

/** Stills show as pictures; with a still on side A there is no time to play (story 95) */
const stillA = computed(() => isStill(props.a))
const stillB = computed(() => isStill(props.b))
/** Two pieces of audio: the lanes are the whole view, no picture area (A4) */
const audioView = computed(() => props.a.audioOnly === true && props.b.audioOnly === true)
/** Both sides have time and sound to switch between */
const sounding = computed(() => !stillA.value && !stillB.value)
const lanesShown = computed(() => sounding.value && (audioView.value || showLanes.value))
const sourceA = computed(() => compareSource(props.a))
const sourceB = computed(() => compareSource(props.b))
const progress = computed(() => durationFrames.value ? (frame.value / durationFrames.value) * 100 : 0)
const lastFrame = computed(() => Math.max(0, durationFrames.value - 1))
/** Both sides' Comments on A's timeline, B's moved by the offset */
const markers = computed(() => [
	...props.commentsA.map((comment) => ({ side: 'a', comment, at: comment.inFrame })),
	...props.commentsB.map((comment) => ({ side: 'b', comment, at: frameOnA(comment.inFrame, props.a.fps, props.b.fps, offset.value) })),
])
/** One above the other on A's clock, B's wave ahead by the offset */
const lanes = computed(() => [
	{ waveform: waveforms.value.a, shift: 0, audible: audio.value === 'a', label: t('deliver', 'V{number}', { number: props.a.number }) },
	{ waveform: waveforms.value.b, shift: laneShift(offset.value, props.b.fps), audible: audio.value === 'b', label: t('deliver', 'V{number}', { number: props.b.number }) },
])
/** The two halves of the A/B switch, with their loudness, shown and never applied (A1) */
const sides = computed(() => [props.a, props.b].map((version, index) => ({
	id: index === 0 ? 'a' : 'b',
	key: String(index + 1),
	label: t('deliver', 'V{number}', { number: version.number }),
	name: version.name,
	loudness: loudnessParts(waveforms.value[index === 0 ? 'a' : 'b']?.loudness, locale),
})))
const gap = computed(() => loudnessGap(waveforms.value.a?.loudness, waveforms.value.b?.loudness, locale))
/** The part of the piece on the lanes, on the bar */
const shownWindow = computed(() => lanesShown.value && durationFrames.value
	? overviewWindow(frame.value / fpsValue(props.a.fps), span.value, durationFrames.value / fpsValue(props.a.fps))
	: null)
const loopLabel = computed(() => outPoint.value === null ? t('deliver', 'Loop') : t('deliver', 'Loop the Range'))

defineExpose({ seekTo })

/** Where side B belongs while A stands on its current Frame */
function expectedB() {
	return frameToTime(frameOnB(frame.value, props.a.fps, props.b.fps, offset.value), props.b.fps)
}

/**
 * @param {number} target - a Frame of side A
 */
function seekTo(target) {
	rejudge()
	const clamped = Math.max(0, durationFrames.value ? Math.min(target, lastFrame.value) : target)
	frame.value = clamped
	if (videoA.value) {
		videoA.value.currentTime = frameToTime(clamped, props.a.fps)
	}
	if (videoB.value) {
		videoB.value.currentTime = expectedB()
	}
}

/**
 * @return {HTMLMediaElement[]} both sides' media elements, A first
 */
const elements = () => [videoA.value, videoB.value]
/**
 * @return {number} the index of the side heard
 */
const heardIndex = () => audio.value === 'a' ? 0 : 1

/**
 * The switch, the keys and the lanes' names: only the gains change, nothing is sought
 *
 * @param {'a'|'b'} side - whose sound to hear
 */
function listen(side) {
	audio.value = side
	startMix(elements(), heardIndex)
}

/** The first start, waiting for the AudioContext to run: one at a time, whatever is pressed meanwhile */
let pending = null

/** The following side's offset on average, and when it was last put back, a seek or a switch: judged afresh from then */
let average = null
let corrected = 0

/** After a seek or a switch the follower is judged afresh */
function rejudge() {
	average = null
	corrected = performance.now()
}

watch(audio, () => {
	hear(elements(), heardIndex())
	rejudge()
})

/**
 * Both sides start together from where they stand. On the first Play they
 * start only once both play into the running AudioContext: started as they
 * join it, they stand some 20 ms apart (measured), started after, in step.
 */
function play() {
	playing.value = true
	const joining = !mixing.value
	const waiting = startMix(elements(), heardIndex)
	if (waiting && joining && !late.refused) {
		pending ??= waiting.then(() => {
			pending = null
			if (playing.value) {
				startBoth()
			}
		})
		return
	}
	startBoth()
}

/** Both from the same Frame, at once */
function startBoth() {
	together(elements(), () => {
		seekTo(frame.value)
		return Promise.all([videoA.value?.play(), videoB.value?.play()])
	}).catch((error) => {
		// Safari may refuse a play() that is no longer in the gesture: then, for the rest of the page, the sides start within it (unmeasured)
		late.refused ||= error?.name === 'NotAllowedError'
		pause()
	})
}

/** Both stop, and B lands exactly on A's Frame again */
function pause() {
	playing.value = false
	videoA.value?.pause()
	videoB.value?.pause()
	seekTo(frame.value)
}

/**
 * @param {number} by - Frames to move
 */
function step(by) {
	pause()
	seekTo(frame.value + by)
}

/**
 * A seek that keeps the playback state (N2): a side that had run out starts again from the new Frame
 *
 * @param {number} target - a Frame of side A
 */
function seekPlaying(target) {
	seekTo(target)
	if (playing.value) {
		play()
	}
}

/** Whether it played when a drag on the lanes or the bar took hold of it */
let held = null
/** Set while a pointer drags along the bar */
let dragging = false
/** The Frame a press on the bar came down on */
let pressedAt = null

/** The timeline counts on A's clock */
function onTimeUpdate() {
	if (dragging) {
		return
	}
	frame.value = timeToFrame(videoA.value.currentTime, props.a.fps)
}

/**
 * The heard side leads and is never touched; the other follows it, sought
 * back where nobody hears it once it is out of step on average (A7)
 */
function keepInStep() {
	const [a, b] = elements()
	if (!a || !b) {
		return
	}
	const state = (element) => ({ time: element.currentTime, duration: element.duration || 0, ended: element.ended })
	const plan = follower(audio.value, state(a), state(b), laneShift(offset.value, props.b.fps))
	if (plan === null) {
		return
	}
	const element = plan.side === 'a' ? a : b
	average = averageError(average, element.currentTime - plan.target)
	if (outOfStep(average, (performance.now() - corrected) / 1000, mixing.value ? toleranceFor(plan.side === 'a' ? props.a : props.b) : FALLBACK_TOLERANCE)) {
		element.currentTime = plan.target
		rejudge()
	}
}

/** A's length decides the timeline */
function onLoaded() {
	durationFrames.value = timeToFrame(videoA.value.duration, props.a.fps)
	seekTo(frame.value)
}

/**
 * The next pass of the loop, at its start; alternating, with the other side's sound, switched with the jump
 *
 * @param {number} target - where the pass starts
 */
function wrap(target) {
	audio.value = nextPass(audio.value, alternate.value)
	frame.value = target
	play()
}

/** A plays out: a loop over the whole goes round again, otherwise both stop */
function onEnded() {
	if (loopsWhole.value) {
		wrap(0)
	} else {
		pause()
	}
}

let loopRequest = 0

/**
 * On every animation frame while playing: a looped Range goes round on the frame it played past its end,
 * not on the next timeupdate, a quarter second late; otherwise the sides are kept in step
 */
function follow() {
	loopRequest = 0
	if (!playing.value || !videoA.value) {
		return
	}
	const target = wrapFrom(timeToFrame(videoA.value.currentTime, props.a.fps), fpsValue(props.a.fps))
	if (target !== null) {
		wrap(target)
	} else {
		keepInStep()
	}
	loopRequest = requestAnimationFrame(follow)
}

watch(playing, (now) => {
	if (now && !loopRequest) {
		loopRequest = requestAnimationFrame(follow)
	}
})
// Alternating is a way of looping
watch(loop, (now) => {
	if (!now) {
		alternate.value = false
	}
})

/** Alternate A/B: turning it on loops as well */
function toggleAlternate() {
	alternate.value = !alternate.value
	if (alternate.value) {
		loop.value = true
	}
}

/** The Range button, as the Comment field's: the Range starts here, and ends here the next time */
function markRange() {
	if (range.value === null) {
		markIn()
	} else {
		markOut()
	}
}

/** The bar's drag follows the pointer, one seek of A at a time */
const live = liveSeek((target) => {
	const same = videoA.value && videoA.value.currentTime === frameToTime(target, props.a.fps)
	seekTo(target)
	return !same
})

/**
 * @param {PointerEvent} event - the pointer on the timeline
 * @return {number} the Frame under it
 */
function frameUnder(event) {
	const box = event.currentTarget.getBoundingClientRect()
	return Math.floor(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) * durationFrames.value)
}

/**
 * Pressing on the bar takes the playhead there and it follows the pointer
 * while pressed, playback held meanwhile (decision L3)
 *
 * @param {PointerEvent} event - a pointer comes down on the bar
 */
function onDragStart(event) {
	if (!durationFrames.value || (event.pointerType === 'mouse' && (event.button !== 0 || event.target.closest('button')))) {
		return
	}
	dragging = true
	pressedAt = frameUnder(event)
	event.currentTarget.setPointerCapture(event.pointerId)
	live.want(pressedAt)
}

/**
 * @param {PointerEvent} event - the pointer moves
 */
function onDragMove(event) {
	if (dragging) {
		const at = frameUnder(event)
		// A click only seeks; once the pointer leaves its Frame it is a drag, which holds playback
		if (at !== pressedAt && held === null) {
			hold()
		}
		live.want(at)
	}
}

/**
 * @param {PointerEvent} event - the pointer lets go
 */
function onDragEnd(event) {
	if (!dragging) {
		return
	}
	dragging = false
	live.reset()
	if (event.type === 'pointerup') {
		// A click keeps playing, and starts a side that had run out again; a drag lets go in release
		if (held === null) {
			seekPlaying(frameUnder(event))
		} else {
			seekTo(frameUnder(event))
		}
	}
	release()
}

/** A drag on the lanes holds playback */
function hold() {
	held ??= playing.value
	pause()
}

/** and lets it go on where it ends, unless that is the end */
function release() {
	if (held && frame.value < lastFrame.value) {
		play()
	}
	held = null
}

/**
 * The wipe follows the pointer while the button is held
 *
 * @param {PointerEvent} event - pressing on the stage
 */
function startWipe(event) {
	if (props.mode !== 'wipe') {
		return
	}
	const move = (e) => {
		const box = stage.value.getBoundingClientRect()
		wipe.value = Math.min(100, Math.max(0, ((e.clientX - box.left) / box.width) * 100))
	}
	move(event)
	window.addEventListener('pointermove', move)
	window.addEventListener('pointerup', () => window.removeEventListener('pointermove', move), { once: true })
}

/**
 * Shift+arrows: both sides jump together and play on if they played
 *
 * @param {number} direction - -1 back, 1 forward
 */
function skipBy(direction) {
	seekPlaying(frame.value + skipFrames(direction * SKIP_SECONDS, fpsValue(props.a.fps)))
}

/**
 * A click or a tap in the player gives it the focus, for Tab to switch the sound; a field keeps its own
 *
 * @param {MouseEvent} event - a button goes down in the player
 */
function takeFocus(event) {
	if (!isTyping(event.target)) {
		event.preventDefault()
		root.value.focus({ preventScroll: true })
	}
}

/**
 * 1, 2 and Tab switch the sound; Space, the arrows, I, O and Escape as in the Review view
 *
 * @param {KeyboardEvent} event - the keystroke
 */
function onKey(event) {
	const pick = sounding.value ? switchKey(event, root.value) : null
	if (pick !== null) {
		event.preventDefault()
		listen(pick === 'toggle' ? nextPass(audio.value, true) : pick)
		return
	}
	const action = actionFor(event)
	const actions = {
		playPause: () => (playing.value ? pause() : play()),
		stepForward: () => step(1),
		stepBack: () => step(-1),
		skipForward: () => skipBy(1),
		skipBack: () => skipBy(-1),
		markIn,
		markOut,
		clearRange,
	}
	if (actions[action] && !stillA.value) {
		event.preventDefault()
		actions[action]()
	}
}

watch(offset, () => {
	if (videoB.value && !playing.value) {
		videoB.value.currentTime = expectedB()
	}
})
watch(() => [props.a.id, props.b.id], async ([a, b]) => {
	playing.value = false
	clearRange()
	// The server knows A's length already; its media element confirms it once it loads
	durationFrames.value = props.a.durationFrames ?? 0
	waveforms.value = { a: null, b: null }
	const [waveA, waveB] = await Promise.all([fetchWaveform(props.a), fetchWaveform(props.b)])
	if (props.a.id === a && props.b.id === b) {
		waveforms.value = { a: waveA, b: waveB }
	}
}, { immediate: true })
// A Waveform that becomes ready while the pair is open shows on its lane without opening it again
watch(() => [props.a.derived?.waveform?.state, props.b.derived?.waveform?.state], async () => {
	const ids = [props.a.id, props.b.id]
	const missing = [['a', props.a], ['b', props.b]].filter(([side, version]) => waveforms.value[side] === null && version.derived?.waveform?.state === 'ready')
	const loaded = await Promise.all(missing.map(([, version]) => fetchWaveform(version)))
	if (props.a.id === ids[0] && props.b.id === ids[1]) {
		missing.forEach(([side], index) => {
			waveforms.value = { ...waveforms.value, [side]: waveforms.value[side] ?? loaded[index] }
		})
	}
})

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
	window.removeEventListener('keydown', onKey)
	cancelAnimationFrame(loopRequest)
})
</script>

<template>
	<!-- The player takes the focus from a click or a tap, never from Tab, so Tab switches the sound only after one (A4) -->
	<div
		ref="root"
		class="deliver-compare"
		:class="{ 'deliver-compare--audio': audioView, 'deliver-compare--lanes': lanesShown, 'deliver-compare--mobile': isMobile }"
		tabindex="-1"
		@mousedown="takeFocus">
		<div
			v-show="!audioView"
			ref="stage"
			class="deliver-compare__stage"
			:class="`deliver-compare__stage--${mode}`"
			@pointerdown="startWipe">
			<div class="deliver-compare__side">
				<img v-if="stillA" :src="a.url" :alt="a.name">
				<video
					v-else-if="sourceA"
					ref="videoA"
					:src="sourceA"
					:muted="!mixing && audio !== 'a'"
					playsinline
					preload="auto"
					@loadedmetadata="onLoaded"
					@timeupdate="onTimeUpdate"
					@seeked="live.settled()"
					@ended="onEnded" />
				<span class="deliver-compare__label">{{ t('deliver', 'V{number}', { number: a.number }) }}</span>
			</div>
			<div class="deliver-compare__side deliver-compare__side--b" :style="mode === 'wipe' ? { clipPath: `inset(0 0 0 ${wipe}%)` } : null">
				<img v-if="stillB" :src="b.url" :alt="b.name">
				<video
					v-else-if="sourceB"
					ref="videoB"
					:src="sourceB"
					:muted="!mixing && audio !== 'b'"
					playsinline
					preload="auto"
					@loadedmetadata="seekTo(frame)" />
				<span class="deliver-compare__label deliver-compare__label--b">{{ t('deliver', 'V{number}', { number: b.number }) }}</span>
			</div>
			<div v-if="mode === 'wipe'" class="deliver-compare__handle" :style="{ left: wipe + '%' }" />
		</div>

		<!-- Both Waveforms under one playhead, B's moved by the offset; a click on a wave seeks, on a lane's name it switches the sound -->
		<div v-if="lanesShown" class="deliver-compare__lanes">
			<WaveformStage
				v-if="durationFrames > 0"
				v-model:span="span"
				:lanes="lanes"
				:marked="range"
				:fps="a.fps"
				:durationFrames="durationFrames"
				:frame="frame"
				:media="videoA"
				:playing="playing"
				:clock="clock"
				@seek="seekPlaying"
				@hold="hold"
				@release="release"
				@pick="listen($event === 0 ? 'a' : 'b')" />
		</div>

		<div
			v-if="!stillA"
			class="deliver-compare__timeline"
			@pointerdown="onDragStart"
			@pointermove="onDragMove"
			@pointerup="onDragEnd"
			@pointercancel="onDragEnd">
			<div
				v-if="shownWindow"
				class="deliver-compare__window"
				:style="{ left: shownWindow.left + '%', width: shownWindow.width + '%' }" />
			<div class="deliver-compare__track">
				<div class="deliver-compare__progress" :style="{ width: progress + '%' }" />
				<div
					v-if="range && durationFrames"
					class="deliver-compare__range"
					:style="{ left: (range.inFrame / durationFrames) * 100 + '%', width: (((range.outFrame ?? range.inFrame) - range.inFrame + 1) / durationFrames) * 100 + '%' }" />
			</div>
			<button
				v-for="marker in markers"
				:key="marker.side + marker.comment.id"
				type="button"
				class="deliver-compare__marker"
				:class="`deliver-compare__marker--${marker.side}`"
				:style="{ left: (durationFrames ? (marker.at / durationFrames) * 100 : 0) + '%' }"
				:title="marker.comment.author.name + ': ' + marker.comment.body"
				@click.stop="pause(); seekTo(marker.at)" />
		</div>

		<!-- Whose sound plays: the main control of comparing sound (A2a), with each side's loudness -->
		<div
			v-if="sounding"
			class="deliver-compare__sounds"
			role="radiogroup"
			:aria-label="t('deliver', 'Sound')">
			<template v-for="(side, index) in sides" :key="side.id">
				<span v-if="index === 1 && gap" class="deliver-compare__gap">{{ gap }}</span>
				<button
					type="button"
					role="radio"
					class="deliver-compare__sound"
					:class="{ 'deliver-compare__sound--on': audio === side.id }"
					:aria-checked="audio === side.id ? 'true' : 'false'"
					:title="t('deliver', 'Listen to {version} ({key})', { version: side.label, key: side.key })"
					@click="listen(side.id)">
					<NcIconSvgWrapper :svg="audio === side.id ? volumeIcon : mutedIcon" :size="20" />
					<span v-if="isMobile && side.loudness.length" class="deliver-compare__sound-text">
						<!-- A phone has room for the numbers, not the file's name: the integrated loudness beside the Version, the peak below -->
						<span class="deliver-compare__sound-name"><strong>{{ side.label }}</strong> {{ side.loudness[0] }}</span>
						<span v-if="side.loudness[1]" class="deliver-compare__loudness">{{ side.loudness[1] }}</span>
					</span>
					<span v-else class="deliver-compare__sound-text">
						<span class="deliver-compare__sound-name"><strong>{{ side.label }}</strong> {{ side.name }}</span>
						<span v-if="side.loudness.length" class="deliver-compare__loudness">{{ side.loudness.join(' · ') }}</span>
					</span>
					<kbd v-if="!isMobile" class="deliver-compare__key">{{ side.key }}</kbd>
				</button>
			</template>
		</div>

		<div v-if="!stillA" class="deliver-compare__controls">
			<div class="deliver-compare__group">
				<NcButton
					variant="tertiary"
					:aria-label="playing ? t('deliver', 'Pause (Space)') : t('deliver', 'Play (Space)')"
					:title="playing ? t('deliver', 'Pause (Space)') : t('deliver', 'Play (Space)')"
					@click="playing ? pause() : play()">
					<template #icon>
						<NcIconSvgWrapper :svg="playing ? pauseIcon : playIcon" />
					</template>
				</NcButton>
				<template v-if="isMobile">
					<NcActions variant="tertiary" :aria-label="t('deliver', 'Playback settings')">
						<template #icon>
							<NcIconSvgWrapper :svg="moreIcon" />
						</template>
						<NcActionButton closeAfterClick @click="markRange">
							<template #icon>
								<NcIconSvgWrapper :svg="rangeIcon" />
							</template>
							{{ range === null ? t('deliver', 'Start a Range here') : t('deliver', 'End the Range here') }}
						</NcActionButton>
						<NcActionButton v-if="range !== null" closeAfterClick @click="clearRange">
							<template #icon>
								<NcIconSvgWrapper :svg="closeIcon" />
							</template>
							{{ t('deliver', 'Clear the Range') }}
						</NcActionButton>
						<NcActionButton :modelValue="loop" type="checkbox" @click="loop = !loop">
							{{ loopLabel }}
						</NcActionButton>
						<NcActionButton
							v-if="sounding"
							:modelValue="alternate"
							type="checkbox"
							@click="toggleAlternate">
							{{ t('deliver', 'Alternate A/B') }}
						</NcActionButton>
						<NcActionButton
							v-if="sounding && !audioView"
							:modelValue="showLanes"
							type="checkbox"
							@click="showLanes = !showLanes">
							{{ t('deliver', 'Waveforms') }}
						</NcActionButton>
					</NcActions>
				</template>
				<template v-else>
					<NcButton
						variant="tertiary"
						:aria-label="t('deliver', 'One Frame back (←)')"
						:title="t('deliver', 'One Frame back (←)')"
						@click="step(-1)">
						<template #icon>
							<NcIconSvgWrapper :svg="backIcon" />
						</template>
					</NcButton>
					<NcButton
						variant="tertiary"
						:aria-label="t('deliver', 'One Frame forward (→)')"
						:title="t('deliver', 'One Frame forward (→)')"
						@click="step(1)">
						<template #icon>
							<NcIconSvgWrapper :svg="forwardIcon" />
						</template>
					</NcButton>
					<NcButton
						variant="tertiary"
						:pressed="range !== null"
						:aria-label="range === null ? t('deliver', 'Start a Range here') : t('deliver', 'End the Range here')"
						:title="range === null ? t('deliver', 'Start a Range here, then go to its end (I and O)') : t('deliver', 'End the Range here')"
						@click="markRange">
						<template #icon>
							<NcIconSvgWrapper :svg="rangeIcon" />
						</template>
					</NcButton>
					<div v-if="range" class="deliver-compare__chip">
						<span>{{ formatAt(range.inFrame, clock) }} – {{ range.outFrame === null ? '…' : formatAt(range.outFrame, clock) }}</span>
						<button
							type="button"
							:aria-label="t('deliver', 'Clear the Range (Esc)')"
							:title="t('deliver', 'Clear the Range (Esc)')"
							@click="clearRange">
							<NcIconSvgWrapper :svg="closeIcon" :size="16" inline />
						</button>
					</div>
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
						v-if="sounding"
						variant="tertiary"
						:pressed="alternate"
						:aria-label="t('deliver', 'Alternate A/B')"
						:title="t('deliver', 'Alternate A/B: every pass of the loop plays the other side')"
						@click="toggleAlternate">
						<template #icon>
							<NcIconSvgWrapper :svg="alternateIcon" />
						</template>
					</NcButton>
				</template>
			</div>
			<div class="deliver-compare__timecode">
				{{ formatAt(frame, clock) }}
			</div>
			<div class="deliver-compare__group deliver-compare__group--end">
				<NcButton
					v-if="sounding && !audioView && !isMobile"
					variant="tertiary"
					:pressed="showLanes"
					:aria-label="t('deliver', 'Waveforms')"
					:title="t('deliver', 'Waveforms under the pictures')"
					@click="showLanes = !showLanes">
					<template #icon>
						<NcIconSvgWrapper :svg="wavesIcon" />
					</template>
				</NcButton>
				<span v-if="!isMobile" class="deliver-compare__offset-label">{{ t('deliver', 'Offset of V{number}', { number: b.number }) }}</span>
				<!-- A phone types the offset: the buttons would squeeze the time display -->
				<NcButton
					v-if="!isMobile"
					variant="tertiary"
					:aria-label="t('deliver', 'One Frame earlier')"
					:title="t('deliver', 'One Frame earlier')"
					@click="offset--">
					−
				</NcButton>
				<input
					v-model.number="offset"
					class="deliver-compare__offset"
					type="number"
					step="1"
					:aria-label="t('deliver', 'Offset in Frames')">
				<NcButton
					v-if="!isMobile"
					variant="tertiary"
					:aria-label="t('deliver', 'One Frame later')"
					:title="t('deliver', 'One Frame later')"
					@click="offset++">
					+
				</NcButton>
			</div>
		</div>
	</div>
</template>

<style scoped>
.deliver-compare {
	display: flex;
	flex-direction: column;
	height: 100%;
	/* It takes the focus from a pointer only, for Tab to switch the sound: no ring, the controls keep theirs */
	outline: none;
}

.deliver-compare__stage {
	position: relative;
	display: grid;
	flex: 1;
	min-height: 160px;
	background: #000;
	user-select: none;
}

.deliver-compare__stage--side {
	grid-template-columns: 1fr 1fr;
	gap: 2px;
}

/* Wiping stacks both sides in one box; B is cut from the left up to the handle */
.deliver-compare__stage--wipe {
	cursor: ew-resize;
}

.deliver-compare__stage--wipe .deliver-compare__side {
	grid-area: 1 / 1;
}

.deliver-compare__side {
	position: relative;
	min-width: 0;
	min-height: 0;
}

.deliver-compare__side video,
.deliver-compare__side img {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	object-fit: contain;
}

.deliver-compare__label {
	position: absolute;
	top: 8px;
	inset-inline-start: 8px;
	padding: 2px 8px;
	border-radius: var(--border-radius);
	background: rgba(0, 0, 0, 0.7);
	color: #fff;
	font-weight: bold;
}

.deliver-compare__stage--wipe .deliver-compare__label--b {
	inset-inline-start: auto;
	inset-inline-end: 8px;
}

.deliver-compare__handle {
	position: absolute;
	inset-block: 0;
	width: 2px;
	margin-inline-start: -1px;
	background: #fff;
	box-shadow: 0 0 6px rgba(0, 0, 0, 0.6);
	pointer-events: none;
}

.deliver-compare__timeline {
	position: relative;
	height: 24px;
	cursor: pointer;
	/* A finger drags along the bar instead of scrolling the page */
	touch-action: none;
	border-bottom: 1px solid var(--color-border);
}

.deliver-compare__track {
	position: absolute;
	inset-inline: 0;
	top: 0;
	height: 4px;
	background: rgba(255, 255, 255, 0.14);
}

.deliver-compare__progress {
	height: 100%;
	background: var(--color-primary-element);
}

.deliver-compare__marker {
	position: absolute;
	top: 8px;
	width: 10px;
	min-width: 0;
	height: 10px;
	min-height: 0;
	margin: 0;
	padding: 0;
	border: none;
	border-radius: 50%;
	cursor: pointer;
	transform: translateX(-50%);
}

.deliver-compare__marker--a {
	background: var(--deliver-timecode, #6ea8ff);
}

.deliver-compare__marker--b {
	background: #f5c518;
}

.deliver-compare__controls {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
	align-items: center;
	gap: calc(2 * var(--default-grid-baseline));
	padding: var(--default-grid-baseline) calc(2 * var(--default-grid-baseline));
}

.deliver-compare__group {
	display: flex;
	align-items: center;
	gap: 2px;
}

.deliver-compare__group--end {
	justify-content: flex-end;
}

.deliver-compare__timecode {
	padding: 6px 12px;
	border-radius: var(--border-radius-element);
	background: var(--color-background-dark);
	font-family: monospace;
	font-size: 16px;
}

.deliver-compare__offset-label {
	margin-inline-end: var(--default-grid-baseline);
	color: var(--color-text-maxcontrast);
	font-size: 13px;
}

.deliver-compare__offset {
	width: 5em;
	margin: 0;
	text-align: center;
}

/* With the lanes under them the pictures give up room first */
.deliver-compare--lanes .deliver-compare__stage {
	min-height: 96px;
}

/* Two lanes of 64 px under the zoom buttons; on a phone 40 px each, so pictures, lanes and transport fit sideways too */
.deliver-compare__lanes {
	position: relative;
	flex: none;
	height: 184px;
	background: #000;
	border-top: 2px solid var(--color-main-background);
}

.deliver-compare--mobile .deliver-compare__lanes {
	height: 136px;
}

/* Two pieces of audio: the lanes are the stage */
.deliver-compare--audio .deliver-compare__lanes,
.deliver-compare--audio.deliver-compare--mobile .deliver-compare__lanes {
	flex: 1;
	height: auto;
	min-height: 136px;
	border-top: none;
}

.deliver-compare__window {
	position: absolute;
	inset-block: 0;
	min-width: 2px;
	border-inline: 1px solid rgba(255, 255, 255, 0.35);
	background: rgba(255, 255, 255, 0.08);
	pointer-events: none;
}

.deliver-compare__range {
	position: absolute;
	top: 0;
	height: 100%;
	min-width: 2px;
	background: rgba(255, 255, 255, 0.5);
}

/* The A/B switch: two halves a thumb can hit, the one heard filled in the primary colour; the resets keep Nextcloud's button style away */
.deliver-compare__sounds {
	display: flex;
	align-items: center;
	gap: calc(2 * var(--default-grid-baseline));
	padding: calc(2 * var(--default-grid-baseline)) calc(2 * var(--default-grid-baseline)) 0;
}

.deliver-compare__sound {
	display: flex;
	flex: 1;
	align-items: center;
	gap: calc(2 * var(--default-grid-baseline));
	min-width: 0;
	min-height: 48px;
	margin: 0;
	padding: 4px 12px;
	border: 2px solid var(--color-border-dark);
	border-radius: var(--border-radius-large);
	background: var(--color-background-dark);
	color: var(--color-text-maxcontrast);
	font-weight: normal;
	text-align: start;
	cursor: pointer;
}

.deliver-compare--mobile .deliver-compare__sound {
	min-height: 52px;
	padding: 4px 8px;
}

.deliver-compare__sound:hover {
	border-color: var(--color-border-maxcontrast);
}

.deliver-compare__sound--on,
.deliver-compare__sound--on:hover {
	border-color: var(--color-primary-element);
	background: var(--color-primary-element);
	color: var(--color-primary-element-text);
}

.deliver-compare__sound :deep(.icon-vue) {
	min-width: 24px;
	min-height: 24px;
}

/* The colour tells which is heard; a phone keeps the room for the text */
.deliver-compare--mobile .deliver-compare__sound :deep(.icon-vue) {
	display: none;
}

.deliver-compare__sound-text {
	display: flex;
	flex: 1;
	flex-direction: column;
	min-width: 0;
	line-height: 1.25;
}

.deliver-compare__sound-name,
.deliver-compare__loudness {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.deliver-compare__sound-name strong {
	margin-inline-end: 6px;
	font-size: 17px;
}

.deliver-compare__loudness {
	font-size: 12px;
	font-variant-numeric: tabular-nums;
}

.deliver-compare__key {
	padding: 0 6px;
	border: 1px solid currentColor;
	border-radius: 4px;
	font-size: 12px;
	opacity: 0.7;
}

.deliver-compare__gap {
	flex: none;
	color: var(--color-text-maxcontrast);
	font-size: 12px;
	font-variant-numeric: tabular-nums;
}

.deliver-compare__chip {
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 2px 4px 2px 10px;
	border-radius: var(--border-radius-pill);
	background: var(--color-primary-element-light);
	font-family: monospace;
	font-size: 13px;
	white-space: nowrap;
}

.deliver-compare__chip button {
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

.deliver-compare--mobile .deliver-compare__controls {
	padding: 0 var(--default-grid-baseline);
	gap: var(--default-grid-baseline);
}

.deliver-compare--mobile .deliver-compare__timecode {
	padding: 4px 8px;
	font-size: 14px;
}

.deliver-compare--mobile .deliver-compare__offset {
	width: 4em;
}
</style>
