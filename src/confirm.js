import { DialogBuilder } from '@nextcloud/dialogs'
import { t } from '@nextcloud/l10n'

/**
 * Asks before something is deleted.
 *
 * @param {string} title - dialog title
 * @param {string} text - what gets deleted
 * @param {string} confirm - label of the destructive button
 * @return {Promise<boolean>} whether the person confirmed
 */
export function confirmRemoval(title, text, confirm) {
	return new Promise((resolve) => {
		new DialogBuilder(title)
			.setText(text)
			.addButton({ label: t('deliver', 'Cancel'), callback: () => resolve(false) })
			.addButton({ label: confirm, variant: 'error', callback: () => resolve(true) })
			.build()
			.show()
			.then(() => resolve(false))
	})
}
