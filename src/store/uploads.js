import { getCurrentUser } from '@nextcloud/auth'
import axios from '@nextcloud/axios'
import { loadState } from '@nextcloud/initial-state'
import { t } from '@nextcloud/l10n'
import { generateRemoteUrl } from '@nextcloud/router'
import { defineStore } from 'pinia'
import { enableFile, errorMessage, getVersion, giveWaveform, regenerateVersion } from '../api.js'
import { mediaKind } from '../lib/media.js'
import { sameFile, uploadFile } from '../lib/upload.js'
import { decodeWaveform } from '../lib/waveform.js'
import { useProjectsStore } from './projects.js'

/** Unfinished chunked uploads, to go on with after a reload (story 135) */
const RECORDS = 'deliver.uploads'
/** Whether the server has ffmpeg (story 138); without it the uploading browser decodes the Waveform */
export const hasFfmpeg = loadState('deliver', 'ffmpeg', true)
/** Derived media kinds in the order they are listed */
export const KINDS = ['waveform', 'proxy', 'thumbs']

/**
 * The server's largest chunk (files.chunked_upload.max_size), at least the
 * 5 MiB an S3 multipart upload needs, at most 10000 chunks per file; 0 when
 * the admin switched chunking off.
 *
 * @param {number} size - the file's size
 * @return {number} the chunk size for it
 */
function chunkSizeFor(size) {
	const max = loadState('core', 'capabilities', {})?.files?.chunked_upload?.max_size ?? 10 * 1024 * 1024
	return max > 0 ? Math.max(max, 5 * 1024 * 1024, Math.ceil(size / 10000)) : 0
}

/**
 *
 */
function readRecords() {
	try {
		return JSON.parse(localStorage.getItem(RECORDS)) ?? []
	} catch {
		return []
	}
}
const writeRecords = (records) => localStorage.setItem(RECORDS, JSON.stringify(records))

/**
 * @param {object} item - an upload
 * @return {boolean} whether its derived media are all made or failed, so nothing is left to watch
 */
