<script setup>
import { t } from '@nextcloud/l10n'
import NcDialog from '@nextcloud/vue/components/NcDialog'

const props = defineProps({
	name: { type: String, required: true },
	message: { type: String, required: true },
	/** Label of the destructive button */
	confirm: { type: String, required: true },
	/** Label of a second, harmless way through, answered with 'other' */
	other: { type: String, default: null },
})

// NcDialog hands a button's result only to its closing event; spawnDialog waits for close
const emit = defineEmits(['close'])

// Spawned for one answer, so the props never change
const buttons = [
	{ label: t('deliver', 'Cancel') },
	...(props.other ? [{ label: props.other, callback: () => 'other' }] : []),
	{ label: props.confirm, variant: 'error', callback: () => true },
]
</script>

<template>
	<NcDialog
		class="deliver-confirm"
		:name="name"
		:message="message"
		:buttons="buttons"
		@closing="emit('close', $event === true || $event === 'other' ? $event : false)" />
</template>

<style>
/* A confirmation grows with its heading, so a German one stays on one line beside the close button; the text wraps within */
.deliver-confirm.dialog__modal .modal-wrapper.modal-wrapper--small .modal-container {
	width: fit-content;
	min-width: min(400px, 90%);
}

.deliver-confirm .dialog__text {
	width: 0;
	min-width: 100%;
}

@media (min-width: 512px) {
	.deliver-confirm .dialog__name {
		margin-inline-end: var(--default-clickable-area);
		white-space: nowrap;
	}
}
</style>
