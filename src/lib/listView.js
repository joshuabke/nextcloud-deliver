import { n } from './l10n.js'

/** The two looks of the Assets of a Project or a Review Link: cards in a grid, or one compact row each */
export const LAYOUTS = ['grid', 'list']

const key = (scope) => `deliver.layout.${scope}`

/**
 * What this browser remembers for a Project or a Review Link; the grid until
 * it was told otherwise, and where storage is closed or throws.
 *
 * @param {string} scope - 'project-12' or 'link-<token>'
 * @param {Storage} [storage] - localStorage, unless a test brings its own
 * @return {'grid'|'list'}
 */
export function readLayout(scope, storage = globalThis.localStorage) {
	try {
		const value = storage.getItem(key(scope))
		return LAYOUTS.includes(value) ? value : 'grid'
	} catch {
		return 'grid'
	}
}

/**
 * @param {string} scope - as for readLayout
 * @param {'grid'|'list'} layout - the choice
 * @param {Storage} [storage] - localStorage, unless a test brings its own
 */
export function writeLayout(scope, layout, storage = globalThis.localStorage) {
	try {
		storage.setItem(key(scope), layout)
	} catch {
		// The choice then lasts until the page is left
	}
}

/**
 * Requested changes outweigh approvals: the newest Version is not through while anyone wants changes (story 88)
 *
 * @param {{approved?: number, changes?: number}} approvals - the counts on the newest Version
 * @return {{kind: 'changes'|'approved', text: string}|null}
 */
export function decisionOf({ approved = 0, changes = 0 }) {
	if (changes > 0) {
		return { kind: 'changes', text: n('deliver', '%n requests changes', '%n request changes', changes) }
	}
	return approved > 0 ? { kind: 'approved', text: n('deliver', 'Approved by %n', 'Approved by %n', approved) } : null
}
