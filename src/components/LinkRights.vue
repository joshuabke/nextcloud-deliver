<script setup>
import { t } from '@nextcloud/l10n'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'

/** A Review Link's rights for its Reviewers (stories 51, 121), for its settings and for an invitation */
defineProps({
	/** canComment, watermark, allowOlder, latestOnly, canDownload */
	flags: { type: Object, required: true },
	disabled: { type: Boolean, default: false },
})
/** One right changed, as `{ [right]: value }` */
const emit = defineEmits(['change'])
</script>

<template>
	<div class="deliver-link-rights">
		<NcCheckboxRadioSwitch
			:modelValue="flags.canComment"
			:disabled="disabled"
			@update:modelValue="emit('change', { canComment: $event })">
			{{ t('deliver', 'Reviewers may comment') }}
		</NcCheckboxRadioSwitch>
		<NcCheckboxRadioSwitch
			:modelValue="flags.watermark"
			:disabled="disabled"
			@update:modelValue="emit('change', { watermark: $event })">
			{{ t('deliver', 'Watermark with the Reviewer\'s name') }}
		</NcCheckboxRadioSwitch>
		<NcCheckboxRadioSwitch
			:modelValue="flags.allowOlder"
			:disabled="disabled || !flags.canComment || flags.latestOnly"
			@update:modelValue="emit('change', { allowOlder: $event })">
			{{ t('deliver', 'Also on older Versions') }}
		</NcCheckboxRadioSwitch>
		<NcCheckboxRadioSwitch
			:modelValue="flags.latestOnly"
			:disabled="disabled"
			@update:modelValue="emit('change', { latestOnly: $event })">
			{{ t('deliver', 'Only the newest Version') }}
		</NcCheckboxRadioSwitch>
		<NcCheckboxRadioSwitch
			:modelValue="flags.canDownload"
			:disabled="disabled"
			@update:modelValue="emit('change', { canDownload: $event })">
			{{ t('deliver', 'Reviewers may download the original') }}
		</NcCheckboxRadioSwitch>
	</div>
</template>
