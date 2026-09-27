import { generateUrl } from '@nextcloud/router'

/**
 * The still that identifies an Asset in a list. Nextcloud renders it itself
 * when an admin enabled the Movie preview provider and the server has
 * ffmpeg; it is unrelated to Deliver's Thumbnail Strip (ADR 0003).
 */
let shareToken = null

/**
 * Reviewers have no session, so their previews come through the share's own
 * endpoint instead of the one for Members.
 *
 * @param {string} token - the share token of the public page
 */
export function usePublicPreviews(token) {
	shareToken = token
}

/**
 * @param {number} fileId - the file to show
 * @param {number} size - the longest edge, in pixels
 * @return {string} URL of the still
 */
export function previewUrl(fileId, size = 64) {
	const query = `?fileId=${fileId}&x=${size}&y=${size}&a=1`
	return shareToken === null
		? generateUrl('/core/preview' + query)
		: generateUrl('/apps/files_sharing/publicpreview/{token}', { token: shareToken }) + query
}
