/** How much of a name's stem stays beside its extension when the name is cut, so `cut V2` or `_mix3` stay readable */
const KEPT = 6

const graphemes = new Intl.Segmenter()

/**
 * A name split for cutting it near its end: the head gives way with an
 * ellipsis, the tail (the last characters of the stem and the extension)
 * always shows. Only the last extension counts (`.gz` of `.tar.gz`); a dot
 * that starts the name, or one followed by a space or more than eight
 * characters, starts none. A stem of six characters or fewer is not split.
 * Splits between graphemes, so an accent or an emoji stays whole.
 *
 * @param {string} name - a file, folder or Project name
 * @return {{head: string, tail: string}} the two parts, together the name
 */
export function nameParts(name) {
	const extension = name.match(/(?<=.)\.[^.\s]{1,8}$/u)?.[0] ?? ''
	const stem = [...graphemes.segment(name.slice(0, name.length - extension.length))].map((part) => part.segment)
	const cut = Math.max(0, stem.length - KEPT)
	return { head: stem.slice(0, cut).join(''), tail: stem.slice(cut).join('') + extension }
}
