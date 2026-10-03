/**
 * What kind of media a Version is. Stills (story 95) have one Frame, no
 * timeline and no timecode; everything anchors to Frame 0.
 */

const STILL = /^image\/(png|jpeg|webp|gif|avif)$/

/**
 * @param {string|undefined} mimeType - a file's type
 * @return {boolean} whether Deliver reviews it: video, audio or a still
 */
export const reviewable = (mimeType) => /^(video|audio)\//.test(mimeType ?? '') || STILL.test(mimeType ?? '')

/**
 * A Version Stack holds one kind only: a cut as .mov stacks on one as .mp4,
 * a mix never on a cut of the same name.
 *
 * @param {string|null|undefined} mimeType - a file's type
 * @return {string|null} video, audio or image; null when unknown, such as a Missing file
 */
export const mediaKind = (mimeType) => !mimeType ? null : STILL.test(mimeType) ? 'image' : mimeType.split('/')[0]

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
