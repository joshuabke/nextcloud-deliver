<script setup>
import backIcon from '@mdi/svg/svg/arrow-left.svg?raw'
import settingsIcon from '@mdi/svg/svg/cog-outline.svg?raw'
import folderIcon from '@mdi/svg/svg/folder-outline.svg?raw'
import sortIcon from '@mdi/svg/svg/sort.svg?raw'
import uploadIcon from '@mdi/svg/svg/tray-arrow-up.svg?raw'
import { t } from '@nextcloud/l10n'
import { generateRemoteUrl } from '@nextcloud/router'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import NcActionRadio from '@nextcloud/vue/components/NcActionRadio'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import AssetCard from '../components/AssetCard.vue'
import ProjectSettingsDialog from '../components/ProjectSettingsDialog.vue'
import { enableFile, errorMessage, stackVersion, uploadVersion } from '../api.js'
import { FILTERS, found, passes, sortAssets, SORTS } from '../lib/filters.js'
import { groupByFolder, inFolder, projectDavPath } from '../lib/folders.js'
import { stackSuggestions } from '../lib/suggestions.js'
import { useProjectsStore } from '../store/projects.js'

const props = defineProps({
	id: { type: Number, required: true },
})

const store = useProjectsStore()
const route = useRoute()
const router = useRouter()
const error = ref(null)
const settingsOpen = ref(false)
const uploading = ref(false)
const fileInput = ref(null)
const project = computed(() => store.details[props.id])

watch(() => props.id, async (id) => {
	error.value = null
	try {
		await store.fetch(id)
	} catch (e) {
		error.value = errorMessage(e)
	}
}, { immediate: true })

// While derived media is being made, look again every ten seconds for the progress
let recheck = null
watch(project, (current) => {
	clearTimeout(recheck)
	if (current?.assets.some((asset) => asset.versions[0].processing)) {
		recheck = setTimeout(() => store.fetch(props.id).catch(() => {}), 10000)
	}
})
onBeforeUnmount(() => clearTimeout(recheck))

/** Stacks a filename suggests, where more than one Asset matched (story 14) */
const suggestions = computed(() => stackSuggestions(project.value?.assets ?? []))

/**
 * @param {object} asset - the Asset to stack away
 * @param {object} target - the Asset it should join
 */
async function accept(asset, target) {
	error.value = null
	try {
		await stackVersion(asset.versions[0].id, target.id)
		await store.fetch(props.id)
	} catch (e) {
		error.value = errorMessage(e)
	}
}

const LABELS = {
	all: t('deliver', 'All'),
	unseen: t('deliver', 'Unseen'),
	changes: t('deliver', 'Changes requested'),
	approved: t('deliver', 'Approved'),
	due: t('deliver', 'Due'),
}

/** Folder, filter and search live in the address, so the way back from a Review keeps them */
const folder = computed(() => route.query.folder ?? '')
const SORT_LABELS = {
	activity: t('deliver', 'Latest activity'),
	name: t('deliver', 'Name'),
	created: t('deliver', 'Newest first'),
	due: t('deliver', 'Due Date'),
}

const filter = computed(() => FILTERS.includes(route.query.filter) ? route.query.filter : 'all')
const sort = computed({
	get: () => SORTS.includes(route.query.sort) ? route.query.sort : 'activity',
	set: (id) => router.replace({ query: { ...route.query, sort: id === 'activity' ? undefined : id } }),
})
const query = computed({
	get: () => route.query.q ?? '',
	set: (q) => router.replace({ query: { ...route.query, q: q || undefined } }),
})
const inView = computed(() => (project.value?.assets ?? []).filter((asset) => inFolder(asset, folder.value)))
const filters = computed(() => FILTERS.map((id) => ({
	id,
	label: LABELS[id],
	count: inView.value.filter((asset) => passes(asset, id)).length,
})))
const shown = computed(() => inView.value.filter((asset) => passes(asset, filter.value) && found(asset, query.value)))
// Sorted within each folder, the folders themselves by path
const groups = computed(() => groupByFolder(sortAssets(shown.value, sort.value)))

/**
 * @param {string} id - one of FILTERS
 */
function setFilter(id) {
	router.replace({ query: { ...route.query, filter: id === 'all' ? undefined : id } })
}

/**
 * Uploads the picked files into the Project folder and makes each an Asset
 * right away, with or without Auto Intake (story 99)
 *
 * @param {Event} event - the file input's change event
 */
async function upload(event) {
	const files = [...(event.target.files ?? [])]
	event.target.value = ''
	// Into the folder on screen
	const folderUrl = generateRemoteUrl('dav') + '/files/' + projectDavPath(project.value.path)
		+ folder.value.split('/').filter(Boolean).map((part) => '/' + encodeURIComponent(part)).join('')
	uploading.value = true
	error.value = null
	try {
		for (const file of files) {
			await enableFile(await uploadVersion(folderUrl, file))
		}
	} catch (e) {
		error.value = errorMessage(e)
	} finally {
		uploading.value = false
		await store.fetch(props.id).catch(() => {})
	}
}
</script>

