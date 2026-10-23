<script setup>
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
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
const list = useTemplateRef('list')

// The field may sit at the foot of a scrolling dialog: bring the list into sight
watch(open, async (opened) => {
	if (opened) {
		await nextTick()
		list.value?.scrollIntoView({ block: 'nearest' })
	}
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
	<div class="deliver-contact-field">
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
		<ul
			v-if="open"
			:id="listId"
			ref="list"
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
	position: absolute;
	z-index: 10;
	inset-inline-start: 0;
	top: calc(100% + var(--default-grid-baseline));
	/* Wider than a narrow field, so that names and addresses fit */
	width: max-content;
	min-width: 100%;
	max-width: min(320px, 80vw);
	max-height: calc(5 * var(--default-clickable-area));
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
