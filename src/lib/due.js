/**
 * Due Dates (story 93) are calendar days, YYYY-MM-DD, compared as days.
 */

/**
 * @param {Date} date - a moment
 * @return {string} its calendar day where the browser is
 */
export function dayOf(date) {
	const pad = (n) => String(n).padStart(2, '0')
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * @param {string} due - the Due Date
 * @param {string} today - today's calendar day
 * @return {number} days until it; negative when it has passed
 */
export function daysUntil(due, today) {
	return Math.round((Date.UTC(...split(due)) - Date.UTC(...split(today))) / 86400000)
}

/**
 * @param {string} day - YYYY-MM-DD
 * @return {number[]} year, month from zero, day
 */
function split(day) {
	const [year, month, date] = day.split('-').map(Number)
	return [year, month - 1, date]
}

/**
 * @param {string} due - the Due Date
 * @param {string} today - today's calendar day
 * @return {'overdue'|'today'|'tomorrow'|'later'} how urgent it is
 */
export function urgency(due, today) {
	const days = daysUntil(due, today)
	return days < 0 ? 'overdue' : days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'later'
}
