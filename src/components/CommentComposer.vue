<script setup>
import closeIcon from '@mdi/svg/svg/close.svg?raw'
import moreIcon from '@mdi/svg/svg/dots-horizontal.svg?raw'
import penIcon from '@mdi/svg/svg/draw.svg?raw'
import attachIcon from '@mdi/svg/svg/paperclip.svg?raw'
import rangeIcon from '@mdi/svg/svg/ray-start-end.svg?raw'
import sendIcon from '@mdi/svg/svg/send.svg?raw'
import { showError, TOAST_PERMANENT_TIMEOUT } from '@nextcloud/dialogs'
import { useIsMobile } from '@nextcloud/vue/composables/useIsMobile'
import { computed, markRaw, ref, watch } from 'vue'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcAvatar from '@nextcloud/vue/components/NcAvatar'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import { errorMessage } from '../api.js'
import { useBusy } from '../composables/busy.js'
import { sheet } from '../composables/panel.js'
import { fitting } from '../lib/attachments.js'
import { n, t } from '../lib/l10n.js'
import { insertMention, mentionAt } from '../lib/mentions.js'
import { formatRange } from '../lib/timecode.js'
import { useCommentsStore } from '../store/comments.js'

// The field a new Comment is written in, with its mentions, attachments, Range
// and Drawing: under the Comment list, and on audio with the list collapsed
// at the Waveform (N12). Its text and files are the store's draft, so both
// show the same Comment being written.

const props = defineProps({
	/** How time is shown: { fps, mode, startFrame, dropFrame } */
	clock: { type: Object, required: true },
	/** Where a new Comment lands: { inFrame, outFrame } */
	anchor: { type: Object, required: true },
	/** Shapes drawn on the picture for this Comment (story 89) */
	draft: { type: Array, default: () => [] },
	drawing: { type: Boolean, default: false },
	/** Who can be mentioned: [{ id, name }]; empty where nobody can (story 90) */
	members: { type: Array, default: () => [] },
	/** Whether this Version has a picture to draw on */
	canDraw: { type: Boolean, default: false },
	/** The Range being marked in the player, or null; a still has none (story 107) */
	range: { type: Object, default: null },
	/** At the Waveform rather than under the list: the layout does not make room for the keyboard */
	inline: { type: Boolean, default: false },
})

const emit = defineEmits(['posted', 'left', 'draw', 'range', 'clearRange'])

const store = useCommentsStore()
/** A phone has no keyboard shortcuts to hint at */
const isMobile = useIsMobile()
const fieldId = computed(() => props.inline ? 'deliver-comment-body-inline' : 'deliver-comment-body')
const body = computed({
	get: () => store.draft.body,
	set: (text) => {
		store.draft.body = text
	},
})
/** Files to attach to the next Comment (story 92) */
const files = computed({
	get: () => store.draft.files,
	// Files stay Files: a reactive proxy is no Blob to upload
	set: (picked) => {
		store.draft.files = picked.map((file) => markRaw(file))
	},
})
const { busy, error, run } = useBusy()
const input = ref(null)
const fileInput = ref(null)
const MAX_FILES = 5
/** The attachment limit in MB, as the server counts it */
const limitMb = computed(() => Math.floor(store.attachmentLimit / 1024 / 1024))
/** On a Review Link that takes Comments, a Reviewer gives a name first (story 54) */
const needsName = computed(() => store.me?.type === 'unnamed' && store.canComment !== false)
const readOnly = computed(() => store.canComment === false)
const anchorLabel = computed(() => formatRange(props.anchor, props.clock))

/**
 * @param {Event} event - the file input's change
 */
function pickFiles(event) {
	const picked = [...event.target.files]
	event.target.value = ''
	// The server counts all of one person's attachments on the Version, those already sent and those waiting here
	const used = [...store.comments.filter((comment) => store.mine(comment)).flatMap((comment) => comment.attachments ?? []), ...files.value]
		.reduce((sum, file) => sum + file.size, 0)
	const { fit, left } = fitting(picked.slice(0, MAX_FILES - files.value.length), used, store.attachmentLimit)
	if (left.length) {
		error.value = t('deliver', 'Attachments add up to at most {size} MB per person on a Version: {names}', { size: limitMb.value, names: left.map((file) => file.name).join(', ') })
	}
	files.value = [...files.value, ...fit]
}

/** The mention being typed, and the Members it could mean */
const typedMention = ref(null)
const highlighted = ref(0)
const suggestions = computed(() => {
	if (typedMention.value === null) {
		return []
	}
	const query = typedMention.value.query.toLowerCase()
	return props.members
		.filter((member) => store.me?.id !== member.id)
		.filter((member) => member.name.toLowerCase().includes(query) || member.id.toLowerCase().includes(query))
		.slice(0, 6)
})

