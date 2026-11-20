/**
 * Loudness as ITU-R BS.1770-4 / EBU R 128 measure it, for the browser that
 * makes a Waveform where the server has no ffmpeg (decision A5): fed the
 * same decoded samples as the peaks, piece by piece, so only the energy of
 * each 100 ms is kept. Shown only, never applied to playback (A1).
 */

/** Below this a block does not count (absolute gate), in LUFS */
const ABSOLUTE_GATE = -70
/** Blocks this far below the loudness of those above the absolute gate do not count either (relative gate), in LU */
const RELATIVE_GATE = -10

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
 * A meter that takes decoded audio piece by piece and tells its integrated
 * loudness and sample peak once it has heard all of it.
 *
 * @return {{add: (channels: Float32Array[], sampleRate: number) => void, done: () => ?{integrated: ?number, peak: ?number, truePeak: boolean}}} the meter; done gives null where the sound changed its rate or channels midway
 */
export function loudnessMeter() {
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
	let peak = 0
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
				weights = channelWeights(channels.length)
				filters = kWeighting(sampleRate)
				state = channels.map(() => new Float64Array(8))
			} else if (rate !== sampleRate || weights.length !== channels.length) {
				broken = true
				return
			}
			const [s, h] = filters
			for (let at = 0; at < length; at++) {
				let energy = 0
				for (let c = 0; c < channels.length; c++) {
					const x = channels[c][at]
					const level = Math.abs(x)
					if (level > peak) {
						peak = level
					}
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
				return { integrated: null, peak: null, truePeak: false }
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
			return {
				integrated: gated.length > 0 ? Math.round(loudness(mean(gated)) * 10) / 10 : null,
				peak: peak > 0 ? Math.round(20 * Math.log10(peak) * 10) / 10 : null,
				truePeak: false,
			}
		},
	}
}
