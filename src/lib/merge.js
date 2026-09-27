/**
 * Folds one `changes?since=` answer into the list on screen: a changed
 * Comment replaces its old copy, a new one is added, and one missing from
 * `ids` was deleted by someone else.
 *
 * @param {Array<object>} current - the Comments on screen
 * @param {Array<object>} changed - Comments new or changed since the last poll
 * @param {Array<number>|null} ids - every Comment id that still exists
 * @return {Array<object>} the merged list, Frame order
 */
export function mergeComments(current, changed, ids) {
	const byId = new Map(current.map((comment) => [comment.id, comment]))
	for (const comment of changed) {
		byId.set(comment.id, comment)
	}
	const alive = ids === null ? null : new Set(ids)
	return [...byId.values()]
		.filter((comment) => alive === null || alive.has(comment.id))
		.sort((a, b) => a.inFrame - b.inFrame || a.id - b.id)
}
