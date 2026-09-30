<script setup>
/** The chosen option's id */
const value = defineModel({ type: String, required: true })

defineProps({
	/** [{ id, label }] */
	options: { type: Array, required: true },
	/** The options share the full width, as tabs over a list */
	wide: { type: Boolean, default: false },
})
</script>

<template>
	<div class="deliver-segmented" :class="{ 'deliver-segmented--wide': wide }" role="radiogroup">
		<button
			v-for="option in options"
			:key="option.id"
			type="button"
			role="radio"
			:aria-checked="option.id === value"
			@click="value = option.id">
			{{ option.label }}
		</button>
	</div>
</template>

<style scoped>
/* A segmented control, the chosen option lifted; the resets keep Nextcloud's button style away */
.deliver-segmented {
	display: flex;
	padding: 3px;
	border-radius: var(--border-radius-element);
	background: var(--color-background-dark);
}

.deliver-segmented button {
	min-height: 0;
	margin: 0;
	padding: 4px 10px;
	border: none;
	border-radius: calc(var(--border-radius-element) - 2px);
	background: none;
	color: var(--color-text-maxcontrast);
	font-weight: normal;
	cursor: pointer;
}

.deliver-segmented--wide {
	gap: 2px;
}

.deliver-segmented--wide button {
	flex: 1;
	padding: 6px;
	font-weight: bold;
}

.deliver-segmented button[aria-checked='true'] {
	background: var(--color-background-darker);
	color: var(--color-main-text);
	font-weight: bold;
}
</style>
