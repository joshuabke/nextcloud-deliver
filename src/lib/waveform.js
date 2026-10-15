/**
 * Waveforms the browser draws where the server has no ffmpeg: it decodes the
 * file once and hands the peaks to the server, for everyone after it.
 */

/** As many peaks as ffmpeg's Waveform has */
export const BUCKETS = 2000

/**
 * @param {Float32Array[]} channels - decoded samples, one array per channel
 * @param {number} buckets - how many peaks at most
 * @return {number[]} the loudest sample of each bucket, 0 to 1, to three places
 */
export function peaksOf(channels, buckets) {
	const length = channels[0]?.length ?? 0
	const perBucket = Math.max(1, Math.ceil(length / buckets))
	const peaks = []
	for (let start = 0; start < length; start += perBucket) {
		let loudest = 0
		for (const samples of channels) {
			for (let at = start; at < Math.min(length, start + perBucket); at++) {
				loudest = Math.max(loudest, Math.abs(samples[at]))
			}
		}
		peaks.push(Math.round(Math.min(1, loudest) * 1000) / 1000)
	}
	return peaks
}

/**
 * Adds decoded samples to the peaks of a file decoded piece by piece; each
 * bucket is an equal share of the duration.
 *
 * @param {Float32Array} peaks - the loudest sample so far of each bucket, changed in place
 * @param {Float32Array[]} channels - one piece of decoded samples, one array per channel
 * @param {number} start - where the piece starts, in seconds
 * @param {number} sampleRate - samples per second
 * @param {number} seconds - the duration of the whole file
 */
export function addPeaks(peaks, channels, start, sampleRate, seconds) {
	const perSecond = peaks.length / seconds
	const length = channels[0]?.length ?? 0
	for (let at = 0; at < length; at++) {
		const bucket = Math.min(peaks.length - 1, Math.max(0, Math.floor((start + at / sampleRate) * perSecond)))
		for (const samples of channels) {
			const level = Math.abs(samples[at])
			if (level > peaks[bucket]) {
				peaks[bucket] = level
			}
		}
	}
}

/**
 * @param {Float32Array} peaks - as addPeaks fills them
 * @return {number[]} the same, capped at full scale and rounded as the server does
 */
export const roundPeaks = (peaks) => Array.from(peaks, (peak) => Math.round(Math.min(1, peak) * 1000) / 1000)

/**
 * Decodes a file for its Waveform. Mediabunny reads it piece by piece and
 * WebCodecs decodes each piece, so only the peaks stay in memory and the
 * progress is known; where the browser lacks that, it is decoded whole.
 *
 * @param {string|Blob} source - the file's URL, read with range requests, or the file itself, as the browser that uploads it holds it
 * @param {(percent: number) => void} onProgress - gets how far it has got
 * @return {Promise<{peaks: number[], seconds: number}>} the Waveform and the duration
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
 * @param {string|Blob} source - as decodeWaveform takes it
 * @param {(percent: number) => void} onProgress - gets how far it has got
 * @return {Promise<{peaks: number[], seconds: number}|null>} the Waveform; null where WebCodecs cannot decode the file
 */
async function streamWaveform(source, onProgress) {
	if (typeof AudioDecoder === 'undefined') {
		return null
	}
	// Loaded only here: most pages never decode a Waveform
	const { ALL_FORMATS, AudioSampleSink, BlobSource, Input, UrlSource } = await import('mediabunny')
	const input = new Input({ formats: ALL_FORMATS, source: typeof source === 'string' ? new UrlSource(source) : new BlobSource(source) })
	try {
		const track = await input.getPrimaryAudioTrack()
		if (!track || !await track.canDecode()) {
			return null
		}
		const seconds = await track.getDurationFromMetadata() ?? await track.computeDuration()
		if (!(seconds > 0)) {
			return null
		}
		const peaks = new Float32Array(BUCKETS)
		let end = 0
		for await (const sample of new AudioSampleSink(track).samples()) {
			try {
				const channels = Array.from({ length: sample.numberOfChannels }, (_, planeIndex) => {
					const samples = new Float32Array(sample.numberOfFrames)
					sample.copyTo(samples, { planeIndex, format: 'f32-planar' })
					return samples
				})
				addPeaks(peaks, channels, sample.timestamp, sample.sampleRate, seconds)
				end = Math.max(end, sample.timestamp + sample.duration)
				onProgress(Math.min(99, Math.floor(end / seconds * 100)))
			} finally {
				sample.close()
			}
		}
		// The duration the decoder reached is exact; the one from the container may be rounded
		return { peaks: roundPeaks(peaks), seconds: end || seconds }
	} finally {
		input.dispose()
	}
}

/**
 * Decodes the whole file at 8 kHz, which is all a Waveform needs and keeps
 * an hour of audio in a few hundred megabytes.
 *
 * @param {string|Blob} source - as decodeWaveform takes it
 * @return {Promise<{peaks: number[], seconds: number}>} the Waveform and the duration
 */
async function decodeWhole(source) {
	const body = typeof source === 'string' ? await fetch(source) : source
	if (body.ok === false) {
		throw new Error(`HTTP ${body.status}`)
	}
	const audio = await new OfflineAudioContext(1, 1, 8000).decodeAudioData(await body.arrayBuffer())
	const channels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index))
	return { peaks: peaksOf(channels, BUCKETS), seconds: audio.duration }
}

/** UploadStatus.FINISHED of @nextcloud/upload 1.x */
const FINISHED = 3

/**
 * An upload of the Files app (its @nextcloud/upload 1.x uploader) whose
 * Waveform the uploading browser may hand in.
 *
 * @param {{status: number, file?: File, response?: {headers?: object}}} upload - as the uploader's notifier gets it
 * @return {number|null} the file id of an uploaded audio file; null for anything else
 */
export function uploadedAudio(upload) {
	// OC-FileId carries the instance id after the number, as in 00000123ocabc123
	const fileId = parseInt(upload.response?.headers?.['oc-fileid'], 10)
	return upload.status === FINISHED && upload.file?.type?.startsWith('audio/') && fileId > 0 ? fileId : null
}
