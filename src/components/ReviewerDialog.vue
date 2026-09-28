<script setup>
import { showError, showSuccess } from '@nextcloud/dialogs'
import { t } from '@nextcloud/l10n'
import { ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import { errorMessage, renewReviewerKey, updateReviewerAsMember } from '../api.js'
import { confirmRemoval } from '../confirm.js'

const props = defineProps({
	/** A Reviewer of the Project, with their Personal Link through each review link */
	reviewer: { type: Object, required: true },
	/** The Project's Share Links with the title the navigation gives them, to name each Personal Link */
	links: { type: Array, required: true },
	canWrite: { type: Boolean, default: false },
})

const emit = defineEmits(['changed', 'close'])

const name = ref(props.reviewer.name)
const email = ref(props.reviewer.email ?? '')
const mail = ref({ ...props.reviewer.mail })
const busy = ref(false)

/**
 * @param {string} url - a Personal Link
 */
async function copy(url) {
	await navigator.clipboard.writeText(url)
	showSuccess(t('deliver', 'Personal Link copied'))
}

/**
 * @param {() => Promise<unknown>} action - what to do while the dialog is busy
 */
async function run(action) {
	busy.value = true
	try {
		await action()
		emit('changed')
	} catch (e) {
		showError(errorMessage(e))
	} finally {
		busy.value = false
	}
}

/** Name, address and mail wishes, as a Member sets them for the Reviewer */
function save() {
	return run(async () => {
		await updateReviewerAsMember(props.reviewer.id, {
			name: name.value,
			email: email.value || null,
			mailReplies: mail.value.replies,
			mailComments: mail.value.comments,
			mailVersions: mail.value.versions,
		})
		showSuccess(t('deliver', 'Saved'))
	})
}

/** Every Personal Link of this Reviewer stops working; they keep their Comments */
async function renew() {
	const confirmed = await confirmRemoval(
		t('deliver', 'New Personal Links for {name}?', { name: props.reviewer.name }),
		t('deliver', 'The Personal Links {name} has now stop working; new ones replace them. Their Comments stay theirs.', { name: props.reviewer.name }),
		t('deliver', 'New Personal Links'),
	)
	if (confirmed) {
		await run(() => renewReviewerKey(props.reviewer.id))
	}
}
</script>

<template>
	<NcDialog :name="reviewer.name" size="normal" @closing="emit('close')">
		<div class="deliver-reviewer">
			<form v-if="canWrite" class="deliver-reviewer__form" @submit.prevent="save">
				<NcTextField v-model="name" :label="t('deliver', 'Name')" :disabled="busy" />
				<NcTextField
					v-model="email"
					type="email"
					:label="t('deliver', 'Email')"
					:disabled="busy" />
				<fieldset>
					<legend>{{ t('deliver', 'With an email address, Deliver can mail about') }}</legend>
					<NcCheckboxRadioSwitch v-model="mail.replies" :disabled="!email || busy">
						{{ t('deliver', 'Replies to their Comments') }}
					</NcCheckboxRadioSwitch>
					<NcCheckboxRadioSwitch v-model="mail.comments" :disabled="!email || busy">
						{{ t('deliver', 'Every new Comment') }}
					</NcCheckboxRadioSwitch>
					<NcCheckboxRadioSwitch v-model="mail.versions" :disabled="!email || busy">
						{{ t('deliver', 'New Versions') }}
					</NcCheckboxRadioSwitch>
				</fieldset>
				<NcButton type="submit" variant="primary" :disabled="busy || !name.trim()">
					{{ t('deliver', 'Save') }}
				</NcButton>
			</form>

			<h3>{{ t('deliver', 'Personal Links') }}</h3>
			<p class="deliver-reviewer__hint">
				{{ t('deliver', 'Each one makes whoever opens it {name}. Give them to that person only.', { name: reviewer.name }) }}
			</p>
			<ul>
				<li v-for="each in reviewer.links" :key="each.shareId" class="deliver-reviewer__link">
					<span>{{ links.find((share) => share.id === each.shareId)?.title }}</span>
					<NcButton variant="tertiary" @click="copy(each.url)">
						{{ t('deliver', 'Copy') }}
					</NcButton>
				</li>
			</ul>
		</div>
		<template v-if="canWrite" #actions>
			<NcButton variant="error" :disabled="busy" @click="renew">
				{{ t('deliver', 'New Personal Links') }}
			</NcButton>
		</template>
	</NcDialog>
</template>

<style scoped>
.deliver-reviewer {
	display: flex;
	flex-direction: column;
	gap: calc(2 * var(--default-grid-baseline, 4px));
	padding-bottom: calc(2 * var(--default-grid-baseline, 4px));
}

.deliver-reviewer__form {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: calc(2 * var(--default-grid-baseline, 4px));
}

.deliver-reviewer__form fieldset {
	width: 100%;
}

.deliver-reviewer h3 {
	margin: calc(2 * var(--default-grid-baseline, 4px)) 0 0;
	font-size: 16px;
}

.deliver-reviewer__hint {
	color: var(--color-text-maxcontrast);
}

.deliver-reviewer__link {
	display: flex;
	align-items: center;
	justify-content: space-between;
}
</style>
