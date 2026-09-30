<script setup>
import openIcon from '@mdi/svg/svg/check-circle-outline.svg?raw'
import resolvedIcon from '@mdi/svg/svg/check-circle.svg?raw'
import expandedIcon from '@mdi/svg/svg/chevron-down.svg?raw'
import collapsedIcon from '@mdi/svg/svg/chevron-right.svg?raw'
import clockIcon from '@mdi/svg/svg/clock-outline.svg?raw'
import penIcon from '@mdi/svg/svg/draw.svg?raw'
import reactIcon from '@mdi/svg/svg/emoticon-plus-outline.svg?raw'
import fileIcon from '@mdi/svg/svg/file-outline.svg?raw'
import { formatFileSize } from '@nextcloud/files'
import { n, t } from '@nextcloud/l10n'
import { computed, ref } from 'vue'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcAvatar from '@nextcloud/vue/components/NcAvatar'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDateTime from '@nextcloud/vue/components/NcDateTime'
import NcEmojiPicker from '@nextcloud/vue/components/NcEmojiPicker'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { attachmentUrl } from '../api.js'
import { useBusy } from '../composables/busy.js'
import { linkify } from '../lib/links.js'
import { splitMentions } from '../lib/mentions.js'
import { formatRange } from '../lib/timecode.js'
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
const { busy, error, run } = useBusy()

const mine = computed(() => store.mine(props.comment))
const unseen = computed(() => props.comment.createdAt > store.seenUntil && !mine.value)
const fresh = computed(() => store.now - props.comment.createdAt < FRESH)
const canReply = computed(() => !props.isReply && store.canComment === true && store.me?.type !== 'unnamed')
const canDelete = computed(() => mine.value || store.canWrite)
/** Reactions need a name to put on them, like Comments (story 91) */
const canReact = computed(() => store.canComment === true && store.me?.type !== 'unnamed')

/**
 * @param {{authors: Array<object>}} reaction - one emoji with who gave it
 * @return {boolean} whether one of them is me
 */
function reactedByMe(reaction) {
	return reaction.authors.some((author) => store.mine({ author }))
}

/**
 * @param {string} emoji - the reaction to switch
 */
function toggle(emoji) {
	const given = props.comment.reactions?.find((reaction) => reaction.emoji === emoji)
	return run(() => store.react(props.comment.id, emoji, !(given && reactedByMe(given))))
}
const pieces = computed(() => linkify(props.comment.body)
	.flatMap((piece) => piece.href ? [piece] : splitMentions(piece.text, props.comment.mentions)))
