/**
 * What the Uploads dialog says about an upload and its derived media
 * (stories 133–140), free of the store so Vitest can check it.
 */
import { n, t } from '@nextcloud/l10n'

/** Derived media kinds in the order they are listed */
export const KINDS = ['waveform', 'proxy', 'thumbs']

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
		case 'uploading': return `${Math.floor(item.loaded / Math.max(1, item.size) * 100)} %`
		case 'finishing': return t('deliver', 'Finishing on the server')
		case 'elsewhere': return t('deliver', '{percent} %, in another tab', { percent: Math.floor(item.loaded / Math.max(1, item.size) * 100) })
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
			label: t('deliver', 'Waveform, in this browser'),
			text: { running: `${item.waveform.progress} %`, ready: t('deliver', 'Done'), failed: t('deliver', 'Failed') }[item.waveform.state],
			done: item.waveform.state === 'ready',
		})
	}
	const derived = item.version?.derived
	for (const kind of derived ? KINDS : []) {
		const state = derived[kind]?.state
		if (state === 'none' || state === undefined || (kind === 'waveform' && lines.length && state !== 'ready')) {
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
