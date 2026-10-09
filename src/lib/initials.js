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
