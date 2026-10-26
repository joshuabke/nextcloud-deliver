<script setup>
import accountIcon from '@mdi/svg/svg/account-circle-outline.svg?raw'
import copyIcon from '@mdi/svg/svg/content-copy.svg?raw'
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
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import PersonAvatar from './PersonAvatar.vue'
import { errorMessage, forgetReviewer, updateReviewer } from '../api.js'
import { copyLink } from '../clipboard.js'
import { confirmRemoval } from '../confirm.js'
import { conflictMessage } from '../lib/conflict.js'
import { baseLanguage, chooseLanguage } from '../lib/language.js'

// The Reviewer's own menu, as on Frame.io: their name and address, what to mail, the language, and the end of the session
const props = defineProps({
	/** The Reviewer: { name, email, mail: { replies, comments, versions }, link }, link their Personal Link through this link; null before they named themselves */
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
const language = baseLanguage(getLanguage())

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
		// What is taken, the name or the address, in the page's language
		showError(conflictMessage(e, { name: change.name ?? props.reviewer.name, email: change.email }) ?? errorMessage(e))
	}
}

/**
 * The page in another language, and the mails to the Reviewer too
 *
 * @param {string} picked - de or en
 */
async function pick(picked) {
	if (props.reviewer) {
		try {
			await updateReviewer(null, props.reviewer.email, props.reviewer.mail, picked)
		} catch (e) {
			showError(errorMessage(e))
		}
	}
	chooseLanguage(picked)
}

/** This browser forgets the Reviewer; whoever comes next names themselves anew */
async function end() {
	const confirmed = await confirmRemoval(
		t('deliver', 'End the session?'),
		props.reviewer.email
			? t('deliver', 'To be "{name}" again, give that name and {email} next time, or open your Personal Link.', { name: props.reviewer.name, email: props.reviewer.email })
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
			<PersonAvatar v-if="reviewer" :author="{ type: 'reviewer', id: reviewer.id, name: reviewer.name }" :size="32" />
			<NcIconSvgWrapper v-else :svg="accountIcon" />
		</template>
		<!-- On several links, only the Member who invited them changes name and address (ADR 0014) -->
		<template v-if="reviewer?.severalLinks">
			<NcActionText>
				<template #icon>
					<NcIconSvgWrapper :svg="accountIcon" />
				</template>
				{{ reviewer.email ? `${reviewer.name} · ${reviewer.email}` : reviewer.name }}
			</NcActionText>
			<NcActionText>
				{{ t('deliver', 'You review on several links: ask whoever invited you to change your name or address.') }}
			</NcActionText>
		</template>
		<template v-if="reviewer && !reviewer.severalLinks">
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
		</template>
		<template v-if="reviewer">
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
			@update:modelValue="pick(each.id)">
			{{ each.label }}
		</NcActionRadio>
		<template v-if="reviewer">
			<NcActionSeparator />
			<!-- To be them on another device, whenever they like (story 128) -->
			<NcActionButton @click="copyLink(reviewer.link, t('deliver', 'Personal Link copied'))">
				<template #icon>
					<NcIconSvgWrapper :svg="copyIcon" />
				</template>
				{{ t('deliver', 'Copy Personal Link') }}
			</NcActionButton>
			<NcActionButton @click="end">
				<template #icon>
					<NcIconSvgWrapper :svg="endIcon" />
				</template>
				{{ t('deliver', 'End session') }}
			</NcActionButton>
		</template>
	</NcActions>
</template>
