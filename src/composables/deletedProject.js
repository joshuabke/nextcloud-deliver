import { deleteProjectForGood, restoreProject } from '../api.js'
import { offerDeletedProject } from '../confirm.js'
import { deletedProjectOf } from '../lib/conflict.js'

/**
 * Makes a folder a Project or enables a file, and when a Deleted Project
 * holds it, offers that one back: restored, or deleted for good so that the
 * action runs afresh (story 149).
 *
 * @param {() => Promise<object>} action - the request a Deleted Project may refuse
 * @return {Promise<object|null>} what the action answered; null once restored, or when the person cancelled
 */
export async function orDeletedProject(action) {
	// Each one in the way is offered in turn: a folder can hold several
	for (;;) {
		try {
			return await action()
		} catch (e) {
			const held = deletedProjectOf(e)
			if (held === null) {
				throw e
			}
			const answer = await offerDeletedProject(held.name)
			if (answer !== 'afresh') {
				if (answer === 'restore') {
					await restoreProject(held.id)
				}
				return null
			}
			await deleteProjectForGood(held.id)
		}
	}
}
