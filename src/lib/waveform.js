/**
 * Waveforms the browser draws where the server has no ffmpeg: it decodes the
 * file once and hands the peaks to the server, for everyone after it.
 */

/** Peaks a second, as the server has them (ADR 0021); fewer only where a file would go past MAX_PEAKS */
export const RATE = 50
export const MAX_PEAKS = 2_000_000
/** How many peaks the timeline draws of a whole Version, at most */
export const OVERVIEW = 2000

/**
 * @param {number} seconds - the length of the file
 * @return {number} its Waveform's peaks a second, as DerivedMedia::waveformRate has it
 */
export const rateFor = (seconds) => Math.max(1, Math.min(RATE, Math.floor(MAX_PEAKS / Math.max(1, Math.ceil(seconds)))))

/**
 * Collects the peaks of a file decoded piece by piece: peak i is the loudest
 * sample over all channels from i / rate to (i + 1) / rate seconds, so the
 * pieces may come in any size and run past the expected length. A piece
 * whose time is off (past the most peaks a Waveform has, or no number) is
 * left out rather than failing the pass it belongs to.
 *
 * @param {number} rate - peaks a second
 * @param {number} seconds - the expected length, for the first allocation
 * @return {{add: (channels: Float32Array[], start: number, sampleRate: number) => void, done: () => {rate: number, peaks: Uint8Array}}} the collector
 */
export function collectPeaks(rate, seconds) {
	let levels = new Float32Array(Math.max(1, Math.min(MAX_PEAKS, Math.ceil(seconds * rate) || 1)))
	let count = 0
	return {
		add(channels, start, sampleRate) {
			const length = channels[0]?.length ?? 0
			for (let at = 0; at < length; at++) {
				const peak = Math.max(0, Math.floor((start + at / sampleRate) * rate))
				if (!(peak < MAX_PEAKS)) {
					continue
				}
				if (peak >= levels.length) {
					const grown = new Float32Array(Math.min(MAX_PEAKS, Math.max(peak + 1, levels.length * 2)))
					grown.set(levels)
					levels = grown
				}
				count = Math.max(count, peak + 1)
				for (const samples of channels) {
					const level = Math.abs(samples[at])
					if (level > levels[peak]) {
						levels[peak] = level
					}
				}
			}
		},
		// One byte a peak, 255 for full scale, as the server stores them
		done: () => ({ rate, peaks: Uint8Array.from(levels.subarray(0, count), (level) => Math.round(Math.min(1, level) * 255)) }),
	}
}

/**
 * @param {Uint8Array} bytes - peaks as the server stores them
 * @return {string} the same in base64, as the server takes them
 */
export function toBase64(bytes) {
	let binary = ''
	for (let at = 0; at < bytes.length; at += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
	}
	return btoa(binary)
}

/**
 * @param {{rate: number, peaks: string, loudness?: ?{integrated: ?number, peak: ?number}}} json - the Waveform as the server serves it
 * @return {{rate: number, peaks: Uint8Array, loudness: ?{integrated: ?number, peak: ?number}}} its peaks, a byte each, and its loudness where it was measured (ADR 0021)
 */
export function readWaveform(json) {
	const binary = atob(json.peaks)
	return { rate: json.rate, peaks: Uint8Array.from(binary, (char) => char.charCodeAt(0)), loudness: json.loudness ?? null }
}

/**
 * The Waveform of a whole Version in a few buckets, for a timeline that
 * shows all of it: each bucket the loudest of its peaks, and never more
 * buckets than there are peaks.
 *
 * @param {{rate: number, peaks: Uint8Array}} waveform - as readWaveform gives it
 * @param {number} seconds - the length the timeline shows; 0 for that of the peaks
 * @param {number} buckets - how many at most
 * @return {number[]} 0 to 1 each, the first at the start
 */
export function overview({ rate, peaks }, seconds, buckets = OVERVIEW) {
	const total = seconds > 0 ? seconds : peaks.length / rate
	const count = Math.max(1, Math.min(buckets, Math.ceil(total * rate)))
	const per = total * rate / count
	return Array.from({ length: count }, (_, bucket) => {
		const from = Math.floor(bucket * per)
		let loudest = 0
		for (let at = from; at < Math.min(peaks.length, Math.max(from + 1, Math.floor((bucket + 1) * per))); at++) {
			loudest = Math.max(loudest, peaks[at])
		}
		return loudest / 255
	})
}

/**
 * Decodes a file for its Waveform. Mediabunny reads it piece by piece and
 * WebCodecs decodes each piece, so only the peaks stay in memory and the
 * progress is known; where the browser lacks that, it is decoded whole.
 *
 * @param {string|Blob} source - the file's URL, read with range requests, or the file itself, as the browser that uploads it holds it
 * @param {(percent: number) => void} onProgress - gets how far it has got
 * @return {Promise<{rate: number, peaks: Uint8Array, seconds: number}>} the Waveform and the duration
 */
