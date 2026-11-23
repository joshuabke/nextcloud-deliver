import { describe, expect, it } from 'vitest'
import { channelWeights, loudnessMeter, truePeakOf, withinRanges } from './loudness.js'

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
		expect(measure([new Float32Array(RATE * 5), new Float32Array(RATE * 5)])).toEqual({ integrated: null, peak: null })
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
	it('reads noise that is loud and soft in turns as ebur128 in ffmpeg does (−20.5 LUFS, true peak −12.2 dBTP)', () => {
		expect(measure(noise(), 44100, 4096)).toEqual({ integrated: -20.5, peak: -12.2 })
	})
})

describe('a broken decode', () => {
	it('gives no loudness where a number would be past the server\'s ranges, so the Waveform goes in without it', () => {
		// Samples a hundred times full scale: a peak of +40 dB
		const absurd = tones([[5, 40]])
		expect(measure(absurd)).toBeNull()
		// A full-scale square wave is loud, but no nonsense
		const square = Float32Array.from({ length: RATE * 5 }, (_, at) => (Math.floor(at / 24) % 2 === 0 ? 1 : -1))
		expect(measure([square, square])).toMatchObject({ peak: expect.any(Number) })
	})

	it('keeps the ends of the server\'s ranges and nothing past them', () => {
		expect(withinRanges({ integrated: 15.0, peak: 12.0 })).toBe(true)
		expect(withinRanges({ integrated: -70.0, peak: -200.0 })).toBe(true)
		expect(withinRanges({ integrated: null, peak: null })).toBe(true)
		expect(withinRanges({ integrated: 15.1, peak: 0 })).toBe(false)
		expect(withinRanges({ integrated: -23, peak: 12.1 })).toBe(false)
		expect(withinRanges({ integrated: -23, peak: -200.1 })).toBe(false)
	})
})

describe('the true peak after BS.1770-4 Annex 2', () => {
	/** A sine at a quarter of the sample rate, its samples at so many dBFS, starting at so many degrees */
	const quarter = (db, degrees, sampleRate = RATE) => {
		const amplitude = 10 ** (db / 20) / Math.max(Math.abs(Math.sin(degrees * Math.PI / 180)), Math.abs(Math.cos(degrees * Math.PI / 180)))
		return Float32Array.from({ length: sampleRate }, (_, n) => amplitude * Math.sin(Math.PI / 2 * n + degrees * Math.PI / 180))
	}
	const dBTP = (samples, sampleRate = RATE, piece = 1024) => {
		const meter = truePeakOf(sampleRate)
		for (let at = 0; at < samples.length; at += piece) {
			meter.add(samples.subarray(at, at + piece))
		}
		return 20 * Math.log10(meter.peak())
	}

	it('finds the peak between the samples: 3 dB above a sine at fs/4 sampled at 45°', () => {
		const sine = quarter(-3.01, 45)
		expect(20 * Math.log10(Math.max(...sine.map(Math.abs)))).toBeCloseTo(-3.0, 1)
		expect(dBTP(sine)).toBeGreaterThan(-0.2)
		expect(dBTP(sine)).toBeLessThan(0.2)
	})

	// EBU Tech 3341's true-peak cases at 48 kHz, its tolerance +0.2 / −0.4 dB
	it.each([
		['sampled on its peaks at −6 dBFS', -6, 0, -6.0],
		['sampled at 45° at −9 dBFS', -9.03, 45, -6.0],
		['sampled at 45° with its samples at full scale', 0, 45, 3.0],
	])('reads a sine at fs/4 %s as expected', (_, db, degrees, expected) => {
		const measured = dBTP(quarter(db, degrees))
		expect(measured).toBeGreaterThan(expected - 0.4)
		expect(measured).toBeLessThan(expected + 0.2)
	})

	it('is never below the sample peak, which the filter alone could miss', () => {
		const click = new Float32Array(RATE)
		click[100] = -0.5
		expect(dBTP(click)).toBeCloseTo(-6.02, 2)
	})

	it('carries its filter across pieces: a peak on the border of two reads as in one piece', () => {
		const sine = quarter(0, 45)
		const whole = dBTP(sine, RATE, sine.length)
		// Pieces that end right at a peak, and pieces shorter than the filter
		expect(dBTP(sine, RATE, 1001)).toBeCloseTo(whole, 6)
		expect(dBTP(sine, RATE, 5)).toBeCloseTo(whole, 6)
		expect(dBTP(sine, RATE, 1)).toBeCloseTo(whole, 6)
	})

	it('oversamples twice from 96 kHz and not at all from 192 kHz, where the samples are fine enough', () => {
		const at192 = quarter(0, 45, 192000)
		expect(dBTP(at192, 192000)).toBeCloseTo(0, 3)
		expect(dBTP(quarter(0, 45, 96000), 96000)).toBeGreaterThan(0.5)
	})

	it('reports over all channels in dBTP', () => {
		const left = new Float32Array(RATE).fill(0.1)
		const right = new Float32Array(RATE).fill(0.1)
		right[100] = -0.5
		expect(measure([left, right])).toMatchObject({ peak: -6 })
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
