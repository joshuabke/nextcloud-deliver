<script setup>
import { validateFilename } from '@nextcloud/files'
import { nextTick, onMounted, ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import { t } from '../lib/l10n.js'
import { nameProblem, stemOf } from '../lib/uploadName.js'
import { useUploadsStore } from '../store/uploads.js'

const props = defineProps({
	/** An upload refused because its name is taken */
	item: { type: Object, required: true },
	/** Whether the field takes the focus as it appears, where nobody is typing elsewhere */
	focus: Boolean,
})

const store = useUploadsStore()
const value = ref(props.item.suggestion)
const problem = ref(null)
const open = ref(true)
const busy = ref(false)
const field = ref(null)
const again = ref(null)

// What was said is about the name as it was
watch(value, () => {
	problem.value = null
})

/** Into the field, with the name without its extension selected, as Files does it */
async function enter() {
	await nextTick()
	const input = field.value?.$el.querySelector('input')
	input?.focus()
	input?.setSelectionRange(0, stemOf(value.value).length)
}
onMounted(() => {
	if (props.focus && !document.activeElement?.matches('input:not([type=file], [type=checkbox]), textarea, [contenteditable]')) {
		enter()
	}
})

/** Opens the field again */
function reopen() {
	value.value = props.item.suggestion
	open.value = true
	enter()
}

/** Leaves the upload refused */
async function close() {
	open.value = false
	await nextTick()
	again.value?.$el.focus()
}

/** Sends the upload under the name in the field, or says why not */
async function submit() {
	const name = value.value.trim()
	problem.value = nameProblem(name, props.item.name, validateFilename)
	if (problem.value || busy.value) {
		return
	}
	busy.value = true
	if (!await store.sendAs(props.item, name)) {
		problem.value = t('deliver', 'A file with this name is already in the folder.')
	}
	busy.value = false
}
</script>

<template>
	<!-- Escape is the field's alone, not the dialog's -->
	<form
		v-if="open"
		class="deliver-upload-rename"
		@submit.prevent="submit"
		@keydown.esc.stop.prevent="close">
		<NcTextField
			ref="field"
			v-model="value"
			class="deliver-upload-rename__field"
			:label="t('deliver', 'New name')"
			:error="problem !== null"
			:helperText="problem ?? ''" />
		<NcButton type="submit" variant="primary" :disabled="busy">
			{{ t('deliver', 'Rename and upload') }}
		</NcButton>
	</form>
	<NcButton
		v-else
		ref="again"
		variant="secondary"
		@click="reopen">
		{{ t('deliver', 'Rename…') }}
	</NcButton>
</template>

<style scoped>
.deliver-upload-rename {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-start;
	gap: calc(2 * var(--default-grid-baseline));
	width: 100%;
}

.deliver-upload-rename__field {
	flex: 1 1 180px;
	min-width: 0;
}
</style>
