import { day } from './day.js'

/**
 * @param {{deliveredBy?: {name: string}, createdAt?: number}} version - a Version as a Member's Review view has it
 * @return {string} "Anna · Oct 26", only the date with nobody; empty on a Review Link, which tells neither
 */
export function delivered(version) {
	return [
		version.deliveredBy?.name,
		version.createdAt && day(version.createdAt),
	].filter(Boolean).join(' · ')
}
