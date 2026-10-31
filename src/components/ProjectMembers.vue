<script setup>
import infoIcon from '@mdi/svg/svg/information-outline.svg?raw'
import { computed, onMounted, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import { listProjectMembers, resetProjectMember, setProjectMember } from '../api.js'
import { useBusy } from '../composables/busy.js'
import { afterReset, approveLocked, clampSwitches, shareLocked } from '../lib/access.js'
import { t } from '../lib/l10n.js'
import { useProjectsStore } from '../store/projects.js'

// A Project's Members and what each may do in it (ADR 0016), for a Member with Manage
const props = defineProps({
	project: { type: Object, required: true },
})

const store = useProjectsStore()
const { busy, error, run } = useBusy()

const LEVELS = [
	{ id: 'none', label: t('deliver', 'None') },
	{ id: 'view', label: t('deliver', 'View') },
	{ id: 'comment', label: t('deliver', 'Comment') },
	{ id: 'manage', label: t('deliver', 'Manage') },
]
const NEWCOMERS = [
	{ id: 'files', label: t('deliver', 'As in Files') },
	{ id: 'view', label: t('deliver', 'View') },
	{ id: 'none', label: t('deliver', 'None') },
]
/** Past this many, a search narrows the list */
const SEARCH_FROM = 8

const members = ref([])
const search = ref('')

const shown = computed(() => {
	const needle = search.value.trim().toLowerCase()
	return needle === '' ? members.value : members.value.filter((each) => each.name.toLowerCase().includes(needle) || each.id.toLowerCase().includes(needle))
})
/** What I have myself bounds what I give */
const mine = computed(() => props.project.access)

/**
 *
 */
async function load() {
	members.value = await listProjectMembers(props.project.id)
}

onMounted(() => run(load))

/**
 * @param {object} member - a row
 * @return {string|null} why its level is fixed, if it is
 */
function levelLocked(member) {
	return member.owner ? t('deliver', 'The owner of a Project keeps Manage, Share and Approve.') : null
}

/**
 * @param {object} member - a row
 * @param {object} fields - level, share or approve, whichever changed
 */
function change(member, fields) {
	return run(async () => {
		// Switches the level cannot carry are off
		const next = clampSwitches({ level: member.level, share: member.share, approve: member.approve, ...fields })
		try {
			const saved = await setProjectMember(props.project.id, { type: member.type, principal: member.id, ...next })
			members.value = members.value.map((each) => each.type === member.type && each.id === member.id ? saved : each)
		} catch (e) {
			// The row goes back to what the server has
			await load()
			throw e
		}
	})
}

/**
 * @param {object} member - a row with something set for it
 */
function reset(member) {
	return run(async () => {
		members.value = afterReset(members.value, await resetProjectMember(props.project.id, member.type, member.id))
	})
}

/**
 * @param {Event} event - the change of the select
 */
function setNewcomers(event) {
	return run(async () => {
		await store.save(props.project.id, { newcomers: event.target.value })
		// Everyone who was a Member now has an entry of their own
		await load()
	})
}
</script>

<template>
	<section class="deliver-members">
		<h4>{{ t('deliver', 'Members') }}</h4>
		<label class="deliver-members__newcomers">
			<span>{{ t('deliver', 'Someone newly given access in Files starts with') }}</span>
			<select :value="project.newcomers" :disabled="busy" @change="setNewcomers">
				<option v-for="option in NEWCOMERS" :key="option.id" :value="option.id">
					{{ option.label }}
				</option>
			</select>
		</label>
		<NcTextField
			v-if="members.length > SEARCH_FROM"
			v-model="search"
			:label="t('deliver', 'Search Members')"
			type="search" />
		<ul class="deliver-members__list">
			<li
				v-for="member in shown"
				:key="member.type + member.id"
				class="deliver-members__row"
				:data-member="member.id">
				<div class="deliver-members__who">
					<strong>{{ member.name }}</strong>
					<span v-if="member.type === 'group'" class="deliver-members__hint">{{ t('deliver', 'Group') }}</span>
					<span v-else-if="member.owner" class="deliver-members__hint">{{ t('deliver', 'Owner') }}</span>
					<span v-else-if="member.via.length" class="deliver-members__hint">
						{{ t('deliver', 'through group {group}', { group: member.via.map((each) => each.name).join(', ') }) }}
					</span>
					<span v-if="!member.reaches" class="deliver-members__hint">{{ t('deliver', 'No longer reaches the Project') }}</span>
				</div>
				<select
					class="deliver-members__level"
					:aria-label="t('deliver', 'Access level of {name}', { name: member.name })"
					:title="levelLocked(member) ?? ''"
					:value="member.level"
					:disabled="busy || member.owner"
					@change="change(member, { level: $event.target.value })">
					<option v-for="level in LEVELS" :key="level.id" :value="level.id">
						{{ level.label }}
					</option>
				</select>
				<span class="deliver-members__switch">
					<NcCheckboxRadioSwitch
						:modelValue="member.share"
						:disabled="busy || shareLocked(member, mine) !== null"
						@update:modelValue="change(member, { share: $event })">
						{{ t('deliver', 'Share') }}
					</NcCheckboxRadioSwitch>
					<!-- A disabled switch shows no tooltip of its own, so the reason sits on an icon next to it -->
					<NcIconSvgWrapper
						v-if="shareLocked(member, mine)"
						class="deliver-members__why"
						:svg="infoIcon"
						:size="16"
						:name="shareLocked(member, mine)"
						:title="shareLocked(member, mine)" />
				</span>
				<span class="deliver-members__switch">
					<NcCheckboxRadioSwitch
						:modelValue="member.approve"
						:disabled="busy || approveLocked(member, mine) !== null"
						@update:modelValue="change(member, { approve: $event })">
						{{ t('deliver', 'Approve') }}
					</NcCheckboxRadioSwitch>
					<NcIconSvgWrapper
						v-if="approveLocked(member, mine)"
						class="deliver-members__why"
						:svg="infoIcon"
						:size="16"
						:name="approveLocked(member, mine)"
						:title="approveLocked(member, mine)" />
				</span>
				<NcButton
					v-if="member.stored && !member.owner"
					variant="tertiary"
					:disabled="busy"
					:title="t('deliver', 'Back to what Files gives')"
					@click="reset(member)">
					{{ t('deliver', 'Reset') }}
				</NcButton>
			</li>
		</ul>
		<NcNoteCard v-if="error" type="error">
			{{ error }}
		</NcNoteCard>
	</section>
</template>

<style scoped>
.deliver-members {
	display: flex;
	flex-direction: column;
	gap: var(--default-grid-baseline);
}

.deliver-members__newcomers {
	display: flex;
	flex-direction: column;
	gap: var(--default-grid-baseline);
}

.deliver-members__list {
	display: grid;
	/* Who, level, Share, Approve, Reset: the same columns in every row */
	grid-template-columns: minmax(0, 1fr) auto auto auto auto;
	column-gap: calc(2 * var(--default-grid-baseline));
	max-height: 40vh;
	overflow-y: auto;
}

.deliver-members__row {
	display: grid;
	grid-column: 1 / -1;
	grid-template-columns: subgrid;
	align-items: center;
	padding-block: var(--default-grid-baseline);
	border-bottom: 1px solid var(--color-border);
}

/* Too narrow for the columns: each row wraps on its own */
@media (max-width: 600px) {
	.deliver-members__list {
		display: flex;
		flex-direction: column;
	}

	.deliver-members__row {
		display: flex;
		flex-wrap: wrap;
		gap: calc(2 * var(--default-grid-baseline));
	}
}

.deliver-members__who {
	display: flex;
	flex: 1 1 10em;
	flex-direction: column;
	min-width: 0;
}

.deliver-members__hint {
	color: var(--color-text-maxcontrast);
}

.deliver-members__switch {
	display: inline-flex;
	align-items: center;
}

.deliver-members__why {
	color: var(--color-text-maxcontrast);
	cursor: help;
}

.deliver-members__level {
	width: auto;
	margin: 0;
}
</style>
