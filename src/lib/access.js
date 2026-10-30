import { t } from './l10n.js'

// The client's copy of the server's Grant rules (ADR 0016): None has no Share
// or Approve, View has no Approve, and a Member cannot give a switch they lack.

/**
 * @param {{level: string, share: boolean, approve: boolean}} next - a Member's level and switches as asked for
 * @return {{level: string, share: boolean, approve: boolean}} the same with the switches the level cannot carry off
 */
export function clampSwitches(next) {
	const clamped = { ...next }
	if (clamped.level === 'none') {
		clamped.share = false
	}
	if (clamped.level === 'none' || clamped.level === 'view') {
		clamped.approve = false
	}
	return clamped
}

/**
 * @param {{owner?: boolean, canShare: boolean, level: string, share: boolean}} member - a row
 * @param {{share: boolean}} mine - what the viewing Member has
 * @return {string|null} why the row's Share switch cannot be changed, if it cannot
 */
export function shareLocked(member, mine) {
	if (member.owner) {
		return t('deliver', 'The owner of a Project keeps Manage, Share and Approve.')
	}
	if (!member.canShare) {
		return t('deliver', 'Files does not let them share this.')
	}
	if (member.level === 'none') {
		return t('deliver', 'They do not see the Project.')
	}
	if (!member.share && !mine.share) {
		return t('deliver', 'You cannot give what you do not have yourself.')
	}
	return null
}

/**
 * @param {{owner?: boolean, level: string, approve: boolean}} member - a row
 * @param {{approve: boolean}} mine - what the viewing Member has
 * @return {string|null} why the row's Approve switch cannot be changed, if it cannot
 */
export function approveLocked(member, mine) {
	if (member.owner) {
		return t('deliver', 'The owner of a Project keeps Manage, Share and Approve.')
	}
	if (member.level === 'none' || member.level === 'view') {
		return t('deliver', 'Approving needs Comment or Manage.')
	}
	if (!member.approve && !mine.approve) {
		return t('deliver', 'You cannot give what you do not have yourself.')
	}
	return null
}
