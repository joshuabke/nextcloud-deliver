<script setup>
import { t } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import ShareLinkItem from './ShareLinkItem.vue'

const props = defineProps({
	/** A Share Link as the Project's navigation lists it */
	share: { type: Object, required: true },
	canWrite: { type: Boolean, default: false },
})

const emit = defineEmits(['update', 'person', 'close'])

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
			:share="share"
			:canWrite="canWrite"
			personSettings
			@update="emit('update', $event)"
			@person="emit('person', $event)" />
		<template #actions>
			<NcButton :href="manageUrl">
				{{ t('deliver', 'Password and expiry in Files') }}
			</NcButton>
		</template>
	</NcDialog>
</template>
