import { describe, expect, it } from 'vitest'
import { wavFormat, wavLoudness, wavPieces } from './wav.js'

/**
 * A WAV as a Blob, its samples written as the format says
 *
 * @param {object} options - the format
 * @param {number[][]} frames - one array of values from −1 to 1 a frame, one value a channel
 * @return {Blob} the file
 */
function wav({ code = 1, bits = 16, sampleRate = 48000, extensible = false, before = [], dataSize = null, claimedBits = bits }, frames) {
	const channels = frames[0]?.length ?? 2
	const width = bits / 8
	const data = new DataView(new ArrayBuffer(frames.length * channels * width))
	frames.forEach((frame, f) => frame.forEach((value, c) => {
		const at = (f * channels + c) * width
		if (code === 3) {
			bits === 32 ? data.setFloat32(at, value, true) : data.setFloat64(at, value, true)
		} else if (bits === 8) {
			data.setUint8(at, Math.round(value * 127) + 128)
		} else if (bits === 16) {
			data.setInt16(at, Math.round(value * 32767), true)
		} else if (bits === 24) {
			const v = Math.round(value * 8388607)
			data.setUint8(at, v & 0xFF)
			data.setUint8(at + 1, (v >> 8) & 0xFF)
			data.setInt8(at + 2, v >> 16)
		} else {
			data.setInt32(at, Math.round(value * 2147483647), true)
		}
	}))
	const fmt = new DataView(new ArrayBuffer(extensible ? 40 : 16))
	fmt.setUint16(0, extensible ? 0xFFFE : code, true)
	fmt.setUint16(2, channels, true)
	fmt.setUint32(4, sampleRate, true)
	fmt.setUint32(8, sampleRate * channels * width, true)
	fmt.setUint16(12, channels * width, true)
	fmt.setUint16(14, claimedBits, true)
	if (extensible) {
		fmt.setUint16(16, 22, true)
		fmt.setUint16(24, code, true)
	}
	const chunk = (id, body) => {
		const head = new DataView(new ArrayBuffer(8))
		;[...id].forEach((char, i) => head.setUint8(i, char.charCodeAt(0)))
		head.setUint32(4, id === 'data' && dataSize !== null ? dataSize : body.byteLength, true)
		return body.byteLength % 2 ? [head, body, new Uint8Array(1)] : [head, body]
	}
	const parts = [...before.flatMap(([id, body]) => chunk(id, body)), ...chunk('fmt ', fmt), ...chunk('data', data)]
	const riff = new DataView(new ArrayBuffer(12))
	;['R', 'I', 'F', 'F'].forEach((char, i) => riff.setUint8(i, char.charCodeAt(0)))
	;['W', 'A', 'V', 'E'].forEach((char, i) => riff.setUint8(8 + i, char.charCodeAt(0)))
	return new Blob([riff, ...parts])
}

const ramp = Array.from({ length: 10 }, (_, i) => [i / 10, -i / 10])

async function samples(blob) {
	const format = await wavFormat(blob)
	const read = []
	for await (const planes of wavPieces(blob, format)) {
		read.push(planes)
	}
	return { format, read }
}

describe('a WAV read piece by piece', () => {
	it.each([
		['8-bit', { bits: 8 }, 1 / 64],
		['16-bit', { bits: 16 }, 1e-4],
		['24-bit', { bits: 24 }, 1e-6],
		['32-bit', { bits: 32 }, 1e-7],
		['32-bit float', { code: 3, bits: 32 }, 1e-7],
		['64-bit float', { code: 3, bits: 64 }, 1e-7],
		['24-bit extensible', { bits: 24, extensible: true }, 1e-6],
	])('reads %s PCM as the server does', async (_, options, tolerance) => {
		const { format, read } = await samples(wav(options, ramp))
		expect(format).toMatchObject({ channels: 2, sampleRate: 48000 })
		expect(read).toHaveLength(1)
		ramp.forEach(([left, right], f) => {
			expect(Math.abs(read[0][0][f] - left)).toBeLessThanOrEqual(tolerance)
			expect(Math.abs(read[0][1][f] - right)).toBeLessThanOrEqual(tolerance)
		})
	})

	it('finds its data past other chunks, an odd one padded', async () => {
		const { read } = await samples(wav({ before: [['LIST', new Uint8Array(5)], ['bext', new Uint8Array(602)]] }, ramp))
		expect(read[0][0]).toHaveLength(10)
	})

	it('reads no further than the file where the header claims more', async () => {
		const { read } = await samples(wav({ dataSize: 0xFFFFFFFF }, ramp))
		expect(read[0][0]).toHaveLength(10)
	})

	it('hands it out in pieces, never the whole file at once', async () => {
		const long = Array.from({ length: 150000 }, () => [0.25, -0.25])
		const { read } = await samples(wav({}, long))
		expect(read.map((planes) => planes[0].length)).toEqual([65536, 65536, 18928])
	})

	it.each([
		['a-law', { code: 6, bits: 8 }],
		['12-bit', { bits: 16, claimedBits: 12 }],
		['a sample rate past any recorder', { sampleRate: 1_000_000 }],
	])('leaves out %s, as the server does', async (_, options) => {
		expect(await wavFormat(wav(options, ramp))).toBeNull()
	})

	it('leaves out what is no WAV', async () => {
		expect(await wavFormat(new Blob(['ID3 not a wav at all']))).toBeNull()
	})
})

describe('the loudness of a WAV', () => {
	it('reads a stereo sine at −23 dBFS as −23.0 LUFS with its true peak', async () => {
		const amplitude = 10 ** (-23 / 20)
		const frames = Array.from({ length: 48000 * 10 }, (_, n) => {
			const value = amplitude * Math.sin(2 * Math.PI * 1000 * n / 48000)
			return [value, value]
		})
		const measured = await wavLoudness(wav({ bits: 24 }, frames))
		expect(measured.integrated).toBeCloseTo(-23, 1)
		expect(measured.peak).toBeCloseTo(-23, 0)
		expect(measured.truePeak).toBe(true)
	})

	it('has none for a WAV of another kind', async () => {
		expect(await wavLoudness(wav({ code: 6, bits: 8 }, ramp))).toBeNull()
	})
})
