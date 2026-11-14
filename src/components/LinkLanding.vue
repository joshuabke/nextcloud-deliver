<script setup>
import downloadIcon from '@mdi/svg/svg/download.svg?raw'
import folderIcon from '@mdi/svg/svg/folder-outline.svg?raw'
import audioIcon from '@mdi/svg/svg/music-note-outline.svg?raw'
import videoIcon from '@mdi/svg/svg/play-box-outline.svg?raw'
import { computed, onBeforeUnmount, onMounted, reactive } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import DueDate from './DueDate.vue'
import MediaStill from './MediaStill.vue'
import SortMenu from './SortMenu.vue'
import { LINK_SORTS, SORT_OPTIONS, sortAssets } from '../lib/filters.js'
import { folderLevel, inFolder, zipped } from '../lib/folders.js'
import { n, t } from '../lib/l10n.js'

// A link with several Assets opens on its folders and Assets, folders first, under its description (stories 123, 125)
/** The folder shown, relative to the Project folder; '' for its top. The page above keeps it while an Asset is open */
const folder = defineModel('folder', { type: String, default: '' })
/** The order of the Assets, one of LINK_SORTS; kept with the folder while an Asset is open */
const sort = defineModel('sort', { type: String, default: 'name' })
const props = defineProps({
	/** The link's title and description, and where to download all of it, if the link lets */
	link: { type: Object, required: true },
	/** The newest Version of every Asset behind the link */
	assets: { type: Array, required: true },
})

const emit = defineEmits(['open'])

const isAudio = (asset) => asset.mimeType?.startsWith('audio/')
/** What can go into a ZIP: a file shared without downloads shows but never downloads */
const downloadable = computed(() => props.assets.filter((asset) => asset.downloadUrl))

/** Its folders first, then its Assets, as Files shows a folder */
const level = computed(() => {
	const found = folderLevel(props.assets, folder.value)
	return { folders: found.folders, assets: sortAssets(found.assets, sort.value) }
})
const sorts = SORT_OPTIONS.filter((each) => LINK_SORTS.includes(each.id))
/** Every Asset in the folder shown, at any depth */
const inView = computed(() => props.assets.filter((asset) => inFolder(asset, folder.value)))
/**
 * @param {string} path - a folder of the link
 * @return {boolean} whether it holds anything that downloads, so it can be picked for the ZIP
 */
const downloadsIn = (path) => downloadable.value.some((asset) => inFolder(asset, path))
/** The way back up, one entry per folder down to the one shown */
const crumbs = computed(() => folder.value === ''
	? []
	: folder.value.split('/').map((name, index, all) => ({ name, path: all.slice(0, index + 1).join('/') })))

/** Assets and folders picked for one ZIP, as on Frame.io; a folder goes down whole, its folders kept */
const selected = reactive(new Set())
const pickedFolders = reactive(new Set())
const picked = computed(() => selected.size + pickedFolders.size)
const selectionUrl = computed(() => props.link.downloadAll + '?assetIds=' + zipped(props.assets, selected, pickedFolders).join(','))
/** What "Select all" picks: whatever downloads in the folder shown, its folders whole */
const pickable = computed(() => [
	...level.value.folders.filter((sub) => downloadsIn(sub.path)).map((sub) => ({ folder: sub.path })),
	...level.value.assets.filter((asset) => asset.downloadUrl).map((asset) => ({ assetId: asset.assetId })),
])
const allPicked = computed(() => pickable.value.every((each) => each.folder !== undefined ? pickedFolders.has(each.folder) : selected.has(each.assetId)))

/**
 * @param {Set} set - the Assets or the folders picked
 * @param {number|string} key - the Asset id or folder picked or dropped
 * @param {boolean} on - picked or not
 */
function toggle(set, key, on) {
	if (on) {
		set.add(key)
	} else {
		set.delete(key)
	}
}

/** Picks whatever downloads in the folder shown */
function pickAll() {
	for (const each of pickable.value) {
		if (each.folder !== undefined) {
			pickedFolders.add(each.folder)
		} else {
			selected.add(each.assetId)
		}
	}
}

/** Drops every pick */
function clearPicks() {
	selected.clear()
	pickedFolders.clear()
}

// Nextcloud's header and footer step aside, as for the Review view
onMounted(() => document.body.classList.add('deliver-review'))
onBeforeUnmount(() => document.body.classList.remove('deliver-review'))
</script>

