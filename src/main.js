import { generateUrl } from '@nextcloud/router'
import { createPinia } from 'pinia'
import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import CompareView from './views/CompareView.vue'
import ProjectListView from './views/ProjectListView.vue'
import ProjectView from './views/ProjectView.vue'
import ReviewView from './views/ReviewView.vue'

const router = createRouter({
	history: createWebHistory(generateUrl('/apps/deliver')),
	routes: [
		{ path: '/', component: ProjectListView },
		{ path: '/projects/:id', component: ProjectView, props: (route) => ({ id: Number(route.params.id) }) },
		{ path: '/compare/:a/:b', component: CompareView, props: (route) => ({ a: Number(route.params.a), b: Number(route.params.b) }) },
		{ path: '/versions/:id', component: ReviewView, props: (route) => ({ id: Number(route.params.id) }) },
	],
})

createApp(App)
	.use(createPinia())
	.use(router)
	.mount('#deliver')
