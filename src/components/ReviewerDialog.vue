<script setup>
import settingsIcon from '@mdi/svg/svg/cog-outline.svg?raw'
import { showError, showSuccess } from '@nextcloud/dialogs'
import { t } from '@nextcloud/l10n'
import { ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import PersonalLinkRightsDialog from './PersonalLinkRightsDialog.vue'
import { renewReviewerKey, updateReviewerAsMember } from '../api.js'
import { copyLink } from '../clipboard.js'
import { useBusy } from '../composables/busy.js'
import { confirmRemoval } from '../confirm.js'

const props = defineProps({
	/** A Reviewer of the Project, with their Personal Link and own rights through each link they are on */
	reviewer: { type: Object, required: true },
	/** The Project's Project Links with the title the navigation gives them, to name each Personal Link */
	links: { type: Array, required: true },
	canWrite: { type: Boolean, default: false },
})

const emit = defineEmits(['changed', 'close', 'remove'])

const name = ref(props.reviewer.name)
const email = ref(props.reviewer.email ?? '')
const mail = ref({ ...props.reviewer.mail })
/** The Personal Link whose rights are open, {personal, share}: one of reviewer.links and the link it goes through */
const openRights = ref(null)

const WISHES = [
	{ id: 'replies', label: t('deliver', 'Replies to their Comments') },
	{ id: 'comments', label: t('deliver', 'Every new Comment') },
	{ id: 'versions', label: t('deliver', 'New Versions') },
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
				<NcButton type="submit" variant="primary" :disabled="busy || !name.trim()">
					{{ t('deliver', 'Save') }}
				</NcButton>
			</form>

			<h3>{{ t('deliver', 'Personal Links') }}</h3>
			<p class="deliver-reviewer__hint">
				{{ t('deliver', 'Each one makes whoever opens it {name}. Give them to that person only.', { name: reviewer.name }) }}
			</p>
			<ul>
				<li v-for="personal in reviewer.links" :key="personal.token" class="deliver-reviewer__link">
					<span>{{ links.find((share) => share.token === personal.token)?.title }}</span>
					<!-- Their own rights on this link (ADR 0014) -->
					<NcButton
						variant="tertiary"
						:aria-label="t('deliver', 'Rights of {name} on this link', { name: reviewer.name })"
						:title="t('deliver', 'Rights of {name} on this link', { name: reviewer.name })"
						@click="openRights = { personal, share: links.find((share) => share.token === personal.token) }">
						<template #icon>
							<NcIconSvgWrapper :svg="settingsIcon" />
						</template>
					</NcButton>
					<NcButton variant="tertiary" @click="copyLink(personal.url, t('deliver', 'Personal Link copied'))">
						{{ t('deliver', 'Copy') }}
					</NcButton>
				</li>
			</ul>
		</div>
		<PersonalLinkRightsDialog
			v-if="openRights"
			:reviewer="reviewer"
			:share="openRights.share"
			:rights="openRights.personal.rights"
			@changed="(rights) => openRights.personal.rights = rights"
			@close="openRights = null" />
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
}

/* The link's title takes the room, its buttons sit together at the end */
.deliver-reviewer__link > span {
	flex: 1;
}
</style>
