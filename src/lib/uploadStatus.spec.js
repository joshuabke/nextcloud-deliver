import { describe, expect, it } from 'vitest'
import { processingFailed, processingOf, settled, statusOf, timeLeft } from './uploadStatus.js'

const done = (version) => ({ status: 'done', loaded: 10, size: 10, version })
const derived = (states, fields = {}) => ({ playable: true, derived: { error: null, progress: null, ...Object.fromEntries(Object.entries(states).map(([kind, state]) => [kind, { state }])) }, ...fields })

describe('upload status', () => {
	it('is settled once nothing is queued or running and the server has read the file', () => {
		expect(settled(done({ id: 1 }))).toBe(false)
		expect(settled(done(derived({ proxy: 'running', thumbs: 'ready' })))).toBe(false)
		expect(settled(done(derived({ proxy: 'ready', thumbs: 'failed' })))).toBe(true)
		expect(settled(done(derived({ proxy: 'none' }, { playable: null })))).toBe(false)
	})

	it('counts a failed kind or a failed probe as failed processing', () => {
		expect(processingFailed(done(derived({ thumbs: 'failed' })))).toBe(true)
		expect(processingFailed(done({ playable: null, derived: { error: 'no ffprobe' } }))).toBe(true)
		expect(processingFailed(done(derived({ thumbs: 'ready' })))).toBe(false)
	})

	it('says how far an upload is, and that a finishing one is in the server\'s hands', () => {
		expect(statusOf({ status: 'uploading', loaded: 5, size: 10 })).toBe('50 %')
		expect(statusOf({ status: 'finishing', loaded: 10, size: 10 })).toBe('Finishing on the server')
		expect(statusOf({ status: 'elsewhere', phase: 'uploading', loaded: 3, size: 10 })).toBe('30 %, in another tab')
		expect(statusOf({ status: 'elsewhere', phase: 'finishing', loaded: 10, size: 10 })).toBe('Finishing on the server')
		expect(statusOf(done(derived({ proxy: 'ready' })))).toBe('Ready')
	})

	it('says the time left as people say it', () => {
		expect(timeLeft(null)).toBe('')
		expect(timeLeft(30)).toBe('less than a minute left')
		expect(timeLeft(3 * 3600 + 120)).toBe('3 h 2 min left')
	})

	it('marks what is made, so it can sit at the end of the status line', () => {
		const lines = processingOf(done(derived({ proxy: 'running', thumbs: 'ready' })))
		expect(lines.map(({ kind, done }) => [kind, done])).toEqual([['proxy', false], ['thumbs', true]])
		const browser = processingOf({ ...done({ id: 1 }), waveform: { progress: 100, state: 'ready' } })
		expect(browser.map(({ kind, done }) => [kind, done])).toEqual([['browser', true]])
	})
})
