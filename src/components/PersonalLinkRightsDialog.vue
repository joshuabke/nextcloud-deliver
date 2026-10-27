<script setup>
import { ref } from 'vue'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import { setReviewerRights } from '../api.js'
import { useBusy } from '../composables/busy.js'
import { t } from '../lib/l10n.js'

/**
 * A Reviewer's own rights on one Review Link they are on, over the link's
 * (ADR 0014). Each change is saved at once, as the link's own switches are.
 */
const props = defineProps({
	/** {id, name} */
	reviewer: { type: Object, required: true },
	/** The link as the navigation lists it: title, token and its rights */
	link: { type: Object, required: true },
	/** {canComment, allowOlder, watermark}, null where the link decides */
	rights: { type: Object, required: true },
})
const emit = defineEmits(['update:rights', 'close'])

const RIGHTS = [
	{ id: 'canComment', label: t('deliver', 'Comment') },
	{ id: 'allowOlder', label: t('deliver', 'Comment on older Versions') },
	{ id: 'watermark', label: t('deliver', 'Watermark with their name') },
]
const own = ref({ ...props.rights })
const { busy, error, run } = useBusy()

/** Radio values stand for null (the link decides), true and false */
const VALUES = { link: null, yes: true, no: false }

/**
 * @param {string} right - one of RIGHTS
 * @return {Array<{value: string, label: string}>} the link's setting, with what it says now, or yes or no
 */
function choices(right) {
	const linkSays = props.link[right] ? t('deliver', 'Yes') : t('deliver', 'No')
	return [
		{ value: 'link', label: t('deliver', 'From the Review Link ({value})', { value: linkSays }) },
		{ value: 'yes', label: t('deliver', 'Yes') },
		{ value: 'no', label: t('deliver', 'No') },
	]
}

/**
 * @param {?boolean} value - their own right, null where the link decides
 * @return {string} the radio value for it
 */
function radio(value) {
	return value === null || value === undefined ? 'link' : (value ? 'yes' : 'no')
}

/**
 * @param {string} right - one of RIGHTS
 * @param {?boolean} value - their own, or null for the link's
 */
function set(right, value) {
	return run(async () => {
		own.value = await setReviewerRights(props.reviewer.id, props.link.token, { ...own.value, [right]: value })
		emit('update:rights', own.value)
	})
}
</script>

<template>
	<NcDialog
		:name="t('deliver', '{name} on “{link}”', { name: reviewer.name, link: link.title })"
		size="normal"
		@closing="emit('close')">
		<div class="deliver-personal-rights">
			<!-- One grid, so that the choices of all three line up in columns -->
			<div
				v-for="right in RIGHTS"
				:key="right.id"
				class="deliver-personal-rights__right"
				role="radiogroup"
				:aria-labelledby="`deliver-right-${right.id}`">
				<h3 :id="`deliver-right-${right.id}`">
					{{ right.label }}
				</h3>
				<NcCheckboxRadioSwitch
					v-for="choice in choices(right.id)"
					:key="choice.value"
					type="radio"
					:name="`deliver-right-${right.id}`"
					:value="choice.value"
					:modelValue="radio(own[right.id])"
					:disabled="busy"
					@update:modelValue="set(right.id, VALUES[$event])">
					{{ choice.label }}
				</NcCheckboxRadioSwitch>
			</div>
			<p v-if="error" class="deliver-personal-rights__error">
				{{ error }}
			</p>
		</div>
	</NcDialog>
</template>

<style scoped>
.deliver-personal-rights {
	display: grid;
	/* The first choice, the longest, wraps on a narrow screen rather than pushing the others out */
	grid-template-columns: minmax(0, max-content) max-content max-content;
	justify-content: start;
	column-gap: calc(2 * var(--default-grid-baseline));
	padding-bottom: calc(2 * var(--default-grid-baseline));
}

/* Each right a row of the shared grid, its heading across all three columns */
.deliver-personal-rights__right {
	display: grid;
	grid-column: 1 / -1;
	grid-template-columns: subgrid;
}

.deliver-personal-rights__right h3 {
	grid-column: 1 / -1;
	/* Across all three columns, without widening them to the heading's length */
	contain: inline-size;
	margin: calc(2 * var(--default-grid-baseline)) 0 0;
	font-size: 16px;
}

.deliver-personal-rights__error {
	grid-column: 1 / -1;
	color: var(--color-error-text);
}
</style>
