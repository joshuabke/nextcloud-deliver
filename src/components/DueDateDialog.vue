<script setup>
import { t } from '@nextcloud/l10n'
import { ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDialog from '@nextcloud/vue/components/NcDialog'

const props = defineProps({
	/** YYYY-MM-DD, or null */
	modelValue: { type: String, default: null },
})

const emit = defineEmits(['update:modelValue', 'close'])

const day = ref(props.modelValue ?? '')

/**
 * @param {string|null} value - the new Due Date, or null to clear it
 */
function done(value) {
	emit('update:modelValue', value)
	emit('close')
}
</script>

<template>
	<!-- A visible date field: Safari opens no picker for a hidden one, whatever showPicker() promises -->
	<NcDialog :name="t('deliver', 'Due Date')" size="small" @closing="emit('close')">
		<form id="deliver-due-date" class="deliver-due-date" @submit.prevent="day && done(day)">
			<input
				v-model="day"
				type="date"
				required
				:aria-label="t('deliver', 'Due Date')">
			<p class="deliver-due-date__hint">
				{{ t('deliver', 'Members are reminded the day before and on the day.') }}
			</p>
		</form>
		<template #actions>
			<NcButton v-if="modelValue" @click="done(null)">
				{{ t('deliver', 'Clear the Due Date') }}
			</NcButton>
			<NcButton
				type="submit"
				form="deliver-due-date"
				variant="primary"
				:disabled="!day">
				{{ t('deliver', 'Save') }}
			</NcButton>
		</template>
	</NcDialog>
</template>

<style scoped>
.deliver-due-date {
	display: flex;
	flex-direction: column;
	gap: var(--default-grid-baseline);
	padding-bottom: calc(2 * var(--default-grid-baseline));
}

.deliver-due-date input {
	width: 100%;
	margin: 0;
}

.deliver-due-date__hint {
	color: var(--color-text-maxcontrast);
}
</style>
