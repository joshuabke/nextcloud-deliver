<script setup>
import { t } from '@nextcloud/l10n'
import { ref } from 'vue'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import { setReviewerRights } from '../api.js'
import { useBusy } from '../composables/busy.js'

/**
 * A Reviewer's own rights on one Review Link they are on, over the link's
 * (ADR 0014). Each change is saved at once, as the link's own switches are.
 */
const props = defineProps({
	/** {id, name} */
	reviewer: { type: Object, required: true },
	/** The link as the navigation lists it: title, token and its rights */
	share: { type: Object, required: true },
	/** {canComment, allowOlder, watermark}, null where the link decides */
	rights: { type: Object, required: true },
})
const emit = defineEmits(['changed', 'close'])

const RIGHTS = [
	{ id: 'canComment', label: t('deliver', 'Comment') },
	{ id: 'allowOlder', label: t('deliver', 'Comment on older Versions') },
	{ id: 'watermark', label: t('deliver', 'Watermark with their name') },
]
const own = ref({ ...props.rights })
const { busy, error, run } = useBusy()

/**
 * @param {string} right - one of RIGHTS
 * @return {Array<{id: ?boolean, label: string}>} the link's setting, with what it says now, or yes or no
 */
function choices(right) {
	const linkSays = props.share[right] ? t('deliver', 'Yes') : t('deliver', 'No')
	return [
		{ id: null, label: t('deliver', 'From the Review Link ({value})', { value: linkSays }) },
		{ id: true, label: t('deliver', 'Yes') },
		{ id: false, label: t('deliver', 'No') },
	]
}

/**
 * @param {string} right - one of RIGHTS
 * @param {?boolean} value - their own, or null for the link's
 */
function set(right, value) {
	return run(async () => {
		own.value = await setReviewerRights(props.reviewer.id, props.share.token, { ...own.value, [right]: value })
		emit('changed', own.value)
	})
}
</script>

<template>
	<NcDialog
		:name="t('deliver', '{name} on “{link}”', { name: reviewer.name, link: share.title })"
		size="normal"
		@closing="emit('close')">
		<div class="deliver-personal-rights">
			<NcSelect
				v-for="right in RIGHTS"
				:key="right.id"
				:modelValue="choices(right.id).find((choice) => choice.id === (own[right.id] ?? null))"
				:options="choices(right.id)"
				:clearable="false"
				:disabled="busy"
				:inputLabel="right.label"
				@update:modelValue="set(right.id, $event.id)" />
			<p v-if="error" class="deliver-personal-rights__error">
				{{ error }}
			</p>
		</div>
	</NcDialog>
</template>

<style scoped>
.deliver-personal-rights {
	display: flex;
	flex-direction: column;
	gap: calc(2 * var(--default-grid-baseline));
	padding-bottom: calc(2 * var(--default-grid-baseline));
}

.deliver-personal-rights__error {
	color: var(--color-error-text);
}
</style>
