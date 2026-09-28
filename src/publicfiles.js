import { registerFileAction } from '@nextcloud/files'
import { loadState } from '@nextcloud/initial-state'
import { t } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import icon from '../img/app.svg?raw'

/**
 * Runs on Nextcloud's own public share page when the share has review on
 * (ADR 0004): a Review button on each file that is an Asset, or straight into
 * the review view when the link points at one enabled file (story 48).
 */
const token = loadState('deliver', 'token')
const reviewUrl = loadState('deliver', 'reviewUrl', null)

if (reviewUrl !== null) {
	window.location.replace(reviewUrl)
}

/** File id → the id of its own Version (story 61); null until loaded */
let reviewable = null
const loading = fetch(generateUrl('/apps/deliver/s/{token}/api/assets', { token }))
	.then((response) => response.ok ? response.json() : [])
	.catch(() => [])
	.then((list) => {
		reviewable = new Map(list.map(({ fileId, versionId }) => [fileId, versionId]))
		return reviewable
	})

registerFileAction({
	id: 'deliver-review',
	displayName: () => t('deliver', 'Review'),
	iconSvgInline: () => icon,
	order: -50,
	enabled(context) {
		const nodes = context.nodes
		if (nodes.length !== 1) {
			return false
		}
		// The list usually arrives after the file ids; until then, offer it on every media file
		return reviewable === null
			? /^(video|audio)\//.test(nodes[0].mime ?? '')
			: reviewable.has(nodes[0].fileid)
	},
	async exec(context) {
		const versionId = (await loading).get(context.nodes[0].fileid)
		if (versionId !== undefined) {
			window.location.href = generateUrl('/apps/deliver/s/{token}/versions/{versionId}', { token, versionId })
		}
		return null
	},
	inline: () => true,
})
