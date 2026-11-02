/**
 * The Proxy the uploading browser makes where the server has no ffmpeg
 * (ADR 0019): Mediabunny decodes the original (ProRes with its WASM decoder),
 * the browser's own encoder makes H.264, and the file grows in the browser's
 * private file system (OPFS), so neither the original nor the Proxy has to
 * fit into memory. The rules come from proxyPlan.js.
 */
import { convertible, fits, needsProxy, plays, proxyBytes, proxySize, videoBitrate } from './proxyPlan.js'

/** Deliver's folder in the browser's private file system */
const FOLDER = 'deliver-proxies'
/** Each file there is held under a Web Lock of this name and its own until it is handed in, in whichever tab, so clearing passes it by */
const LOCK = 'deliver-proxy:'

/** Thrown when the browser has no room for the Proxy; `missing` says how many bytes */
export class NoRoomError extends Error {
	constructor(missing) {
		super('No room for the Proxy')
		this.missing = missing
	}
}

let loaded = null
/**
 * Mediabunny with the decoders and encoders this browser lacks: ProRes, which
 * no browser decodes, and AAC where the browser does not encode it (Chrome on
 * Linux, Firefox). Loaded only when a Proxy is made.
 *
 * @return {Promise<object>} the Mediabunny module
 */
function mediabunny() {
	loaded ??= (async () => {
		const module = await import('mediabunny')
		const { registerProresDecoder } = await import('@mediabunny/prores')
		registerProresDecoder()
		if (!(await module.canEncodeAudio('aac'))) {
			const { registerAacEncoder } = await import('@mediabunny/aac-encoder')
			registerAacEncoder()
		}
		return module
	})()
	return loaded
}

/**
 * @param {Blob|string} source - the file the browser holds, or where the server serves it
 * @return {Promise<object>} a Mediabunny Input for it
 */
async function open(source) {
	const { ALL_FORMATS, BlobSource, Input, UrlSource } = await mediabunny()
	return new Input({ source: typeof source === 'string' ? new UrlSource(source) : new BlobSource(source), formats: ALL_FORMATS })
}

/**
 * @param {object} video - Mediabunny's video track of the original
 * @param {number} maxHeight - the Proxy resolution
 * @return {{width: number, height: number}} the Proxy's size
 */
const proxyOf = (video, maxHeight) => proxySize({ width: video.displayWidth, height: video.displayHeight }, maxHeight)

/**
 * What the browser can do with a file, read from its headers only, so a
 * file on the server costs a few range requests (ADR 0019).
 *
 * @param {Blob|string} source - the file, or its URL
 * @param {number} bytes - its size
 * @param {object} settings - the server's
 * @param {number} settings.maxHeight - the Proxy resolution
 * @param {number} settings.maxBitrate - the Proxy bitrate threshold in Mbit/s
 * @return {Promise<{readable: boolean, playable: boolean, convertible: boolean, needsProxy: boolean, codec: ?string}>}
 *   whether Mediabunny reads it at all, whether browsers play it as it is, whether this browser can make its Proxy
 *   (it decodes the first picture and sound, encodes H.264, and the server reads the container's Frames), whether it
 *   gets one, and the codec it cannot decode, if that is what stands in the way
 */
export async function inspect(source, bytes, { maxHeight, maxBitrate }) {
	const { canEncodeVideo } = await mediabunny()
	const input = await open(source)
	try {
		const format = await input.getFormat().catch(() => null)
		if (!format) {
			return { readable: false, playable: false, convertible: false, needsProxy: false, codec: null }
		}
		const tracks = (await input.getTracks()).filter((track) => track.type === 'video' || track.type === 'audio')
		const described = await Promise.all(tracks.map(async (track) => ({
			type: track.type,
			codec: track.codec,
			codecString: await track.getCodecParameterString(),
			decodable: await track.canDecode(),
		})))
		const playable = plays(format.name, described)
		const video = await input.getPrimaryVideoTrack()
		// A Proxy carries the first picture and the first sound; the other tracks need not be decodable
		const primary = [video, await input.getPrimaryAudioTrack()]
		const undecodable = described.find((track, i) => primary.includes(tracks[i]) && !track.decodable)
		return {
			readable: true,
			playable,
			convertible: Boolean(video) && !undecodable && convertible(format.name)
				// Asked for the Proxy, not the original: an 8K master or an odd anamorphic width still makes a 1080p Proxy
				&& await canEncodeVideo('avc', { ...proxyOf(video, maxHeight), bitrate: videoBitrate(proxyOf(video, maxHeight), maxBitrate) }),
			needsProxy: Boolean(video) && needsProxy(playable, bytes, await input.computeDuration(), maxBitrate),
			codec: undecodable?.codec ?? null,
		}
	} finally {
		input.dispose()
	}
}

/** @return {Promise<FileSystemDirectoryHandle>} Deliver's folder in the browser's private file system */
async function folder() {
	return (await navigator.storage.getDirectory()).getDirectoryHandle(FOLDER, { create: true })
}

