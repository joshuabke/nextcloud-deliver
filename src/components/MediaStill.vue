<script setup>
import { ref } from 'vue'
import { previewUrl } from '../lib/preview.js'

// The still of an Asset: Nextcloud's preview, else a frame of the video itself; a mouse over it scrubs through the video, as on Frame.io
const props = defineProps({
	/** The file Nextcloud renders a still of */
	fileId: { type: Number, required: true },
	/** The video to take a frame from and scrub through; null for none (audio, images) */
	playUrl: { type: String, default: null },
	/** How the picture fills the box: cover or contain */
	fit: { type: String, default: 'cover' },
})

/** Nextcloud has no still for it (no ffmpeg on the server) */
const noStill = ref(false)
/** The video could not be read; the parent's icon shows through */
const noVideo = ref(false)
/** The mouse is over it, so the video shows */
const scrubbing = ref(false)
/** Where the mouse is, 0 to 1 */
const at = ref(0)
const video = ref(null)

/**
 * Seeks to where the mouse is; seeks pile up on a slow line, so only the latest one counts
 *
 * @param {MouseEvent} event - the move over the still
 */
function scrub(event) {
	if (!props.playUrl || noVideo.value) {
		return
	}
	const box = event.currentTarget.getBoundingClientRect()
	at.value = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1)
	scrubbing.value = true
	const element = video.value
	if (element && Number.isFinite(element.duration) && !element.seeking) {
		element.currentTime = at.value * element.duration
	}
}

/** Once the video can seek, or finished a seek, it follows the mouse to where it is now */
function catchUp() {
	const element = video.value
	if (scrubbing.value && element && Math.abs(element.currentTime - at.value * element.duration) > 0.05) {
		element.currentTime = at.value * element.duration
	}
}

/** Back to the still, or to the first second where the video is the still */
function leave() {
	scrubbing.value = false
	if (video.value && noStill.value && Number.isFinite(video.value.duration)) {
		video.value.currentTime = Math.min(1, video.value.duration)
	}
}
</script>

<template>
	<span
		class="deliver-still"
		:class="`deliver-still--${fit}`"
		@mousemove="scrub"
		@mouseleave="leave">
		<img
			v-if="!noStill"
			v-show="!scrubbing"
			:src="previewUrl(fileId, 400)"
			alt=""
			loading="lazy"
			@error="noStill = true">
		<video
			v-if="playUrl && !noVideo && (noStill || scrubbing)"
			ref="video"
			:src="playUrl + '#t=1'"
			preload="metadata"
			muted
			playsinline
			tabindex="-1"
			@loadedmetadata="catchUp"
			@seeked="catchUp"
			@error="noVideo = true" />
		<span v-if="scrubbing" class="deliver-still__at" :style="{ width: `${at * 100}%` }" />
	</span>
</template>

<style scoped>
.deliver-still {
	position: absolute;
	inset: 0;
}

.deliver-still img,
.deliver-still video {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	pointer-events: none;
}

.deliver-still--cover img,
.deliver-still--cover video {
	object-fit: cover;
}

.deliver-still--contain img,
.deliver-still--contain video {
	object-fit: contain;
}

/* How far into the video the mouse is */
.deliver-still__at {
	position: absolute;
	bottom: 0;
	inset-inline-start: 0;
	height: 3px;
	background: var(--color-primary-element);
}
</style>
