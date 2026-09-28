/**
 * The filters of the Project view (story 99). Each looks at the newest
 * Version of an Asset, except Unseen, which counts the whole Stack.
 */
export const FILTERS = ['all', 'unseen', 'changes', 'approved', 'due']

/**
 * @param {object} asset - an Asset with its Version Stack, newest first
 * @param {string} filter - one of FILTERS
 * @return {boolean} whether the Asset passes the filter
 */
export function passes(asset, filter) {
	const newest = asset.versions[0]
	const { approved = 0, changes = 0 } = newest.approvals ?? {}
	switch (filter) {
		case 'unseen':
			return !newest.seen || asset.versions.some((version) => version.unseen > 0)
		case 'changes':
			return changes > 0
		case 'approved':
			return approved > 0 && changes === 0
		case 'due':
		// Due and not yet through, like the next Due Date on the Project's tile
			return asset.dueDate !== null && !(approved > 0 && changes === 0)
		default:
			return true
	}
}

/**
 * @param {object} asset - an Asset with its Version Stack, newest first
 * @param {string} query - what was typed into the search
 * @return {boolean} whether the Asset's name or its newest file name contain it
 */
export function found(asset, query) {
	const needle = query.trim().toLocaleLowerCase()
	return needle === ''
		|| asset.name.toLocaleLowerCase().includes(needle)
		|| asset.versions[0].name.toLocaleLowerCase().includes(needle)
}
