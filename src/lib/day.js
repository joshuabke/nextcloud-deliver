import { getCanonicalLocale } from '@nextcloud/l10n'

/**
 * @param {number} seconds - a moment, as the server stores it
 * @return {string} its date where the browser is, in the user's language: "Oct 26, 2025"
 */
export function day(seconds) {
	return new Date(seconds * 1000).toLocaleDateString(getCanonicalLocale(), { dateStyle: 'medium' })
}
