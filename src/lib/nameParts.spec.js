import { describe, expect, it } from 'vitest'
import { nameParts } from './nameParts.js'

describe('nameParts', () => {
	it('keep the extension and six characters before it', () => {
		expect(nameParts('Franz Liszt - S.141, Grande Étude de Paganini No.2 V2.mp4'))
			.toEqual({ head: 'Franz Liszt - S.141, Grande Étude de Paganini N', tail: 'o.2 V2.mp4' })
		expect(nameParts('interview_rough_mix3.wav')).toEqual({ head: 'interview_roug', tail: 'h_mix3.wav' })
	})

	it('keep six characters of a name without an extension', () => {
		expect(nameParts('Festival submission')).toEqual({ head: 'Festival subm', tail: 'ission' })
		expect(nameParts('version 1.0 final cut')).toEqual({ head: 'version 1.0 fin', tail: 'al cut' })
	})

	it('take only the last extension, and none from a leading dot', () => {
		expect(nameParts('project_backup.tar.gz')).toEqual({ head: 'project_back', tail: 'up.tar.gz' })
		expect(nameParts('.hidden_settings')).toEqual({ head: '.hidden_se', tail: 'ttings' })
	})

	it('split no short stem', () => {
		expect(nameParts('mix.mp3')).toEqual({ head: '', tail: 'mix.mp3' })
		expect(nameParts('V2_end.mov')).toEqual({ head: '', tail: 'V2_end.mov' })
		expect(nameParts('')).toEqual({ head: '', tail: '' })
	})

	it('keep accents and emoji whole', () => {
		// É as E and a combining accent
		const decomposed = 'Grande Étude finale'.normalize('NFD')
		expect(nameParts(`x${decomposed}.mp4`).tail).toBe('finale.mp4')
		expect(nameParts('summer 👨‍👩‍👧 trip.mov')).toEqual({ head: 'summer ', tail: '👨‍👩‍👧 trip.mov' })
	})
})
