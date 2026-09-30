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
import ProjectSettingsFields from '../components/ProjectSettingsFields.vue'
import ShareLinkItem from '../components/ShareLinkItem.vue'
import {
	createProject,
	createShareLink,
	disableAsset,
	enableFile,
	getAssetForFile,
	getProjectForFolder,
	listShares,
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
/** The Share Links of this node; review is a switch on each (ADR 0004) */
const shares = ref([])
const { busy, error, run } = useBusy()

const isFolder = computed(() => props.node?.type === 'folder')
const canWrite = computed(() => ((props.node?.permissions ?? 0) & Permission.UPDATE) !== 0)
const enabled = computed(() => isFolder.value ? project.value?.autoIntake === true : asset.value !== null)
// Auto Intake decides for every media file in the folder, so single files cannot opt out
const ownedByAutoIntake = computed(() => !isFolder.value && asset.value?.autoIntake === true)
const projectId = computed(() => isFolder.value ? project.value?.id : asset.value?.projectId)
const appUrl = computed(() => {
	if (asset.value) {
		return generateUrl('/apps/deliver/versions/{id}', { id: asset.value.versionId })
	}
	return projectId.value ? generateUrl('/apps/deliver/projects/{id}', { id: projectId.value }) : null
})

watch(() => props.node?.fileid, (fileid) => {
	project.value = null
	asset.value = null
	shares.value = []
	error.value = null
	if (!fileid) {
		return
	}
	run(async () => {
		const [found, links] = await Promise.all([
			(isFolder.value ? getProjectForFolder(fileid) : getAssetForFile(fileid)).catch((e) => {
				if (e?.response?.status === 404) {
					return null
				}
				throw e
			}),
			listShares(fileid),
		])
		// The sidebar may have moved on to another node meanwhile
		if (props.node?.fileid === fileid) {
			project.value = isFolder.value ? found : null
			asset.value = isFolder.value ? null : found
			shares.value = links
		}
	})
}, { immediate: true })

/**
 * On a folder the switch is Auto Intake (stories 2 and 3), on a file it
 * enables or disables review of that file (stories 1 and 4).
 *
 * @param {boolean} checked - the new switch state
 */
function toggle(checked) {
	return run(async () => {
		if (isFolder.value) {
			project.value = project.value === null
				? await createProject(props.node.fileid, true)
				: await updateProject(project.value.id, { autoIntake: checked })
		} else if (checked) {
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

/** A new Share Link with review already on (story 45) */
function addLink() {
	return run(async () => {
		shares.value = [...shares.value, await createShareLink(props.node.fileid)]
		// The file list shows the new link's share icon once it has the node again, as Nextcloud's own sharing tab does
		const { data } = await getClient().stat(getRootPath() + props.node.path, { details: true, data: getDefaultPropfind() })
		emit('files:node:updated', resultToNode(data))
	})
}

/**
 * @param {object} updated - the Share Link as the server returned it
 */
function replaceShare(updated) {
	shares.value = shares.value.map((each) => each.id === updated.id ? updated : each)
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
		<NcCheckboxRadioSwitch
			type="switch"
			:modelValue="enabled"
			:disabled="busy || !canWrite || ownedByAutoIntake"
			@update:modelValue="toggle">
			{{ isFolder ? t('deliver', 'Auto Intake: review every media file in this folder') : t('deliver', 'Review in Deliver') }}
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

		<section v-if="projectId" class="deliver-tab__section">
			<h4>{{ t('deliver', 'Share Links') }}</h4>
			<p v-if="shares.length === 0" class="deliver-tab__hint">
				{{ t('deliver', 'No link yet. A link shows the files; review is a switch on it.') }}
			</p>
			<ShareLinkItem
				v-for="share in shares"
				:key="share.id"
				:share="share"
				:canWrite="canWrite"
				@update="replaceShare" />
			<NcButton :disabled="busy || !canWrite" variant="secondary" @click="addLink">
				{{ t('deliver', 'Create Review Link') }}
			</NcButton>
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

.deliver-tab__section {
	display: flex;
	flex-direction: column;
	gap: var(--default-grid-baseline);
	width: 100%;
	border-top: 1px solid var(--color-border);
	padding-top: calc(var(--default-grid-baseline) * 2);
}
</style>
