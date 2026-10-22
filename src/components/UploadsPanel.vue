<script setup>
import doneIcon from '@mdi/svg/svg/check-circle-outline.svg?raw'
import expandIcon from '@mdi/svg/svg/chevron-up.svg?raw'
import closeIcon from '@mdi/svg/svg/close.svg?raw'
import uploadIcon from '@mdi/svg/svg/tray-arrow-up.svg?raw'
import { formatFileSize } from '@nextcloud/files'
import { n, t } from '@nextcloud/l10n'
import { useIsMobile } from '@nextcloud/vue/composables/useIsMobile'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcProgressBar from '@nextcloud/vue/components/NcProgressBar'
import { processingFailed, processingOf, settled, statusOf, timeLeft } from '../lib/uploadStatus.js'
import { hasFfmpeg, useUploadsStore } from '../store/uploads.js'

const store = useUploadsStore()
const isMobile = useIsMobile()
const picker = ref(null)
const repicker = ref(null)
/** The interrupted upload whose file is being picked again */
let repicking = null
const dragging = ref(false)

/** Where to read what a server without ffmpeg can do about it (story 138) */
const FFMPEG_HELP = 'https://github.com/joshuabke/nextcloud-deliver/blob/main/docs/admin.md#derived-media'

/** One line for the card and the dialog: how far the queue is */
const summary = computed(() => {
	// The uploads of every tab, as the tab that sends them shows them
	const sending = store.sending.length
	if (sending > 0) {
		return [n('deliver', '%n upload', '%n uploads', sending), `${store.totals.percent} %`, timeLeft(store.totals.eta)].filter(Boolean).join(' · ')
	}
	if (store.items.some((item) => item.status === 'done' && !settled(item))) {
		return t('deliver', 'Processing')
	}
	if (store.items.some((item) => item.status === 'interrupted')) {
		return t('deliver', 'Uploads interrupted')
	}
	if (store.items.some((item) => item.status === 'failed' || processingFailed(item))) {
		return t('deliver', 'Something failed')
	}
	return t('deliver', 'All done')
})

/**
 * @param {File[]} files - picked or dropped in the dialog
 */
function addHere(files) {
	if (store.target) {
		store.add(files, store.target)
	}
}

/**
 * @param {Event} event - the file input's change event
 */
function picked(event) {
	const files = [...(event.target.files ?? [])]
	event.target.value = ''
	addHere(files)
}

/**
 * @param {DragEvent} event - the drop on the dialog
 */
function dropped(event) {
	dragging.value = false
	addHere([...(event.dataTransfer?.files ?? [])])
}

/**
 * @param {object} item - an interrupted upload
 */
function pickAgain(item) {
	repicking = item
	repicker.value.accept = item.type || ''
	repicker.value.click()
}

/**
 * @param {Event} event - the file input's change event
 */
function repicked(event) {
	const file = event.target.files?.[0]
	event.target.value = ''
	if (file && repicking && !store.resume(repicking, file)) {
		repicking.error = t('deliver', 'That is not the same file: {name} has another size or date.', { name: file.name })
	}
}

/**
 * The browser asks before a reload or a closed tab ends an upload (story 135)
 *
 * @param {BeforeUnloadEvent} event - leaving the page
 */
function warn(event) {
	if (store.active.length > 0) {
		event.preventDefault()
	}
}
onMounted(() => {
	window.addEventListener('beforeunload', warn)
	// The card shows every tab's uploads, and comes back after a reload
	store.start()
})
onBeforeUnmount(() => window.removeEventListener('beforeunload', warn))
</script>

