<script setup>
import pauseIcon from '@mdi/svg/svg/pause.svg?raw'
import playIcon from '@mdi/svg/svg/play.svg?raw'
import backIcon from '@mdi/svg/svg/step-backward.svg?raw'
import forwardIcon from '@mdi/svg/svg/step-forward.svg?raw'
import { t } from '@nextcloud/l10n'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { compareSource, drifted, frameOnA, frameOnB } from '../lib/compare.js'
import { actionFor } from '../lib/hotkeys.js'
import { isStill } from '../lib/media.js'
import { formatAt, frameToTime, timeToFrame } from '../lib/timecode.js'

/** Frames B is ahead of A */
const offset = defineModel('offset', { type: Number, default: 0 })

/** side by side, or wipe */
const mode = defineModel('mode', { type: String, default: 'side' })

/** Whose sound plays: a or b */
const audio = defineModel('audio', { type: String, default: 'a' })

const props = defineProps({
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

const videoA = ref(null)
const videoB = ref(null)
const stage = ref(null)
const frame = ref(0)
const durationFrames = ref(0)
const playing = ref(false)
/** Where the wipe divides, from 0 to 100 */
const wipe = ref(50)

/** Stills show as pictures; with a still on side A there is no time to play (story 95) */
const stillA = computed(() => isStill(props.a))
const stillB = computed(() => isStill(props.b))
const sourceA = computed(() => compareSource(props.a))
const sourceB = computed(() => compareSource(props.b))
const progress = computed(() => durationFrames.value ? (frame.value / durationFrames.value) * 100 : 0)
const lastFrame = computed(() => Math.max(0, durationFrames.value - 1))
/** Both sides' Comments on A's timeline, B's moved by the offset */
const markers = computed(() => [
	...props.commentsA.map((comment) => ({ side: 'a', comment, at: comment.inFrame })),
	...props.commentsB.map((comment) => ({ side: 'b', comment, at: frameOnA(comment.inFrame, props.a.fps, props.b.fps, offset.value) })),
])

defineExpose({ seekTo, frame })

/** Where side B belongs while A stands on its current Frame */
function expectedB() {
	return frameToTime(frameOnB(frame.value, props.a.fps, props.b.fps, offset.value), props.b.fps)
}

/**
 * @param {number} target - a Frame of side A
 */
function seekTo(target) {
	const clamped = Math.max(0, durationFrames.value ? Math.min(target, lastFrame.value) : target)
	frame.value = clamped
	if (videoA.value) {
		videoA.value.currentTime = frameToTime(clamped, props.a.fps)
	}
	if (videoB.value) {
		videoB.value.currentTime = expectedB()
	}
}

/** Both sides start together from where they stand */
function play() {
	seekTo(frame.value)
	playing.value = true
	Promise.all([videoA.value?.play(), videoB.value?.play()]).catch(() => pause())
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

/** A leads; B is pulled back whenever it drifted */
function onTimeUpdate() {
	frame.value = timeToFrame(videoA.value.currentTime, props.a.fps)
	if (playing.value && videoB.value && drifted(videoB.value.currentTime, expectedB(), props.b.fps)) {
		videoB.value.currentTime = expectedB()
	}
}

/** A's length decides the timeline */
function onLoaded() {
	durationFrames.value = timeToFrame(videoA.value.duration, props.a.fps)
	seekTo(frame.value)
}

/**
 * @param {MouseEvent} event - a click on the timeline
 */
function scrub(event) {
	const box = event.currentTarget.getBoundingClientRect()
	pause()
	seekTo(Math.floor(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) * durationFrames.value))
}

/**
 * The wipe follows the pointer while the button is held
 *
 * @param {PointerEvent} event - pressing on the stage
 */
function startWipe(event) {
	if (mode.value !== 'wipe') {
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
 * Space and the arrows, as in the Review view
 *
 * @param {KeyboardEvent} event - the keystroke
 */
function onKey(event) {
	const action = actionFor(event)
	const actions = {
		playPause: () => (playing.value ? pause() : play()),
		stepForward: () => step(1),
		stepBack: () => step(-1),
	}
	if (actions[action]) {
		event.preventDefault()
		actions[action]()
	}
}

watch(offset, () => {
	if (videoB.value && !playing.value) {
		videoB.value.currentTime = expectedB()
	}
})
watch(() => [props.a.id, props.b.id], () => {
	playing.value = false
})

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
	<div class="deliver-compare">
		<div
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
					:muted="audio !== 'a'"
					preload="auto"
					@loadedmetadata="onLoaded"
					@timeupdate="onTimeUpdate"
					@ended="pause" />
				<span class="deliver-compare__label">{{ t('deliver', 'V{number}', { number: a.number }) }}</span>
			</div>
			<div class="deliver-compare__side deliver-compare__side--b" :style="mode === 'wipe' ? { clipPath: `inset(0 0 0 ${wipe}%)` } : null">
				<img v-if="stillB" :src="b.url" :alt="b.name">
				<video
					v-else-if="sourceB"
					ref="videoB"
					:src="sourceB"
					:muted="audio !== 'b'"
					preload="auto"
					@loadedmetadata="seekTo(frame)" />
				<span class="deliver-compare__label deliver-compare__label--b">{{ t('deliver', 'V{number}', { number: b.number }) }}</span>
			</div>
			<div v-if="mode === 'wipe'" class="deliver-compare__handle" :style="{ left: wipe + '%' }" />
		</div>

		<div v-if="!stillA" class="deliver-compare__timeline" @click="scrub">
			<div class="deliver-compare__track">
				<div class="deliver-compare__progress" :style="{ width: progress + '%' }" />
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
			</div>
			<div class="deliver-compare__timecode">
				{{ formatAt(frame, clock) }}
			</div>
			<div class="deliver-compare__group deliver-compare__group--end">
				<span class="deliver-compare__offset-label">{{ t('deliver', 'Offset of V{number}', { number: b.number }) }}</span>
				<NcButton
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
</style>
