<script setup>
import filterIcon from '@mdi/svg/svg/chevron-down.svg?raw'
import closeIcon from '@mdi/svg/svg/close.svg?raw'
import moreIcon from '@mdi/svg/svg/dots-horizontal.svg?raw'
import penIcon from '@mdi/svg/svg/draw.svg?raw'
import searchIcon from '@mdi/svg/svg/magnify.svg?raw'
import attachIcon from '@mdi/svg/svg/paperclip.svg?raw'
import rangeIcon from '@mdi/svg/svg/ray-start-end.svg?raw'
import sendIcon from '@mdi/svg/svg/send.svg?raw'
import sortIcon from '@mdi/svg/svg/sort.svg?raw'
import { n, t } from '@nextcloud/l10n'
import { useIsMobile } from '@nextcloud/vue/composables/useIsMobile'
import { computed, ref, watch } from 'vue'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcActionSeparator from '@nextcloud/vue/components/NcActionSeparator'
import NcAvatar from '@nextcloud/vue/components/NcAvatar'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import CommentItem from './CommentItem.vue'
import { errorMessage } from '../api.js'
import { useBusy } from '../composables/busy.js'
import { sheet } from '../composables/panel.js'
import { insertMention, mentionAt } from '../lib/mentions.js'
import { formatRange } from '../lib/timecode.js'
import { useCommentsStore } from '../store/comments.js'

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
})

const emit = defineEmits(['jump', 'claim', 'posted', 'typing', 'cleared', 'draw', 'range', 'clearRange'])

const store = useCommentsStore()
/** A phone has no keyboard shortcuts to hint at */
const isMobile = useIsMobile()
const body = ref('')
const newest = ref(false)
/** Which Comments the list shows: all, open or resolved */
const show = ref('all')
const SHOW = {
	all: t('deliver', 'All Comments'),
	open: t('deliver', 'Unresolved'),
	resolved: t('deliver', 'Resolved'),
}
const searching = ref(false)
const query = ref('')
const { busy, error, run } = useBusy()
const input = ref(null)
const reviewerName = ref('')
const reviewerEmail = ref('')
/** What the Reviewer wants mailed, once they give an address */
const wishes = ref({ replies: true, comments: false, versions: false })
/** Files to attach to the next Comment (story 92) */
const files = ref([])
const fileInput = ref(null)
const MAX_FILES = 5
const MAX_BYTES = 25 * 1024 * 1024

/**
 * @param {Event} event - the file input's change
 */
function pickFiles(event) {
	const picked = [...event.target.files]
	event.target.value = ''
	const tooLarge = picked.filter((file) => file.size > MAX_BYTES)
	if (tooLarge.length) {
		error.value = t('deliver', 'An attachment is at most 25 MB: {names}', { names: tooLarge.map((file) => file.name).join(', ') })
	}
	files.value = [...files.value, ...picked.filter((file) => file.size <= MAX_BYTES)].slice(0, MAX_FILES)
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

/** On a Project Link that takes Comments, a Reviewer gives a name first (story 54) */
const needsName = computed(() => store.me?.type === 'unnamed' && store.canComment !== false)
const readOnly = computed(() => store.canComment === false)

// A logged-in visitor finds their display name already filled in (story 58)
watch(() => store.me, (me) => {
	if (me?.type === 'unnamed' && me.name && reviewerName.value === '') {
		reviewerName.value = me.name
	}
}, { immediate: true })

// The first keystroke fixes where the Comment goes; emptying the field undoes that
watch(() => body.value.trim() === '', (empty, wasEmpty) => {
	if (wasEmpty && !empty) {
		emit('typing')
	} else if (empty && !wasEmpty) {
		emit('cleared')
	}
})

const anchorLabel = computed(() => formatRange(props.anchor, props.clock))

/**
 * @param {object} thread - a Comment with its Replies
 * @return {boolean} whether it, or a Reply, holds the search words
 */
function matches(thread) {
	const words = query.value.trim().toLowerCase()
	return words === '' || [thread, ...thread.replies]
		.some((each) => (each.body + ' ' + each.author.name).toLowerCase().includes(words))
}

const threads = computed(() => {
	const list = store.threads.filter((thread) => (show.value === 'all' || thread.resolved === (show.value === 'resolved')) && matches(thread))
	return newest.value ? [...list].sort((a, b) => b.createdAt - a.createdAt) : list
})

watch(() => store.versionId, () => {
	error.value = null
})

const list = ref(null)
/** The thread last clicked or revealed from its marker, lifted out as Frame.io does */
const selected = ref(null)

/**
 * Brings a Comment into view and marks it for a moment, for a tap on its marker
 *
 * @param {number} id - the Comment
 */
function reveal(id) {
	const item = list.value?.querySelector(`[data-comment="${id}"]`)
	if (!item) {
		return
	}
	selected.value = id
	item.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
	item.classList.add('deliver-comment--revealed')
	setTimeout(() => item.classList.remove('deliver-comment--revealed'), 1200)
}

defineExpose({ focus: () => input.value?.focus(), reveal })

const form = ref(null)

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

/** Focuses the search field as it opens */
const vFocus = { mounted: (element) => element.focus() }

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
			error.value = t('deliver', 'The Comment is posted, but {name} could not be attached: {reason}', { name: e.fileName, reason: errorMessage(e) })
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
}

