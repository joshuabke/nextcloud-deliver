<script setup>
import { showError } from '@nextcloud/dialogs'
import { ref } from 'vue'
import NcAppSettingsDialog from '@nextcloud/vue/components/NcAppSettingsDialog'
import NcAppSettingsSection from '@nextcloud/vue/components/NcAppSettingsSection'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import { errorMessage, getSettings, updateSettings } from '../api.js'
import { t } from '../lib/l10n.js'

/** The Member's own Deliver settings (story 144) */
const emit = defineEmits(['close'])

/** {addressBook, addressBooks}; null while loading */
const settings = ref(null)

getSettings().then((found) => {
	settings.value = found
}).catch((e) => showError(errorMessage(e)))

/**
 * @param {string} addressBook - the key of the address book Reviewers are saved to
 */
async function pick(addressBook) {
	try {
		settings.value = await updateSettings({ addressBook })
	} catch (e) {
		showError(errorMessage(e))
	}
}
</script>

<template>
	<NcAppSettingsDialog
		open
		:name="t('deliver', 'Deliver settings')"
		@update:open="(open) => open || emit('close')">
		<NcAppSettingsSection id="deliver-contacts" :name="t('deliver', 'Contacts')">
			<p class="deliver-settings__hint">
				{{ t('deliver', 'Reviewers you save to Contacts go to this address book.') }}
			</p>
			<NcCheckboxRadioSwitch
				v-for="book in settings?.addressBooks ?? []"
				:key="book.key"
				:modelValue="settings.addressBook"
				:value="book.key"
				type="radio"
				name="deliver-address-book"
				@update:modelValue="pick">
				{{ book.name }}
			</NcCheckboxRadioSwitch>
			<p v-if="settings && settings.addressBooks.length === 0" class="deliver-settings__hint">
				{{ t('deliver', 'You have no address book to save to.') }}
			</p>
		</NcAppSettingsSection>
	</NcAppSettingsDialog>
</template>

<style scoped>
.deliver-settings__hint {
	color: var(--color-text-maxcontrast);
}
</style>