<template>
	<div class="deliver-landing">
		<div class="deliver-landing__page">
			<div v-if="link.memberUrl" class="deliver-landing__preview">
				{{ t('deliver', 'A preview of what Reviewers see. You comment and approve in Deliver.') }}
				<NcButton :href="link.memberUrl" variant="primary">
					{{ t('deliver', 'Open in Deliver') }}
				</NcButton>
			</div>
			<div class="deliver-landing__head">
				<div class="deliver-landing__intro">
					<h2>{{ link.title }}</h2>
					<p class="deliver-landing__count">
						{{ n('deliver', '%n Asset', '%n Assets', inView.length) }}
					</p>
					<p v-if="link.description" class="deliver-landing__description">
						{{ link.description }}
					</p>
				</div>
				<div class="deliver-landing__actions">
					<NcButton
						v-if="link.downloadAll && pickable.length && !allPicked"
						variant="tertiary"
						@click="pickAll">
						{{ t('deliver', 'Select all') }}
					</NcButton>
					<SortMenu v-if="assets.length > 1" v-model="sort" :sorts="sorts" />
					<!-- The Reviewer's own menu -->
					<slot name="me" />
					<template v-if="picked > 0">
						<NcButton variant="tertiary" @click="clearPicks">
							{{ n('deliver', 'Deselect %n', 'Deselect %n', picked) }}
						</NcButton>
						<NcButton :href="selectionUrl" variant="primary" download>
							<template #icon>
								<NcIconSvgWrapper :svg="downloadIcon" />
							</template>
							{{ t('deliver', 'Download selection') }}
						</NcButton>
					</template>
					<NcButton
						v-else-if="link.downloadAll"
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
			<div v-if="folder !== ''" class="deliver-landing__crumbs">
				<button type="button" class="deliver-landing__crumb" @click="folder = ''">
					{{ link.title || t('deliver', 'All files') }}
				</button>
				<template v-for="crumb in crumbs" :key="crumb.path">
					<span aria-hidden="true">/</span>
					<button
						type="button"
						class="deliver-landing__crumb"
						:aria-current="crumb.path === folder ? 'location' : undefined"
						@click="folder = crumb.path">
						{{ crumb.name }}
					</button>
				</template>
			</div>
			<ul class="deliver-landing__grid">
				<li v-for="sub in level.folders" :key="'folder:' + sub.path" class="deliver-landing__card">
					<div class="deliver-landing__media">
						<button type="button" class="deliver-landing__folder" @click="folder = sub.path">
							<NcIconSvgWrapper :svg="folderIcon" :size="40" />
							<span class="deliver-landing__folder-name">{{ sub.name }}</span>
							<span class="deliver-landing__count">{{ n('deliver', '%n Asset', '%n Assets', sub.count) }}</span>
						</button>
						<input
							v-if="link.downloadAll && downloadsIn(sub.path)"
							type="checkbox"
							class="deliver-landing__pick"
							:class="{ 'deliver-landing__pick--shown': picked > 0 }"
							:checked="pickedFolders.has(sub.path)"
							:aria-label="t('deliver', 'Select {name}', { name: sub.name })"
							@change="toggle(pickedFolders, sub.path, $event.target.checked)">
					</div>
				</li>
				<li v-for="asset in level.assets" :key="asset.assetId" class="deliver-landing__card">
					<div class="deliver-landing__media">
						<button
							type="button"
							class="deliver-landing__open"
							:aria-label="asset.name"
							@click="emit('open', asset.newestId)">
							<span class="deliver-landing__still">
								<NcIconSvgWrapper :svg="isAudio(asset) ? audioIcon : videoIcon" :size="40" />
								<MediaStill
									:fileId="asset.fileId"
									:playUrl="asset.mimeType?.startsWith('video/') ? asset.playUrl : null"
									:scrubUrl="asset.scrubUrl"
									fit="contain" />
								<span class="deliver-landing__badge">{{ t('deliver', 'V{number}', { number: asset.number }) }}</span>
							</span>
						</button>
						<input
							v-if="link.downloadAll && asset.downloadUrl"
							type="checkbox"
							class="deliver-landing__pick"
							:class="{ 'deliver-landing__pick--shown': picked > 0 }"
							:checked="selected.has(asset.assetId)"
							:aria-label="t('deliver', 'Select {name}', { name: asset.name })"
							@change="toggle(selected, asset.assetId, $event.target.checked)">
					</div>
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

/* A Member's preview: the page as Reviewers see it, and the way into the app */
.deliver-landing__preview {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: calc(2 * var(--default-grid-baseline));
	margin-bottom: calc(4 * var(--default-grid-baseline));
	padding: calc(2 * var(--default-grid-baseline)) calc(3 * var(--default-grid-baseline));
	border: 1px solid var(--color-primary-element);
	border-radius: var(--border-radius-large);
	background: var(--landing-surface);
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

/* Nextcloud's global button style would give these a minimum height, padding and a background on hover */
.deliver-landing__crumbs {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--default-grid-baseline);
	margin-bottom: calc(3 * var(--default-grid-baseline));
	color: var(--color-text-maxcontrast);
}

.deliver-landing__crumb,
.deliver-landing__crumb:hover {
	min-height: 0;
	margin: 0;
	padding: 0 var(--default-grid-baseline);
	border: none;
	background: none;
	color: var(--color-main-text);
	font-weight: normal;
	cursor: pointer;
}

.deliver-landing__crumb[aria-current] {
	font-weight: bold;
	cursor: default;
}

.deliver-landing__folder,
.deliver-landing__folder:hover {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: var(--default-grid-baseline);
	width: 100%;
	height: 100%;
	min-height: 160px;
	margin: 0;
	padding: calc(4 * var(--default-grid-baseline));
	border: none;
	background: none;
	color: var(--color-main-text);
	cursor: pointer;
}

.deliver-landing__folder-name {
	max-width: 100%;
	overflow: hidden;
	font-weight: bold;
	text-overflow: ellipsis;
	white-space: nowrap;
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

.deliver-landing__media {
	position: relative;
}

/* Shown on hover, once anything is picked, and always where there is no hover */
.deliver-landing__pick {
	position: absolute;
	top: calc(2 * var(--default-grid-baseline));
	inset-inline-start: calc(2 * var(--default-grid-baseline));
	width: 22px;
	height: 22px;
	min-height: 0;
	margin: 0;
	accent-color: var(--color-primary-element);
	cursor: pointer;
	opacity: 0;
}

.deliver-landing__card:hover .deliver-landing__pick,
.deliver-landing__pick:focus-visible,
.deliver-landing__pick:checked,
.deliver-landing__pick--shown {
	opacity: 1;
}

@media (hover: none) {
	.deliver-landing__pick {
		opacity: 1;
	}
}

.deliver-landing__card:has(.deliver-landing__pick:checked) {
	border-color: var(--color-primary-element);
	box-shadow: 0 0 0 1px var(--color-primary-element);
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

.deliver-landing__badge {
	position: absolute;
	top: calc(2 * var(--default-grid-baseline));
	inset-inline-end: calc(2 * var(--default-grid-baseline));
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
