/**
 * A loudness meter in a worker of its own, inlined as a blob, which
 * Deliver's pages and the Files app's allow; on the page where no worker can
 * be made (A10)
 */

import LoudnessWorker from './loudness.worker.js?worker&inline'
import { localMeter, remoteMeter } from './loudnessPort.js'

/**
 * @return {{add: (channels: Float32Array[], sampleRate: number) => Promise<void>, done: () => Promise<?object>}} the meter
 */
export function meterOffPage() {
	try {
		const worker = new LoudnessWorker()
		return remoteMeter(worker, () => worker.terminate())
	} catch {
		return localMeter()
	}
}
