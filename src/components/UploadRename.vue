<script setup>
import { validateFilename } from '@nextcloud/files'
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import { t } from '../lib/l10n.js'
import { nameProblem, stemOf } from '../lib/uploadName.js'
import { useUploadsStore } from '../store/uploads.js'

const props = defineProps({
	/** An upload refused because its name is taken or not allowed; the reason stands in #deliver-upload-reason-<id> */
	item: { type: Object, required: true },
})

const store = useUploadsStore()
const value = ref(props.item.suggestion)
const problem = ref('')
const open = ref(true)
const root = ref(null)
const field = ref(null)
const again = ref(null)
/** Stops the name in the field from being sent while it is checked */
let checking = null

// What was said is about the name as it was
watch(value, () => {
	problem.value = ''
})

/** Into the field, with the name without its extension selected, as Files does it */
async function enter() {
	await nextTick()
	const input = field.value?.$el.querySelector('input')
	input?.focus()
	input?.setSelectionRange(0, stemOf(value.value).length)
}
defineExpose({ enter })

// Sent, the field goes; whoever was in it stays with its upload
onBeforeUnmount(() => {
	if (root.value.contains(document.activeElement)) {
		root.value.parentElement.closest('[tabindex="-1"]')?.focus()
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
	checking?.abort()
	checking = null
	problem.value = ''
	open.value = false
	await nextTick()
	again.value?.$el.focus()
}

/**
 * @param {string} text - why the name does not do; said aloud, also a second time
 */
async function say(text) {
	if (document.activeElement !== field.value?.$el.querySelector('input')) {
		enter()
	}
	await nextTick()
	problem.value = text
}

/** Sends the upload under the name in the field, or says why not */
async function submit() {
	if (checking) {
		return
	}
	problem.value = ''
	const name = value.value.trim()
	const wrong = nameProblem(name, props.item.name, validateFilename)
	if (wrong) {
		say(wrong)
		return
	}
	const { suggestion } = props.item
	const mine = checking = new AbortController()
	const sent = await store.sendAs(props.item, name, mine.signal)
	if (mine.signal.aborted) {
		return
	}
	checking = null
	if (!sent) {
		// What was suggested is taken by now: the next one takes its place
		value.value = name === suggestion ? props.item.suggestion : value.value
		say(t('deliver', '"{name}" is already in the folder.', { name }))
	}
}
</script>

<template>
	<div ref="root">
		<!-- Escape is the field's alone, not the dialog's -->
		<form
			v-if="open"
			class="deliver-upload-rename"
			@submit.prevent="submit"
			@keydown.esc.stop.prevent="close">
			<div class="deliver-upload-rename__field">
				<NcTextField
					ref="field"
					v-model="value"
					:label="t('deliver', 'New name for {name}', { name: item.renamed ?? item.name })"
					:error="problem !== ''"
					:aria-describedby="`deliver-upload-reason-${item.id} deliver-upload-problem-${item.id}`" />
				<p :id="`deliver-upload-problem-${item.id}`" class="deliver-upload-rename__problem" role="alert">
					{{ problem }}
				</p>
			</div>
			<NcButton type="submit" variant="primary">
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
	</div>
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

.deliver-upload-rename__problem {
	margin: 0;
	color: var(--color-error-text);
}
</style>
