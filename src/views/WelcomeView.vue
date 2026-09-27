<script setup>
import icon from '@mdi/svg/svg/folder-play-outline.svg?raw'
import { t } from '@nextcloud/l10n'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { useProjectsStore } from '../store/projects.js'

const store = useProjectsStore()
</script>

<template>
	<NcEmptyContent
		:name="store.loaded && store.projects.length === 0 ? t('deliver', 'No Projects yet') : t('deliver', 'Pick a Project')"
		:description="t('deliver', 'Turn a folder into a Project from the Deliver tab in the Files sidebar.')">
		<template #icon>
			<NcIconSvgWrapper :svg="icon" />
		</template>
	</NcEmptyContent>
</template>
