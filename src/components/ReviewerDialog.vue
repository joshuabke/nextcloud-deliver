<script setup>
import { showError, showSuccess } from '@nextcloud/dialogs'
import { t } from '@nextcloud/l10n'
import { ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import { renewReviewerKey, updateReviewerAsMember } from '../api.js'
import { copyLink } from '../clipboard.js'
import { useBusy } from '../composables/busy.js'
import { confirmRemoval } from '../confirm.js'

const props = defineProps({
	/** A Reviewer of the Project, with their Personal Link through each review link */
	reviewer: { type: Object, required: true },
	/** The Project's Share Links with the title the navigation gives them, to name each Personal Link */
	links: { type: Array, required: true },
	canWrite: { type: Boolean, default: false },
})

const emit = defineEmits(['changed', 'close', 'remove'])

const name = ref(props.reviewer.name)
const email = ref(props.reviewer.email ?? '')
const mail = ref({ ...props.reviewer.mail })
/** Their own rights; null leaves it to the link they come by */
const rights = ref({ ...props.reviewer.rights })

const WISHES = [
	{ id: 'replies', label: t('deliver', 'Replies to their Comments') },
	{ id: 'comments', label: t('deliver', 'Every new Comment') },
	{ id: 'versions', label: t('deliver', 'New Versions') },
]
const RIGHTS = [
	{ id: 'canComment', label: t('deliver', 'Comment') },
	{ id: 'allowOlder', label: t('deliver', 'Comment on older Versions') },
	{ id: 'watermark', label: t('deliver', 'Watermark with their name') },
]
const CHOICES = [
	{ id: null, label: t('deliver', 'As the link says') },
	{ id: true, label: t('deliver', 'Yes') },
	{ id: false, label: t('deliver', 'No') },
]
const { busy, error, run } = useBusy()
watch(error, (message) => message && showError(message))

/** Name, address and mail wishes, as a Member sets them for the Reviewer */
function save() {
	return run(async () => {
		await updateReviewerAsMember(props.reviewer.id, {
			name: name.value,
			email: email.value || null,
			mailReplies: mail.value.replies,
			mailComments: mail.value.comments,
			mailVersions: mail.value.versions,
			rights: rights.value,
		})
		showSuccess(t('deliver', 'Saved'))
		emit('changed')
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
		await run(async () => {
			await renewReviewerKey(props.reviewer.id)
			emit('changed')
		})
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
					<NcCheckboxRadioSwitch
						v-for="wish in WISHES"
						:key="wish.id"
						v-model="mail[wish.id]"
						:disabled="!email || busy">
						{{ wish.label }}
					</NcCheckboxRadioSwitch>
				</fieldset>
				<fieldset class="deliver-reviewer__rights">
					<legend>{{ t('deliver', 'Rights, over those of the link') }}</legend>
					<NcSelect
						v-for="right in RIGHTS"
						:key="right.id"
						:modelValue="CHOICES.find((choice) => choice.id === (rights[right.id] ?? null))"
						:options="CHOICES"
						:clearable="false"
						:disabled="busy"
						:inputLabel="right.label"
						@update:modelValue="rights[right.id] = $event.id" />
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
					<NcButton variant="tertiary" @click="copyLink(each.url, t('deliver', 'Personal Link copied'))">
						{{ t('deliver', 'Copy') }}
					</NcButton>
				</li>
			</ul>
		</div>
		<template v-if="canWrite" #actions>
			<NcButton variant="tertiary" :disabled="busy" @click="emit('remove')">
				{{ t('deliver', 'Remove Reviewer') }}
			</NcButton>
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
	gap: calc(2 * var(--default-grid-baseline));
	padding-bottom: calc(2 * var(--default-grid-baseline));
}

.deliver-reviewer__form {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: calc(2 * var(--default-grid-baseline));
}

.deliver-reviewer__form fieldset {
	width: 100%;
}

.deliver-reviewer__rights {
	display: flex;
	flex-direction: column;
	gap: var(--default-grid-baseline);
}

.deliver-reviewer h3 {
	margin: calc(2 * var(--default-grid-baseline)) 0 0;
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
