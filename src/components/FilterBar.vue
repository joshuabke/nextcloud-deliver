<script setup>
import sortIcon from '@mdi/svg/svg/sort.svg?raw'
import { t } from '@nextcloud/l10n'
import NcActionRadio from '@nextcloud/vue/components/NcActionRadio'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'

const filter = defineModel('filter', { type: String, required: true })

const sort = defineModel('sort', { type: String, required: true })

defineProps({
	/** [{ id, label, count }]; the first one shows everything and has no count */
	filters: { type: Array, required: true },
	/** [{ id, label }] */
	sorts: { type: Array, required: true },
})

</script>

<template>
	<div class="deliver-filter-bar">
		<div class="deliver-filter-bar__filters" role="group" :aria-label="t('deliver', 'Show')">
			<NcButton
				v-for="(each, index) in filters"
				:key="each.id"
				variant="tertiary"
				:pressed="filter === each.id"
				@click="filter = each.id">
				{{ each.label }}
				<span v-if="index > 0" class="deliver-filter-bar__count">{{ each.count }}</span>
			</NcButton>
		</div>
		<NcActions
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
	</div>
</template>

<style scoped>
.deliver-filter-bar {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: calc(2 * var(--default-grid-baseline));
}

.deliver-filter-bar__filters {
	display: flex;
	flex-wrap: wrap;
	gap: var(--default-grid-baseline);
	flex: 1;
}

.deliver-filter-bar__count {
	margin-inline-start: var(--default-grid-baseline);
	font-weight: normal;
	opacity: 0.7;
}
</style>
