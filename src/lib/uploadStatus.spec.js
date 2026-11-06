import { describe, expect, it } from 'vitest'
import { advance, encodingEta, processingFailed, processingOf, proxyLine, settled, statusOf, timeLeft } from './uploadStatus.js'

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
		const decoding = processingOf({ ...done({ id: 1 }), waveform: { progress: 40, state: 'running' } })
		expect(decoding.map(({ label, text }) => [label, text])).toEqual([['Waveform', 'Decoding 40 %']])
	})

	it('shows the Proxy this browser makes instead of the server\'s report of it, until it is there', () => {
		const making = { ...done(derived({ proxy: 'running', thumbs: 'none' })), proxy: { progress: 40, state: 'running' } }
		expect(processingOf(making).map(({ kind, text }) => [kind, text])).toEqual([['browserProxy', 'Encoding 40 %']])
		expect(settled(making)).toBe(false)
		const uploading = { ...done(derived({ proxy: 'none' })), proxy: { progress: 10, state: 'uploading' } }
		expect(processingOf(uploading)[0].text).toBe('Upload 10 %')
		expect(processingOf(uploading)[0].label).toBe('Proxy')
		expect(settled(uploading)).toBe(false)
		const handing = { ...done(derived({ proxy: 'none' })), proxy: { progress: 100, state: 'handing' } }
		expect(processingOf(handing)[0].text).toBe('Finishing on the server')
		expect(settled(handing)).toBe(false)
		const failed = { ...done(derived({ proxy: 'none' })), proxy: { state: 'failed', error: 'No room' } }
		expect(processingOf(failed)[0].text).toBe('No room')
		const there = { ...done(derived({ proxy: 'ready' })), proxy: { progress: 100, state: 'ready' } }
		expect(processingOf(there).map(({ kind }) => kind)).toEqual(['proxy'])
		expect(settled(there)).toBe(true)
	})
})

describe('proxyLine', () => {
	it('names the phase after "Proxy", and says nothing without one', () => {
		expect(proxyLine({ state: 'running', progress: 40 })).toBe('Proxy: Encoding 40 %')
		expect(proxyLine({ state: 'checking' })).toBeNull()
		expect(proxyLine(undefined)).toBeNull()
	})

	it('names a pass without a Proxy after the derived media, and one taken over as stopped (#168)', () => {
		expect(proxyLine({ state: 'running', progress: 40, proxy: false })).toBe('Derived media: Encoding 40 %')
		expect(proxyLine({ state: 'stopped', proxy: true })).toBe('Proxy: Stopped')
	})
})

describe('encodingEta', () => {
	const since = 1_000_000
	const at = (progress, seconds) => encodingEta({ progress, since }, since + seconds * 1000)
	it('says nothing at 0 %, early or without a start', () => {
		expect(at(0, 30)).toBeNull()
		expect(at(2, 30)).toBeNull()
		expect(at(40, 3)).toBeNull()
		expect(encodingEta({ progress: 40 }, since)).toBeNull()
	})
	it('extrapolates a steady pace', () => {
		expect(at(40, 120)).toBe(180)
		expect(at(10, 10)).toBe(90)
	})
	it('says nothing at 99 %, and counts a second pass from its own start', () => {
		expect(at(99, 300)).toBeNull()
		expect(encodingEta({ progress: 50, since: since + 290_000 }, since + 300_000)).toBe(10)
	})
	it('is part of the running phase only', () => {
		// Off the minute boundary, so the milliseconds until proxyLine reads the clock do not round it up
		expect(proxyLine({ state: 'running', progress: 40, since: Date.now() - 100_000 })).toBe('Proxy: Encoding 40 % · 3 minutes left')
	})
})

describe('advance', () => {
	it('starts the estimate with the first report, also at 0, and keeps it on a repeated percent', () => {
		const status = { progress: 0 }
		advance(status, 0, 100)
		expect(status).toEqual({ progress: 0, since: 100 })
		advance(status, 0, 200)
		advance(status, 30, 300)
		advance(status, 30, 400)
		expect(status).toEqual({ progress: 30, since: 100 })
	})
	it('starts it again when the percent drops, for the second pass', () => {
		const status = { progress: 0 }
		advance(status, 80, 100)
		advance(status, 5, 900)
		expect(status).toEqual({ progress: 5, since: 900 })
	})
})
