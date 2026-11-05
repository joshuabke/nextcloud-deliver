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
	// Audio files: a picture in them is cover art at most
	mp3: { video: [], audio: ['mp3'] },
	adts: { video: [], audio: ['aac'] },
	flac: { video: [], audio: ['flac'] },
	ogg: { video: [], audio: ['vorbis', 'opus', 'flac'] },
	wave: { video: [], audio: ['pcm-u8', 'pcm-s16', 'pcm-s24', 'pcm-s32', 'pcm-f32'] },
}
/** H.264 profiles that are 8-bit 4:2:0, the only kind browsers decode */
const H264_420 = [66, 77, 88, 100]

/**
 * @param {string} format - Mediabunny's name of the container, such as 'MP4', 'QuickTime File Format', 'WebM', 'Matroska' or 'WAVE'
 * @return {?string} its family in PLAYABLE
 */
function family(format) {
	const name = format.toLowerCase()
	if (name.includes('mp4') || name.includes('quicktime')) {
		return 'mp4'
	}
	return ['webm', 'matroska', 'mp3', 'adts', 'flac', 'ogg', 'wave'].find((each) => name.includes(each)) ?? null
}

/**
 * @param {string} format - the container's name
 * @return {boolean} whether the server reads its Frames without ffmpeg (ContainerProbe), which a Proxy is checked against
 */
export const convertible = (format) => ['mp4', 'webm', 'matroska'].includes(family(format))

/**
 * Why this browser makes no Proxy before its encoder is asked. A format no browser
 * helps with comes first, so no one is sent elsewhere for HEVC in MPEG-TS or E-AC-3 in an .m4a.
 *
 * @param {object} file - what the headers say
 * @param {boolean} file.video - whether it has a picture
 * @param {string} file.container - Mediabunny's name for its container
 * @param {?{codec: ?string}} file.undecodable - the first picture or sound this browser cannot decode
 * @return {?string} 'format' where no browser helps, 'codec' where another may, null where the encoder is next
 */
export function whyNot({ video, container, undecodable }) {
	if (!video || !convertible(container) || (undecodable && !undecodable.codec)) {
		return 'format'
	}
	return undecodable ? 'codec' : null
}

/**
 * Whether browsers play a file as it is, as the server decides it: every
 * track must be one they play (DerivedMedia::browserPlays).
 *
 * @param {string} format - the container's name
 * @param {Array<{type: string, codec: ?string, codecString?: ?string}>} tracks - every video and audio track
 * @return {boolean} whether it plays
 */
