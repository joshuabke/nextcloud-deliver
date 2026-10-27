import { t as translate, n as translatePlural } from '@nextcloud/l10n'

/*
 * t() and n() as @nextcloud/l10n has them, minus its HTML escaping and
 * sanitising: Vue escapes every text and attribute it renders, so a name
 * such as "Smith & Co" would show as "Smith &amp; Co" (#93). Nothing in
 * Deliver renders a translation as HTML.
 */
const RAW = { escape: false, sanitize: false }

/**
 * @param {string} app - the app id
 * @param {string} text - the English source string
 * @param {object} [vars] - the placeholders' values
 * @param {number} [count] - for %n
 * @return {string} the translation, placeholders filled in as they are
 */
export function t(app, text, vars, count) {
	return translate(app, text, vars, count, RAW)
}

/**
 * @param {string} app - the app id
 * @param {string} singular - the English source string for one
 * @param {string} plural - the English source string for several
 * @param {number} count - how many
 * @param {object} [vars] - the placeholders' values
 * @return {string} the translation, placeholders filled in as they are
 */
export function n(app, singular, plural, count, vars) {
	return translatePlural(app, singular, plural, count, vars, RAW)
}
