import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { isStill } from '../lib/media.js'

/** How long to wait before asking again while derived media is being made */
const DERIVED_RECHECK = 10000

/**
 * What the Member and the public Review view share: where a new Comment lands,
 * the time display, and a context that refreshes itself while derived media
 * is on its way.
 *
 * @param {object} options - the view's state
 * @param {import('vue').Ref<object|null>} options.version - the Version on screen
 * @param {import('vue').Ref<string>} options.projectMode - the Project's timecode display
 * @param {() => Promise<void>} options.refresh - reloads the view's context
 */
export function useReview({ version, projectMode, refresh }) {
	const player = ref(null)
	const panel = ref(null)
	/** Session-local override of the Project's timecode display (story 22) */
	const mode = ref(projectMode.value)
	watch(projectMode, (value) => {
		mode.value = value
	})

	const clock = computed(() => ({
		fps: version.value?.fps ?? { num: 25, den: 1 },
		mode: mode.value,
		startFrame: version.value?.startFrame ?? 0,
		dropFrame: version.value?.dropFrame ?? false,
		/** A still has no time to show (story 95) */
		still: isStill(version.value),
	}))

	/**
	 * Set by C, the Comment button, or the first keystroke in the Comment
	 * field; until then a new Comment lands where the player stands.
	 */
	const pinned = ref(null)
	/** Whether typing set the pin, so emptying the field lets go of it again */
	let pinnedByTyping = false
	const anchor = computed(() => pinned.value ?? { inFrame: player.value?.frame ?? 0, outFrame: null })
	/** Drawing on the picture, and the shapes drawn so far for the next Comment (story 89) */
	const drawing = ref(false)
	const draft = ref([])
	watch(() => version.value?.id, () => {
		pinned.value = null
		pinnedByTyping = false
		drawing.value = false
		draft.value = []
	})

	/** Drawing stops the picture and fixes the Frame the Comment goes to */
	function draw() {
		if (drawing.value) {
			drawing.value = false
			return
		}
		player.value?.pause()
		if (pinned.value === null) {
			pinned.value = { inFrame: player.value?.frame ?? 0, outFrame: null }
		}
		drawing.value = true
	}

	/**
	 * @param {{inFrame: number, outFrame: ?number}} where - the Frame or Range to comment on
	 */
	function pin(where) {
		pinnedByTyping = false
		pinned.value = where
		panel.value?.focus()
	}

	/**
	 * @param {{inFrame: number}} comment - the Comment to seek to
	 */
	function jump(comment) {
		if (player.value?.show) {
			player.value.show(comment)
		} else {
			player.value?.seekTo(comment.inFrame)
		}
	}

	/**
	 * Typing started: the Comment belongs to the Frame on screen now, not to
	 * wherever the player is when it is sent.
	 */
	function hold() {
		if (pinned.value === null) {
			pinned.value = { inFrame: player.value?.frame ?? 0, outFrame: null }
			pinnedByTyping = true
		}
	}

	/** The field was emptied again: follow the player once more */
	function release() {
		if (pinnedByTyping) {
			pinned.value = null
			pinnedByTyping = false
		}
	}

	/** The pinned anchor is used up once its Comment is posted */
	function posted() {
		pinnedByTyping = false
		pinned.value = null
		drawing.value = false
		draft.value = []
	}

	let recheck = null
	watch(() => version.value?.derived, (derived) => {
		clearTimeout(recheck)
		const pending = ['proxy', 'thumbs', 'waveform'].some((kind) => ['queued', 'running'].includes(derived?.[kind]?.state))
		if (pending) {
			recheck = setTimeout(() => refresh().catch(() => {}), DERIVED_RECHECK)
		}
	}, { immediate: true })
	onBeforeUnmount(() => clearTimeout(recheck))

	return { player, panel, mode, clock, anchor, pin, hold, release, jump, posted, drawing, draft, draw }
}
