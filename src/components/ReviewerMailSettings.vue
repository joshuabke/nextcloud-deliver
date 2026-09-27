<script setup>
import mailIcon from '@mdi/svg/svg/email-outline.svg?raw'
import { showError, showSuccess } from '@nextcloud/dialogs'
import { t } from '@nextcloud/l10n'
import { ref, watch } from 'vue'
import NcActionCheckbox from '@nextcloud/vue/components/NcActionCheckbox'
import NcActionInput from '@nextcloud/vue/components/NcActionInput'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcActionSeparator from '@nextcloud/vue/components/NcActionSeparator'
import NcActionText from '@nextcloud/vue/components/NcActionText'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { errorMessage, updateReviewer } from '../api.js'

const props = defineProps({
	/** The Reviewer: { email, mail: { replies, comments, versions } } */
	reviewer: { type: Object, required: true },
})

const emit = defineEmits(['update:reviewer'])

const email = ref(props.reviewer.email ?? '')
watch(() => props.reviewer.email, (value) => {
	email.value = value ?? ''
})

/**
 * Saves the address and what to mail; the server has the last word
 *
 * @param {object} change - what changed: email and/or mail wishes
 */
async function save(change) {
	const mail = { ...props.reviewer.mail, ...(change.mail ?? {}) }
	try {
		const stored = await updateReviewer('email' in change ? (change.email || null) : props.reviewer.email, mail)
		emit('update:reviewer', { ...props.reviewer, email: stored.email, mail: stored.mail })
		if ('email' in change) {
			showSuccess(stored.email ? t('deliver', 'Mails go to {email}', { email: stored.email }) : t('deliver', 'No more mails'))
		}
	} catch (e) {
		showError(errorMessage(e))
	}
}
</script>

<template>
	<NcActions
		variant="tertiary"
		:closeAfterClick="false"
		:aria-label="t('deliver', 'Mail settings')"
		:title="t('deliver', 'Mail settings')">
		<template #icon>
			<NcIconSvgWrapper :svg="mailIcon" />
		</template>
		<NcActionInput
			v-model="email"
			type="email"
			:label="t('deliver', 'Email')"
			:placeholder="t('deliver', 'Email (optional)')"
			@submit="save({ email })">
			<template #icon>
				<NcIconSvgWrapper :svg="mailIcon" />
			</template>
		</NcActionInput>
		<NcActionSeparator />
		<NcActionText v-if="!reviewer.email">
			{{ t('deliver', 'With an email address, Deliver can mail you about') }}
		</NcActionText>
		<NcActionCheckbox
			:modelValue="reviewer.mail.replies"
			:disabled="!reviewer.email"
			@update:modelValue="save({ mail: { replies: $event } })">
			{{ t('deliver', 'Replies to my Comments') }}
		</NcActionCheckbox>
		<NcActionCheckbox
			:modelValue="reviewer.mail.comments"
			:disabled="!reviewer.email"
			@update:modelValue="save({ mail: { comments: $event } })">
			{{ t('deliver', 'Every new Comment') }}
		</NcActionCheckbox>
		<NcActionCheckbox
			:modelValue="reviewer.mail.versions"
			:disabled="!reviewer.email"
			@update:modelValue="save({ mail: { versions: $event } })">
			{{ t('deliver', 'New Versions') }}
		</NcActionCheckbox>
	</NcActions>
</template>
