/**
 * Loudness as ITU-R BS.1770-4 / EBU R 128 measure it, for the browser that
 * makes a Waveform where the server has no ffmpeg (decision A5): fed the
 * same decoded samples as the peaks, piece by piece, so only the energy of
 * each 100 ms is kept, and the true peak (A9). Shown only, never applied to
 * playback (A1).
 */

/**
 * The interpolation filter of ITU-R BS.1770-4, Annex 2, Table 1: 48 taps as
 * four phases of 12, each phase one of the four values between two samples
 */
const PHASES = Float64Array.from([
	0.0017089843750,
	0.0109863281250,
	-0.0196533203125,
	0.0332031250000,
	-0.0594482421875,
	0.1373291015625,
	0.9721679687500,
	-0.1022949218750,
	0.0476074218750,
	-0.0266113281250,
	0.0148925781250,
	-0.0083007812500,
	-0.0291748046875,
	0.0292968750000,
	-0.0517578125000,
	0.0891113281250,
	-0.1665039062500,
	0.4650878906250,
	0.7797851562500,
	-0.2003173828125,
	0.1015625000000,
	-0.0582275390625,
	0.0330810546875,
	-0.0189208984375,
	-0.0189208984375,
	0.0330810546875,
	-0.0582275390625,
	0.1015625000000,
	-0.2003173828125,
	0.7797851562500,
	0.4650878906250,
	-0.1665039062500,
	0.0891113281250,
	-0.0517578125000,
	0.0292968750000,
	-0.0291748046875,
	-0.0083007812500,
	0.0148925781250,
	-0.0266113281250,
	0.0476074218750,
	-0.1022949218750,
	0.9721679687500,
	0.1373291015625,
	-0.0594482421875,
	0.0332031250000,
	-0.0196533203125,
	0.0109863281250,
	0.0017089843750,
])
/** How much louder than the loudest of its 12 inputs a phase's value can be: below that, a piece cannot raise the true peak */
const PHASE_GAIN = Math.max(...[0, 12, 24, 36].map((at) => PHASES.subarray(at, at + 12).reduce((sum, tap) => sum + Math.abs(tap), 0)))

/**
 * The true peak of one channel after BS.1770-4 Annex 2, piece by piece:
 * the loudest absolute value of the signal oversampled to at least 192 kHz
 * by the Annex's filter, 4× below 96 kHz (176.4 kHz from 44.1), 2× from 96
 * kHz (two of the four phases), none from 192 kHz. Never below the sample
 * peak, which the filter, not quite passing a sample through, could miss by
 * a fraction of a dB. Keeps its last 11 samples across pieces, nothing more.
 *
 * @param {number} sampleRate - samples a second
 * @return {{add: (samples: Float32Array) => void, peak: () => number}} the meter of one channel; peak is linear, 1 for full scale
 */
export function truePeakOf(sampleRate) {
	const phases = sampleRate >= 192000 ? [] : sampleRate >= 96000 ? [0, 24] : [0, 12, 24, 36]
	const history = new Float64Array(11)
	let work = new Float64Array(0)
	let peak = 0
	return {
		add(samples) {
			const n = samples.length
			let loudest = 0
			for (let i = 0; i < n; i++) {
				const level = Math.abs(samples[i])
				if (level > loudest) {
					loudest = level
				}
			}
			let window = loudest
			for (let i = 0; i < 11; i++) {
				window = Math.max(window, Math.abs(history[i]))
			}
			// A piece far below the true peak so far cannot raise it: most of a mix is skipped
			if (phases.length > 0 && !(window * PHASE_GAIN < peak)) {
				if (work.length < n + 11) {
					work = new Float64Array(n + 11)
				}
				work.set(history)
				work.set(samples, 11)
				const f = PHASES
				for (let i = 11; i < n + 11; i++) {
					// Unrolled: twelve taps a phase, the newest sample first
					const x0 = work[i]
					const x1 = work[i - 1]
					const x2 = work[i - 2]
					const x3 = work[i - 3]
					const x4 = work[i - 4]
					const x5 = work[i - 5]
					const x6 = work[i - 6]
					const x7 = work[i - 7]
					const x8 = work[i - 8]
					const x9 = work[i - 9]
					const x10 = work[i - 10]
					const x11 = work[i - 11]
					for (let k = 0; k < phases.length; k++) {
						const p = phases[k]
						let y = f[p] * x0 + f[p + 1] * x1 + f[p + 2] * x2 + f[p + 3] * x3 + f[p + 4] * x4 + f[p + 5] * x5
							+ f[p + 6] * x6 + f[p + 7] * x7 + f[p + 8] * x8 + f[p + 9] * x9 + f[p + 10] * x10 + f[p + 11] * x11
						if (y < 0) {
							y = -y
						}
						if (y > peak) {
							peak = y
						}
					}
				}
			}
			if (loudest > peak) {
				peak = loudest
			}
			// The filter's history at the border to the next piece
			if (n >= 11) {
				history.set(samples.subarray(n - 11))
			} else {
				history.copyWithin(0, n)
				history.set(samples, 11 - n)
			}
		},
		peak: () => peak,
	}
}

