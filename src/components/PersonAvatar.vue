<script setup>
import { usernameToColor } from '@nextcloud/vue/functions/usernameToColor'
import { computed } from 'vue'
import NcAvatar from '@nextcloud/vue/components/NcAvatar'
import { initials } from '../lib/initials.js'

// Whoever wrote or decided something. A Reviewer's colour follows who they
// are, not their name: two Reviewers called Kim look apart, as on Frame.io.
const props = defineProps({
	/** { type: user | reviewer | deleted, id, name } */
	author: { type: Object, required: true },
	size: { type: Number, default: 32 },
	/** The name on hover */
	tooltip: { type: Boolean, default: false },
})

const rgb = computed(() => {
	const { r, g, b } = usernameToColor(props.author.type === 'reviewer' ? `deliver-reviewer-${props.author.id}` : props.author.name)
	return `${r}, ${g}, ${b}`
})
</script>

<template>
	<NcAvatar
		v-if="author.type === 'user'"
		:user="author.id"
		:displayName="author.name"
		:size="size"
		hideStatus
		disableMenu
		:disableTooltip="!tooltip" />
	<span
		v-else
		class="deliver-avatar"
		:style="{ '--deliver-avatar-size': size + 'px', '--deliver-avatar-rgb': rgb }"
		:title="tooltip ? author.name : undefined"
		aria-hidden="true">
		{{ initials(author.name) }}
	</span>
</template>

<style scoped>
/* As NcAvatar draws a person without an account */
.deliver-avatar {
	display: inline-flex;
	flex: none;
	align-items: center;
	justify-content: center;
	width: var(--deliver-avatar-size);
	height: var(--deliver-avatar-size);
	border-radius: 50%;
	background-color: rgba(var(--deliver-avatar-rgb), 0.1);
	color: rgb(var(--deliver-avatar-rgb));
	font-size: calc(var(--deliver-avatar-size) * 0.45);
	line-height: 1;
	user-select: none;
}
</style>
