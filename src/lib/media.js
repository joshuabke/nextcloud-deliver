/**
 * What kind of media a Version is. Stills (story 95) have one Frame, no
 * timeline and no timecode; everything anchors to Frame 0.
 */

const STILL = /^image\/(png|jpeg|webp|gif|avif)$/
/** Playlists, which Nextcloud files under audio but which only point at other files (Reviewable on the server) */
const PLAYLISTS = ['audio/mpegurl', 'audio/x-mpegurl', 'audio/x-scpls']

/**
 * @param {string|undefined} mimeType - a file's type
 * @return {boolean} whether Deliver reviews it: video, audio or a still
 */
export const reviewable = (mimeType) => (/^(video|audio)\//.test(mimeType ?? '') && !PLAYLISTS.includes(mimeType)) || STILL.test(mimeType ?? '')

/**
 * A Version Stack holds one kind only: a cut as .mov stacks on one as .mp4,
 * a mix never on a cut of the same name.
 *
 * @param {string|null|undefined} mimeType - a file's type
 * @return {string|null} video, audio or image; null when unknown, such as a Missing file
 */
export const mediaKind = (mimeType) => !mimeType ? null : STILL.test(mimeType) ? 'image' : mimeType.split('/')[0]

/**
 * @param {Array<{mimeType?: string|null}>} versions - a Version Stack
 * @return {string|null} the kind of media it holds, going by any Version whose file is there; null when none is
 */
export const stackKind = (versions) => mediaKind(versions.find((version) => version.mimeType)?.mimeType)

/**
 * @param {string|null|undefined} mimeType - a file's type
 * @return {string} what a file input for the next Version of it accepts
 */
export const acceptFor = (mimeType) => mediaKind(mimeType) ? mediaKind(mimeType) + '/*' : 'video/*,audio/*,image/*'

/**
 * @param {{mimeType?: string}|null} version - a Version as the API describes it
 * @return {boolean} whether it is a still
 */
export const isStill = (version) => STILL.test(version?.mimeType ?? '')

/**
 * Nextcloud reads a file's type from its name, so a rename keeps the extension (story 131)
 *
 * @param {string} name - a filename
 * @return {string} its extension with the dot, lower case; '' for none
 */
export const extensionOf = (name) => name.lastIndexOf('.') > 0 ? name.slice(name.lastIndexOf('.')).toLowerCase() : ''