<template>
	<NcDialog
		v-if="store.expanded"
		:name="t('deliver', 'Uploads')"
		size="normal"
		@closing="store.expanded = false">
		<div class="deliver-uploads">
			<div
				v-if="store.target"
				class="deliver-uploads__drop"
				:class="{ 'deliver-uploads__drop--dragging': dragging }"
				@dragover.prevent="dragging = true"
				@dragleave="dragging = false"
				@drop.prevent="dropped">
				<!-- Phones have no dropping, only the button (story 109) -->
				<template v-if="!isMobile">
					<NcIconSvgWrapper :svg="uploadIcon" :size="32" />
					<span>{{ t('deliver', 'Drop files here to upload them into {where}', { where: store.target.where }) }}</span>
				</template>
				<NcButton variant="primary" @click="picker.click()">
					{{ t('deliver', 'Choose files') }}
				</NcButton>
				<input
					ref="picker"
					type="file"
					accept="video/*,audio/*,image/*"
					multiple
					hidden
					@change="picked">
			</div>
			<p v-if="store.sending.length" class="deliver-uploads__summary">
				{{ summary }}<template v-if="store.totals.speed > 0">
					· {{ t('deliver', '{speed}/s', { speed: formatFileSize(store.totals.speed) }) }}
				</template>
			</p>
			<ul v-if="store.items.length" class="deliver-uploads__list">
				<li v-for="item in store.items" :key="item.id" class="deliver-uploads__item">
					<div class="deliver-uploads__row">
						<span class="deliver-uploads__name" :title="item.name">{{ item.name }}</span>
						<span class="deliver-uploads__size">{{ formatFileSize(item.size) }}</span>
						<NcButton
							v-if="item.status === 'interrupted'"
							variant="secondary"
							@click="pickAgain(item)">
							{{ t('deliver', 'Pick the file again') }}
						</NcButton>
						<NcButton
							v-if="item.status === 'failed' && item.file"
							variant="secondary"
							@click="store.retry(item)">
							{{ t('deliver', 'Try again') }}
						</NcButton>
						<NcButton
							v-if="processingFailed(item) && item.version.canWrite"
							variant="secondary"
							@click="store.processAgain(item)">
							{{ t('deliver', 'Process again') }}
						</NcButton>
						<NcButton
							v-if="item.status === 'done' && item.version?.id"
							variant="tertiary"
							:to="`/versions/${item.version.id}`"
							@click="store.expanded = false">
							{{ t('deliver', 'Open') }}
						</NcButton>
						<NcButton
							v-if="!['done', 'finishing'].includes(item.status) && item.phase !== 'finishing'"
							variant="tertiary"
							:aria-label="t('deliver', 'Cancel the upload of {name}', { name: item.name })"
							:title="t('deliver', 'Cancel')"
							@click="store.cancel(item)">
							<template #icon>
								<NcIconSvgWrapper :svg="closeIcon" />
							</template>
						</NcButton>
					</div>
					<NcProgressBar
						v-if="['uploading', 'finishing', 'paused', 'elsewhere'].includes(item.status)"
						:value="Math.floor(item.loaded / Math.max(1, item.size) * 100)" />
					<div class="deliver-uploads__row">
						<span
							class="deliver-uploads__status"
							:class="{ 'deliver-uploads__status--error': item.status === 'failed' || processingFailed(item) || (item.status === 'interrupted' && item.error) }">
							{{ item.status === 'interrupted' && item.error ? item.error : statusOf(item) }}
						</span>
						<!-- What is made sits at the end of the status line; only what is still going on takes a line of its own -->
						<span
							v-for="line in processingOf(item).filter((each) => each.done)"
							:key="line.kind"
							class="deliver-uploads__made">
							<NcIconSvgWrapper :svg="doneIcon" :size="16" />
							{{ line.label }}
						</span>
					</div>
					<ul v-if="processingOf(item).some((line) => !line.done)" class="deliver-uploads__processing">
						<li v-for="line in processingOf(item).filter((each) => !each.done)" :key="line.kind">
							<span>{{ line.label }}</span>
							<span>{{ line.text }}</span>
						</li>
					</ul>
				</li>
			</ul>
			<!-- Facts, not errors: what Deliver takes and what plays here (story 138) -->
			<details class="deliver-uploads__formats" :open="store.items.length === 0">
				<summary>{{ t('deliver', 'Which files Deliver takes') }}</summary>
				<dl>
					<dt>{{ t('deliver', 'Video') }}</dt>
					<dd>
						{{ t('deliver', 'MP4 and MOV with H.264, and WebM, play as they are.') }}
						{{ hasFfmpeg
							? t('deliver', 'Everything else ffmpeg reads, such as ProRes, H.265, MXF or AVI, plays as a Proxy.')
							: t('deliver', 'ProRes, H.265, MXF, AVI and other formats need ffmpeg, which this server does not have.') }}
					</dd>
					<dt>{{ t('deliver', 'Audio') }}</dt>
					<dd>
						{{ t('deliver', 'WAV, FLAC, MP3, AAC and Ogg play as they are.') }}
						{{ hasFfmpeg
							? t('deliver', 'Other audio ffmpeg reads plays as a Proxy.')
							: t('deliver', 'Other audio needs ffmpeg.') }}
					</dd>
					<dt>{{ t('deliver', 'Pictures') }}</dt>
					<dd>{{ t('deliver', 'JPEG, PNG, WebP, GIF and AVIF.') }}</dd>
				</dl>
				<p v-if="!hasFfmpeg" class="deliver-uploads__hint">
					<a :href="FFMPEG_HELP" target="_blank" rel="noopener noreferrer">{{ t('deliver', 'What can be done without ffmpeg ↗') }}</a>
				</p>
			</details>
		</div>
		<template #actions>
			<NcButton v-if="store.items.some((item) => item.status === 'done' && settled(item))" variant="tertiary" @click="store.hideFinished()">
				{{ t('deliver', 'Hide finished') }}
			</NcButton>
			<NcButton variant="secondary" @click="store.expanded = false">
				{{ store.sending.length ? t('deliver', 'Continue in the background') : t('deliver', 'Close') }}
			</NcButton>
		</template>
	</NcDialog>
	<!-- Minimised: a card in the corner, a bar on phones, on every view (story 134) -->
	<div
		v-else-if="store.items.length"
		class="deliver-uploads-card"
		:class="{ 'deliver-uploads-card--bar': isMobile }"
		role="status">
		<button type="button" class="deliver-uploads-card__open" @click="store.expanded = true">
			<NcIconSvgWrapper :svg="store.sending.length ? uploadIcon : doneIcon" :size="20" />
			<span class="deliver-uploads-card__text">{{ summary }}</span>
			<NcIconSvgWrapper :svg="expandIcon" :size="20" />
		</button>
		<NcButton
			v-if="store.closable"
			variant="tertiary"
			:aria-label="t('deliver', 'Close')"
			@click="store.close()">
			<template #icon>
				<NcIconSvgWrapper :svg="closeIcon" />
			</template>
		</NcButton>
		<NcProgressBar v-if="store.sending.length" class="deliver-uploads-card__progress" :value="store.totals.percent" />
	</div>
	<input
		ref="repicker"
		type="file"
		hidden
		@change="repicked">
