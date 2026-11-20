import { describe, expect, it } from 'vitest'
import { channelWeights, loudnessMeter } from './loudness.js'

const RATE = 48000

/**
 * A 1 kHz sine, the same on every channel, of so many seconds at so many dBFS each, as EBU Tech 3341 builds its cases
 *
 * @param {Array<[number, number]>} parts - [seconds, dBFS] each
 * @param {number} channels - how many
 * @param {number} sampleRate - samples a second
 * @return {Float32Array[]} the samples, one array a channel
 */
function tones(parts, channels = 2, sampleRate = RATE) {
	const total = parts.reduce((sum, [seconds]) => sum + Math.round(seconds * sampleRate), 0)
	const samples = new Float32Array(total)
	let at = 0
	for (const [seconds, db] of parts) {
		const amplitude = 10 ** (db / 20)
		for (let i = 0; i < Math.round(seconds * sampleRate); i++, at++) {
			samples[at] = amplitude * Math.sin(2 * Math.PI * 1000 * at / sampleRate)
		}
	}
	return Array.from({ length: channels }, () => samples)
}

/**
 * A test signal for the loudness meter that ffmpeg's ebur128 has measured
 * too: 30 s of noise at 44.1 kHz, its two channels apart, low-passed so it
 * is closer to music than white noise, and louder and softer in turns so
 * the gates have something to do. Deterministic, from a fixed seed.
 *
 * @return {Float32Array[]} left and right
 */
function noise() {
	const rate = 44100
	const length = 30 * rate
	let seed = 12345
	const random = () => {
		seed = (seed * 1103515245 + 12345) % 2147483648
		return seed / 2147483648 * 2 - 1
	}
	return [0, 1].map(() => {
		const samples = new Float32Array(length)
		let low = 0
		for (let i = 0; i < length; i++) {
			low += 0.1 * (random() - low)
			// 3 s loud, 3 s 20 dB softer, and a last stretch near silence
			const gain = i > 27 * rate ? 0.0001 : Math.floor(i / (3 * rate)) % 2 === 0 ? 0.5 : 0.05
			samples[i] = gain * low
		}
		return samples
	})
}

/** Feeds the meter in pieces of a decoder's size */
function measure(channels, sampleRate = RATE, piece = 1024) {
	const meter = loudnessMeter()
	for (let at = 0; at < channels[0].length; at += piece) {
		meter.add(channels.map((samples) => samples.subarray(at, at + piece)), sampleRate)
	}
	return meter.done()
}

describe('integrated loudness after EBU Tech 3341', () => {
	it('reads a stereo sine at −23 dBFS as −23.0 LUFS, and one at −33 as −33.0', () => {
		expect(measure(tones([[20, -23]])).integrated).toBeCloseTo(-23, 1)
		expect(measure(tones([[20, -33]])).integrated).toBeCloseTo(-33, 1)
	})

	it('leaves out what lies 10 LU below the rest (relative gate)', () => {
		expect(measure(tones([[10, -36], [60, -23], [10, -36]])).integrated).toBeCloseTo(-23, 1)
	})

	it('leaves out what lies below −70 LUFS (absolute gate)', () => {
		expect(measure(tones([[10, -72], [10, -36], [60, -23], [10, -36], [10, -72]])).integrated).toBeCloseTo(-23, 1)
	})

	it('averages what passes the gates by its energy', () => {
		expect(measure(tones([[20, -26], [20.1, -20], [20, -26]])).integrated).toBeCloseTo(-23, 1)
	})

	it('reads the same at 44.1 kHz and in pieces of any size', () => {
		expect(measure(tones([[20, -23]], 2, 44100), 44100, 1152).integrated).toBeCloseTo(-23, 1)
	})

	it('has none for silence, and none at all where the sound changes its rate midway or a sample is no number', () => {
		expect(measure([new Float32Array(RATE * 5), new Float32Array(RATE * 5)])).toEqual({ integrated: null, peak: null, truePeak: false })
		const meter = loudnessMeter()
		meter.add(tones([[1, -23]]), RATE)
		meter.add(tones([[1, -23]], 2, 44100), 44100)
		expect(meter.done()).toBeNull()
		const poisoned = tones([[2, -23]])[0].slice()
		poisoned[RATE] = NaN
		expect(measure([poisoned, poisoned])).toBeNull()
	})
})

describe('beside ffmpeg', () => {
	it('reads noise that is loud and soft in turns as ebur128 in ffmpeg does (−20.5 LUFS, sample peak −12.3 dBFS)', () => {
		expect(measure(noise(), 44100, 4096)).toEqual({ integrated: -20.5, peak: -12.3, truePeak: false })
	})
})

describe('a broken decode', () => {
	it('gives no loudness where a number would be past the server\'s ranges, so the Waveform goes in without it', () => {
		// Samples a hundred times full scale: a peak of +40 dB
		const absurd = tones([[5, 40]])
		expect(measure(absurd)).toBeNull()
		// A full-scale square wave is loud, but no nonsense
		const square = Float32Array.from({ length: RATE * 5 }, (_, at) => (Math.floor(at / 24) % 2 === 0 ? 1 : -1))
		expect(measure([square, square])).toMatchObject({ peak: 0, truePeak: false })
	})
})

describe('the sample peak', () => {
	it('is the loudest sample over all channels in dBFS, and says it is no true peak', () => {
		const left = new Float32Array(RATE).fill(0.1)
		const right = new Float32Array(RATE).fill(0.1)
		right[100] = -0.5
		expect(measure([left, right])).toMatchObject({ peak: -6, truePeak: false })
	})
})

describe('5.1 as ffmpeg weights it', () => {
	const surround = (lit) => {
		const [sine] = tones([[10, -23]], 1)
		return Array.from({ length: 6 }, (_, index) => (index === lit ? sine : new Float32Array(sine.length)))
	}

	it('counts a left surround 1.5 dB louder (−24.5 LUFS for −23 dBFS, as ebur128 reads it) and leaves out the LFE', () => {
		expect(measure(surround(4)).integrated).toBeCloseTo(-24.5, 1)
		expect(measure(surround(3)).integrated).toBeNull()
	})
})

describe('the weight of each channel', () => {
	it('is 1, the surrounds of 5.1 and 7.1 1.41, their LFE nothing', () => {
		expect(channelWeights(2)).toEqual([1, 1])
		expect(channelWeights(6)).toEqual([1, 1, 1, 0, 1.41, 1.41])
		expect(channelWeights(8)).toEqual([1, 1, 1, 0, 1.41, 1.41, 1.41, 1.41])
	})
})
