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

/** 'grid' for cards, 'list' for compact rows */
const layout = defineModel('layout', { type: String, required: true })

/** Grid display options: { size, aspect, fit, titleLines, info, collapseFolders } */
const options = defineModel('options', { type: Object, required: true })

defineProps({
	/** Rendered inside a phone BottomSheet: grouped rows with inline controls (#309) */
	sheet: { type: Boolean, default: false },
})

/** Which choice row is drilled into ('fit' | 'titleLines' | null) */
const picking = ref(null)
const id = useId()
const layoutId = `${id}-layout`
const sizeId = `${id}-size`
const aspectId = `${id}-aspect`
const fitId = `${id}-fit`
const titleLinesId = `${id}-title-lines`
const infoId = `${id}-info`
const collapseId = `${id}-collapse`

/**
 * NcRadioGroupButton in `@nextcloud/vue` 9.12 omits `name` on its radio input (breaking
 * browser arrow-key navigation and single Tab stop per group) and drops `ariaLabel` when
 * `label` is set. Apply them on the native radio input directly.
 *
 * @param {HTMLElement} el - NcRadioGroupButton root element
 * @param {string|{name: string, ariaLabel?: string}} value - group name, or name plus accessible label
 */
function syncRadioInput(el, value) {
	const input = el.querySelector('input[type="radio"]')
	if (!input) {
		return
	}
	const { name, ariaLabel } = typeof value === 'string' ? { name: value } : value
	input.name = name
	if (ariaLabel) {
		input.setAttribute('aria-label', ariaLabel)
		input.removeAttribute('aria-labelledby')
	}
}

const vRadioInput = {
	mounted: (el, { value }) => syncRadioInput(el, value),
	updated: (el, { value }) => syncRadioInput(el, value),
}

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
		<NcRadioGroup
			v-model="layout"
			class="deliver-display-sheet__layout"
			:label="t('deliver', 'Layout')"
			hideLabel>
			<NcRadioGroupButton
				v-radio-input="layoutId"
				class="deliver-display-sheet__segment deliver-display-sheet__stacked deliver-display-sheet__layout-option"
				value="grid"
				:label="t('deliver', 'Grid')">
				<template #icon>
					<NcIconSvgWrapper :svg="gridIcon" :size="24" inline />
				</template>
			</NcRadioGroupButton>
			<NcRadioGroupButton
				v-radio-input="layoutId"
				class="deliver-display-sheet__segment deliver-display-sheet__stacked deliver-display-sheet__layout-option"
				value="list"
				:label="t('deliver', 'List')">
				<template #icon>
					<NcIconSvgWrapper :svg="listIcon" :size="24" inline />
				</template>
			</NcRadioGroupButton>
		</NcRadioGroup>
		<template v-if="layout === 'grid'">
			<div class="deliver-sheet__group">
				<div class="deliver-sheet__row">
					<span class="deliver-sheet__label">{{ t('deliver', 'Card size') }}</span>
					<NcRadioGroup
						v-model="size"
						class="deliver-sheet__control"
						:label="t('deliver', 'Card size')"
						hideLabel>
						<NcRadioGroupButton
							v-radio-input="sizeId"
							class="deliver-display-sheet__segment"
							value="s"
							:label="t('deliver', 'S')" />
						<NcRadioGroupButton
							v-radio-input="sizeId"
							class="deliver-display-sheet__segment"
							value="m"
							:label="t('deliver', 'M')" />
						<NcRadioGroupButton
							v-radio-input="sizeId"
							class="deliver-display-sheet__segment"
							value="l"
							:label="t('deliver', 'L')" />
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
							v-radio-input="aspectId"
							class="deliver-display-sheet__segment deliver-display-sheet__stacked deliver-display-sheet__aspect"
							value="landscape"
							:label="t('deliver', 'Landscape')">
							<template #icon>
								<NcIconSvgWrapper :svg="landscapeIcon" :size="18" inline />
							</template>
						</NcRadioGroupButton>
						<NcRadioGroupButton
							v-radio-input="aspectId"
							class="deliver-display-sheet__segment deliver-display-sheet__stacked deliver-display-sheet__aspect"
							value="square"
							:label="t('deliver', 'Square')">
							<template #icon>
								<NcIconSvgWrapper :svg="squareIcon" :size="18" inline />
							</template>
						</NcRadioGroupButton>
						<NcRadioGroupButton
							v-radio-input="aspectId"
							class="deliver-display-sheet__segment deliver-display-sheet__stacked deliver-display-sheet__aspect"
							value="portrait"
							:label="t('deliver', 'Portrait')">
							<template #icon>
								<NcIconSvgWrapper :svg="portraitIcon" :size="18" inline />
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
						<NcRadioGroupButton
							v-radio-input="fitId"
							class="deliver-display-sheet__segment"
							value="fit"
							:label="t('deliver', 'Fit')" />
						<NcRadioGroupButton
							v-radio-input="fitId"
							class="deliver-display-sheet__segment"
							value="fill"
							:label="t('deliver', 'Fill')" />
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
							v-radio-input="{ name: titleLinesId, ariaLabel: n('deliver', '%n line', '%n lines', lines) }"
							class="deliver-display-sheet__segment"
							:value="lines"
							:label="String(lines)" />
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

/* Phone display sheet: full-width Grid/List segments above touch-sized inline controls (#302, #309) */
.deliver-display-sheet__layout {
	width: 100%;
	min-width: 0;
	margin: 0;
	padding: 0;
	border: 0;
}

.deliver-sheet__groups .deliver-display-sheet__segment {
	box-sizing: border-box;
	min-width: 44px;
	min-height: 44px;
	padding: calc(2 * var(--default-grid-baseline)) calc(3 * var(--default-grid-baseline));
	font-size: var(--default-font-size);
	line-height: 1.2;
	white-space: nowrap;
}

.deliver-sheet__groups .deliver-display-sheet__stacked {
	flex-direction: column;
	gap: var(--default-grid-baseline);
}

.deliver-sheet__groups .deliver-display-sheet__stacked :deep(> div:first-child) {
	width: auto;
	height: auto;
}

.deliver-sheet__groups .deliver-display-sheet__layout-option {
	min-height: 68px;
	padding: calc(2.5 * var(--default-grid-baseline)) calc(2 * var(--default-grid-baseline));
}

.deliver-sheet__groups .deliver-display-sheet__aspect {
	flex: 0 1 auto;
	gap: 2px;
	padding: var(--default-grid-baseline) 5px;
	font-size: var(--font-size-small, 13px);
	line-height: 1.15;
}

.deliver-sheet__groups .deliver-display-sheet__aspect :deep(> div:last-of-type) {
	font-weight: 500;
}
</style>
