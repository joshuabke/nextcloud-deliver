<script setup>
import audioIcon from '@mdi/svg/svg/music-note-outline.svg?raw'
import videoIcon from '@mdi/svg/svg/play-box-outline.svg?raw'
import { t } from '@nextcloud/l10n'
import { onBeforeUnmount, onMounted } from 'vue'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import DueDate from './DueDate.vue'
import { previewUrl } from '../lib/preview.js'

// A link with several Assets opens on a grid of them, under its description (stories 123, 125)
defineProps({
	/** The link's title and description */
	link: { type: Object, required: true },
	/** The newest Version of every Asset behind the link */
	assets: { type: Array, required: true },
})

const emit = defineEmits(['open'])

// Nextcloud's header and footer step aside, as for the Review view
onMounted(() => document.body.classList.add('deliver-review'))
onBeforeUnmount(() => document.body.classList.remove('deliver-review'))
</script>

<template>
	<div class="deliver-landing">
		<div class="deliver-landing__page">
			<div class="deliver-landing__head">
				<h2>{{ link.title }}</h2>
				<p v-if="link.description" class="deliver-landing__description">
					{{ link.description }}
				</p>
			</div>
			<ul class="deliver-landing__grid">
				<li v-for="asset in assets" :key="asset.assetId">
					<button type="button" class="deliver-landing__card" @click="emit('open', asset.newestId)">
						<span class="deliver-landing__still">
							<img
								:src="previewUrl(asset.fileId, 400)"
								alt=""
								loading="lazy"
								@error="$event.target.hidden = true">
							<NcIconSvgWrapper :svg="asset.mimeType?.startsWith('audio/') ? audioIcon : videoIcon" :size="40" />
							<span class="deliver-landing__badge">{{ t('deliver', 'V{number}', { number: asset.number }) }}</span>
						</span>
						<span class="deliver-landing__name">{{ asset.name }}</span>
						<DueDate v-if="asset.dueDate" :modelValue="asset.dueDate" />
					</button>
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

.deliver-landing__head h2 {
	color: var(--color-main-text);
}

.deliver-landing__head {
	margin-bottom: calc(4 * var(--default-grid-baseline));
}

.deliver-landing__description {
	white-space: pre-line;
	color: var(--color-text-maxcontrast);
}

.deliver-landing__grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(min(240px, 100%), 1fr));
	gap: calc(4 * var(--default-grid-baseline));
}

/* Nextcloud's global button style would give the card a minimum height and padding */
.deliver-landing__card {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: var(--default-grid-baseline);
	width: 100%;
	min-height: 0;
	margin: 0;
	padding: 0;
	border: none;
	background: none;
	text-align: start;
	cursor: pointer;
}

.deliver-landing__still {
	position: relative;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 100%;
	aspect-ratio: 16 / 9;
	overflow: hidden;
	border-radius: var(--border-radius-large);
	background: #222227;
	color: #9a9aa2;
}

.deliver-landing__still img {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.deliver-landing__badge {
	position: absolute;
	top: var(--default-grid-baseline);
	inset-inline-start: var(--default-grid-baseline);
	padding: 0 6px;
	border-radius: var(--border-radius);
	background: #000;
	color: #fff;
	font-weight: bold;
}

.deliver-landing__card:hover .deliver-landing__still,
.deliver-landing__card:focus-visible .deliver-landing__still {
	outline: 2px solid var(--color-primary-element);
}

.deliver-landing__name {
	color: var(--color-main-text);
	font-weight: bold;
}
</style>
