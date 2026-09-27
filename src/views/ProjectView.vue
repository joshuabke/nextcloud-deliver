<script setup>
import folderIcon from '@mdi/svg/svg/folder-outline.svg?raw'
import { t } from '@nextcloud/l10n'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import AssetCard from '../components/AssetCard.vue'
import { errorMessage, muteProject, stackVersion } from '../api.js'
import { groupByFolder } from '../lib/folders.js'
import { stackSuggestions } from '../lib/suggestions.js'
import { useProjectsStore } from '../store/projects.js'

const props = defineProps({
	id: { type: Number, required: true },
})

const store = useProjectsStore()
const error = ref(null)
const project = computed(() => store.details[props.id])

watch(() => props.id, async (id) => {
	error.value = null
	try {
		await store.fetch(id)
	} catch (e) {
		error.value = errorMessage(e)
	}
}, { immediate: true })

// While derived media is being made, look again every ten seconds for the progress
let recheck = null
watch(project, (current) => {
	clearTimeout(recheck)
	if (current?.assets.some((asset) => asset.versions[0].processing)) {
		recheck = setTimeout(() => store.fetch(props.id).catch(() => {}), 10000)
	}
})
onBeforeUnmount(() => clearTimeout(recheck))

/** Stacks a filename suggests, where more than one Asset matched (story 14) */
const suggestions = computed(() => stackSuggestions(project.value?.assets ?? []))

/**
 * @param {object} asset - the Asset to stack away
 * @param {object} target - the Asset it should join
 */
async function accept(asset, target) {
	error.value = null
	try {
		await stackVersion(asset.versions[0].id, target.id)
		await store.fetch(props.id)
	} catch (e) {
		error.value = errorMessage(e)
	}
}

/**
 * No notifications from this Project for me (story 64)
 *
 * @param {boolean} muted - the new switch state
 */
async function mute(muted) {
	try {
		project.value.muted = (await muteProject(props.id, muted)).muted
	} catch (e) {
		error.value = errorMessage(e)
	}
}

const groups = computed(() => groupByFolder(project.value?.assets ?? []))
</script>

<template>
	<div class="deliver-project">
		<NcNoteCard v-if="error" type="error">
			{{ error }}
		</NcNoteCard>
		<NcEmptyContent v-else-if="!project" :name="t('deliver', 'Loading Project…')">
			<template #icon>
				<NcLoadingIcon />
			</template>
		</NcEmptyContent>
		<template v-else>
			<div class="deliver-project__head">
				<h2>{{ project.name }}</h2>
				<span class="deliver-project__spacer" />
				<NcCheckboxRadioSwitch
					type="switch"
					:modelValue="project.muted"
					@update:modelValue="mute">
					{{ t('deliver', 'Mute notifications') }}
				</NcCheckboxRadioSwitch>
			</div>
			<NcEmptyContent
				v-if="project.assets.length === 0"
				:name="t('deliver', 'No Assets yet')"
				:description="project.autoIntake
					? t('deliver', 'Every video or audio file placed in this folder becomes an Asset.')
					: t('deliver', 'Enable files for review in the Deliver tab of the Files sidebar.')" />
			<section v-for="group in groups" :key="group.path" class="deliver-project__group">
				<h3 v-if="group.path" class="deliver-project__folder">
					<NcIconSvgWrapper :svg="folderIcon" :size="20" />
					{{ group.path }}
				</h3>
				<ul class="deliver-project__grid">
					<AssetCard
						v-for="asset in group.assets"
						:key="asset.id"
						:asset="asset"
						:candidates="suggestions.get(asset.id) ?? []"
						@stack="accept" />
				</ul>
			</section>
		</template>
	</div>
</template>

<style scoped>
.deliver-project {
	display: flex;
	flex-direction: column;
	gap: calc(4 * var(--default-grid-baseline, 4px));
	padding: 0 calc(4 * var(--default-grid-baseline, 4px)) calc(6 * var(--default-grid-baseline, 4px));
}

/* One row next to the navigation toggle, which sits in the top left corner */
.deliver-project__head {
	display: flex;
	align-items: center;
	gap: calc(2 * var(--default-grid-baseline, 4px));
	min-height: calc(var(--default-clickable-area, 34px) + 4 * var(--default-grid-baseline, 4px));
	padding-inline-start: var(--default-clickable-area, 34px);
	border-bottom: 1px solid var(--color-border);
}

.deliver-project__head h2 {
	margin: 0;
	font-size: 20px;
}

.deliver-project__spacer {
	flex: 1;
}

.deliver-project__folder {
	display: flex;
	align-items: center;
	gap: calc(2 * var(--default-grid-baseline, 4px));
	margin: 0 0 calc(2 * var(--default-grid-baseline, 4px));
	padding-bottom: calc(2 * var(--default-grid-baseline, 4px));
	border-bottom: 1px solid var(--color-border);
	font-size: 16px;
}

.deliver-project__grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
	gap: calc(2 * var(--default-grid-baseline, 4px));
}
</style>
