<script setup>
import { emit } from '@nextcloud/event-bus'
import { Permission } from '@nextcloud/files'
import { getClient, getDefaultPropfind, getRootPath, resultToNode } from '@nextcloud/files/dav'
import { n, t } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import { computed, ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import ProjectSettingsFields from '../components/ProjectSettingsFields.vue'
import ShareLinks from '../components/ShareLinks.vue'
import {
	assignAsset,
	createProject,
	disableAsset,
	enableFile,
	getAssetForFile,
	getProjectForFolder,
	listProjects,
	removeProject,
	updateProject,
} from '../api.js'
import { useBusy } from '../composables/busy.js'
import { confirmProjectRemoval, confirmRemoval } from '../confirm.js'

// The Files app also sets folder, view and active on the web component; only node is used
const props = defineProps({
	/** The folder or media file the sidebar is open for */
	node: { type: Object, default: null },
})

/** On a folder: its Project, or null */
const project = ref(null)
/** On a media file: its Asset, or null */
const asset = ref(null)
/** On a folder that is no Project yet: whether the Project it becomes takes in every media file */
const intake = ref(true)
/** Where an enabled file can go: the Projects this Member sees, and No Project (ADR 0009) */
const projects = ref([])
const { busy, error, run } = useBusy()

const isFolder = computed(() => props.node?.type === 'folder')
const canWrite = computed(() => ((props.node?.permissions ?? 0) & Permission.UPDATE) !== 0)
// Auto Intake decides for every media file in the folder, so single files cannot opt out
const ownedByAutoIntake = computed(() => !isFolder.value && asset.value?.autoIntake === true)
const NO_PROJECT = { id: 0, label: t('deliver', 'No Project') }
const projectOptions = computed(() => [
	NO_PROJECT,
	...projects.value.filter((each) => !each.none).map((each) => ({ id: each.id, label: each.name })),
])
const assignedTo = computed(() => projectOptions.value.find((each) => each.id === asset.value?.projectId)
	?? (asset.value ? { id: asset.value.projectId, label: asset.value.projectName ?? '' } : null))
const appUrl = computed(() => {
	if (asset.value) {
		return generateUrl('/apps/deliver/versions/{id}', { id: asset.value.versionId })
	}
	return project.value ? generateUrl('/apps/deliver/projects/{id}', { id: project.value.id }) : null
})

watch(() => props.node?.fileid, (fileid) => {
	project.value = null
	asset.value = null
	intake.value = true
	error.value = null
	if (!fileid) {
		return
	}
	run(async () => {
		const found = await (isFolder.value ? getProjectForFolder(fileid) : getAssetForFile(fileid)).catch((e) => {
			if (e?.response?.status === 404) {
				return null
			}
			throw e
		})
		// The sidebar may have moved on to another node meanwhile
		if (props.node?.fileid === fileid) {
			project.value = isFolder.value ? found : null
			asset.value = isFolder.value ? null : found
		}
		if (!isFolder.value && projects.value.length === 0) {
			projects.value = await listProjects().catch(() => [])
		}
	})
}, { immediate: true })

/**
 * Puts the file's Asset into another Project, or into No Project; the file stays where it is
 *
 * @param {{id: number}} option - the Project picked
 */
function assign(option) {
	if (!option || option.id === asset.value?.projectId) {
		return
	}
	return run(async () => {
		await assignAsset(asset.value.assetId, option.id)
		asset.value = await getAssetForFile(props.node.fileid)
	})
}

/** Turns the folder into a Folder Project, with Auto Intake as switched (stories 2 and 3) */
function makeProject() {
	return run(async () => {
		project.value = await createProject(props.node.fileid, intake.value)
	})
}

/**
 * Auto Intake: before the folder is a Project only the choice for it, after that the Project's own setting
 *
 * @param {boolean} checked - the new switch state
 */
function setIntake(checked) {
	if (project.value === null) {
		intake.value = checked
		return
	}
	return run(async () => {
		project.value = await updateProject(project.value.id, { autoIntake: checked })
	})
}

/**
 * Enables or disables review of a file (stories 1 and 4)
 *
 * @param {boolean} checked - the new switch state
 */
function toggle(checked) {
	return run(async () => {
		if (checked) {
			asset.value = await enableFile(props.node.fileid)
		} else if (await confirmRemoval(
			t('deliver', 'Take this file out of Deliver?'),
			t('deliver', 'Its Comments and Versions are deleted. The file itself stays untouched.'),
			t('deliver', 'Take out'),
		)) {
			await disableAsset(asset.value.assetId)
			asset.value = null
		}
	})
}

/**
 * @param {object} settings - the Project settings to change
 */
function saveSettings(settings) {
	return run(async () => {
		project.value = await updateProject(project.value.id, settings)
	})
}

/** The file list shows a link's share icon once it has the node again, as Nextcloud's own sharing tab does */
async function refreshNode() {
	const { data } = await getClient().stat(getRootPath() + props.node.path, { details: true, data: getDefaultPropfind() })
	emit('files:node:updated', resultToNode(data))
}

/** Removes the Project with all its review data (story 9) */
async function remove() {
	if (await confirmProjectRemoval()) {
		await run(async () => {
			await removeProject(project.value.id)
			project.value = null
		})
	}
}
</script>

<template>
	<div class="deliver-tab">
		<template v-if="isFolder">
			<NcCheckboxRadioSwitch
				type="switch"
				:modelValue="project ? project.autoIntake : intake"
				:disabled="busy || !canWrite"
				@update:modelValue="setIntake">
				{{ t('deliver', 'Auto Intake: review every media file in this folder') }}
			</NcCheckboxRadioSwitch>
			<NcButton
				v-if="!project"
				variant="primary"
				:disabled="busy || !canWrite"
				@click="makeProject">
				{{ t('deliver', 'Make this folder a Project') }}
			</NcButton>
		</template>
		<NcCheckboxRadioSwitch
			v-else
			type="switch"
			:modelValue="asset !== null"
			:disabled="busy || !canWrite || ownedByAutoIntake"
			@update:modelValue="toggle">
			{{ t('deliver', 'Review in Deliver') }}
		</NcCheckboxRadioSwitch>
		<p v-if="ownedByAutoIntake" class="deliver-tab__hint">
			{{ t('deliver', 'This folder is on Auto Intake. Switch it off in the folder to pick files one by one.') }}
		</p>
		<p v-else-if="!canWrite" class="deliver-tab__hint">
			{{ isFolder
				? t('deliver', 'Write permission on the folder is required to turn it into a Project.')
				: t('deliver', 'Write permission on the file is required to enable it for review.') }}
		</p>
		<p v-else-if="isFolder && project && !project.autoIntake" class="deliver-tab__hint">
			{{ t('deliver', 'Files in this Project are enabled one by one, in the Deliver tab of each file.') }}
		</p>

		<NcSelect
			v-if="asset"
			class="deliver-tab__project"
			:inputLabel="t('deliver', 'Project')"
			:options="projectOptions"
			:modelValue="assignedTo"
			:clearable="false"
			:disabled="busy || !asset.canWrite || ownedByAutoIntake"
			@update:modelValue="assign" />

		<p v-if="asset" class="deliver-tab__hint">
			{{ t('deliver', 'Version {number}', { number: asset.number }) }}
			· {{ n('deliver', '%n Comment', '%n Comments', asset.comments) }}
			<template v-if="asset.state === 'missing'">
				· {{ t('deliver', 'Missing') }}
			</template>
		</p>

		<section v-if="isFolder && project && canWrite" class="deliver-tab__section">
			<h4>{{ t('deliver', 'Project settings') }}</h4>
			<ProjectSettingsFields :project="project" :disabled="busy" @save="saveSettings" />
		</section>

		<section v-if="asset || project" class="deliver-tab__section">
			<h4>{{ t('deliver', 'Share Links') }}</h4>
			<ShareLinks :fileId="node.fileid" :canWrite="canWrite" @changed="refreshNode" />
		</section>

		<NcNoteCard v-if="error" type="error">
			{{ error }}
		</NcNoteCard>
		<NcButton v-if="appUrl" :href="appUrl" variant="primary">
			{{ t('deliver', 'Open in Deliver') }}
		</NcButton>
		<NcButton
			v-if="isFolder && project && canWrite"
			:disabled="busy"
			variant="tertiary"
			@click="remove">
			{{ t('deliver', 'Remove Project') }}
		</NcButton>
	</div>
</template>

<style scoped>
.deliver-tab {
	display: flex;
	flex-direction: column;
	gap: calc(var(--default-grid-baseline) * 2);
	align-items: flex-start;
}

.deliver-tab__hint {
	color: var(--color-text-maxcontrast);
}

.deliver-tab__project {
	width: 100%;
}

.deliver-tab__section {
	display: flex;
	flex-direction: column;
	gap: var(--default-grid-baseline);
	width: 100%;
	border-top: 1px solid var(--color-border);
	padding-top: calc(var(--default-grid-baseline) * 2);
}
</style>