export function settled(item) {
	const version = item.version
	if (!version) {
		return false
	}
	const running = KINDS.some((kind) => ['queued', 'running'].includes(version.derived?.[kind]?.state))
	return !running && (version.playable !== null || Boolean(version.derived?.error))
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

let nextId = 1
let polling = null

/**
 * Every upload in Deliver, one file at a time, for as long as the tab is open
 * (stories 133–140). The dialog and its card in the corner show it.
 */
export const useUploadsStore = defineStore('uploads', {
	state: () => ({
		items: readRecords().map((record) => ({ ...record, status: 'interrupted', loaded: 0, error: null, version: null, waveform: null, file: null })),
		/** Whether the dialog is open; closed, the card sits in the corner while there are uploads */
		expanded: false,
		/** The folder of the view on screen that the dialog uploads into: { folderUrl, projectId, where }, or null */
		target: null,
		/** Bytes per second, smoothed */
		speed: 0,
		running: false,
	}),
	getters: {
		/**
		 * @param {object} state - the store's
		 * @return {object[]} uploads still sending or waiting to
		 */
		active: (state) => state.items.filter((item) => ['waiting', 'uploading', 'paused'].includes(item.status)),
		/** Bytes still to send for the whole queue, and how many of all of them are sent */
		totals() {
			const total = this.active.reduce((sum, item) => sum + item.size, 0)
			const loaded = this.active.reduce((sum, item) => sum + item.loaded, 0)
			return { total, loaded, percent: total ? Math.floor(loaded / total * 100) : 100, eta: this.speed > 0 ? (total - loaded) / this.speed : null }
		},
		/** Whether the card may be closed: nothing sends, nothing is being made */
		closable() {
			return this.active.length === 0 && this.items.every((item) => item.status !== 'done' || settled(item))
		},
	},
	actions: {
		/**
		 * Queues files for upload into a folder.
		 *
		 * @param {File[]} files - picked or dropped
		 * @param {object} where - where they go
		 * @param {string} where.folderUrl - WebDAV URL of the folder, without a trailing slash
		 * @param {?number} where.projectId - the Project they join, 0 for No Project; null for the Folder Project above the folder
		 * @param {?number} where.assetId - the Asset each becomes the next Version of (story 17)
		 * @param {?string} where.kind - the kind of media of that Asset's Version Stack
		 * @param {?(versionId: number) => void} where.onDone - gets the new Version id once it exists
		 * @param {boolean} expand - open the dialog, rather than only the card
		 */
		add(files, { folderUrl, projectId = null, assetId = null, kind = null, onDone = null }, expand = false) {
			for (const file of files) {
				const target = `${folderUrl}/${encodeURIComponent(file.name)}`
				// The same file to the same place goes on where it stopped
				const stopped = this.items.find((item) => item.status === 'interrupted' && item.target === target && sameFile(item, file))
				if (stopped) {
					this.resume(stopped, file)
					continue
				}
				const theirs = mediaKind(file.type)
				const item = {
					id: nextId++,
					name: file.name,
					size: file.size,
					lastModified: file.lastModified,
					type: file.type,
					target,
					projectId,
					assetId,
					folder: null,
					status: 'waiting',
					loaded: 0,
					error: null,
					version: null,
					waveform: null,
					file,
					onDone,
				}
				if (!/^(video|audio|image)\//.test(file.type)) {
					Object.assign(item, { status: 'failed', error: t('deliver', 'Only video, audio and image files are uploaded.'), file: null })
				} else if (kind && theirs && theirs !== kind) {
					// Checked before the upload: a file of another kind would land in the folder as an Asset of its own
					Object.assign(item, { status: 'failed', error: t('deliver', 'A Version Stack holds one kind of media: video, audio or stills.'), file: null })
				}
				this.items.push(item)
			}
			this.expanded = this.expanded || expand
			this.pump()
		},
		/**
		 * @param {object} item - an interrupted upload
		 * @param {File} file - picked again; it goes on only if it is the same file
		 * @return {boolean} whether it was the same file
		 */
		resume(item, file) {
			if (!sameFile(item, file)) {
				return false
			}
			Object.assign(item, { file, status: 'waiting', error: null })
			this.pump()
			return true
		},
		/**
		 * @param {object} item - a failed upload
		 */
		retry(item) {
			Object.assign(item, { status: 'waiting', error: null })
			this.pump()
		},
		/**
		 * Stops an upload and throws away what the server has of it
		 *
		 * @param {object} item - the upload
		 */
		cancel(item) {
			item.controller?.abort()
			if (item.folder) {
				axios.delete(item.folder).catch(() => {})
			}
			this.forget(item)
			this.items = this.items.filter((each) => each !== item)
		},
		/** Takes the uploads off the list whose files and derived media are all there */
		hideFinished() {
			this.items = this.items.filter((item) => item.status !== 'done' || !settled(item))
		},
		/** Closes the card; what is left to go on with comes back after a reload */
		close() {
			this.items = this.items.filter((item) => item.status === 'waiting' || item.status === 'uploading' || item.status === 'paused')
			this.expanded = false
		},
		/**
		 * Makes the derived media of an upload's Version again (story 140)
		 *
		 * @param {object} item - the upload
		 */
		async processAgain(item) {
			await regenerateVersion(item.version.id)
			await this.refresh(item)
			this.watch()
		},
		/** Uploads one file after another */
		async pump() {
			if (this.running) {
				return
			}
			this.running = true
			try {
				for (let item; (item = this.items.find((each) => each.status === 'waiting'));) {
					await this.send(item)
				}
			} finally {
				this.running = false
			}
		},
		/**
		 * @param {object} item - the upload to send now
		 */
		async send(item) {
			item.status = 'uploading'
			item.controller = new AbortController()
			const signal = item.controller.signal
			// Without ffmpeg the browser makes the Waveform while the file goes up (story 137); a WAV's is read on the server
			if (!hasFfmpeg && item.type.startsWith('audio/') && !/\.(wav|bwf)$/i.test(item.name) && !item.decoding) {
				item.waveform = { progress: 0, state: 'running' }
				item.decoding = decodeWaveform(item.file, (progress) => {
					item.waveform.progress = progress
				}).catch(() => null)
			}
			let last = { at: performance.now(), loaded: item.loaded }
			try {
				const fileId = await uploadFile({
					request: axios.request,
					file: item.file,
					target: item.target,
					uploadsUrl: generateRemoteUrl('dav') + '/uploads/' + encodeURIComponent(getCurrentUser()?.uid ?? ''),
					chunkSize: chunkSizeFor(item.size),
					folder: item.folder,
					onFolder: (folder) => {
						item.folder = folder
						this.remember(item)
					},
					onProgress: (loaded) => {
						const now = performance.now()
						if (now - last.at > 500) {
							const sample = (loaded - last.loaded) / ((now - last.at) / 1000)
							this.speed = this.speed ? this.speed * 0.8 + sample * 0.2 : sample
							last = { at: now, loaded }
						}
						item.loaded = loaded
					},
					env: {
						signal,
						online: () => navigator.onLine,
						untilOnline: () => new Promise((resolve) => window.addEventListener('online', resolve, { once: true })),
						sleep: (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000)),
						onPause: (paused) => {
							item.status = paused ? 'paused' : 'uploading'
							// Nothing moves while offline, so no time left is known
							this.speed = 0
						},
					},
				})
				const asset = await enableFile(fileId, item.projectId, item.assetId)
				this.forget(item)
				Object.assign(item, { status: 'done', loaded: item.size, folder: null })
				this.handIn(item, asset)
				this.refreshProjects(item)
				item.onDone?.(asset.versionId)
				item.version = { id: asset.versionId }
				await this.refresh(item)
				this.watch()
			} catch (error) {
				if (!signal.aborted) {
					Object.assign(item, { status: 'failed', error: errorMessage(error) })
				}
			} finally {
				if (this.active.length === 0) {
					this.speed = 0
				}
			}
		},
		/**
		 * Hands the Waveform the browser decoded to the server, once the Version exists
		 *
		 * @param {object} item - the upload
		 * @param {{versionId: number, waveformFromBrowser: boolean}} asset - its Asset
		 */
		async handIn(item, asset) {
			if (!item.decoding) {
				return
			}
			if (!asset.waveformFromBrowser) {
				item.waveform = null
				return
			}
			const decoded = await item.decoding
			if (decoded === null) {
				item.waveform.state = 'failed'
				return
			}
			try {
				// Audio counts in milliseconds (ADR 0007), also before the probe ran
				await giveWaveform(asset.versionId, decoded.peaks, Math.max(1, Math.round(decoded.seconds * 1000)))
				item.waveform = { progress: 100, state: 'ready' }
			} catch {
				item.waveform.state = 'failed'
			}
		},
		/**
		 * @param {object} item - a finished upload, whose Version is read again
		 */
		async refresh(item) {
			try {
				const context = await getVersion(item.version.id)
				item.version = { ...context.versions.find((each) => each.id === item.version.id), canWrite: context.canWrite }
			} catch {
				// Read again on the next round
			}
		},
		/** Reads the Versions again every five seconds while derived media are being made */
		watch() {
			if (polling) {
				return
			}
			const round = async () => {
				const open = this.items.filter((item) => item.status === 'done' && item.version && !settled(item))
				await Promise.all(open.map((item) => this.refresh(item)))
				if (open.some((item) => !settled(item))) {
					polling = setTimeout(round, 5000)
				} else {
					polling = null
					open.forEach((item) => this.refreshProjects(item))
				}
			}
			polling = setTimeout(round, 5000)
		},
		/**
		 * @param {object} item - an upload whose Project should show it
		 */
		refreshProjects(item) {
			const projects = useProjectsStore()
			for (const [id, project] of Object.entries(projects.details)) {
				if (Number(id) === item.projectId || project.assets.some((asset) => asset.id === item.assetId)) {
					projects.fetch(Number(id)).catch(() => {})
				}
			}
		},
		/**
		 * @param {object} item - an upload with an upload folder on the server
		 */
		remember(item) {
			const { id, name, size, lastModified, type, target, projectId, assetId, folder } = item
			writeRecords([...readRecords().filter((record) => record.target !== target), { id, name, size, lastModified, type, target, projectId, assetId, folder }])
		},
		/**
		 * @param {object} item - an upload that needs no going on with any more
		 */
		forget(item) {
			writeRecords(readRecords().filter((record) => record.target !== item.target))
		},
	},
})

// Interrupted uploads after a reload get ids of their own
nextId = Math.max(0, ...readRecords().map((record) => record.id)) + 1
