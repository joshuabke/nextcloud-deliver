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
 * @param {{mimeType?: string}|null} version - a Version as the API describes it
 * @return {boolean} whether it is a still
 */
export const isStill = (version) => STILL.test(version?.mimeType ?? '')
