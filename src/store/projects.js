import { defineStore } from 'pinia'
import { getProject, listProjects } from '../api.js'

export const useProjectsStore = defineStore('projects', {
	state: () => ({
		projects: [],
		/** Project id → Project with its Asset tree */
		details: {},
		loaded: false,
	}),
	actions: {
		async fetchAll() {
			this.projects = await listProjects()
			this.loaded = true
		},
		async fetch(id) {
			const project = await getProject(id)
			this.details[id] = project
			return project
		},
	},
})
