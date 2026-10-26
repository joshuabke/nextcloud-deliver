<script setup>
import closedIcon from '@mdi/svg/svg/chevron-down.svg?raw'
import openIcon from '@mdi/svg/svg/chevron-up.svg?raw'
import { getCanonicalLocale } from '@nextcloud/l10n'
import { ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { deleteProjectForGood, listDeletedProjects, restoreProject } from '../api.js'
import { useBusy } from '../composables/busy.js'
import { confirmDeleteForGood } from '../confirm.js'
import { t } from '../lib/l10n.js'

// The Deleted Projects this Member may restore, collapsed at the end of the Project list (story 148)
const emit = defineEmits(['restored'])

const projects = ref([])
const open = ref(false)
const { busy, error, run } = useBusy()

/** Asks the server again, after a Project was deleted elsewhere on the page */
async function load() {
	projects.value = (await listDeletedProjects()).projects
}
run(load)
defineExpose({ load })

/**
 * @param {number} seconds - a Unix time
 * @return {string} its day, as the user's locale writes it
 */
const day = (seconds) => new Date(seconds * 1000).toLocaleDateString(getCanonicalLocale(), { dateStyle: 'medium' })

/**
 * @param {object} project - a Deleted Project
 */
function restore(project) {
	return run(async () => {
		await restoreProject(project.id)
		await load()
		emit('restored')
	})
}

/**
 * @param {object} project - a Deleted Project
 */
async function deleteForGood(project) {
	if (await confirmDeleteForGood(project.name)) {
		await run(async () => {
			await deleteProjectForGood(project.id)
			await load()
		})
	}
}
</script>

<template>
	<section v-if="projects.length || error" class="deliver-deleted">
		<NcButton
			v-if="projects.length"
			variant="tertiary"
			:aria-expanded="String(open)"
			@click="open = !open">
			<template #icon>
				<NcIconSvgWrapper :svg="open ? openIcon : closedIcon" />
			</template>
			{{ t('deliver', 'Deleted Projects ({count})', { count: projects.length }) }}
		</NcButton>
		<ul v-if="open" class="deliver-deleted__list">
			<li v-for="project in projects" :key="project.id" class="deliver-deleted__project">
				<div class="deliver-deleted__about">
					<strong>{{ project.name }}</strong>
					<span>{{ t('deliver', 'Deleted on {date} by {name}', { date: day(project.deletedAt), name: project.deletedBy }) }}</span>
					<span>{{ t('deliver', 'Will be deleted for good on {date}', { date: day(project.goesAt) }) }}</span>
				</div>
				<NcButton :disabled="busy" @click="restore(project)">
					{{ t('deliver', 'Restore') }}
				</NcButton>
				<NcButton :disabled="busy" variant="error" @click="deleteForGood(project)">
					{{ t('deliver', 'Delete for good') }}
				</NcButton>
			</li>
		</ul>
		<p v-if="error" class="deliver-deleted__error">
			{{ error }}
		</p>
	</section>
</template>

<style scoped>
.deliver-deleted {
	margin-top: calc(4 * var(--default-grid-baseline));
}

.deliver-deleted__list {
	display: flex;
	flex-direction: column;
	gap: calc(2 * var(--default-grid-baseline));
	margin-top: calc(2 * var(--default-grid-baseline));
}

.deliver-deleted__project {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: calc(2 * var(--default-grid-baseline));
}

.deliver-deleted__about {
	display: flex;
	flex-direction: column;
	flex: 1 1 240px;
	min-width: 0;
}

.deliver-deleted__about span {
	color: var(--color-text-maxcontrast);
}

.deliver-deleted__error {
	color: var(--color-error-text);
}
</style>
