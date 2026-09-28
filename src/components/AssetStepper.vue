<script setup>
import previousIcon from '@mdi/svg/svg/chevron-left.svg?raw'
import nextIcon from '@mdi/svg/svg/chevron-right.svg?raw'
import { t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'

defineProps({
	/** Where the Asset on screen stands, from 0 */
	index: { type: Number, required: true },
	count: { type: Number, required: true },
})

const emit = defineEmits(['step'])
</script>

<template>
	<div v-if="count > 1" class="deliver-stepper">
		<NcButton
			variant="tertiary"
			:disabled="index === 0"
			:aria-label="t('deliver', 'Previous Asset')"
			:title="t('deliver', 'Previous Asset')"
			@click="emit('step', -1)">
			<template #icon>
				<NcIconSvgWrapper :svg="previousIcon" />
			</template>
		</NcButton>
		<span class="deliver-stepper__count">{{ t('deliver', '{index} of {count}', { index: index + 1, count }) }}</span>
		<NcButton
			variant="tertiary"
			:disabled="index === count - 1"
			:aria-label="t('deliver', 'Next Asset')"
			:title="t('deliver', 'Next Asset')"
			@click="emit('step', 1)">
			<template #icon>
				<NcIconSvgWrapper :svg="nextIcon" />
			</template>
		</NcButton>
	</div>
</template>

<style scoped>
.deliver-stepper {
	display: flex;
	align-items: center;
	gap: var(--default-grid-baseline);
}

.deliver-stepper__count {
	min-width: 4em;
	color: var(--color-text-maxcontrast);
	text-align: center;
	white-space: nowrap;
}
</style>
