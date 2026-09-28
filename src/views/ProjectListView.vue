<script setup>
import icon from '@mdi/svg/svg/folder-play-outline.svg?raw'
import { t } from '@nextcloud/l10n'
import { computed } from 'vue'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import ProjectCard from '../components/ProjectCard.vue'
import { useProjectsStore } from '../store/projects.js'

const store = useProjectsStore()
// Every visit shows the news as they are now
store.fetchAll()

/** Where something happened last comes first */
const projects = computed(() => [...store.projects].sort((a, b) => b.activity.lastActivity - a.activity.lastActivity))
</script>

<template>
	<div class="deliver-projects">
		<h2 class="deliver-projects__head">
			{{ t('deliver', 'Projects') }}
		</h2>
		<NcEmptyContent v-if="!store.loaded" :name="t('deliver', 'Loading…')">
			<template #icon>
				<NcLoadingIcon />
			</template>
		</NcEmptyContent>
		<NcEmptyContent
			v-else-if="projects.length === 0"
			:name="t('deliver', 'No Projects yet')"
			:description="t('deliver', 'Turn a folder into a Project from the Deliver tab in the Files sidebar.')">
			<template #icon>
				<NcIconSvgWrapper :svg="icon" />
			</template>
		</NcEmptyContent>
		<ul v-else class="deliver-projects__grid">
			<ProjectCard v-for="project in projects" :key="project.id" :project="project" />
		</ul>
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

.deliver-projects__grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
	gap: calc(2 * var(--default-grid-baseline, 4px));
}
</style>
