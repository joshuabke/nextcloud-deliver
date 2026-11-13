/**
 * Assets grouped by the folder of their newest Version, the Project folder
 * itself first. The Project view shows them in this order, and the Review
 * view steps through them in the same order.
 *
 * @param {Array<{path: string}>} assets - the Assets of a Project
 * @return {Array<{path: string, assets: object[]}>}
 */
export function groupByFolder(assets) {
	const byPath = new Map()
	for (const asset of assets) {
		if (!byPath.has(asset.path)) {
			byPath.set(asset.path, [])
		}
		byPath.get(asset.path).push(asset)
	}
	return [...byPath.entries()]
		.sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
		.map(([path, assets]) => ({ path, assets }))
}

/**
 * @param {Array<{url: ?string}>} versions - a Version Stack, newest first
 * @return {string|null} the WebDAV URL of the folder of the newest Version that still has a file, where a new Version is uploaded
 */
export function uploadFolder(versions) {
	const url = versions.find((version) => version.url)?.url
	return url ? url.slice(0, url.lastIndexOf('/')) : null
}

/**
 * @param {string} path - a Project's path as the server has it, /<user>/files/<path>
 * @return {string} the folder as Files shows it, such as /Clients/Showreel
 */
export function projectDir(path) {
	return '/' + path.split('/').slice(3).join('/')
}

/**
 * @param {string} path - a Project's path as the server has it, /<user>/files/<path>
 * @return {string} the folder under the WebDAV files root, encoded, such as me/Clients/Show%20reel
 */
export function projectDavPath(path) {
	const [, user, , ...rest] = path.split('/')
	return [user, ...rest].map(encodeURIComponent).join('/')
}

/**
 * Every folder of a Project that holds Assets, with the folders around them,
 * for the Project's navigation (story 100). A path with a leading slash runs
 * from the Member's home, outside the Project folder (ADR 0009), and keeps it.
 *
 * @param {Array<{path: string}>} assets - the Assets of a Project
 * @return {Array<{path: string, name: string, depth: number, count: number}>} sorted by path, the Project folder itself left out
 */
export function folderTree(assets) {
	const counts = new Map()
	for (const asset of assets) {
		const parts = asset.path.split('/').filter(Boolean)
		const root = asset.path.startsWith('/') ? '/' : ''
		parts.forEach((part, index) => {
			const path = root + parts.slice(0, index + 1).join('/')
			counts.set(path, (counts.get(path) ?? 0) + 1)
		})
	}
	return [...counts.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([path, count]) => ({ path, name: path.split('/').pop(), depth: path.split('/').filter(Boolean).length - 1, count }))
}

/**
 * @param {{path: string}} asset - an Asset
 * @param {string} folder - a folder of the Project, '' for all of it
 * @return {boolean} whether the Asset lies in that folder or below
 */
export function inFolder(asset, folder) {
	return folder === '' || asset.path === folder || asset.path.startsWith(folder + '/')
}

/**
 * One level of a Review Link's folders, as a file browser shows it: the
 * folders right below, each with how many Assets lie in it at any depth, and
 * the Assets right in it.
 *
 * @param {Array<{path: string}>} assets - every Asset of the link, path relative to the Project folder
 * @param {string} folder - the level shown, '' for the top
 * @return {{folders: Array<{path: string, name: string, count: number}>, assets: object[]}}
 */
export function folderLevel(assets, folder) {
	const prefix = folder === '' ? '' : folder + '/'
	const counts = new Map()
	const here = []
	for (const asset of assets) {
		if (asset.path === folder) {
			here.push(asset)
		} else if (asset.path.startsWith(prefix)) {
			const name = asset.path.slice(prefix.length).split('/')[0]
			counts.set(name, (counts.get(name) ?? 0) + 1)
		}
	}
	return {
		folders: [...counts.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([name, count]) => ({ path: prefix + name, name, count })),
		assets: here,
	}
}

/**
 * The order a file browser shows them in, folders before the files beside
 * them at every level, for stepping through a link's Assets as its landing
 * page lists them. Assets in the same folder keep their order.
 *
 * @param {Array<{path: string}>} assets - path relative to the Project folder
 * @return {object[]} a sorted copy
 */
export function folderOrder(assets) {
	const parts = (asset) => asset.path.split('/').filter(Boolean)
	return [...assets].sort((a, b) => {
		const [x, y] = [parts(a), parts(b)]
		for (let i = 0; i < Math.max(x.length, y.length); i++) {
			if (x[i] === y[i]) {
				continue
			}
			// The one that has run out of folders is a file at this level, and folders come first
			if (x[i] === undefined || y[i] === undefined) {
				return x[i] === undefined ? 1 : -1
			}
			return x[i].localeCompare(y[i])
		}
		return 0
	})
}
