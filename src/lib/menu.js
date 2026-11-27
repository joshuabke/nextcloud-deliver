/**
 * The entries of a menu in the groups a phone's sheet shows them in: an
 * entry with a group of its own begins a new group, one without stays with
 * the one before, and whatever is dangerous comes last together, as the
 * menus list it.
 *
 * @param {Array<{group?: string, danger?: boolean}>} items - the menu's entries, in their order
 * @return {Array<Array<object>>} the same entries, in groups
 */
export function groupItems(items) {
	const groups = []
	let last
	for (const item of items) {
		const key = item.danger ? 'danger' : (item.group ?? last)
		if (groups.length === 0 || key !== last) {
			groups.push([])
		}
		groups.at(-1).push(item)
		last = key
	}
	return groups
}
