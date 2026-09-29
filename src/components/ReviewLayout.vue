<script setup>
import commentsIcon from '@mdi/svg/svg/comment-text-multiple-outline.svg?raw'
import panelIcon from '@mdi/svg/svg/dock-right.svg?raw'
import { t } from '@nextcloud/l10n'
import { useIsMobile } from '@nextcloud/vue/composables/useIsMobile'
import { computed, onBeforeUnmount, onMounted } from 'vue'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { landscape, sheet } from '../composables/panel.js'

/** Whether the panel beside the player is open; on a phone it always is, under the player */
const panelOpen = defineModel('panelOpen', { type: Boolean, default: true })

/**
 * Below 1024 px a phone: upright, the picture takes the room and only the
 * field to write in sits below it, the Comment list comes up in its place;
 * sideways, the picture fills the window and the list opens beside it
 */
const isMobile = useIsMobile()
const sideways = computed(() => isMobile.value && landscape.value)
const upright = computed(() => isMobile.value && !landscape.value)
const { up, aside, writing } = sheet
/** The Review view takes the whole window; Nextcloud's header and footer step aside */
onMounted(() => document.body.classList.add('deliver-review'))
onBeforeUnmount(() => {
	document.body.classList.remove('deliver-review')
	up.value = false
	writing.value = false
})

/** Where the finger came down on the grabber */
let grab = null

/**
 * @param {PointerEvent} event - a finger on the grabber
 */
function grabStart(event) {
	grab = event.clientY
	event.currentTarget.setPointerCapture?.(event.pointerId)
}

/**
 * Up or down by a stroke, either way by a tap (story 106)
 *
 * @param {PointerEvent} event - the finger lifts
 */
function grabEnd(event) {
	if (grab === null) {
		return
	}
	const dy = event.clientY - grab
	grab = null
	up.value = Math.abs(dy) < 10 ? !up.value : dy < 0
}
</script>

<template>
	<!-- The Review view is dark in any theme, like every video tool: the picture is what should stand out.
		It hangs off the body: Nextcloud's content area carries a backdrop filter, which makes that area,
		not the window, the frame for anything fixed; on the iPhone the view ended up under the header -->
	<Teleport to="body">
		<div
			class="deliver-layout"
			:class="{
				'deliver-layout--mobile': isMobile,
				'deliver-layout--upright': upright,
				'deliver-layout--sideways': sideways,
				'deliver-layout--up': upright && up && !writing,
				'deliver-layout--writing': isMobile && writing,
			}">
			<div v-if="!sideways" class="deliver-layout__bar">
				<div class="deliver-layout__start">
					<slot name="start" />
				</div>
				<div v-if="!isMobile" class="deliver-layout__center">
					<slot name="center" />
				</div>
				<div class="deliver-layout__end">
					<slot name="end" />
					<!-- What does not fit into a phone's bar -->
					<NcActions v-if="isMobile && $slots.menu" variant="tertiary" :aria-label="t('deliver', 'More')">
						<slot name="menu" />
					</NcActions>
					<NcButton
						v-if="!isMobile"
						variant="tertiary"
						:pressed="panelOpen"
						:aria-label="panelOpen ? t('deliver', 'Hide Comments') : t('deliver', 'Show Comments')"
						:title="panelOpen ? t('deliver', 'Hide Comments') : t('deliver', 'Show Comments')"
						@click="panelOpen = !panelOpen">
						<template #icon>
							<NcIconSvgWrapper :svg="panelIcon" />
						</template>
					</NcButton>
				</div>
			</div>
			<slot name="notice" />
			<div class="deliver-layout__body" :class="{ 'deliver-layout__body--wide': !panelOpen && !isMobile }">
				<div class="deliver-layout__main">
					<slot />
					<NcButton
						v-if="sideways"
						class="deliver-layout__aside"
						variant="tertiary"
						:pressed="aside"
						:aria-label="aside ? t('deliver', 'Hide Comments') : t('deliver', 'Show Comments')"
						@click="aside = !aside">
						<template #icon>
							<NcIconSvgWrapper :svg="commentsIcon" />
						</template>
					</NcButton>
				</div>
				<div v-show="sideways ? aside : panelOpen || isMobile" class="deliver-layout__panel">
					<button
						v-if="upright"
						type="button"
						class="deliver-layout__grabber"
						:aria-label="up ? t('deliver', 'Show the picture') : t('deliver', 'Pull the Comments up')"
						@pointerdown="grabStart"
						@pointerup="grabEnd"
						@pointercancel="grab = null"
						@keydown.enter.prevent="up = !up"
						@keydown.space.prevent="up = !up" />
					<slot name="panel" />
				</div>
			</div>
		</div>
	</Teleport>
</template>

<style>
/* While the Review view is open, Nextcloud's header and the public page's footer step aside */
body.deliver-review #header,
body.deliver-review footer {
	display: none !important;
}
</style>

<style scoped>
.deliver-layout {
	--color-main-background: #141416;
	--color-main-background-rgb: 20, 20, 22;
	--color-main-text: #ececef;
	--color-text-maxcontrast: #9a9aa2;
	--color-border: #2a2a2f;
	--color-border-dark: #3a3a40;
	--color-border-maxcontrast: #56565e;
	--color-background-hover: rgba(255, 255, 255, 0.08);
	--color-background-dark: #1f1f23;
	--color-background-darker: #27272c;
	--color-primary-element-light: rgba(255, 255, 255, 0.1);
	--color-primary-element-light-hover: rgba(255, 255, 255, 0.16);
	--color-primary-element-light-text: #ececef;
	/* Note cards take their tint from these */
	--color-success: #17301d;
	--color-success-text: #5fd068;
	--color-info: #15283a;
	--color-info-text: #6ea8ff;
	--color-warning: #35290f;
	--color-warning-text: #f5c518;
	--color-error: #3a1818;
	--color-error-text: #ff7b72;
	--deliver-card: #19191c;
	--deliver-timecode: #6ea8ff;
	position: fixed;
	inset: 0;
	z-index: 1000;
	display: flex;
	flex-direction: column;
	min-width: 0;
	background: var(--color-main-background);
	color: var(--color-main-text);
	color-scheme: dark;
}

