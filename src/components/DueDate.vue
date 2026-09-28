<script setup>
import calendarIcon from '@mdi/svg/svg/calendar-clock.svg?raw'
import closeIcon from '@mdi/svg/svg/close.svg?raw'
import { getLanguage, t } from '@nextcloud/l10n'
import { computed, ref } from 'vue'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { dayOf, urgency } from '../lib/due.js'

const props = defineProps({
	/** YYYY-MM-DD, or null */
	modelValue: { type: String, default: null },
	/** Whether the date can be set here */
	editable: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue'])

const input = ref(null)
const today = dayOf(new Date())

const kind = computed(() => props.modelValue ? urgency(props.modelValue, today) : null)
const label = computed(() => {
	if (!props.modelValue) {
		return t('deliver', 'Due Date')
	}
	const named = { today: t('deliver', 'Due today'), tomorrow: t('deliver', 'Due tomorrow') }[kind.value]
	const date = new Date(props.modelValue + 'T12:00:00').toLocaleDateString(getLanguage(), { day: 'numeric', month: 'short' })
	return named ?? (kind.value === 'overdue' ? t('deliver', 'Was due {date}', { date }) : t('deliver', 'Due {date}', { date }))
})

/** Opens the browser's own date picker */
function pick() {
	if (!props.editable || !input.value) {
		return
	}
	if (input.value.showPicker) {
		input.value.showPicker()
	} else {
		input.value.focus()
	}
}
</script>

<template>
	<div
		v-if="modelValue || editable"
		class="deliver-due"
		:class="[kind && `deliver-due--${kind}`, { 'deliver-due--empty': !modelValue }]">
		<button
			v-if="editable"
			type="button"
			class="deliver-due__button"
			:title="t('deliver', 'Set the Due Date; Members are reminded the day before and on the day')"
			@click="pick">
			<NcIconSvgWrapper :svg="calendarIcon" :size="16" inline />
			<span>{{ label }}</span>
		</button>
		<span v-else class="deliver-due__button">
			<NcIconSvgWrapper :svg="calendarIcon" :size="16" inline />
			<span>{{ label }}</span>
		</span>
		<input
			v-if="editable"
			ref="input"
			class="deliver-due__input"
			type="date"
			tabindex="-1"
			aria-hidden="true"
			:value="modelValue ?? ''"
			@change="emit('update:modelValue', $event.target.value || null)">
		<button
			v-if="editable && modelValue"
			type="button"
			class="deliver-due__clear"
			:aria-label="t('deliver', 'Clear the Due Date')"
			:title="t('deliver', 'Clear the Due Date')"
			@click="emit('update:modelValue', null)">
			<NcIconSvgWrapper :svg="closeIcon" :size="14" inline />
		</button>
	</div>
</template>

<style scoped>
.deliver-due {
	position: relative;
	display: inline-flex;
	align-items: center;
	flex-shrink: 0;
	border-radius: var(--border-radius-pill);
	background: var(--color-background-dark);
	font-size: 13px;
}

.deliver-due__button,
.deliver-due__clear {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	min-height: 0;
	margin: 0;
	padding: 3px 10px;
	border: none;
	border-radius: var(--border-radius-pill);
	background: none;
	color: inherit;
	font-weight: normal;
	cursor: pointer;
}

span.deliver-due__button {
	cursor: default;
}

.deliver-due__clear {
	padding: 3px 8px 3px 0;
}

/* The native picker opens from here, out of sight */
.deliver-due__input {
	position: absolute;
	inset-inline-start: 0;
	bottom: 0;
	width: 1px;
	height: 1px;
	opacity: 0;
	pointer-events: none;
}

.deliver-due--empty {
	color: var(--color-text-maxcontrast);
}

.deliver-due--tomorrow {
	background: #c77800;
	color: #fff;
}

.deliver-due--today,
.deliver-due--overdue {
	background: #c62828;
	color: #fff;
}
</style>
