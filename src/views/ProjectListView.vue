<script setup>
import muteIcon from '@mdi/svg/svg/bell-off-outline.svg?raw'
import unmuteIcon from '@mdi/svg/svg/bell-outline.svg?raw'
import settingsIcon from '@mdi/svg/svg/cog-outline.svg?raw'
import removeIcon from '@mdi/svg/svg/delete-outline.svg?raw'
import filesIcon from '@mdi/svg/svg/folder-outline.svg?raw'
import icon from '@mdi/svg/svg/folder-play-outline.svg?raw'
import openIcon from '@mdi/svg/svg/open-in-app.svg?raw'
import addIcon from '@mdi/svg/svg/plus.svg?raw'
import { FilePickerType, getFilePickerBuilder } from '@nextcloud/dialogs'
import { loadState } from '@nextcloud/initial-state'
import { t } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import ContextMenu from '../components/ContextMenu.vue'
import FilterBar from '../components/FilterBar.vue'
import ProjectCard from '../components/ProjectCard.vue'
import ProjectSettingsDialog from '../components/ProjectSettingsDialog.vue'
import { errorMessage, makeFolder } from '../api.js'
import { useQuery } from '../composables/query.js'
import { confirmProjectRemoval } from '../confirm.js'
import { FILTER_LABELS, PROJECT_FILTERS, projectPasses, SORT_OPTIONS, sortProjects, SORTS } from '../lib/filters.js'
import { projectDir } from '../lib/folders.js'
import { useProjectsStore } from '../store/projects.js'

const store = useProjectsStore()
const router = useRouter()
const error = ref(null)
/** The Project whose settings are open */
const settings = ref(null)
// Every visit shows the news as they are now
store.fetchAll()

const filter = useQuery('filter', PROJECT_FILTERS, 'all')
const sort = useQuery('sort', SORTS, 'activity')
const query = useQuery('q', null, '')
const filters = computed(() => PROJECT_FILTERS.map((id) => ({
	id,
	label: FILTER_LABELS[id],
	count: store.projects.filter((project) => projectPasses(project, id)).length,
})))
const projects = computed(() => sortProjects(
	store.projects.filter((project) => projectPasses(project, filter.value)
		&& project.name.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())),
	sort.value,
))

/** The right-click menu: where, and for which Project */
const menu = ref(null)

/**
 * @param {{clientX: number, clientY: number}} event - the right click, the long press or the menu button
 * @param {object} project - the Project under it
 */
function openMenu(event, project) {
	menu.value = {
		x: event.clientX,
		y: event.clientY,
		items: [
			!project.none && { label: t('deliver', 'Project settings'), icon: settingsIcon, action: () => { settings.value = project } },
			{ label: t('deliver', 'Open'), icon: openIcon, action: () => router.push(`/projects/${project.id}`) },
			project.muted
				? { label: t('deliver', 'Notify me again'), icon: unmuteIcon, action: () => save(project, { muted: false }) }
				: { label: t('deliver', 'Mute notifications'), icon: muteIcon, action: () => save(project, { muted: true }) },
			project.path && { label: t('deliver', 'Open in Files'), icon: filesIcon, href: generateUrl('/apps/files/') + '?' + new URLSearchParams({ dir: projectDir(project.path) }) },
			project.canWrite && { label: t('deliver', 'Remove Project'), icon: removeIcon, danger: true, action: () => remove(project) },
		].filter(Boolean),
	}
}

/**
 * @param {object} project - the Project to change
 * @param {object} fields - its new settings
 */
async function save(project, fields) {
	try {
		await store.save(project.id, fields)
	} catch (e) {
		error.value = errorMessage(e)
	}
}

/**
 * Deletes the Project with its Assets (story 148), or keeps them in No Project (story 9), after asking
 *
 * @param {object} project - the Project to remove
 */
async function remove(project) {
	const withAssets = await confirmProjectRemoval()
	if (withAssets !== null) {
		try {
			await store.remove(project.id, withAssets)
		} catch (e) {
			error.value = errorMessage(e)
		}
	}
}

/** The name of a new Project, while its dialog is open */
const naming = ref(null)
/** Whether the new Project gets a folder of its own, named after it, for uploads to go to (story 98) */
const ownFolder = ref(true)
/** Where that folder goes, from the Member's home: the admin's default place, /Deliver unless set otherwise */
const parent = ref(loadState('deliver', 'projectFolder', '/Deliver'))
const folderPath = computed(() => `${parent.value.replace(/\/$/, '')}/${naming.value?.trim() ?? ''}`)

/** Picks the folder the new Project's folder goes into */
async function pickParent() {
	try {
		const [folder] = await getFilePickerBuilder(t('deliver', 'Where the folder of the new Project goes'))
			.setMultiSelect(false)
			.allowDirectories(true)
			.setMimeTypeFilter(['httpd/unix-directory'])
			.setType(FilePickerType.Choose)
			.build()
			.pickNodes()
		parent.value = folder.path || '/'
	} catch {
		// Closed without a choice
	}
}

/**
 * A Project with a new folder of its own, which makes it a Folder Project; or
 * one by name alone, which collects files from anywhere without moving them
 * and has nowhere to upload to (ADR 0009)
 */
async function createNamed() {
	error.value = null
	try {
		const project = ownFolder.value
			? await store.create(await makeFolder(folderPath.value))
			: await store.createNamed(naming.value)
		naming.value = null
		router.push(`/projects/${project.id}`)
	} catch (e) {
		error.value = errorMessage(e)
	}
}

