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

/** A tab touches the record of the upload it sends this often, in milliseconds */
export const HEARTBEAT = 10 * 1000
/** How long an upload that stopped is offered to go on with (story 135); Nextcloud drops its folder after a day */
const KEPT = 24 * 60 * 60 * 1000

/**
 * @param {{seen: number}} record - an unfinished upload, as a tab left it
 * @param {number} now - the time
 * @return {boolean} whether it is younger than a day, so its chunks may still be there
 */
export const current = (record, now) => now - record.seen < KEPT

/**
 * @param {{seen: number, left?: boolean}} record - an unfinished upload, as a tab left it
 * @param {number} now - the time
 * @return {boolean} whether another tab is still sending it, so this one must keep its hands off
 */
export const sentElsewhere = (record, now) => !record.left && now - record.seen <= 3 * HEARTBEAT

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
			// Waiting ends with a cancel too, which then ends the upload
			if (!online()) {
				onPause(true)
				await untilOnline()
				if (signal?.aborted) {
					throw error
				}
				onPause(false)
				continue
			}
			if (tries >= BACKOFF.length) {
				throw error
			}
			await sleep(BACKOFF[tries++])
			if (signal?.aborted) {
				throw error
			}
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
	// A MOVE whose answer is lost (a proxy giving up while the server joins a large file) may have worked all the same:
	// the name was free before, so a file there now is this one. Sent again, the MOVE would find its folder gone.
	// An answer the server did give stands: a 412 means another file took the name meanwhile, and that is not this one.
	return retrying(async () => {
		try {
			return fileIdOf(await request({ method: 'MOVE', url: `${folder}/.file`, headers: { ...headers, Overwrite: 'F' }, signal }))
		} catch (error) {
			const answered = error.response?.status !== undefined && error.response.status < 500
			const arrived = signal?.aborted || answered ? null : await fileIdAt(request, target, signal)
			if (arrived) {
				return arrived
			}
			throw error
		}
	}, env)
}

/**
 * @param {(config: object) => Promise<object>} request - axios, or a fake of it
 * @param {string} url - WebDAV URL of a file or folder
 * @param {AbortSignal} [signal] - ends the request
 * @return {Promise<?number>} its file id, or null when there is nothing
 */
export function fileIdAt(request, url, signal) {
	return request({
		method: 'PROPFIND',
		url,
		headers: { Depth: '0' },
		data: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:fileid/></d:prop></d:propfind>',
		signal,
	}).then((response) => Number(response.data.match(/<(?:\w+:)?fileid>(\d+)</)?.[1]) || null, () => null)
}