/** Hands the Reviewer's name to the view, which registers it */
function claim() {
	if (reviewerName.value.trim()) {
		emit('claim', { name: reviewerName.value, email: reviewerEmail.value, mail: wishes.value })
	}
}
</script>

<template>
	<section class="deliver-comments">
		<!-- Without a name there is nothing to do here, so the name comes first, over the Comments -->
		<div v-if="needsName" class="deliver-comments__gate">
			<form class="deliver-comments__claim" @submit.prevent="claim">
				<h3>{{ t('deliver', 'Who is reviewing?') }}</h3>
				<label for="deliver-reviewer-name">
					{{ t('deliver', 'Your name, so the editor knows whose feedback this is') }}
				</label>
				<input
					id="deliver-reviewer-name"
					v-model="reviewerName"
					type="text"
					:placeholder="t('deliver', 'Name')">
				<input v-model="reviewerEmail" type="email" :placeholder="t('deliver', 'Email (optional)')">
				<fieldset class="deliver-comments__wishes" :disabled="!reviewerEmail.trim()">
					<legend>{{ reviewerEmail.trim() ? t('deliver', 'Mail me about') : t('deliver', 'With an email address, Deliver can mail you about') }}</legend>
					<NcCheckboxRadioSwitch v-model="wishes.replies" :disabled="!reviewerEmail.trim()">
						{{ t('deliver', 'Replies to my Comments') }}
					</NcCheckboxRadioSwitch>
					<NcCheckboxRadioSwitch v-model="wishes.comments" :disabled="!reviewerEmail.trim()">
						{{ t('deliver', 'Every new Comment') }}
					</NcCheckboxRadioSwitch>
					<NcCheckboxRadioSwitch v-model="wishes.versions" :disabled="!reviewerEmail.trim()">
						{{ t('deliver', 'New Versions') }}
					</NcCheckboxRadioSwitch>
				</fieldset>
				<NcButton variant="primary" type="submit" :disabled="!reviewerName.trim()">
					{{ t('deliver', 'Start reviewing') }}
				</NcButton>
			</form>
		</div>
		<div class="deliver-comments__head">
			<NcActions
				variant="tertiary"
				class="deliver-comments__show deliver-caret-after"
				:menuName="SHOW[show]"
				:aria-label="t('deliver', 'Filter')">
				<template #icon>
					<NcIconSvgWrapper :svg="filterIcon" />
				</template>
				<NcActionButton
					v-for="(label, id) in SHOW"
					:key="id"
					:modelValue="show === id"
					type="radio"
					closeAfterClick
					@click="show = id">
					{{ label }}
				</NcActionButton>
				<template v-if="store.unseenCount">
					<NcActionSeparator />
					<NcActionButton @click="store.clearUnseen()">
						{{ t('deliver', 'Mark all as seen') }}
					</NcActionButton>
				</template>
			</NcActions>
			<span v-if="store.unseenCount" class="deliver-comments__unseen" :title="t('deliver', '{count} unseen', { count: store.unseenCount })">
				{{ store.unseenCount }}
			</span>
			<span class="deliver-comments__spacer" />
			<NcButton
				variant="tertiary"
				:pressed="newest"
				:aria-label="newest ? t('deliver', 'Newest first') : t('deliver', 'In timeline order')"
				:title="newest ? t('deliver', 'Newest first') : t('deliver', 'In timeline order')"
				@click="newest = !newest">
				<template #icon>
					<NcIconSvgWrapper :svg="sortIcon" />
				</template>
			</NcButton>
			<NcButton
				variant="tertiary"
				:pressed="searching"
				:aria-label="t('deliver', 'Search Comments')"
				:title="t('deliver', 'Search Comments')"
				@click="searching = !searching; query = ''">
				<template #icon>
					<NcIconSvgWrapper :svg="searchIcon" />
				</template>
			</NcButton>
			<slot name="tools" />
		</div>
		<input
			v-if="searching"
			v-model="query"
			v-focus
			class="deliver-comments__search"
			type="search"
			:placeholder="t('deliver', 'Search Comments')"
			@keydown.esc="searching = false; query = ''">

		<ul v-if="threads.length" ref="list" class="deliver-comments__list">
			<CommentItem
				v-for="thread in threads"
				:key="thread.id"
				:comment="thread"
				:clock="clock"
				:number="store.numbers.get(thread.id)"
				:selected="selected === thread.id"
				@click="selected = thread.id"
				@jump="emit('jump', $event)" />
		</ul>
		<p v-else class="deliver-comments__empty">
			{{ store.threads.length
				? (query ? t('deliver', 'No Comment matches.') : (show === 'open' ? t('deliver', 'Everything is resolved.') : t('deliver', 'Nothing resolved yet.')))
				: (readOnly || isMobile ? t('deliver', 'No Comments yet.') : t('deliver', 'No Comments yet. Press C while playing to comment on the current Frame.')) }}
		</p>

		<div class="deliver-comments__composer">
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
						for="deliver-comment-body"
						:title="t('deliver', 'Where the Comment goes')">
						{{ anchorLabel }}
					</label>
					<textarea
						id="deliver-comment-body"
						ref="input"
						v-model="body"
						rows="1"
						:placeholder="t('deliver', 'Leave a Comment…')"
						@keydown="onKeydown"
						@focus="startWriting"
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
						:title="t('deliver', 'Attach files, up to five of 25 MB each')"
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
	</section>
