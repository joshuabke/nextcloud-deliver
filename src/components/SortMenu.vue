<script setup>
import checkIcon from '@mdi/svg/svg/check.svg?raw'
import sortIcon from '@mdi/svg/svg/sort.svg?raw'
import { useIsMobile } from '@nextcloud/vue/composables/useIsMobile'
import { ref } from 'vue'
import NcActionRadio from '@nextcloud/vue/components/NcActionRadio'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcFormBox from '@nextcloud/vue/components/NcFormBox'
import NcFormBoxButton from '@nextcloud/vue/components/NcFormBoxButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import BottomSheet from './BottomSheet.vue'
import { t } from '../lib/l10n.js'

/** The order of the cards; a menu on a desktop, a sheet from below on a phone */
const sort = defineModel({ type: String, required: true })

defineProps({
	/** [{ id, label }] */
	sorts: { type: Array, required: true },
})

const isMobile = useIsMobile()
const open = ref(false)
</script>

<template>
	<template v-if="isMobile">
		<NcButton
			variant="tertiary"
			:aria-label="t('deliver', 'Sort by')"
			:title="t('deliver', 'Sort by')"
			@click="open = true">
			<template #icon>
				<NcIconSvgWrapper :svg="sortIcon" />
			</template>
		</NcButton>
		<BottomSheet
			v-if="open"
			:label="t('deliver', 'Sort by')"
			@close="open = false">
			<template #header>
				<div class="deliver-sort-sheet__title">
					{{ t('deliver', 'Sort by') }}
				</div>
			</template>
			<NcFormBox>
				<NcFormBoxButton
					v-for="each in sorts"
					:key="each.id"
					:label="each.label"
					:aria-pressed="sort === each.id"
					@click="sort = each.id; open = false">
					<template #icon>
						<NcIconSvgWrapper v-if="sort === each.id" :svg="checkIcon" />
						<span v-else class="deliver-sort-sheet__spacer" />
					</template>
				</NcFormBoxButton>
			</NcFormBox>
		</BottomSheet>
	</template>
	<NcActions
		v-else
		:menuName="sorts.find((each) => each.id === sort)?.label"
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

<style scoped>
.deliver-sort-sheet__title {
	padding-bottom: calc(3 * var(--default-grid-baseline));
	font-size: 16px;
	font-weight: bold;
	text-align: center;
}

.deliver-sort-sheet__spacer {
	display: inline-block;
	width: 20px;
	height: 20px;
}
</style>
