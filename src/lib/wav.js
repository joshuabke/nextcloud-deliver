/**
 * A WAV's samples, read piece by piece from the file the uploading browser
 * holds, for its loudness where the server has no ffmpeg (decision A9): the
 * server reads its peaks, nobody its loudness. Never the whole file in
 * memory, as a WAV can be gigabytes.
 */

import { loudnessMeter } from './loudness.js'
import { breather } from './waveform.js'

/** Frames a piece */
const FRAMES = 65536
/** Above any PCM a recorder writes, as the server's reader has it */
const MOST_RATE = 768000

/**
 * @param {Blob} blob - the file
 * @param {number} at - where to read
 * @param {number} length - how many bytes
 * @return {Promise<DataView>} them
 */
async function read(blob, at, length) {
	return new DataView(await blob.slice(at, at + length).arrayBuffer())
}

/**
 * Where a WAV's PCM lies and how it is laid out, for the formats the
 * server's reader takes: integer PCM of 8, 16, 24 or 32 bits and float PCM of
 * 32 or 64 bits, WAVE_FORMAT_EXTENSIBLE too
 *
 * @param {Blob} blob - the file
 * @return {Promise<?{channels: number, sampleRate: number, bits: number, float: boolean, start: number, length: number}>} null for anything else
 */
export async function wavFormat(blob) {
	if (blob.size < 12) {
		return null
	}
	const head = await read(blob, 0, 12)
	const tag = (view, at) => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3))
	if (tag(head, 0) !== 'RIFF' || tag(head, 8) !== 'WAVE') {
		return null
	}
	let format = null
	for (let at = 12; at + 8 <= blob.size;) {
		const chunk = await read(blob, at, 8)
		const id = tag(chunk, 0)
		const size = chunk.getUint32(4, true)
		if (id === 'fmt ' && size >= 16) {
			const fmt = await read(blob, at + 8, Math.min(size, 40))
			const code = fmt.getUint16(0, true) === 0xFFFE && size >= 26 ? fmt.getUint16(24, true) : fmt.getUint16(0, true)
			format = {
				code,
				channels: fmt.getUint16(2, true),
				sampleRate: fmt.getUint32(4, true),
				block: fmt.getUint16(12, true),
				bits: fmt.getUint16(14, true),
			}
		} else if (id === 'data') {
			if (format === null) {
				return null
			}
			const { code, channels, sampleRate, block, bits } = format
			const integer = code === 1 && [8, 16, 24, 32].includes(bits)
			const float = code === 3 && [32, 64].includes(bits)
			// A header that says nonsense is not read, as on the server
			if (!(integer || float) || channels < 1 || sampleRate < 1 || sampleRate > MOST_RATE || block !== channels * bits / 8) {
				return null
			}
			return { channels, sampleRate, bits, float, start: at + 8, length: Math.min(size, blob.size - at - 8) - Math.min(size, blob.size - at - 8) % block }
		}
		at += 8 + size + (size % 2)
	}
	return null
}

/**
 * The samples of a WAV as the meters take them, a piece at a time
 *
 * @param {Blob} blob - the file
 * @param {{channels: number, sampleRate: number, bits: number, float: boolean, start: number, length: number}} format - as wavFormat found it
 * @yields {Float32Array[]} one array a channel, from −1 to 1
 */
export async function* wavPieces(blob, { channels, bits, float, start, length }) {
	const width = bits / 8
	const block = channels * width
	const scale = bits === 8 ? 128 : 2 ** (bits - 1)
	for (let at = 0; at < length; at += FRAMES * block) {
		const view = await read(blob, start + at, Math.min(FRAMES * block, length - at))
		const frames = Math.floor(view.byteLength / block)
		const planes = Array.from({ length: channels }, () => new Float32Array(frames))
		for (let f = 0; f < frames; f++) {
			for (let c = 0; c < channels; c++) {
				const o = f * block + c * width
				let value
				if (float) {
					value = bits === 32 ? view.getFloat32(o, true) : view.getFloat64(o, true)
				} else if (bits === 8) {
					value = (view.getUint8(o) - 128) / scale
				} else if (bits === 16) {
					value = view.getInt16(o, true) / scale
				} else if (bits === 24) {
					value = ((view.getInt8(o + 2) << 16) | (view.getUint8(o + 1) << 8) | view.getUint8(o)) / scale
				} else {
					value = view.getInt32(o, true) / scale
				}
				planes[c][f] = value
			}
		}
		yield planes
	}
}

/**
 * The integrated loudness and true peak of a WAV, read from the file piece
 * by piece (A9)
 *
 * @param {Blob} blob - the file
 * @return {Promise<?{integrated: ?number, peak: ?number, truePeak: boolean}>} null for a WAV of another kind, or one measured as nonsense
 */
export async function wavLoudness(blob) {
	const format = await wavFormat(blob)
	if (format === null) {
		return null
	}
	const meter = loudnessMeter()
	const pause = breather()
	for await (const planes of wavPieces(blob, format)) {
		meter.add(planes, format.sampleRate)
		await pause()
	}
	return meter.done()
}
