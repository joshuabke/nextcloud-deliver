<script setup>
import changesIcon from '@mdi/svg/svg/alert-circle-outline.svg?raw'
import settingsIcon from '@mdi/svg/svg/cog-outline.svg?raw'
import commentIcon from '@mdi/svg/svg/comment-outline.svg?raw'
import projectIcon from '@mdi/svg/svg/folder-play-outline.svg?raw'
import versionIcon from '@mdi/svg/svg/layers-plus.svg?raw'
import { n, t } from '@nextcloud/l10n'
import { computed, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDateTime from '@nextcloud/vue/components/NcDateTime'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import DueDate from './DueDate.vue'
import { previewUrl } from '../lib/preview.js'

const props = defineProps({
	/** A Project with its activity, as the Project list has it */
	project: { type: Object, required: true },
})

const emit = defineEmits(['settings'])

/** Stills the server could not render drop out of the picture */
const broken = ref(new Set())
const posters = computed(() => props.project.activity.posters.filter((fileId) => !broken.value.has(fileId)))
/** What is new for me, and what waits on someone */
const badges = computed(() => {
	const { unseenComments, unseenVersions, changes } = props.project.activity
	return [
		{ kind: 'unseen', icon: commentIcon, count: unseenComments, text: n('deliver', '%n Unseen Comment', '%n Unseen Comments', unseenComments) },
		{ kind: 'unseen', icon: versionIcon, count: unseenVersions, text: n('deliver', '%n Unseen Version', '%n Unseen Versions', unseenVersions) },
		{ kind: 'changes', icon: changesIcon, count: changes, text: n('deliver', '%n Asset with changes requested', '%n Assets with changes requested', changes) },
	].filter((badge) => badge.count > 0)
})
</script>

<template>
	<li class="deliver-project-card">
		<RouterLink class="deliver-project-card__link" :to="`/projects/${project.id}`">
			<div class="deliver-project-card__still" :class="`deliver-project-card__still--${Math.min(posters.length, 3)}`">
				<img
					v-for="fileId in posters"
					:key="fileId"
					:src="previewUrl(fileId, posters.length === 1 ? 480 : 256)"
					alt=""
					@error="broken = new Set(broken).add(fileId)">
				<NcIconSvgWrapper v-if="posters.length === 0" :svg="projectIcon" :size="48" />
				<div v-if="badges.length" class="deliver-project-card__badges">
					<span
						v-for="badge in badges"
						:key="badge.text"
						class="deliver-project-card__badge"
						:class="`deliver-project-card__badge--${badge.kind}`"
						:title="badge.text"
						:aria-label="badge.text">
						<NcIconSvgWrapper :svg="badge.icon" :size="14" />
						{{ badge.count }}
					</span>
				</div>
			</div>
			<div class="deliver-project-card__name" :title="project.name">
				{{ project.name }}
			</div>
			<div class="deliver-project-card__meta">
				<NcDateTime :timestamp="project.activity.lastActivity * 1000" />
				· {{ n('deliver', '%n Asset', '%n Assets', project.activity.assets) }}
			</div>
			<DueDate v-if="project.activity.nextDue" class="deliver-project-card__due" :modelValue="project.activity.nextDue" />
		</RouterLink>
		<NcButton
			class="deliver-project-card__settings"
			variant="tertiary"
			:aria-label="t('deliver', 'Settings of {project}', { project: project.name })"
			:title="t('deliver', 'Project settings')"
			@click="emit('settings')">
			<template #icon>
				<NcIconSvgWrapper :svg="settingsIcon" />
			</template>
		</NcButton>
	</li>
</template>

<style scoped>
.deliver-project-card {
	position: relative;
	min-width: 0;
}

/* Over the picture's corner, outside the link, so the tile stays one link */
.deliver-project-card__settings {
	position: absolute !important;
	top: calc(3 * var(--default-grid-baseline, 4px));
	inset-inline-end: calc(3 * var(--default-grid-baseline, 4px));
	background: rgba(0, 0, 0, 0.6) !important;
	color: #fff !important;
	opacity: 0;
}

.deliver-project-card:hover .deliver-project-card__settings,
.deliver-project-card__settings:focus-visible {
	opacity: 1;
}

.deliver-project-card__link {
	display: flex;
	flex-direction: column;
	gap: 2px;
	padding: calc(2 * var(--default-grid-baseline, 4px));
	border-radius: var(--border-radius-large, 12px);
	color: var(--color-main-text);
}

.deliver-project-card__link:hover,
.deliver-project-card__link:focus-visible {
	background: var(--color-background-hover);
}

/* One still fills the picture, two sit side by side, more make a grid of four */
.deliver-project-card__still {
	position: relative;
	display: grid;
	place-items: center;
	gap: 2px;
	aspect-ratio: 16 / 9;
	margin-bottom: var(--default-grid-baseline, 4px);
	border-radius: var(--border-radius, 8px);
	background: #111;
	color: #bbb;
	overflow: hidden;
}

.deliver-project-card__still--2 {
	grid-template-columns: 1fr 1fr;
}

.deliver-project-card__still--3 {
	grid-template: 1fr 1fr / 1fr 1fr;
}

.deliver-project-card__still img {
	width: 100%;
	height: 100%;
	min-height: 0;
	object-fit: cover;
}

.deliver-project-card__badges {
	position: absolute;
	top: 6px;
	inset-inline-start: 6px;
	display: flex;
	gap: 4px;
}

.deliver-project-card__badge {
	display: flex;
	align-items: center;
	gap: 3px;
	padding: 1px 6px;
	border-radius: var(--border-radius, 4px);
	color: #fff;
	font-size: 12px;
	font-weight: bold;
}

.deliver-project-card__badge--unseen {
	background: var(--color-primary-element);
	color: var(--color-primary-element-text);
}

.deliver-project-card__badge--changes {
	background: #c77800;
}

.deliver-project-card__name {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-weight: bold;
}

.deliver-project-card__meta {
	color: var(--color-text-maxcontrast);
	font-size: 13px;
}

.deliver-project-card__due {
	align-self: flex-start;
	margin-top: 4px;
}
</style>
