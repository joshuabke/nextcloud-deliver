<script setup>
import changesIcon from '@mdi/svg/svg/alert-circle-outline.svg?raw'
import settingsIcon from '@mdi/svg/svg/cog-outline.svg?raw'
import commentIcon from '@mdi/svg/svg/comment-outline.svg?raw'
import moreIcon from '@mdi/svg/svg/dots-horizontal.svg?raw'
import projectIcon from '@mdi/svg/svg/folder-play-outline.svg?raw'
import { n, t } from '@nextcloud/l10n'
import { useIsMobile } from '@nextcloud/vue/composables/useIsMobile'
import { computed, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDateTime from '@nextcloud/vue/components/NcDateTime'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import DueDate from './DueDate.vue'
import { useLongPress } from '../composables/longpress.js'
import { previewUrl } from '../lib/preview.js'

const props = defineProps({
	/** A Project with its activity, as the Project list has it */
	project: { type: Object, required: true },
})

const emit = defineEmits(['settings', 'menu'])

/** A phone has no hover and no right click: the menu has a button of its own, and a long press opens it too (story 109) */
const isMobile = useIsMobile()
const { press, fromButton } = useLongPress((where) => emit('menu', where))

/** Set when the server could not render the still; the icon stands in */
const broken = ref(false)
/** What is new for me, and what waits on someone */
const badges = computed(() => {
	const { unseenComments, changes } = props.project.activity
	return [
		{ kind: 'unseen', icon: commentIcon, count: unseenComments, text: n('deliver', '%n Unseen Comment', '%n Unseen Comments', unseenComments) },
		{ kind: 'changes', icon: changesIcon, count: changes, text: n('deliver', '%n Asset with changes requested', '%n Assets with changes requested', changes) },
	].filter((badge) => badge.count > 0)
})
</script>

<template>
	<li class="deliver-project-card" v-on="press">
		<RouterLink class="deliver-card__link" :to="`/projects/${project.id}`">
			<div class="deliver-card__still">
				<img
					v-if="project.activity.still && !broken"
					:src="previewUrl(project.activity.still, 480)"
					alt=""
					@error="broken = true">
				<NcIconSvgWrapper v-else :svg="projectIcon" :size="48" />
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
			<div class="deliver-card__name" :title="project.name">
				{{ project.name }}
			</div>
			<div class="deliver-card__meta">
				<NcDateTime :timestamp="project.activity.lastActivity * 1000" />
				· {{ n('deliver', '%n Asset', '%n Assets', project.activity.assets) }}
			</div>
			<DueDate v-if="project.activity.nextDue" class="deliver-card__due" :modelValue="project.activity.nextDue" />
		</RouterLink>
		<NcButton
			v-if="isMobile"
			class="deliver-project-card__settings deliver-project-card__settings--shown"
			variant="tertiary"
			:aria-label="t('deliver', 'Actions for {name}', { name: project.name })"
			@click="fromButton">
			<template #icon>
				<NcIconSvgWrapper :svg="moreIcon" />
			</template>
		</NcButton>
		<NcButton
			v-else
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

<style scoped src="./card.css"></style>

<style scoped>
.deliver-project-card {
	position: relative;
	min-width: 0;
}

/* Over the picture's corner, outside the link, so the tile stays one link */
.deliver-project-card__settings {
	position: absolute !important;
	top: calc(3 * var(--default-grid-baseline));
	inset-inline-end: calc(3 * var(--default-grid-baseline));
	background: rgba(0, 0, 0, 0.6) !important;
	color: #fff !important;
	opacity: 0;
}

.deliver-project-card:hover .deliver-project-card__settings,
.deliver-project-card__settings:focus-visible,
.deliver-project-card__settings--shown {
	opacity: 1;
}

/* A still of the newest video, filling the tile */
.deliver-project-card .deliver-card__still img {
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
	border-radius: var(--border-radius);
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
</style>
