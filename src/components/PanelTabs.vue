<script setup>
defineProps({
	/** [{ id, label }] */
	tabs: { type: Array, required: true },
	modelValue: { type: String, required: true },
})

const emit = defineEmits(['update:modelValue'])
</script>

<template>
	<div class="deliver-tabs" role="tablist">
		<button
			v-for="tab in tabs"
			:key="tab.id"
			type="button"
			role="tab"
			class="deliver-tabs__tab"
			:aria-selected="tab.id === modelValue"
			@click="emit('update:modelValue', tab.id)">
			{{ tab.label }}
		</button>
	</div>
</template>

<style scoped>
/* A segmented control, the chosen side lifted */
.deliver-tabs {
	display: flex;
	gap: 2px;
	margin: calc(3 * var(--default-grid-baseline)) calc(3 * var(--default-grid-baseline)) var(--default-grid-baseline);
	padding: 3px;
	border-radius: var(--border-radius-element);
	background: var(--color-background-dark);
}

.deliver-tabs__tab {
	flex: 1;
	min-height: 0;
	margin: 0;
	padding: 6px;
	border: none;
	border-radius: calc(var(--border-radius-element) - 2px);
	background: none;
	color: var(--color-text-maxcontrast);
	cursor: pointer;
}

.deliver-tabs__tab[aria-selected='true'] {
	background: var(--color-background-darker);
	color: var(--color-main-text);
	font-weight: bold;
}
</style>
