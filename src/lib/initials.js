/**
 * The initials NcAvatar shows for a name: the first letter, and the first
 * of the last word.
 *
 * @param {string} name - a display name
 * @return {string} up to two capitals, or ? for none
 */
export function initials(name) {
	const kept = (name.match(/[\p{L}\p{N}\s]/gu) ?? []).join('').trim()
	if (kept === '') {
		return '?'
	}
	const last = kept.lastIndexOf(' ')
	return (kept[0] + (last === -1 ? '' : kept[last + 1])).toUpperCase()
}

/**
 * What an avatar's colour comes from. A Reviewer's follows who they are,
 * not their name: two Reviewers called Kim look apart, as on Frame.io.
 *
 * @param {{type: string, id: string|number, name: string}} author - whoever wrote or decided something
 * @return {string} the name to hand to usernameToColor, as NcAvatar does for an account
 */
export function avatarSeed(author) {
	return author.type === 'reviewer' ? `deliver-reviewer-${author.id}` : author.name
}
