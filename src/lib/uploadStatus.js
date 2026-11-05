/**
 * What the Uploads dialog says about an upload and its derived media
 * (stories 133–140), free of the store so Vitest can check it.
 */
import { n, t } from './l10n.js'

/** Derived media kinds in the order they are listed */
export const KINDS = ['waveform', 'proxy', 'thumbs']

/** The states of the Proxy this browser makes in which it is busy, so a closed tab would lose it */
const BUSY = ['running', 'uploading', 'handing']

/**
 * @param {?string} state - a Proxy's state
 * @return {boolean} whether the Proxy is being made, uploaded or taken by the server
 */
export const busy = (state) => BUSY.includes(state)

/**
 * @param {object} item - an upload
 * @return {boolean} whether its derived media are all made or failed, so nothing is left to watch
 */
export function settled(item) {
	const version = item.version
	// Until its Version is read for the first time, nothing is known
	if (!version?.derived) {
		return false
	}
	const running = KINDS.some((kind) => ['queued', 'running'].includes(version.derived[kind]?.state))
		|| busy(item.proxy?.state)
	return !running && (version.playable !== null || Boolean(version.derived.error))
}

/**
 * @param {object} item - an upload
 * @return {boolean} whether something of it failed and can be made again; a failed probe leaves only its error
 */
export function processingFailed(item) {
	const version = item.version
	return KINDS.some((kind) => version?.derived?.[kind]?.state === 'failed')
		|| (version?.playable === null && Boolean(version.derived?.error))
}

/**
 * @param {number|null} seconds - time still needed
 * @return {string} it, as people say it
 */
export function timeLeft(seconds) {
	if (seconds === null || !Number.isFinite(seconds)) {
		return ''
	}
	if (seconds < 60) {
		return t('deliver', 'less than a minute left')
	}
	const minutes = Math.ceil(seconds / 60)
	return minutes < 60
		? n('deliver', '%n minute left', '%n minutes left', minutes)
		: t('deliver', '{hours} h {minutes} min left', { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
}

/**
 * @param {object} item - an upload
 * @return {string} what it is doing
 */
export function statusOf(item) {
	switch (item.status) {
		case 'waiting': return t('deliver', 'Waiting')
		case 'checking': return t('deliver', 'Checking whether this browser can convert it')
		case 'uploading': return `${Math.floor(item.loaded / Math.max(1, item.size) * 100)} %`
		case 'finishing': return t('deliver', 'Finishing on the server')
		case 'elsewhere': return {
			finishing: t('deliver', 'Finishing on the server'),
			paused: t('deliver', 'Paused until the network is back'),
		}[item.phase] ?? t('deliver', '{percent} %, in another tab', { percent: Math.floor(item.loaded / Math.max(1, item.size) * 100) })
		case 'paused': return t('deliver', 'Paused until the network is back')
		case 'interrupted': return t('deliver', 'Interrupted. Pick the file again to go on where it stopped.')
		case 'failed': return item.error
	}
	if (!item.version || item.version.playable === undefined) {
		return t('deliver', 'Uploaded')
	}
	if (processingFailed(item)) {
		return t('deliver', 'Processing failed')
	}
	if (item.version.playable === null) {
		return t('deliver', 'Uploaded, waiting for the server to read it. That starts with the next background job.')
	}
	return settled(item) ? t('deliver', 'Ready') : t('deliver', 'Uploaded')
}

/**
 * How long this browser still needs to encode a Proxy, estimated from the
 * percent over the time since the pass began. Nothing before a few percent
 * and seconds, and nothing at 99 %, where it only finishes.
 *
 * @param {{progress: number, since?: number}} proxy - its status
 * @param {number} now - milliseconds
 * @return {?number} seconds, or null while the guess would be wild
 */
export function encodingEta({ progress, since }, now = Date.now()) {
	const elapsed = (now - since) / 1000
	if (!Number.isFinite(elapsed) || progress < 3 || progress >= 99 || elapsed < 5) {
		return null
	}
	return elapsed * (100 - progress) / progress
}

/**
 * Takes a progress report of the encoder into the status of a Proxy. The
 * estimate begins with the first report and again when the percent drops,
 * which is the second pass at a lower bitrate.
 *
 * @param {{progress: number, since?: number}} status - the Proxy's, changed
 * @param {number} progress - the encoder's percent
 * @param {number} now - milliseconds
 */
export function advance(status, progress, now = Date.now()) {
	if (status.since === undefined || progress < status.progress) {
		status.since = now
	}
	status.progress = progress
}

/**
 * Where the Proxy this browser makes has got, to follow "Proxy"
 *
 * @param {{state: string, progress?: number, error?: string, since?: number}} proxy - its status
 * @return {?string} the phase and its percentage, or null while nothing is to say
 */
export function proxyPhase(proxy) {
	return {
		checking: null,
		running: [t('deliver', 'Encoding {percent} %', { percent: proxy.progress }), timeLeft(encodingEta(proxy))].filter(Boolean).join(' · '),
		uploading: t('deliver', 'Upload {percent} %', { percent: proxy.progress }),
		handing: t('deliver', 'Finishing on the server'),
		ready: t('deliver', 'Done'),
		failed: proxy.error ?? t('deliver', 'Failed'),
	}[proxy.state]
}

/**
 * @param {?{state: string, progress?: number, error?: string}} proxy - the status of a Proxy this browser makes
 * @return {?string} "Proxy: <phase>", or null while nothing is to say
 */
export function proxyLine(proxy) {
	const phase = proxy && proxyPhase(proxy)
	return phase ? `${t('deliver', 'Proxy')}: ${phase}` : null
}

/**
 * @param {object} item - a finished upload
 * @return {Array<{kind: string, label: string, text: string, done: boolean}>} its derived media and how far each is (story 136)
 */
export function processingOf(item) {
	const labels = {
		waveform: t('deliver', 'Waveform'),
		proxy: t('deliver', 'Proxy'),
		thumbs: t('deliver', 'Thumbnail Strip'),
	}
	const lines = []
	// The Waveform this browser makes, also while the file still uploads (story 137)
	if (item.waveform && item.version?.derived?.waveform?.state !== 'ready') {
		lines.push({
			kind: 'browser',
			label: t('deliver', 'Waveform'),
			text: { running: t('deliver', 'Decoding {percent} %', { percent: item.waveform.progress }), ready: t('deliver', 'Done'), failed: t('deliver', 'Failed') }[item.waveform.state],
			done: item.waveform.state === 'ready',
		})
	}
	// The Proxy this browser makes where the server has no ffmpeg, also while the file still uploads (ADR 0019)
	if (item.proxy && item.version?.derived?.proxy?.state !== 'ready') {
		lines.push({
			kind: 'browserProxy',
			label: t('deliver', 'Proxy'),
			text: proxyPhase(item.proxy),
			done: item.proxy.state === 'ready',
		})
	}
	const derived = item.version?.derived
	for (const kind of derived ? KINDS : []) {
		const state = derived[kind]?.state
		const fromBrowser = { waveform: item.waveform, proxy: item.proxy }[kind]
		if (state === 'none' || state === undefined || (fromBrowser && state !== 'ready')) {
			continue
		}
		lines.push({
			kind,
			label: labels[kind],
			text: {
				queued: t('deliver', 'Waiting, starts with the next background job'),
				running: derived.progress === null ? t('deliver', 'Running') : `${derived.progress} %`,
				ready: t('deliver', 'Done'),
				failed: t('deliver', 'Failed'),
			}[state],
			done: state === 'ready',
		})
	}
	return lines
}
