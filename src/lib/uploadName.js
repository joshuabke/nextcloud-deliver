/**
 * Another name for an upload whose own is taken in the folder, free of the
 * store so Vitest can check it.
 */
import { t } from './l10n.js'
import { extensionOf } from './media.js'
import { NAMES } from './upload.js'

/**
 * @param {string} filename - a filename
 * @return {string} it without its extension
 */
export const stemOf = (filename) => filename.slice(0, filename.length - extensionOf(filename).length)

/** Nextcloud takes no longer name, in bytes (OC\Files\FilenameValidator) */
const LONGEST = 250

/**
 * @param {string} name - a filename
 * @return {boolean} whether it has room for it
 */
const fits = (name) => new TextEncoder().encode(name).length <= LONGEST

/**
 * @param {string} filename - the name that is taken
 * @param {(name: string) => Promise<boolean>} taken - whether a name is, in that folder
 * @return {Promise<string>} the first free one: `mix (2).mp3` for `mix.mp3`, `mix (3).mp3` for that; after a hundred the next, free or not. A long one loses the end of its stem
 */
export async function freeName(filename, taken) {
	const [, base, counted] = /^(.*?)(?: \((\d{1,4})\))?$/.exec(stemOf(filename))
	const extension = filename.slice(stemOf(filename).length)
	// By characters, so none is cut in half
	const stem = [...base]
	const start = Number(counted ?? 1) + 1
	for (let number = start; ; number++) {
		const suffix = ` (${number})${extension}`
		while (stem.length > 1 && !fits(stem.join('') + suffix)) {
			stem.pop()
		}
		const name = stem.join('') + suffix
		if (number - start >= NAMES || !await taken(name)) {
			return name
		}
	}
}

/**
 * @param {string} name - what was typed
 * @param {string} filename - the file's name
 * @param {(name: string) => void} validate - validateFilename of @nextcloud/files, which needs a window
 * @return {?string} why the file cannot be called that, null when it can
 */
export function nameProblem(name, filename, validate) {
	const extension = extensionOf(filename)
	// Nextcloud reads the type from the extension, so it stays, as in "Rename file"
	if (extensionOf(name) !== extension || stemOf(name).trim() === '') {
		return extension ? t('deliver', 'Keep the extension {extension}.', { extension }) : t('deliver', 'This name is not allowed.')
	}
	if (!fits(name)) {
		return t('deliver', 'This name is too long.')
	}
	try {
		validate(name)
	} catch (error) {
		return error.segment ? t('deliver', '"{segment}" is not allowed in a filename.', { segment: error.segment }) : t('deliver', 'This name is not allowed.')
	}
	return null
}
