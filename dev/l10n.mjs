// Keeps the shipped translations complete. The English source strings are
// read from every t()/n() call in src/ and lib/; each l10n/<lang>.json must
// translate all of them. `node dev/l10n.mjs` checks and fails on gaps,
// `node dev/l10n.mjs write` also regenerates l10n/<lang>.js from the JSON,
// which is the file to edit.
/* eslint-disable no-console -- a command line tool reports on the console */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const LANGUAGES = ['de', 'de_DE']
const root = join(import.meta.dirname, '..')

/**
 * @param {string} dir - where to look
 * @param {string[]} endings - file name endings to take
 * @return {string[]} every file below the folder with one of the endings, specs left out
 */
function files(dir, endings) {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name)
		if (statSync(path).isDirectory()) {
			return files(path, endings)
		}
		return endings.some((ending) => name.endsWith(ending)) && !name.includes('.spec.') ? [path] : []
	})
}

/** A quoted string literal, single or double, with its escapes undone */
const LITERAL = String.raw`('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")`
const unquote = (literal) => literal.slice(1, -1).replace(/\\(.)/g, '$1')

/** @return {Set<string>} the source strings, plurals as Nextcloud keys them */
export function sourceStrings() {
	const found = new Set()
	for (const path of files(join(root, 'src'), ['.js', '.vue'])) {
		const code = readFileSync(path, 'utf8')
		for (const match of code.matchAll(new RegExp(String.raw`\bt\(\s*'deliver',\s*` + LITERAL, 'g'))) {
			found.add(unquote(match[1]))
		}
		for (const match of code.matchAll(new RegExp(String.raw`\bn\(\s*'deliver',\s*` + LITERAL + String.raw`,\s*` + LITERAL, 'g'))) {
			found.add(`_${unquote(match[1])}_::_${unquote(match[2])}_`)
		}
	}
	for (const path of files(join(root, 'lib'), ['.php'])) {
		const code = readFileSync(path, 'utf8')
		for (const match of code.matchAll(new RegExp(String.raw`->t\(\s*` + LITERAL, 'g'))) {
			found.add(unquote(match[1]))
		}
		for (const match of code.matchAll(new RegExp(String.raw`->n\(\s*` + LITERAL + String.raw`,\s*` + LITERAL, 'g'))) {
			found.add(`_${unquote(match[1])}_::_${unquote(match[2])}_`)
		}
	}
	return found
}

const sources = sourceStrings()
let failed = false
for (const language of LANGUAGES) {
	const file = JSON.parse(readFileSync(join(root, 'l10n', language + '.json'), 'utf8'))
	const translations = file.translations
	const missing = [...sources].filter((key) => !(key in translations))
	const stale = Object.keys(translations).filter((key) => !sources.has(key))
	for (const key of missing) {
		console.error(`${language}: missing "${key}"`)
	}
	for (const key of stale) {
		console.error(`${language}: no longer in the source "${key}"`)
	}
	failed ||= missing.length > 0 || stale.length > 0
	if (process.argv[2] === 'write') {
		writeFileSync(
			join(root, 'l10n', language + '.js'),
			`OC.L10N.register(\n\t"deliver",\n\t${JSON.stringify(translations, null, '\t').replace(/\n/g, '\n\t')},\n\t${JSON.stringify(file.pluralForm)}\n);\n`,
		)
	}
}
console.log(`${sources.size} source strings, ${LANGUAGES.join(' and ')} ${failed ? 'incomplete' : 'complete'}`)
process.exit(failed ? 1 : 0)
