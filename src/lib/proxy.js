/**
 * The Proxy the uploading browser makes where the server has no ffmpeg
 * (ADR 0019): Mediabunny decodes the original (ProRes with its WASM decoder),
 * the browser's own encoder makes H.264, and the file grows in the browser's
 * private file system (OPFS), so neither the original nor the Proxy has to
 * fit into memory. The rules come from proxyPlan.js.
 */
import axios from '@nextcloud/axios'
import { chunkSizeFor, errorMessage, getVersion, giveProxy, giveScrub, giveThumbs, giveWaveform, reportProxy, uploadsUrl } from '../api.js'
import { t } from './l10n.js'
import { AUDIO_BITRATE, fits, heavy, lowerTarget, needsProxy, plays, proxyBytes, proxySize, SCRUB_BITRATE, scrubFits, scrubSize, THUMB_WIDTH, thumbGrid, thumbSlot, videoBitrate, whyNot } from './proxyPlan.js'
import { unsupported } from './unsupported.js'
import { browserEnv, uploadFile } from './upload.js'
import { advance } from './uploadStatus.js'
import { addPeaks, BUCKETS, channelsOf, roundPeaks } from './waveform.js'

/** Deliver's folder in the browser's private file system */
const FOLDER = 'deliver-proxies'
/** Each file there is held under a Web Lock of this name and its own until it is handed in, in whichever tab, so clearing passes it by */
const LOCK = 'deliver-proxy:'
/** Seconds between two reports of a Proxy's progress; the server takes a browser silent for two minutes as gone */
const REPORT = 5

/** Thrown when the browser has no room for the Proxy; `missing` says how many bytes */
class NoRoomError extends Error {
	constructor(missing) {
		super('No room for the Proxy')
		this.missing = missing
	}
}

/** Thrown when even the second go came out above the Proxy bitrate threshold; `max` is the threshold in Mbit/s */
export class TooHeavyError extends Error {
	constructor(max) {
		super('The Proxy is above the Proxy bitrate threshold')
		this.max = max
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
 * @return {Promise<{readable: boolean, playable: boolean, convertible: boolean, scrubbable: boolean, needsProxy: boolean, reason: ?string, codec: ?string}>}
 *   whether Mediabunny reads it at all, whether browsers play it as it is, whether this browser can make its Proxy
 *   (it decodes the first picture and sound, encodes H.264, and the server reads the container's Frames) and its
 *   Scrub Proxy (the same at 320 wide), whether it gets a Proxy, and what stands in the way: `reason` is 'codec' (this
 *   browser cannot decode `codec`, others may), 'format' (no browser can help) or 'encoder' (this browser has no H.264
 *   encoder for the Proxy)
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
		const decodes = reason === null || reason === 'encoder'
		return {
			readable: true,
			playable,
			convertible: reason === null,
			scrubbable: decodes && await canEncodeVideo('avc', { ...scrubSize({ width: video.displayWidth, height: video.displayHeight }), bitrate: SCRUB_BITRATE }),
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
 * @return {Promise<number>} the bytes free beyond it
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
	return room - bytes
}

/**
 * A file of its own in the private file system, held under a Web Lock
 * until done(), so no tab clears it while this one still needs it
 *
 * @return {Promise<{writable: () => Promise<FileSystemWritableFileStream>, file: () => Promise<File>, done: () => Promise<void>}>} it
 */
async function scratch() {
	const name = `proxy-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`
	let release
	await new Promise((resolve) => {
		navigator.locks.request(LOCK + name, () => new Promise((free) => {
			release = free
			resolve()
		}))
	})
	const dir = await folder()
	return {
		writable: async () => (await dir.getFileHandle(name, { create: true })).createWritable(),
		file: async () => (await dir.getFileHandle(name)).getFile(),
		done: async () => {
			await dir.removeEntry(name).catch(() => {})
			release()
		},
	}
}

/**
 * The Scrub Proxy (#169), from the pictures of the pass: each is drawn at
 * 320 wide into a canvas of its own before it reaches this second encoder,
 * so no full-size picture waits in it.
 *
 * @param {{width: number, height: number}} size - the Scrub Proxy's
 * @param {number} frames - the original's Frames
 * @param {number} seconds - their length
 * @return {Promise<{add: (sample: object, time: number) => Promise<void>, finish: () => Promise<File>, drop: () => Promise<void>, done: () => Promise<void>}>} it
 */
async function scrubber(size, frames, seconds) {
	const { CanvasSource, Mp4OutputFormat, Output, StreamTarget } = await mediabunny()
	const file = await scratch()
	const writable = await file.writable()
	const context = new OffscreenCanvas(size.width, size.height).getContext('2d', { alpha: false })
	const source = new CanvasSource(context.canvas, { codec: 'avc', bitrate: SCRUB_BITRATE, keyFrameInterval: 1 })
	const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'reserve' }), target: new StreamTarget(writable, { chunked: true }) })
	// At the original's rate, which snaps every timestamp to a Frame, with room for the index of every one
	output.addVideoTrack(source, { frameRate: frames / seconds, maximumPacketCount: Math.ceil(frames * 1.34) + 16 })
	await output.start()
	return {
		add: async (sample, time) => {
			sample.draw(context, 0, 0, size.width, size.height)
			await source.add(time, sample.duration)
		},
		finish: async () => {
			await output.finalize()
			return file.file()
		},
		drop: async () => {
			await output.cancel().catch(() => {})
			await writable.abort?.().catch(() => {})
			await file.done()
		},
		done: file.done,
	}
}

