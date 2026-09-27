<script setup>
import changesIcon from '@mdi/svg/svg/alert-circle-outline.svg?raw'
import approvedIcon from '@mdi/svg/svg/check-decagram.svg?raw'
import { showError } from '@nextcloud/dialogs'
import { t } from '@nextcloud/l10n'
import { computed } from 'vue'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcAvatar from '@nextcloud/vue/components/NcAvatar'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { errorMessage } from '../api.js'
import { useCommentsStore } from '../store/comments.js'

const store = useCommentsStore()

const LABELS = {
	approved: t('deliver', 'Approved'),
	changes: t('deliver', 'Changes requested'),
}

/** Only who may comment decides; everyone sees the decisions (story 88) */
const canDecide = computed(() => store.canComment === true && store.me?.type !== 'unnamed')
const label = computed(() => LABELS[store.myDecision] ?? t('deliver', 'Approve'))

/**
 * @param {string|null} status - approved, changes, or null to take the decision back
 */
async function decide(status) {
	try {
		await store.decide(status)
	} catch (e) {
		showError(errorMessage(e))
	}
}
</script>

<template>
	<div class="deliver-approval">
		<ul v-if="store.approvals.length" class="deliver-approval__people">
			<li
				v-for="approval in store.approvals"
				:key="approval.author.type + approval.author.id"
				:class="`deliver-approval__person--${approval.status}`"
				:title="approval.author.name + ': ' + LABELS[approval.status]">
				<NcAvatar
					:user="approval.author.type === 'user' ? approval.author.id : undefined"
					:displayName="approval.author.name"
					:isNoUser="approval.author.type !== 'user'"
					:size="24"
					hideStatus
					disableMenu
					disableTooltip />
			</li>
		</ul>
		<NcActions
			v-if="canDecide"
			class="deliver-approval__menu"
			:class="store.myDecision && `deliver-approval__menu--${store.myDecision}`"
			:variant="store.myDecision ? 'primary' : 'secondary'"
			:menuName="label"
			:forceName="true"
			:aria-label="t('deliver', 'Approval')">
			<template #icon>
				<NcIconSvgWrapper :svg="store.myDecision === 'changes' ? changesIcon : approvedIcon" />
			</template>
			<NcActionButton
				:modelValue="store.myDecision === 'approved'"
				type="radio"
				closeAfterClick
				@click="decide('approved')">
				<template #icon>
					<NcIconSvgWrapper :svg="approvedIcon" />
				</template>
				{{ t('deliver', 'Approve this Version') }}
			</NcActionButton>
			<NcActionButton
				:modelValue="store.myDecision === 'changes'"
				type="radio"
				closeAfterClick
				@click="decide('changes')">
				<template #icon>
					<NcIconSvgWrapper :svg="changesIcon" />
				</template>
				{{ t('deliver', 'Request changes') }}
			</NcActionButton>
			<NcActionButton v-if="store.myDecision" closeAfterClick @click="decide(null)">
				{{ t('deliver', 'Take my decision back') }}
			</NcActionButton>
		</NcActions>
	</div>
</template>

<style scoped>
.deliver-approval {
	display: flex;
	align-items: center;
	gap: calc(2 * var(--default-grid-baseline, 4px));
}

/* Overlapping avatars, each ringed in the colour of its decision */
.deliver-approval__people {
	display: flex;
}

.deliver-approval__people li {
	display: flex;
	margin-inline-start: -6px;
	border: 2px solid #2e7d32;
	border-radius: 50%;
}

.deliver-approval__people li.deliver-approval__person--changes {
	border-color: #c77800;
}

.deliver-approval__menu--approved :deep(.button-vue) {
	background: #2e7d32;
	color: #fff;
}

.deliver-approval__menu--changes :deep(.button-vue) {
	background: #c77800;
	color: #fff;
}
</style>
