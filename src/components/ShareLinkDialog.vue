<script setup>
import { t } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import { ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import ShareLinkItem from './ShareLinkItem.vue'

const props = defineProps({
	/** A Share Link as the Project's navigation lists it */
	share: { type: Object, required: true },
	canWrite: { type: Boolean, default: false },
})

const emit = defineEmits(['update', 'person', 'close'])

const item = ref(null)

/** Password and expiry are Nextcloud's own share settings */
const manageUrl = generateUrl('/apps/files/files/{fileId}', { fileId: props.share.fileId })
	+ '?' + new URLSearchParams({ dir: props.share.dir, opendetails: 'true' })
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
			@person="emit('person', $event)" />
		<template #actions>
			<NcButton
				v-if="canWrite && share.review && !item?.inviting"
				class="deliver-link-dialog__invite"
				@click="item.startInvite()">
				{{ t('deliver', 'Invite a Reviewer') }}
			</NcButton>
			<NcButton :href="manageUrl">
				{{ t('deliver', 'Password and expiry in Files') }}
			</NcButton>
		</template>
	</NcDialog>
</template>

<style scoped>
/* Left in the row of dialog buttons, apart from the one that leaves for Files */
.deliver-link-dialog__invite {
	margin-inline-end: auto;
}
</style>
