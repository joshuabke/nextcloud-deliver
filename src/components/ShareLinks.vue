<script setup>
import { t } from '@nextcloud/l10n'
import { ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import ShareLinkItem from './ShareLinkItem.vue'
import { createProjectLink, listProjectLinks } from '../api.js'
import { useBusy } from '../composables/busy.js'

// The Project Links that show a Project or one of its Assets, in the Files sidebar and in the Review view
const props = defineProps({
	/** The Project, 0 for No Project */
	projectId: { type: Number, required: true },
	/** One Asset of it; null for the whole Project */
	assetId: { type: Number, default: null },
})

const links = ref([])
const { busy, error, run } = useBusy()

/**
 * @param {object} link - a Project Link
 * @return {boolean} whether it shows the Asset, or is about the whole Project
 */
const shows = (link) => props.assetId === null || link.assetIds === null || link.assetIds.includes(props.assetId)

watch(() => [props.projectId, props.assetId], ([projectId, assetId]) => {
	links.value = []
	run(async () => {
		const found = (await listProjectLinks(projectId)).links
		// The sidebar may have moved on to another node meanwhile
		if (props.projectId === projectId && props.assetId === assetId) {
			links.value = found.filter(shows)
		}
	})
}, { immediate: true })

/** A new link, live, on the Asset alone or on the whole Project (stories 45, 120) */
function addLink() {
	return run(async () => {
		links.value = [...links.value, await createProjectLink(props.projectId, props.assetId === null ? null : [props.assetId])]
	})
}

/**
 * @param {object} updated - the link as the server returned it
 */
function replace(updated) {
	links.value = links.value.map((each) => each.id === updated.id ? updated : each)
}

/**
 * @param {number} id - the link deleted
 */
function drop(id) {
	links.value = links.value.filter((each) => each.id !== id)
}
</script>

<template>
	<div class="deliver-links">
		<p v-if="links.length === 0 && !busy" class="deliver-links__hint">
			{{ t('deliver', 'No link yet.') }}
		</p>
		<ShareLinkItem
			v-for="link in links"
			:key="link.id"
			:share="link"
			@update="replace"
			@deleted="drop" />
		<p v-if="error" class="deliver-links__error">
			{{ error }}
		</p>
		<NcButton :disabled="busy" variant="secondary" @click="addLink">
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
