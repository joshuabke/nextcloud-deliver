/**
 * The Proxy the uploading browser makes where the server has no ffmpeg
 * (ADR 0019): Mediabunny decodes the original (ProRes with its WASM decoder),
 * the browser's own encoder makes H.264, and the file grows in the browser's
 * private file system (OPFS), so neither the original nor the Proxy has to
 * fit into memory. The rules come from proxyPlan.js.
 */
import { getCurrentUser } from '@nextcloud/auth'
import axios from '@nextcloud/axios'
import { generateRemoteUrl } from '@nextcloud/router'
import { chunkSizeFor, errorMessage, getVersion, giveProxy, giveThumbs, giveWaveform, reportProxy } from '../api.js'
import { t } from './l10n.js'
import { fits, needsProxy, plays, proxyBytes, proxySize, THUMB_WIDTH, thumbGrid, thumbSlot, videoBitrate, whyNot } from './proxyPlan.js'
import { unsupported } from './unsupported.js'
import { uploadFile } from './upload.js'
import { addPeaks, BUCKETS, roundPeaks } from './waveform.js'

/** Deliver's folder in the browser's private file system */
const FOLDER = 'deliver-proxies'
/** Each file there is held under a Web Lock of this name and its own until it is handed in, in whichever tab, so clearing passes it by */
const LOCK = 'deliver-proxy:'
/** Seconds between two reports of a Proxy's progress; the server takes a browser silent for two minutes as gone */
const REPORT = 15

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
 * @return {Promise<{readable: boolean, playable: boolean, convertible: boolean, needsProxy: boolean, reason: ?string, codec: ?string}>}
 *   whether Mediabunny reads it at all, whether browsers play it as it is, whether this browser can make its Proxy
 *   (it decodes the first picture and sound, encodes H.264, and the server reads the container's Frames), whether it
 *   gets one, and what stands in the way: `reason` is 'codec' (this browser cannot decode `codec`, others may), 'format'
 *   (no browser can help) or 'encoder' (this browser has no H.264 encoder)
 */
export async function inspect(source, bytes, { maxHeight, maxBitrate }) {
	const { canEncodeVideo } = await mediabunny()
	const input = await open(source)
	try {
		const format = await input.getFormat().catch(() => null)
		if (!format) {
			return { readable: false, playable: false, convertible: false, needsProxy: false, reason: 'format', codec: null }
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
		// The encoder is asked for the Proxy, not the original: an 8K master or an odd anamorphic width still makes a 1080p Proxy
		const reason = whyNot({ video: Boolean(video), container: format.name, undecodable })
			?? (await canEncodeVideo('avc', { ...proxyOf(video, maxHeight), bitrate: videoBitrate(proxyOf(video, maxHeight), maxBitrate) }) ? null : 'encoder')
		return {
			readable: true,
			playable,
			convertible: reason === null,
			needsProxy: Boolean(video) && needsProxy(playable, bytes, await input.computeDuration(), maxBitrate),
			reason,
			codec: undecodable?.codec ?? null,
		}
	} finally {
		input.dispose()
	}
}

/**
 * @param {?object} seen - what inspect() found, null when it could not look
 * @return {string} why this browser cannot make a Proxy of the file
 */
export function cannotConvert(seen) {
	return unsupported(seen, navigator.userAgent, navigator.maxTouchPoints, window.isSecureContext)
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
 * the original, at its rate. The same pass draws the Thumbnail Strip from
 * the pictures and the Waveform from the sound, in the server's shapes, so
 * the original is decoded once.
 *
 * @param {Blob|string} source - the original, or its URL
 * @param {object} settings - the server's
 * @param {number} settings.maxHeight - the Proxy resolution
 * @param {number} settings.maxBitrate - the Proxy bitrate threshold in Mbit/s
 * @param {number} settings.thumbCap - the Thumbnail Strip cap
 * @param {(percent: number) => void} onProgress - how far it is, 0 to 99
 * @param {AbortSignal} signal - stops it
 * @return {Promise<{file: File, done: () => Promise<void>, frames: number, thumbs: ?{image: Blob, every: number, count: number}, peaks: ?number[]}>}
 *   the Proxy, what deletes it once handed in, the Frames of the original, its Thumbnail Strip (WebP, JPEG where the browser encodes no WebP) and its Waveform (null without sound)
 */
export async function makeProxy(source, { maxHeight, maxBitrate, thumbCap }, onProgress, signal) {
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
		const grid = thumbGrid(seconds, thumbCap, size)
		// The Thumbnail Strip never costs the Proxy: none where the browser encodes neither WebP nor JPEG, or has no canvas that large
		const stripType = await stripImageType()
		let strip = stripType ? stripCanvas(grid) : null
		let drawn = -1
		const peaks = new Float32Array(BUCKETS)
		let heard = false
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
			video: {
				codec: 'avc',
				...size,
				fit: 'fill',
				frameRate: frames / seconds,
				bitrate,
				keyFrameInterval: 1,
				forceTranscode: true,
				// The picture, already at the Proxy's size, also goes into the Thumbnail Strip
				process: (sample) => {
					const slot = thumbSlot(grid, sample.timestamp)
					if (strip && slot !== null && slot >= drawn) {
						drawn = slot
						try {
							sample.draw(strip, (slot % grid.columns) * THUMB_WIDTH, Math.floor(slot / grid.columns) * grid.tileHeight, THUMB_WIDTH, grid.tileHeight)
						} catch {
							strip = null
						}
					}
					return sample
				},
			},
			audio: {
				codec: 'aac',
				bitrate: 160_000,
				// The sound also goes into the Waveform
				process: (sample) => {
					const channels = Array.from({ length: sample.numberOfChannels }, (_, planeIndex) => {
						const samples = new Float32Array(sample.numberOfFrames)
						sample.copyTo(samples, { planeIndex, format: 'f32-planar' })
						return samples
					})
					addPeaks(peaks, channels, sample.timestamp, sample.sampleRate, seconds)
					heard = true
					return sample
				},
			},
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
		const image = strip && drawn >= 0 ? await strip.canvas.convertToBlob({ type: stripType, quality: stripType === 'image/webp' ? 0.75 : 0.8 }).catch(() => null) : null
		return {
			file,
			done,
			frames,
			thumbs: image?.type === stripType ? { image, every: grid.every, count: grid.count } : null,
			peaks: heard ? roundPeaks(peaks) : null,
		}
	} catch (error) {
		await done()
		throw error
	} finally {
		input.dispose()
	}
}

let probedType = null
/** @return {Promise<?string>} the type the Thumbnail Strip is exported as: WebP, JPEG where the browser's canvas gives another type for WebP (Safari's a PNG), null where it encodes neither */
function stripImageType() {
	probedType ??= (async () => {
		// A canvas encodes nothing before it has a context
		const canvas = new OffscreenCanvas(1, 1)
		canvas.getContext('2d')
		for (const type of ['image/webp', 'image/jpeg']) {
			if ((await canvas.convertToBlob({ type })).type === type) {
				return type
			}
		}
		return null
	})().catch(() => null)
	return probedType
}

/**
 * @param {{columns: number, rows: number, tileHeight: number}} grid - from thumbGrid
 * @return {?OffscreenCanvasRenderingContext2D} the Thumbnail Strip's canvas, black where the grid has no picture as ffmpeg's tile filter leaves it; null where the browser has none that large (iOS: 16.7 Mpx)
 */
function stripCanvas(grid) {
	try {
		const context = new OffscreenCanvas(grid.columns * THUMB_WIDTH, grid.rows * grid.tileHeight).getContext('2d', { alpha: false })
		context.fillRect(0, 0, context.canvas.width, context.canvas.height)
		return context
	} catch {
		return null
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

let converting = Promise.resolve()
/**
 * Makes one Proxy after the other in this tab, so two masters do not fight
 * over the decoder, the encoder and the disk.
 *
 * @param {Blob|string} source - the original, or its URL
 * @param {{maxHeight: number, maxBitrate: number, thumbCap: number}} settings - the server's Proxy resolution, threshold and Thumbnail Strip cap
 * @param {{state: string, progress: number, error: ?string}} status - kept up to date: running, then failed if it does
 * @param {AbortSignal} signal - stops it
 * @return {Promise<?{file: File, done: () => Promise<void>, frames: number, thumbs: ?{image: Blob, every: number, count: number}, peaks: ?number[]}>} what makeProxy returns, null when it failed or was stopped
 */
export function convertInTurn(source, settings, status, signal) {
	Object.assign(status, { state: 'running', progress: 0, error: null })
	const turn = converting.then(() => signal.aborted
		? Promise.reject(new Error('cancelled'))
		: makeProxy(source, settings, (progress) => { status.progress = progress }, signal))
	converting = turn.catch(() => {})
	return turn.catch((error) => {
		Object.assign(status, {
			state: 'failed',
			error: error instanceof NoRoomError
				? t('deliver', 'This browser has no room for the Proxy: {size} MB more are needed on this computer.', { size: Math.ceil(error.missing / 1e6) })
				: null,
		})
		return null
	})
}

/**
 * Stops a Proxy that is not handed in, deletes it once it is made and
 * settles its status, so nothing waits on it and the tab closes without a
 * warning.
 *
 * @param {Promise<?{done: () => Promise<void>}>} making - from convertInTurn
 * @param {{state: string}} status - its; stopped
 * @param {AbortController} controller - stops the conversion
 */
export function dropProxy(making, status, controller) {
	controller.abort()
	making.then((made) => made?.done())
	status.state = 'stopped'
}

/**
 * Hands in a Proxy this browser makes, the same way for an upload in
 * Deliver, one in the Files app and the fallback on the Asset card (ADR
 * 0019): it reports the progress while the Proxy is made and uploaded,
 * uploads it next to the Version's file and hands it in. Only a Member with
 * Manage on the Version hands in; for anyone else the Proxy is stopped.
 *
 * @param {number} versionId - the Version
 * @param {Promise<?{file: File, done: () => Promise<void>}>} making - from convertInTurn
 * @param {{state: string, progress: number, error: ?string}} status - its, as convertInTurn keeps it, then uploading, handing, ready, failed or stopped
 * @param {AbortController} controller - stops the Proxy
 * @return {Promise<boolean>} false when this Member may not hand it in
 */
export async function handInProxy(versionId, making, status, controller) {
	const context = await getVersion(versionId).catch(() => null)
	const url = context?.versions.find((each) => each.id === versionId)?.url
	if (!context?.manages || !url) {
		dropProxy(making, status, controller)
		return false
	}
	// Also while the Proxy uploads, which takes minutes for a long one: silent for two minutes, the server takes this tab as gone
	let reported = Promise.resolve()
	const report = () => {
		if (['running', 'uploading'].includes(status.state)) {
			reported = reportProxy(versionId, Math.min(99, status.state === 'running' ? status.progress : 99)).catch(() => {})
		}
	}
	report()
	const beat = setInterval(report, REPORT * 1000)
	try {
		const made = await making
		if (made === null) {
			return true
		}
		try {
			// The server reads the original first if its background job has not yet, and says so while a worker is at it;
			// it deletes every upload it looked at, so another try uploads the Proxy again
			for (let attempt = 0; ; attempt++) {
				Object.assign(status, { state: 'uploading', progress: 0 })
				const fileId = await uploadNextTo(url, made.file, status, controller.signal)
				// No report may land while the server takes it: it would mark the Proxy as running again
				status.state = 'handing'
				await reported
				try {
					await giveProxy(versionId, fileId)
					break
				} catch (error) {
					if (error.response?.status !== 409 || attempt >= 12 || !/not read yet/.test(errorMessage(error) ?? '')) {
						throw error
					}
					await new Promise((resolve) => setTimeout(resolve, 5000))
				}
			}
			Object.assign(status, { state: 'ready', progress: 100 })
		} catch (error) {
			Object.assign(status, { state: 'failed', error: error.response ? errorMessage(error) : null })
		} finally {
			await made.done()
		}
		// Whatever became of the Proxy: the server refuses them where it has its own, or makes them
		await Promise.all([
			made.thumbs && giveThumbs(versionId, made.thumbs.image, made.thumbs.every, made.thumbs.count).catch(() => {}),
			made.peaks && giveWaveform(versionId, made.peaks, made.frames).catch(() => {}),
		])
	} finally {
		clearInterval(beat)
	}
	return true
}

/**
 * Uploads a Proxy next to the Version's file, under a name without a media
 * extension so that Auto Intake passes it by; deleted again when it does
 * not arrive.
 *
 * @param {string} url - the WebDAV URL of the Version's file
 * @param {File} file - the Proxy
 * @param {{progress: number}} status - gets how much of it is up
 * @param {AbortSignal} signal - stops it
 * @return {Promise<number>} its file id
 */
async function uploadNextTo(url, file, status, signal) {
	const target = url.slice(0, url.lastIndexOf('/')) + '/.deliver-proxy-' + Math.random().toString(36).slice(2)
	try {
		return await uploadFile({
			request: axios.request,
			file,
			target,
			uploadsUrl: generateRemoteUrl('dav') + '/uploads/' + encodeURIComponent(getCurrentUser()?.uid ?? ''),
			chunkSize: chunkSizeFor(file.size),
			onProgress: (loaded) => {
				status.progress = Math.floor(loaded / Math.max(1, file.size) * 100)
			},
			env: {
				signal,
				online: () => navigator.onLine,
				untilOnline: () => new Promise((resolve) => window.addEventListener('online', resolve, { once: true })),
				sleep: (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000)),
				onPause: () => {},
			},
		})
	} catch (error) {
		axios.delete(target).catch(() => {})
		throw error
	}
}
