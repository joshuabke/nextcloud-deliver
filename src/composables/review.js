import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { derivedPending, isStill } from '../lib/media.js'
import { useCommentsStore } from '../store/comments.js'
import { sheet } from './panel.js'

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
 * @param {import('vue').Ref<{num: number, den: number}>} options.projectFps - the Project's frame rate, at which audio is read as timecode
 * @param {() => Promise<void>} options.refresh - reloads the view's context
 * @param {import('vue').Ref<boolean>} options.collapsed - whether the Comment list is out of sight: on a desktop the panel closed, on a phone held sideways the list not beside the picture
 * @param {() => void} options.openPanel - brings the Comment list out
 */
export function useReview({ version, projectMode, projectFps, refresh, collapsed, openPanel }) {
	const player = ref(null)
	const panel = ref(null)
	/** The field at the Waveform, while it is open (N12) */
	const inline = ref(null)
	const store = useCommentsStore()
	/** Session-local override of the Project's timecode display (story 22); audio has its own, starting at milliseconds */
	const videoMode = ref(projectMode.value)
	const audioMode = ref('ms')
	watch(projectMode, (value) => {
		videoMode.value = value
	})
	const audio = computed(() => version.value?.audioOnly === true)
	const mode = computed({
		get: () => (audio.value ? audioMode : videoMode).value,
		set: (value) => {
			(audio.value ? audioMode : videoMode).value = value
		},
	})

	const clock = computed(() => ({
		fps: version.value?.fps ?? { num: 25, den: 1 },
		displayFps: audio.value ? projectFps.value : undefined,
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
	/** A place on audio pinned by C, a double click or a long press: let go again while nothing is written (story 181) */
	let loose = false
	/** Whether the field holds text */
	let written = false
	const anchor = computed(() => pinned.value ?? { inFrame: player.value?.frame ?? 0, outFrame: null })
	/** Drawing on the picture, and the shapes drawn so far for the next Comment (story 89) */
	const drawing = ref(false)
	const draft = ref([])
	watch(() => version.value?.id, () => {
		pinned.value = null
		pinnedByTyping = false
		loose = false
		written = false
		// A Comment half written belongs to its Version, as the field under the list did when it went with the view
		store.draft = { body: '', files: [] }
		drawing.value = false
		draft.value = []
		player.value?.clearRange?.()
	})

	/** Drawing stops the picture and fixes the Frame the Comment goes to */
	function draw() {
		if (drawing.value) {
			drawing.value = false
			return
		}
		player.value?.pause()
		pinned.value ??= anchor.value
		drawing.value = true
	}

	/**
	 * Whether the field is open at the Waveform: on audio with its Waveform
	 * while the Comment list is out of sight, a Comment begins there instead
	 * of bringing the list out (N12)
	 */
	const composing = ref(false)

	/**
	 * The field gets the focus once a hidden panel is out; on a phone held
	 * sideways the list comes out beside the picture for it
	 *
	 * @param {{inFrame: number, outFrame: ?number}} where - the Frame or Range to comment on
	 */
	function pin(where) {
		pinnedByTyping = false
		loose = audio.value && where.outFrame === null
		pinned.value = where
		if (composing.value) {
			nextTick(() => inline.value?.focus())
			return
		}
		sheet.aside.value = true
		nextTick(() => panel.value?.focus())
	}

	/**
	 * C, the Comment button, a double click or a long press on the Waveform
	 *
	 * @param {{inFrame: number, outFrame: ?number}} where - the Frame or Range to comment on
	 */
	function startComment(where) {
		if (audio.value && version.value?.derived?.waveform?.state === 'ready' && collapsed?.value) {
			composing.value = true
		} else {
			openPanel?.()
		}
		pin(where)
	}

	/** The field at the Waveform closes by itself once its place is let go or used up; opening the list takes the Comment there */
	watch(pinned, (place) => {
		if (place === null) {
			composing.value = false
		}
	})
	watch(() => collapsed?.value, (now) => {
		if (!now && composing.value) {
			composing.value = false
			nextTick(() => panel.value?.focus())
		}
	})

	/** The field at the Waveform is closed from there: Escape, a click outside, a Comment's card; its place goes with an empty field */
	function closeInline() {
		composing.value = false
		letGo()
	}

	// The first keystroke fixes where the Comment goes; emptying the field undoes that, whichever field it is
	watch(() => store.draft.body.trim() === '', (empty, wasEmpty) => {
		if (!empty && wasEmpty !== false) {
			hold()
		} else if (empty && wasEmpty === false) {
			release()
		}
	}, { immediate: true })

	/**
	 * @param {{inFrame: number}} comment - the Comment to seek to
	 */
	function jump(comment) {
		// On a phone a list in place of the picture steps down, so the Frame shows above it
		if (sheet.level.value === 2) {
			sheet.level.value = 1
		}
		panel.value?.reveal(comment.id)
		// A Comment is read standing still
		player.value?.pause?.()
		if (player.value?.show) {
			player.value.show(comment)
		} else {
			player.value?.seekTo(comment.inFrame)
		}
	}

	/**
	 * Typing started: the picture stops, as with C, and the Comment belongs to
	 * the Frame on screen now, not to wherever the player is when it is sent.
	 * Audio plays on while it is commented on (story 181).
	 */
	function hold() {
		written = true
		if (pinned.value === null) {
			if (!audio.value) {
				player.value?.pause()
			}
			pinned.value = anchor.value
			pinnedByTyping = true
		}
	}

	/** The field was emptied again: follow the player once more */
	function release() {
		written = false
		// The field at the Waveform keeps its place while it is open, empty or not (N12a)
		if ((pinnedByTyping || loose) && !composing.value) {
			pinned.value = null
			pinnedByTyping = false
			loose = false
		}
	}

	/**
	 * Escape or leaving the empty field, or a seek: a place on audio pinned
	 * without a word written is let go, and the next Comment follows the player
	 * again; once something is written it stays until sent or emptied
	 */
	function letGo() {
		if (loose && !written) {
			pinned.value = null
			loose = false
		}
	}

	/** The Range being marked in the player, while it has one (story 107) */
	const range = computed(() => player.value?.range ?? null)

	/** The Range button: first its start at the Frame on screen, then its end, which pins it */
	function markRange() {
		if (range.value === null) {
			player.value?.markIn()
			return
		}
		player.value.markOut()
		pin(player.value.range)
	}

	/** Drops the Range, and a pin on it; the field at the Waveform keeps a place, the Range's start (N12a) */
	function clearRange() {
		player.value?.clearRange()
		if (pinned.value && pinned.value.outFrame !== null) {
			if (composing.value) {
				pinned.value = { inFrame: pinned.value.inFrame, outFrame: null }
				loose = true
			} else {
				pinned.value = null
			}
		}
	}

	/** The pinned anchor is used up once its Comment is posted */
	function posted() {
		pinnedByTyping = false
		loose = false
		written = false
		pinned.value = null
		drawing.value = false
		draft.value = []
	}

	let recheck = null
	// A refresh brings a new derived object, so this asks again for as long as the server is at it
	watch(() => version.value?.derived, () => {
		clearTimeout(recheck)
		if (derivedPending(version.value)) {
			recheck = setTimeout(() => refresh().catch(() => {}), DERIVED_RECHECK)
		}
	}, { immediate: true })
	onBeforeUnmount(() => {
		clearTimeout(recheck)
		store.draft = { body: '', files: [] }
	})

	return { player, panel, inline, composing, startComment, closeInline, mode, clock, anchor, pinned, pin, hold, release, letGo, jump, posted, drawing, draft, draw, range, markRange, clearRange }
}
