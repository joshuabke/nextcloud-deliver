import { showError, showInfo } from '@nextcloud/dialogs'
import { getSidebar, registerFileAction } from '@nextcloud/files'
import { t } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import { registerSidebarAction } from '@nextcloud/sharing/ui'
import { defineCustomElement } from 'vue'
import ShareReviewAction from './views/ShareReviewAction.vue'
import { errorMessage, getAssetForFile } from './api.js'
import icon from './icon.svg?raw'
import { reviewable } from './lib/media.js'

// Deliver in the Files app: the sidebar tab, the "Open in Deliver" action, and the review switch in the link settings

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

// Nextcloud's link settings get Deliver's review switch, so a Share Link turns into a review surface where it is made
customElements.define('oca_deliver-share-review', defineCustomElement(ShareReviewAction, { shadowRoot: false }))
registerSidebarAction({
	id: 'deliver-share-review',
	element: 'oca_deliver-share-review',
	order: 50,
	// Link and email shares, the two kinds that reach Reviewers
	enabled: (share) => [3, 4].includes(share.type),
})
