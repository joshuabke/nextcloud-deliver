/**
 * Uploads in the Files app. Its uploader tells only when an upload is over,
 * so Deliver also looks at its queue for new ones: where the server has no
 * ffmpeg, a video that Auto Intake takes into a Folder Project gets its
 * Proxy from this browser while it uploads (ADR 0019), and audio its
 * Waveform once it is up (ADR 0012).
 *
 * The Files app bundles @nextcloud/upload 1.x and keeps its uploader on
 * window._nc_uploader, made when its upload menu mounts, which can be after
 * this script ran. Deliver depends neither on that package (Vue 2 and
 * @nextcloud/files 3) nor on the uploader of @nextcloud/files 4, which the
 * Files app does not use, so it takes the instance from the page.
 */
import { showError, showMessage, TOAST_PERMANENT_TIMEOUT } from '@nextcloud/dialogs'
import { reactive, watchEffect } from 'vue'
import { getAssetForFile, getIntake, handInWaveform } from './api.js'
import { t } from './lib/l10n.js'
import { convertInTurn, handInProxy, inspect } from './lib/proxy.js'
import { uploaded } from './lib/waveform.js'

/** The Proxies this tab makes of uploads, by file id once the file is there, for Deliver's sidebar tab */
export const proxiesByFile = reactive({})

/** Per folder uploaded into, what the server said: the Proxy settings, or null where the browser makes no Proxies */
const folders = new Map()
/** Uploads looked at, and the Proxy of those that get one from this browser */
const jobs = new WeakMap()
/** The Proxies being made, which a closed tab would lose */
const making = new Set()

let uploader

/**
 * Starts the Proxy of a video while it uploads, if it gets one here. The
 * folder is the one on screen when the upload is first seen; one started
 * elsewhere is left to the fallback on the Asset card.
 *
 * @param {object} upload - an Upload of the Files app's queue
 */
function start(upload) {
	if (jobs.has(upload)) {
		return
	}
	const file = upload.file
	const folder = uploader.destination
	if (!(file instanceof File) || !file.type.startsWith('video/') || !folder?.fileid || !upload.source.startsWith(folder.source)) {
		jobs.set(upload, null)
		return
	}
	if (!folders.has(folder.fileid)) {
		folders.set(folder.fileid, getIntake(folder.fileid).then(({ proxy }) => proxy, () => null))
	}
	const job = { status: reactive({ state: 'checking', progress: 0, error: null }), controller: new AbortController() }
	job.settings = folders.get(folder.fileid).then(async (settings) => {
		const seen = settings && await inspect(file, file.size, settings).catch(() => null)
		return seen?.needsProxy && seen.convertible ? settings : null
	})
	job.making = job.settings.then((settings) => {
		if (!settings) {
			return null
		}
		const made = convertInTurn(file, settings, job.status, job.controller.signal)
		follow(file.name, job)
		return made
	})
	jobs.set(upload, job)
}

/**
 * A toast that stays while the Proxy is made and uploaded, as the upload
 * itself shows in the Files app.
 *
 * @param {string} name - the file's
 * @param {{status: object, controller: AbortController}} job - its Proxy
 */
function follow(name, job) {
	making.add(job.status)
	const text = document.createElement('span')
	const toast = showMessage(text, { timeout: TOAST_PERMANENT_TIMEOUT })
	const stop = watchEffect(() => {
		const { state, progress, error } = job.status
		if (state === 'running' || state === 'uploading') {
			text.textContent = state === 'running'
				? t('deliver', 'Deliver is making the Proxy of {name} in this browser: {percent} %. Keep this tab open.', { name, percent: progress })
				: t('deliver', 'Deliver is uploading the Proxy of {name}: {percent} %. Keep this tab open.', { name, percent: progress })
			return
		}
		toast.hideToast()
		making.delete(job.status)
		queueMicrotask(() => stop())
		// Stopped on purpose, it is no failure: the upload failed, or the file is not for Deliver
		if (state === 'failed' && !job.controller.signal.aborted) {
			showError(error ?? t('deliver', 'Deliver could not make the Proxy of {name} in this browser.', { name }))
		}
	})
}

/**
 * Hands in the Proxy of a finished upload once Auto Intake made it an Asset
 *
 * @param {number} fileId - the uploaded file
 * @param {object} job - its Proxy
 */
async function handIn(fileId, job) {
	if (!await job.settings) {
		return
	}
	proxiesByFile[fileId] = job.status
	const asset = await getAssetForFile(fileId).catch(() => null)
	if (!asset?.versionId || !await handInProxy(asset.versionId, job.making, job.status, job.controller)) {
		job.controller.abort()
		delete proxiesByFile[fileId]
	}
}

/**
 * @param {object} upload - a finished or failed upload of the Files app
 */
function onUpload(upload) {
	const audio = uploaded(upload, 'audio')
	if (audio !== null) {
		// 404 for a file that is no Asset
		getAssetForFile(audio).then((asset) => handInWaveform(upload.file, asset), () => {})
	}
	// Quicker than a look at the queue, it converts now from the file the browser still holds
	start(upload)
	const job = jobs.get(upload)
	const video = uploaded(upload, 'video')
	if (job && video !== null) {
		handIn(video, job)
	} else if (job) {
		// Failed or cancelled: its Proxy has no Version to go to
		job.controller.abort()
	}
}

const existing = window._nc_uploader
Object.defineProperty(window, '_nc_uploader', {
	configurable: true,
	get: () => uploader,
	set(value) {
		uploader = value
		uploader?.addNotifier?.(onUpload)
	},
})
window._nc_uploader = existing

// ponytail: a look at the queue every second, as the uploader announces no start; a hook into it if it ever does
setInterval(() => uploader?.queue?.forEach(start), 1000)

// The browser asks before a closed tab loses a Proxy, as the Files app does for its uploads
window.addEventListener('beforeunload', (event) => {
	if ([...making].some((status) => ['running', 'uploading', 'handing'].includes(status.state))) {
		event.preventDefault()
	}
})
