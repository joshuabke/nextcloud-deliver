/**
 * @return {(task: () => Promise<unknown>) => Promise<unknown>} runs each task after the ones given before it, one at a time; a task that fails does not hold up the next
 */
export function inTurnQueue() {
	let last = Promise.resolve()
	return (task) => {
		const turn = last.then(task)
		last = turn.catch(() => {})
		return turn
	}
}
