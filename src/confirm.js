import { t } from '@nextcloud/l10n'
import { spawnDialog } from '@nextcloud/vue/functions/dialog'
import ConfirmDialog from './components/ConfirmDialog.vue'

/**
 * Asks before something is deleted.
 *
 * @param {string} title - dialog title
 * @param {string} text - what gets deleted
 * @param {string} confirm - label of the destructive button
 * @return {Promise<boolean>} whether the person confirmed
 */
export function confirmRemoval(title, text, confirm) {
	return spawnDialog(ConfirmDialog, { name: title, message: text, confirm })
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
 * Asks before a Project Link is deleted.
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
