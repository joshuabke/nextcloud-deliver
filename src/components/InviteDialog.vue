<script setup>
import { showError, showSuccess } from '@nextcloud/dialogs'
import { computed, reactive, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcTextArea from '@nextcloud/vue/components/NcTextArea'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import AssetPicker from './AssetPicker.vue'
import ContactField from './ContactField.vue'
import LinkRights from './LinkRights.vue'
import { inviteToProject } from '../api.js'
import { copyLink } from '../clipboard.js'
import { useBusy } from '../composables/busy.js'
import { t } from '../lib/l10n.js'
import { reviewerWithAddress } from '../lib/people.js'

/**
 * Invites one person on a Review Link of their own: who, what they see and
 * what they may do (story 145). Password and expiry wait for the link's settings.
 */
const props = defineProps({
	/** The Project, 0 for No Project */
	projectId: { type: Number, required: true },
	/** Its Assets, to pick from */
	assets: { type: Array, required: true },
	/** Whether this Nextcloud sends mail */
	canMail: { type: Boolean, default: false },
	/** The Project's Reviewers, to suggest and to recognise by address */
	reviewers: { type: Array, default: () => [] },
})
const emit = defineEmits(['invited', 'close'])

const onNoProject = props.projectId === 0
const { busy, error, run } = useBusy()
const name = ref('')
const email = ref('')
const sendMail = ref(false)
const message = ref('')
/** The whole Project unless picked; No Project always picks */
const assetIds = ref(onNoProject ? props.assets.map((asset) => asset.id) : null)
const withAddress = computed(() => props.reviewers.filter((reviewer) => reviewer.email))
/** The Reviewer the address belongs to: the new link goes to them, under their name (ADR 0014) */
const known = computed(() => reviewerWithAddress(withAddress.value, email.value))
/** As on a new link */
const rights = reactive({ canComment: true, watermark: false, allowOlder: false, latestOnly: false, canDownload: true })

/** Invites, then mails the Personal Link or puts it on the clipboard */
function invite() {
	return run(async () => {
		const mail = sendMail.value && email.value.trim() !== ''
		const { reviewer } = await inviteToProject(props.projectId, {
			name: name.value,
			email: email.value || null,
			sendMail: mail,
			message: mail ? message.value : null,
			assetIds: assetIds.value,
			...rights,
		})
		if (reviewer.mailed) {
			showSuccess(t('deliver', 'Personal Link mailed to {email}', { email: reviewer.email }))
		} else {
			if (mail) {
				showError(t('deliver', 'The mail could not be sent. Copy the Personal Link instead.'))
			}
			await copyLink(reviewer.link, t('deliver', 'Personal Link copied'))
		}
		emit('invited')
		emit('close')
	})
}
</script>

<template>
	<NcDialog :name="t('deliver', 'Invite a Reviewer')" size="normal" @closing="emit('close')">
		<form id="deliver-invite" class="deliver-invite" @submit.prevent="invite">
			<div class="deliver-invite__person">
				<ContactField
					v-model="name"
					:label="t('deliver', 'Name')"
					:people="withAddress"
					:disabled="busy"
					@pick="(contact) => email = contact.email" />
				<NcTextField
					v-model="email"
					type="email"
					:label="t('deliver', 'Email (optional)')"
					:disabled="busy" />
			</div>
			<p v-if="known" class="deliver-invite__hint">
				{{ t('deliver', '{name} reviews this Project already; the new link is added to them.', { name: known.name }) }}
			</p>
			<template v-if="email.trim() && canMail">
				<NcCheckboxRadioSwitch v-model="sendMail" :disabled="busy">
					{{ t('deliver', 'Mail them their Personal Link') }}
				</NcCheckboxRadioSwitch>
				<NcTextArea
					v-if="sendMail"
					v-model="message"
					:label="t('deliver', 'Your message (optional)')"
					:disabled="busy"
					resize="vertical" />
			</template>

			<h3>{{ t('deliver', 'What the link shows') }}</h3>
			<AssetPicker
				v-model="assetIds"
				:assets="assets"
				:onNoProject="onNoProject"
				name="deliver-invite-content" />

			<h3>{{ t('deliver', 'What they may do') }}</h3>
			<LinkRights :flags="rights" :disabled="busy" @change="(changed) => Object.assign(rights, changed)" />

			<p v-if="error" class="deliver-invite__error">
				{{ error }}
			</p>
		</form>
		<template #actions>
			<NcButton
				type="submit"
				form="deliver-invite"
				variant="primary"
				:disabled="busy || !name.trim() || assetIds?.length === 0">
				{{ t('deliver', 'Invite') }}
			</NcButton>
		</template>
	</NcDialog>
</template>

<style scoped>
.deliver-invite {
	display: flex;
	flex-direction: column;
	gap: var(--default-grid-baseline);
}

.deliver-invite__person {
	display: flex;
	gap: calc(2 * var(--default-grid-baseline));
}

.deliver-invite h3 {
	margin: calc(2 * var(--default-grid-baseline)) 0 0;
	font-size: 16px;
}

.deliver-invite__hint {
	color: var(--color-text-maxcontrast);
}

.deliver-invite__error {
	color: var(--color-error-text);
}
</style>