/** Picks a folder, or makes one, and turns it into a Folder Project with Auto Intake (story 98) */
async function create() {
	error.value = null
	let folder
	try {
		[folder] = await getFilePickerBuilder(t('deliver', 'Pick the folder for the new Project'))
			.setMultiSelect(false)
			.allowDirectories(true)
			.setMimeTypeFilter(['httpd/unix-directory'])
			.setType(FilePickerType.Choose)
			.build()
			.pickNodes()
	} catch {
		// Closed without a choice
		return
	}
	try {
		const project = await store.create(folder.fileid)
		router.push(`/projects/${project.id}`)
	} catch (e) {
		error.value = errorMessage(e)
	}
}
</script>

<template>
	<div class="deliver-projects">
		<div class="deliver-projects__head">
			<h2>{{ t('deliver', 'Projects') }}</h2>
			<NcTextField
				v-if="store.projects.length"
				v-model="query"
				class="deliver-projects__search"
				:label="t('deliver', 'Find a Project')"
				type="search"
				:showTrailingButton="query !== ''"
				@trailingButtonClick="query = ''" />
		</div>
		<FilterBar
			v-if="store.projects.length"
			v-model:filter="filter"
			v-model:sort="sort"
			:filters="filters"
			:sorts="SORT_OPTIONS" />
		<NcNoteCard v-if="error" type="error">
			{{ error }}
		</NcNoteCard>
		<NcEmptyContent v-if="!store.loaded" :name="t('deliver', 'Loading…')">
			<template #icon>
				<NcLoadingIcon />
			</template>
		</NcEmptyContent>
		<ul v-else class="deliver-projects__grid">
			<ProjectCard
				v-for="project in projects"
				:key="project.id"
				:project="project"
				@contextmenu.prevent="openMenu($event, project)"
				@menu="openMenu($event, project)" />
			<li>
				<button type="button" class="deliver-projects__new" @click="naming = ''">
					<NcIconSvgWrapper :svg="projects.length ? addIcon : icon" :size="projects.length ? 32 : 48" />
					<strong>{{ t('deliver', 'New Project') }}</strong>
					<span>{{ t('deliver', 'Give it a name, and a folder of its own for uploads') }}</span>
				</button>
			</li>
			<li>
				<button type="button" class="deliver-projects__new" @click="create">
					<NcIconSvgWrapper :svg="filesIcon" :size="32" />
					<strong>{{ t('deliver', 'Project from a folder') }}</strong>
					<span>{{ t('deliver', 'Every media file in the folder is reviewed') }}</span>
				</button>
			</li>
		</ul>
		<NcDialog
			v-if="naming !== null"
			:name="t('deliver', 'New Project')"
			size="small"
			@closing="naming = null">
			<form id="deliver-new-project" @submit.prevent="createNamed">
				<NcTextField v-model="naming" :label="t('deliver', 'Name')" autofocus />
				<NcCheckboxRadioSwitch v-model="ownFolder" type="switch">
					{{ t('deliver', 'Create a Project folder') }}
				</NcCheckboxRadioSwitch>
				<div v-if="ownFolder" class="deliver-projects__folder">
					<span>{{ t('deliver', 'Folder: {path}', { path: folderPath }) }}</span>
					<NcButton variant="tertiary" @click="pickParent">
						{{ t('deliver', 'Choose a place') }}
					</NcButton>
				</div>
				<p v-else class="deliver-projects__hint">
					{{ t('deliver', 'Without a folder it collects files from anywhere, added in the Files sidebar; there is nowhere to upload to.') }}
				</p>
			</form>
			<template #actions>
				<NcButton
					type="submit"
					form="deliver-new-project"
					variant="primary"
					:disabled="!naming.trim() || (ownFolder && (naming.includes('/') || ['.', '..'].includes(naming.trim())))">
					{{ t('deliver', 'Create') }}
				</NcButton>
			</template>
		</NcDialog>
		<ContextMenu
			v-if="menu"
			v-bind="menu"
			@close="menu = null" />
		<ProjectSettingsDialog
			v-if="settings"
			:project="settings"
			@close="settings = null"
			@removed="settings = null" />
	</div>
</template>

<style scoped>
.deliver-projects {
	display: flex;
	flex-direction: column;
	gap: calc(4 * var(--default-grid-baseline));
	padding: 0 calc(4 * var(--default-grid-baseline)) calc(6 * var(--default-grid-baseline));
}

.deliver-projects__folder {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: calc(2 * var(--default-grid-baseline));
	min-width: 0;
	overflow-wrap: anywhere;
}

.deliver-projects__hint {
	color: var(--color-text-maxcontrast);
}

.deliver-projects__head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: calc(2 * var(--default-grid-baseline));
	min-height: calc(var(--default-clickable-area) + 4 * var(--default-grid-baseline));
	margin: 0;
	border-bottom: 1px solid var(--color-border);
}

.deliver-projects__head h2 {
	margin: 0;
	font-size: 20px;
}

.deliver-projects__search {
	width: 200px !important;
	flex: none;
}

.deliver-projects__new {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: var(--default-grid-baseline);
	width: calc(100% - 4 * var(--default-grid-baseline));
	min-height: 0;
	aspect-ratio: 16 / 9;
	margin: calc(2 * var(--default-grid-baseline));
	padding: calc(4 * var(--default-grid-baseline));
	border: 2px dashed var(--color-border-dark);
	border-radius: var(--border-radius);
	background: none;
	color: var(--color-text-maxcontrast);
	font-weight: normal;
	text-align: center;
	white-space: normal;
	cursor: pointer;
}

.deliver-projects__new:hover,
.deliver-projects__new:focus-visible {
	border-color: var(--color-primary-element);
	color: var(--color-main-text);
}

.deliver-projects__new strong {
	color: var(--color-main-text);
}

.deliver-projects__grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
	gap: calc(2 * var(--default-grid-baseline));
}
</style>
