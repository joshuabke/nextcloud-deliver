<script setup>
import { t } from '@nextcloud/l10n'
import { ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import { errorMessage, inviteReviewer, listReviewers, setShareFlags } from '../api.js'

const props = defineProps({
	/** One Share Link with Deliver's flags, as the server lists it */
	share: { type: Object, required: true },
	canWrite: { type: Boolean, default: false },
})

const emit = defineEmits(['update'])

const busy = ref(false)
const error = ref(null)
/** Null until the list is opened */
const reviewers = ref(null)
const inviting = ref(false)
const name = ref('')
const email = ref('')

/**
 * @param {() => Promise<unknown>} action - what to run while the link is busy
 */
async function run(action) {
	busy.value = true
	error.value = null
	try {
		await action()
	} catch (e) {
		error.value = errorMessage(e)
	} finally {
		busy.value = false
	}
}

/**
 * @param {object} flags - the Deliver flags to change: review, canComment, allowOlder
 */
function setFlags(flags) {
	return run(async () => emit('update', await setShareFlags(props.share.id, flags)))
}

/** Lists the Project's Reviewers with a Personal Link through this share (story 55) */
function showReviewers() {
	return run(async () => {
		reviewers.value = await listReviewers(props.share.id)
	})
}

/** Invites a Reviewer by name and gets their Personal Link (story 53) */
function invite() {
	return run(async () => {
		const reviewer = await inviteReviewer(props.share.id, name.value, email.value || null)
		reviewers.value = [...(reviewers.value ?? []), reviewer]
		name.value = ''
		email.value = ''
		inviting.value = false
	})
}
</script>

<template>
	<div class="deliver-link">
		<NcCheckboxRadioSwitch
			type="switch"
			:modelValue="share.review"
			:disabled="busy || !canWrite"
			@update:modelValue="setFlags({ review: $event })">
			{{ share.label || share.url }}
		</NcCheckboxRadioSwitch>

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
					:disabled="busy || !canWrite"
					@update:modelValue="setFlags({ canComment: $event })">
					{{ t('deliver', 'Reviewers may comment') }}
				</NcCheckboxRadioSwitch>
				<NcCheckboxRadioSwitch
					:modelValue="share.allowOlder"
					:disabled="busy || !canWrite || !share.canComment"
					@update:modelValue="setFlags({ allowOlder: $event })">
					{{ t('deliver', 'Also on older Versions') }}
				</NcCheckboxRadioSwitch>
			</div>

			<div v-if="canWrite" class="deliver-link__reviewers">
				<NcButton
					v-if="reviewers === null"
					variant="tertiary"
					:disabled="busy"
					@click="showReviewers">
					{{ t('deliver', 'Reviewers and Personal Links') }}
				</NcButton>
				<template v-else>
					<p v-if="reviewers.length === 0" class="deliver-link__hint">
						{{ t('deliver', 'No Reviewers yet.') }}
					</p>
					<div v-for="reviewer in reviewers" :key="reviewer.id" class="deliver-link__reviewer">
						<strong>{{ reviewer.name }}</strong>
						<code>{{ reviewer.link }}</code>
					</div>
					<p v-if="reviewers.length" class="deliver-link__hint">
						{{ t('deliver', 'A Personal Link makes whoever opens it that Reviewer, forever. Give each one to its person only.') }}
					</p>
				</template>

				<form v-if="inviting" class="deliver-link__invite" @submit.prevent="invite">
					<input v-model="name" type="text" :placeholder="t('deliver', 'Name')">
					<input v-model="email" type="email" :placeholder="t('deliver', 'Email for replies (optional)')">
					<NcButton variant="primary" :disabled="busy || !name.trim()" @click="invite">
						{{ t('deliver', 'Invite') }}
					</NcButton>
				</form>
				<NcButton
					v-else
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
	gap: var(--default-grid-baseline, 4px);
	overflow-wrap: anywhere;
}

.deliver-link__flags,
.deliver-link__reviewers {
	padding-inline-start: calc(var(--default-grid-baseline, 4px) * 4);
}

.deliver-link__reviewer {
	display: flex;
	flex-direction: column;
	margin-block: var(--default-grid-baseline, 4px);
}

.deliver-link__reviewer code {
	user-select: all;
}

.deliver-link__invite {
	display: flex;
	flex-direction: column;
	gap: var(--default-grid-baseline, 4px);
}

.deliver-link__hint {
	color: var(--color-text-maxcontrast);
}

.deliver-link__error {
	color: var(--color-error-text, var(--color-error));
}
</style>
