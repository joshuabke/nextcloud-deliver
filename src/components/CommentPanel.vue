<script setup>
import filterIcon from '@mdi/svg/svg/chevron-down.svg?raw'
import searchIcon from '@mdi/svg/svg/magnify.svg?raw'
import sortIcon from '@mdi/svg/svg/sort.svg?raw'
import { useIsMobile } from '@nextcloud/vue/composables/useIsMobile'
import { computed, ref, watch } from 'vue'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcActionSeparator from '@nextcloud/vue/components/NcActionSeparator'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import CommentComposer from './CommentComposer.vue'
import CommentItem from './CommentItem.vue'
import { t } from '../lib/l10n.js'
import { useCommentsStore } from '../store/comments.js'

defineProps({
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

const emit = defineEmits(['jump', 'claim', 'posted', 'left', 'draw', 'range', 'clearRange'])

const store = useCommentsStore()
/** A phone has no keyboard shortcuts to hint at */
const isMobile = useIsMobile()
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
const composer = ref(null)
const reviewerName = ref('')
const reviewerEmail = ref('')
/** What the Reviewer wants mailed, once they give an address */
const wishes = ref({ replies: true, comments: false, versions: false })

/** On a Review Link that takes Comments, a Reviewer gives a name first (story 54) */
const needsName = computed(() => store.me?.type === 'unnamed' && store.canComment !== false)
const readOnly = computed(() => store.canComment === false)

// A logged-in visitor finds their display name already filled in (story 58)
watch(() => store.me, (me) => {
	if (me?.type === 'unnamed' && me.name && reviewerName.value === '') {
		reviewerName.value = me.name
	}
}, { immediate: true })

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

const list = ref(null)

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
	store.selected = id
	item.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
	item.classList.add('deliver-comment--revealed')
	setTimeout(() => item.classList.remove('deliver-comment--revealed'), 1200)
}

defineExpose({ focus: () => composer.value?.focus(), reveal })

/** Focuses the search field as it opens */
const vFocus = { mounted: (element) => element.focus() }

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
				:selected="store.selected === thread.id"
				@click="store.selected = thread.id"
				@jump="emit('jump', $event)" />
		</ul>
		<p v-else class="deliver-comments__empty">
			{{ store.threads.length
				? (query ? t('deliver', 'No Comment matches.') : (show === 'open' ? t('deliver', 'Everything is resolved.') : t('deliver', 'Nothing resolved yet.')))
				: (readOnly || isMobile ? t('deliver', 'No Comments yet.') : t('deliver', 'No Comments yet. Press C while playing to comment on the current Frame.')) }}
		</p>

		<CommentComposer
			ref="composer"
			:clock="clock"
			:anchor="anchor"
			:draft="draft"
			:drawing="drawing"
			:members="members"
			:canDraw="canDraw"
			:range="range"
			@posted="emit('posted')"
			@left="emit('left')"
			@draw="emit('draw')"
			@range="emit('range')"
			@clearRange="emit('clearRange')" />
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

.deliver-comments__claim {
	display: flex;
	flex-direction: column;
	gap: calc(2 * var(--default-grid-baseline));
}
</style>
