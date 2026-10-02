import { showError, showSuccess } from '@nextcloud/dialogs'
import { t } from '@nextcloud/l10n'

/**
 * Copies a Share Link or Personal Link and says so.
 *
 * @param {string} link - the link to copy
 * @param {string} done - what the toast says once it is copied
 */
export async function copyLink(link, done) {
	// Selection first: from inside a dialog Safari resolves the Clipboard API's promise yet copies nothing,
	// and without HTTPS there is no Clipboard API at all
	if (!copyBySelection(link)) {
		try {
			await navigator.clipboard.writeText(link)
		} catch {
			showError(t('deliver', 'The browser did not copy the link: {link}', { link }))
			return
		}
	}
	showSuccess(done)
}

/**
 * The older way, which works on any page: select the text and copy it.
 * The field goes next to the button clicked, so a dialog's focus trap keeps it.
 *
 * @param {string} text - what to copy
 * @return {boolean} whether the browser copied it
 */
function copyBySelection(text) {
	const field = document.createElement('textarea')
	field.value = text
	field.readOnly = true
	field.style.position = 'fixed'
	field.style.opacity = '0'
	const back = document.activeElement instanceof HTMLElement ? document.activeElement : null
	const host = back?.parentElement ?? document.body
	host.append(field)
	field.select()
	try {
		return document.execCommand('copy')
	} finally {
		field.remove()
		back?.focus()
	}
}
