<script setup>
import listIcon from '@mdi/svg/svg/format-list-bulleted.svg?raw'
import tuneIcon from '@mdi/svg/svg/tune-variant.svg?raw'
import gridIcon from '@mdi/svg/svg/view-grid-outline.svg?raw'
import { useIsMobile } from '@nextcloud/vue/composables/useIsMobile'
import { ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcPopover from '@nextcloud/vue/components/NcPopover'
import BottomSheet from './BottomSheet.vue'
import DisplayOptions from './DisplayOptions.vue'
import { t } from '../lib/l10n.js'

/** 'grid' for cards, 'list' for compact rows */
const layout = defineModel({ type: String, required: true })
/** Grid display options: { size, aspect, fit, titleLines, info, collapseFolders } */
const options = defineModel('options', { type: Object, required: true })

const isMobile = useIsMobile()
const open = ref(false)
const panel = ref(null)
</script>

<template>
	<template v-if="isMobile">
		<NcButton
			variant="tertiary"
			:aria-label="t('deliver', 'Display options')"
			:title="t('deliver', 'Display options')"
			@click="open = true">
			<template #icon>
				<NcIconSvgWrapper :svg="layout === 'list' ? listIcon : gridIcon" />
			</template>
		</NcButton>
		<BottomSheet
			v-if="open"
			:label="t('deliver', 'Display options')"
			@close="open = false">
			<template #header>
				{{ t('deliver', 'Display options') }}
			</template>
			<DisplayOptions
				v-model:layout="layout"
				v-model:options="options"
				sheet />
		</BottomSheet>
	</template>
	<template v-else>
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
		<NcPopover
			v-model:shown="open"
			placement="bottom-end"
			@afterHide="panel?.reset()">
			<template #trigger="{ attrs }">
				<NcButton
					v-bind="attrs"
					variant="tertiary"
					:aria-label="t('deliver', 'Display options')"
					:title="t('deliver', 'Display options')">
					<template #icon>
						<NcIconSvgWrapper :svg="tuneIcon" />
					</template>
				</NcButton>
			</template>
			<div
				class="deliver-layout-switch__popover"
				role="dialog"
				:aria-label="t('deliver', 'Display options')">
				<DisplayOptions
					ref="panel"
					v-model:layout="layout"
					v-model:options="options" />
			</div>
		</NcPopover>
	</template>
</template>

<style scoped>
.deliver-layout-switch__popover {
	width: 300px;
	max-width: calc(100vw - 24px);
	max-height: 80vh;
	overflow-y: auto;
	padding: calc(3 * var(--default-grid-baseline));
}
</style>
