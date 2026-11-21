/**
 * The loudness meter off the page (decision A10): the decode loop posts each
 * decoded piece to a worker that keeps the meter and answers at the end, so
 * the true peak's work neither holds up the page nor waits for a hidden
 * tab's timers. A bounded number of pieces is on its way at a time: the loop
 * waits for the worker's acknowledgement, a message, not a timer. A worker
 * that fails, with an error event, gives no loudness and holds up nothing.
 * ponytail: a worker that stops answering without any event would hold the
 * decode at its eighth piece; no timer guards it, as a hidden tab would
 * stretch one, and browsers report a worker's crash as an error.
 */

import { loudnessMeter } from './loudness.js'

/** Pieces on their way to the worker at most, before the decode waits */
const IN_FLIGHT = 8

/**
 * The worker's side: keeps a meter and answers each piece with an acknowledgement
 *
 * @param {{postMessage: (message: object, transfer?: Transferable[]) => void, onmessage: ?((event: {data: object}) => void)}} port - the worker's global scope, or one end of a MessageChannel
 */
export function serveMeter(port) {
	let meter = loudnessMeter()
	port.onmessage = ({ data }) => {
		if (data.type === 'layout') {
			meter = loudnessMeter(data.weights)
		} else if (data.type === 'add') {
			meter.add(data.channels, data.sampleRate)
			port.postMessage({ type: 'ack' })
		} else if (data.type === 'done') {
			port.postMessage({ type: 'done', loudness: meter.done() })
		}
	}
}

/**
 * The page's side: hands each piece over, its buffers transferred, as the
 * decode no longer needs them once the peaks are taken
 *
 * @param {{postMessage: (message: object, transfer?: Transferable[]) => void, onmessage: ?((event: {data: object}) => void)}} port - the worker, or the other end of a MessageChannel
 * @param {() => void} close - ends the worker once it has answered
 * @param {?number[]} layout - one weight a channel where the file says where they are; else by their count
 * @return {{add: (channels: Float32Array[], sampleRate: number) => Promise<void>, done: () => Promise<?object>, close: () => void}} the meter, as loudnessMeter's but answering in promises; close ends it unanswered
 */
export function remoteMeter(port, close = () => {}, layout = null) {
	let inFlight = 0
	let room = null
	let finish = null
	let failed = false
	// A worker that fails measures nothing: from then on every piece goes nowhere at once and the answer is no loudness, so the decode goes on and ends
	const fail = () => {
		failed = true
		close()
		room?.()
		room = null
		finish?.(null)
		finish = null
	}
	port.onerror = fail
	port.onmessageerror = fail
	if (layout) {
		port.postMessage({ type: 'layout', weights: layout })
	}
	port.onmessage = ({ data }) => {
		if (data.type === 'ack') {
			inFlight--
			room?.()
			room = null
		} else if (data.type === 'done') {
			close()
			finish?.(data.loudness)
			finish = null
		}
	}
	return {
		async add(channels, sampleRate) {
			if (failed) {
				return
			}
			port.postMessage({ type: 'add', channels, sampleRate }, channels.map((samples) => samples.buffer))
			inFlight++
			if (inFlight >= IN_FLIGHT) {
				await new Promise((resolve) => {
					room = resolve
				})
			}
		},
		done() {
			if (failed) {
				return Promise.resolve(null)
			}
			return new Promise((resolve) => {
				finish = resolve
				port.postMessage({ type: 'done' })
			})
		},
		close,
	}
}

/**
 * The meter on the page, where no worker can be made: the same answers, no pauses
 *
 * @param {?number[]} layout - one weight a channel where the file says where they are; else by their count
 * @return {{add: (channels: Float32Array[], sampleRate: number) => Promise<void>, done: () => Promise<?object>, close: () => void}} the meter
 */
export function localMeter(layout = null) {
	const meter = loudnessMeter(layout)
	return {
		add: async (channels, sampleRate) => meter.add(channels, sampleRate),
		done: async () => meter.done(),
		close: () => {},
	}
}