export async function decodeWaveform(source, onProgress = () => {}) {
	try {
		const streamed = await streamWaveform(source, onProgress)
		if (streamed) {
			return streamed
		}
	} catch {
		// A container Mediabunny does not read: the whole file goes to the browser's own decoder
	}
	return decodeWhole(source)
}

/**
 * @param {object} sample - a Mediabunny AudioSample
 * @return {Float32Array[]} its channels
 */
export function channelsOf(sample) {
	return Array.from({ length: sample.numberOfChannels }, (_, planeIndex) => {
		const samples = new Float32Array(sample.numberOfFrames)
		sample.copyTo(samples, { planeIndex, format: 'f32-planar' })
		return samples
	})
}

/**
 * @param {string|Blob} source - as decodeWaveform takes it
 * @param {(percent: number) => void} onProgress - gets how far it has got
 * @return {Promise<{rate: number, peaks: Uint8Array, seconds: number}|null>} the Waveform; null where WebCodecs cannot decode the file
 */
async function streamWaveform(source, onProgress) {
	if (typeof AudioDecoder === 'undefined') {
		return null
	}
	// Loaded only here: most pages never decode a Waveform
	const { ALL_FORMATS, AudioSampleSink, BlobSource, Input, UrlSource } = await import('mediabunny')
	const input = new Input({ formats: ALL_FORMATS, source: typeof source === 'string' ? new UrlSource(source) : new BlobSource(source) })
	/** The meter in its worker, ended whatever becomes of the decode */
	let meter = null
	try {
		const track = await input.getPrimaryAudioTrack()
		if (!track || !await track.canDecode()) {
			return null
		}
		const seconds = await track.getDurationFromMetadata() ?? await track.computeDuration()
		if (!(seconds > 0)) {
			return null
		}
		const peaks = collectPeaks(rateFor(seconds), seconds)
		// The loudness in a worker, beside the decode (A10)
		const { meterOffPage } = await import('./meterOffPage.js')
		meter = meterOffPage()
		let end = 0
		for await (const sample of new AudioSampleSink(track).samples()) {
			try {
				const channels = channelsOf(sample)
				peaks.add(channels, sample.timestamp, sample.sampleRate)
				await meter.add(channels, sample.sampleRate)
				end = Math.max(end, sample.timestamp + sample.duration)
				onProgress(Math.min(99, Math.floor(end / seconds * 100)))
			} finally {
				sample.close()
			}
		}
		// The duration the decoder reached is exact; the one from the container may be rounded
		return { ...peaks.done(), loudness: await meter.done(), seconds: end || seconds }
	} finally {
		meter?.close()
		input.dispose()
	}
}

/**
 * Decodes the whole file at 8 kHz, which is all a Waveform needs and keeps
 * an hour of audio in a few hundred megabytes.
 *
 * @param {string|Blob} source - as decodeWaveform takes it
 * @return {Promise<{rate: number, peaks: Uint8Array, seconds: number}>} the Waveform and the duration
 */
async function decodeWhole(source) {
	const body = typeof source === 'string' ? await fetch(source) : source
	if (body.ok === false) {
		throw new Error(`HTTP ${body.status}`)
	}
	const audio = await new OfflineAudioContext(1, 1, 8000).decodeAudioData(await body.arrayBuffer())
	const peaks = collectPeaks(rateFor(audio.duration), audio.duration)
	peaks.add(Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index)), 0, audio.sampleRate)
	// Resampled to 8 kHz, its loudness would be off: none
	return { ...peaks.done(), loudness: null, seconds: audio.duration }
}

/** UploadStatus.FINISHED of @nextcloud/upload 1.x */
const FINISHED = 3

/**
 * An upload of the Files app (its @nextcloud/upload 1.x uploader) whose
 * Waveform or Proxy the uploading browser may hand in.
 *
 * @param {{status: number, file?: File, response?: {headers?: object}}} upload - as the uploader's notifier gets it
 * @param {string} kind - audio or video
 * @return {number|null} the file id of an uploaded file of that kind; null for anything else
 */
export function uploaded(upload, kind) {
	// OC-FileId carries the instance id after the number, as in 00000123ocabc123
	const fileId = parseInt(upload.response?.headers?.['oc-fileid'], 10)
	return upload.status === FINISHED && upload.file?.type?.startsWith(kind + '/') && fileId > 0 ? fileId : null
}

/**
 * @param {object} version - a Version as the API describes it
 * @return {Promise<?{rate: number, peaks: Uint8Array}>} its Waveform, or null while it has none ready or it cannot be read
 */
export async function fetchWaveform(version) {
	const derived = version.derived?.waveform
	if (derived?.state !== 'ready') {
		return null
	}
	try {
		return readWaveform(await (await fetch(derived.url)).json())
	} catch {
		return null
	}
}
