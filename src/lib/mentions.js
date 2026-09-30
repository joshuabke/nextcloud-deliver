/**
 * Mentions (story 90), written as the server reads them: `@uid`, or
 * `@"uid"` when the user id holds characters that end a word.
 */

const PATTERN = /(?<![\w@])@(?:"([^"\n]+)"|([\w.@-]+))/gu

/**
 * @param {string} uid - a user id
 * @return {string} how it is written into a Comment
 */
export function mentionToken(uid) {
	return /^[\w.@-]+$/u.test(uid) && !/[.-]$/.test(uid) ? `@${uid}` : `@"${uid}"`
}

/**
 * The mention being typed, if the caret stands right after `@` and a word.
 *
 * @param {string} text - the field's text
 * @param {number} caret - where the caret is
 * @return {{start: number, query: string}|null} where the `@` is and what follows it
 */
export function mentionAt(text, caret) {
	const match = /(^|\s)@([^\s@"]*)$/u.exec(text.slice(0, caret))
	return match ? { start: caret - match[2].length - 1, query: match[2] } : null
}

/**
 * @param {string} text - the field's text
 * @param {{start: number}} at - the mention being typed
 * @param {number} caret - where the caret is
 * @param {string} uid - the chosen user
 * @return {{text: string, caret: number}} the text with the mention put in, and the caret after it
 */
export function insertMention(text, at, caret, uid) {
	const token = mentionToken(uid) + ' '
	return { text: text.slice(0, at.start) + token + text.slice(caret), caret: at.start + token.length }
}

/**
 * @param {string} text - a piece of a Comment body
 * @param {Record<string, string>} names - user id → display name, as the server sends them
 * @return {Array<{text: string, mention?: string}>} text and mentions in order; a mention carries the user id
 */
export function splitMentions(text, names) {
	const pieces = []
	let last = 0
	for (const match of text.matchAll(PATTERN)) {
		const uid = match[1] ?? match[2].replace(/[.-]+$/, '')
		if (!(uid in names)) {
			continue
		}
		if (match.index > last) {
			pieces.push({ text: text.slice(last, match.index) })
		}
		pieces.push({ text: '@' + names[uid], mention: uid })
		last = match.index + (match[1] !== undefined ? match[0].length : uid.length + 1)
	}
	if (last < text.length) {
		pieces.push({ text: text.slice(last) })
	}
	return pieces
}
