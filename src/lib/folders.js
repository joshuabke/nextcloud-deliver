/**
 * Assets grouped by the folder of their newest Version, the Project folder
 * itself first: the Project view's flat view, and its results of a filter or
 * a search.
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
 * The folders of a path, top first. A path with a leading slash runs from the
 * Member's home, outside the Project folder (ADR 0009), and keeps the slash on
 * its first folder, as folderTree() does.
 *
 * @param {string} path - a folder, '' for the Project folder
 * @return {string[]} its folders
 */
function segments(path) {
	const parts = path.split('/').filter(Boolean)
	if (path.startsWith('/') && parts.length) {
		parts[0] = '/' + parts[0]
	}
	return parts
}

/**
 * One level of a Project's folders, as a file browser shows it: the folders
 * right below, each with how many Assets lie in it at any depth, and the
 * Assets right in it.
 *
 * @param {Array<{path: string}>} assets - Assets, path relative to the Project folder
 * @param {string} folder - the level shown, '' for the top
 * @return {{folders: Array<{path: string, name: string, count: number}>, assets: object[]}}
 */
export function folderLevel(assets, folder) {
	const depth = segments(folder).length
	const counts = new Map()
	const here = []
	for (const asset of assets.filter((each) => inFolder(each, folder))) {
		const parts = segments(asset.path)
		if (parts.length === depth) {
			here.push(asset)
		} else {
			const path = parts.slice(0, depth + 1).join('/')
			counts.set(path, (counts.get(path) ?? 0) + 1)
		}
	}
	return {
		folders: [...counts.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([path, count]) => ({ path, name: path.split('/').pop(), count })),
		assets: here,
	}
}

/**
 * The order a file browser shows them in, folders before the files beside
 * them at every level, for stepping through Assets as their folders list
 * them. Assets in the same folder keep their order.
 *
 * @param {Array<{path: string}>} assets - path relative to the Project folder
 * @return {object[]} a sorted copy
 */
export function folderOrder(assets) {
	return [...assets].sort((a, b) => {
		const [x, y] = [segments(a.path), segments(b.path)]
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

/**
 * What a ZIP of picked Assets and folders holds: every downloadable Asset
 * picked, and every downloadable one in a picked folder at any depth, so a
 * folder goes down whole without its files being picked one by one.
 *
 * @param {Array<{assetId: number, path: string, downloadUrl: ?string}>} assets - every Asset of the link
 * @param {Set<number>} assetIds - the Assets picked
 * @param {Set<string>} folders - the folders picked
 * @return {number[]} the Asset ids to zip, in the order of assets
 */
export function zipped(assets, assetIds, folders) {
	return assets
		.filter((asset) => asset.downloadUrl && (assetIds.has(asset.assetId) || [...folders].some((folder) => inFolder(asset, folder))))
		.map((asset) => asset.assetId)
}
