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
 * @param {string} davUrl - a file's WebDAV URL, /remote.php/dav/files/<user>/<path>
 * @return {string} the folder Files shows it in, such as /Showreel
 */
export function filesDir(davUrl) {
	const path = decodeURIComponent(new URL(davUrl, 'http://localhost').pathname)
	const inHome = path.split('/remote.php/dav/files/')[1] ?? ''
	const parts = inHome.split('/').slice(1, -1)
	return '/' + parts.join('/')
}
