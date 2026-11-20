import { describe, expect, it } from 'vitest'
import { collectPeaks, MAX_PEAKS, overview, RATE, rateFor, readWaveform, toBase64, uploaded } from './waveform.js'

describe('the rate of a Waveform', () => {
	it('is 50 peaks a second for anything up to 11 hours', () => {
		expect([rateFor(0.4), rateFor(3600), rateFor(10 * 3600), rateFor(MAX_PEAKS / RATE)]).toEqual([50, 50, 50, 50])
	})

	it('drops past that so it stays within the most peaks a Waveform has', () => {
		expect(rateFor(24 * 3600)).toBe(23)
		expect(rateFor(24 * 3600) * 24 * 3600).toBeLessThanOrEqual(MAX_PEAKS)
		expect(rateFor(1e9)).toBe(1)
	})
})

describe('a Waveform from decoded audio', () => {
	it('puts each sample into the peak of its time, over all channels, whatever the pieces', () => {
		// Two seconds at 4 samples a second, 2 peaks a second, in two pieces of one second each
		const peaks = collectPeaks(2, 2)
		peaks.add([Float32Array.from([0.1, -0.2, 0.3, 0]), Float32Array.from([0, 0, 0, 0])], 0, 4)
		peaks.add([Float32Array.from([0, 0, 0.4, 0.05]), Float32Array.from([0, -0.8, 0, 0])], 1, 4)
		expect(peaks.done()).toEqual({ rate: 2, peaks: Uint8Array.from([51, 77, 204, 102]) })
	})

	it('runs on past the expected length, as the decoder knows it better than the container', () => {
		const peaks = collectPeaks(1, 2)
		peaks.add([Float32Array.from([0.5])], 4.5, 1)
		expect(Array.from(peaks.done().peaks)).toEqual([0, 0, 0, 0, 128])
	})

	it('leaves out a piece whose time is off, rather than failing', () => {
		const peaks = collectPeaks(50, 1)
		peaks.add([Float32Array.from([0.5])], 1e12, 48000)
		peaks.add([Float32Array.from([0.5])], NaN, 48000)
		peaks.add([Float32Array.from([1])], 0, 48000)
		expect(Array.from(peaks.done().peaks)).toEqual([255])
	})

	it('caps at full scale and ends with the last sample heard', () => {
		const peaks = collectPeaks(1, 60)
		peaks.add([Float32Array.from([1.2, 0.5])], 0, 2)
		expect(Array.from(peaks.done().peaks)).toEqual([255])
	})
})

describe('a Waveform on its way', () => {
	it('goes to the server and back in base64, a byte a peak', () => {
		const peaks = Uint8Array.from({ length: 100000 }, (_, at) => at % 256)
		const sent = toBase64(peaks)
		expect(sent).toBe(Buffer.from(peaks).toString('base64'))
		expect(readWaveform({ rate: 50, peaks: sent })).toEqual({ rate: 50, peaks, loudness: null })
		const loudness = { integrated: -14.2, peak: -0.8, truePeak: true }
		expect(readWaveform({ rate: 50, peaks: sent, loudness }).loudness).toEqual(loudness)
	})
})

describe('a Waveform drawn whole', () => {
	const waveform = (values) => ({ rate: 50, peaks: Uint8Array.from(values) })

	it('keeps the loudest peak of each bucket, from 0 to 1', () => {
		// 2 seconds, 100 peaks, into 4 buckets of 25
		const values = Array.from({ length: 100 }, (_, at) => (at === 30 ? 255 : at % 25 === 0 ? 51 : 0))
		expect(overview(waveform(values), 2, 4)).toEqual([0.2, 1, 0.2, 0.2])
	})

	it('draws no more buckets than there are peaks, each with one', () => {
		expect(overview(waveform([51, 102, 255]), 0.06, 2000)).toEqual([0.2, 0.4, 1])
		expect(overview(waveform(Array(151).fill(255)), 3.01, 2000).every((peak) => peak === 1)).toBe(true)
	})

	it('lays the peaks along the length shown, silent where they end before it', () => {
		expect(overview(waveform(Array(50).fill(255)), 2, 4)).toEqual([1, 1, 0, 0])
	})

	it('takes the length of the peaks where the Version has none yet', () => {
		expect(overview(waveform(Array(100).fill(255)), 0, 4)).toEqual([1, 1, 1, 1])
	})
})

describe('an upload in the Files app', () => {
	const upload = (fields) => ({ status: 3, file: { type: 'audio/mpeg' }, response: { headers: { 'oc-fileid': '00000123ocabc123' } }, ...fields })

	it('names the file id of a finished file of the kind asked for', () => {
		expect(uploaded(upload({}), 'audio')).toBe(123)
		expect(uploaded(upload({ file: { type: 'video/quicktime' } }), 'video')).toBe(123)
	})

	it('leaves out another kind, what is not finished or has no file id', () => {
		expect(uploaded(upload({ file: { type: 'video/mp4' } }), 'audio')).toBeNull()
		expect(uploaded(upload({ file: { type: '' } }), 'audio')).toBeNull()
		expect(uploaded(upload({ status: 5 }), 'audio')).toBeNull()
		expect(uploaded(upload({ response: { headers: {} } }), 'audio')).toBeNull()
		expect(uploaded(upload({ response: undefined }), 'audio')).toBeNull()
	})
})
