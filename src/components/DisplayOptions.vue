<script setup>
import backIcon from '@mdi/svg/svg/arrow-left.svg?raw'
import checkIcon from '@mdi/svg/svg/check.svg?raw'
import chevronRightIcon from '@mdi/svg/svg/chevron-right.svg?raw'
import landscapeIcon from '@mdi/svg/svg/crop-landscape.svg?raw'
import portraitIcon from '@mdi/svg/svg/crop-portrait.svg?raw'
import squareIcon from '@mdi/svg/svg/crop-square.svg?raw'
import listIcon from '@mdi/svg/svg/format-list-bulleted.svg?raw'
import gridIcon from '@mdi/svg/svg/view-grid-outline.svg?raw'
import { computed, ref, useId } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcFormBox from '@nextcloud/vue/components/NcFormBox'
import NcFormBoxButton from '@nextcloud/vue/components/NcFormBoxButton'
import NcFormBoxSwitch from '@nextcloud/vue/components/NcFormBoxSwitch'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcRadioGroup from '@nextcloud/vue/components/NcRadioGroup'
import NcRadioGroupButton from '@nextcloud/vue/components/NcRadioGroupButton'
import { n, t } from '../lib/l10n.js'
import { TITLE_LINES } from '../lib/listView.js'

defineProps({
	/** Rendered inside a phone BottomSheet: grouped rows with inline controls (#309) */
	sheet: { type: Boolean, default: false },
})

/** 'grid' for cards, 'list' for compact rows */
const layout = defineModel('layout', { type: String, required: true })
/** Grid display options: { size, aspect, fit, titleLines, info, collapseFolders } */
const options = defineModel('options', { type: Object, required: true })

/** Which choice row is drilled into ('fit' | 'titleLines' | null) */
const picking = ref(null)
const id = useId()
const infoId = `${id}-info`
const collapseId = `${id}-collapse`

/**
 * Replaces one or more grid options immutably so watchers and storage stay in sync
 *
 * @param {object} patch - changed option fields
 */
function update(patch) {
	options.value = { ...options.value, ...patch }
}

const size = computed({
	get: () => options.value.size,
	set: (value) => update({ size: value }),
})

const aspect = computed({
	get: () => options.value.aspect,
	set: (value) => update({ aspect: value }),
})

const fit = computed({
	get: () => options.value.fit,
	set: (value) => update({ fit: value }),
})

const titleLines = computed({
	get: () => options.value.titleLines,
	set: (value) => update({ titleLines: value }),
})

const info = computed({
	get: () => options.value.info,
	set: (value) => update({ info: value }),
})

const collapseFolders = computed({
	get: () => options.value.collapseFolders,
	set: (value) => update({ collapseFolders: value }),
})

const fitLabel = computed(() => options.value.fit === 'fill' ? t('deliver', 'Fill') : t('deliver', 'Fit'))
const titleLinesLabel = computed(() => n('deliver', '%n line', '%n lines', options.value.titleLines))

defineExpose({
	reset() {
		picking.value = null
	},
})
</script>