.deliver-layout__bar {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
	align-items: center;
	gap: calc(2 * var(--default-grid-baseline));
	min-height: 56px;
	padding: 0 calc(3 * var(--default-grid-baseline));
	border-bottom: 1px solid var(--color-border);
}

.deliver-layout__start,
.deliver-layout__center,
.deliver-layout__end {
	display: flex;
	align-items: center;
	gap: calc(2 * var(--default-grid-baseline));
	min-width: 0;
}

.deliver-layout__end {
	justify-content: flex-end;
}

.deliver-layout__body {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 440px;
	flex: 1;
	min-height: 0;
}

.deliver-layout__body--wide {
	grid-template-columns: minmax(0, 1fr);
}

.deliver-layout__main {
	display: flex;
	flex-direction: column;
	min-height: 0;
	min-width: 0;
}

.deliver-layout__panel {
	display: flex;
	flex-direction: column;
	min-height: 0;
	border-inline-start: 1px solid var(--color-border);
	overflow: hidden;
}

/* On a phone: the bar in one row, the player on top at its width, the Comments below; the page itself does not scroll */
.deliver-layout--mobile .deliver-layout__bar {
	display: flex;
	min-height: 48px;
	padding: 0 var(--default-grid-baseline);
	gap: var(--default-grid-baseline);
}

.deliver-layout--mobile .deliver-layout__start {
	flex: 1;
	gap: var(--default-grid-baseline);
}

.deliver-layout--mobile .deliver-layout__end {
	flex: none;
	gap: 2px;
}

.deliver-layout--mobile .deliver-layout__body {
	display: flex;
	flex-direction: column;
	overflow: hidden;
}

/* The grabber: a short bar to pull the list up over the picture and back; the resets keep Nextcloud's button style away */
.deliver-layout__grabber {
	flex: none;
	position: relative;
	width: 100%;
	height: 20px;
	min-height: 0;
	margin: 0;
	padding: 0;
	border: none;
	border-radius: 0;
	background: none;
	cursor: grab;
	touch-action: none;
}

.deliver-layout__grabber::after {
	content: '';
	position: absolute;
	top: 8px;
	left: 50%;
	width: 40px;
	height: 4px;
	border-radius: 2px;
	background: var(--color-border-maxcontrast);
	transform: translateX(-50%);
}

/* Upright: the list waits below the grabber until it is pulled up */
.deliver-layout--upright:not(.deliver-layout--up) :deep(.deliver-comments__head),
.deliver-layout--upright:not(.deliver-layout--up) :deep(.deliver-comments__list),
.deliver-layout--upright:not(.deliver-layout--up) :deep(.deliver-comments__empty),
.deliver-layout--upright:not(.deliver-layout--up) :deep(.deliver-tabs),
.deliver-layout--upright:not(.deliver-layout--up) :deep(.deliver-versions) {
	display: none;
}

/* Pulled up: of the player only its timeline and controls stay, the picture plays on unseen */
.deliver-layout--upright.deliver-layout--up .deliver-layout__main {
	flex: none;
}

.deliver-layout--upright.deliver-layout--up .deliver-layout__panel {
	position: relative;
	flex: 1;
}

/* Up, the grabber sits in the middle of the list's head row, between its filter and its buttons */
.deliver-layout--up .deliver-layout__grabber {
	position: absolute;
	top: 0;
	left: 50%;
	z-index: 1;
	width: 72px;
	height: 52px;
	transform: translateX(-50%);
}

.deliver-layout--up .deliver-layout__grabber::after {
	top: 24px;
}

.deliver-layout--up :deep(.deliver-player__stage),
.deliver-layout--up :deep(.deliver-still__stage) {
	flex: 0 0 0;
	min-height: 0;
}

/* Writing: the list steps aside, so the picture and the field both stay above the keyboard */
.deliver-layout--writing :deep(.deliver-comments__head),
.deliver-layout--writing :deep(.deliver-comments__list),
.deliver-layout--writing :deep(.deliver-comments__empty),
.deliver-layout--writing :deep(.deliver-tabs),
.deliver-layout--writing .deliver-layout__grabber {
	display: none;
}

/* Upright: the picture as large as the room allows, the field below it */
.deliver-layout--upright .deliver-layout__main {
	flex: 1;
}

.deliver-layout--upright .deliver-layout__panel {
	flex: none;
	max-height: 100%;
	border-inline-start: none;
	border-top: 1px solid var(--color-border);
}

/* Sideways: the picture fills the window, the list opens beside it, as a live chat does */
.deliver-layout--sideways .deliver-layout__body {
	flex-direction: row;
}

.deliver-layout--sideways .deliver-layout__main {
	position: relative;
	flex: 1;
}

.deliver-layout--sideways .deliver-layout__panel {
	flex: none;
	width: min(360px, 45%);
}

.deliver-layout__aside {
	position: absolute !important;
	top: var(--default-grid-baseline);
	right: var(--default-grid-baseline);
	z-index: 3;
	background: rgba(0, 0, 0, 0.5) !important;
}
</style>