/** Below this a block does not count (absolute gate), in LUFS */
const ABSOLUTE_GATE = -70
/** Blocks this far below the loudness of those above the absolute gate do not count either (relative gate), in LU */
const RELATIVE_GATE = -10
/** The highest integrated loudness in LUFS and the range of the peak in dB the server takes; DerivedMedia::LOUDNESS_RANGE and PEAK_RANGE are the source of truth */
export const MOST_LOUDNESS = 15
export const PEAK_RANGE = [-200, 12]

/**
 * @param {{integrated: ?number, peak: ?number}} measured - a measurement
 * @return {boolean} whether the server takes its numbers
 */
export function withinRanges({ integrated, peak }) {
	return !(integrated > MOST_LOUDNESS) && (peak === null || (peak >= PEAK_RANGE[0] && peak <= PEAK_RANGE[1]))
}

/**
 * The two biquads of the K-weighting for this sample rate: a high shelf for
 * the head, then a high pass (the RLB curve), as libebur128 derives them
 * from BS.1770's 48 kHz coefficients.
 *
 * @param {number} sampleRate - samples a second
 * @return {Array<{b0: number, b1: number, b2: number, a1: number, a2: number}>} the two filters
 */
export function kWeighting(sampleRate) {
	let f0 = 1681.974450955533
	const gain = 3.999843853973347
	let q = 0.7071752369554196
	let k = Math.tan(Math.PI * f0 / sampleRate)
	const vh = 10 ** (gain / 20)
	const vb = vh ** 0.4996667741545416
	let a0 = 1 + k / q + k * k
	const shelf = {
		b0: (vh + vb * k / q + k * k) / a0,
		b1: 2 * (k * k - vh) / a0,
		b2: (vh - vb * k / q + k * k) / a0,
		a1: 2 * (k * k - 1) / a0,
		a2: (1 - k / q + k * k) / a0,
	}
	f0 = 38.13547087602444
	q = 0.5003270373238773
	k = Math.tan(Math.PI * f0 / sampleRate)
	a0 = 1 + k / q + k * k
	const highPass = { b0: 1, b1: -2, b2: 1, a1: 2 * (k * k - 1) / a0, a2: (1 - k / q + k * k) / a0 }
	return [shelf, highPass]
}

/**
 * The weight of each channel: 1, and 1.41 for the surrounds of 5.1 and 7.1
 * in their usual order (L R C LFE Ls Rs …), whose LFE does not count
 *
 * @param {number} channels - how many
 * @return {number[]} one weight a channel
 */
export function channelWeights(channels) {
	return Array.from({ length: channels }, (_, index) => {
		if (channels !== 6 && channels !== 8) {
			return 1
		}
		return index === 3 ? 0 : index >= 4 ? 1.41 : 1
	})
}

/**
 * @param {number} level - linear, 1 for full scale
 * @return {?number} in dB to a tenth; null for silence
 */
const decibels = (level) => (level > 0 ? Math.round(20 * Math.log10(level) * 10) / 10 : null)

