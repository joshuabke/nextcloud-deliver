import { describe, expect, it } from 'vitest'
import { peaksOf } from './waveform.js'

describe('a Waveform from decoded audio', () => {
	it('keeps the loudest sample of each bucket over all channels', () => {
		const left = Float32Array.from([0.1, -0.2, 0.3, 0, 0, 0])
		const right = Float32Array.from([0, 0, 0, 0.05, -0.9, 0.4])
		expect(peaksOf([left, right], 3)).toEqual([0.2, 0.3, 0.9])
	})

	it('caps at full scale and rounds as the server does', () => {
		expect(peaksOf([Float32Array.from([1.2, 0.12345])], 2)).toEqual([1, 0.123])
	})

	it('makes no more buckets than there are samples', () => {
		expect(peaksOf([Float32Array.from([0.5, 0.25])], 2000)).toEqual([0.5, 0.25])
	})
})
