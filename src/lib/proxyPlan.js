/**
 * What a Proxy from the browser is to be (ADR 0019), free of Mediabunny and
 * the page so Vitest can check it. The rules are the server's
 * (DerivedMedia::PLAYABLE, needsProxy, maxHeight, maxBitrate).
 */

/** The Proxy's AAC, which counts towards the Proxy bitrate threshold with the picture */
export const AUDIO_BITRATE = 160_000

/** What a browser plays in each container family, by Mediabunny's codec names */
const PLAYABLE = {
	mp4: { video: ['avc'], audio: ['aac', 'mp3'] },
	webm: { video: ['vp8', 'vp9'], audio: ['opus', 'vorbis'] },
	matroska: { video: ['avc', 'vp8', 'vp9'], audio: ['aac', 'opus', 'vorbis', 'flac', 'mp3'] },
}
/** H.264 profiles that are 8-bit 4:2:0, the only kind browsers decode */
const H264_420 = [66, 77, 88, 100]

/** Frame rates a measured rate stands for, so 23.976 becomes 24000/1001 */
const RATES = [[24000, 1001], [30000, 1001], [60000, 1001], [24, 1], [25, 1], [30, 1], [48, 1], [50, 1], [60, 1], [100, 1], [120, 1]]

/**
 * @param {string} format - Mediabunny's name of the container, such as 'MP4', 'QuickTime File Format', 'WebM' or 'Matroska'
 * @return {?string} its family in PLAYABLE
 */
export function family(format) {
	const name = format.toLowerCase()
	return name.includes('mp4') || name.includes('quicktime') ? 'mp4' : name.includes('webm') ? 'webm' : name.includes('matroska') ? 'matroska' : null
}

/**
 * Whether browsers play a file as it is, as the server decides it.
 *
 * @param {object} file - what Mediabunny read
 * @param {string} file.format - the container's name
 * @param {?string} file.video - the video codec, null without video
 * @param {?string} file.videoCodec - the full codec string, such as avc1.64001f
 * @param {?string} file.audio - the audio codec, null without audio
 * @return {boolean} whether it plays
 */
export function plays({ format, video, videoCodec, audio }) {
	const allowed = PLAYABLE[family(format)]
	if (!allowed || (video && !allowed.video.includes(video)) || (audio && !allowed.audio.includes(audio))) {
		return false
	}
	// avc1.PPCCLL: the profile is the first byte
	return video !== 'avc' || H264_420.includes(parseInt((videoCodec ?? '').split('.')[1]?.slice(0, 2) ?? '', 16))
}

/**
 * @param {boolean} playable - whether browsers play the original
 * @param {number} bytes - its size
 * @param {number} seconds - its length
 * @param {number} maxBitrate - the Proxy bitrate threshold in Mbit/s
 * @return {boolean} whether it gets a Proxy: browsers do not play it, or it is above the threshold
 */
export const needsProxy = (playable, bytes, seconds, maxBitrate) => !playable || (seconds > 0 && bytes * 8 / seconds > maxBitrate * 1e6)

/**
 * @param {{width: number, height: number}} picture - the original's
 * @param {number} maxHeight - the Proxy resolution, on the short side
 * @return {{width: number, height: number}} the Proxy's, even for the encoder
 */
export function proxySize({ width, height }, maxHeight) {
	const scale = Math.min(1, maxHeight / Math.min(width, height))
	const even = (value) => Math.max(2, Math.round(value * scale / 2) * 2)
	return { width: even(width), height: even(height) }
}

/**
 * About 8 Mbit/s at 1080p, by the number of pixels, always below the
 * threshold together with the sound.
 *
 * @param {{width: number, height: number}} size - the Proxy's
 * @param {number} maxBitrate - the Proxy bitrate threshold in Mbit/s
 * @return {number} the picture's bitrate in bit/s
 */
export const videoBitrate = ({ width, height }, maxBitrate) => Math.round(Math.min(8e6 * width * height / (1920 * 1080), maxBitrate * 1e6 - AUDIO_BITRATE))

/**
 * @param {number} seconds - the Proxy's length
 * @param {number} bitrate - its picture's bitrate in bit/s
 * @return {number} the bytes to keep free for it, with room for the encoder's overshoot
 */
export const proxyBytes = (seconds, bitrate) => Math.ceil(seconds * (bitrate + AUDIO_BITRATE) / 8 * 1.25) + 2 * 1024 * 1024

/**
 * @param {number} frames - how many Frames the original has
 * @param {number} seconds - how long they last
 * @return {{num: number, den: number}} the frame rate, as an exact fraction where it is a common one
 */
export function frameRate(frames, seconds) {
	const rate = frames / seconds
	const common = RATES.find(([num, den]) => Math.abs(num / den - rate) < 0.002)
	if (common) {
		return { num: common[0], den: common[1] }
	}
	const num = Math.round(rate * 1000)
	const gcd = (a, b) => b === 0 ? a : gcd(b, a % b)
	return { num: num / gcd(num, 1000), den: 1000 / gcd(num, 1000) }
}
