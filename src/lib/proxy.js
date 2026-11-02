/**
 * The Proxy the uploading browser makes where the server has no ffmpeg
 * (ADR 0019): Mediabunny decodes the original (ProRes with its WASM decoder),
 * the browser's own encoder makes H.264, and the file grows in the browser's
 * private file system (OPFS), so neither the original nor the Proxy has to
 * fit into memory. The rules come from proxyPlan.js.
 */
import { frameRate, needsProxy, plays, proxyBytes, proxySize, videoBitrate } from './proxyPlan.js'

/** Deliver's folder in the browser's private file system */
const FOLDER = 'deliver-proxies'
/** The files this tab is writing, which clearing leaves alone */
const writing = new Set()

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
 * What the browser can do with a file, read from its headers only, so a
 * file on the server costs a few range requests (stories of ADR 0019).
 *
 * @param {Blob|string} source - the file, or its URL
 * @param {number} bytes - its size
 * @param {number} maxBitrate - the Proxy bitrate threshold in Mbit/s
 * @return {Promise<{readable: boolean, decodable: boolean, playable: boolean, needsProxy: boolean, codec: ?string}>} whether
 *   Mediabunny reads it at all, whether this browser decodes its picture (or its sound, for audio), whether browsers
 *   play it as it is, whether it gets a Proxy, and the codec that decides
 */
export async function inspect(source, bytes, maxBitrate) {
	const input = await open(source)
	try {
		const format = await input.getFormat().catch(() => null)
		if (!format) {
			return { readable: false, decodable: false, playable: false, needsProxy: false, codec: null }
		}
		const video = await input.getPrimaryVideoTrack()
		const audio = await input.getPrimaryAudioTrack()
		const decides = video ?? audio
		const playable = plays({
			format: format.name,
			video: video?.codec ?? (video ? 'unknown' : null),
			videoCodec: await video?.getCodecParameterString() ?? null,
			audio: audio?.codec ?? (audio ? 'unknown' : null),
		})
		return {
			readable: true,
			decodable: decides ? await decides.canDecode() : false,
			playable,
			needsProxy: Boolean(video) && needsProxy(playable, bytes, await input.computeDuration(), maxBitrate),
			codec: decides?.codec ?? null,
		}
	} finally {
		input.dispose()
	}
}

/** @return {Promise<FileSystemDirectoryHandle>} Deliver's folder in the browser's private file system */
async function folder() {
	return (await navigator.storage.getDirectory()).getDirectoryHandle(FOLDER, { create: true })
}

/** Deletes what is left of Proxies no tab writes any more: closed tabs, failed or handed-in ones */
export async function clearProxies() {
	try {
		const dir = await folder()
		for await (const name of dir.keys()) {
			if (!writing.has(name)) {
				// Another tab still writing its file holds it open, and the removal fails
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
	const input = await open(source)
	const name = `proxy-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`
	writing.add(name)
	const dir = await folder()
	const done = async () => {
		writing.delete(name)
		await dir.removeEntry(name).catch(() => {})
	}
	try {
		await clearProxies()
		const video = await input.getPrimaryVideoTrack()
		const original = await video.computePacketStats()
		// Not from 0: an edit may start a little later
		const seconds = await video.computeDuration() - await video.getFirstTimestamp()
		const fps = frameRate(original.packetCount, seconds)
		const size = proxySize({ width: video.displayWidth, height: video.displayHeight }, maxHeight)
		const bitrate = videoBitrate(size, maxBitrate)
		await makeRoom(proxyBytes(seconds, bitrate))

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
			video: { codec: 'avc', ...size, fit: 'fill', frameRate: fps.num / fps.den, bitrate, keyFrameInterval: 1, forceTranscode: true },
			audio: { codec: 'aac', bitrate: 160_000 },
			tags: {},
			showWarnings: false,
		})
		if (!conversion.isValid) {
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
		await check(file, original.packetCount, fps)
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
 * @param {number} frames - the original's
 * @param {{num: number, den: number}} fps - its rate
 */
async function check(file, frames, fps) {
	const input = await open(file)
	try {
		const video = await input.getPrimaryVideoTrack()
		const made = (await video.computePacketStats()).packetCount
		const seconds = await video.computeDuration() - await video.getFirstTimestamp()
		if (made !== frames || Math.abs(seconds - frames * fps.den / fps.num) > fps.den / fps.num / 2) {
			throw new Error(`The Proxy came out with ${made} Frames instead of ${frames}`)
		}
	} finally {
		input.dispose()
	}
}
