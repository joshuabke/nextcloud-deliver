<script setup>
import { n, t } from '@nextcloud/l10n'
import { ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import ShareLinkItem from './ShareLinkItem.vue'

defineProps({
	/** A Share Link as the Project's navigation lists it */
	share: { type: Object, required: true },
	canWrite: { type: Boolean, default: false },
	/** The Project's Auto Intake, which decides whether every file under the link is up for review */
	autoIntake: { type: Boolean, default: false },
})

const emit = defineEmits(['update', 'person', 'close', 'autoIntake', 'deleted'])

const item = ref(null)
</script>

<template>
	<NcDialog
		:name="t('deliver', 'Share Link on {name}', { name: share.name })"
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
		<div v-if="canWrite && share.review && (share.notEnabled > 0 || autoIntake)" class="deliver-link-dialog__intake">
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
			<NcButton
				v-if="canWrite && share.review && !item?.inviting"
				class="deliver-link-dialog__invite"
				@click="item.startInvite()">
				{{ t('deliver', 'Invite a Reviewer') }}
			</NcButton>
		</template>
	</NcDialog>
</template>

<style scoped>
.deliver-link-dialog__intake {
	margin-top: calc(3 * var(--default-grid-baseline));
}

.deliver-link-dialog__hint {
	color: var(--color-text-maxcontrast);
}

/* Left in the row of dialog buttons, apart from the one that leaves for Files */
.deliver-link-dialog__invite {
	margin-inline-end: auto;
}
</style>
