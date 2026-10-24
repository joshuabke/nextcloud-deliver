<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import NcListItemIcon from '@nextcloud/vue/components/NcListItemIcon'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import { searchContacts } from '../api.js'

/**
 * A name field that suggests people from the Member's address books as they
 * type, one row per address, and hands back name and address of the one
 * picked (story 142). Anything else can still be typed.
 */
const name = defineModel({ type: String, required: true })
const props = defineProps({
	label: { type: String, required: true },
	disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['pick'])

/** {name, email, photo} of the people found; empty while nothing is offered */
const suggestions = ref([])
/** The row the arrow keys are on */
const active = ref(0)
const listId = `deliver-contacts-${Math.random().toString(36).slice(2)}`
let searching = null
/** The name a pick put in the field, which needs no search of its own */
let pickedName = null

watch(name, (typed) => {
	clearTimeout(searching)
	if (typed === pickedName || typed.trim().length < 2) {
		suggestions.value = []
		return
	}
	pickedName = null
	searching = setTimeout(async () => {
		const found = await searchContacts(typed).catch(() => [])
		if (name.value === typed) {
			suggestions.value = found
			active.value = 0
		}
	}, 250)
})

const open = computed(() => suggestions.value.length > 0)
const field = useTemplateRef('field')
const list = useTemplateRef('list')
/** Where the list hangs: over a dialog's scrolling content, so that nothing cuts it off */
const layer = ref(null)
/** The list's place on screen, under the field or above it when there is no room */
const place = ref({})

onMounted(() => {
	// Inside the dialog's mask the list stays within its focus trap
	layer.value = field.value.closest('.modal-mask') ?? document.body
})

/** Five rows of 48px and the list's padding, as the style below caps it */
const ROWS_HEIGHT = 5 * 48 + 8

/** Puts the list at the field, as wide as its longest row allows on screen */
function position() {
	const rect = field.value?.getBoundingClientRect()
	if (!rect) {
		return
	}
	const gap = 4
	const room = window.innerHeight - rect.bottom - 2 * gap
	// What the list wants, up to its five rows, whatever height it was cut to before
	const wanted = Math.min(list.value?.scrollHeight ?? 0, ROWS_HEIGHT)
	const above = wanted > room && rect.top > room
	place.value = {
		'--deliver-contact-room': `${above ? rect.top - 2 * gap : room}px`,
		left: `${rect.left}px`,
		minWidth: `${rect.width}px`,
		maxWidth: `${window.innerWidth - rect.left - 2 * gap}px`,
		...(above ? { bottom: `${window.innerHeight - rect.top + gap}px` } : { top: `${rect.bottom + gap}px` }),
	}
}

// The list follows the field while the dialog scrolls or the window changes size
watch(open, async (opened) => {
	window.removeEventListener('scroll', position, true)
	window.removeEventListener('resize', position)
	if (opened) {
		window.addEventListener('scroll', position, true)
		window.addEventListener('resize', position)
		position()
		await nextTick()
		position()
	}
})
onBeforeUnmount(() => {
	window.removeEventListener('scroll', position, true)
	window.removeEventListener('resize', position)
})

/**
 * @param {{name: string, email: string}} contact - the row picked
 */
function pick(contact) {
	pickedName = contact.name
	name.value = contact.name
	suggestions.value = []
	emit('pick', contact)
}

/**
 * Arrow keys move through the rows, Enter picks, Escape closes the list
 *
 * @param {KeyboardEvent} event - a key on the field
 */
function onKey(event) {
	if (!open.value) {
		return
	}
	const count = suggestions.value.length
	if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
		active.value = (active.value + (event.key === 'ArrowDown' ? 1 : count - 1)) % count
	} else if (event.key === 'Enter') {
		pick(suggestions.value[active.value])
	} else if (event.key === 'Escape') {
		suggestions.value = []
	} else {
		return
	}
	event.preventDefault()
	event.stopPropagation()
}
</script>

<template>
	<div ref="field" class="deliver-contact-field">
		<NcTextField
			v-model="name"
			:label="props.label"
			:disabled="disabled"
			role="combobox"
			aria-autocomplete="list"
			:aria-expanded="open ? 'true' : 'false'"
			:aria-controls="listId"
			:aria-activedescendant="open ? `${listId}-${active}` : undefined"
			autocomplete="off"
			@keydown="onKey"
			@blur="suggestions = []" />
		<Teleport :to="layer ?? 'body'">
			<ul
				v-if="open"
				:id="listId"
				ref="list"
				:style="place"
				class="deliver-contact-field__list"
				role="listbox">
				<li
					v-for="(contact, index) in suggestions"
					:id="`${listId}-${index}`"
					:key="contact.email"
					role="option"
					:aria-selected="index === active ? 'true' : 'false'"
					class="deliver-contact-field__option"
					:class="{ 'deliver-contact-field__option--active': index === active }"
					@mouseenter="active = index"
					@mousedown.prevent="pick(contact)">
					<NcListItemIcon
						:name="contact.name"
						:subname="contact.email"
						:search="name"
						:url="contact.photo ?? undefined"
						:avatarSize="32"
						isNoUser />
				</li>
			</ul>
		</Teleport>
	</div>
</template>

<style scoped>
.deliver-contact-field {
	position: relative;
	/* Shares the row as the email field next to it does */
	width: 100%;
	min-width: 0;
}

.deliver-contact-field__list {
	position: fixed;
	/* Over the dialog it may belong to */
	z-index: 10000;
	width: max-content;
	/* Five rows of 48px, or less when the screen has no more room on that side */
	max-height: min(var(--deliver-contact-room, 100vh), 5 * 48px + 2 * var(--default-grid-baseline));
	overflow-y: auto;
	padding: var(--default-grid-baseline);
	border-radius: var(--border-radius-large);
	background-color: var(--color-main-background);
	box-shadow: 0 2px 8px var(--color-box-shadow);
}

.deliver-contact-field__option {
	border-radius: var(--border-radius);
	cursor: pointer;
}

.deliver-contact-field__option--active {
	background-color: var(--color-background-hover);
}
</style>
