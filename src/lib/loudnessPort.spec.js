import { afterEach, describe, expect, it, vi } from 'vitest'
import { loudnessMeter } from './loudness.js'
import { localMeter, remoteMeter, serveMeter } from './loudnessPort.js'

const RATE = 48000
function piece(db, frames = 4800) {
	const amplitude = 10 ** (db / 20)
	const samples = Float32Array.from({ length: frames }, (_, n) => amplitude * Math.sin(2 * Math.PI * 1000 * n / RATE))
	return [samples, samples.slice()]
}

afterEach(() => {
	vi.useRealTimers()
})

describe('the meter in a worker', () => {
	it('measures what the meter on the page measures, its pieces handed over', async () => {
		const { port1, port2 } = new MessageChannel()
		serveMeter(port2)
		let closed = false
		const remote = remoteMeter(port1, () => {
			closed = true
		})
		const local = loudnessMeter()
		for (let i = 0; i < 50; i++) {
			const channels = piece(-23)
			local.add(channels.map((samples) => samples.slice()), RATE)
			await remote.add(channels, RATE)
			expect(channels[0].length).toBe(0)
		}
		expect(await remote.done()).toEqual(local.done())
		expect(closed).toBe(true)
		port1.close()
	})

	it('needs no timer at all, so a hidden tab does not hold it back', async () => {
		vi.useFakeTimers()
		const { port1, port2 } = new MessageChannel()
		serveMeter(port2)
		const remote = remoteMeter(port1)
		for (let i = 0; i < 40; i++) {
			await remote.add(piece(-23), RATE)
		}
		expect((await remote.done()).integrated).toBeCloseTo(-23, 1)
		port1.close()
	})

	it('lets the decode wait once eight pieces are on their way, until the worker answers', async () => {
		const sent = []
		const port = { postMessage: (message) => sent.push(message), onmessage: null }
		const remote = remoteMeter(port)
		for (let i = 0; i < 7; i++) {
			await remote.add(piece(-23, 10), RATE)
		}
		let through = false
		const eighth = remote.add(piece(-23, 10), RATE).then(() => {
			through = true
		})
		await new Promise((resolve) => setImmediate(resolve))
		expect(through).toBe(false)
		port.onmessage({ data: { type: 'ack' } })
		await eighth
		expect(through).toBe(true)
		expect(sent).toHaveLength(8)
	})

	it('lets the decode run on to its end where the worker fails before the end is asked', async () => {
		const port = { postMessage: () => {}, onmessage: null, onerror: null }
		const remote = remoteMeter(port)
		for (let i = 0; i < 3; i++) {
			await remote.add(piece(-23, 10), RATE)
		}
		port.onerror()
		// Twenty more pieces after the failure: none waits
		for (let i = 0; i < 20; i++) {
			await remote.add(piece(-23, 10), RATE)
		}
		expect(await remote.done()).toBeNull()
	})

	it('answers no loudness where the worker fails while the end is awaited', async () => {
		const port = { postMessage: () => {}, onmessage: null, onerror: null }
		const remote = remoteMeter(port)
		await remote.add(piece(-23, 10), RATE)
		const result = remote.done()
		port.onerror()
		expect(await result).toBeNull()
	})

	it('gives no loudness where the worker fails, and lets the decode go on', async () => {
		const port = { postMessage: () => {}, onmessage: null, onerror: null }
		const remote = remoteMeter(port)
		for (let i = 0; i < 7; i++) {
			await remote.add(piece(-23, 10), RATE)
		}
		const waiting = remote.add(piece(-23, 10), RATE)
		const result = remote.done()
		port.onerror()
		await waiting
		expect(await result).toBeNull()
	})
})

describe('the meter on the page, where no worker can be made', () => {
	it('answers the same, without pausing', async () => {
		const meter = localMeter()
		await meter.add(piece(-23, RATE * 2), RATE)
		expect((await meter.done()).integrated).toBeCloseTo(-23, 1)
	})
})
