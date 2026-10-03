<script setup>
import { t } from '@nextcloud/l10n'
import { computed, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import LinkActivityDialog from './LinkActivityDialog.vue'
import ShareLinkItem from './ShareLinkItem.vue'
import { errorMessage, linkApi } from '../api.js'

const props = defineProps({
	/** A Project Link as the Project's navigation lists it */
	share: { type: Object, required: true },
	/** The Project's Assets, or those of No Project, to pick from */
	assets: { type: Array, default: () => [] },
})

const emit = defineEmits(['update', 'person', 'close', 'deleted'])

const item = ref(null)
/** A link on No Project shows picked Assets only, never all of it */
const onNoProject = computed(() => props.share.projectId === 0)
const picked = computed(() => new Set(props.share.assetIds ?? []))
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

/**
 * @param {number} id - an Asset
 * @param {boolean} on - picked or not
 */
function toggleAsset(id, on) {
	const next = new Set(picked.value)
	if (on) {
		next.add(id)
	} else {
		next.delete(id)
	}
	if (next.size > 0 || !onNoProject.value) {
		pick([...next])
	}
}
</script>

<template>
	<NcDialog
		:name="share.label || share.title || t('deliver', 'Project Link')"
		size="normal"
		@closing="emit('close')">
		<ShareLinkItem
			ref="item"
			:share="share"
			inDialog
			@update="emit('update', $event)"
			@person="emit('person', $event)"
			@deleted="emit('deleted')" />
		<section class="deliver-link-dialog__section">
			<h3>{{ t('deliver', 'What the link shows') }}</h3>
			<NcCheckboxRadioSwitch
				v-if="!onNoProject"
				type="radio"
				name="deliver-link-content"
				:modelValue="share.assetIds === null"
				@update:modelValue="pick(null)">
				{{ t('deliver', 'The whole Project, with every Asset that joins it') }}
			</NcCheckboxRadioSwitch>
			<NcCheckboxRadioSwitch
				v-if="!onNoProject"
				type="radio"
				name="deliver-link-content"
				:modelValue="share.assetIds !== null"
				@update:modelValue="pick(assets.map((asset) => asset.id))">
				{{ t('deliver', 'Only the Assets picked here') }}
			</NcCheckboxRadioSwitch>
			<ul v-if="share.assetIds !== null" class="deliver-link-dialog__assets">
				<li v-for="asset in assets" :key="asset.id">
					<NcCheckboxRadioSwitch
						:modelValue="picked.has(asset.id)"
						@update:modelValue="toggleAsset(asset.id, $event)">
						{{ asset.name }}
					</NcCheckboxRadioSwitch>
				</li>
			</ul>
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

.deliver-link-dialog__assets {
	padding-inline-start: calc(4 * var(--default-grid-baseline));
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