</template>

<style scoped>
.deliver-comments {
	position: relative;
	display: flex;
	flex-direction: column;
	flex: 1;
	min-height: 0;
}

/* The Comments stay visible, dimmed, under the name form; on a small screen the form scrolls */
.deliver-comments__gate {
	position: absolute;
	inset: 0;
	z-index: 3;
	display: flex;
	align-items: safe center;
	justify-content: center;
	overflow-y: auto;
	padding: calc(3 * var(--default-grid-baseline));
	background: rgba(20, 20, 22, 0.78);
	backdrop-filter: blur(2px);
}

.deliver-comments__gate .deliver-comments__claim {
	width: 100%;
	max-width: 360px;
	padding: calc(4 * var(--default-grid-baseline));
	border: 1px solid var(--color-border-dark);
	border-radius: var(--border-radius-large);
	background: var(--deliver-card, var(--color-main-background));
	box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.deliver-comments__claim h3 {
	margin: 0;
	font-size: 18px;
}

.deliver-comments__claim label {
	color: var(--color-text-maxcontrast);
}

.deliver-comments__claim input {
	width: 100%;
	margin: 0;
}

.deliver-comments__wishes {
	margin: 0;
	padding: 0;
	border: none;
}

.deliver-comments__wishes legend {
	margin-bottom: 2px;
	color: var(--color-text-maxcontrast);
	font-size: 13px;
}

.deliver-comments__wishes:disabled {
	opacity: 0.55;
}

.deliver-comments__head {
	display: flex;
	align-items: center;
	gap: 2px;
	padding: var(--default-grid-baseline) calc(2 * var(--default-grid-baseline));
}

.deliver-comments__show :deep(.button-vue) {
	font-weight: normal;
}

.deliver-comments__unseen {
	padding: 0 7px;
	border-radius: var(--border-radius-pill);
	background: var(--color-primary-element);
	color: var(--color-primary-element-text);
	font-size: 12px;
	font-weight: bold;
}

.deliver-comments__spacer {
	flex: 1;
}

.deliver-comments__search {
	margin: 0 calc(3 * var(--default-grid-baseline)) calc(2 * var(--default-grid-baseline));
}

.deliver-comments__list {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	gap: calc(3 * var(--default-grid-baseline));
	padding: var(--default-grid-baseline) calc(3 * var(--default-grid-baseline)) calc(3 * var(--default-grid-baseline));
}

/* The Comment whose marker was tapped */
.deliver-comments__list :deep(.deliver-comment--revealed) {
	border-color: var(--color-primary-element);
}

.deliver-comments__empty {
	flex: 1;
	padding: calc(4 * var(--default-grid-baseline));
	color: var(--color-text-maxcontrast);
	text-align: center;
}

.deliver-comments__composer {
	display: flex;
	flex-direction: column;
	gap: calc(2 * var(--default-grid-baseline));
	padding: calc(3 * var(--default-grid-baseline));
	border-top: 1px solid var(--color-border);
}

.deliver-comments__form,
.deliver-comments__claim {
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
</style>
