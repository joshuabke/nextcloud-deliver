/**
 * Uploads into Files through Nextcloud's WebDAV, in chunks once a file is
 * larger than one, so a cut of several gigabytes passes size limits of
 * proxies and goes on where it stopped (spec: Discovery and stacking). The
 * request function is axios or a fake of it, so this stays out of `window`.
 */

/**
 * @param {{headers: object}} response - Nextcloud's answer to a finished upload
 * @return {number} the file id; OC-FileId carries the instance id after the number, as in 00000123ocabc123
 */
function fileIdOf(response) {
	return parseInt(response.headers['oc-fileid'], 10)
}

/** Pauses between attempts after a server error, in seconds */
const BACKOFF = [1, 2, 4, 8, 16]

/**
 * @param {number} size - the file's size in bytes
 * @param {number} chunkSize - the server's largest chunk
 * @return {Array<{number: number, start: number, end: number}>} the chunks, numbered from 1 as Nextcloud wants them
 */
export function chunkPlan(size, chunkSize) {
	const plan = []
	for (let start = 0; start < size; start += chunkSize) {
		plan.push({ number: plan.length + 1, start, end: Math.min(size, start + chunkSize) })
	}
	return plan
}

/**
 * @param {string} xml - a PROPFIND answer for an upload folder, depth 1
 * @return {Map<number, number>} chunk number → its size, for the chunks the server has
 */
export function parseChunks(xml) {
	const chunks = new Map()
	for (const [, response] of xml.matchAll(/<(?:\w+:)?response>([\s\S]*?)<\/(?:\w+:)?response>/g)) {
		const name = response.match(/<(?:\w+:)?href>[^<]*\/(\d+)<\/(?:\w+:)?href>/)?.[1]
		const size = response.match(/<(?:\w+:)?getcontentlength>(\d+)</)?.[1]
		if (name && size) {
			chunks.set(Number(name), Number(size))
		}
	}
	return chunks
}

/**
 * @param {{name: string, size: number, lastModified: number}} record - an upload that stopped
 * @param {File} file - one picked or dropped since
 * @return {boolean} whether it is the same file, so the upload goes on with it
 */
export const sameFile = (record, file) => record.name === file.name && record.size === file.size && record.lastModified === file.lastModified

/**
 * Runs a request again after a lost network or a server error: while the
 * browser is offline it waits for the network without counting, a server
 * error is tried five more times with growing pauses.
 *
 * @param {() => Promise<object>} attempt - the request
 * @param {{signal?: AbortSignal, online: () => boolean, untilOnline: () => Promise<void>, sleep: (seconds: number) => Promise<void>, onPause?: (paused: boolean) => void}} env - how to wait
 * @return {Promise<object>} the response
 */
export async function retrying(attempt, { signal, online, untilOnline, sleep, onPause = () => {} }) {
	for (let tries = 0; ;) {
		try {
			return await attempt()
		} catch (error) {
			const status = error.response?.status
			if (signal?.aborted || (status !== undefined && status < 500)) {
				throw error
			}
			if (!online()) {
				onPause(true)
				await untilOnline()
				onPause(false)
				continue
			}
			if (tries >= BACKOFF.length) {
				throw error
			}
			await sleep(BACKOFF[tries++])
		}
	}
}

/**
 * Puts a file into a folder of Files. It never replaces a file of the same
 * name: the name is checked first, and the last step refuses one that
 * appeared meanwhile.
 *
 * @param {object} options - what to upload, and how
 * @param {(config: object) => Promise<object>} options.request - axios, or a fake of it
 * @param {File} options.file - what to upload
 * @param {string} options.target - WebDAV URL the file gets
 * @param {string} options.uploadsUrl - WebDAV URL of the user's upload folders
 * @param {number} options.chunkSize - the server's largest chunk; 0 sends the file in one piece
 * @param {?string} options.folder - the upload folder of an upload that stopped, to go on with
 * @param {(folder: string) => void} options.onFolder - gets the upload folder once it exists, to go on after a reload
 * @param {(loaded: number) => void} options.onProgress - gets the bytes uploaded so far
 * @param {object} options.env - signal, online, untilOnline, sleep and onPause, as retrying takes them
 * @return {Promise<number>} the Nextcloud file id of the upload
 */
export async function uploadFile({ request, file, target, uploadsUrl, chunkSize, folder = null, onFolder = () => {}, onProgress = () => {}, env }) {
	const { signal } = env
	const send = (config) => retrying(() => request({ ...config, signal }), env)
	// Ask first, so a taken name is refused now rather than after the whole upload
	const taken = await request({ method: 'HEAD', url: target, signal }).then(() => true, (error) => {
		if (signal?.aborted) {
			throw error
		}
		return false
	})
	if (taken) {
		throw Object.assign(new Error('taken'), { response: { status: 412 } })
	}
	if (!chunkSize || file.size <= chunkSize) {
		const response = await send({
			method: 'PUT',
			url: target,
			data: file,
			headers: { 'Content-Type': file.type || 'application/octet-stream', 'If-None-Match': '*' },
			onUploadProgress: (event) => onProgress(event.loaded),
		})
		return fileIdOf(response)
	}
	// The chunks the server still has from before; none when their folder is gone
	let have = new Map()
	if (folder) {
		have = await request({ method: 'PROPFIND', url: folder, headers: { Depth: '1' }, signal }).then((response) => parseChunks(response.data), () => null)
		if (have === null) {
			folder = null
			have = new Map()
		}
	}
	const headers = { Destination: target, 'OC-Total-Length': String(file.size) }
	if (!folder) {
		// No crypto.randomUUID: it needs a secure context, and an instance may run on plain http
		folder = `${uploadsUrl}/deliver-${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
		await send({ method: 'MKCOL', url: folder, headers })
		onFolder(folder)
	}
	const plan = chunkPlan(file.size, chunkSize)
	const missing = plan.filter((chunk) => have.get(chunk.number) !== chunk.end - chunk.start)
	let done = file.size - missing.reduce((sum, chunk) => sum + chunk.end - chunk.start, 0)
	onProgress(done)
	for (const chunk of missing) {
		await send({
			method: 'PUT',
			url: `${folder}/${chunk.number}`,
			data: file.slice(chunk.start, chunk.end),
			headers: { ...headers, 'Content-Type': 'application/octet-stream' },
			onUploadProgress: (event) => onProgress(done + event.loaded),
		})
		done += chunk.end - chunk.start
		onProgress(done)
	}
	// ponytail: a MOVE whose answer is lost is sent again and finds no folder; the file is there, the upload reads as failed
	return fileIdOf(await send({ method: 'MOVE', url: `${folder}/.file`, headers: { ...headers, Overwrite: 'F' } }))
}
