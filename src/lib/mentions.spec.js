import { describe, expect, it } from 'vitest'
import { insertMention, mentionAt, mentionToken, splitMentions } from './mentions.js'

describe('mentions', () => {
	it('writes user ids the way the server reads them', () => {
		expect(mentionToken('anna')).toBe('@anna')
		expect(mentionToken('Jo Smith')).toBe('@"Jo Smith"')
		expect(mentionToken('ends.')).toBe('@"ends."')
	})

	it('notices a mention being typed', () => {
		expect(mentionAt('hi @an', 6)).toEqual({ start: 3, query: 'an' })
		expect(mentionAt('@', 1)).toEqual({ start: 0, query: '' })
		expect(mentionAt('mail jo@ex', 10)).toBeNull()
		expect(mentionAt('hi @an there', 12)).toBeNull()
	})

	it('puts the chosen user in and moves the caret after it', () => {
		expect(insertMention('hi @an!', { start: 3 }, 6, 'anna')).toEqual({ text: 'hi @anna !', caret: 9 })
	})

	it('shows mentions by name, and leaves unknown ones as written', () => {
		const names = { anna: 'Anna Berg', 'Jo Smith': 'Jo S.' }
		expect(splitMentions('thanks @anna. @"Jo Smith" and @nobody', names)).toEqual([
			{ text: 'thanks ' },
			{ text: '@Anna Berg', mention: 'anna' },
			{ text: '. ' },
			{ text: '@Jo S.', mention: 'Jo Smith' },
			{ text: ' and @nobody' },
		])
	})
})
