import { showSuccess } from '@nextcloud/dialogs'

/**
 * Copies a Share Link or Personal Link and says so.
 *
 * @param {string} link - the link to copy
 * @param {string} done - what the toast says once it is copied
 */
export async function copyLink(link, done) {
	await navigator.clipboard.writeText(link)
	showSuccess(done)
}
