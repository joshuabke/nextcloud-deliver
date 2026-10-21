import { getCurrentUser } from '@nextcloud/auth'
import axios from '@nextcloud/axios'
import { loadState } from '@nextcloud/initial-state'
import { t } from '@nextcloud/l10n'
import { generateRemoteUrl } from '@nextcloud/router'
import { defineStore } from 'pinia'
import { decodeInTurn, enableFile, errorMessage, getVersion, giveAudioWaveform, regenerateVersion } from '../api.js'
import { mediaKind } from '../lib/media.js'
import { current, HEARTBEAT, sameFile, uploadFile } from '../lib/upload.js'
import { ACTIVE, mergeBoard, totals } from '../lib/uploadBoard.js'
import { settled } from '../lib/uploadStatus.js'
import { useProjectsStore } from './projects.js'

/**
 * Uploads that are being sent, by any tab, and unfinished chunked ones to go
 * on with after a reload (story 135), one key each after this prefix and the
 * target: one tab writes each, so no tab writes over another's. Every tab
 * shows them, so uploading is in one place however many tabs are open.
 */
const RECORD = 'deliver.upload:'
/** Finished uploads whose Processing the card still shows, in every tab and after a reload, until they are hidden: one key each by Version id */
const DONE = 'deliver.processing:'
/** A cancel asked for in one tab, for the tab that sends the upload: { target, at } */
const CANCEL = 'deliver.upload-cancel'
/** Whether the server has ffmpeg (story 138); without it the uploading browser decodes the Waveform */
export const hasFfmpeg = loadState('deliver', 'ffmpeg', true)

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
 * @param {string} prefix - RECORD or DONE
 * @return {Array<{key: string, value: object}>} what every tab keeps under it
 */
function readAll(prefix) {
	const found = []
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i)
			if (key?.startsWith(prefix)) {
				found.push({ key, value: JSON.parse(localStorage.getItem(key)) })
			}
		}
	} catch {
		// No storage, as in some private windows: the card then shows this tab alone
	}
	return found
}

/**
 * @param {string} key - where
 * @param {?object} value - what, or null to take it away
 */
function write(key, value) {
	try {
		if (value === null) {
			localStorage.removeItem(key)
		} else {
			localStorage.setItem(key, JSON.stringify(value))
		}
	} catch {
		// As in readAll
	}
}

let nextId = 1
let polling = null

/**
 * Every upload in Deliver, one file at a time, for as long as the tab is open
 * (stories 133–140). The dialog and its card in the corner show it.
 */
