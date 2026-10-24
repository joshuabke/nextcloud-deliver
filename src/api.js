import { getCurrentUser } from '@nextcloud/auth'
import axios from '@nextcloud/axios'
import { getLanguage, t } from '@nextcloud/l10n'
import { generateOcsUrl, generateRemoteUrl, generateUrl } from '@nextcloud/router'
import { baseLanguage } from './lib/language.js'
import { fileIdAt } from './lib/upload.js'
import { decodeWaveform } from './lib/waveform.js'

/** Set on the public review page; Members leave it null and use the OCS API */
let publicBase = null

/**
 * Sends every following call through a Review Link instead of the OCS API.
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
// A Reviewer's own rights on one link they are on, null each to leave it to the link (ADR 0014)
// Puts a Reviewer on another link of the Project with a Personal Link of its own, or takes them off one (story 55, ADR 0014)
export const putReviewerOn = (id, token) => axios.post(url(`/reviewers/${id}/links`), { token }).then(data)
export const takeReviewerOff = (id, token) => axios.delete(url(`/reviewers/${id}/links/${token}`)).then(data)
export const setReviewerRights = (id, token, rights) => axios.put(url(`/reviewers/${id}/rights`), { token, rights }).then(data)
export const renewReviewerKey = (id) => axios.post(url(`/reviewers/${id}/key`)).then(data)
export const removeReviewer = (id) => axios.delete(url(`/reviewers/${id}`)).then(data)
// Whether the Reviewer went into the Member's Contacts or was there already (#66)
export const saveReviewerContact = (id) => axios.post(url(`/reviewers/${id}/contact`)).then(data)
// One person on a Review Link of their own: {name, email, sendMail, message, assetIds} and the link's rights (story 145)
export const inviteToProject = (projectId, fields) => axios.post(url(`/projects/${projectId}/invitations`), fields).then(data)
export const searchContacts = (search) => axios.get(url('/contacts'), { params: { search } }).then(data)
export const getSettings = () => axios.get(url('/settings')).then(data)
export const updateSettings = (settings) => axios.put(url('/settings'), settings).then(data)
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
 * @param {?number} assetId - the Asset it becomes the next Version of, instead of an Asset of its own
 * @return {Promise<object>} the Asset as the Files sidebar shows it
 */
export const enableFile = (fileId, projectId = null, assetId = null) => axios.post(url('/assets'), { fileId, projectId, assetId }).then(data)
// Puts an Asset into a Project, or into No Project for 0; no file moves
export const assignAsset = (id, projectId) => axios.put(url(`/assets/${id}/project`), { projectId }).then(data)
export const updateAsset = (id, fields) => axios.put(url(`/assets/${id}`), fields).then(data)
export const disableAsset = (id) => axios.delete(url(`/assets/${id}`))
/**
 * The Asset's files go to the trash of Files, the Asset with its review data at once (story 141)
 *
 * @param {number} id - the Asset
 * @return {Promise<object>} the server's answer
 */
export const deleteAsset = (id) => axios.delete(url(`/assets/${id}/files`))

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
 * @return {string} where the browser gets it, through the Review Link on the public page
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
 * Decodes a file's Waveform after the ones before it, one at a time, so a
 * batch of long mixes is not in memory at once.
 *
 * @param {Blob} file - an audio file
 * @param {(percent: number) => void} onProgress - how far it is
 * @return {Promise<{peaks: number[], seconds: number}>} its Waveform
 */
export function decodeInTurn(file, onProgress) {
	const turn = decoding.then(() => decodeWaveform(file, onProgress))
	decoding = turn.catch(() => {})
	return turn
}

/**
 * @param {number} versionId - an audio Version
 * @param {{peaks: number[], seconds: number}} decoded - its Waveform; audio counts in milliseconds (ADR 0007), also before the probe ran
 * @return {Promise<object>} the server's answer
 */
export const giveAudioWaveform = (versionId, { peaks, seconds }) => giveWaveform(versionId, peaks, Math.max(1, Math.round(seconds * 1000)))

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
	if (asset.waveformFromBrowser) {
		decodeInTurn(file).then((decoded) => giveAudioWaveform(asset.versionId, decoded)).catch(() => {})
	}
}
export const markSeen = (versionId, at) => axios.post(url(`/versions/${versionId}/seen`), { at }).then(data)

// Review Links (ADR 0010, 0011): a whole Project or picked Assets; on No Project (id 0) picked Assets of it
export const listReviewLinks = (projectId) => axios.get(url(`/projects/${projectId}/links`)).then(data)
export const createReviewLink = (projectId, assetIds = null) => axios.post(url(`/projects/${projectId}/links`), { assetIds }).then(data)

/**
 * What a link's settings, Reviewers and activity go through
 *
 * @param {{id: number}} link - a Review Link
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
 * Makes a folder in the Member's Files, for a new Project to upload into
 * (story 98), and the folders above it that are missing. One that is there
 * already by that name is taken as it is.
 *
 * @param {string} path - from the Member's home, such as /Clients/Spot
 * @return {Promise<number>} its file id
 */
export async function makeFolder(path) {
	const parts = path.split('/').filter(Boolean)
	// The browser would resolve . and .. in the URL, and the Project would get a folder above the one meant
	if (parts.some((part) => part === '.' || part === '..')) {
		throw new Error(t('deliver', 'A folder cannot be called . or ..'))
	}
	let dav = generateRemoteUrl('dav') + '/files/' + encodeURIComponent(getCurrentUser()?.uid ?? '')
	// The folders above it too, such as the default /Deliver on its first use
	for (const part of parts) {
		dav += '/' + encodeURIComponent(part)
		await axios.request({ method: 'MKCOL', url: dav }).catch((error) => {
			if (error.response?.status !== 405) {
				throw error
			}
		})
	}
	return await fileIdAt(axios.request, dav) ?? Promise.reject(new Error(t('deliver', 'The folder could not be made.')))
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
