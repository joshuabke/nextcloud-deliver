/**
 * Splits a Comment body into text and links, so URLs become clickable without
 * rendering any HTML the author wrote (story 30).
 *
 * @param {string} body - the Comment as written
 * @return {Array<{text: string, href?: string}>} the pieces in order; links carry an href
 */
export function linkify(body) {
	const pieces = []
	let last = 0
	for (const match of body.matchAll(/https?:\/\/[^\s<>"]+/g)) {
		// A sentence often ends right after a link; that full stop is not part of it
		const url = match[0].replace(/[.,;:!?)\]]+$/, '')
		if (match.index > last) {
			pieces.push({ text: body.slice(last, match.index) })
		}
		pieces.push({ text: url, href: url })
		last = match.index + url.length
	}
	if (last < body.length) {
		pieces.push({ text: body.slice(last) })
	}
	return pieces
}
