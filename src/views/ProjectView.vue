<script setup>
import backIcon from '@mdi/svg/svg/arrow-left.svg?raw'
import dueIcon from '@mdi/svg/svg/calendar-clock.svg?raw'
import settingsIcon from '@mdi/svg/svg/cog-outline.svg?raw'
import compareIcon from '@mdi/svg/svg/compare.svg?raw'
import removeIcon from '@mdi/svg/svg/delete-outline.svg?raw'
import notUpIcon from '@mdi/svg/svg/eye-off-outline.svg?raw'
import videoIcon from '@mdi/svg/svg/filmstrip.svg?raw'
import filesIcon from '@mdi/svg/svg/folder-eye-outline.svg?raw'
import moveIcon from '@mdi/svg/svg/folder-move-outline.svg?raw'
import folderIcon from '@mdi/svg/svg/folder-outline.svg?raw'
import stackIcon from '@mdi/svg/svg/layers-outline.svg?raw'
import newVersionIcon from '@mdi/svg/svg/layers-plus.svg?raw'
import searchIcon from '@mdi/svg/svg/magnify.svg?raw'
import openIcon from '@mdi/svg/svg/open-in-app.svg?raw'
import uploadIcon from '@mdi/svg/svg/tray-arrow-up.svg?raw'
import audioIcon from '@mdi/svg/svg/waveform.svg?raw'
import { t } from '@nextcloud/l10n'
import { generateRemoteUrl, generateUrl } from '@nextcloud/router'
import { useIsMobile } from '@nextcloud/vue/composables/useIsMobile'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import AssetCard from '../components/AssetCard.vue'
import ContextMenu from '../components/ContextMenu.vue'
import DueDateDialog from '../components/DueDateDialog.vue'
import FilterBar from '../components/FilterBar.vue'
import ProjectSettingsDialog from '../components/ProjectSettingsDialog.vue'
import VersionStack from '../components/VersionStack.vue'
import { assignAsset, disableAsset, enableFile, errorMessage, stackVersion, updateAsset, uploadNextVersion, uploadVersion } from '../api.js'
import { useQuery } from '../composables/query.js'
import { confirmRemoval } from '../confirm.js'
import { FILTER_LABELS, FILTERS, found, passes, SORT_OPTIONS, sortAssets, SORTS } from '../lib/filters.js'
import { groupByFolder, inFolder, projectDavPath, projectDir } from '../lib/folders.js'
import { stackSuggestions } from '../lib/suggestions.js'
import { useProjectsStore } from '../store/projects.js'

const props = defineProps({
	id: { type: Number, required: true },
})

const store = useProjectsStore()
const router = useRouter()
const error = ref(null)
const settingsOpen = ref(false)
/** On a phone the header keeps icons; the search opens as a row of its own (story 109) */
const isMobile = useIsMobile()
const searchOpen = ref(false)
const uploading = ref(false)
const fileInput = ref(null)
const versionInput = ref(null)
/** The right-click menu: where, and for which Asset */
const menu = ref(null)
/** The Asset whose Due Date is being set */
const dueFor = ref(null)
/** The Asset a new Version is picked for */
const stackOn = ref(null)
const project = computed(() => store.details[props.id])
/** The Asset whose Version Stack is being managed; managing is the Project view's, not the Review view's */
const managing = ref(null)
const managed = computed(() => project.value?.assets.find((asset) => asset.id === managing.value) ?? null)

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

/** Folder, filter, order and search live in the address, so the way back from a Review keeps them */
const folder = useQuery('folder', null, '')
const filter = useQuery('filter', FILTERS, 'all')
const sort = useQuery('sort', SORTS, 'activity')
const query = useQuery('q', null, '')
const inView = computed(() => (project.value?.assets ?? []).filter((asset) => inFolder(asset, folder.value)))
const filters = computed(() => FILTERS.map((id) => ({
	id,
	label: FILTER_LABELS[id],
	count: inView.value.filter((asset) => passes(asset, id)).length,
})))
const shown = computed(() => inView.value.filter((asset) => passes(asset, filter.value) && found(asset, query.value)))
// Sorted within each folder, the folders themselves by path
const groups = computed(() => groupByFolder(sortAssets(shown.value, sort.value)))
/** Media files in the folder on screen that are no Assets, greyed out under them to add one by one; they have no state to filter by */
const loose = computed(() => filter.value !== 'all'
	? []
	: (project.value?.notEnabled ?? []).filter((file) => inFolder(file, folder.value) && file.name.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())))
