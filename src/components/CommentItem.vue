<script setup>
import openIcon from '@mdi/svg/svg/check-circle-outline.svg?raw'
import resolvedIcon from '@mdi/svg/svg/check-circle.svg?raw'
import expandedIcon from '@mdi/svg/svg/chevron-down.svg?raw'
import collapsedIcon from '@mdi/svg/svg/chevron-right.svg?raw'
import clockIcon from '@mdi/svg/svg/clock-outline.svg?raw'
import { n, t } from '@nextcloud/l10n'
import { computed, ref } from 'vue'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcAvatar from '@nextcloud/vue/components/NcAvatar'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDateTime from '@nextcloud/vue/components/NcDateTime'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { errorMessage } from '../api.js'
import { linkify } from '../lib/links.js'
import { formatAt } from '../lib/timecode.js'
import { useCommentsStore } from '../store/comments.js'

const props = defineProps({
	/** A top-level Comment with its Replies, or a Reply */
	comment: { type: Object, required: true },
	/** How time is shown: { fps, mode, startFrame, dropFrame } */
	clock: { type: Object, required: true },
	isReply: { type: Boolean, default: false },
	/** Its place in the order Comments were written, shown as #n */
	number: { type: Number, default: null },
})

const emit = defineEmits(['jump'])

/** Younger than this, a Comment shows "5 minutes ago"; older, its date (story 37) */
const FRESH = 7 * 24 * 3600

const store = useCommentsStore()
const editing = ref(false)
const draft = ref('')
const replying = ref(false)
const showReplies = ref(true)
const reply = ref('')
const busy = ref(false)
const error = ref(null)

const mine = computed(() => store.mine(props.comment))
const unseen = computed(() => props.comment.createdAt > store.seenUntil && !mine.value)
const fresh = computed(() => store.now - props.comment.createdAt < FRESH)
const canReply = computed(() => !props.isReply && store.canComment === true && store.me?.type !== 'unnamed')
const canDelete = computed(() => mine.value || store.canWrite)
const pieces = computed(() => linkify(props.comment.body))
const anchor = computed(() => {
	const from = formatAt(props.comment.inFrame, props.clock)
	return props.comment.outFrame === null ? from : from + ' – ' + formatAt(props.comment.outFrame, props.clock)
})

/**
 * @param {() => Promise<void>} action - what to run while the item is busy
 */
async function run(action) {
	busy.value = true
	error.value = null
	try {
		await action()
	} catch (e) {
		error.value = errorMessage(e)
	} finally {
		busy.value = false
	}
}

/** Opens the Comment for editing */
function startEdit() {
	draft.value = props.comment.body
	editing.value = true
}

/** Saves the edited body */
function saveEdit() {
	return run(async () => {
		await store.edit(props.comment.id, draft.value)
		editing.value = false
	})
}

/** Posts the Reply under this Comment */
function saveReply() {
	return run(async () => {
		await store.add({ inFrame: props.comment.inFrame, body: reply.value, parentId: props.comment.id })
		reply.value = ''
		replying.value = false
	})
}
</script>

<template>
	<li
		class="deliver-comment"
		:class="{
			'deliver-comment--reply': isReply,
			'deliver-comment--resolved': comment.resolved,
			'deliver-comment--unseen': unseen,
		}">
		<NcAvatar
			class="deliver-comment__avatar"
			:user="comment.author.type === 'user' ? comment.author.id : undefined"
			:displayName="comment.author.name"
			:isNoUser="comment.author.type !== 'user'"
			:size="isReply ? 28 : 32"
			hideStatus
			disableMenu />
		<div class="deliver-comment__content">
			<div class="deliver-comment__head">
				<span class="deliver-comment__author">{{ comment.author.name }}</span>
				<NcDateTime
					class="deliver-comment__time"
					:timestamp="comment.createdAt * 1000"
					:relativeTime="fresh ? 'short' : false"
					:format="{ dateStyle: 'medium' }" />
				<span v-if="unseen" class="deliver-comment__new">{{ t('deliver', 'Unseen') }}</span>
				<span class="deliver-comment__spacer" />
				<span v-if="number !== null" class="deliver-comment__number">#{{ number }}</span>
				<NcButton
					v-if="!isReply && store.canWrite"
					variant="tertiary"
					size="small"
					:disabled="busy"
					:aria-label="comment.resolved ? t('deliver', 'Mark as unresolved') : t('deliver', 'Mark as resolved')"
					:title="comment.resolved ? t('deliver', 'Mark as unresolved') : t('deliver', 'Mark as resolved')"
					:class="{ 'deliver-comment__resolve--done': comment.resolved }"
					@click="run(() => store.setResolved(comment.id, !comment.resolved))">
					<template #icon>
						<NcIconSvgWrapper :svg="comment.resolved ? resolvedIcon : openIcon" :size="18" />
					</template>
				</NcButton>
				<NcIconSvgWrapper
					v-else-if="!isReply && comment.resolved"
					class="deliver-comment__resolve--done"
					:svg="resolvedIcon"
					:size="18"
					:name="t('deliver', 'Resolved')" />
				<NcActions v-if="mine || canDelete" :forceMenu="true" variant="tertiary">
					<NcActionButton v-if="mine" @click="startEdit">
						{{ t('deliver', 'Edit') }}
					</NcActionButton>
					<NcActionButton v-if="canDelete" @click="run(() => store.remove(comment.id))">
						{{ t('deliver', 'Delete') }}
					</NcActionButton>
				</NcActions>
			</div>

			<button
				v-if="!isReply"
				type="button"
				class="deliver-comment__anchor"
				:title="t('deliver', 'Go to this Frame')"
				@click="emit('jump', comment)">
				<NcIconSvgWrapper :svg="clockIcon" :size="14" inline />
				{{ anchor }}
			</button>

			<template v-if="editing">
				<textarea v-model="draft" class="deliver-comment__input" rows="3" />
				<div class="deliver-comment__buttons">
					<NcButton variant="tertiary" @click="editing = false">
						{{ t('deliver', 'Cancel') }}
					</NcButton>
					<NcButton variant="primary" :disabled="busy || !draft.trim()" @click="saveEdit">
						{{ t('deliver', 'Save') }}
					</NcButton>
				</div>
			</template>
			<!-- One line on purpose: the body keeps its line breaks (pre-wrap), so any template whitespace would show -->
			<!-- eslint-disable-next-line vue/singleline-html-element-content-newline, vue/max-attributes-per-line -->
			<p v-else class="deliver-comment__body"><template v-for="(piece, index) in pieces" :key="index"><a v-if="piece.href" :href="piece.href" target="_blank" rel="noopener noreferrer">{{ piece.text }}</a><template v-else>{{ piece.text }}</template></template></p>

			<p v-if="error" class="deliver-comment__error">
				{{ error }}
			</p>

			<div v-if="replying" class="deliver-comment__reply-form">
				<textarea
					v-model="reply"
					class="deliver-comment__input"
					rows="2"
					:placeholder="t('deliver', 'Write a Reply')" />
				<div class="deliver-comment__buttons">
					<NcButton variant="tertiary" @click="replying = false">
						{{ t('deliver', 'Cancel') }}
					</NcButton>
					<NcButton variant="primary" :disabled="busy || !reply.trim()" @click="saveReply">
						{{ t('deliver', 'Reply') }}
					</NcButton>
				</div>
			</div>
			<button
				v-else-if="canReply"
				type="button"
				class="deliver-comment__link"
				@click="replying = true">
				{{ t('deliver', 'Reply') }}
			</button>

			<template v-if="comment.replies?.length">
				<button type="button" class="deliver-comment__link deliver-comment__toggle" @click="showReplies = !showReplies">
					<NcIconSvgWrapper :svg="showReplies ? expandedIcon : collapsedIcon" :size="16" inline />
					{{ n('deliver', '%n reply', '%n replies', comment.replies.length) }}
				</button>
				<ul v-show="showReplies" class="deliver-comment__replies">
					<CommentItem
						v-for="child in comment.replies"
						:key="child.id"
						:comment="child"
						:clock="clock"
						isReply />
				</ul>
			</template>
		</div>
	</li>
