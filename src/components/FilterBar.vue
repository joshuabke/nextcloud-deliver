<script setup>
import { useIsMobile } from '@nextcloud/vue/composables/useIsMobile'
import NcButton from '@nextcloud/vue/components/NcButton'
import SortMenu from './SortMenu.vue'
import { t } from '../lib/l10n.js'

const filter = defineModel('filter', { type: String, required: true })
const sort = defineModel('sort', { type: String, required: true })

defineProps({
	/** [{ id, label, count }]; the first one shows everything and has no count */
	filters: { type: Array, required: true },
	/** [{ id, label }] */
	sorts: { type: Array, required: true },
})

/** On a phone the filters are one row to swipe, and the order is an icon at its end */
const isMobile = useIsMobile()

</script>

<template>
	<div class="deliver-filter-bar" :class="{ 'deliver-filter-bar--mobile': isMobile }">
		<!-- What acts on the cards as a whole, such as ticking them all -->
		<slot name="start" />
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
		<SortMenu v-model="sort" :sorts="sorts" />
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

.deliver-filter-bar--mobile {
	flex-wrap: nowrap;
}

.deliver-filter-bar--mobile .deliver-filter-bar__filters {
	flex-wrap: nowrap;
	min-width: 0;
	overflow-x: auto;
	scrollbar-width: none;
}

.deliver-filter-bar--mobile .deliver-filter-bar__filters > * {
	flex: none;
}

.deliver-filter-bar__count {
	margin-inline-start: var(--default-grid-baseline);
	font-weight: normal;
	opacity: 0.7;
}
</style>