/** File ids being added, so a second click waits */
const adding = ref(new Set())
/**
 * Upload goes into the folder on screen: anywhere in a Folder Project's
 * folder, and in another Project only once a folder of it is open
 */
const canUpload = computed(() => project.value?.path ? project.value.canWrite : folder.value.startsWith('/'))
/** The Asset being put into another Project, while its dialog is open */
const assigning = ref(null)
const assignTo = ref(null)
/** Where an Asset can go: the Projects this Member sees, and No Project (ADR 0009) */
const assignOptions = computed(() => [
	{ id: 0, label: t('deliver', 'No Project') },
	...store.projects.filter((each) => !each.none).map((each) => ({ id: each.id, label: each.name })),
].filter((each) => each.id !== project.value?.id))

/**
 * @param {object} asset - the Asset to put into another Project
 */
async function openAssign(asset) {
	assignTo.value = null
	assigning.value = asset
	if (!store.loaded) {
		await store.fetchAll().catch(() => {})
	}
}

/** Puts the Asset into the Project picked; no file moves */
async function assign() {
	try {
		await assignAsset(assigning.value.id, assignTo.value.id)
		assigning.value = null
		await Promise.all([store.fetch(props.id), store.fetchAll()])
	} catch (e) {
		error.value = errorMessage(e)
	}
}

/**
 * @param {{fileId: number}} file - a media file that is no Asset yet
 */
async function add(file) {
	adding.value.add(file.fileId)
	try {
		await enableFile(file.fileId, project.value.id)
		await store.fetch(props.id)
	} catch (e) {
		error.value = errorMessage(e)
	} finally {
		adding.value.delete(file.fileId)
	}
}

/** Files dragged over the view; enter and leave fire for every child, so they are counted */
const dragDepth = ref(0)

/**
 * Uploads files into the folder on screen and makes each an Asset right
 * away, with or without Auto Intake (story 99). Only media files go.
 *
 * @param {File[]} files - picked or dropped
 */
