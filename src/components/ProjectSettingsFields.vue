<script setup>
import { t } from '@nextcloud/l10n'
import { computed } from 'vue'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcSelect from '@nextcloud/vue/components/NcSelect'

const props = defineProps({
	/** The Project whose settings these are */
	project: { type: Object, required: true },
	disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['save'])

/** Frame rates a Project can default to, for Assets whose own rate is unknown (story 7) */
const RATES = [
	{ id: '24000/1001', label: '23.976' },
	{ id: '24/1', label: '24' },
	{ id: '25/1', label: '25' },
	{ id: '30000/1001', label: '29.97' },
	{ id: '30/1', label: '30' },
	{ id: '50/1', label: '50' },
	{ id: '60000/1001', label: '59.94' },
	{ id: '60/1', label: '60' },
]
const MODES = [
	{ id: 'smpte', label: t('deliver', 'Timecode') },
	{ id: 'frames', label: t('deliver', 'Frame counter') },
	{ id: 'seconds', label: t('deliver', 'Seconds') },
]

const rate = computed(() => RATES.find((each) => each.id === `${props.project.fps.num}/${props.project.fps.den}`) ?? null)
const mode = computed(() => MODES.find((each) => each.id === props.project.timecodeMode) ?? null)
</script>

<template>
	<NcSelect
		:modelValue="rate"
		:options="RATES"
		:clearable="false"
		:disabled="disabled"
		:inputLabel="t('deliver', 'Frame rate when a file does not tell')"
		@update:modelValue="emit('save', { fpsNum: Number($event.id.split('/')[0]), fpsDen: Number($event.id.split('/')[1]) })" />
	<NcSelect
		:modelValue="mode"
		:options="MODES"
		:clearable="false"
		:disabled="disabled"
		:inputLabel="t('deliver', 'Show time as')"
		@update:modelValue="emit('save', { timecodeMode: $event.id })" />
	<NcCheckboxRadioSwitch
		:modelValue="project.allowOlder"
		:disabled="disabled"
		@update:modelValue="emit('save', { allowOlder: $event })">
		{{ t('deliver', 'Members may comment on older Versions') }}
	</NcCheckboxRadioSwitch>
</template>
