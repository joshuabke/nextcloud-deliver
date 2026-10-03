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

/**
 * Asks before a Project goes with all its review data (story 9).
 *
 * @return {Promise<boolean>} whether the person confirmed
 */
export function confirmProjectRemoval() {
	return confirmRemoval(
		t('deliver', 'Remove Project?'),
		t('deliver', 'Its Assets keep their Comments and go to No Project. The files stay untouched.'),
		t('deliver', 'Remove Project'),
	)
}

/**
 * Asks before a Share Link is deleted from Nextcloud.
 *
 * @return {Promise<boolean>} whether the person confirmed
 */
export function confirmLinkDeletion() {
	return confirmRemoval(
		t('deliver', 'Delete this link?'),
		t('deliver', 'It stops working for everyone who has it, Personal Links through it too. Comments stay.'),
		t('deliver', 'Delete link'),
	)
}

/**
 * Asks before a Reviewer is removed.
 *
 * @param {string} name - the Reviewer's name
 * @return {Promise<boolean>} whether the person confirmed
 */
export function confirmReviewerRemoval(name) {
	return confirmRemoval(
		t('deliver', 'Remove {name}?', { name }),
		t('deliver', 'Their Personal Links stop working and they leave the list. Their Comments stay theirs.'),
		t('deliver', 'Remove Reviewer'),
	)
}
