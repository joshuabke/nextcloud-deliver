/**
 * A loudness meter in a worker of its own, inlined as a blob, which
 * Deliver's pages and the Files app's allow; on the page where no worker can
 * be made (A10)
 */

import LoudnessWorker from './loudness.worker.js?worker&inline'
import { localMeter, remoteMeter } from './loudnessPort.js'

/**
 * @param {?number[]} layout - one weight a channel where the file says where they are; else by their count
 * @return {{add: (channels: Float32Array[], sampleRate: number) => Promise<void>, done: () => Promise<?object>}} the meter
 */
export function meterOffPage(layout = null) {
	try {
		const worker = new LoudnessWorker()
		return remoteMeter(worker, () => worker.terminate(), layout)
	} catch {
		return localMeter(layout)
	}
}
