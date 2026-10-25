<script setup>
import removeIcon from '@mdi/svg/svg/account-remove-outline.svg?raw'
import settingsIcon from '@mdi/svg/svg/cog-outline.svg?raw'
import copyIcon from '@mdi/svg/svg/content-copy.svg?raw'
import deleteIcon from '@mdi/svg/svg/trash-can-outline.svg?raw'
import { showError, showSuccess } from '@nextcloud/dialogs'
import { t } from '@nextcloud/l10n'
import { computed, ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcPasswordField from '@nextcloud/vue/components/NcPasswordField'
import NcTextArea from '@nextcloud/vue/components/NcTextArea'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import ContactField from './ContactField.vue'
import LinkRights from './LinkRights.vue'
import PersonalLinkRightsDialog from './PersonalLinkRightsDialog.vue'
import { linkApi, takeReviewerOff } from '../api.js'
import { copyLink } from '../clipboard.js'
import { useBusy } from '../composables/busy.js'
import { confirmLinkDeletion, confirmTakeOff } from '../confirm.js'
import { linkTitle } from '../lib/linkTitle.js'
import { reviewerWithAddress } from '../lib/people.js'

const props = defineProps({
	/** One Review Link of the Member's, as the server lists it */
	link: { type: Object, required: true },
	/** In the Project's link dialog: each Reviewer's settings are offered, and the dialog's own button invites */
	inDialog: { type: Boolean, default: false },
	/** The Project's Reviewers, to suggest and to recognise by address when inviting */
	people: { type: Array, required: true },
})

const emit = defineEmits(['update', 'deleted'])

const { busy, error, run } = useBusy()
/** The Reviewers on this link, each with their Personal Link through it and their own rights on it; null while loading */
const reviewers = ref(null)
/** The link's title as the navigation gives it: its label, else what it shows (story 145) */
const title = computed(() => props.link.title ?? linkTitle(props.link))
/** Switched on but past its expiry date: it opens for nobody (#76) */
const expired = computed(() => props.link.review && !props.link.live && Boolean(props.link.expireDate))
/** The Reviewer whose own rights on this link are open */
const rightsOf = ref(null)
const inviting = ref(false)
const name = ref('')
const email = ref('')
const withAddress = computed(() => props.people.filter((reviewer) => reviewer.email))
/** The Reviewer the address belongs to: this link goes to them, under their name (ADR 0014) */
const known = computed(() => reviewerWithAddress(withAddress.value, email.value))
/** Whether that Reviewer is on this link already, so that inviting changes nothing */
const knownHere = computed(() => known.value && (reviewers.value ?? []).some((reviewer) => reviewer.id === known.value.id))
/** Whether the invited Reviewer gets their Personal Link by mail, under the Member's own message */
const sendMail = ref(false)
const message = ref('')
/** A password or expiry being given to a link that has none yet */
const settingPassword = ref(false)
const settingExpiry = ref(false)
const password = ref('')

/**
 * @param {boolean} on - the password switch
 */
function togglePassword(on) {
	settingPassword.value = on
	password.value = ''
	if (!on && props.link.hasPassword) {
		setFlags({ password: '' })
	}
}

/** Nextcloud's password policy decides; its refusal shows below the link */
async function savePassword() {
	await setFlags({ password: password.value })
	if (!error.value) {
		password.value = ''
		settingPassword.value = false
	}
}

/**
 * @param {boolean} on - the expiry switch
 */
function toggleExpiry(on) {
	settingExpiry.value = on
	if (!on && props.link.expireDate) {
		setFlags({ expireDate: '' })
	}
}

/**
 * @param {object} flags - what to change: review, canComment, allowOlder, watermark; password and expireDate, empty to remove
 */
function setFlags(flags) {
	return run(async () => emit('update', await linkApi(props.link).update(flags)))
}

/** Deletes the link: it stops working for everyone, Personal Links through it too */
async function remove() {
	if (await confirmLinkDeletion()) {
		await run(async () => {
			await linkApi(props.link).remove()
			emit('deleted', props.link.id)
		})
	}
}

/**
 * Takes a Reviewer off this link only; they stay the Project's, on their other links
 *
 * @param {object} reviewer - one of the Reviewers listed
 */
async function takeOff(reviewer) {
	if (await confirmTakeOff(reviewer.name)) {
		await run(async () => {
			await takeReviewerOff(reviewer.id, props.link.token)
			reviewers.value = reviewers.value.filter((each) => each.id !== reviewer.id)
		})
	}
}

// The Reviewers on this link show with their Personal Link through it (ADR 0014)
watch(() => [props.link.token, props.link.review], ([, review]) => {
	reviewers.value = null
	if (review) {
		run(async () => {
			reviewers.value = await linkApi(props.link).reviewers()
		})
	}
}, { immediate: true })

/** What Reviewers read above the Assets (story 123) */
const description = ref(props.link.description ?? '')
watch(() => props.link.description, (value) => {
	description.value = value ?? ''
})

/** Opens the form to invite a Reviewer, for a button outside */
function startInvite() {
	inviting.value = true
}

defineExpose({ startInvite, inviting })

/** Invites a Reviewer by name and gets their Personal Link, mailed to them when asked (story 53) */
function invite() {
	return run(async () => {
		const letter = sendMail.value && email.value.trim() ? { message: message.value } : null
		const reviewer = await linkApi(props.link).invite(name.value, email.value || null, letter)
		// As the server lists them, with their rights here, and once even when they were on the link already
		reviewers.value = await linkApi(props.link).reviewers()
		if (letter && reviewer.mailed) {
			showSuccess(t('deliver', 'Personal Link mailed to {email}', { email: reviewer.email }))
		} else if (letter) {
			showError(t('deliver', 'The mail could not be sent. Copy the Personal Link instead.'))
		}
		name.value = ''
		email.value = ''
		sendMail.value = false
		message.value = ''
		inviting.value = false
	})
}
</script>

<template>
	<div class="deliver-link">
		<div class="deliver-link__head">
			<span class="deliver-link__title" :title="link.url">{{ title }}</span>
			<NcButton
				variant="tertiary"
				:aria-label="t('deliver', 'Copy link')"
				:title="t('deliver', 'Copy link')"
				@click="copyLink(link.url, t('deliver', 'Link copied'))">
				<template #icon>
					<NcIconSvgWrapper :svg="copyIcon" />
				</template>
			</NcButton>
			<NcButton
				variant="tertiary"
				:disabled="busy"
				:aria-label="t('deliver', 'Delete link')"
				:title="t('deliver', 'Delete link')"
				@click="remove">
				<template #icon>
					<NcIconSvgWrapper :svg="deleteIcon" />
				</template>
			</NcButton>
		</div>
		<!-- A link pauses and goes live again with its Reviewers (story 122) -->
		<NcCheckboxRadioSwitch
			type="switch"
			:modelValue="link.review && !expired"
			:disabled="busy || expired"
			@update:modelValue="setFlags({ review: $event })">
			{{ t('deliver', 'Link is live') }}
		</NcCheckboxRadioSwitch>
		<p v-if="expired" class="deliver-link__hint">
			{{ t('deliver', 'Expired: the link shows nothing until you change or remove its expiry date.') }}
		</p>
		<p v-else-if="!link.review" class="deliver-link__hint">
			{{ t('deliver', 'Paused: the link shows nothing until you switch it on again.') }}
		</p>

		<div class="deliver-link__flags">
			<NcCheckboxRadioSwitch
				:modelValue="link.hasPassword || settingPassword"
				:disabled="busy"
				@update:modelValue="togglePassword">
				{{ t('deliver', 'Password') }}
			</NcCheckboxRadioSwitch>
			<form v-if="link.hasPassword || settingPassword" class="deliver-link__field" @submit.prevent="savePassword">
				<NcPasswordField
					v-model="password"
					:label="link.hasPassword ? t('deliver', 'New password') : t('deliver', 'Password')"
					autocomplete="new-password" />
				<NcButton type="submit" :disabled="busy || !password">
					{{ t('deliver', 'Save') }}
				</NcButton>
			</form>
			<NcCheckboxRadioSwitch
				:modelValue="Boolean(link.expireDate) || settingExpiry"
				:disabled="busy"
				@update:modelValue="toggleExpiry">
				{{ t('deliver', 'Expiry date') }}
			</NcCheckboxRadioSwitch>
			<input
				v-if="link.expireDate || settingExpiry"
				class="deliver-link__date"
				type="date"
				:value="link.expireDate ?? ''"
				:disabled="busy"
				:aria-label="t('deliver', 'Expiry date')"
				@change="$event.target.value && setFlags({ expireDate: $event.target.value })">
		</div>

		<template v-if="link.review">
			<p v-if="!link.hasPassword" class="deliver-link__hint">
				{{ t('deliver', 'This link has no password. Anyone it reaches can review.') }}
			</p>
			<p v-if="link.canMail === false" class="deliver-link__hint">
				{{ t('deliver', 'This Nextcloud sends no email, so Reviewers are not mailed when someone replies to them.') }}
			</p>
			<div class="deliver-link__flags">
				<LinkRights :flags="link" :disabled="busy" @change="setFlags" />
				<NcTextArea
					v-model="description"
					class="deliver-link__description"
					:label="t('deliver', 'Description for Reviewers')"
					:disabled="busy"
					resize="vertical"
					@blur="description !== (link.description ?? '') && setFlags({ description })" />
			</div>

			<div class="deliver-link__reviewers">
				<p v-if="reviewers?.length === 0" class="deliver-link__hint">
					{{ t('deliver', 'No Reviewers yet.') }}
				</p>
				<ul v-else-if="reviewers">
					<li v-for="reviewer in reviewers" :key="reviewer.id" class="deliver-link__reviewer">
						<span class="deliver-link__name">{{ reviewer.name }}</span>
						<NcButton v-if="link.live" variant="tertiary" @click="copyLink(reviewer.link, t('deliver', 'Personal Link copied'))">
							{{ t('deliver', 'Copy Personal Link') }}
						</NcButton>
						<NcButton
							variant="tertiary"
							:aria-label="t('deliver', 'Take {name} off this link', { name: reviewer.name })"
							:title="t('deliver', 'Take {name} off this link', { name: reviewer.name })"
							@click="takeOff(reviewer)">
							<template #icon>
								<NcIconSvgWrapper :svg="removeIcon" />
							</template>
						</NcButton>
						<!-- Their own rights on this link (ADR 0014) -->
						<NcButton
							variant="tertiary"
							:aria-label="t('deliver', 'Rights of {name} on this link', { name: reviewer.name })"
							:title="t('deliver', 'Rights of {name} on this link', { name: reviewer.name })"
							@click="rightsOf = reviewer">
							<template #icon>
								<NcIconSvgWrapper :svg="settingsIcon" />
							</template>
						</NcButton>
					</li>
				</ul>
				<p v-if="reviewers?.length" class="deliver-link__hint">
					{{ t('deliver', 'A Personal Link makes whoever opens it that Reviewer, forever. Give each one to its person only.') }}
				</p>

				<form v-if="inviting" class="deliver-link__invite" @submit.prevent="invite">
					<div class="deliver-link__invite-row">
						<ContactField
							v-model="name"
							:label="t('deliver', 'Name')"
							:people="withAddress"
							@pick="(contact) => email = contact.email" />
						<NcTextField v-model="email" type="email" :label="t('deliver', 'Email (optional)')" />
						<NcButton type="submit" variant="primary" :disabled="busy || !name.trim()">
							{{ t('deliver', 'Invite') }}
						</NcButton>
					</div>
					<p v-if="knownHere" class="deliver-link__hint">
						{{ t('deliver', '{name} is on this link already.', { name: known.name }) }}
					</p>
					<p v-else-if="known" class="deliver-link__hint">
						{{ t('deliver', '{name} reviews this Project already and gets this link too.', { name: known.name }) }}
					</p>
					<template v-if="email.trim() && link.canMail">
						<NcCheckboxRadioSwitch v-model="sendMail">
							{{ t('deliver', 'Mail them their Personal Link') }}
						</NcCheckboxRadioSwitch>
						<NcTextArea
							v-if="sendMail"
							v-model="message"
							:label="t('deliver', 'Your message (optional)')"
							resize="vertical" />
					</template>
				</form>
				<NcButton
					v-else-if="!inDialog"
					variant="tertiary"
					:disabled="busy"
					@click="inviting = true">
					{{ t('deliver', 'Invite a Reviewer') }}
				</NcButton>
			</div>
		</template>

		<p v-if="error" class="deliver-link__error">
			{{ error }}
		</p>
		<PersonalLinkRightsDialog
			v-if="rightsOf"
			:reviewer="rightsOf"
			:link="{ ...link, title }"
			:rights="rightsOf.rights"
			@changed="(rights) => rightsOf.rights = rights"
			@close="rightsOf = null" />
	</div>
</template>

<style scoped>
.deliver-link {
	display: flex;
	flex-direction: column;
	gap: var(--default-grid-baseline);
	overflow-wrap: anywhere;
}

.deliver-link__head {
	display: flex;
	align-items: center;
	gap: var(--default-grid-baseline);
}

.deliver-link__title {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-weight: bold;
}

.deliver-link__flags,
.deliver-link__reviewers {
	padding-inline-start: calc(var(--default-grid-baseline) * 4);
}

.deliver-link__field {
	display: flex;
	align-items: flex-end;
	gap: var(--default-grid-baseline);
	padding-inline-start: calc(var(--default-grid-baseline) * 8);
}

.deliver-link__field > :first-child {
	flex: 1;
	min-width: 0;
}

.deliver-link__field > :last-child {
	flex: none;
}

.deliver-link__description {
	margin-top: var(--default-grid-baseline);
}

.deliver-link__date {
	min-width: 11em;
	margin-inline-start: calc(var(--default-grid-baseline) * 8);
}

.deliver-link__reviewer {
	display: flex;
	align-items: center;
	gap: var(--default-grid-baseline);
}

.deliver-link__name {
	flex: 1;
}

.deliver-link__invite {
	display: flex;
	flex-direction: column;
	gap: var(--default-grid-baseline);
	margin-top: calc(2 * var(--default-grid-baseline));
}

.deliver-link__invite-row {
	display: flex;
	align-items: flex-end;
	gap: calc(2 * var(--default-grid-baseline));
}

.deliver-link__invite-row > :last-child {
	flex: none;
}

.deliver-link__hint {
	color: var(--color-text-maxcontrast);
}

.deliver-link__error {
	color: var(--color-error-text);
}
</style>