async function upload(files) {
	const media = files.filter((file) => /^(video|audio|image)\//.test(file.type))
	error.value = media.length < files.length ? t('deliver', 'Only video, audio and image files are uploaded.') : null
	const folderUrl = davFolder(folder.value)
	uploading.value = true
	try {
		for (const file of media) {
			await enableFile(await uploadVersion(folderUrl, file), project.value.id)
		}
	} catch (e) {
		error.value = errorMessage(e)
	} finally {
		uploading.value = false
		await store.fetch(props.id).catch(() => {})
	}
}

/**
 * @param {string} path - a folder of the Project, '' for the Project folder, or from the Member's home with a leading slash
 * @return {string} its WebDAV URL, without a trailing slash
 */
function davFolder(path) {
	const base = path.startsWith('/') ? project.value.davHome : generateRemoteUrl('dav') + '/files/' + projectDavPath(project.value.path)
	return base + path.split('/').filter(Boolean).map((part) => '/' + encodeURIComponent(part)).join('')
}

/**
 * @param {MouseEvent} event - the right click
 * @param {object} asset - the Asset under it
 */
function openMenu(event, asset) {
	const [newest, previous] = asset.versions
	const dir = asset.path.startsWith('/') ? asset.path : projectDir(project.value.path) + (asset.path ? '/' + asset.path : '')
	menu.value = {
		x: event.clientX,
		y: event.clientY,
		items: [
			{ label: t('deliver', 'Open'), icon: openIcon, action: () => router.push(`/versions/${newest.id}`) },
			previous && { label: t('deliver', 'Compare with the Version before'), icon: compareIcon, action: () => router.push(`/compare/${previous.id}/${newest.id}`) },
			asset.canWrite && { label: t('deliver', 'Upload a new Version'), icon: newVersionIcon, action: () => pickVersion(asset) },
			asset.canWrite && { label: asset.dueDate ? t('deliver', 'Change the Due Date') : t('deliver', 'Set a Due Date'), icon: dueIcon, action: () => { dueFor.value = asset } },
			asset.canWrite && !isMobile.value && { label: t('deliver', 'Manage Versions'), icon: stackIcon, action: () => { managing.value = asset.id } },
			asset.canWrite && { label: t('deliver', 'Move to Project…'), icon: moveIcon, action: () => openAssign(asset) },
			{
				label: t('deliver', 'Show in Files'),
				icon: filesIcon,
				href: generateUrl('/apps/files/files/{fileId}', { fileId: newest.fileId }) + '?' + new URLSearchParams({ dir, opendetails: 'true' }),
			},
			asset.canWrite && { label: t('deliver', 'Take out of Deliver'), icon: removeIcon, danger: true, action: () => takeOut(asset) },
		].filter(Boolean),
	}
}

/**
 * @param {object} asset - the Asset the next Version is for
 */
function pickVersion(asset) {
	stackOn.value = asset
	versionInput.value.click()
}

/**
 * Uploads the picked file next to the Asset's newest Version and stacks it on top (story 17)
 *
 * @param {Event} event - the file input's change event
 */
async function uploadStacked(event) {
	const file = event.target.files?.[0]
	event.target.value = ''
	if (!file || !stackOn.value) {
		return
	}
	uploading.value = true
	error.value = null
	try {
		await uploadNextVersion(davFolder(stackOn.value.path), file, stackOn.value.id)
	} catch (e) {
		error.value = errorMessage(e)
	} finally {
		uploading.value = false
		await store.fetch(props.id).catch(() => {})
	}
}

/**
 * @param {string|null} dueDate - the new Due Date of dueFor, or null
 */
async function setDue(dueDate) {
	try {
		await updateAsset(dueFor.value.id, { dueDate })
	} catch (e) {
		error.value = errorMessage(e)
	}
	await store.fetch(props.id).catch(() => {})
}

/**
 * Takes the Asset out of Deliver with its Comments and Versions; the files stay (story 4)
 *
 * @param {object} asset - the Asset to take out
 */
async function takeOut(asset) {
	const confirmed = await confirmRemoval(
		t('deliver', 'Take this Asset out of Deliver?'),
		t('deliver', 'Its Comments and Versions are deleted. The files themselves stay untouched.'),
		t('deliver', 'Take out'),
	)
	if (!confirmed) {
		return
	}
	try {
		await disableAsset(asset.id)
	} catch (e) {
		error.value = errorMessage(e)
	}
	await store.fetch(props.id).catch(() => {})
}

/**
 * @param {Event} event - the file input's change event
 */
function picked(event) {
	const files = [...(event.target.files ?? [])]
	event.target.value = ''
	upload(files)
}

/**
 * @param {DragEvent} event - the drop
 */
function dropped(event) {
	dragDepth.value = 0
	if (canUpload.value && !uploading.value) {
		upload([...(event.dataTransfer?.files ?? [])])
	}
}
</script>

<template>
	<div
		class="deliver-project"
		:class="{ 'deliver-project--dragging': dragDepth > 0 && canUpload }"
		@dragenter.prevent="dragDepth++"
		@dragleave="dragDepth--"
		@dragover.prevent
		@drop.prevent="dropped">
		<div v-if="dragDepth > 0 && canUpload" class="deliver-project__drop">
			{{ folder
				? t('deliver', 'Drop files to upload them into {folder}', { folder })
				: t('deliver', 'Drop files to upload them into the Project') }}
		</div>
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
						<span class="deliver-project__path"> / {{ folder.replace(/^\//, '') }}</span>
					</template>
				</h2>
				<span class="deliver-project__spacer" />
				<NcButton
					v-if="isMobile && project.assets.length"
					variant="tertiary"
					:pressed="searchOpen || query !== ''"
					:aria-label="t('deliver', 'Find an Asset')"
					@click="searchOpen = !searchOpen">
					<template #icon>
						<NcIconSvgWrapper :svg="searchIcon" />
					</template>
				</NcButton>
				<NcTextField
					v-else-if="project.assets.length"
					v-model="query"
					class="deliver-project__search"
					:label="t('deliver', 'Find an Asset')"
					type="search"
					:showTrailingButton="query !== ''"
					@trailingButtonClick="query = ''" />
				<NcButton
					v-if="canUpload"
					:variant="isMobile ? 'tertiary' : 'secondary'"
					:disabled="uploading"
					:aria-label="t('deliver', 'Upload')"
					@click="fileInput.click()">
					<template #icon>
						<NcLoadingIcon v-if="uploading" />
						<NcIconSvgWrapper v-else :svg="uploadIcon" />
					</template>
					<template v-if="!isMobile">
						{{ t('deliver', 'Upload') }}
					</template>
				</NcButton>
				<input
					ref="fileInput"
					type="file"
					accept="video/*,audio/*,image/*"
					multiple
					hidden
					@change="picked">
				<NcButton
					v-if="!project.none"
					variant="tertiary"
					:aria-label="t('deliver', 'Project settings')"
					:title="t('deliver', 'Project settings')"
					@click="settingsOpen = true">
					<template #icon>
						<NcIconSvgWrapper :svg="settingsIcon" />
					</template>
				</NcButton>
			</div>
			<NcTextField
				v-if="isMobile && (searchOpen || query !== '')"
				v-model="query"
				:label="t('deliver', 'Find an Asset')"
				type="search"
				:showTrailingButton="query !== ''"
				@trailingButtonClick="query = ''; searchOpen = false" />
			<FilterBar
				v-if="project.assets.length"
				v-model:filter="filter"
				v-model:sort="sort"
				:filters="filters"
				:sorts="SORT_OPTIONS" />
			<NcEmptyContent
				v-if="project.assets.length && shown.length === 0"
				:name="t('deliver', 'No Asset fits')" />
			<NcEmptyContent
				v-if="project.assets.length === 0"
				:name="t('deliver', 'No Assets yet')"
				:description="project.autoIntake
					? t('deliver', 'Every video or audio file placed in this folder becomes an Asset.')
					: project.path
						? t('deliver', 'Enable files for review in the Deliver tab of the Files sidebar.')
						: t('deliver', 'Add files to this Project in the Deliver tab of the Files sidebar, wherever they lie.')" />
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
						:canWrite="asset.canWrite"
						@stack="accept"
						@versions="managing = $event.id"
						@contextmenu.prevent="openMenu($event, asset)"
						@menu="openMenu($event, asset)" />
				</ul>
			</section>
			<section v-if="loose.length" class="deliver-project__group">
				<h3 class="deliver-project__folder deliver-project__loose-head">
					<NcIconSvgWrapper :svg="notUpIcon" :size="20" />
					{{ t('deliver', 'Not up for review') }}
				</h3>
				<ul class="deliver-project__grid">
					<li v-for="file in loose" :key="file.fileId" class="deliver-project__loose">
						<div class="deliver-card__link">
							<div class="deliver-card__still">
								<NcIconSvgWrapper :svg="file.mimeType.startsWith('audio/') ? audioIcon : videoIcon" :size="40" />
							</div>
							<div class="deliver-card__name" :title="file.name">
								{{ file.name }}
							</div>
							<div class="deliver-card__meta">
								{{ file.path ? file.path : project.name }}
							</div>
						</div>
						<NcButton
							v-if="project.canWrite"
							class="deliver-project__add"
							variant="secondary"
							:disabled="adding.has(file.fileId)"
							@click="add(file)">
							{{ t('deliver', 'Add for review') }}
						</NcButton>
					</li>
				</ul>
			</section>
			<input
				ref="versionInput"
				type="file"
				accept="video/*,audio/*,image/*"
				hidden
				@change="uploadStacked">
			<ContextMenu
				v-if="menu"
				v-bind="menu"
				@close="menu = null" />
			<NcDialog
				v-if="managed"
				:name="t('deliver', 'Versions of {asset}', { asset: managed.name })"
				size="normal"
				@closing="managing = null">
				<VersionStack
					class="deliver-project__stack"
					:versions="managed.versions"
					:assetId="managed.id"
					:folderUrl="davFolder(managed.path)"
					@open="router.push(`/versions/${$event}`)"
					@changed="store.fetch(props.id)" />
			</NcDialog>
			<NcDialog
				v-if="assigning"
				:name="t('deliver', 'Move {asset} to another Project', { asset: assigning.name })"
				size="small"
				@closing="assigning = null">
				<p class="deliver-project__hint">
					{{ t('deliver', 'Its Versions and Comments go along. The files stay where they are.') }}
				</p>
				<NcSelect
					v-model="assignTo"
					:inputLabel="t('deliver', 'Project')"
					:options="assignOptions"
					:clearable="false" />
				<template #actions>
					<NcButton variant="primary" :disabled="!assignTo" @click="assign">
						{{ t('deliver', 'Move') }}
					</NcButton>
				</template>
			</NcDialog>
			<DueDateDialog
				v-if="dueFor"
				:modelValue="dueFor.dueDate"
				@update:modelValue="setDue"
				@close="dueFor = null" />
			<ProjectSettingsDialog
				v-if="settingsOpen"
				:project="project"
				@close="settingsOpen = false"
				@removed="router.push('/')" />
		</template>
	</div>
</template>

<style scoped>
.deliver-project__stack {
	padding-bottom: calc(4 * var(--default-grid-baseline));
}

.deliver-project {
	position: relative;
	min-height: 100%;
	display: flex;
	flex-direction: column;
	gap: calc(4 * var(--default-grid-baseline));
	padding: 0 calc(4 * var(--default-grid-baseline)) calc(6 * var(--default-grid-baseline));
}

/* One row next to the navigation toggle, which sits in the top left corner */
.deliver-project__head {
	display: flex;
	align-items: center;
	gap: calc(2 * var(--default-grid-baseline));
	min-height: calc(var(--default-clickable-area) + 4 * var(--default-grid-baseline));
	padding-inline-start: var(--default-clickable-area);
	border-bottom: 1px solid var(--color-border);
}

.deliver-project__path {
	color: var(--color-text-maxcontrast);
	font-weight: normal;
}

.deliver-project__head h2 {
	min-width: 0;
	margin: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-size: 20px;
}

.deliver-project__drop {
	position: absolute;
	inset: calc(2 * var(--default-grid-baseline));
	z-index: 10;
	display: flex;
	align-items: center;
	justify-content: center;
	border: 2px dashed var(--color-primary-element);
	border-radius: var(--border-radius-large);
	background: rgba(var(--color-main-background-rgb), 0.85);
	font-size: 18px;
	font-weight: bold;
	/* The counter on the view decides, not this layer */
	pointer-events: none;
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
	gap: calc(2 * var(--default-grid-baseline));
	margin: 0 0 calc(2 * var(--default-grid-baseline));
	padding-bottom: calc(2 * var(--default-grid-baseline));
	border-bottom: 1px solid var(--color-border);
	font-size: 16px;
}

.deliver-project__grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
	gap: calc(2 * var(--default-grid-baseline));
}

.deliver-project__hint {
	margin-bottom: calc(2 * var(--default-grid-baseline));
	color: var(--color-text-maxcontrast);
}

.deliver-project__loose-head {
	color: var(--color-text-maxcontrast);
}

/* Greyed out until the pointer is on one: it is there in Files, not in review */
.deliver-project__loose {
	display: flex;
	flex-direction: column;
	min-width: 0;
	opacity: 0.5;
	transition: opacity 0.15s;
}

.deliver-project__loose:hover,
.deliver-project__loose:focus-within {
	opacity: 1;
}

.deliver-project__add {
	align-self: flex-start;
	margin-inline-start: calc(2 * var(--default-grid-baseline));
}
</style>

<style scoped src="../components/card.css"></style>