export function plays(format, tracks) {
	const allowed = PLAYABLE[family(format)]
	return Boolean(allowed) && tracks.every(({ type, codec, codecString }) => allowed[type]?.includes(codec)
		// avc1.PPCCLL: the profile is the first byte
		&& (codec !== 'avc' || H264_420.includes(parseInt((codecString ?? '').split('.')[1]?.slice(0, 2) ?? '', 16))))
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
 * @return {{width: number, height: number}} the Proxy's, even for the encoder and never above the resolution
 */
export function proxySize({ width, height }, maxHeight) {
	const scale = Math.min(1, maxHeight / Math.min(width, height))
	const even = (value) => Math.max(2, Math.floor(value * scale / 2) * 2)
	return { width: even(width), height: even(height) }
}

/**
 * About 8 Mbit/s at 1080p, by the number of pixels, and like ffmpeg's a
 * tenth below the threshold with the sound, room for the encoder's overshoot.
 *
 * @param {{width: number, height: number}} size - the Proxy's
 * @param {number} maxBitrate - the Proxy bitrate threshold in Mbit/s
 * @return {number} the picture's bitrate in bit/s
 */
export const videoBitrate = ({ width, height }, maxBitrate) => Math.round(Math.min(8e6 * width * height / (1920 * 1080), maxBitrate * 0.9e6 - AUDIO_BITRATE))

/**
 * A video target is only a target: the encoder may overshoot, and no Proxy
 * goes above the threshold (DerivedMedia::mismatch).
 *
 * @param {number} bytes - the made Proxy's size
 * @param {number} seconds - its length
 * @return {number} its bitrate in bit/s with the sound
 */
export const measuredBitrate = (bytes, seconds) => bytes * 8 / seconds

/**
 * @param {number} bytes - the made Proxy's size
 * @param {number} seconds - its length
 * @param {number} maxBitrate - the Proxy bitrate threshold in Mbit/s
 * @return {boolean} whether it goes above the threshold
 */
export const heavy = (bytes, seconds, maxBitrate) => seconds > 0 && measuredBitrate(bytes, seconds) > maxBitrate * 1e6

/**
 * @param {number} target - the picture bitrate that overshot, in bit/s
 * @param {number} bytes - the made Proxy's size
 * @param {number} seconds - its length
 * @param {number} maxBitrate - the Proxy bitrate threshold in Mbit/s
 * @return {number} a picture bitrate scaled by the overshoot, aiming 15 % below the threshold
 */
export const lowerTarget = (target, bytes, seconds, maxBitrate) => Math.max(100_000, Math.round(target * (maxBitrate * 0.85e6 - AUDIO_BITRATE) / Math.max(1, measuredBitrate(bytes, seconds) - AUDIO_BITRATE)))

/**
 * @param {number} seconds - the Proxy's length
 * @param {number} bitrate - its picture's bitrate in bit/s
 * @return {number} the bytes to keep free for it, with room for the encoder's overshoot
 */
export const proxyBytes = (seconds, bitrate) => Math.ceil(seconds * (bitrate + AUDIO_BITRATE) / 8 * 1.25) + 2 * 1024 * 1024

/**
 * The server takes a Proxy whose length is within half a Frame of its
 * Frames at the original's rate (DerivedMedia::mismatch).
 *
 * @param {{frames: number, seconds: number}} proxy - what the Proxy has
 * @param {{frames: number, seconds: number}} original - what the original has
 * @return {boolean} whether it fits
 */
export function fits(proxy, original) {
	return proxy.frames === original.frames
		&& Math.abs(proxy.seconds - original.seconds) <= original.seconds / original.frames / 2
}

/** The width of each picture of a Thumbnail Strip (DerivedMedia::THUMB_WIDTH) */
export const THUMB_WIDTH = 160

/**
 * The grid of a Thumbnail Strip, as DerivedMedia::runThumbs makes it: a
 * picture every few seconds, at most the Thumbnail Strip cap, in a near
 * square grid, each 160 wide and as high as the aspect ratio says, rounded
 * to even as ffmpeg's scale=160:-2 does.
 *
 * @param {number} seconds - the length of the video
 * @param {number} cap - the Thumbnail Strip cap
 * @param {{width: number, height: number}} size - the picture's
 * @return {{every: number, count: number, columns: number, rows: number, tileHeight: number}} the grid
 */
export function thumbGrid(seconds, cap, { width, height }) {
	const every = Math.max(1, Math.ceil(seconds / cap))
	const count = Math.max(1, Math.min(cap, Math.ceil(seconds / every)))
	const columns = Math.ceil(Math.sqrt(count))
	return { every, count, columns, rows: Math.ceil(count / columns), tileHeight: Math.max(2, Math.round(THUMB_WIDTH * height / width / 2) * 2) }
}

/**
 * Which picture of the strip a decoded picture stands for, as ffmpeg's fps
 * filter (rounding=near) picks them: mark n takes the last picture before
 * (n + ½) · every, so each picture drawn into its slot replaces the one
 * before and the last one stays.
 *
 * @param {{every: number, count: number}} grid - from thumbGrid
 * @param {number} time - when a decoded picture shows, in seconds from the start
 * @return {?number} its slot; null past the last
 */
export function thumbSlot({ every, count }, time) {
	const slot = Math.round(time / every)
	return slot < count ? slot : null
}
