import { t } from './l10n.js'

/**
 * What a 409 on naming oneself or changing one's settings means, in the
 * page's own language: the server answers in the browser's, and a Reviewer
 * may have switched the page to another (story 128).
 *
 * @param {object} error - the failed request
 * @param {{name?: string, email?: string}} given - what the Reviewer typed
 * @return {string|null} the message, or null when it is no conflict this knows
 */
export function conflictMessage(error, given) {
	if (error?.response?.status !== 409) {
		return null
	}
	switch (error.response.data?.reason) {
		case 'name':
			return t('deliver', 'Someone in this review is already called "{name}".', { name: given.name ?? '' })
		case 'address':
			return t('deliver', 'Someone in this review already has the address {email}.', { email: given.email ?? '' })
		case 'identityLocked':
			return t('deliver', 'You review on several links: ask whoever invited you to change your name or address.')
		default:
			return null
	}
}

/**
 * The Deleted Project that holds a folder or file someone wants back in
 * review: making it a Project or enabling it is refused for it (story 149).
 *
 * @param {object} error - the failed request
 * @return {{id: number, name: string}|null} that Deleted Project, or null for any other failure
 */
export function deletedProjectOf(error) {
	if (error?.response?.status !== 409) {
		return null
	}
	const body = error.response.data?.ocs?.data ?? error.response.data
	return body?.reason === 'deleted' ? { id: body.projectId, name: body.projectName } : null
}