/** Looks for a mention before the caret after every change of the field */
function onInput() {
	const field = input.value
	typedMention.value = props.members.length && field ? mentionAt(body.value, field.selectionStart) : null
	highlighted.value = 0
}

/**
 * @param {{id: string}} member - the one picked from the list
 */
function pickMention(member) {
	const field = input.value
	const { text, caret } = insertMention(body.value, typedMention.value, field.selectionStart, member.id)
	body.value = text
	typedMention.value = null
	requestAnimationFrame(() => {
		field.focus()
		field.setSelectionRange(caret, caret)
	})
}

watch(() => store.versionId, () => {
	error.value = null
})

defineExpose({ focus: () => input.value?.focus() })

const form = ref(null)
const root = ref(null)

/**
 * Leaving the composer lets go of an empty place (N11): the focus going
 * elsewhere on the page, not to the composer's own controls, their menus or a
 * file dialog, nor, at the Waveform, anywhere in its card (N12a)
 *
 * @param {FocusEvent} event - the focus leaves something in the composer
 */
function onFocusout(event) {
	const within = (props.inline && root.value?.closest('[role="dialog"]')) || root.value
	setTimeout(() => {
		const focus = document.activeElement
		if (!document.hasFocus() || within?.contains(focus) || focus?.closest?.('.v-popper__popper') || within?.contains(event.relatedTarget)) {
			return
		}
		emit('left')
	}, 0)
}

/** On a phone, writing makes room for the keyboard: the list steps aside (story 106). Only the text field starts it; a tap on a button beside it must not move the form under the finger */
function startWriting() {
	if (isMobile.value) {
		sheet.writing.value = true
	}
}

/** Leaving the field ends it, but only once a tap on Send or Attach has landed */
function stopWriting() {
	setTimeout(() => {
		if (!form.value?.contains(document.activeElement)) {
			sheet.writing.value = false
		}
	}, 150)
}

/** Posts the Comment at the anchor */
function submit() {
	if (!body.value.trim()) {
		return
	}
	return run(async () => {
		try {
			await store.add({ ...props.anchor, body: body.value, annotation: props.draft.length ? props.draft : null, files: files.value })
		} catch (e) {
			// Posted without an attachment is still posted
			if (!e.commentPosted) {
				throw e
			}
			const message = t('deliver', 'The Comment is posted, but {name} could not be attached: {reason}', { name: e.fileName, reason: errorMessage(e) })
			// At the Waveform the field closes with the Comment posted: the note stays as a toast until it is read
			if (props.inline) {
				showError(message, { timeout: TOAST_PERMANENT_TIMEOUT })
			} else {
				error.value = message
			}
		}
		body.value = ''
		files.value = []
		emit('posted')
	})
}

/**
 * Enter sends, Shift+Enter starts a new line
 *
 * @param {KeyboardEvent} event - the keystroke in the field
 */
function onKeydown(event) {
	if (suggestions.value.length) {
		const moves = { ArrowDown: 1, ArrowUp: -1 }
		if (event.key in moves) {
			event.preventDefault()
			highlighted.value = (highlighted.value + moves[event.key] + suggestions.value.length) % suggestions.value.length
			return
		}
		if (event.key === 'Enter' || event.key === 'Tab') {
			event.preventDefault()
			pickMention(suggestions.value[highlighted.value])
			return
		}
		if (event.key === 'Escape') {
			event.stopPropagation()
			typedMention.value = null
			return
		}
	}
	if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
		event.preventDefault()
		submit()
	}
	if (event.key === 'Escape') {
		emit('left')
	}
}
</script>