/**
 * One pass over a file (#168): its pictures and sound are decoded once, and
 * from them come what `want` asks for. The Proxy goes one picture after
 * another into a file of the private file system and is checked as the
 * server will: as many Frames as the original, at its rate. The Thumbnail
 * Strip and the Waveform are drawn in the server's shapes, and the Scrub
 * Proxy is encoded beside it; without a Proxy the pictures and the sound are
 * only decoded for them. A Thumbnail Strip or Scrub Proxy that fails never
 * fails the Proxy.
 *
 * @param {Blob|string} source - the file, or its URL: the original, or a Proxy for what the Version lacks besides
 * @param {object} settings - the server's
 * @param {number} settings.maxHeight - the Proxy resolution
 * @param {number} settings.maxBitrate - the Proxy bitrate threshold in Mbit/s
 * @param {number} settings.thumbCap - the Thumbnail Strip cap
 * @param {{proxy: boolean, thumbs: boolean, waveform: boolean, scrub: boolean}} want - what to make, from passOf
 * @param {(percent: number) => void} onProgress - how far it is, 0 to 99
 * @param {AbortSignal} signal - stops it
 * @param {number} [target] - the picture's bitrate in bit/s, for the second go after the first came out above the threshold
 * @return {Promise<{file: ?File, scrub: ?File, done: () => Promise<void>, frames: number, seconds: number, bitrate: number, thumbs: ?{image: Blob, every: number, count: number}, peaks: ?number[]}>}
 *   the Proxy and the Scrub Proxy (null where not made), what deletes them once handed in, the Frames of the original, its
 *   Thumbnail Strip (WebP, JPEG where the browser encodes no WebP) and its Waveform (null without sound)
 */
