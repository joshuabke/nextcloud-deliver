<script setup>
import accountIcon from '@mdi/svg/svg/account-circle-outline.svg?raw'
import downloadIcon from '@mdi/svg/svg/download.svg?raw'
import audioIcon from '@mdi/svg/svg/music-note-outline.svg?raw'
import videoIcon from '@mdi/svg/svg/play-box-outline.svg?raw'
import { n, t } from '@nextcloud/l10n'
import { onBeforeUnmount, onMounted, reactive } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import DueDate from './DueDate.vue'
import { previewUrl } from '../lib/preview.js'

// A link with several Assets opens on a grid of them, under its description (stories 123, 125)
defineProps({
	/** The link's title and description, and where to download all of it, if the link lets */
	link: { type: Object, required: true },
	/** The newest Version of every Asset behind the link */
	assets: { type: Array, required: true },
	/** The Reviewer's name once they have one */
	me: { type: String, default: '' },
})

const emit = defineEmits(['open'])

/** Assets without a still from Nextcloud: a frame of the video stands in */
const noStill = reactive(new Set())
const isAudio = (asset) => asset.mimeType?.startsWith('audio/')

// Nextcloud's header and footer step aside, as for the Review view
onMounted(() => document.body.classList.add('deliver-review'))
onBeforeUnmount(() => document.body.classList.remove('deliver-review'))
</script>

<template>
	<div class="deliver-landing">
		<div class="deliver-landing__page">
			<div class="deliver-landing__head">
				<div class="deliver-landing__intro">
					<h2>{{ link.title }}</h2>
					<p class="deliver-landing__count">
						{{ n('deliver', '%n Asset', '%n Assets', assets.length) }}
					</p>
					<p v-if="link.description" class="deliver-landing__description">
						{{ link.description }}
					</p>
				</div>
				<div class="deliver-landing__actions">
					<span v-if="me" class="deliver-landing__me">
						<NcIconSvgWrapper :svg="accountIcon" :size="20" />
						{{ t('deliver', 'Reviewing as {name}', { name: me }) }}
					</span>
					<NcButton
						v-if="link.downloadAll"
						:href="link.downloadAll"
						variant="secondary"
						download>
						<template #icon>
							<NcIconSvgWrapper :svg="downloadIcon" />
						</template>
						{{ t('deliver', 'Download all') }}
					</NcButton>
				</div>
			</div>
			<ul class="deliver-landing__grid">
				<li v-for="asset in assets" :key="asset.assetId" class="deliver-landing__card">
					<button
						type="button"
						class="deliver-landing__open"
						:aria-label="asset.name"
						@click="emit('open', asset.newestId)">
						<span class="deliver-landing__still">
							<NcIconSvgWrapper :svg="isAudio(asset) ? audioIcon : videoIcon" :size="40" />
							<img
								v-if="!noStill.has(asset.assetId)"
								:src="previewUrl(asset.fileId, 400)"
								alt=""
								loading="lazy"
								@error="noStill.add(asset.assetId)">
							<video
								v-else-if="!isAudio(asset) && asset.playUrl"
								:src="asset.playUrl + '#t=1'"
								preload="metadata"
								muted
								playsinline
								tabindex="-1"
								@error="$event.target.hidden = true" />
							<span class="deliver-landing__badge">{{ t('deliver', 'V{number}', { number: asset.number }) }}</span>
						</span>
					</button>
					<div class="deliver-landing__foot">
						<button
							type="button"
							class="deliver-landing__name"
							:title="asset.name"
							@click="emit('open', asset.newestId)">
							{{ asset.name }}
						</button>
						<DueDate v-if="asset.dueDate" :modelValue="asset.dueDate" />
						<NcButton
							v-if="asset.downloadUrl"
							:href="asset.downloadUrl"
							variant="tertiary"
							:aria-label="t('deliver', 'Download {name}', { name: asset.name })"
							:title="t('deliver', 'Download the original')"
							download>
							<template #icon>
								<NcIconSvgWrapper :svg="downloadIcon" />
							</template>
						</NcButton>
					</div>
				</li>
			</ul>
		</div>
	</div>
