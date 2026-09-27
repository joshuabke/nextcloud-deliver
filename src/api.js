import axios from '@nextcloud/axios'
import { t } from '@nextcloud/l10n'
import { generateOcsUrl, generateUrl } from '@nextcloud/router'

/** Set on the public review page; Members leave it null and use the OCS API */
let publicBase = null

/**
 * Sends every following call through a Share Link instead of the OCS API.
 *
 * @param {string} token - the share token
 */
export function usePublicApi(token) {
	publicBase = generateUrl('/apps/deliver/s/{token}/api', { token })
}

const url = (path) => publicBase === null ? generateOcsUrl('apps/deliver/api/v1' + path) : publicBase + path
const data = (response) => response.data?.ocs?.data ?? response.data

export const listProjects = () => axios.get(url('/projects')).then(data)
export const getProject = (id) => axios.get(url(`/projects/${id}`)).then(data)
export const getProjectForFolder = (folderId) => axios.get(url(`/folders/${folderId}/project`)).then(data)
export const createProject = (folderId, autoIntake = true) => axios.post(url('/projects'), { folderId, autoIntake }).then(data)
export const updateProject = (id, settings) => axios.put(url(`/projects/${id}`), settings).then(data)
export const removeProject = (id) => axios.delete(url(`/projects/${id}`))
export const listMembers = (id) => axios.get(url(`/projects/${id}/members`)).then(data)
export const muteProject = (id, muted) => axios.put(url(`/projects/${id}/mute`), { muted }).then(data)

export const getVersion = (id) => axios.get(url(`/versions/${id}`)).then(data)
export const updateVersion = (id, fields) => axios.put(url(`/versions/${id}`), fields).then(data)
export const stackVersion = (id, assetId, number = null) => axios.post(url(`/versions/${id}/stack`), { assetId, number }).then(data)
export const unstackVersion = (id) => axios.post(url(`/versions/${id}/unstack`)).then(data)
export const regenerateVersion = (id) => axios.post(url(`/versions/${id}/regenerate`)).then(data)

export const getAssetForFile = (fileId) => axios.get(url(`/files/${fileId}/asset`)).then(data)
export const enableFile = (fileId) => axios.post(url('/assets'), { fileId }).then(data)
export const disableAsset = (id) => axios.delete(url(`/assets/${id}`))

export const listComments = (versionId) => axios.get(url(`/versions/${versionId}/comments`)).then(data)
export const commentChanges = (versionId, since) => axios.get(url(`/versions/${versionId}/changes?since=${since}`)).then(data)
export const createComment = (versionId, fields) => axios.post(url(`/versions/${versionId}/comments`), fields).then(data)
export const updateComment = (id, body) => axios.put(url(`/comments/${id}`), { body }).then(data)
export const deleteComment = (id) => axios.delete(url(`/comments/${id}`))
export const reactComment = (id, emoji, on) => axios.put(url(`/comments/${id}/reactions`), { emoji, on }).then(data)
export const resolveComment = (id, resolved) => axios.put(url(`/comments/${id}/resolved`), { resolved }).then(data)
export const decideVersion = (versionId, status) => axios.put(url(`/versions/${versionId}/approval`), { status }).then(data)
export const markSeen = (versionId, at) => axios.post(url(`/versions/${versionId}/seen`), { at }).then(data)

export const listShares = (fileId) => axios.get(url(`/files/${fileId}/shares`)).then(data)
export const createShareLink = (fileId) => axios.post(url(`/files/${fileId}/shares`)).then(data)
export const setShareFlags = (shareId, flags) => axios.put(url(`/shares/${shareId}`), flags).then(data)
export const listReviewers = (shareId) => axios.get(url(`/shares/${shareId}/reviewers`)).then(data)
export const inviteReviewer = (shareId, name, email) => axios.post(url(`/shares/${shareId}/reviewers`), { name, email }).then(data)

export const getPipelineSettings = () => axios.get(url('/admin/settings')).then(data)
export const savePipelineSettings = (settings) => axios.put(url('/admin/settings'), settings).then(data)

// Share Link only
export const getPublicContext = (params) => axios.get(url('/context'), { params }).then(data)
export const claimReviewer = (name, email) => axios.post(url('/reviewer'), { name, email }).then(data)
/** Every file of the share that is an Asset: [{ fileId, versionId, assetId }], Versions of one Asset share its newest versionId */
export const listPublicAssets = () => axios.get(url('/assets')).then(data)

/**
 * Drop upload: puts the file into a folder through Nextcloud's own WebDAV
 * (spec: Discovery and stacking). It never replaces a file of the same name.
 *
 * @param {string} folderUrl - WebDAV URL of the folder, without a trailing slash
 * @param {File} file - what was dropped
 * @return {Promise<number>} the Nextcloud file id of the upload
 */
export async function uploadVersion(folderUrl, file) {
	const response = await axios.put(`${folderUrl}/${encodeURIComponent(file.name)}`, file, {
		headers: { 'Content-Type': file.type || 'application/octet-stream', 'If-None-Match': '*' },
	})
	return Number(response.headers['oc-fileid'])
}

/**
 * Uploads a file next to the newest Version and stacks it on top as the next
 * Version (story 17).
 *
 * @param {string} folderUrl - WebDAV URL of the folder, without a trailing slash
 * @param {File} file - the new cut
 * @param {number} assetId - the Asset it belongs to
 * @return {Promise<number>} the id of the new Version
 */
export async function uploadNextVersion(folderUrl, file, assetId) {
	const asset = await enableFile(await uploadVersion(folderUrl, file))
	if (asset.assetId !== assetId) {
		await stackVersion(asset.versionId, assetId)
	}
	return asset.versionId
}

/**
 * @param {Error} error - an axios error
 * @return {string} the server's message, or the generic one
 */
export function errorMessage(error) {
	if (error?.response?.status === 412) {
		return t('deliver', 'A file with this name is already in the folder.')
	}
	return error?.response?.data?.ocs?.data?.message
		|| error?.response?.data?.message
		|| error?.response?.data?.ocs?.meta?.message
		|| error?.message
}
