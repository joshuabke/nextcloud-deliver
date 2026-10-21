import { describe, expect, it } from 'vitest'
import { addPeaks, peaksOf, roundPeaks, uploadedAudio } from './waveform.js'

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

describe('a Waveform decoded piece by piece', () => {
	it('puts each sample into the bucket of its time, whatever the pieces', () => {
		// Two seconds at 4 samples a second into 4 buckets, in two pieces of one second each
		const peaks = new Float32Array(4)
		addPeaks(peaks, [Float32Array.from([0.1, -0.2, 0.3, 0])], 0, 4, 2)
		addPeaks(peaks, [Float32Array.from([0, -0.9, 0.4, 0.05])], 1, 4, 2)
		expect(roundPeaks(peaks)).toEqual([0.2, 0.3, 0.9, 0.4])
	})

	it('keeps samples past the expected end in the last bucket', () => {
		const peaks = new Float32Array(2)
		addPeaks(peaks, [Float32Array.from([0.5])], 3, 1, 2)
		expect(roundPeaks(peaks)).toEqual([0, 0.5])
	})
})

describe('an upload in the Files app', () => {
	const upload = (fields) => ({ status: 3, file: { type: 'audio/mpeg' }, response: { headers: { 'oc-fileid': '00000123ocabc123' } }, ...fields })

	it('names the file id of finished audio', () => {
		expect(uploadedAudio(upload({}))).toBe(123)
	})

	it('leaves out what is not audio, not finished or has no file id', () => {
		expect(uploadedAudio(upload({ file: { type: 'video/mp4' } }))).toBeNull()
		expect(uploadedAudio(upload({ file: { type: '' } }))).toBeNull()
		expect(uploadedAudio(upload({ status: 5 }))).toBeNull()
		expect(uploadedAudio(upload({ response: { headers: {} } }))).toBeNull()
		expect(uploadedAudio(upload({ response: undefined }))).toBeNull()
	})
})
