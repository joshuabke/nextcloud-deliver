<script setup>
import { t } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import { ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import ProjectSettingsFields from './ProjectSettingsFields.vue'
import { useBusy } from '../composables/busy.js'
import { confirmProjectRemoval } from '../confirm.js'
import { projectDir } from '../lib/folders.js'
import { useProjectsStore } from '../store/projects.js'

const props = defineProps({
	/** The Project to set up, as the Project list or the Project view has it */
	project: { type: Object, required: true },
})

const emit = defineEmits(['close', 'removed'])

const store = useProjectsStore()
const { busy, error, run } = useBusy()
const filesUrl = props.project.path ? generateUrl('/apps/files/') + '?' + new URLSearchParams({ dir: projectDir(props.project.path) }) : null
/** A Project without a folder has a name of its own (ADR 0009) */
const name = ref(props.project.name)

/**
 * @param {object} fields - the settings to change, or muted
 */
function save(fields) {
	return run(() => store.save(props.project.id, fields))
}

/** Removes the Project with all its review data (story 9) */
async function remove() {
	if (await confirmProjectRemoval()) {
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
				<NcTextField
					v-if="!project.folderId"
					v-model="name"
					:label="t('deliver', 'Name')"
					:disabled="busy"
					@blur="name.trim() && name !== project.name && save({ name })" />
				<NcCheckboxRadioSwitch
					v-else
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
			<NcButton v-if="filesUrl" :href="filesUrl">
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
