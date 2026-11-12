/**
 * Whether a local file is the Version's original, by size and modification
 * time: Nextcloud keeps no checksum the browser can compare (ADR 0019). Two
 * seconds of slack, as sync clients and file systems round the time differently.
 */

/** Seconds a file's time may differ from the Version's and still count as its */
const SLACK = 2

/**
 * @param {{size: number, lastModified: number}} file - the local file, lastModified in milliseconds
 * @param {{fileSize: ?number, fileModified: ?number}} version - the Version's original, modified in seconds
 * @return {boolean} whether the file is the original
 */
export function isOriginal(file, version) {
	if (typeof version.fileSize !== 'number' || typeof version.fileModified !== 'number') {
		return false
	}
	return file.size === version.fileSize && Math.abs(Math.floor(file.lastModified / 1000) - version.fileModified) <= SLACK
}
