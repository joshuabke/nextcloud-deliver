<script setup>
import { t } from '@nextcloud/l10n'
import { ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import ShareLinkItem from './ShareLinkItem.vue'
import { createShareLink, listShares } from '../api.js'
import { useBusy } from '../composables/busy.js'

// The Share Links of one file or folder, in the Files sidebar and in the Review view
const props = defineProps({
	fileId: { type: Number, required: true },
	canWrite: { type: Boolean, default: false },
})

const emit = defineEmits(['changed'])

const shares = ref([])
const { busy, error, run } = useBusy()

watch(() => props.fileId, (fileId) => {
	shares.value = []
	run(async () => {
		const found = await listShares(fileId)
		// The sidebar may have moved on to another node meanwhile
		if (props.fileId === fileId) {
			shares.value = found
		}
	})
}, { immediate: true })

/** A new Share Link with review already on (story 45) */
function addLink() {
	return run(async () => {
		shares.value = [...shares.value, await createShareLink(props.fileId)]
		emit('changed')
	})
}

/**
 * @param {object} updated - the Share Link as the server returned it
 */
function replace(updated) {
	shares.value = shares.value.map((each) => each.id === updated.id ? updated : each)
}

/**
 * @param {number} id - the Share Link deleted
 */
function drop(id) {
	shares.value = shares.value.filter((each) => each.id !== id)
	emit('changed')
}
</script>

<template>
	<div class="deliver-links">
		<p v-if="shares.length === 0 && !busy" class="deliver-links__hint">
			{{ t('deliver', 'No link yet.') }}
		</p>
		<ShareLinkItem
			v-for="share in shares"
			:key="share.id"
			:share="share"
			:canWrite="canWrite"
			@update="replace"
			@deleted="drop" />
		<p v-if="error" class="deliver-links__error">
			{{ error }}
		</p>
		<NcButton :disabled="busy || !canWrite" variant="secondary" @click="addLink">
			{{ t('deliver', 'Create Review Link') }}
		</NcButton>
	</div>
</template>

<style scoped>
.deliver-links {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: calc(2 * var(--default-grid-baseline));
}

.deliver-links > :deep(.deliver-link) {
	width: 100%;
}

.deliver-links__hint {
	color: var(--color-text-maxcontrast);
}

.deliver-links__error {
	color: var(--color-error-text);
}
</style>
