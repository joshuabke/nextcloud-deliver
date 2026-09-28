<script setup>
import menuIcon from '@mdi/svg/svg/chevron-down.svg?raw'
import { t } from '@nextcloud/l10n'
import { computed } from 'vue'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'

const props = defineProps({
	/** The Version Stack, newest first: [{ id, number }] */
	versions: { type: Array, required: true },
	current: { type: Number, required: true },
	/** Shown before the pill; the Version by default */
	label: { type: String, default: () => t('deliver', 'Version') },
})

const emit = defineEmits(['select'])

const number = computed(() => props.versions.find((each) => each.id === props.current)?.number)
</script>

<template>
	<div class="deliver-version-picker">
		<span v-if="label" class="deliver-version-picker__label">{{ label }}</span>
		<span v-if="versions.length < 2" class="deliver-version-picker__pill">v{{ number }}</span>
		<NcActions
			v-else
			class="deliver-version-picker__menu"
			variant="primary"
			:menuName="'v' + number"
			:aria-label="t('deliver', 'Version {number}', { number })">
			<template #icon>
				<NcIconSvgWrapper :svg="menuIcon" :size="18" />
			</template>
			<NcActionButton
				v-for="each in versions"
				:key="each.id"
				:modelValue="each.id === current"
				type="radio"
				closeAfterClick
				@click="emit('select', each.id)">
				{{ t('deliver', 'Version {number}', { number: each.number }) }}
			</NcActionButton>
		</NcActions>
	</div>
</template>

<style scoped>
.deliver-version-picker {
	display: flex;
	align-items: center;
	gap: calc(2 * var(--default-grid-baseline));
}

.deliver-version-picker__label {
	color: var(--color-text-maxcontrast);
}

.deliver-version-picker__pill {
	padding: 4px 10px;
	border-radius: var(--border-radius-element);
	background: var(--color-primary-element);
	color: var(--color-primary-element-text);
	font-weight: bold;
}

.deliver-version-picker__menu :deep(.button-vue__wrapper) {
	flex-direction: row-reverse;
}

.deliver-version-picker__menu :deep(.button-vue) {
	min-height: 30px;
	padding-inline: 10px;
}
</style>
