<script setup>
import { showSuccess } from '@nextcloud/dialogs'
import { t } from '@nextcloud/l10n'
import { ref, watch } from 'vue'
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
/** The Project's Reviewers, each with their Personal Link through this share; null while loading */
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
 * @param {object} flags - the Deliver flags to change: review, canComment, allowOlder, watermark
 */
function setFlags(flags) {
	return run(async () => emit('update', await setShareFlags(props.share.id, flags)))
}

// Every Reviewer shows with their Personal Link through this share (story 55)
watch(() => [props.share.id, props.share.review, props.canWrite], ([id, review, canWrite]) => {
	reviewers.value = null
	if (review && canWrite) {
		run(async () => {
			reviewers.value = await listReviewers(id)
		})
	}
}, { immediate: true })

/**
 * @param {string} link - a Personal Link
 */
async function copy(link) {
	await navigator.clipboard.writeText(link)
	showSuccess(t('deliver', 'Personal Link copied'))
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
					:modelValue="share.watermark"
					:disabled="busy || !canWrite"
					@update:modelValue="setFlags({ watermark: $event })">
					{{ t('deliver', 'Watermark with the Reviewer\'s name') }}
				</NcCheckboxRadioSwitch>
				<NcCheckboxRadioSwitch
					:modelValue="share.allowOlder"
					:disabled="busy || !canWrite || !share.canComment"
					@update:modelValue="setFlags({ allowOlder: $event })">
					{{ t('deliver', 'Also on older Versions') }}
				</NcCheckboxRadioSwitch>
			</div>

			<div v-if="canWrite" class="deliver-link__reviewers">
				<p v-if="reviewers?.length === 0" class="deliver-link__hint">
					{{ t('deliver', 'No Reviewers yet.') }}
				</p>
				<ul v-else-if="reviewers">
					<li v-for="reviewer in reviewers" :key="reviewer.id" class="deliver-link__reviewer">
						<span>{{ reviewer.name }}</span>
						<NcButton variant="tertiary" @click="copy(reviewer.link)">
							{{ t('deliver', 'Copy Personal Link') }}
						</NcButton>
					</li>
				</ul>
				<p v-if="reviewers?.length" class="deliver-link__hint">
					{{ t('deliver', 'A Personal Link makes whoever opens it that Reviewer, forever. Give each one to its person only.') }}
				</p>

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
	align-items: center;
	justify-content: space-between;
	gap: calc(2 * var(--default-grid-baseline, 4px));
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
