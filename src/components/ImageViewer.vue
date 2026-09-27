<script setup>
import fullscreenExitIcon from '@mdi/svg/svg/fullscreen-exit.svg?raw'
import fullscreenIcon from '@mdi/svg/svg/fullscreen.svg?raw'
import { t } from '@nextcloud/l10n'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import DrawingLayer from './DrawingLayer.vue'
import DrawToolbar from './DrawToolbar.vue'
import { COLORS } from '../lib/drawing.js'
import { actionFor } from '../lib/hotkeys.js'
import { watermarkTile } from '../lib/watermark.js'

/** The drawing being made for the next Comment */
const draft = defineModel('draft', { type: Array, default: () => [] })

const props = defineProps({
	/** A still: one Frame, no timeline (story 95) */
	version: { type: Object, required: true },
	/** The Comments; the one picked last shows its Drawing */
	comments: { type: Array, default: () => [] },
	canComment: { type: Boolean, default: false },
	watermark: { type: String, default: null },
	drawing: { type: Boolean, default: false },
})

const emit = defineEmits(['comment', 'jump', 'update:drawing'])

const root = ref(null)
const picture = ref({ width: 0, height: 0 })
const fullscreen = ref(false)
const tool = ref('pen')
const color = ref(COLORS[0])
/** The Comment whose Drawing shows; a still has no Frame to pick it by */
const focused = ref(null)
/** A still has one Frame; the Review view reads it like a player's */
const frame = ref(0)

const shownDrawings = computed(() => {
	if (props.drawing) {
		return []
	}
	const comment = props.comments.find((each) => each.id === focused.value)
	return comment?.annotation?.length ? [comment.annotation] : []
})

watch(() => props.version.id, () => {
	focused.value = null
})

defineExpose({
	frame,
	/** Nothing to seek on a still */
	seekTo: () => {},
	pause: () => {},
	/**
	 * @param {{id: number}} comment - the Comment picked in the list
	 */
	show: (comment) => {
		focused.value = comment.id
	},
})

/**
 * @param {Event} event - the picture has loaded
 */
function onLoad(event) {
	picture.value = { width: event.target.naturalWidth, height: event.target.naturalHeight }
}

/** The whole viewer goes fullscreen, drawings included */
function toggleFullscreen() {
	if (fullscreen.value) {
		document.exitFullscreen()
	} else {
		root.value?.requestFullscreen()
	}
}

/** Follows the browser's own fullscreen state, which Escape also leaves */
function onFullscreenChange() {
	fullscreen.value = document.fullscreenElement === root.value
}

/**
 * C comments on the still, as it does on a Frame
 *
 * @param {KeyboardEvent} event - the keystroke
 */
function onKey(event) {
	if (actionFor(event) === 'comment' && props.canComment) {
		event.preventDefault()
		emit('comment', { inFrame: 0, outFrame: null })
	}
}

onMounted(() => {
	window.addEventListener('keydown', onKey)
	document.addEventListener('fullscreenchange', onFullscreenChange)
})
onBeforeUnmount(() => {
	window.removeEventListener('keydown', onKey)
	document.removeEventListener('fullscreenchange', onFullscreenChange)
})
</script>

<template>
	<div ref="root" class="deliver-still">
		<div class="deliver-still__stage">
			<img
				v-if="version.url"
				class="deliver-still__picture"
				:src="version.url"
				:alt="version.name"
				@load="onLoad">
			<DrawingLayer
				v-model:draft="draft"
				:pictureWidth="picture.width"
				:pictureHeight="picture.height"
				:shown="shownDrawings"
				:editing="drawing"
				:tool="tool"
				:color="color" />
			<div v-if="watermark" class="deliver-still__watermark" :style="{ backgroundImage: watermarkTile(watermark) }" />
			<DrawToolbar
				v-if="drawing"
				v-model:tool="tool"
				v-model:color="color"
				v-model:draft="draft"
				@done="emit('update:drawing', false)" />
		</div>
		<div class="deliver-still__controls">
			<span class="deliver-still__size">{{ picture.width ? `${picture.width} × ${picture.height}` : '' }}</span>
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
</template>

<style scoped>
.deliver-still {
	display: flex;
	flex-direction: column;
	height: 100%;
	background: var(--color-main-background);
}

.deliver-still__stage {
	position: relative;
	flex: 1;
	min-height: 160px;
	background: #000;
}

.deliver-still__picture {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	object-fit: contain;
}

.deliver-still__watermark {
	position: absolute;
	inset: 0;
	pointer-events: none;
}

.deliver-still__controls {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	gap: calc(2 * var(--default-grid-baseline, 4px));
	padding: var(--default-grid-baseline, 4px) calc(2 * var(--default-grid-baseline, 4px));
	border-top: 1px solid var(--color-border);
}

.deliver-still__size {
	color: var(--color-text-maxcontrast);
	font-family: var(--font-face-monospace, monospace);
	font-size: 13px;
}
</style>
