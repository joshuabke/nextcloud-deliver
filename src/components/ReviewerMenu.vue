<script setup>
import accountIcon from '@mdi/svg/svg/account-circle-outline.svg?raw'
import mailIcon from '@mdi/svg/svg/email-outline.svg?raw'
import endIcon from '@mdi/svg/svg/logout.svg?raw'
import { showError, showSuccess } from '@nextcloud/dialogs'
import { getLanguage, t } from '@nextcloud/l10n'
import { ref, watch } from 'vue'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActionCaption from '@nextcloud/vue/components/NcActionCaption'
import NcActionCheckbox from '@nextcloud/vue/components/NcActionCheckbox'
import NcActionInput from '@nextcloud/vue/components/NcActionInput'
import NcActionRadio from '@nextcloud/vue/components/NcActionRadio'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcActionSeparator from '@nextcloud/vue/components/NcActionSeparator'
import NcActionText from '@nextcloud/vue/components/NcActionText'
import NcAvatar from '@nextcloud/vue/components/NcAvatar'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { errorMessage, forgetReviewer, updateReviewer } from '../api.js'
import { confirmRemoval } from '../confirm.js'
import { chooseLanguage } from '../lib/language.js'

// The Reviewer's own menu, as on Frame.io: their name and address, what to mail, the language, and the end of the session
const props = defineProps({
	/** The Reviewer: { name, email, mail: { replies, comments, versions } }; null before they named themselves */
	reviewer: { type: Object, default: null },
})

const emit = defineEmits(['update:reviewer'])

const WISHES = [
	{ id: 'replies', label: t('deliver', 'Replies to my Comments') },
	{ id: 'comments', label: t('deliver', 'Every new Comment') },
	{ id: 'versions', label: t('deliver', 'New Versions') },
]
// The two languages Deliver ships, each in its own words
const LANGUAGES = [
	{ id: 'de', label: 'Deutsch' },
	{ id: 'en', label: 'English' },
]
const language = getLanguage().split(/[-_]/)[0]

// Each field follows what is stored, without touching what is typed into the other
const name = ref('')
const email = ref('')
watch(() => props.reviewer?.name, (value) => {
	name.value = value ?? ''
}, { immediate: true })
watch(() => props.reviewer?.email, (value) => {
	email.value = value ?? ''
}, { immediate: true })

/**
 * Saves name, address and what to mail; the server has the last word
 *
 * @param {object} change - what changed: name, email and/or mail wishes
 */
async function save(change) {
	const mail = { ...props.reviewer.mail, ...(change.mail ?? {}) }
	try {
		const stored = await updateReviewer(
			change.name ?? null,
			'email' in change ? (change.email || null) : props.reviewer.email,
			mail,
		)
		emit('update:reviewer', { ...props.reviewer, name: stored.name, email: stored.email, mail: stored.mail })
		if ('name' in change) {
			showSuccess(t('deliver', 'You are now "{name}"', { name: stored.name }))
		} else if (stored.mailed) {
			showSuccess(t('deliver', 'Your Personal Link is on its way to {email}', { email: stored.email }))
		} else if ('email' in change) {
			showSuccess(stored.email ? t('deliver', 'Mails go to {email}', { email: stored.email }) : t('deliver', 'No more mails'))
		}
	} catch (e) {
		name.value = props.reviewer.name
		showError(errorMessage(e))
	}
}

/** This browser forgets the Reviewer; whoever comes next names themselves anew */
async function end() {
	const confirmed = await confirmRemoval(
		t('deliver', 'End the session?'),
		props.reviewer.email
			? t('deliver', 'Your Personal Link makes you "{name}" again; Deliver mailed it to {email}.', { name: props.reviewer.name, email: props.reviewer.email })
			: t('deliver', 'Only your Personal Link makes you "{name}" again. Without it, you will review under a new name.', { name: props.reviewer.name }),
		t('deliver', 'End session'),
	)
	if (!confirmed) {
		return
	}
	try {
		await forgetReviewer()
		// The Personal Link in the address would name them again
		const url = new URL(window.location.href)
		url.searchParams.delete('r')
		window.location.replace(url)
	} catch (e) {
		showError(errorMessage(e))
	}
}
</script>

<template>
	<NcActions
		variant="tertiary-no-background"
		:closeAfterClick="false"
		:aria-label="reviewer ? t('deliver', 'Reviewing as {name}', { name: reviewer.name }) : t('deliver', 'Language')"
		:title="reviewer ? t('deliver', 'Reviewing as {name}', { name: reviewer.name }) : t('deliver', 'Language')">
		<template #icon>
			<NcAvatar
				v-if="reviewer"
				:displayName="reviewer.name"
				:size="32"
				isNoUser
				disableMenu
				disableTooltip />
			<NcIconSvgWrapper v-else :svg="accountIcon" />
		</template>
		<template v-if="reviewer">
			<NcActionInput
				v-model="name"
				:label="t('deliver', 'Name')"
				@submit="name.trim() && save({ name })">
				<template #icon>
					<NcIconSvgWrapper :svg="accountIcon" />
				</template>
			</NcActionInput>
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
			<NcActionText v-if="!reviewer.email">
				{{ t('deliver', 'With an email address, Deliver can mail you about') }}
			</NcActionText>
			<NcActionCaption v-else :name="t('deliver', 'Mail me about')" />
			<NcActionCheckbox
				v-for="wish in WISHES"
				:key="wish.id"
				:modelValue="reviewer.mail[wish.id]"
				:disabled="!reviewer.email"
				@update:modelValue="save({ mail: { [wish.id]: $event } })">
				{{ wish.label }}
			</NcActionCheckbox>
			<NcActionSeparator />
		</template>
		<NcActionCaption :name="t('deliver', 'Language')" />
		<NcActionRadio
			v-for="each in LANGUAGES"
			:key="each.id"
			:value="each.id"
			:modelValue="language"
			name="deliver-language"
			@update:modelValue="chooseLanguage(each.id)">
			{{ each.label }}
		</NcActionRadio>
		<template v-if="reviewer">
			<NcActionSeparator />
			<NcActionButton @click="end">
				<template #icon>
					<NcIconSvgWrapper :svg="endIcon" />
				</template>
				{{ t('deliver', 'End session') }}
			</NcActionButton>
		</template>
	</NcActions>
</template>
