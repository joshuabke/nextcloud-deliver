<script setup>
import sortIcon from '@mdi/svg/svg/sort.svg?raw'
import { useIsMobile } from '@nextcloud/vue/composables/useIsMobile'
import NcActionRadio from '@nextcloud/vue/components/NcActionRadio'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { t } from '../lib/l10n.js'

/** The order of the cards; the menu names it, on a phone it is an icon */
const sort = defineModel({ type: String, required: true })

defineProps({
	/** [{ id, label }] */
	sorts: { type: Array, required: true },
})

const isMobile = useIsMobile()
</script>

<template>
	<NcActions
		:menuName="isMobile ? undefined : sorts.find((each) => each.id === sort)?.label"
		:title="t('deliver', 'Sort by')"
		:aria-label="t('deliver', 'Sort by')"
		variant="tertiary">
		<template #icon>
			<NcIconSvgWrapper :svg="sortIcon" />
		</template>
		<NcActionRadio
			v-for="each in sorts"
			:key="each.id"
			v-model="sort"
			:value="each.id"
			name="deliver-sort">
			{{ each.label }}
		</NcActionRadio>
	</NcActions>
</template>
