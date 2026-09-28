/**
 * The filters of the Project view (story 99). Each looks at the newest
 * Version of an Asset, except Unseen, which looks for Unseen Comments
 * anywhere in the Stack.
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
			return asset.versions.some((version) => version.unseen > 0)
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

/** The orders of the Project view, the latest activity first by default */
export const SORTS = ['activity', 'name', 'created', 'due']

/**
 * @param {object[]} assets - Assets with name, createdAt, lastActivity and dueDate
 * @param {string} sort - one of SORTS
 * @return {object[]} a sorted copy; ties and Assets without a Due Date go by name
 */
export function sortAssets(assets, sort) {
	const byName = (a, b) => a.name.localeCompare(b.name)
	const order = {
		activity: (a, b) => b.lastActivity - a.lastActivity || byName(a, b),
		name: byName,
		created: (a, b) => b.createdAt - a.createdAt || byName(a, b),
		due: (a, b) => (a.dueDate ?? '\uffff').localeCompare(b.dueDate ?? '\uffff') || byName(a, b),
	}[sort] ?? byName
	return [...assets].sort(order)
}

/** The filters of the Project list: where something waits on me */
export const PROJECT_FILTERS = ['all', 'unseen', 'changes', 'due']

/**
 * @param {object} project - a Project with its activity, as the Project list has it
 * @param {string} filter - one of PROJECT_FILTERS
 * @return {boolean} whether the Project passes the filter
 */
export function projectPasses(project, filter) {
	const { unseenComments, changes, nextDue } = project.activity
	return {
		unseen: unseenComments > 0,
		changes: changes > 0,
		due: nextDue !== null,
	}[filter] ?? true
}

/**
 * @param {object[]} projects - Projects with their activity
 * @param {string} sort - one of SORTS; Due Date is the next one of each Project
 * @return {object[]} a sorted copy
 */
export function sortProjects(projects, sort) {
	const keyed = projects.map((project) => ({
		project,
		name: project.name,
		createdAt: project.createdAt,
		lastActivity: project.activity.lastActivity,
		dueDate: project.activity.nextDue,
	}))
	return sortAssets(keyed, sort).map((each) => each.project)
}
