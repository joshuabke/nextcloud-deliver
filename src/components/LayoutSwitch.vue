<script setup>
import gridIcon from '@mdi/svg/svg/view-grid-outline.svg?raw'
import listIcon from '@mdi/svg/svg/view-list.svg?raw'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { t } from '../lib/l10n.js'

/** 'grid' for cards, 'list' for compact rows */
const layout = defineModel({ type: String, required: true })
</script>

<template>
	<div class="deliver-layout-switch" role="group" :aria-label="t('deliver', 'Layout')">
		<NcButton
			variant="tertiary"
			:pressed="layout === 'grid'"
			:aria-label="t('deliver', 'Show the Assets as cards')"
			:title="t('deliver', 'Show the Assets as cards')"
			@click="layout = 'grid'">
			<template #icon>
				<NcIconSvgWrapper :svg="gridIcon" />
			</template>
		</NcButton>
		<NcButton
			variant="tertiary"
			:pressed="layout === 'list'"
			:aria-label="t('deliver', 'Show the Assets as a list')"
			:title="t('deliver', 'Show the Assets as a list')"
			@click="layout = 'list'">
			<template #icon>
				<NcIconSvgWrapper :svg="listIcon" />
			</template>
		</NcButton>
	</div>
</template>

<style scoped>
.deliver-layout-switch {
	display: flex;
	flex: none;
}
</style>
