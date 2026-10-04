<script setup>
import removeIcon from '@mdi/svg/svg/account-remove-outline.svg?raw'
import settingsIcon from '@mdi/svg/svg/cog-outline.svg?raw'
import copyIcon from '@mdi/svg/svg/content-copy.svg?raw'
import deleteIcon from '@mdi/svg/svg/trash-can-outline.svg?raw'
import { t } from '@nextcloud/l10n'
import { ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcPasswordField from '@nextcloud/vue/components/NcPasswordField'
import NcTextArea from '@nextcloud/vue/components/NcTextArea'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import { linkApi, removeReviewer } from '../api.js'
import { copyLink } from '../clipboard.js'
import { useBusy } from '../composables/busy.js'
import { confirmLinkDeletion, confirmReviewerRemoval } from '../confirm.js'

const props = defineProps({
	/** One Project Link of the Member's, as the server lists it */
	share: { type: Object, required: true },
	/** In the Project's link dialog: each Reviewer's settings are offered, and the dialog's own button invites */
	inDialog: { type: Boolean, default: false },
})

const emit = defineEmits(['update', 'person', 'deleted'])

const { busy, error, run } = useBusy()
/** The Member's Reviewers, each with their Personal Link through this link; null while loading */
const reviewers = ref(null)
const inviting = ref(false)
const name = ref('')
const email = ref('')
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
	if (!on && props.share.hasPassword) {
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
	if (!on && props.share.expireDate) {
		setFlags({ expireDate: '' })
	}
}

/**
 * @param {object} flags - what to change: review, canComment, allowOlder, watermark; password and expireDate, empty to remove
 */
function setFlags(flags) {
	return run(async () => emit('update', await linkApi(props.share).update(flags)))
}

/** Deletes the link: it stops working for everyone, Personal Links through it too */
async function remove() {
	if (await confirmLinkDeletion()) {
		await run(async () => {
			await linkApi(props.share).remove()
			emit('deleted', props.share.id)
		})
	}
}

/**
 * @param {object} reviewer - one of the Reviewers listed
 */
async function dropReviewer(reviewer) {
	if (await confirmReviewerRemoval(reviewer.name)) {
		await run(async () => {
			await removeReviewer(reviewer.id)
			reviewers.value = reviewers.value.filter((each) => each.id !== reviewer.id)
		})
	}
}

// Every Reviewer shows with their Personal Link through this link (story 55)
watch(() => [props.share.token, props.share.review], ([, review]) => {
	reviewers.value = null
	if (review) {
		run(async () => {
			reviewers.value = await linkApi(props.share).reviewers()
		})
	}
}, { immediate: true })

/** What Reviewers read above the Assets (story 123) */
const description = ref(props.share.description ?? '')
watch(() => props.share.description, (value) => {
	description.value = value ?? ''
})

/** Opens the form to invite a Reviewer, for a button outside */
function startInvite() {
	inviting.value = true
}

defineExpose({ startInvite, inviting })

/** Invites a Reviewer by name and gets their Personal Link (story 53) */
function invite() {
	return run(async () => {
		const reviewer = await linkApi(props.share).invite(name.value, email.value || null)
		reviewers.value = [...(reviewers.value ?? []), reviewer]
		name.value = ''
		email.value = ''
		inviting.value = false
	})
}
</script>

<template>
	<div class="deliver-link">
		<div class="deliver-link__head">
			<span class="deliver-link__title" :title="share.url">{{ share.label || share.url }}</span>
			<NcButton
				variant="tertiary"
				:aria-label="t('deliver', 'Copy link')"
				:title="t('deliver', 'Copy link')"
				@click="copyLink(share.url, t('deliver', 'Link copied'))">
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
			:modelValue="share.review"
			:disabled="busy"
			@update:modelValue="setFlags({ review: $event })">
			{{ t('deliver', 'Link is live') }}
		</NcCheckboxRadioSwitch>
		<p v-if="!share.review" class="deliver-link__hint">
			{{ t('deliver', 'Paused: the link shows nothing until you switch it on again.') }}
		</p>

		<div class="deliver-link__flags">
			<NcCheckboxRadioSwitch
				:modelValue="share.hasPassword || settingPassword"
				:disabled="busy"
				@update:modelValue="togglePassword">
				{{ t('deliver', 'Password') }}
			</NcCheckboxRadioSwitch>
			<form v-if="share.hasPassword || settingPassword" class="deliver-link__field" @submit.prevent="savePassword">
				<NcPasswordField
					v-model="password"
					:label="share.hasPassword ? t('deliver', 'New password') : t('deliver', 'Password')"
					autocomplete="new-password" />
				<NcButton type="submit" :disabled="busy || !password">
					{{ t('deliver', 'Save') }}
				</NcButton>
			</form>
			<NcCheckboxRadioSwitch
				:modelValue="Boolean(share.expireDate) || settingExpiry"
				:disabled="busy"
				@update:modelValue="toggleExpiry">
				{{ t('deliver', 'Expiry date') }}
			</NcCheckboxRadioSwitch>
			<input
				v-if="share.expireDate || settingExpiry"
				class="deliver-link__date"
				type="date"
				:value="share.expireDate ?? ''"
				:disabled="busy"
				:aria-label="t('deliver', 'Expiry date')"
				@change="$event.target.value && setFlags({ expireDate: $event.target.value })">
		</div>

		<template v-if="share.review">
			<p v-if="!share.hasPassword" class="deliver-link__hint">
				{{ t('deliver', 'This link has no password. Anyone it reaches can review.') }}
			</p>
			<p v-if="share.canMail === false" class="deliver-link__hint">
				{{ t('deliver', 'This Nextcloud sends no email, so Reviewers are not mailed when someone replies to them.') }}
			</p>
			<div class="deliver-link__flags">
				<NcCheckboxRadioSwitch
					:modelValue="share.canComment"
					:disabled="busy"
					@update:modelValue="setFlags({ canComment: $event })">
					{{ t('deliver', 'Reviewers may comment') }}
				</NcCheckboxRadioSwitch>
				<NcCheckboxRadioSwitch
					:modelValue="share.watermark"
					:disabled="busy"
					@update:modelValue="setFlags({ watermark: $event })">
					{{ t('deliver', 'Watermark with the Reviewer\'s name') }}
				</NcCheckboxRadioSwitch>
				<NcCheckboxRadioSwitch
					:modelValue="share.allowOlder"
					:disabled="busy || !share.canComment || share.latestOnly"
					@update:modelValue="setFlags({ allowOlder: $event })">
					{{ t('deliver', 'Also on older Versions') }}
				</NcCheckboxRadioSwitch>
				<NcCheckboxRadioSwitch
					:modelValue="share.latestOnly"
					:disabled="busy"
					@update:modelValue="setFlags({ latestOnly: $event })">
					{{ t('deliver', 'Only the newest Version') }}
				</NcCheckboxRadioSwitch>
				<NcCheckboxRadioSwitch
					:modelValue="share.canDownload"
					:disabled="busy"
					@update:modelValue="setFlags({ canDownload: $event })">
					{{ t('deliver', 'Reviewers may download the original') }}
				</NcCheckboxRadioSwitch>
				<NcTextArea
					v-model="description"
					class="deliver-link__description"
					:label="t('deliver', 'Description for Reviewers')"
					:disabled="busy"
					resize="vertical"
					@blur="description !== (share.description ?? '') && setFlags({ description })" />
			</div>

			<div class="deliver-link__reviewers">
				<p v-if="reviewers?.length === 0" class="deliver-link__hint">
					{{ t('deliver', 'No Reviewers yet.') }}
				</p>
				<ul v-else-if="reviewers">
					<li v-for="reviewer in reviewers" :key="reviewer.id" class="deliver-link__reviewer">
						<span class="deliver-link__name">{{ reviewer.name }}</span>
						<NcButton variant="tertiary" @click="copyLink(reviewer.link, t('deliver', 'Personal Link copied'))">
							{{ t('deliver', 'Copy Personal Link') }}
						</NcButton>
						<NcButton
							variant="tertiary"
							:aria-label="t('deliver', 'Remove {name}', { name: reviewer.name })"
							:title="t('deliver', 'Remove {name}', { name: reviewer.name })"
							@click="dropReviewer(reviewer)">
							<template #icon>
								<NcIconSvgWrapper :svg="removeIcon" />
							</template>
						</NcButton>
						<NcButton
							v-if="inDialog"
							variant="tertiary"
							:aria-label="t('deliver', 'Settings of {name}', { name: reviewer.name })"
							:title="t('deliver', 'Settings of {name}', { name: reviewer.name })"
							@click="emit('person', reviewer.id)">
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
					<NcTextField v-model="name" :label="t('deliver', 'Name')" />
					<NcTextField v-model="email" type="email" :label="t('deliver', 'Email for replies (optional)')" />
					<NcButton type="submit" variant="primary" :disabled="busy || !name.trim()">
						{{ t('deliver', 'Invite') }}
					</NcButton>
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
	align-items: flex-end;
	gap: calc(2 * var(--default-grid-baseline));
	margin-top: calc(2 * var(--default-grid-baseline));
}

.deliver-link__invite > :last-child {
	flex: none;
}

.deliver-link__hint {
	color: var(--color-text-maxcontrast);
}

.deliver-link__error {
	color: var(--color-error-text);
}
</style>
