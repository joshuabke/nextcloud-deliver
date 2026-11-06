<script setup>
import { computed, ref } from 'vue'
import { hoverSource } from '../lib/media.js'
import { previewUrl } from '../lib/preview.js'

// The still of an Asset: Nextcloud's preview, else a frame of the video itself; a mouse over it scrubs through the video, as on Frame.io
const props = defineProps({
	/** The file Nextcloud renders a still of */
	fileId: { type: Number, required: true },
	/** The video to take a frame from and scrub through; null for none (audio, images) */
	playUrl: { type: String, default: null },
	/** The Scrub Proxy, lighter to scrub through, once it is ready (#169) */
	scrubUrl: { type: String, default: null },
	/** How the picture fills the box: cover or contain */
	fit: { type: String, default: 'cover' },
})

/** Nextcloud has no still for it (no ffmpeg on the server) */
const noStill = ref(false)
/** The video could not be read; the parent's icon shows through */
const noVideo = ref(false)
/** The mouse is over it, so the video shows once it has a frame */
const scrubbing = ref(false)
/** The mouse came by once: the video stays loaded, so the next hover does not start over */
const hovered = ref(false)
/** The video has a frame to show in place of the still */
const ready = ref(false)
/** Where the mouse is, 0 to 1 */
const at = ref(0)
const video = ref(null)
/** What the mouse scrubs through: the Scrub Proxy where it is ready */
const source = computed(() => props.playUrl ? hoverSource(props.scrubUrl, props.playUrl) : null)
/** Where Nextcloud has no still, a frame of playUrl is the still; with a Scrub Proxy the mouse scrubs through another video */
const apart = computed(() => noStill.value && Boolean(props.scrubUrl))
/** The one video is the still too */
const stillVideo = computed(() => noStill.value && !props.scrubUrl)

/**
 * Seeks to where the mouse is; seeks pile up on a slow line, so only the latest one counts
 *
 * @param {MouseEvent} event - the move over the still
 */
function scrub(event) {
	if (!source.value || noVideo.value) {
		return
	}
	const box = event.currentTarget.getBoundingClientRect()
	at.value = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1)
	scrubbing.value = true
	hovered.value = true
	const element = video.value
	if (element && Number.isFinite(element.duration) && !element.seeking) {
		element.currentTime = at.value * element.duration
	}
}

/** Once the video can seek, or finished a seek, it follows the mouse to where it is now */
function catchUp() {
	const element = video.value
	if (scrubbing.value && element && Number.isFinite(element.duration) && Math.abs(element.currentTime - at.value * element.duration) > 0.05) {
		element.currentTime = at.value * element.duration
	}
}

/** The video has a frame now, so it can stand in for the still */
function shown() {
	ready.value = true
	catchUp()
}

/** The video cannot be read: the still stays, or the parent's icon shows through */
function failed() {
	noVideo.value = true
	scrubbing.value = false
}

/** Back to the still, or to the first second where the video is the still */
function leave() {
	scrubbing.value = false
	if (video.value && stillVideo.value && Number.isFinite(video.value.duration)) {
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
			v-show="!scrubbing || !ready"
			:src="previewUrl(fileId, 400)"
			alt=""
			loading="lazy"
			@error="noStill = true">
		<video
			v-if="apart && !noVideo"
			v-show="!scrubbing || !ready"
			:src="playUrl + '#t=1'"
			preload="metadata"
			muted
			playsinline
			tabindex="-1"
			@error="failed" />
		<video
			v-if="source && !noVideo && (stillVideo || hovered)"
			v-show="stillVideo || (scrubbing && ready)"
			ref="video"
			:src="source + '#t=1'"
			preload="metadata"
			muted
			playsinline
			tabindex="-1"
			@loadedmetadata="catchUp"
			@loadeddata="shown"
			@seeked="shown"
			@error="failed" />
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
