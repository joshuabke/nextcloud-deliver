<script setup>
import { t } from '@nextcloud/l10n'
import { computed, nextTick, onMounted, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import { extensionOf } from '../lib/media.js'

const props = defineProps({
	/** The file's current name */
	name: { type: String, required: true },
})

const emit = defineEmits(['rename', 'close'])

const value = ref(props.name)
const field = ref(null)
const extension = extensionOf(props.name)
const keepsExtension = computed(() => extensionOf(value.value.trim()) === extension)

// The name without its extension is selected, as Files does it
onMounted(async () => {
	await nextTick()
	const input = field.value?.$el.querySelector('input')
	const dot = props.name.lastIndexOf('.')
	input?.focus()
	input?.setSelectionRange(0, dot > 0 ? dot : props.name.length)
})

/** Hands the new name on, unless nothing changed; a new extension is refused */
function submit() {
	const name = value.value.trim()
	if (!keepsExtension.value) {
		return
	}
	if (name && name !== props.name) {
		emit('rename', name)
	}
	emit('close')
}
</script>

<template>
	<NcDialog
		:name="t('deliver', 'Rename file')"
		size="small"
		@closing="emit('close')">
		<form id="deliver-rename" @submit.prevent="submit">
			<NcTextField
				ref="field"
				v-model="value"
				:label="t('deliver', 'Name')"
				:error="!keepsExtension"
				:helperText="keepsExtension ? '' : t('deliver', 'Keep the extension {extension}.', { extension })" />
		</form>
		<p class="deliver-rename__hint">
			{{ t('deliver', 'Don\'t rename files that are actively being worked on outside of Deliver.') }}
		</p>
		<template #actions>
			<NcButton
				type="submit"
				form="deliver-rename"
				variant="primary"
				:disabled="!value.trim() || !keepsExtension">
				{{ t('deliver', 'Rename') }}
			</NcButton>
		</template>
	</NcDialog>
</template>

<style scoped>
.deliver-rename__hint {
	margin-top: calc(2 * var(--default-grid-baseline));
	color: var(--color-text-maxcontrast);
	font-size: 13px;
}
</style>
