// A Reviewer picks German or English on the review page. Nextcloud takes a
// forceLanguage parameter on any request, so the choice goes into the page
// address; a cookie lets the server put it there on the next visit
// (PublicController).

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
 * @param {string} tag - a language as Nextcloud names it: de, de_DE, en-GB
 * @return {string} the language alone, as Deliver offers it to Reviewers
 */
export const baseLanguage = (tag) => tag.split(/[-_]/)[0]

/**
 * Shows the page in another language, now and on later visits.
 *
 * @param {string} language - de or en
 */
export function chooseLanguage(language) {
	document.cookie = `deliver_language=${language}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`
	window.location.replace(withLanguage(window.location.href, language))
}

/**
 * The page address for what the review shows, so a reload or a new language keeps it.
 *
 * @param {string} href - the page address now
 * @param {number|null} versionId - the Version in the player, or null for the grid of a link's Assets
 * @return {string} the address of that Version, query kept
 */
export function addressOf(href, versionId) {
	const url = new URL(href)
	const link = url.pathname.replace(/\/versions\/\d+\/?$/, '')
	url.pathname = versionId === null ? link : `${link}/versions/${versionId}`
	return url.toString()
}
