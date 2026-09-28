<script setup>
import { t } from '@nextcloud/l10n'
import { computed, onMounted, ref } from 'vue'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import { getAssetForFile, getProjectForFolder, setShareFlags } from '../api.js'

/**
 * Deliver's review switch inside Nextcloud's own link settings, where Share
 * Links are made (ADR 0004). The Files app sets these three properties on
 * the web component; the flags are saved once the share is.
 */
const props = defineProps({
	/** The shared file or folder */
	node: { type: Object, default: null },
	/** The link share, still without an id while it is being created */
	share: { type: Object, default: null },
	/** Registers what to run after the share was saved */
	onSave: { type: Function, default: null },
})

/** Only files and folders that are part of a Project can be reviewed */
const reviewable = ref(false)
const initial = computed(() => {
	const attribute = (key) => props.share?.attributes?.find((each) => each.scope === 'deliver' && each.key === key)?.value
	return { review: attribute('review') === true, canComment: attribute('comment') !== false, watermark: attribute('watermark') === true }
})
const review = ref(initial.value.review)
const canComment = ref(initial.value.canComment)
const watermark = ref(initial.value.watermark)

onMounted(async () => {
	const fileid = props.node?.fileid
	try {
		await (props.node?.type === 'folder' ? getProjectForFolder(fileid) : getAssetForFile(fileid))
		reviewable.value = true
	} catch {
		reviewable.value = false
	}
	props.onSave?.(async () => {
		const id = props.share?.id
		const changed = review.value !== initial.value.review || canComment.value !== initial.value.canComment || watermark.value !== initial.value.watermark
		if (!reviewable.value || !id || !changed) {
			return
		}
		await setShareFlags(id, { review: review.value, canComment: canComment.value, watermark: watermark.value })
	})
})
</script>

<template>
	<div v-if="reviewable" class="deliver-share-review">
		<NcCheckboxRadioSwitch v-model="review" type="switch">
			{{ t('deliver', 'Review in Deliver') }}
		</NcCheckboxRadioSwitch>
		<p class="deliver-share-review__hint">
			{{ review
				? t('deliver', 'People with this link get a Review button and can leave frame-accurate Comments.')
				: t('deliver', 'An ordinary link: people see and play the files, but no Comments.') }}
		</p>
		<template v-if="review">
			<NcCheckboxRadioSwitch v-model="canComment">
				{{ t('deliver', 'Reviewers may comment') }}
			</NcCheckboxRadioSwitch>
			<NcCheckboxRadioSwitch v-model="watermark">
				{{ t('deliver', 'Watermark with the Reviewer\'s name') }}
			</NcCheckboxRadioSwitch>
		</template>
	</div>
</template>

<style scoped>
.deliver-share-review__hint {
	margin: 0 0 var(--default-grid-baseline);
	padding-inline-start: calc(var(--default-clickable-area) + var(--default-grid-baseline));
	color: var(--color-text-maxcontrast);
}
</style>