<template>
	<div v-if="sheet" class="deliver-sheet__groups">
		<div class="deliver-sheet__group">
			<div class="deliver-sheet__row">
				<span class="deliver-sheet__label">{{ t('deliver', 'Layout') }}</span>
				<NcRadioGroup
					v-model="layout"
					class="deliver-sheet__control"
					:label="t('deliver', 'Layout')"
					hideLabel>
					<NcRadioGroupButton value="grid" :label="t('deliver', 'Grid')" />
					<NcRadioGroupButton value="list" :label="t('deliver', 'List')" />
				</NcRadioGroup>
			</div>
		</div>
		<template v-if="layout === 'grid'">
			<div class="deliver-sheet__group">
				<div class="deliver-sheet__row">
					<span class="deliver-sheet__label">{{ t('deliver', 'Card size') }}</span>
					<NcRadioGroup
						v-model="size"
						class="deliver-sheet__control"
						:label="t('deliver', 'Card size')"
						hideLabel>
						<NcRadioGroupButton value="s" :label="t('deliver', 'S')" />
						<NcRadioGroupButton value="m" :label="t('deliver', 'M')" />
						<NcRadioGroupButton value="l" :label="t('deliver', 'L')" />
					</NcRadioGroup>
				</div>
				<div class="deliver-sheet__row">
					<span class="deliver-sheet__label">{{ t('deliver', 'Aspect ratio') }}</span>
					<NcRadioGroup
						v-model="aspect"
						class="deliver-sheet__control"
						:label="t('deliver', 'Aspect ratio')"
						hideLabel>
						<NcRadioGroupButton
							value="landscape"
							:ariaLabel="t('deliver', 'Landscape')"
							:title="t('deliver', 'Landscape')">
							<template #icon>
								<NcIconSvgWrapper :svg="landscapeIcon" :size="20" />
							</template>
						</NcRadioGroupButton>
						<NcRadioGroupButton
							value="square"
							:ariaLabel="t('deliver', 'Square')"
							:title="t('deliver', 'Square')">
							<template #icon>
								<NcIconSvgWrapper :svg="squareIcon" :size="20" />
							</template>
						</NcRadioGroupButton>
						<NcRadioGroupButton
							value="portrait"
							:ariaLabel="t('deliver', 'Portrait')"
							:title="t('deliver', 'Portrait')">
							<template #icon>
								<NcIconSvgWrapper :svg="portraitIcon" :size="20" />
							</template>
						</NcRadioGroupButton>
					</NcRadioGroup>
				</div>
				<div class="deliver-sheet__row">
					<span class="deliver-sheet__label">{{ t('deliver', 'Thumbnail') }}</span>
					<NcRadioGroup
						v-model="fit"
						class="deliver-sheet__control"
						:label="t('deliver', 'Thumbnail')"
						hideLabel>
						<NcRadioGroupButton value="fit" :label="t('deliver', 'Fit')" />
						<NcRadioGroupButton value="fill" :label="t('deliver', 'Fill')" />
					</NcRadioGroup>
				</div>
				<div class="deliver-sheet__row">
					<span class="deliver-sheet__label">{{ t('deliver', 'Title lines') }}</span>
					<NcRadioGroup
						v-model="titleLines"
						class="deliver-sheet__control"
						:label="t('deliver', 'Title lines')"
						hideLabel>
						<NcRadioGroupButton
							v-for="lines in TITLE_LINES"
							:key="lines"
							:value="lines"
							:label="n('deliver', '%n line', '%n lines', lines)" />
					</NcRadioGroup>
				</div>
			</div>
			<div class="deliver-sheet__group">
				<div class="deliver-sheet__row">
					<label :for="infoId" class="deliver-sheet__label">{{ t('deliver', 'Show card info') }}</label>
					<NcCheckboxRadioSwitch
						:id="infoId"
						v-model="info"
						class="deliver-sheet__control"
						type="switch"
						:aria-label="t('deliver', 'Show card info')" />
				</div>
				<div class="deliver-sheet__row">
					<label :for="collapseId" class="deliver-sheet__label">{{ t('deliver', 'Collapse folders') }}</label>
					<NcCheckboxRadioSwitch
						:id="collapseId"
						v-model="collapseFolders"
						class="deliver-sheet__control"
						type="switch"
						:aria-label="t('deliver', 'Collapse folders')" />
				</div>
			</div>
		</template>
	</div>
	<div v-else class="deliver-display">
		<template v-if="picking === 'fit'">
			<div class="deliver-display__subhead">
				<NcButton
					variant="tertiary"
					:aria-label="t('deliver', 'Back')"
					@click="picking = null">
					<template #icon>
						<NcIconSvgWrapper :svg="backIcon" />
					</template>
				</NcButton>
				<span>{{ t('deliver', 'Thumbnail') }}</span>
			</div>
			<NcFormBox>
				<NcFormBoxButton
					:label="t('deliver', 'Fit')"
					:aria-pressed="options.fit === 'fit'"
					@click="update({ fit: 'fit' }); picking = null">
					<template #icon>
						<NcIconSvgWrapper v-if="options.fit === 'fit'" :svg="checkIcon" />
						<span v-else class="deliver-display__spacer" />
					</template>
				</NcFormBoxButton>
				<NcFormBoxButton
					:label="t('deliver', 'Fill')"
					:aria-pressed="options.fit === 'fill'"
					@click="update({ fit: 'fill' }); picking = null">
					<template #icon>
						<NcIconSvgWrapper v-if="options.fit === 'fill'" :svg="checkIcon" />
						<span v-else class="deliver-display__spacer" />
					</template>
				</NcFormBoxButton>
			</NcFormBox>
		</template>
		<template v-else-if="picking === 'titleLines'">
			<div class="deliver-display__subhead">
				<NcButton
					variant="tertiary"
					:aria-label="t('deliver', 'Back')"
					@click="picking = null">
					<template #icon>
						<NcIconSvgWrapper :svg="backIcon" />
					</template>
				</NcButton>
				<span>{{ t('deliver', 'Title lines') }}</span>
			</div>
			<NcFormBox>
				<NcFormBoxButton
					v-for="lines in TITLE_LINES"
					:key="lines"
					:label="n('deliver', '%n line', '%n lines', lines)"
					:aria-pressed="options.titleLines === lines"
					@click="update({ titleLines: lines }); picking = null">
					<template #icon>
						<NcIconSvgWrapper v-if="options.titleLines === lines" :svg="checkIcon" />
						<span v-else class="deliver-display__spacer" />
					</template>
				</NcFormBoxButton>
			</NcFormBox>
		</template>
		<template v-else>
			<NcRadioGroup
				v-model="layout"
				class="deliver-display__stacked deliver-display__layout"
				:label="t('deliver', 'Layout')"
				hideLabel>
				<NcRadioGroupButton value="grid" :label="t('deliver', 'Grid')">
					<template #icon>
						<NcIconSvgWrapper :svg="gridIcon" :size="24" />
					</template>
				</NcRadioGroupButton>
				<NcRadioGroupButton value="list" :label="t('deliver', 'List')">
					<template #icon>
						<NcIconSvgWrapper :svg="listIcon" :size="24" />
					</template>
				</NcRadioGroupButton>
			</NcRadioGroup>
			<template v-if="layout === 'grid'">
				<NcRadioGroup
					v-model="size"
					:label="t('deliver', 'Card size')">
					<NcRadioGroupButton value="s" :label="t('deliver', 'S')" />
					<NcRadioGroupButton value="m" :label="t('deliver', 'M')" />
					<NcRadioGroupButton value="l" :label="t('deliver', 'L')" />
				</NcRadioGroup>
				<NcRadioGroup
					v-model="aspect"
					class="deliver-display__stacked"
					:label="t('deliver', 'Aspect ratio')">
					<NcRadioGroupButton value="landscape" :label="t('deliver', 'Landscape')">
						<template #icon>
							<NcIconSvgWrapper :svg="landscapeIcon" :size="20" />
						</template>
					</NcRadioGroupButton>
					<NcRadioGroupButton value="square" :label="t('deliver', 'Square')">
						<template #icon>
							<NcIconSvgWrapper :svg="squareIcon" :size="20" />
						</template>
					</NcRadioGroupButton>
					<NcRadioGroupButton value="portrait" :label="t('deliver', 'Portrait')">
						<template #icon>
							<NcIconSvgWrapper :svg="portraitIcon" :size="20" />
						</template>
					</NcRadioGroupButton>
				</NcRadioGroup>
				<NcFormBox>
					<NcFormBoxButton
						:label="t('deliver', 'Thumbnail')"
						:description="fitLabel"
						@click="picking = 'fit'">
						<template #icon>
							<NcIconSvgWrapper :svg="chevronRightIcon" />
						</template>
					</NcFormBoxButton>
					<NcFormBoxButton
						:label="t('deliver', 'Title lines')"
						:description="titleLinesLabel"
						@click="picking = 'titleLines'">
						<template #icon>
							<NcIconSvgWrapper :svg="chevronRightIcon" />
						</template>
					</NcFormBoxButton>
					<NcFormBoxSwitch
						v-model="info"
						:label="t('deliver', 'Show card info')" />
					<NcFormBoxSwitch
						v-model="collapseFolders"
						:label="t('deliver', 'Collapse folders')" />
				</NcFormBox>
			</template>
		</template>
	</div>
</template>

<style scoped>
.deliver-display {
	display: flex;
	flex-direction: column;
	gap: calc(3 * var(--default-grid-baseline));
}

.deliver-display__subhead {
	display: flex;
	align-items: center;
	gap: var(--default-grid-baseline);
	font-weight: bold;
}

.deliver-display__spacer {
	display: inline-block;
	width: 20px;
	height: 20px;
}

/* Stack icon over label in Grid/List and Aspect ratio segments so labels fit comfortably on narrow screens */
.deliver-display__stacked :deep([class*='radioGroupButton_']) {
	flex-direction: column;
	gap: var(--default-grid-baseline);
	padding: calc(2 * var(--default-grid-baseline)) var(--default-grid-baseline);
}

.deliver-display__layout :deep([class*='radioGroupButton_']) {
	padding-block: calc(3 * var(--default-grid-baseline));
}

.deliver-display__stacked :deep([class*='radioGroupButton__icon_']) {
	width: auto;
	height: auto;
}
</style>
