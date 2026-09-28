<script setup>
import panelIcon from '@mdi/svg/svg/dock-right.svg?raw'
import { t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'

/** Whether the panel beside the player is open */
const panelOpen = defineModel('panelOpen', { type: Boolean, default: true })
</script>

<template>
	<!-- The Review view is dark in any theme, like every video tool: the picture is what should stand out -->
	<div class="deliver-layout">
		<div class="deliver-layout__bar">
			<div class="deliver-layout__start">
				<slot name="start" />
			</div>
			<div class="deliver-layout__center">
				<slot name="center" />
			</div>
			<div class="deliver-layout__end">
				<slot name="end" />
				<NcButton
					variant="tertiary"
					:pressed="panelOpen"
					:aria-label="panelOpen ? t('deliver', 'Hide Comments') : t('deliver', 'Show Comments')"
					:title="panelOpen ? t('deliver', 'Hide Comments') : t('deliver', 'Show Comments')"
					@click="panelOpen = !panelOpen">
					<template #icon>
						<NcIconSvgWrapper :svg="panelIcon" />
					</template>
				</NcButton>
			</div>
		</div>
		<slot name="notice" />
		<div class="deliver-layout__body" :class="{ 'deliver-layout__body--wide': !panelOpen }">
			<div class="deliver-layout__main">
				<slot />
			</div>
			<div v-show="panelOpen" class="deliver-layout__panel">
				<slot name="panel" />
			</div>
		</div>
	</div>
</template>

<style scoped>
.deliver-layout {
	--color-main-background: #141416;
	--color-main-background-rgb: 20, 20, 22;
	--color-main-text: #ececef;
	--color-text-maxcontrast: #9a9aa2;
	--color-border: #2a2a2f;
	--color-border-dark: #3a3a40;
	--color-border-maxcontrast: #56565e;
	--color-background-hover: rgba(255, 255, 255, 0.08);
	--color-background-dark: #1f1f23;
	--color-background-darker: #27272c;
	--color-primary-element-light: rgba(255, 255, 255, 0.1);
	--color-primary-element-light-hover: rgba(255, 255, 255, 0.16);
	--color-primary-element-light-text: #ececef;
	/* Note cards take their tint from these */
	--color-success: #17301d;
	--color-success-text: #5fd068;
	--color-info: #15283a;
	--color-info-text: #6ea8ff;
	--color-warning: #35290f;
	--color-warning-text: #f5c518;
	--color-error: #3a1818;
	--color-error-text: #ff7b72;
	--deliver-card: #19191c;
	--deliver-timecode: #6ea8ff;
	display: flex;
	flex-direction: column;
	height: 100%;
	min-width: 0;
	background: var(--color-main-background);
	color: var(--color-main-text);
	color-scheme: dark;
}

.deliver-layout__bar {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
	align-items: center;
	gap: calc(2 * var(--default-grid-baseline, 4px));
	min-height: 56px;
	padding: 0 calc(3 * var(--default-grid-baseline, 4px));
	border-bottom: 1px solid var(--color-border);
}

.deliver-layout__start,
.deliver-layout__center,
.deliver-layout__end {
	display: flex;
	align-items: center;
	gap: calc(2 * var(--default-grid-baseline, 4px));
	min-width: 0;
}

.deliver-layout__end {
	justify-content: flex-end;
}

.deliver-layout__body {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 440px;
	flex: 1;
	min-height: 0;
}

.deliver-layout__body--wide {
	grid-template-columns: minmax(0, 1fr);
}

.deliver-layout__main {
	display: flex;
	flex-direction: column;
	min-height: 0;
	min-width: 0;
}

.deliver-layout__panel {
	display: flex;
	flex-direction: column;
	min-height: 0;
	border-inline-start: 1px solid var(--color-border);
	overflow: hidden;
}

@media (max-width: 1024px) {
	.deliver-layout__body {
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: minmax(60vh, 1fr) auto;
		overflow-y: auto;
	}

	.deliver-layout__panel {
		border-inline-start: none;
		border-top: 1px solid var(--color-border);
		min-height: 60vh;
	}
}
</style>