/**
 * A meter that takes decoded audio piece by piece and tells its integrated
 * loudness and true peak once it has heard all of it.
 *
 * @param {?number[]} layout - one weight a channel where the file says where its channels are (an extensible WAV); else by their count
 * @return {{add: (channels: Float32Array[], sampleRate: number) => void, done: () => ?{integrated: ?number, peak: ?number, truePeak: boolean}}} the meter; done gives null where the sound changed its rate or channels midway, had a sample that is no number, or a number came out past the server's ranges
 */
export function loudnessMeter(layout = null) {
	let rate = 0
	let weights = []
	/** Per channel, the state of both filters: x1, x2, y1, y2 of the shelf, then of the high pass */
	let state = []
	let filters = []
	/** The energy of each 100 ms, weighted over the channels */
	let segments = new Float64Array(64)
	let count = 0
	let current = 0
	let heard = 0
	/** One true-peak meter a channel */
	let peaks = []
	let broken = false

	const close = () => {
		if (count >= segments.length) {
			const grown = new Float64Array(segments.length * 2)
			grown.set(segments)
			segments = grown
		}
		segments[count++] = current
		current = 0
	}

	return {
		add(channels, sampleRate) {
			const length = channels[0]?.length ?? 0
			if (broken || length === 0) {
				return
			}
			if (rate === 0) {
				rate = sampleRate
				weights = layout?.length === channels.length ? layout : channelWeights(channels.length)
				filters = kWeighting(sampleRate)
				state = channels.map(() => new Float64Array(8))
				peaks = channels.map(() => truePeakOf(sampleRate))
			} else if (rate !== sampleRate || weights.length !== channels.length) {
				broken = true
				return
			}
			channels.forEach((samples, c) => peaks[c].add(samples))
			const [s, h] = filters
			for (let at = 0; at < length; at++) {
				let energy = 0
				for (let c = 0; c < channels.length; c++) {
					const x = channels[c][at]
					if (weights[c] === 0) {
						continue
					}
					const z = state[c]
					const y = s.b0 * x + s.b1 * z[0] + s.b2 * z[1] - s.a1 * z[2] - s.a2 * z[3]
					z[1] = z[0]
					z[0] = x
					z[3] = z[2]
					z[2] = y
					const w = h.b0 * y + h.b1 * z[4] + h.b2 * z[5] - h.a1 * z[6] - h.a2 * z[7]
					z[5] = z[4]
					z[4] = y
					z[7] = z[6]
					z[6] = w
					energy += weights[c] * w * w
				}
				// A sample that is no number would carry through the filters for the rest: no loudness rather than that of a part
				if (!Number.isFinite(energy)) {
					broken = true
					return
				}
				current += energy
				heard++
				// The 100 ms segments end at whole samples, also where a tenth of a second is not one
				if (Math.floor(heard * 10 / rate) > count) {
					close()
				}
			}
		},
		done() {
			if (broken) {
				return null
			}
			if (rate === 0) {
				return { integrated: null, peak: null, truePeak: true }
			}
			const perSegment = rate / 10
			// 400 ms blocks, a new one every 100 ms (75 % overlap); a block's loudness is its mean square, K-weighted
			const blocks = []
			for (let end = 4; end <= count; end++) {
				const energy = (segments[end - 4] + segments[end - 3] + segments[end - 2] + segments[end - 1]) / (4 * perSegment)
				blocks.push(energy)
			}
			const loudness = (energy) => -0.691 + 10 * Math.log10(energy)
			const mean = (list) => list.reduce((sum, each) => sum + each, 0) / list.length
			const audible = blocks.filter((energy) => loudness(energy) > ABSOLUTE_GATE)
			const threshold = audible.length > 0 ? loudness(mean(audible)) + RELATIVE_GATE : Infinity
			const gated = audible.filter((energy) => loudness(energy) > threshold)
			const measured = {
				integrated: gated.length > 0 ? Math.round(loudness(mean(gated)) * 10) / 10 : null,
				peak: decibels(Math.max(0, ...peaks.map((each) => each.peak()))),
				truePeak: true,
			}
			// One number past the server's ranges means a broken decode: the Waveform goes in without loudness rather than not at all
			return withinRanges(measured) ? measured : null
		},
	}
}
