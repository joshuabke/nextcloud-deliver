<script setup>
import { t } from '@nextcloud/l10n'
import { computed } from 'vue'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'

/**
 * What a Project Link shows: the whole Project, or only the Assets picked
 * (story 120). On No Project only picked Assets, at least one.
 */
const props = defineProps({
	/** The picked Asset ids, null for the whole Project */
	modelValue: { type: Array, default: null },
	/** The Project's Assets, or those of No Project, to pick from */
	assets: { type: Array, required: true },
	onNoProject: { type: Boolean, default: false },
	/** Radio group name, unique per picker on the page */
	name: { type: String, required: true },
})
const emit = defineEmits(['update:modelValue'])

const picked = computed(() => new Set(props.modelValue ?? []))

/**
 * @param {number} id - an Asset
 * @param {boolean} on - picked or not
 */
function toggle(id, on) {
	const next = new Set(picked.value)
	if (on) {
		next.add(id)
	} else {
		next.delete(id)
	}
	if (next.size > 0 || !props.onNoProject) {
		emit('update:modelValue', [...next])
	}
}
</script>

<template>
	<div>
		<NcCheckboxRadioSwitch
			v-if="!onNoProject"
			type="radio"
			:name="name"
			:modelValue="modelValue === null"
			@update:modelValue="emit('update:modelValue', null)">
			{{ t('deliver', 'The whole Project, with every Asset that joins it') }}
		</NcCheckboxRadioSwitch>
		<NcCheckboxRadioSwitch
			v-if="!onNoProject"
			type="radio"
			:name="name"
			:modelValue="modelValue !== null"
			@update:modelValue="emit('update:modelValue', assets.map((asset) => asset.id))">
			{{ t('deliver', 'Only the Assets picked here') }}
		</NcCheckboxRadioSwitch>
		<ul v-if="modelValue !== null" class="deliver-asset-picker">
			<li v-for="asset in assets" :key="asset.id">
				<NcCheckboxRadioSwitch
					:modelValue="picked.has(asset.id)"
					@update:modelValue="toggle(asset.id, $event)">
					{{ asset.name }}
				</NcCheckboxRadioSwitch>
			</li>
		</ul>
	</div>
</template>

<style scoped>
.deliver-asset-picker {
	padding-inline-start: calc(4 * var(--default-grid-baseline));
}
</style>
