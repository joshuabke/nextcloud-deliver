<script setup>
import NcDialog from '@nextcloud/vue/components/NcDialog'
import { closesDialog } from '../lib/hotkeys.js'

const props = defineProps({
	noClose: { type: Boolean, default: false },
})

const emit = defineEmits(['closing'])

/**
 * NcModal's Escape hotkey ignores inputs, textareas and selects (#306).
 * Children that handle Escape themselves (NcSelect, ContactField, UploadRename)
 * stop propagation before the event reaches the dialog.
 *
 * @param {KeyboardEvent} event - a keydown bubbling to the modal mask
 */
function onKeydown(event) {
	if (!props.noClose && closesDialog(event)) {
		event.preventDefault()
		event.stopPropagation()
		// Leave the field first, so a field that saves on blur saves in every browser, as with the close button
		event.target.blur()
		emit('closing')
	}
}
</script>

<template>
	<NcDialog
		:noClose="noClose"
		@closing="emit('closing', $event)"
		@keydown="onKeydown">
		<template v-for="name in Object.keys($slots)" :key="name" #[name]="slotProps">
			<slot :name="name" v-bind="slotProps ?? {}" />
		</template>
	</NcDialog>
</template>
