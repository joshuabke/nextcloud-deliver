<script setup>
import { n, t } from '@nextcloud/l10n'
import { computed, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import LinkActivityDialog from './LinkActivityDialog.vue'
import ShareLinkItem from './ShareLinkItem.vue'
import { errorMessage, linkApi } from '../api.js'

const props = defineProps({
	/** A Share Link or Project Link as the Project's navigation lists it */
	share: { type: Object, required: true },
	canWrite: { type: Boolean, default: false },
	/** The Project's Auto Intake, which decides whether every file under a Share Link is up for review */
	autoIntake: { type: Boolean, default: false },
	/** The Project's Assets, to pick from for a Project Link */
	assets: { type: Array, default: () => [] },
})

const emit = defineEmits(['update', 'person', 'close', 'autoIntake', 'deleted'])

const item = ref(null)
const isProject = computed(() => props.share.kind === 'project')
const picked = computed(() => new Set(props.share.assetIds ?? []))
const pickError = ref(null)
const showActivity = ref(false)

/**
 * The whole Project, or only the Assets picked (story 120)
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
	pick([...next])
}
</script>

<template>
	<NcDialog
		:name="isProject ? (share.label || t('deliver', 'Project Link')) : t('deliver', 'Share Link on {name}', { name: share.name })"
		size="normal"
		@closing="emit('close')">
		<ShareLinkItem
			ref="item"
			:share="share"
			:canWrite="canWrite"
			inDialog
			@update="emit('update', $event)"
			@person="emit('person', $event)"
			@deleted="emit('deleted')" />
		<section v-if="isProject && canWrite" class="deliver-link-dialog__section">
			<h3>{{ t('deliver', 'What the link shows') }}</h3>
			<NcCheckboxRadioSwitch
				type="radio"
				name="deliver-link-content"
				:modelValue="share.assetIds === null"
				@update:modelValue="pick(null)">
				{{ t('deliver', 'The whole Project, with every Asset that joins it') }}
			</NcCheckboxRadioSwitch>
			<NcCheckboxRadioSwitch
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
		<div v-if="!isProject && canWrite && share.review && (share.notEnabled > 0 || autoIntake)" class="deliver-link-dialog__intake">
			<p v-if="share.notEnabled > 0" class="deliver-link-dialog__hint">
				{{ n('deliver', '%n media file here is not up for review, so Reviewers see it without a Review button.', '%n media files here are not up for review, so Reviewers see them without a Review button.', share.notEnabled) }}
			</p>
			<NcCheckboxRadioSwitch
				type="switch"
				:modelValue="autoIntake"
				@update:modelValue="emit('autoIntake', $event)">
				{{ t('deliver', 'Auto Intake: review every media file in the Project folder') }}
			</NcCheckboxRadioSwitch>
		</div>
		<template #actions>
			<NcButton v-if="canWrite" @click="showActivity = true">
				{{ t('deliver', 'Activity') }}
			</NcButton>
			<NcButton
				v-if="canWrite && share.review && !item?.inviting"
				class="deliver-link-dialog__invite"
				@click="item.startInvite()">
				{{ t('deliver', 'Invite a Reviewer') }}
			</NcButton>
		</template>
		<LinkActivityDialog v-if="showActivity" :share="share" @close="showActivity = false" />
	</NcDialog>
</template>

<style scoped>
.deliver-link-dialog__intake {
	margin-top: calc(3 * var(--default-grid-baseline));
}

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
