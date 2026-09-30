<script setup>
import NcAppContent from '@nextcloud/vue/components/NcAppContent'
import NcContent from '@nextcloud/vue/components/NcContent'
</script>

<template>
	<NcContent appName="deliver">
		<RouterView name="navigation" />
		<NcAppContent>
			<RouterView />
		</NcAppContent>
	</NcContent>
</template>
