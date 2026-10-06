// A Reviewer picks German or English on the review page. Nextcloud takes a
// forceLanguage parameter on any request, so the choice lives in the page
// address, and this browser remembers it for the next visit.

const KEY = 'deliver-language'

/**
 * @param {string} href - a page address
 * @param {string} language - the language to show it in
 * @return {string} the address with the language
 */
export function withLanguage(href, language) {
	const url = new URL(href)
	url.searchParams.set('forceLanguage', language)
	return url.toString()
}

/**
 * Where to go for the language chosen on an earlier visit.
 *
 * @param {string} href - the page address
 * @param {string|null} chosen - the language chosen earlier, if any
 * @param {string} current - the language the page came in
 * @return {string|null} the address in the chosen language, or null to stay
 */
export function languageRedirect(href, chosen, current) {
	if (!chosen || current.split(/[-_]/)[0] === chosen || new URL(href).searchParams.has('forceLanguage')) {
		return null
	}
	return withLanguage(href, chosen)
}

/** @return {string|null} the language chosen on this browser */
export const chosenLanguage = () => window.localStorage.getItem(KEY)

/**
 * Shows the page in another language, now and on later visits.
 *
 * @param {string} language - de or en
 */
export function chooseLanguage(language) {
	window.localStorage.setItem(KEY, language)
	window.location.replace(withLanguage(window.location.href, language))
}