<template>
	<div
		ref="root"
		class="deliver-comments__composer"
		:class="{ 'deliver-comments__composer--inline': inline }"
		@focusout="onFocusout">
		<NcNoteCard v-if="error" type="error">
			{{ error }}
		</NcNoteCard>

		<p v-if="needsName" class="deliver-comments__readonly">
			{{ t('deliver', 'Give your name above to comment.') }}
		</p>

		<p v-else-if="readOnly" class="deliver-comments__readonly">
			{{ t('deliver', 'You can read the feedback on this Version, but not add to it.') }}
		</p>

		<form
			v-else
			ref="form"
			class="deliver-comments__form"
			@submit.prevent="submit"
			@focusout="stopWriting">
			<div class="deliver-comments__box" @click="input?.focus()">
				<label
					v-if="!clock.still"
					class="deliver-comments__anchor"
					:for="fieldId"
					:title="t('deliver', 'Where the Comment goes')">
					{{ anchorLabel }}
				</label>
				<textarea
					:id="fieldId"
					ref="input"
					v-model="body"
					rows="1"
					:placeholder="t('deliver', 'Leave a Comment…')"
					@keydown="onKeydown"
					@focus="inline || startWriting()"
					@input="onInput"
					@click="onInput" />
				<!-- A phone keeps the composer to one row: the tools in a menu, Send in the field -->
				<span v-if="isMobile" class="deliver-comments__inline" @click.stop>
					<NcActions variant="tertiary" :aria-label="t('deliver', 'Comment options')">
						<template #icon>
							<NcIconSvgWrapper :svg="moreIcon" />
						</template>
						<NcActionButton v-if="canDraw" closeAfterClick @click="emit('draw')">
							<template #icon>
								<NcIconSvgWrapper :svg="penIcon" />
							</template>
							{{ t('deliver', 'Draw on the picture') }}
						</NcActionButton>
						<template v-if="!clock.still">
							<NcActionButton closeAfterClick @click="emit('range')">
								<template #icon>
									<NcIconSvgWrapper :svg="rangeIcon" />
								</template>
								{{ range === null ? t('deliver', 'Start a Range here') : t('deliver', 'End the Range here') }}
							</NcActionButton>
							<NcActionButton v-if="range !== null" closeAfterClick @click="emit('clearRange')">
								<template #icon>
									<NcIconSvgWrapper :svg="closeIcon" />
								</template>
								{{ t('deliver', 'Clear the Range') }}
							</NcActionButton>
						</template>
						<NcActionButton :disabled="files.length >= MAX_FILES" closeAfterClick @click="fileInput.click()">
							<template #icon>
								<NcIconSvgWrapper :svg="attachIcon" />
							</template>
							{{ t('deliver', 'Attach files') }}
						</NcActionButton>
					</NcActions>
					<NcButton
						variant="primary"
						:disabled="busy || !body.trim()"
						:aria-label="t('deliver', 'Send (Enter)')"
						@click="submit">
						<template #icon>
							<NcIconSvgWrapper :svg="sendIcon" />
						</template>
					</NcButton>
				</span>
			</div>
			<ul v-if="files.length" class="deliver-comments__files">
				<li v-for="(file, index) in files" :key="index">
					<span>{{ file.name }}</span>
					<button type="button" :aria-label="t('deliver', 'Remove {name}', { name: file.name })" @click="files.splice(index, 1)">
						<NcIconSvgWrapper :svg="closeIcon" :size="14" inline />
					</button>
				</li>
			</ul>
			<ul v-if="suggestions.length" class="deliver-comments__mentions" role="listbox">
				<li
					v-for="(member, index) in suggestions"
					:key="member.id"
					role="option"
					:aria-selected="index === highlighted"
					@mousedown.prevent="pickMention(member)">
					<NcAvatar
						:user="member.id"
						:displayName="member.name"
						:size="22"
						hideStatus
						disableMenu
						disableTooltip />
					<span>{{ member.name }}</span>
				</li>
			</ul>
			<input
				ref="fileInput"
				type="file"
				multiple
				hidden
				@change="pickFiles">
			<div v-if="!isMobile || draft.length || clock.still" class="deliver-comments__actions">
				<NcButton
					v-if="canDraw && !isMobile"
					variant="tertiary"
					:pressed="drawing"
					:aria-label="t('deliver', 'Draw on the picture')"
					:title="t('deliver', 'Draw on the picture')"
					@click="emit('draw')">
					<template #icon>
						<NcIconSvgWrapper :svg="penIcon" />
					</template>
				</NcButton>
				<template v-if="!clock.still && !isMobile">
					<NcButton
						variant="tertiary"
						:pressed="range !== null"
						:aria-label="range === null ? t('deliver', 'Start a Range here') : t('deliver', 'End the Range here')"
						:title="range === null ? t('deliver', 'Start a Range here, then scrub to its end (I and O)') : t('deliver', 'End the Range here')"
						@click="emit('range')">
						<template #icon>
							<NcIconSvgWrapper :svg="rangeIcon" />
						</template>
						<template v-if="range !== null && range.outFrame === null">
							{{ t('deliver', 'End here') }}
						</template>
					</NcButton>
					<NcButton
						v-if="range !== null"
						variant="tertiary"
						:aria-label="t('deliver', 'Clear the Range')"
						:title="t('deliver', 'Clear the Range')"
						@click="emit('clearRange')">
						<template #icon>
							<NcIconSvgWrapper :svg="closeIcon" />
						</template>
					</NcButton>
				</template>
				<NcButton
					v-if="!isMobile"
					variant="tertiary"
					:disabled="files.length >= MAX_FILES"
					:aria-label="t('deliver', 'Attach files')"
					:title="t('deliver', 'Attach files: up to five, {size} MB in all', { size: limitMb })"
					@click="fileInput.click()">
					<template #icon>
						<NcIconSvgWrapper :svg="attachIcon" />
					</template>
				</NcButton>
				<span v-if="draft.length" class="deliver-comments__drawn">{{ n('deliver', '%n shape drawn', '%n shapes drawn', draft.length) }}</span>
				<span v-if="!isMobile || clock.still" class="deliver-comments__hint">{{ clock.still ? t('deliver', 'The pencil points at a spot on the picture') : t('deliver', 'C comments on the Frame, I and O set a Range') }}</span>
				<NcButton
					v-if="!isMobile"
					variant="primary"
					:disabled="busy || !body.trim()"
					:aria-label="t('deliver', 'Send (Enter)')"
					:title="t('deliver', 'Send (Enter)')"
					@click="submit">
					<template #icon>
						<NcIconSvgWrapper :svg="sendIcon" />
					</template>
				</NcButton>
			</div>
		</form>
	</div>
