<script setup>
import checkIcon from '@mdi/svg/svg/check.svg?raw'
import sortIcon from '@mdi/svg/svg/sort.svg?raw'
import { useIsMobile } from '@nextcloud/vue/composables/useIsMobile'
import { ref } from 'vue'
import NcActionRadio from '@nextcloud/vue/components/NcActionRadio'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcButton from '@nextcloud/vue/components/NcButton'
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
				{{ t('deliver', 'Sort by') }}
			</template>
			<div class="deliver-sheet__group">
				<button
					v-for="each in sorts"
					:key="each.id"
					type="button"
					class="deliver-sheet__item"
					:aria-pressed="sort === each.id"
					@click="sort = each.id; open = false">
					<span class="deliver-sheet__label">{{ each.label }}</span>
					<NcIconSvgWrapper v-if="sort === each.id" :svg="checkIcon" :size="24" />
				</button>
			</div>
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
