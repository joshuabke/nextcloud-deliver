<script setup>
import { t } from '@nextcloud/l10n'
import { nextTick, onMounted, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcTextField from '@nextcloud/vue/components/NcTextField'

const props = defineProps({
	/** The file's current name */
	name: { type: String, required: true },
})

const emit = defineEmits(['rename', 'close'])

const value = ref(props.name)
const field = ref(null)

// The name without its extension is selected, as Files does it
onMounted(async () => {
	await nextTick()
	const input = field.value?.$el.querySelector('input')
	const dot = props.name.lastIndexOf('.')
	input?.focus()
	input?.setSelectionRange(0, dot > 0 ? dot : props.name.length)
})

/** Hands the new name on, unless nothing changed */
function submit() {
	const name = value.value.trim()
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
			<NcTextField ref="field" v-model="value" :label="t('deliver', 'Name')" />
		</form>
		<p class="deliver-rename__hint">
			{{ t('deliver', 'Don\'t rename files that are actively being worked on outside of Deliver.') }}
		</p>
		<template #actions>
			<NcButton
				type="submit"
				form="deliver-rename"
				variant="primary"
				:disabled="!value.trim()">
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