</template>

<style scoped>
.deliver-comment {
	display: flex;
	gap: calc(3 * var(--default-grid-baseline, 4px));
	padding: calc(3 * var(--default-grid-baseline, 4px));
	border: 1px solid var(--color-border);
	border-radius: var(--border-radius-large, 12px);
	background: var(--deliver-card, var(--color-main-background));
}

.deliver-comment--unseen {
	box-shadow: inset 3px 0 0 var(--color-primary-element);
}

.deliver-comment--resolved:not(.deliver-comment--reply) {
	opacity: 0.6;
}

/* A Reply hangs under its parent, behind a line */
.deliver-comment--reply {
	padding: var(--default-grid-baseline, 4px) 0 var(--default-grid-baseline, 4px) calc(3 * var(--default-grid-baseline, 4px));
	border: none;
	border-inline-start: 2px solid var(--color-border-dark);
	border-radius: 0;
	background: none;
	box-shadow: none;
	opacity: 1;
}

.deliver-comment__avatar {
	flex-shrink: 0;
}

.deliver-comment__content {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 4px;
	flex: 1;
	min-width: 0;
}

.deliver-comment__head {
	display: flex;
	align-items: center;
	gap: calc(2 * var(--default-grid-baseline, 4px));
	align-self: stretch;
	min-height: 28px;
	margin-top: 2px;
}

.deliver-comment__author {
	font-weight: bold;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.deliver-comment__time,
.deliver-comment__number {
	flex-shrink: 0;
	color: var(--color-text-maxcontrast);
	font-size: 12px;
}

.deliver-comment__spacer {
	flex: 1;
}

.deliver-comment__new {
	padding: 0 6px;
	border-radius: var(--border-radius-pill, 20px);
	background: var(--color-primary-element);
	color: var(--color-primary-element-text);
	font-size: 11px;
	font-weight: bold;
}

.deliver-comment__resolve--done {
	color: var(--color-success, #2d7b41);
}

.deliver-comment__anchor {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	min-height: 0;
	margin: 0;
	padding: 0;
	border: none;
	background: none;
	color: var(--deliver-timecode, var(--color-primary-element));
	font-family: var(--font-face-monospace, monospace);
	font-size: 13px;
	font-weight: normal;
	cursor: pointer;
}

.deliver-comment__anchor:hover {
	text-decoration: underline;
}

.deliver-comment__body {
	margin: 0;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
	line-height: 1.5;
}

.deliver-comment__link {
	display: inline-flex;
	align-items: center;
	gap: 2px;
	min-height: 0;
	margin: 0;
	padding: 0;
	border: none;
	background: none;
	color: var(--color-text-maxcontrast);
	font-size: 13px;
	font-weight: normal;
	cursor: pointer;
}

.deliver-comment__link:hover {
	color: var(--color-main-text);
}

.deliver-comment__replies {
	display: flex;
	flex-direction: column;
	gap: calc(2 * var(--default-grid-baseline, 4px));
	align-self: stretch;
}

.deliver-comment__reply-form {
	align-self: stretch;
}

.deliver-comment__input {
	width: 100%;
	resize: vertical;
}

.deliver-comment__buttons {
	display: flex;
	justify-content: flex-end;
	gap: var(--default-grid-baseline, 4px);
}

.deliver-comment__error {
	color: var(--color-error-text, var(--color-error));
}
</style>
