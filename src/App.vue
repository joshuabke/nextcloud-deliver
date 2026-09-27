<script setup>
import folderIcon from '@mdi/svg/svg/folder-play-outline.svg?raw'
import { emit } from '@nextcloud/event-bus'
import { t } from '@nextcloud/l10n'
import { onMounted } from 'vue'
import NcAppContent from '@nextcloud/vue/components/NcAppContent'
import NcAppNavigation from '@nextcloud/vue/components/NcAppNavigation'
import NcAppNavigationItem from '@nextcloud/vue/components/NcAppNavigationItem'
import NcContent from '@nextcloud/vue/components/NcContent'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { useProjectsStore } from './store/projects.js'

const store = useProjectsStore()
onMounted(() => {
	store.fetchAll()
	// The Project list is one click away; by default the room goes to the review
	emit('toggle-navigation', { open: false })
})
</script>

<template>
	<NcContent appName="deliver">
		<NcAppNavigation :aria-label="t('deliver', 'Projects')">
			<template #list>
				<NcAppNavigationItem
					v-for="project in store.projects"
					:key="project.id"
					:name="project.name"
					:to="`/projects/${project.id}`">
					<template #icon>
						<NcIconSvgWrapper :svg="folderIcon" />
					</template>
				</NcAppNavigationItem>
			</template>
		</NcAppNavigation>
		<NcAppContent>
			<RouterView />
		</NcAppContent>
	</NcContent>
</template>
