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

/**
 * @param {Array<{number: number}>} versions - a Version Stack
 * @return {number} the Version Number the next Version of it gets, as the server's StackService counts
 */
export const nextNumber = (versions) => Math.max(0, ...versions.map((version) => version.number)) + 1

/**
 * The name a new Version's file takes where its own is taken. A version
 * suffix it has gives way, its spelling kept, so the convention reads the new
 * number and the same Asset name as before.
 *
 * @param {string} filename - the file's name
 * @param {number} number - the Version Number
 * @return {string} `mix_v2.mp3` for `mix.mp3`, `cut v04.mov` for `cut v03.mov`
 */
export function versionFileName(filename, number) {
	const extension = filename.match(/\.[^.]+$/)?.[0] ?? ''
	const stem = filename.slice(0, filename.length - extension.length)
	return (parseVersionName(filename) === null
		? `${stem}_v${number}`
		: stem.replace(/(v)(\d+)$/i, (_, v, digits) => v + String(number).padStart(digits.length, '0'))) + extension
}

/**
 * @param {string} filename - the file's name
 * @param {() => Promise<Array<{number: number}>>} readStack - the Version Stack it goes on, as the server has it now
 * @return {() => Promise<string>} gives the names to try where the file's own is taken: the number the Version gets, then each after it
 */
export function versionNames(filename, readStack) {
	let number = null
	return async () => {
		number = number === null ? await readStack().then(nextNumber, () => 2) : number + 1
		return versionFileName(filename, number)
	}
}
