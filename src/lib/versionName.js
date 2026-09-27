/**
 * The filename convention on the client: `cut_v3.mp4` is Version 3 of `cut`.
 * Mirrors the server's VersionNaming; the server decides, the client only
 * uses it for suggestions.
 *
 * @param {string} filename - the file's name
 * @return {{base: string, number: number}|null} what the name suggests
 */
export function parseVersionName(filename) {
	const stem = filename.replace(/\.[^.]+$/, '')
	const match = /^(.*?)[ _-]?v(\d{1,4})$/i.exec(stem)
	if (match === null) {
		return null
	}
	const base = match[1].trimEnd()
	const number = Number(match[2])
	return base === '' || number < 1 ? null : { base, number }
}