export const useUploadsStore = defineStore('uploads', {
	state: () => ({
		/** Filled by start() from what every tab keeps in localStorage */
		items: [],
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
		active: (state) => state.items.filter((item) => ACTIVE.includes(item.status)),
		/**
		 * @param {object} state - the store's
		 * @return {object[]} uploads going on in this tab or another one
		 */
		sending: (state) => state.items.filter((item) => ACTIVE.includes(item.status) || item.status === 'elsewhere'),
		/**
		 * @param {object} state - the store's
		 * @return {object} bytes still to send for the whole queue of every tab, how many are sent, and the time left at their speeds together
		 */
		totals: (state) => totals(state.items, state.speed),
		/** Whether the card may be closed: nothing sends, here or in another tab, and nothing is being made */
		closable() {
			return this.active.length === 0 && this.items.every((item) => item.status !== 'elsewhere' && (item.status !== 'done' || settled(item)))
		},
	},
	actions: {
		/** Shows what every tab has, now and whenever another tab changes it; once, by the dialog */
		start() {
			const now = Date.now()
			// Older than a day: the server no longer has the chunks, and the Processing is long over
			for (const { key, value } of [...readAll(RECORD), ...readAll(DONE)]) {
				if (!current(value, now)) {
					write(key, null)
				}
			}
			this.sync()
			// Also without a change: a tab that died without a word stops counting as sending after a while
			setInterval(() => this.sync(), HEARTBEAT)
			window.addEventListener('storage', (event) => {
				if (event.key === null || event.key.startsWith(RECORD) || event.key.startsWith(DONE)) {
					this.sync()
				} else if (event.key === CANCEL && event.newValue) {
					// Another tab asks to cancel an upload this one sends
					const { target } = JSON.parse(event.newValue)
					const item = this.active.find((each) => each.target === target)
					if (item) {
						this.cancel(item)
					}
				}
			})
		},
		/** Takes in the uploads other tabs send, stopped ones, and finished ones still shown */
		sync() {
			const records = readAll(RECORD).map(({ value }) => value)
			const done = readAll(DONE).map(({ value }) => value)
			const { items, added } = mergeBoard(this.items, records, done, Date.now(), () => nextId++)
			this.items = items
			// Read at once, so a finished one does not say Processing until the next round
			added.forEach((item) => this.refresh(item))
			this.watch()
		},
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
					fileId: null,
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
		 * Stops an upload and throws away what the server has of it. Once every
		 * byte is sent, the server makes the file whatever the browser does, so
		 * there is nothing to stop any more.
		 *
		 * @param {object} item - the upload
		 */
		cancel(item) {
			if (item.status === 'finishing' || (item.status === 'elsewhere' && item.phase === 'finishing')) {
				return
			}
			// The tab that sends it stops it; the records then take it off every list
			if (item.status === 'elsewhere') {
				write(CANCEL, { target: item.target, at: Date.now() })
				return
			}
			item.controller?.abort()
			if (item.folder) {
				axios.delete(item.folder).catch(() => {})
			}
			this.forget(item)
			this.items = this.items.filter((each) => each !== item)
		},
		/** Takes the uploads off the list whose files and derived media are all there, in every tab */
		hideFinished() {
			this.drop(this.items.filter((item) => item.status === 'done' && settled(item)))
		},
		/** Closes the card in every tab; what is left to go on with comes back after a reload */
		close() {
			this.drop(this.items.filter((item) => !ACTIVE.includes(item.status) && item.status !== 'elsewhere'))
			this.expanded = false
		},
		/**
		 * @param {object[]} gone - uploads to take off the list, here and in the other tabs
		 */
		drop(gone) {
			gone.filter((item) => item.version).forEach((item) => write(DONE + item.version.id, null))
			this.items = this.items.filter((item) => !gone.includes(item))
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
			item.status = item.fileId ? 'finishing' : 'uploading'
			item.controller = new AbortController()
			const signal = item.controller.signal
			// Without ffmpeg the browser makes the Waveform while the file goes up (story 137); a WAV's is read on the server
			if (!hasFfmpeg && item.type.startsWith('audio/') && !/\.(wav|bwf)$/i.test(item.name) && !item.decoding) {
				item.waveform = { progress: 0, state: 'running' }
				item.decoding = decodeInTurn(item.file, (progress) => {
					item.waveform.progress = progress
				}).catch(() => null)
			}
			// Other tabs show it and leave it alone, also while a chunk or the final join takes long
			const beat = setInterval(() => signal.aborted || this.remember(item), HEARTBEAT)
			// Going away, a chunked upload waits for its file; one sent in one piece cannot go on
			const leave = () => item.folder ? this.remember(item, true) : this.forget(item)
			window.addEventListener('pagehide', leave)
			this.remember(item)
			let shared = 0
			// Bytes that were on the server before are not speed: the first report only sets the start
			let last = null
			try {
				// A file that arrived before is not sent again, only enabled (story 133)
				item.fileId ??= await uploadFile({
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
						if (last === null) {
							last = { at: now, loaded }
						} else if (now - last.at > 500) {
							const sample = (loaded - last.loaded) / ((now - last.at) / 1000)
							this.speed = this.speed ? this.speed * 0.8 + sample * 0.2 : sample
							last = { at: now, loaded }
						}
						item.loaded = loaded
						if (loaded === item.size && item.status === 'uploading') {
							item.status = 'finishing'
							this.remember(item)
						}
						// Other tabs follow its progress once a second
						if (now - shared > 1000) {
							shared = now
							this.remember(item)
						}
					},
					env: {
						signal,
						online: () => navigator.onLine,
						// A cancel ends the waiting too
						untilOnline: () => new Promise((resolve) => {
							window.addEventListener('online', resolve, { once: true })
							signal.addEventListener('abort', resolve, { once: true })
						}),
						sleep: (seconds) => new Promise((resolve) => {
							setTimeout(resolve, seconds * 1000)
							signal.addEventListener('abort', resolve, { once: true })
						}),
						onPause: (paused) => {
							item.status = paused ? 'paused' : item.loaded === item.size ? 'finishing' : 'uploading'
							// Nothing moves while offline, so no time left is known
							this.speed = 0
							this.remember(item)
						},
					},
				})
				this.forget(item)
				item.folder = null
				const asset = await enableFile(item.fileId, item.projectId, item.assetId)
				Object.assign(item, { status: 'done', loaded: item.size })
				// Its Processing shows in every tab, and after a reload
				write(DONE + asset.versionId, { versionId: asset.versionId, name: item.name, size: item.size, projectId: item.projectId, assetId: item.assetId, seen: Date.now() })
				this.handIn(item, asset)
				this.refreshProjects(item)
				item.onDone?.(asset.versionId)
				item.version = { id: asset.versionId }
				await this.refresh(item)
				this.watch()
			} catch (error) {
				// Cancelled or failed, it is nobody's to show elsewhere; a retry here records it again
				this.forget(item)
				if (!signal.aborted) {
					Object.assign(item, { status: 'failed', error: errorMessage(error) })
				}
			} finally {
				clearInterval(beat)
				window.removeEventListener('pagehide', leave)
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
				await giveAudioWaveform(asset.versionId, decoded)
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
			} catch (error) {
				// Its Version is gone, deleted or taken out of Deliver: nothing is left to show; anything else is read again on the next round
				if (error.response?.status === 404) {
					this.drop([item])
				}
			}
		},
		/** Reads the Versions again every five seconds while derived media are being made */
		watch() {
			if (polling) {
				return
			}
			const unsettled = () => this.items.filter((item) => item.status === 'done' && item.version && !settled(item))
			const round = async () => {
				const open = unsettled()
				await Promise.all(open.map((item) => this.refresh(item)))
				open.filter(settled).forEach((item) => this.refreshProjects(item))
				// Read again: an upload that finished during this round found the timer still set and is only seen here
				polling = unsettled().length ? setTimeout(round, 5000) : null
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
		 * @param {object} item - an upload this tab sends, or sent until it stopped
		 * @param {boolean} left - whether this tab goes away, so another may go on with it at once
		 */
		remember(item, left = false) {
			const { name, size, lastModified, type, target, projectId, assetId, folder, loaded, status } = item
			// Status and speed too, so the other tabs show it just as this one does
			const shared = { name, size, lastModified, type, target, projectId, assetId, folder, loaded, status, speed: this.speed }
			write(RECORD + target, { ...shared, seen: Date.now(), left })
		},
		/**
		 * @param {object} item - an upload that needs no going on with any more
		 */
		forget(item) {
			write(RECORD + item.target, null)
		},
	},
})
