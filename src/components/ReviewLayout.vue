<script setup>
import panelIcon from '@mdi/svg/svg/dock-right.svg?raw'
import { t } from '@nextcloud/l10n'
import { useIsMobile } from '@nextcloud/vue/composables/useIsMobile'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'

/** Whether the panel beside the player is open; on a phone it always is, under the player */
const panelOpen = defineModel('panelOpen', { type: Boolean, default: true })

/** Below 1024 px the player sits on top and the Comments below it; the bar keeps only what fits */
const isMobile = useIsMobile()
</script>

<template>
	<!-- The Review view is dark in any theme, like every video tool: the picture is what should stand out -->
	<div class="deliver-layout" :class="{ 'deliver-layout--mobile': isMobile }">
		<div class="deliver-layout__bar">
			<div class="deliver-layout__start">
				<slot name="start" />
			</div>
			<div v-if="!isMobile" class="deliver-layout__center">
				<slot name="center" />
			</div>
			<div class="deliver-layout__end">
				<slot name="end" />
				<!-- What does not fit into a phone's bar -->
				<NcActions v-if="isMobile && $slots.menu" variant="tertiary" :aria-label="t('deliver', 'More')">
					<slot name="menu" />
				</NcActions>
				<NcButton
					v-if="!isMobile"
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
		<div class="deliver-layout__body" :class="{ 'deliver-layout__body--wide': !panelOpen && !isMobile }">
			<div class="deliver-layout__main">
				<slot />
			</div>
			<div v-show="panelOpen || isMobile" class="deliver-layout__panel">
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
	gap: calc(2 * var(--default-grid-baseline));
	min-height: 56px;
	padding: 0 calc(3 * var(--default-grid-baseline));
	border-bottom: 1px solid var(--color-border);
}

.deliver-layout__start,
.deliver-layout__center,
.deliver-layout__end {
	display: flex;
	align-items: center;
	gap: calc(2 * var(--default-grid-baseline));
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

/* On a phone: the bar in one row, the player on top at its width, the Comments below; the page itself does not scroll */
.deliver-layout--mobile .deliver-layout__bar {
	display: flex;
	min-height: 48px;
	padding: 0 var(--default-grid-baseline);
	gap: var(--default-grid-baseline);
}

.deliver-layout--mobile .deliver-layout__start {
	flex: 1;
	gap: var(--default-grid-baseline);
}

.deliver-layout--mobile .deliver-layout__end {
	flex: none;
	gap: 2px;
}

.deliver-layout--mobile .deliver-layout__body {
	display: flex;
	flex-direction: column;
	overflow: hidden;
}

/* A 16:9 picture at full width, plus its timeline and controls */
.deliver-layout--mobile .deliver-layout__main {
	flex: none;
	height: min(calc(56.25vw + 96px), 55%);
}

.deliver-layout--mobile .deliver-layout__panel {
	flex: 1;
	border-inline-start: none;
	border-top: 1px solid var(--color-border);
}
</style>
