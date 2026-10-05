import { showError, showInfo } from '@nextcloud/dialogs'
import { getSidebar, registerFileAction } from '@nextcloud/files'
import { t } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import { defineCustomElement } from 'vue'
import { errorMessage, getAssetForFile, handInWaveform } from './api.js'
import icon from './icon.svg?raw'
import { reviewable } from './lib/media.js'
import { uploadedAudio } from './lib/waveform.js'

// Deliver in the Files app: the sidebar tab and the "Open in Deliver" action

const tagName = 'deliver-files-sidebar-tab'
const isMedia = (node) => reviewable(node?.mime)

getSidebar().registerTab({
	id: 'deliver',
	displayName: t('deliver', 'Deliver'),
	iconSvgInline: icon,
	order: 50,
	tagName,
	// A folder carries the Project settings, a media file its own review switch
	enabled: ({ node }) => node.type === 'folder' || isMedia(node),
	async onInit() {
		const { default: SidebarTab } = await import('./views/SidebarTab.vue')
		// No shadow root: @nextcloud/vue components take their styles from the page's CSS variables
		customElements.define(tagName, defineCustomElement(SidebarTab, { shadowRoot: false }))
	},
})

registerFileAction({
	id: 'deliver-open',
	displayName: () => t('deliver', 'Open in Deliver'),
	iconSvgInline: () => icon,
	order: 60,
	enabled: ({ nodes }) => nodes.length === 1 && isMedia(nodes[0]),
	async exec({ nodes }) {
		try {
			const asset = await getAssetForFile(nodes[0].fileid)
			window.location.href = generateUrl('/apps/deliver/versions/{id}', { id: asset.versionId })
		} catch (e) {
			if (e?.response?.status === 404) {
				showInfo(t('deliver', 'This file is not enabled for review yet. Switch it on in the Deliver tab of the sidebar.'))
			} else {
				showError(errorMessage(e))
			}
		}
		return null
	},
})

/**
 * @param {object} upload - a finished or failed upload of the Files app
 */
function onUpload(upload) {
	const fileId = uploadedAudio(upload)
	if (fileId !== null) {
		// 404 for a file that is no Asset
		getAssetForFile(fileId).then((asset) => handInWaveform(upload.file, asset), () => {})
	}
}

/*
 * The Files app bundles @nextcloud/upload 1.x and keeps its uploader on
 * window._nc_uploader, made when its upload menu mounts, which can be after
 * this script ran. Deliver depends neither on that package (Vue 2 and
 * @nextcloud/files 3) nor on the uploader of @nextcloud/files 4, which the
 * Files app does not use, so it takes the instance from the page.
 */
const existing = window._nc_uploader
let uploader
Object.defineProperty(window, '_nc_uploader', {
	configurable: true,
	get: () => uploader,
	set(value) {
		uploader = value
		uploader?.addNotifier?.(onUpload)
	},
})
window._nc_uploader = existing