/** Deletes what is left of Proxies no tab works on any more: from closed tabs, failed or handed in */
export async function clearProxies() {
	try {
		const dir = await folder()
		const held = new Set(((await navigator.locks.query()).held ?? []).map((lock) => lock.name))
		for await (const name of dir.keys()) {
			if (!held.has(LOCK + name)) {
				await dir.removeEntry(name).catch(() => {})
			}
		}
	} catch {
		// No private file system: there is nothing to clear
	}
}

/**
 * @param {number} bytes - what the Proxy needs
 * @throws {NoRoomError} when the browser does not give it, even after asking to keep Deliver's data
 */
async function makeRoom(bytes) {
	const free = async () => {
		const { quota = 0, usage = 0 } = await navigator.storage.estimate()
		return quota - usage
	}
	let room = await free()
	// Firefox keeps a site to 10 GiB unless its data may stay; it asks its user once
	if (room < bytes && await navigator.storage.persist?.()) {
		room = await free()
	}
	if (room < bytes) {
		throw new NoRoomError(bytes - room)
	}
}

/**
 * Makes the Proxy of a file, one picture after another into a file of the
 * private file system, and checks it as the server will: as many Frames as
 * the original, at its rate.
 *
 * @param {Blob|string} source - the original, or its URL
 * @param {object} settings - the server's
 * @param {number} settings.maxHeight - the Proxy resolution
 * @param {number} settings.maxBitrate - the Proxy bitrate threshold in Mbit/s
 * @param {(percent: number) => void} onProgress - how far it is, 0 to 99
 * @param {AbortSignal} signal - stops it
 * @return {Promise<{file: File, done: () => Promise<void>}>} the Proxy, and what deletes it once handed in
 */
export async function makeProxy(source, { maxHeight, maxBitrate }, onProgress, signal) {
	const { Conversion, Mp4OutputFormat, Output, StreamTarget } = await mediabunny()
	const name = `proxy-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`
	// Held until done(), so no tab clears the file while this one still needs it
	let release
	const held = new Promise((resolve) => {
		navigator.locks.request(LOCK + name, () => new Promise((free) => {
			release = free
			resolve()
		}))
	})
	await held
	const dir = await folder()
	const done = async () => {
		await dir.removeEntry(name).catch(() => {})
		release()
	}
	const input = await open(source)
	try {
		await clearProxies()
		signal.throwIfAborted()
		const video = await input.getPrimaryVideoTrack()
		const frames = (await video.computePacketStats()).packetCount
		// Not from 0: an edit may start a little later
		const seconds = await video.computeDuration() - await video.getFirstTimestamp()
		const size = proxyOf(video, maxHeight)
		const bitrate = videoBitrate(size, maxBitrate)
		await makeRoom(proxyBytes(seconds, bitrate))
		signal.throwIfAborted()

		const writable = await (await dir.getFileHandle(name, { create: true })).createWritable()
		const output = new Output({
			// The index goes into room kept at the start: the Proxy plays from its first bytes, and nothing waits in memory
			format: new Mp4OutputFormat({ fastStart: 'reserve' }),
			target: new StreamTarget(writable, { chunked: true }),
		})
		const conversion = await Conversion.init({
			input,
			output,
			tracks: 'primary',
			// The original's own average rate, unrounded: the server checks the Proxy against it
			video: { codec: 'avc', ...size, fit: 'fill', frameRate: frames / seconds, bitrate, keyFrameInterval: 1, forceTranscode: true },
			audio: { codec: 'aac', bitrate: 160_000 },
			tags: {},
			showWarnings: false,
		})
		// A track it would leave out makes a Proxy the server refuses: silent, or without a picture
		if (!conversion.isValid || conversion.discardedTracks.some((each) => ['video', 'audio'].includes(each.track.type))) {
			await writable.abort?.().catch(() => {})
			throw new Error(conversion.discardedTracks.map((each) => `${each.track.type}: ${each.reason}`).join(', '))
		}
		const stop = () => conversion.cancel()
		signal.addEventListener('abort', stop, { once: true })
		conversion.onProgress = (progress) => onProgress(Math.min(99, Math.floor(progress * 100)))
		try {
			await conversion.execute()
		} finally {
			signal.removeEventListener('abort', stop)
		}

		const file = await (await dir.getFileHandle(name)).getFile()
		await check(file, { frames, seconds })
		return { file, done }
	} catch (error) {
		await done()
		throw error
	} finally {
		input.dispose()
	}
}

/**
 * The server refuses a Proxy with other Frames than the original or another
 * rate; the browser does not upload one in the first place.
 *
 * @param {File} file - the Proxy
 * @param {{frames: number, seconds: number}} original - its Frames and their length
 */
async function check(file, original) {
	const input = await open(file)
	try {
		const video = await input.getPrimaryVideoTrack()
		const made = { frames: (await video.computePacketStats()).packetCount, seconds: await video.computeDuration() - await video.getFirstTimestamp() }
		if (!fits(made, original)) {
			throw new Error(`The Proxy came out with ${made.frames} Frames in ${made.seconds} s instead of ${original.frames} in ${original.seconds} s`)
		}
	} finally {
		input.dispose()
	}
}