</template>

<style scoped>
/* The whole window, dark like the Review view it leads into */
.deliver-landing {
	--color-main-text: #ececef;
	--color-text-maxcontrast: #9a9aa2;
	--color-background-hover: #2a2a30;
	--landing-surface: #1c1c20;
	--landing-border: #2e2e35;
	position: fixed;
	inset: 0;
	z-index: 1000;
	overflow-y: auto;
	background: #141416;
	color: var(--color-main-text);
	color-scheme: dark;
}

.deliver-landing__page {
	max-width: 1200px;
	margin: 0 auto;
	padding: calc(6 * var(--default-grid-baseline)) calc(4 * var(--default-grid-baseline));
}

.deliver-landing__head {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-end;
	justify-content: space-between;
	gap: calc(3 * var(--default-grid-baseline));
	margin-bottom: calc(5 * var(--default-grid-baseline));
	padding-bottom: calc(4 * var(--default-grid-baseline));
	border-bottom: 1px solid var(--landing-border);
}

.deliver-landing__intro {
	min-width: 0;
}

.deliver-landing__intro h2 {
	margin: 0;
	color: var(--color-main-text);
}

.deliver-landing__count {
	color: var(--color-text-maxcontrast);
}

.deliver-landing__description {
	margin-top: calc(2 * var(--default-grid-baseline));
	max-width: 70ch;
	white-space: pre-line;
}

.deliver-landing__actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: calc(2 * var(--default-grid-baseline));
}

.deliver-landing__me {
	display: inline-flex;
	align-items: center;
	gap: var(--default-grid-baseline);
	height: var(--default-clickable-area);
	padding: 0 12px 0 8px;
	border: 1px solid var(--landing-border);
	border-radius: var(--border-radius-element);
	background: var(--landing-surface);
	color: var(--color-text-maxcontrast);
}

.deliver-landing__grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(min(260px, 100%), 1fr));
	gap: calc(4 * var(--default-grid-baseline));
}

.deliver-landing__card {
	display: flex;
	flex-direction: column;
	min-width: 0;
	overflow: hidden;
	border: 1px solid var(--landing-border);
	border-radius: var(--border-radius-large);
	background: var(--landing-surface);
	transition: border-color 0.1s, transform 0.1s;
}

.deliver-landing__card:hover,
.deliver-landing__card:focus-within {
	border-color: var(--color-primary-element);
}

/* Nextcloud's global button style would give these a background on hover, a minimum height and padding */
.deliver-landing__open,
.deliver-landing__open:hover,
.deliver-landing__name,
.deliver-landing__name:hover {
	display: block;
	min-height: 0;
	margin: 0;
	padding: 0;
	border: none;
	border-radius: 0;
	background: none;
	color: inherit;
	text-align: start;
	cursor: pointer;
}

.deliver-landing__open {
	width: 100%;
}

.deliver-landing__still {
	position: relative;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 100%;
	aspect-ratio: 16 / 9;
	overflow: hidden;
	background: #0c0c0e;
	color: #6c6c74;
}

.deliver-landing__still img,
.deliver-landing__still video {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	object-fit: cover;
	pointer-events: none;
}

.deliver-landing__badge {
	position: absolute;
	top: calc(2 * var(--default-grid-baseline));
	inset-inline-start: calc(2 * var(--default-grid-baseline));
	padding: 0 6px;
	border-radius: var(--border-radius);
	background: rgba(0, 0, 0, 0.75);
	color: #fff;
	font-weight: bold;
}

.deliver-landing__foot {
	display: flex;
	align-items: center;
	gap: calc(2 * var(--default-grid-baseline));
	min-height: 48px;
	padding: var(--default-grid-baseline) var(--default-grid-baseline) var(--default-grid-baseline) calc(3 * var(--default-grid-baseline));
	border-top: 1px solid var(--landing-border);
}

.deliver-landing__name {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-weight: bold;
}
</style>
