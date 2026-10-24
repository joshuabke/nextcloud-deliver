import { t } from '@nextcloud/l10n'

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
