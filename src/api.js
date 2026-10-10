import axios from '@nextcloud/axios'
import { getLanguage, t } from '@nextcloud/l10n'
import { generateOcsUrl, generateUrl } from '@nextcloud/router'
import { baseLanguage } from './lib/language.js'
import { mediaKind } from './lib/media.js'
import { decodeWaveform } from './lib/waveform.js'

/** Set on the public review page; Members leave it null and use the OCS API */
let publicBase = null

/**
 * Sends every following call through a Project Link instead of the OCS API.
 *
 * @param {string} token - the link's token
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
// A Project by name, which collects files from anywhere (ADR 0009)
export const createNamedProject = (name) => axios.post(url('/projects'), { name }).then(data)
export const updateProject = (id, settings) => axios.put(url(`/projects/${id}`), settings).then(data)
export const removeProject = (id) => axios.delete(url(`/projects/${id}`))
// Who can be @mentioned on a Version: whoever can open its file
export const listMembers = (versionId) => axios.get(url(`/versions/${versionId}/members`)).then(data)
export const updateReviewerAsMember = (id, fields) => axios.put(url(`/reviewers/${id}`), fields).then(data)
export const renewReviewerKey = (id) => axios.post(url(`/reviewers/${id}/key`)).then(data)
export const removeReviewer = (id) => axios.delete(url(`/reviewers/${id}`)).then(data)
export const muteProject = (id, muted) => axios.put(url(`/projects/${id}/mute`), { muted }).then(data)

export const getVersion = (id) => axios.get(url(`/versions/${id}`)).then(data)
export const updateVersion = (id, fields) => axios.put(url(`/versions/${id}`), fields).then(data)
export const stackVersion = (id, assetId, number = null) => axios.post(url(`/versions/${id}/stack`), { assetId, number }).then(data)
export const unstackVersion = (id) => axios.post(url(`/versions/${id}/unstack`)).then(data)
export const regenerateVersion = (id) => axios.post(url(`/versions/${id}/regenerate`)).then(data)

export const getAssetForFile = (fileId) => axios.get(url(`/files/${fileId}/asset`)).then(data)
/**
 * @param {number} fileId - a media file
 * @param {?number} projectId - its Project, 0 for No Project; without one it joins the Folder Project above it, else No Project
 * @return {Promise<object>} the Asset as the Files sidebar shows it
 */
export const enableFile = (fileId, projectId = null) => axios.post(url('/assets'), projectId === null ? { fileId } : { fileId, projectId }).then(data)
// Puts an Asset into a Project, or into No Project for 0; no file moves
export const assignAsset = (id, projectId) => axios.put(url(`/assets/${id}/project`), { projectId }).then(data)
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
 * @return {string} where the browser gets it, through the Project Link on the public page
 */
export function attachmentUrl(id) {
	return publicBase === null
		? generateUrl('/apps/deliver/attachments/{id}', { id })
		: publicBase.replace(/\/api$/, '') + `/attachments/${id}`
}

export const resolveComment = (id, resolved) => axios.put(url(`/comments/${id}/resolved`), { resolved }).then(data)
export const decideVersion = (versionId, status) => axios.put(url(`/versions/${versionId}/approval`), { status }).then(data)
export const giveWaveform = (versionId, peaks, durationFrames) => axios.post(url(`/versions/${versionId}/waveform`), { peaks, durationFrames }).then(data)
let decoding = Promise.resolve()
/**
 * Where the server has no ffmpeg, the browser that uploaded an audio file
 * decodes its Waveform from the file it still holds, so nobody downloads it
 * for that (spec: Media metadata and derived media). Fire and forget: without
 * it, the first Member to open the Version decodes it.
 *
 * @param {Blob} file - what was uploaded
 * @param {{versionId: number, waveformFromBrowser: boolean}} asset - its Asset, as getAssetForFile or enableFile give it
 */
export function handInWaveform(file, asset) {
	if (!asset.waveformFromBrowser) {
		return
	}
	// One at a time, so a batch of long mixes is not in memory at once; audio counts in milliseconds (ADR 0007), also before the probe ran
	decoding = decoding
		.then(() => decodeWaveform(file))
		.then(({ peaks, seconds }) => giveWaveform(asset.versionId, peaks, Math.max(1, Math.round(seconds * 1000))))
		.catch(() => {})
}
export const markSeen = (versionId, at) => axios.post(url(`/versions/${versionId}/seen`), { at }).then(data)

