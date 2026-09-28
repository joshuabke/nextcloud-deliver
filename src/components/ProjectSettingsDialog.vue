<script setup>
import { t } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import { ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import ProjectSettingsFields from './ProjectSettingsFields.vue'
import { errorMessage } from '../api.js'
import { confirmRemoval } from '../confirm.js'
import { projectDir } from '../lib/folders.js'
import { useProjectsStore } from '../store/projects.js'

const props = defineProps({
	/** The Project to set up, as the Project list or the Project view has it */
	project: { type: Object, required: true },
})

const emit = defineEmits(['close', 'removed'])

const store = useProjectsStore()
const busy = ref(false)
const error = ref(null)
const filesUrl = generateUrl('/apps/files/') + '?' + new URLSearchParams({ dir: projectDir(props.project.path) })

/**
 * @param {() => Promise<unknown>} action - what to run while the dialog is busy
 */
async function run(action) {
	busy.value = true
	error.value = null
	try {
		await action()
	} catch (e) {
		error.value = errorMessage(e)
	} finally {
		busy.value = false
	}
}

/**
 * @param {object} fields - the settings to change, or muted
 */
function save(fields) {
	return run(() => store.save(props.project.id, fields))
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
			await store.remove(props.project.id)
			emit('removed')
		})
	}
}
</script>

<template>
	<NcDialog
		:name="t('deliver', 'Settings of {project}', { project: project.name })"
		size="normal"
		@closing="emit('close')">
		<div class="deliver-project-settings">
			<NcCheckboxRadioSwitch
				type="switch"
				:modelValue="project.muted"
				:disabled="busy"
				@update:modelValue="save({ muted: $event })">
				{{ t('deliver', 'Mute notifications') }}
			</NcCheckboxRadioSwitch>
			<template v-if="project.canWrite">
				<NcCheckboxRadioSwitch
					type="switch"
					:modelValue="project.autoIntake"
					:disabled="busy"
					@update:modelValue="save({ autoIntake: $event })">
					{{ t('deliver', 'Auto Intake: review every media file in this folder') }}
				</NcCheckboxRadioSwitch>
				<ProjectSettingsFields :project="project" :disabled="busy" @save="save" />
			</template>
			<NcNoteCard v-if="error" type="error">
				{{ error }}
			</NcNoteCard>
		</div>
		<template #actions>
			<NcButton
				v-if="project.canWrite"
				variant="error"
				:disabled="busy"
				@click="remove">
				{{ t('deliver', 'Remove Project') }}
			</NcButton>
			<NcButton :href="filesUrl">
				{{ t('deliver', 'Open in Files') }}
			</NcButton>
		</template>
	</NcDialog>
</template>

<style scoped>
.deliver-project-settings {
	display: flex;
	flex-direction: column;
	gap: calc(2 * var(--default-grid-baseline));
	padding-bottom: calc(2 * var(--default-grid-baseline));
}
</style>