</template>

<style scoped>
.deliver-uploads {
	display: flex;
	flex-direction: column;
	gap: calc(3 * var(--default-grid-baseline));
	padding-bottom: calc(2 * var(--default-grid-baseline));
}

.deliver-uploads__drop {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: calc(2 * var(--default-grid-baseline));
	padding: calc(4 * var(--default-grid-baseline));
	border: 2px dashed var(--color-border-dark);
	border-radius: var(--border-radius-large);
	text-align: center;
}

.deliver-uploads__drop--dragging {
	border-color: var(--color-primary-element);
	background: var(--color-primary-element-light);
}

.deliver-uploads__summary {
	margin: 0;
	font-weight: bold;
}

.deliver-uploads__list {
	display: flex;
	flex-direction: column;
	gap: calc(2 * var(--default-grid-baseline));
}

.deliver-uploads__item {
	display: flex;
	flex-direction: column;
	gap: var(--default-grid-baseline);
	padding-bottom: calc(2 * var(--default-grid-baseline));
	border-bottom: 1px solid var(--color-border);
}

.deliver-uploads__row {
	display: flex;
	align-items: center;
	gap: calc(2 * var(--default-grid-baseline));
	min-width: 0;
}

.deliver-uploads__name {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.deliver-uploads__size,
.deliver-uploads__status,
.deliver-uploads__processing,
.deliver-uploads__hint {
	color: var(--color-text-maxcontrast);
}

.deliver-uploads__made {
	display: inline-flex;
	align-items: center;
	gap: var(--default-grid-baseline);
	color: var(--color-text-maxcontrast);
	white-space: nowrap;
}

.deliver-uploads__status + .deliver-uploads__made {
	margin-inline-start: auto;
}

.deliver-uploads__status--error {
	color: var(--color-error-text);
}

.deliver-uploads__processing li {
	display: flex;
	justify-content: space-between;
	gap: calc(2 * var(--default-grid-baseline));
	padding-inline-start: calc(3 * var(--default-grid-baseline));
}

.deliver-uploads__formats summary {
	cursor: pointer;
	font-weight: bold;
}

.deliver-uploads__formats dl {
	display: grid;
	grid-template-columns: max-content minmax(0, 1fr);
	gap: var(--default-grid-baseline) calc(3 * var(--default-grid-baseline));
	margin-top: calc(2 * var(--default-grid-baseline));
}

.deliver-uploads__formats dt {
	font-weight: bold;
}

.deliver-uploads__formats dd {
	margin: 0;
	color: var(--color-text-maxcontrast);
}

.deliver-uploads__hint {
	margin: calc(2 * var(--default-grid-baseline)) 0 0;
}

.deliver-uploads__hint a {
	text-decoration: underline;
}

.deliver-uploads-card {
	position: fixed;
	inset-block-end: calc(4 * var(--default-grid-baseline));
	inset-inline-end: calc(4 * var(--default-grid-baseline));
	z-index: 1500;
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	width: 320px;
	padding: var(--default-grid-baseline);
	border-radius: var(--border-radius-large);
	background: var(--color-main-background);
	box-shadow: 0 0 12px var(--color-box-shadow);
}

.deliver-uploads-card--bar {
	inset-inline: 0;
	inset-block-end: 0;
	width: auto;
	border-radius: 0;
}

.deliver-uploads-card__open {
	display: flex;
	flex: 1;
	align-items: center;
	gap: calc(2 * var(--default-grid-baseline));
	min-width: 0;
	min-height: var(--default-clickable-area);
	margin: 0;
	padding: 0 calc(2 * var(--default-grid-baseline));
	border: none;
	background: none;
	text-align: start;
}

/* Nextcloud makes an icon span in a plain button inline-block, which puts the svg at the top */
.deliver-uploads-card__open > .icon-vue {
	display: flex;
}

.deliver-uploads-card__text {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.deliver-uploads-card__progress {
	flex-basis: 100%;
	margin: 0 calc(2 * var(--default-grid-baseline)) var(--default-grid-baseline);
}
</style>
