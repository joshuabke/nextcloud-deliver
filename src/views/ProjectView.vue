<script setup>
import backIcon from '@mdi/svg/svg/arrow-left.svg?raw'
import dueIcon from '@mdi/svg/svg/calendar-clock.svg?raw'
import clearIcon from '@mdi/svg/svg/checkbox-blank-off-outline.svg?raw'
import settingsIcon from '@mdi/svg/svg/cog-outline.svg?raw'
import compareIcon from '@mdi/svg/svg/compare.svg?raw'
import removeIcon from '@mdi/svg/svg/delete-outline.svg?raw'
import downloadIcon from '@mdi/svg/svg/download.svg?raw'
import notUpIcon from '@mdi/svg/svg/eye-off-outline.svg?raw'
import addIcon from '@mdi/svg/svg/eye-plus-outline.svg?raw'
import filesIcon from '@mdi/svg/svg/folder-eye-outline.svg?raw'
import moveIcon from '@mdi/svg/svg/folder-move-outline.svg?raw'
import folderIcon from '@mdi/svg/svg/folder-outline.svg?raw'
import stackIcon from '@mdi/svg/svg/layers-outline.svg?raw'
import newVersionIcon from '@mdi/svg/svg/layers-plus.svg?raw'
import searchIcon from '@mdi/svg/svg/magnify.svg?raw'
import openIcon from '@mdi/svg/svg/open-in-app.svg?raw'
import retryIcon from '@mdi/svg/svg/refresh.svg?raw'
import renameIcon from '@mdi/svg/svg/rename-outline.svg?raw'
import deleteIcon from '@mdi/svg/svg/trash-can-outline.svg?raw'
import uploadIcon from '@mdi/svg/svg/tray-arrow-up.svg?raw'
import { n, t } from '@nextcloud/l10n'
import { generateRemoteUrl, generateUrl } from '@nextcloud/router'
import { useIsMobile } from '@nextcloud/vue/composables/useIsMobile'
import { computed, onBeforeUnmount, ref, watch, watchEffect } from 'vue'
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
import NotUpForReviewCard from '../components/NotUpForReviewCard.vue'
import ProjectSettingsDialog from '../components/ProjectSettingsDialog.vue'
import RenameDialog from '../components/RenameDialog.vue'
import VersionStack from '../components/VersionStack.vue'
import { assignAsset, deleteAsset, disableAsset, enableFile, errorMessage, regenerateVersion, renameFile, stackVersion, updateAsset } from '../api.js'
import { useQuery } from '../composables/query.js'
import { confirmRemoval } from '../confirm.js'
import { allMissing, between, FILTER_LABELS, FILTERS, found, passes, selectAll, SORT_OPTIONS, sortAssets, SORTS } from '../lib/filters.js'
import { groupByFolder, inFolder, projectDavPath, projectDir } from '../lib/folders.js'
import { acceptFor, mediaKind, stackKind } from '../lib/media.js'
import { stackSuggestions } from '../lib/suggestions.js'
import { useProjectsStore } from '../store/projects.js'
import { useUploadsStore } from '../store/uploads.js'

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
const uploads = useUploadsStore()
const versionInput = ref(null)
/** The right-click menu: where, and its entries */
const menu = ref(null)
/** The Assets whose Due Date is being set */
const dueFor = ref(null)
/** The Asset a new Version is picked for */
const stackOn = ref(null)
const project = computed(() => store.details[props.id])
/** The Asset whose Version Stack is being managed; managing is the Project view's, not the Review view's */
const managing = ref(null)
const managed = computed(() => project.value?.assets.find((asset) => asset.id === managing.value) ?? null)

/** Ids of the Assets picked with their checkboxes, to delete together (story 141) */
const selected = ref([])

/**
 * Runs a call for each of several Assets, keeps the last error, takes them
 * out of the selection and reads the Project again
 *
 * @param {object[]} assets - the Assets
 * @param {(asset: object) => Promise<unknown>} call - what to do with each
 */
