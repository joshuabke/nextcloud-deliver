<script setup>
import { t } from '@nextcloud/l10n'
import { computed, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import AssetPicker from './AssetPicker.vue'
import LinkActivityDialog from './LinkActivityDialog.vue'
import ShareLinkItem from './ShareLinkItem.vue'
import { errorMessage, linkApi } from '../api.js'
import { linkTitle } from '../lib/linkTitle.js'

const props = defineProps({
	/** A Project Link as the Project's navigation lists it */
	share: { type: Object, required: true },
	/** The Project's Assets, or those of No Project, to pick from */
	assets: { type: Array, default: () => [] },
})

const emit = defineEmits(['update', 'close', 'deleted'])

const item = ref(null)
/** A link on No Project shows picked Assets only, never all of it */
const onNoProject = computed(() => props.share.projectId === 0)
const pickError = ref(null)
const showActivity = ref(false)

/**
 * The whole Project, or only the Assets picked (story 120); a link on No Project keeps at least one
 *
 * @param {number[]|null} assetIds - the picked Assets, null for the whole Project
 */
async function pick(assetIds) {
	pickError.value = null
	try {
		emit('update', await linkApi(props.share).update({ assetIds }))
	} catch (e) {
		pickError.value = errorMessage(e)
	}
}

</script>

<template>
	<NcDialog
		:name="share.title ?? linkTitle(share, assets)"
		size="normal"
		@closing="emit('close')">
		<ShareLinkItem
			ref="item"
			:share="share"
			inDialog
			@update="emit('update', $event)"
			@deleted="emit('deleted')" />
		<section class="deliver-link-dialog__section">
			<h3>{{ t('deliver', 'What the link shows') }}</h3>
			<AssetPicker
				:modelValue="share.assetIds"
				:assets="assets"
				:onNoProject="onNoProject"
				name="deliver-link-content"
				@update:modelValue="pick" />
			<p v-if="pickError" class="deliver-link-dialog__error">
				{{ pickError }}
			</p>
		</section>
		<template #actions>
			<NcButton @click="showActivity = true">
				{{ t('deliver', 'Activity') }}
			</NcButton>
			<NcButton
				v-if="share.review && !item?.inviting"
				class="deliver-link-dialog__invite"
				@click="item.startInvite()">
				{{ t('deliver', 'Invite a Reviewer') }}
			</NcButton>
		</template>
		<LinkActivityDialog v-if="showActivity" :share="share" @close="showActivity = false" />
	</NcDialog>
</template>

<style scoped>
.deliver-link-dialog__section {
	margin-top: calc(3 * var(--default-grid-baseline));
}

.deliver-link-dialog__section h3 {
	margin: 0 0 var(--default-grid-baseline);
	font-size: 16px;
}

.deliver-link-dialog__error {
	color: var(--color-error-text);
}

.deliver-link-dialog__hint {
	color: var(--color-text-maxcontrast);
}

/* Left in the row of dialog buttons, apart from the one that leaves for Files */
.deliver-link-dialog__invite {
	margin-inline-end: auto;
}
</style>