</template>

<style scoped>
.deliver-comments__composer {
	display: flex;
	flex-direction: column;
	gap: calc(2 * var(--default-grid-baseline));
	padding: calc(3 * var(--default-grid-baseline));
	border-top: 1px solid var(--color-border);
}

.deliver-comments__form {
	display: flex;
	flex-direction: column;
	gap: calc(2 * var(--default-grid-baseline));
}

/* Timecode and text in one box, as one sentence: "at 00:00:04:12, …" */
.deliver-comments__box {
	display: flex;
	align-items: flex-start;
	gap: calc(2 * var(--default-grid-baseline));
	padding: calc(2 * var(--default-grid-baseline)) calc(3 * var(--default-grid-baseline));
	border: 1px solid var(--color-border-dark);
	border-radius: var(--border-radius-large);
	background: var(--color-background-dark);
	cursor: text;
}

.deliver-comments__box:focus-within {
	border-color: var(--color-primary-element);
}

/* One row on a phone: the hint in the empty field does not wrap */
.deliver-comments__box textarea::placeholder {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.deliver-comments__inline {
	display: flex;
	align-items: center;
	flex: none;
	gap: 2px;
	margin: -6px -8px -6px 0;
}

.deliver-comments__anchor {
	flex-shrink: 0;
	margin-top: 3px;
	padding: 1px 6px;
	border-radius: var(--border-radius-small);
	background: rgba(245, 197, 24, 0.16);
	color: #f5c518;
	font-family: monospace;
	font-size: 12px;
	line-height: 18px;
}

.deliver-comments__box textarea {
	flex: 1;
	min-height: 24px;
	max-height: 160px;
	margin: 0;
	padding: 0;
	border: none !important;
	outline: none;
	box-shadow: none !important;
	background: none;
	resize: none;
	field-sizing: content;
	line-height: 24px;
}

.deliver-comments__form {
	position: relative;
}

/* The Members a typed @ could mean, over the field */
.deliver-comments__mentions {
	position: absolute;
	bottom: calc(100% + 4px);
	inset-inline: 0;
	z-index: 2;
	padding: 4px;
	border: 1px solid var(--color-border-dark);
	border-radius: var(--border-radius-large);
	background: var(--color-background-darker);
	box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

.deliver-comments__mentions li {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 8px;
	border-radius: var(--border-radius);
	cursor: pointer;
}

.deliver-comments__mentions li[aria-selected='true'] {
	background: var(--color-primary-element-light);
}

.deliver-comments__actions {
	display: flex;
	align-items: center;
	gap: calc(2 * var(--default-grid-baseline));
}

/* Send sits at the end, with or without a hint before it */
.deliver-comments__actions > :last-child {
	margin-inline-start: auto;
}

.deliver-comments__files {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
}

.deliver-comments__files li {
	display: flex;
	align-items: center;
	gap: 2px;
	max-width: 100%;
	padding: 2px 4px 2px 10px;
	border-radius: var(--border-radius-pill);
	background: var(--color-primary-element-light);
	font-size: 12px;
}

.deliver-comments__files span {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.deliver-comments__files button {
	display: flex;
	min-height: 0;
	margin: 0;
	padding: 2px;
	border: none;
	border-radius: 50%;
	background: none;
	color: inherit;
	cursor: pointer;
}

.deliver-comments__drawn {
	color: #f5c518;
	font-size: 12px;
	white-space: nowrap;
}

.deliver-comments__hint {
	flex: 1;
	color: var(--color-text-maxcontrast);
	font-size: 12px;
}

.deliver-comments__readonly {
	margin: 0;
	color: var(--color-text-maxcontrast);
}

/* At the Waveform: inside its card, without the list's border */
.deliver-comments__composer--inline {
	padding: 0;
	border-top: none;
}

/* The card scrolls and would cut off a list over the field: there it stands in the flow above it, and the card grows */
.deliver-comments__composer--inline .deliver-comments__mentions {
	position: static;
	order: -1;
}
</style>
