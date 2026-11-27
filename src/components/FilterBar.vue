<script setup>
import checkIcon from '@mdi/svg/svg/check.svg?raw'
import filterIcon from '@mdi/svg/svg/filter-variant.svg?raw'
import { useIsMobile } from '@nextcloud/vue/composables/useIsMobile'
import { computed, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import BottomSheet from './BottomSheet.vue'
import SortMenu from './SortMenu.vue'
import { t } from '../lib/l10n.js'

const filter = defineModel('filter', { type: String, required: true })
const sort = defineModel('sort', { type: String, required: true })

const props = defineProps({
	/** [{ id, label, count }]; the first one shows everything and has no count */
	filters: { type: Array, required: true },
	/** [{ id, label }] */
	sorts: { type: Array, required: true },
})

/** On a phone the filters and sort open as sheets from below (#302) */
const isMobile = useIsMobile()
const filterOpen = ref(false)
const activeFilter = computed(() => filter.value === props.filters[0]?.id
	? null
	: props.filters.find((each) => each.id === filter.value) ?? null)
const filterLabel = computed(() => activeFilter.value
	? t('deliver', 'Filter: {name}', { name: activeFilter.value.label })
	: t('deliver', 'Filter'))
</script>

<template>
	<div class="deliver-filter-bar" :class="{ 'deliver-filter-bar--mobile': isMobile }">
		<!-- What acts on the cards as a whole, such as ticking them all -->
		<slot name="start" />
		<template v-if="isMobile">
			<span class="deliver-filter-bar__spacer" />
			<NcButton
				variant="tertiary"
				:pressed="Boolean(activeFilter)"
				:aria-label="filterLabel"
				:title="filterLabel"
				@click="filterOpen = true">
				<template #icon>
					<NcIconSvgWrapper :svg="filterIcon" />
				</template>
			</NcButton>
			<BottomSheet
				v-if="filterOpen"
				:label="t('deliver', 'Filter')"
				@close="filterOpen = false">
				<template #header>
					{{ t('deliver', 'Filter') }}
				</template>
				<div class="deliver-sheet__group">
					<button
						v-for="(each, index) in filters"
						:key="each.id"
						type="button"
						class="deliver-sheet__item"
						:aria-pressed="filter === each.id"
						@click="filter = each.id; filterOpen = false">
						<span class="deliver-sheet__label deliver-filter-sheet__row">
							<span>{{ each.label }}</span>
							<span v-if="index > 0" class="deliver-filter-bar__count">{{ each.count }}</span>
						</span>
						<NcIconSvgWrapper v-if="filter === each.id" :svg="checkIcon" :size="24" />
					</button>
				</div>
			</BottomSheet>
		</template>
		<div
			v-else
			class="deliver-filter-bar__filters"
			role="group"
			:aria-label="t('deliver', 'Show')">
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

.deliver-filter-bar__spacer {
	flex: 1;
}

.deliver-filter-bar__count {
	margin-inline-start: var(--default-grid-baseline);
	font-weight: normal;
	opacity: 0.7;
}

.deliver-filter-sheet__row {
	display: flex;
	align-items: center;
	gap: var(--default-grid-baseline);
}
</style>
