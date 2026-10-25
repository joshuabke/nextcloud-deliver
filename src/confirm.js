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
 * Asks before a Project goes: deleted with its Assets and their review data
 * (story 148), or its Assets kept in No Project (story 9).
 *
 * @return {Promise<?boolean>} true to delete its Assets with it, false to keep them, null when the person cancelled
 */
export async function confirmProjectRemoval() {
	const answer = await spawnDialog(ConfirmDialog, {
		name: t('deliver', 'Remove Project?'),
		message: t('deliver', 'Delete it with its Comments, Versions, Review Links and Reviewers, or keep its Assets with their Comments in No Project. The files stay untouched either way.'),
		confirm: t('deliver', 'Delete Project'),
		other: t('deliver', 'Keep in No Project'),
	})
	if (answer === true) {
		return true
	}
	return answer === 'other' ? false : null
}

/**
 * Asks before a Review Link is deleted.
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

/**
 * Asks before a Reviewer is taken off one link.
 *
 * @param {string} name - the Reviewer's name
 * @return {Promise<boolean>} whether the person confirmed
 */
export function confirmTakeOff(name) {
	return confirmRemoval(
		t('deliver', 'Take {name} off this link?', { name }),
		t('deliver', 'Their Personal Link through it stops working. They stay on their other links, and their Comments stay theirs.'),
		t('deliver', 'Take off'),
	)
}