<template>
	<div class="deliver-project">
		<NcNoteCard v-if="error" type="error">
			{{ error }}
		</NcNoteCard>
		<NcEmptyContent v-if="!project && !error" :name="t('deliver', 'Loading Project…')">
			<template #icon>
				<NcLoadingIcon />
			</template>
		</NcEmptyContent>
		<template v-else-if="project">
			<div class="deliver-project__head">
				<NcButton
					variant="tertiary"
					to="/"
					:aria-label="t('deliver', 'All Projects')"
					:title="t('deliver', 'All Projects')">
					<template #icon>
						<NcIconSvgWrapper :svg="backIcon" />
					</template>
				</NcButton>
				<h2>
					{{ project.name }}<template v-if="folder">
						<span class="deliver-project__path"> / {{ folder }}</span>
					</template>
				</h2>
				<span class="deliver-project__spacer" />
				<NcTextField
					v-if="project.assets.length"
					v-model="query"
					class="deliver-project__search"
					:label="t('deliver', 'Find an Asset')"
					type="search"
					:showTrailingButton="query !== ''"
					@trailingButtonClick="query = ''" />
				<NcButton
					v-if="project.canWrite"
					:disabled="uploading"
					@click="fileInput.click()">
					<template #icon>
						<NcLoadingIcon v-if="uploading" />
						<NcIconSvgWrapper v-else :svg="uploadIcon" />
					</template>
					{{ t('deliver', 'Upload') }}
				</NcButton>
				<input
					ref="fileInput"
					type="file"
					accept="video/*,audio/*,image/*"
					multiple
					hidden
					@change="upload">
				<NcButton
					variant="tertiary"
					:aria-label="t('deliver', 'Project settings')"
					:title="t('deliver', 'Project settings')"
					@click="settingsOpen = true">
					<template #icon>
						<NcIconSvgWrapper :svg="settingsIcon" />
					</template>
				</NcButton>
			</div>
			<div v-if="project.assets.length" class="deliver-project__tools">
				<div class="deliver-project__filters" role="group" :aria-label="t('deliver', 'Show')">
					<NcButton
						v-for="each in filters"
						:key="each.id"
						variant="tertiary"
						:pressed="filter === each.id"
						@click="setFilter(each.id)">
						{{ each.label }}
						<span v-if="each.id !== 'all'" class="deliver-project__count">{{ each.count }}</span>
					</NcButton>
				</div>
				<NcActions
					:menuName="SORT_LABELS[sort]"
					:title="t('deliver', 'Sort by')"
					variant="tertiary">
					<template #icon>
						<NcIconSvgWrapper :svg="sortIcon" />
					</template>
					<NcActionRadio
						v-for="order in SORTS"
						:key="order"
						v-model="sort"
						:value="order"
						name="deliver-sort">
						{{ SORT_LABELS[order] }}
					</NcActionRadio>
				</NcActions>
			</div>
			<NcEmptyContent
				v-if="project.assets.length && shown.length === 0"
				:name="t('deliver', 'No Asset fits')" />
			<NcEmptyContent
				v-if="project.assets.length === 0"
				:name="t('deliver', 'No Assets yet')"
				:description="project.autoIntake
					? t('deliver', 'Every video or audio file placed in this folder becomes an Asset.')
					: t('deliver', 'Enable files for review in the Deliver tab of the Files sidebar.')" />
			<section v-for="group in groups" :key="group.path" class="deliver-project__group">
				<h3 v-if="group.path !== folder" class="deliver-project__folder">
					<NcIconSvgWrapper :svg="folderIcon" :size="20" />
					{{ group.path }}
				</h3>
				<ul class="deliver-project__grid">
					<AssetCard
						v-for="asset in group.assets"
						:key="asset.id"
						:asset="asset"
						:candidates="suggestions.get(asset.id) ?? []"
						@stack="accept" />
				</ul>
			</section>
			<ProjectSettingsDialog
				v-if="settingsOpen"
				:project="project"
				@close="settingsOpen = false"
				@removed="router.push('/')" />
		</template>
	</div>
</template>

<style scoped>
.deliver-project {
	display: flex;
	flex-direction: column;
	gap: calc(4 * var(--default-grid-baseline, 4px));
	padding: 0 calc(4 * var(--default-grid-baseline, 4px)) calc(6 * var(--default-grid-baseline, 4px));
}

/* One row next to the navigation toggle, which sits in the top left corner */
.deliver-project__head {
	display: flex;
	align-items: center;
	gap: calc(2 * var(--default-grid-baseline, 4px));
	min-height: calc(var(--default-clickable-area, 34px) + 4 * var(--default-grid-baseline, 4px));
	padding-inline-start: var(--default-clickable-area, 34px);
	border-bottom: 1px solid var(--color-border);
}

.deliver-project__path {
	color: var(--color-text-maxcontrast);
	font-weight: normal;
}

.deliver-project__head h2 {
	margin: 0;
	font-size: 20px;
}

.deliver-project__tools {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: calc(2 * var(--default-grid-baseline, 4px));
}

.deliver-project__filters {
	display: flex;
	flex-wrap: wrap;
	gap: var(--default-grid-baseline, 4px);
	flex: 1;
}

.deliver-project__count {
	margin-inline-start: var(--default-grid-baseline, 4px);
	font-weight: normal;
	opacity: 0.7;
}

.deliver-project__search {
	width: 200px !important;
	flex: none;
}

.deliver-project__spacer {
	flex: 1;
}

.deliver-project__folder {
	display: flex;
	align-items: center;
	gap: calc(2 * var(--default-grid-baseline, 4px));
	margin: 0 0 calc(2 * var(--default-grid-baseline, 4px));
	padding-bottom: calc(2 * var(--default-grid-baseline, 4px));
	border-bottom: 1px solid var(--color-border);
	font-size: 16px;
}

.deliver-project__grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
	gap: calc(2 * var(--default-grid-baseline, 4px));
}
</style>
