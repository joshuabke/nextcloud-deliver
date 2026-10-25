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
 * Asks before a Project is deleted; it goes to Deleted Projects first (story 9, ADR 0015).
 *
 * @return {Promise<boolean>} whether the person confirmed
 */
export function confirmProjectRemoval() {
	return confirmRemoval(
		t('deliver', 'Delete Project?'),
		t('deliver', 'It goes to Deleted Projects at the end of the Project list, where it can be restored until it is deleted for good. The files stay untouched.'),
		t('deliver', 'Delete Project'),
	)
}

/**
 * Asks before a Deleted Project goes for good (story 150).
 *
 * @param {string} name - the Project's name
 * @return {Promise<boolean>} whether the person confirmed
 */
export function confirmDeleteForGood(name) {
	return confirmRemoval(
		t('deliver', 'Delete "{project}" for good?', { project: name }),
		t('deliver', 'Its Assets, Comments, Approvals, Review Links and Reviewers are deleted and cannot be restored. The files stay untouched.'),
		t('deliver', 'Delete for good'),
	)
}

/**
 * Offers a Deleted Project back when its folder or one of its files is wanted in review again (story 149).
 *
 * @param {string} name - the Deleted Project's name
 * @return {Promise<?string>} 'restore', 'afresh' to delete it for good first, or null when the person cancelled
 */
export async function offerDeletedProject(name) {
	const answer = await spawnDialog(ConfirmDialog, {
		name: t('deliver', 'This belongs to a deleted Project'),
		message: t('deliver', '"{project}" is under Deleted Projects. Restore it with everything it had, or delete it for good and start afresh. The files stay untouched.', { project: name }),
		confirm: t('deliver', 'Delete for good and start afresh'),
		other: t('deliver', 'Restore'),
	})
	if (answer === true) {
		return 'afresh'
	}
	return answer === 'other' ? 'restore' : null
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
