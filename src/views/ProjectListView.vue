<script setup>
import icon from '@mdi/svg/svg/folder-play-outline.svg?raw'
import addIcon from '@mdi/svg/svg/plus.svg?raw'
import { FilePickerType, getFilePickerBuilder } from '@nextcloud/dialogs'
import { t } from '@nextcloud/l10n'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import ProjectCard from '../components/ProjectCard.vue'
import ProjectSettingsDialog from '../components/ProjectSettingsDialog.vue'
import { errorMessage } from '../api.js'
import { useProjectsStore } from '../store/projects.js'

const store = useProjectsStore()
const router = useRouter()
const error = ref(null)
/** The Project whose settings are open */
const settings = ref(null)
// Every visit shows the news as they are now
store.fetchAll()

/** Where something happened last comes first */
const projects = computed(() => [...store.projects].sort((a, b) => b.activity.lastActivity - a.activity.lastActivity))

/** Picks a folder, or makes one, and turns it into a Project with Auto Intake (story 98) */
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
		<h2 class="deliver-projects__head">
			{{ t('deliver', 'Projects') }}
		</h2>
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
				@settings="settings = project" />
			<li>
				<button type="button" class="deliver-projects__new" @click="create">
					<NcIconSvgWrapper :svg="projects.length ? addIcon : icon" :size="projects.length ? 32 : 48" />
					<strong>{{ t('deliver', 'New Project') }}</strong>
					<span>{{ t('deliver', 'Pick a folder or make one') }}</span>
				</button>
			</li>
		</ul>
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
	gap: calc(4 * var(--default-grid-baseline, 4px));
	padding: 0 calc(4 * var(--default-grid-baseline, 4px)) calc(6 * var(--default-grid-baseline, 4px));
}

.deliver-projects__head {
	display: flex;
	align-items: center;
	min-height: calc(var(--default-clickable-area, 34px) + 4 * var(--default-grid-baseline, 4px));
	margin: 0;
	border-bottom: 1px solid var(--color-border);
	font-size: 20px;
}

.deliver-projects__new {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: var(--default-grid-baseline, 4px);
	width: calc(100% - 4 * var(--default-grid-baseline, 4px));
	min-height: 0;
	aspect-ratio: 16 / 9;
	margin: calc(2 * var(--default-grid-baseline, 4px));
	padding: calc(4 * var(--default-grid-baseline, 4px));
	border: 2px dashed var(--color-border-dark);
	border-radius: var(--border-radius, 8px);
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
	gap: calc(2 * var(--default-grid-baseline, 4px));
}
</style>
