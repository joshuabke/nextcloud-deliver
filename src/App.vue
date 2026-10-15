<script setup>
import NcAppContent from '@nextcloud/vue/components/NcAppContent'
import NcContent from '@nextcloud/vue/components/NcContent'
import UploadsPanel from './components/UploadsPanel.vue'
</script>

<template>
	<NcContent appName="deliver">
		<RouterView name="navigation" />
		<NcAppContent>
			<RouterView />
		</NcAppContent>
		<UploadsPanel />
	</NcContent>
</template>
