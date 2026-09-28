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
export const listProjectShares = (id) => axios.get(url(`/projects/${id}/shares`)).then(data)
export const muteProject = (id, muted) => axios.put(url(`/projects/${id}/mute`), { muted }).then(data)

export const getVersion = (id) => axios.get(url(`/versions/${id}`)).then(data)
export const updateVersion = (id, fields) => axios.put(url(`/versions/${id}`), fields).then(data)
export const stackVersion = (id, assetId, number = null) => axios.post(url(`/versions/${id}/stack`), { assetId, number }).then(data)
export const unstackVersion = (id) => axios.post(url(`/versions/${id}/unstack`)).then(data)
export const regenerateVersion = (id) => axios.post(url(`/versions/${id}/regenerate`)).then(data)

export const getAssetForFile = (fileId) => axios.get(url(`/files/${fileId}/asset`)).then(data)
export const enableFile = (fileId) => axios.post(url('/assets'), { fileId }).then(data)
export const updateAsset = (id, fields) => axios.put(url(`/assets/${id}`), fields).then(data)
export const disableAsset = (id) => axios.delete(url(`/assets/${id}`))

export const listComments = (versionId) => axios.get(url(`/versions/${versionId}/comments`)).then(data)
export const commentChanges = (versionId, since) => axios.get(url(`/versions/${versionId}/changes?since=${since}`)).then(data)
export const createComment = (versionId, fields) => axios.post(url(`/versions/${versionId}/comments`), fields).then(data)
export const updateComment = (id, body) => axios.put(url(`/comments/${id}`), { body }).then(data)
export const deleteComment = (id) => axios.delete(url(`/comments/${id}`))
export const reactComment = (id, emoji, on) => axios.put(url(`/comments/${id}/reactions`), { emoji, on }).then(data)
/**
 * @param {number} id - the Comment
 * @param {File} file - the file to attach
 * @return {Promise<object>} the Comment with its attachments
 */
export function attachFile(id, file) {
	const form = new FormData()
	form.append('file', file)
	return axios.post(url(`/comments/${id}/attachments`), form).then(data)
}

/**
 * @param {number} id - an attachment
 * @return {string} where the browser gets it, through the Share Link on the public page
 */
export function attachmentUrl(id) {
	return publicBase === null
		? generateUrl('/apps/deliver/attachments/{id}', { id })
		: publicBase.replace(/\/api$/, '') + `/attachments/${id}`
}

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
/**
 * @param {string} name - how the Reviewer calls themselves
 * @param {string|null} email - where to mail them, if anywhere
 * @param {{replies: boolean, comments: boolean, versions: boolean}} mail - what to mail
 * @return {Promise<object>} the Reviewer, with their Personal Link
 */
export function claimReviewer(name, email, mail) {
	return axios.post(url('/reviewer'), {
		name,
		email,
		mailReplies: mail.replies,
		mailComments: mail.comments,
		mailVersions: mail.versions,
	}).then(data)
}
/**
 * @param {string|null} email - the address, or null for none
 * @param {{replies: boolean, comments: boolean, versions: boolean}} mail - what to mail
 * @return {Promise<object>} the Reviewer as stored
 */
export function updateReviewer(email, mail) {
	return axios.put(url('/reviewer'), {
		email,
		mailReplies: mail.replies,
		mailComments: mail.comments,
		mailVersions: mail.versions,
	}).then(data)
}
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
	const target = `${folderUrl}/${encodeURIComponent(file.name)}`
	// Ask first, so a taken name is refused now rather than after the whole upload
	const taken = await axios.head(target).then(() => true, () => false)
	if (taken) {
		throw Object.assign(new Error('taken'), { response: { status: 412 } })
	}
	const response = await axios.put(target, file, {
		headers: { 'Content-Type': file.type || 'application/octet-stream', 'If-None-Match': '*' },
	})
	// OC-FileId carries the instance id after the number, as in 00000123ocabc123
	return parseInt(response.headers['oc-fileid'], 10)
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