async function convert(source, { maxHeight, maxBitrate, thumbCap }, want, onProgress, signal, target) {
	const { AudioSampleSink, Conversion, Mp4OutputFormat, Output, StreamTarget, VideoSampleSink } = await mediabunny()
	const proxy = want.proxy ? await scratch() : null
	let scrub = null
	const done = async () => {
		await proxy?.done()
		await scrub?.done()
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
		const bitrate = target ?? videoBitrate(size, maxBitrate)
		const free = await makeRoom(want.proxy ? proxyBytes(seconds, bitrate) : 0)
		const grid = thumbGrid(seconds, thumbCap, size)
		// The Thumbnail Strip never costs the Proxy: none where the browser encodes neither WebP nor JPEG, or has no canvas that large
		const stripType = want.thumbs ? await stripImageType() : null
		let strip = stripType ? stripCanvas(grid) : null
		let drawn = -1
		// Nor does the Scrub Proxy, which needs no more than a few MB an hour
		if (want.scrub && free > proxyBytes(seconds, SCRUB_BITRATE)) {
			scrub = await scrubber(scrubSize({ width: video.displayWidth, height: video.displayHeight }), frames, seconds).catch(() => null)
		}
		const peaks = new Float32Array(BUCKETS)
		let heard = false
		let first = null
		signal.throwIfAborted()

		/** @param {object} sample - a picture, which goes into the Thumbnail Strip and the Scrub Proxy */
		const see = async (sample) => {
			first ??= sample.timestamp
			const time = sample.timestamp - first
			const slot = thumbSlot(grid, time)
			if (strip && slot !== null && slot >= drawn) {
				drawn = slot
				try {
					sample.draw(strip, (slot % grid.columns) * THUMB_WIDTH, Math.floor(slot / grid.columns) * grid.tileHeight, THUMB_WIDTH, grid.tileHeight)
				} catch {
					strip = null
				}
			}
			try {
				await scrub?.add(sample, time)
			} catch {
				await scrub.drop()
				scrub = null
			}
			return time
		}
		/** @param {object} sample - sound, which goes into the Waveform */
		const hear = (sample) => {
			if (want.waveform) {
				addPeaks(peaks, channelsOf(sample), sample.timestamp, sample.sampleRate, seconds)
				heard = true
			}
		}

		if (proxy) {
			const writable = await proxy.writable()
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
					// The picture, already at the Proxy's size, also goes into the Thumbnail Strip and the Scrub Proxy
					process: async (sample) => {
						await see(sample)
						return sample
					},
				},
				audio: {
					codec: 'aac',
					bitrate: AUDIO_BITRATE,
					process: (sample) => {
						hear(sample)
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
		} else {
			// Without a Proxy the pictures and the sound are decoded side by side, each let go of once seen
			const audio = want.waveform ? await input.getPrimaryAudioTrack() : null
			await Promise.all([
				(async () => {
					for await (const sample of new VideoSampleSink(video).samples()) {
						try {
							signal.throwIfAborted()
							onProgress(Math.min(99, Math.floor(await see(sample) / seconds * 100)))
						} finally {
							sample.close()
						}
					}
				})(),
				audio && (async () => {
					for await (const sample of new AudioSampleSink(audio).samples()) {
						try {
							signal.throwIfAborted()
							hear(sample)
						} finally {
							sample.close()
						}
					}
				})(),
			])
		}

		const file = proxy && await proxy.file()
		if (file) {
			await check(file, { frames, seconds })
		}
		const image = strip && drawn >= 0 ? await strip.canvas.convertToBlob({ type: stripType, quality: stripType === 'image/webp' ? 0.75 : 0.8 }).catch(() => null) : null
		// One the server would refuse is not uploaded
		const scrubbed = scrub && await scrub.finish().then(async (made) => {
			await check(made, { frames, seconds })
			return scrubFits(made.size, seconds) ? made : null
		}).catch(() => null)
		return {
			file,
			scrub: scrubbed,
			done,
			frames,
			seconds,
			bitrate,
			thumbs: image?.type === stripType ? { image, every: grid.every, count: grid.count } : null,
			peaks: heard ? roundPeaks(peaks) : null,
		}
	} catch (error) {
		await scrub?.drop()
		await proxy?.done()
		throw error
	} finally {
		input.dispose()
	}
}

/**
 * Makes what a file lacks in one pass; where that makes a Proxy, once more
 * at a lower bitrate when it comes out above the Proxy bitrate threshold:
 * the encoder only aims at its bitrate, and the server refuses a Proxy above
 * it. The first go is let go of (input, strip canvas, peaks, Scrub Proxy)
 * before the second starts.
 *
 * @param {Blob|string} source - the file, or its URL
 * @param {object} settings - the server's, see convert()
 * @param {object} want - what to make, see convert()
 * @param {(percent: number) => void} onProgress - how far it is, 0 to 99
 * @param {AbortSignal} signal - stops it
 * @return {Promise<object>} as convert()
 * @throws {TooHeavyError} when the second go is above the threshold as well
 */
async function makePass(source, settings, want, onProgress, signal) {
	// Its own scope, so nothing of the first go outlives it
	const first = await (async () => {
		const made = await convert(source, settings, want, onProgress, signal)
		if (!made.file || !heavy(made.file.size, made.seconds, settings.maxBitrate)) {
			return { made }
		}
		const target = lowerTarget(made.bitrate, made.file.size, made.seconds, settings.maxBitrate)
		await made.done()
		return { target }
	})()
	if (first.made) {
		return first.made
	}
	const again = await convert(source, settings, want, onProgress, signal, first.target)
	if (heavy(again.file.size, again.seconds, settings.maxBitrate)) {
		await again.done()
		throw new TooHeavyError(settings.maxBitrate)
	}
	return again
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
 * @param {File} file - the Proxy or the Captions
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
 * Makes one pass after the other in this tab, so two masters do not fight
 * over the decoder, the encoder and the disk.
 *
 * @param {Blob|string} source - the file, or its URL
 * @param {{maxHeight: number, maxBitrate: number, thumbCap: number}} settings - the server's Proxy resolution, threshold and Thumbnail Strip cap
 * @param {{proxy: boolean, thumbs: boolean, waveform: boolean, scrub: boolean}} want - what to make, from passOf
 * @param {{state: string, progress: number, error: ?string, since?: number, proxy?: boolean}} status - kept up to date: running (since: when the pass that is running began), then failed if it does; proxy: whether it makes a Proxy
 * @param {AbortSignal} signal - stops it
 * @return {Promise<?object>} what convert() returns, null when it failed or was stopped
 */
export function convertInTurn(source, settings, want, status, signal) {
	Object.assign(status, { state: 'running', progress: 0, error: null, proxy: want.proxy })
	const turn = converting.then(() => signal.aborted
		? Promise.reject(new Error('cancelled'))
		: makePass(source, settings, want, (progress) => advance(status, progress), signal))
	converting = turn.catch(() => {})
	return turn.catch((error) => {
		Object.assign(status, {
			state: 'failed',
			error: error instanceof NoRoomError
				? t('deliver', 'This browser has no room for the Proxy: {size} MB more are needed on this computer.', { size: Math.ceil(error.missing / 1e6) })
				: error instanceof TooHeavyError
					? t('deliver', 'The Proxy came out above the Proxy bitrate threshold of {max} Mbit/s, even at a lower bitrate.', { max: error.max })
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
 * Hands in what a pass of this browser made, the same way for an upload in
 * Deliver, one in the Files app and the action on the Asset card (ADR 0019,
 * #168). A pass with a Proxy reports its progress while the Proxy is made
 * and uploaded, uploads it next to the Version's file and hands it in; then,
 * whatever became of the Proxy, the Thumbnail Strip, the Waveform and the
 * Scrub Proxy go in, which the server refuses where it has its own. Only a
 * Member with Manage on the Version hands in; for anyone else the pass is
 * stopped.
 *
 * @param {number} versionId - the Version
 * @param {Promise<?object>} making - from convertInTurn
 * @param {{state: string, progress: number, error: ?string, proxy: boolean}} status - its, as convertInTurn keeps it, then uploading, handing, ready, failed or stopped
 * @param {AbortController} controller - stops the pass
 * @return {Promise<boolean>} false when this Member may not hand it in
 */
export async function handInPass(versionId, making, status, controller) {
	const context = await getVersion(versionId).catch(() => null)
	const url = context?.versions.find((each) => each.id === versionId)?.url
	if (!context?.manages || !url) {
		dropProxy(making, status, controller)
		return false
	}
	// Also while the Proxy uploads, which takes minutes for a long one: silent for two minutes, the server takes this tab as gone
	let reported = Promise.resolve()
	const report = () => {
		if (status.proxy && ['running', 'uploading'].includes(status.state)) {
			reported = reportProxy(versionId, status.state === 'running' ? status.progress : 99).catch((error) => {
				// A Proxy came by hand meanwhile, or ffmpeg makes one: this one is not wanted any more (ADR 0020)
				if (error.response?.status === 409 && status.state === 'running') {
					dropProxy(making, status, controller)
				}
			})
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
			for (let attempt = 0; made.file; attempt++) {
				Object.assign(status, { state: 'uploading', progress: 0 })
				const fileId = await uploadNextTo(url, made.file, status, controller.signal)
				// No report may land while the server takes it: it would mark the Proxy as running again
				status.state = 'handing'
				await reported
				try {
					await giveProxy(versionId, fileId, true)
					break
				} catch (error) {
					if (error.response?.status !== 409 || attempt >= 12 || !/not read yet/.test(errorMessage(error) ?? '')) {
						throw error
					}
					await new Promise((resolve) => setTimeout(resolve, 5000))
				}
			}
			status.state = 'handing'
		} catch (error) {
			// A Proxy by hand, or ffmpeg, came first while this one went up: taken over, not failed (ADR 0020)
			Object.assign(status, error.response?.status === 409 ? { state: 'stopped', error: null } : { state: 'failed', error: error.response ? errorMessage(error) : null })
		}
		try {
			// Whatever became of the Proxy: the server refuses them where it has its own, or makes them
			await Promise.all([
				made.thumbs && giveThumbs(versionId, made.thumbs.image, made.thumbs.every, made.thumbs.count).catch(() => {}),
				made.peaks && giveWaveform(versionId, made.peaks, made.frames).catch(() => {}),
				made.scrub && uploadNextTo(url, made.scrub, {}, controller.signal, '.deliver-scrub-').then((fileId) => giveScrub(versionId, fileId)).catch(() => {}),
			])
		} finally {
			await made.done()
		}
		if (status.state === 'handing') {
			Object.assign(status, { state: 'ready', progress: 100 })
		}
	} finally {
		clearInterval(beat)
	}
	return true
}

/**
 * Hands in a Proxy made by hand (ADR 0020): uploaded next to the Version's
 * file like the browser's, then checked by the server, which says why when
 * it refuses it.
 *
 * @param {number} versionId - the Version
 * @param {string} url - the WebDAV URL of its file
 * @param {File} file - the Proxy
 * @param {{state: string, progress: number}} status - uploading, then handing
 * @return {Promise<void>}
 */
export async function uploadProxy(versionId, url, file, status) {
	Object.assign(status, { state: 'uploading', progress: 0 })
	const fileId = await uploadNextTo(url, file, status, new AbortController().signal)
	status.state = 'handing'
	await giveProxy(versionId, fileId)
}

/**
 * Uploads a Proxy, or Captions, next to the Version's file, under a name
 * without a media extension so that Auto Intake passes it by; deleted again
 * when it does not arrive.
 *
 * @param {string} url - the WebDAV URL of the Version's file
 * @param {File} file - the Proxy or the Captions
 * @param {{progress: number}} status - gets how much of it is up
 * @param {AbortSignal} signal - stops it
 * @param {string} prefix - the hidden name it goes up under, a random part after it
 * @return {Promise<number>} its file id
 */
export async function uploadNextTo(url, file, status, signal, prefix = '.deliver-proxy-') {
	const target = url.slice(0, url.lastIndexOf('/')) + '/' + prefix + Math.random().toString(36).slice(2)
	try {
		return await uploadFile({
			request: axios.request,
			file,
			target,
			uploadsUrl: uploadsUrl(),
			chunkSize: chunkSizeFor(file.size),
			onProgress: (loaded) => {
				status.progress = Math.floor(loaded / Math.max(1, file.size) * 100)
			},
			env: browserEnv(signal),
		})
	} catch (error) {
		axios.delete(target).catch(() => {})
		throw error
	}
}