async function forEach(assets, call) {
	error.value = null
	for (const asset of assets) {
		try {
			await call(asset)
		} catch (e) {
			error.value = errorMessage(e)
		}
	}
	const done = assets.map((asset) => asset.id)
	selected.value = selected.value.filter((id) => !done.includes(id))
	await store.fetch(props.id).catch(() => {})
}

watch(() => props.id, async (id) => {
	error.value = null
	selected.value = []
	try {
		await store.fetch(id)
	} catch (e) {
		error.value = errorMessage(e)
	}
}, { immediate: true })

// While derived media is being made, look again every ten seconds for the progress
let recheck = null
watch(project, (current) => {
	// Ticked Assets that are gone since are no longer ticked
	selected.value = selected.value.filter((id) => current?.assets.some((asset) => asset.id === id))
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
// Ticked Assets a filter, a search or another folder takes off the screen are no longer ticked: the menu acts only on what is in sight
watch(shown, (now) => {
	selected.value = selected.value.filter((id) => now.some((asset) => asset.id === id))
})
/** The Assets on screen that can be ticked */
const selectable = computed(() => selectAll(shown.value.filter((asset) => asset.canWrite)))
/** Whether the ticked Assets are Missing ones; null while none is ticked. Missing ones are only ticked together (story 141) */
const tickedMissing = computed(() => {
	const first = project.value?.assets.find((asset) => selected.value.includes(asset.id))
	return first ? allMissing(first) : null
})

/** The Asset ticked or unticked last, where a shift-click range starts */
let anchor = null

/**
 * A click ticks or unticks one card; a shift-click ticks every card on screen
 * from the one clicked last to this one, of those that may join the ticked ones
 *
 * @param {object} asset - an Asset whose checkbox was clicked
 * @param {boolean} range - whether Shift was held
 */
function toggle(asset, range) {
	if (!range && !selected.value.includes(asset.id) && tickedMissing.value !== null && tickedMissing.value !== allMissing(asset)) {
		return
	}
	if (range && anchor !== null) {
		const missing = tickedMissing.value ?? allMissing(asset)
		const order = groups.value.flatMap((group) => group.assets)
		const added = between(order, anchor, asset.id).filter((each) => each.canWrite && allMissing(each) === missing)
		selected.value = [...new Set([...selected.value, ...added.map((each) => each.id)])]
	} else {
		selected.value = selected.value.includes(asset.id) ? selected.value.filter((id) => id !== asset.id) : [...selected.value, asset.id]
	}
	anchor = asset.id
}

/**
 * A click on a card ticks it alone; with Ctrl or Cmd it joins the ticked ones,
 * with Shift the cards up to it do (story 141)
 *
 * @param {object} asset - the Asset clicked
 * @param {{range: boolean, add: boolean}} how - the keys held
 */
function pick(asset, { range, add }) {
	if (range || add) {
		toggle(asset, range)
		return
	}
	selected.value = [asset.id]
	anchor = asset.id
}
/** Media files in the folder on screen that are no Assets, greyed out under them to add one by one; they have no state to filter by */
const notUpForReview = computed(() => filter.value !== 'all'
	? []
	: (project.value?.notEnabled ?? []).filter((file) => inFolder(file, folder.value) && file.name.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())))
/** File ids being added, so a second click waits */
const adding = ref(new Set())
/**
 * Upload goes into the folder on screen: anywhere in a Folder Project's
 * folder, and in another Project only once a folder of it is open
 */
const canUpload = computed(() => project.value?.path ? project.value.canWrite : folder.value.startsWith('/'))
/** The Assets being put into another Project, while its dialog is open */
const assigning = ref(null)
const assignTo = ref(null)
/** Where an Asset can go: the Projects this Member sees, and No Project (ADR 0009) */
const assignOptions = computed(() => [
	{ id: 0, label: t('deliver', 'No Project') },
	...store.projects.filter((each) => !each.none).map((each) => ({ id: each.id, label: each.name })),
].filter((each) => each.id !== project.value?.id))

/**
 * @param {object[]} assets - the Assets to put into another Project
 */
async function openAssign(assets) {
	assignTo.value = null
	assigning.value = assets
	if (!store.loaded) {
		await store.fetchAll().catch(() => {})
	}
}

/** Puts the Assets into the Project picked; no file moves */
async function assign() {
	const [assets, to] = [assigning.value, assignTo.value.id]
	assigning.value = null
	await forEach(assets, (asset) => assignAsset(asset.id, to))
	await store.fetchAll().catch(() => {})
}

/** The file being renamed, as { name, url }, while its dialog is open */
const renaming = ref(null)
/** The file not up for review being added to an Asset, while its dialog is open */
const stackingFile = ref(null)
const stackTarget = ref(null)
const stackOptions = computed(() => stackOptionsFor(stackingFile.value))

/**
 * @param {?object} file - a file not up for review
 * @return {object[]} the Assets it can join: the same kind of media, and stacks this Member may change (story 131)
 */
function stackOptionsFor(file) {
	return (project.value?.assets ?? [])
		.filter((asset) => asset.canWrite && stackKind(asset.versions) === mediaKind(file?.mimeType))
		.map((asset) => ({ id: asset.id, label: asset.name }))
}

/**
 * @param {string} url - WebDAV URL of the file
 * @param {string} name - its name
 * @param {boolean} canWrite - whether this Member may rename it
 * @return {object[]} Download and, with write access, Rename (story 131)
 */
function fileItems(url, name, canWrite) {
	return [
		{ label: t('deliver', 'Download'), icon: downloadIcon, href: url, download: name },
		canWrite && { label: t('deliver', 'Rename…'), icon: renameIcon, action: () => { renaming.value = { name, url } } },
	]
}

/**
 * @param {string} name - the new name of the file in renaming
 */
async function rename(name) {
	try {
		await renameFile(renaming.value.url, name)
	} catch (e) {
		error.value = errorMessage(e)
	}
	await store.fetch(props.id).catch(() => {})
}

/**
 * @param {MouseEvent} event - the right click
 * @param {object} file - a media file in the folder that is no Asset
 */
function openFileMenu(event, file) {
	const canWrite = file.canWrite
	const dir = projectDir(project.value.path) + (file.path ? '/' + file.path : '')
	menu.value = {
		x: event.clientX,
		y: event.clientY,
		items: [
			canWrite && { label: t('deliver', 'Add for review'), icon: addIcon, action: () => add(file) },
			canWrite && stackOptionsFor(file).length > 0 && { label: t('deliver', 'Add as a new Version of…'), icon: newVersionIcon, action: () => openStacking(file) },
			...fileItems(davFolder(file.path) + '/' + encodeURIComponent(file.name), file.name, canWrite),
			{ label: t('deliver', 'Show in Files'), icon: filesIcon, href: generateUrl('/apps/files/files/{fileId}', { fileId: file.fileId }) + '?' + new URLSearchParams({ dir, opendetails: 'true' }) },
		].filter(Boolean),
	}
}

/**
 * @param {object} file - the file not up for review to add to an Asset
 */
function openStacking(file) {
	stackTarget.value = null
	stackingFile.value = file
}

/** Adds the file for review and stacks it on top of the Asset picked */
async function addAsVersion() {
	const file = stackingFile.value
	stackingFile.value = null
	adding.value.add(file.fileId)
	try {
		await enableFile(file.fileId, null, stackTarget.value.id)
	} catch (e) {
		error.value = errorMessage(e)
	} finally {
		adding.value.delete(file.fileId)
	}
	await store.fetch(props.id).catch(() => {})
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
 * The Uploads dialog uploads into the folder on screen, and each file
 * becomes an Asset right away, with or without Auto Intake (story 99)
 */
watchEffect(() => {
	uploads.target = project.value && canUpload.value
		? { folderUrl: davFolder(folder.value), projectId: project.value.id, where: folder.value ? folder.value.replace(/^\//, '') : project.value.name }
		: null
})
onBeforeUnmount(() => {
	uploads.target = null
})

/**
 * @param {string} path - a folder of the Project, '' for the Project folder, or from the Member's home with a leading slash
 * @return {string} its WebDAV URL, without a trailing slash
 */
function davFolder(path) {
	const base = path.startsWith('/') ? project.value.davHome : generateRemoteUrl('dav') + '/files/' + projectDavPath(project.value.path)
	return base + path.split('/').filter(Boolean).map((part) => '/' + encodeURIComponent(part)).join('')
}

/**
 * On a ticked card while others are ticked too, the menu acts on all of them,
 * with what can be done to several at once (story 141)
 *
 * @param {MouseEvent} event - the right click
 * @param {object} asset - the Asset under it
 */
function openMenu(event, asset) {
	const many = selected.value.length > 1 && selected.value.includes(asset.id)
	menu.value = {
		x: event.clientX,
		y: event.clientY,
		title: many ? n('deliver', '%n Asset selected', '%n Assets selected', selected.value.length) : null,
		items: (many ? selectionItems() : assetItems(asset)).filter(Boolean),
	}
}

/**
 * @param {object} asset - an Asset
 * @return {Array<object|false>} its menu
 */
function assetItems(asset) {
	const [newest, previous] = asset.versions
	const dir = asset.path.startsWith('/') ? asset.path : projectDir(project.value.path) + (asset.path ? '/' + asset.path : '')
	return [
		{ label: t('deliver', 'Open'), icon: openIcon, action: () => router.push(`/versions/${newest.id}`) },
		previous && { label: t('deliver', 'Compare with the Version before'), icon: compareIcon, action: () => router.push(`/compare/${previous.id}/${newest.id}`) },
		asset.canWrite && { label: t('deliver', 'Upload a new Version'), icon: newVersionIcon, action: () => pickVersion(asset) },
		asset.canWrite && newest.processingFailed && { label: t('deliver', 'Process again'), icon: retryIcon, action: () => processAgain([asset]) },
		asset.canWrite && { label: asset.dueDate ? t('deliver', 'Change the Due Date') : t('deliver', 'Set a Due Date'), icon: dueIcon, action: () => { dueFor.value = [asset] } },
		asset.canWrite && !isMobile.value && { label: t('deliver', 'Manage Versions'), icon: stackIcon, action: () => { managing.value = asset.id } },
		asset.canWrite && { label: t('deliver', 'Move to Project…'), icon: moveIcon, action: () => openAssign([asset]) },
		...(newest.url ? fileItems(newest.url, newest.name, asset.canWrite) : []),
		{
			label: t('deliver', 'Show in Files'),
			icon: filesIcon,
			href: generateUrl('/apps/files/files/{fileId}', { fileId: newest.fileId }) + '?' + new URLSearchParams({ dir, opendetails: 'true' }),
		},
		asset.canWrite && { label: project.value.none ? t('deliver', 'Remove from Deliver') : t('deliver', 'Remove from Project'), icon: removeIcon, danger: true, action: () => remove([asset]) },
		asset.canWrite && { label: t('deliver', 'Delete'), icon: deleteIcon, danger: true, action: () => deleteFiles([asset]) },
	]
}

/**
 * Only what applies to each ticked Asset on its own; opening, comparing,
 * Versions and the file of one Asset stay on its own menu
 *
 * @return {Array<object|false>} the menu of the ticked Assets
 */
function selectionItems() {
	const assets = project.value.assets.filter((asset) => selected.value.includes(asset.id))
	// Of Missing Assets, only their review data is left to go
	if (tickedMissing.value) {
		return [
			{ label: t('deliver', 'Clear the selection'), icon: clearIcon, action: () => { selected.value = [] } },
			{ label: t('deliver', 'Delete'), icon: deleteIcon, danger: true, action: () => deleteFiles(assets) },
		]
	}
	const failed = assets.filter((asset) => asset.versions[0].processingFailed)
	return [
		failed.length > 0 && { label: t('deliver', 'Process again'), icon: retryIcon, action: () => processAgain(failed) },
		{ label: t('deliver', 'Set a Due Date'), icon: dueIcon, action: () => { dueFor.value = assets } },
		{ label: t('deliver', 'Move to Project…'), icon: moveIcon, action: () => openAssign(assets) },
		{ label: t('deliver', 'Clear the selection'), icon: clearIcon, action: () => { selected.value = [] } },
		{ label: project.value.none ? t('deliver', 'Remove from Deliver') : t('deliver', 'Remove from Project'), icon: removeIcon, danger: true, action: () => remove(assets) },
		{ label: t('deliver', 'Delete'), icon: deleteIcon, danger: true, action: () => deleteFiles(assets) },
	]
}

/**
 * @param {object} asset - the Asset the next Version is for
 */
function pickVersion(asset) {
	stackOn.value = asset
	// Set before the click: the next Version is the same kind of media
	versionInput.value.accept = acceptFor(asset.versions[0]?.mimeType)
	versionInput.value.click()
}

/**
 * Uploads the picked file next to the Asset's newest Version and stacks it on top (story 17)
 *
 * @param {Event} event - the file input's change event
 */
function uploadStacked(event) {
	const file = event.target.files?.[0]
	event.target.value = ''
	if (file && stackOn.value) {
		uploads.add([file], { folderUrl: davFolder(stackOn.value.path), projectId: project.value.id, assetId: stackOn.value.id, kind: stackKind(stackOn.value.versions) })
	}
}

/**
 * Makes the derived media of the newest Versions again after they failed (story 140)
 *
 * @param {object[]} assets - Assets whose newest Version failed
 */
function processAgain(assets) {
	return forEach(assets, (asset) => regenerateVersion(asset.versions[0].id))
}

/**
 * @param {string|null} dueDate - the new Due Date of the Assets in dueFor, or null
 */
function setDue(dueDate) {
	return forEach(dueFor.value, (asset) => updateAsset(asset.id, { dueDate }))
}

/**
 * Removes Assets with their Comments and Versions; the files stay, and Auto Intake leaves them out (stories 4 and 132)
 *
 * @param {object[]} assets - the Assets to remove
 */
async function remove(assets) {
	const confirmed = await confirmRemoval(
		project.value.none
			? n('deliver', 'Remove this Asset from Deliver?', 'Remove %n Assets from Deliver?', assets.length)
			: n('deliver', 'Remove this Asset from the Project?', 'Remove %n Assets from the Project?', assets.length),
		n('deliver', 'Its Comments and Versions are deleted. The files themselves stay untouched.', 'Their Comments and Versions are deleted. The files themselves stay untouched.', assets.length),
		t('deliver', 'Remove'),
	)
	if (confirmed) {
		await forEach(assets, (asset) => disableAsset(asset.id))
	}
}

/**
 * Deletes Assets with their files: the files go to the trash of Files, the
 * Assets leave at once instead of turning Missing (story 141)
 *
 * @param {object[]} assets - the Assets to delete
 */
async function deleteFiles(assets) {
	const confirmed = await confirmRemoval(
		n('deliver', 'Delete this Asset?', 'Delete %n Assets?', assets.length),
		assets.every(allMissing)
			? n('deliver', 'Its files are in the trash of Files already. Its Comments, Drawings and Approvals are deleted.', 'Their files are in the trash of Files already. Their Comments, Drawings and Approvals are deleted.', assets.length)
			: n('deliver', 'The files of all its Versions go to the trash of Files. Its Comments, Drawings and Approvals are deleted.', 'The files of all their Versions go to the trash of Files. Their Comments, Drawings and Approvals are deleted.', assets.length),
		t('deliver', 'Delete'),
	)
	if (confirmed) {
		await forEach(assets, (asset) => deleteAsset(asset.id))
	}
}

/**
 * A drop uploads at once, with the card in the corner (story 134)
 *
 * @param {DragEvent} event - the drop
 */
function dropped(event) {
	dragDepth.value = 0
	if (uploads.target) {
		uploads.add([...(event.dataTransfer?.files ?? [])], uploads.target)
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
					:aria-label="t('deliver', 'Upload')"
					@click="uploads.expanded = true">
					<template #icon>
						<NcIconSvgWrapper :svg="uploadIcon" />
					</template>
					<template v-if="!isMobile">
						{{ t('deliver', 'Upload') }}
					</template>
				</NcButton>
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
				:sorts="SORT_OPTIONS">
				<template #start>
					<!-- Ticked while any Asset is: a click clears the selection, otherwise it ticks every card on screen that may be changed -->
					<input
						v-if="selectable.length"
						class="deliver-project__select-all"
						type="checkbox"
						:checked="selected.length > 0"
						:aria-label="selected.length ? t('deliver', 'Clear the selection') : t('deliver', 'Select all')"
						:title="selected.length ? t('deliver', 'Clear the selection') : t('deliver', 'Select all')"
						@change="selected = selected.length ? [] : selectable.map((asset) => asset.id)">
				</template>
			</FilterBar>
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
						:selected="selected.includes(asset.id)"
						:selecting="selected.length > 0"
						:locked="tickedMissing !== null && tickedMissing !== allMissing(asset)"
						@select="toggle(asset, $event)"
						@pick="pick(asset, $event)"
						@stack="accept"
						@versions="managing = $event.id"
						@contextmenu.prevent="openMenu($event, asset)"
						@menu="openMenu($event, asset)" />
				</ul>
			</section>
			<section v-if="notUpForReview.length" class="deliver-project__group">
				<h3 class="deliver-project__folder deliver-project__not-up-head">
					<NcIconSvgWrapper :svg="notUpIcon" :size="20" />
					{{ t('deliver', 'Not up for review') }}
				</h3>
				<ul class="deliver-project__grid">
					<NotUpForReviewCard
						v-for="file in notUpForReview"
						:key="file.fileId"
						:file="file"
						:where="file.path ? file.path : project.name"
						:canAdd="file.canWrite"
						:adding="adding.has(file.fileId)"
						@add="add(file)"
						@contextmenu.prevent="openFileMenu($event, file)"
						@menu="openFileMenu($event, file)" />
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
				:name="assigning.length === 1
					? t('deliver', 'Move {asset} to another Project', { asset: assigning[0].name })
					: n('deliver', 'Move %n Asset to another Project', 'Move %n Assets to another Project', assigning.length)"
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
			<NcDialog
				v-if="stackingFile"
				:name="t('deliver', 'Add {file} as a new Version', { file: stackingFile.name })"
				size="small"
				@closing="stackingFile = null">
				<p class="deliver-project__hint">
					{{ t('deliver', 'It goes on top of the Asset\'s Version Stack.') }}
				</p>
				<NcSelect
					v-model="stackTarget"
					:inputLabel="t('deliver', 'Asset')"
					:options="stackOptions"
					:clearable="false" />
				<template #actions>
					<NcButton variant="primary" :disabled="!stackTarget" @click="addAsVersion">
						{{ t('deliver', 'Add') }}
					</NcButton>
				</template>
			</NcDialog>
			<RenameDialog
				v-if="renaming"
				:name="renaming.name"
				@rename="rename"
				@close="renaming = null" />
			<DueDateDialog
				v-if="dueFor"
				:modelValue="dueFor.length === 1 ? dueFor[0].dueDate : null"
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

.deliver-project__select-all {
	width: 20px;
	height: 20px;
	min-height: 0;
	margin: 0 calc(2 * var(--default-grid-baseline));
	cursor: pointer;
	accent-color: var(--color-primary-element);
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

.deliver-project__not-up-head {
	color: var(--color-text-maxcontrast);
}
</style>

<style scoped src="../components/card.css"></style>