// Project Links (ADR 0010, 0011): a whole Project or picked Assets; on No Project (id 0) picked Assets of it
export const listProjectLinks = (projectId) => axios.get(url(`/projects/${projectId}/links`)).then(data)
export const createProjectLink = (projectId, assetIds = null) => axios.post(url(`/projects/${projectId}/links`), { assetIds }).then(data)

/**
 * What a link's settings, Reviewers and activity go through
 *
 * @param {{id: number}} link - a Project Link
 * @return {{update: (fields: object) => Promise<object>, remove: () => Promise<void>, reviewers: () => Promise<object[]>, invite: (name: string, email: ?string, letter: ?{message: string}) => Promise<object>, activity: () => Promise<object[]>}}
 */
export function linkApi(link) {
	const base = `/links/${link.id}`
	return {
		update: (fields) => axios.put(url(base), fields).then(data),
		remove: () => axios.delete(url(base)).then(data),
		reviewers: () => axios.get(url(`${base}/reviewers`)).then(data),
		invite: (name, email, letter) => axios.post(url(`${base}/reviewers`), { name, email, sendMail: Boolean(letter), message: letter?.message || null }).then(data),
		activity: () => axios.get(url(`${base}/activity`)).then(data),
	}
}

export const getPipelineSettings = () => axios.get(url('/admin/settings')).then(data)
export const savePipelineSettings = (settings) => axios.put(url('/admin/settings'), settings).then(data)
export const getSupportReport = () => axios.get(url('/admin/report')).then(data)
export const retryFailedJobs = () => axios.post(url('/admin/jobs/retry')).then(data)

// Public review page only
export const getPublicContext = (params) => axios.get(url('/context'), { params }).then(data)
/**
 * @param {{replies: boolean, comments: boolean, versions: boolean}} mail - what the Reviewer wants mailed
 * @return {object} those wishes as the server takes them
 */
const mailFields = (mail) => ({ mailReplies: mail.replies, mailComments: mail.comments, mailVersions: mail.versions })
/**
 * @param {string} name - how the Reviewer calls themselves
 * @param {string|null} email - where to mail them, if anywhere
 * @param {{replies: boolean, comments: boolean, versions: boolean}} mail - what to mail
 * @return {Promise<object>} the Reviewer, with their Personal Link, mailed in the page's language
 */
export const claimReviewer = (name, email, mail) => axios.post(url('/reviewer'), { name, email, ...mailFields(mail), language: baseLanguage(getLanguage()) }).then(data)
/**
 * @param {string|null} name - their new name, or null to keep it
 * @param {string|null} email - the address, or null for none
 * @param {{replies: boolean, comments: boolean, versions: boolean}} mail - what to mail
 * @param {string} language - the one to mail them in, the page's unless they pick another
 * @return {Promise<object>} the Reviewer as stored
 */
export const updateReviewer = (name, email, mail, language = baseLanguage(getLanguage())) => axios.put(url('/reviewer'), { name, email, ...mailFields(mail), language }).then(data)
/** Ends the Reviewer's session: this browser forgets who they are */
export const forgetReviewer = () => axios.delete(url('/reviewer'))
/** Every file behind the link that is an Asset: [{ fileId, versionId, assetId }], Versions of one Asset share its newest versionId */
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
 * Renames a file in its folder through Nextcloud's own WebDAV (story 131);
 * Deliver follows the rename. It never replaces a file of the same name.
 *
 * @param {string} url - WebDAV URL of the file
 * @param {string} name - its new name
 */
export function renameFile(url, name) {
	return axios.request({
		method: 'MOVE',
		url,
		headers: { Destination: url.slice(0, url.lastIndexOf('/') + 1) + encodeURIComponent(name), Overwrite: 'F' },
	})
}

/**
 * Uploads a file next to the newest Version and stacks it on top as the next
 * Version (story 17).
 *
 * @param {string} folderUrl - WebDAV URL of the folder, without a trailing slash
 * @param {File} file - the new cut
 * @param {number} assetId - the Asset it belongs to
 * @param {string|null} kind - the kind of media of its Version Stack, from stackKind; null when unknown
 * @return {Promise<number>} the id of the new Version
 */
export async function uploadNextVersion(folderUrl, file, assetId, kind) {
	// Checked before the upload: a file of another kind would land in the folder as an Asset of its own
	const theirs = mediaKind(file.type)
	if (kind && theirs && theirs !== kind) {
		throw new Error(t('deliver', 'A Version Stack holds one kind of media: video, audio or stills.'))
	}
	const asset = await enableFile(await uploadVersion(folderUrl, file))
	if (asset.assetId !== assetId) {
		await stackVersion(asset.versionId, assetId)
	}
	handInWaveform(file, asset)
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
