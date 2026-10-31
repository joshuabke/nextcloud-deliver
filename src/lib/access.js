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
		return t('deliver', 'Their share in Files does not allow resharing.')
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

/**
 * @param {Array<{type: string, id: string, reaches: boolean}>} members - the listed rows
 * @param {{type: string, id: string, reaches: boolean}} saved - the row after a reset
 * @return {Array} the rows with that one replaced, or gone when it no longer reaches the Project: only its entry kept it listed
 */
export function afterReset(members, saved) {
	const same = (each) => each.type === saved.type && each.id === saved.id
	return saved.reaches ? members.map((each) => same(each) ? saved : each) : members.filter((each) => !same(each))
}
