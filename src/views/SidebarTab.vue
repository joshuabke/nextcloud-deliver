<script setup>
import { DialogBuilder } from '@nextcloud/dialogs'
import { Permission } from '@nextcloud/files'
import { n, t } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import { computed, ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import ShareLinkItem from '../components/ShareLinkItem.vue'
import {
	createProject,
	createShareLink,
	disableAsset,
	enableFile,
	errorMessage,
	getAssetForFile,
	getProjectForFolder,
	listShares,
	removeProject,
	updateProject,
} from '../api.js'

// The Files app also sets folder, view and active on the web component; only node is used
const props = defineProps({
	/** The folder or media file the sidebar is open for */
	node: { type: Object, default: null },
})

/** Frame rates a Project can default to, for Assets whose own rate is unknown (story 7) */
const RATES = [
	{ id: '24000/1001', label: '23.976' },
	{ id: '24/1', label: '24' },
	{ id: '25/1', label: '25' },
	{ id: '30000/1001', label: '29.97' },
	{ id: '30/1', label: '30' },
	{ id: '50/1', label: '50' },
	{ id: '60000/1001', label: '59.94' },
	{ id: '60/1', label: '60' },
]
const MODES = [
	{ id: 'smpte', label: t('deliver', 'Timecode') },
	{ id: 'frames', label: t('deliver', 'Frame counter') },
	{ id: 'seconds', label: t('deliver', 'Seconds') },
]

/** On a folder: its Project, or null */
const project = ref(null)
/** On a media file: its Asset, or null */
const asset = ref(null)
/** The Share Links of this node; review is a switch on each (ADR 0004) */
const shares = ref([])
const busy = ref(false)
const error = ref(null)

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
const rate = computed(() => RATES.find((each) => each.id === `${project.value?.fps.num}/${project.value?.fps.den}`) ?? null)
const mode = computed(() => MODES.find((each) => each.id === project.value?.timecodeMode) ?? null)

watch(() => props.node?.fileid, async (fileid) => {
	project.value = null
	asset.value = null
	shares.value = []
	error.value = null
	if (!fileid) {
		return
	}
	busy.value = true
	try {
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
	} catch (e) {
		error.value = errorMessage(e)
	} finally {
		busy.value = false
	}
}, { immediate: true })

/**
 * @param {string} title - dialog title
 * @param {string} text - what gets deleted
 * @param {string} confirm - label of the destructive button
 * @return {Promise<boolean>} whether the person confirmed
 */
function confirmRemoval(title, text, confirm) {
	return new Promise((resolve) => {
		new DialogBuilder(title)
			.setText(text)
			.addButton({ label: t('deliver', 'Cancel'), callback: () => resolve(false) })
			.addButton({ label: confirm, variant: 'error', callback: () => resolve(true) })
			.build()
			.show()
			.then(() => resolve(false))
	})
}

/**
 * @param {() => Promise<unknown>} action - what to run while the tab is busy
 */
async function run(action) {
	error.value = null
	busy.value = true
	try {
		await action()
	} catch (e) {
		error.value = errorMessage(e)
	} finally {
		busy.value = false
	}
}

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
	const confirmed = await confirmRemoval(
		t('deliver', 'Remove Project?'),
		t('deliver', 'Its Comments and Version Stacks are deleted. The files stay untouched.'),
		t('deliver', 'Remove Project'),
	)
	if (confirmed) {
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
			<NcSelect
				:modelValue="rate"
				:options="RATES"
				:clearable="false"
				:disabled="busy"
				:inputLabel="t('deliver', 'Frame rate when a file does not tell')"
				@update:modelValue="saveSettings({ fpsNum: Number($event.id.split('/')[0]), fpsDen: Number($event.id.split('/')[1]) })" />
			<NcSelect
				:modelValue="mode"
				:options="MODES"
				:clearable="false"
				:disabled="busy"
				:inputLabel="t('deliver', 'Show time as')"
				@update:modelValue="saveSettings({ timecodeMode: $event.id })" />
			<NcCheckboxRadioSwitch
				:modelValue="project.allowOlder"
				:disabled="busy"
				@update:modelValue="saveSettings({ allowOlder: $event })">
				{{ t('deliver', 'Members may comment on older Versions') }}
			</NcCheckboxRadioSwitch>
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
	gap: calc(var(--default-grid-baseline, 4px) * 2);
	align-items: flex-start;
}

.deliver-tab__hint {
	color: var(--color-text-maxcontrast);
}

.deliver-tab__section {
	display: flex;
	flex-direction: column;
	gap: var(--default-grid-baseline, 4px);
	width: 100%;
	border-top: 1px solid var(--color-border);
	padding-top: calc(var(--default-grid-baseline, 4px) * 2);
}
</style>
