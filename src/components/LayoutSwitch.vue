<script setup>
import listIcon from '@mdi/svg/svg/view-agenda-outline.svg?raw'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { t } from '../lib/l10n.js'

/** 'grid' for cards, 'list' for compact rows; the button is pressed while the rows show */
const layout = defineModel({ type: String, required: true })
</script>

<template>
	<NcButton
		variant="tertiary"
		:pressed="layout === 'list'"
		:aria-label="t('deliver', 'Show the Assets as a list')"
		:title="t('deliver', 'Show the Assets as a list')"
		@click="layout = layout === 'list' ? 'grid' : 'list'">
		<template #icon>
			<NcIconSvgWrapper :svg="listIcon" />
		</template>
	</NcButton>
</template>
