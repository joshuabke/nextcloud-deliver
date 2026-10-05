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
 * Decodes the file at 8 kHz, which is all a Waveform needs and keeps an hour
 * of audio in a few hundred megabytes.
 *
 * @param {string|Blob} source - the file's URL, or the file itself, as the browser that uploaded it still holds it
 * @return {Promise<{peaks: number[], seconds: number}>} the Waveform and the duration
 */
export async function decodeWaveform(source) {
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