const anchor = computed(() => formatRange(props.comment, props.clock))

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
		:data-comment="comment.id"
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
				v-if="!isReply && !clock.still"
				type="button"
				class="deliver-comment__anchor"
				:title="t('deliver', 'Go to this Frame')"
				@click="emit('jump', comment)">
				<NcIconSvgWrapper :svg="clockIcon" :size="14" inline />
				{{ anchor }}
				<NcIconSvgWrapper
					v-if="comment.annotation?.length"
					:svg="penIcon"
					:size="14"
					inline
					:name="t('deliver', 'With a drawing')" />
			</button>

			<!-- A still has no Frame to jump to; its Drawing shows on request -->
			<button
				v-if="!isReply && clock.still && comment.annotation?.length"
				type="button"
				class="deliver-comment__anchor"
				@click="emit('jump', comment)">
				<NcIconSvgWrapper :svg="penIcon" :size="14" inline />
				{{ t('deliver', 'Show the drawing') }}
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
			<p v-else class="deliver-comment__body"><template v-for="(piece, index) in pieces" :key="index"><a v-if="piece.href" :href="piece.href" target="_blank" rel="noopener noreferrer">{{ piece.text }}</a><span v-else-if="piece.mention" class="deliver-comment__mention" :title="piece.mention">{{ piece.text }}</span><template v-else>{{ piece.text }}</template></template></p>

			<ul v-if="comment.attachments?.length" class="deliver-comment__attachments">
				<li v-for="attachment in comment.attachments" :key="attachment.id">
					<a
						:href="attachmentUrl(attachment.id)"
						target="_blank"
						rel="noopener noreferrer"
						:title="attachment.name">
						<img
							v-if="/^image\/(png|jpeg|gif|webp)$/.test(attachment.mimeType)"
							:src="attachmentUrl(attachment.id)"
							:alt="attachment.name"
							loading="lazy">
						<template v-else>
							<NcIconSvgWrapper :svg="fileIcon" :size="16" inline />
							<span>{{ attachment.name }}</span>
							<span class="deliver-comment__size">{{ formatFileSize(attachment.size) }}</span>
						</template>
					</a>
				</li>
			</ul>

			<div v-if="comment.reactions?.length || canReact" class="deliver-comment__reactions">
				<button
					v-for="reaction in comment.reactions"
					:key="reaction.emoji"
					type="button"
					class="deliver-comment__reaction"
					:class="{ 'deliver-comment__reaction--mine': reactedByMe(reaction) }"
					:disabled="!canReact || busy"
					:title="reaction.authors.map((author) => author.name).join(', ')"
					@click="toggle(reaction.emoji)">
					{{ reaction.emoji }} {{ reaction.authors.length }}
				</button>
				<NcEmojiPicker v-if="canReact" @select="toggle">
					<NcButton
						class="deliver-comment__react"
						variant="tertiary"
						size="small"
						:aria-label="t('deliver', 'React')"
						:title="t('deliver', 'React')">
						<template #icon>
							<NcIconSvgWrapper :svg="reactIcon" :size="16" />
						</template>
					</NcButton>
				</NcEmojiPicker>
			</div>

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
	transition: border-color 0.3s;
	gap: calc(3 * var(--default-grid-baseline));
	padding: calc(3 * var(--default-grid-baseline));
	border: 1px solid var(--color-border);
	border-radius: var(--border-radius-large);
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
	padding: var(--default-grid-baseline) 0 var(--default-grid-baseline) calc(3 * var(--default-grid-baseline));
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
	gap: calc(2 * var(--default-grid-baseline));
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
	border-radius: var(--border-radius-pill);
	background: var(--color-primary-element);
	color: var(--color-primary-element-text);
	font-size: 11px;
	font-weight: bold;
}

.deliver-comment__resolve--done {
	color: var(--color-success);
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
	font-family: monospace;
	font-size: 13px;
	font-weight: normal;
	cursor: pointer;
}

.deliver-comment__anchor:hover {
	text-decoration: underline;
}

.deliver-comment__mention {
	padding: 0 4px;
	border-radius: var(--border-radius);
	background: color-mix(in srgb, var(--color-primary-element) 30%, transparent);
	font-weight: bold;
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

.deliver-comment__attachments {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	align-self: stretch;
}

.deliver-comment__attachments a {
	display: flex;
	align-items: center;
	gap: 4px;
	max-width: 100%;
	padding: 4px 8px;
	border: 1px solid var(--color-border-dark);
	border-radius: var(--border-radius);
	color: var(--color-main-text);
	font-size: 13px;
}

.deliver-comment__attachments a:has(img) {
	padding: 0;
	overflow: hidden;
}

.deliver-comment__attachments img {
	display: block;
	max-width: 160px;
	max-height: 110px;
	object-fit: cover;
}

.deliver-comment__attachments span {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.deliver-comment__size {
	flex-shrink: 0;
	color: var(--color-text-maxcontrast);
}

.deliver-comment__reactions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 4px;
}

.deliver-comment__reaction {
	min-height: 0;
	margin: 0;
	padding: 1px 8px;
	border: 1px solid var(--color-border-dark);
	border-radius: var(--border-radius-pill);
	background: none;
	color: var(--color-main-text);
	font-size: 13px;
	font-weight: normal;
	cursor: pointer;
}

.deliver-comment__reaction--mine {
	border-color: var(--color-primary-element);
	background: color-mix(in srgb, var(--color-primary-element) 25%, transparent);
}

.deliver-comment__react,
.deliver-comment__react :deep(.button-vue) {
	min-height: 26px;
	min-width: 26px;
	height: 26px;
	width: 26px;
}

.deliver-comment__replies {
	display: flex;
	flex-direction: column;
	gap: calc(2 * var(--default-grid-baseline));
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
	gap: var(--default-grid-baseline);
}

.deliver-comment__error {
	color: var(--color-error-text);
}
</style>
