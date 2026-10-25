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
		<p v-if="flags.watermark" class="deliver-link-rights__hint">
			{{ t('deliver', 'Shown over the picture in the browser to deter copies; it is not burned into the file.') }}
		</p>
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
		<p v-if="!flags.canDownload" class="deliver-link-rights__hint">
			{{ t('deliver', 'Reviewers watch a Proxy instead. Without ffmpeg on the server, the original still plays in their browser, only without a download button.') }}
		</p>
	</div>
</template>

<style scoped>
.deliver-link-rights__hint {
	margin: 0 0 4px 44px;
	color: var(--color-text-maxcontrast);
	font-size: var(--font-size-small, 13px);
}
</style>
