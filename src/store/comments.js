import { defineStore } from 'pinia'
import {
	commentChanges,
	createComment,
	decideVersion,
	deleteComment,
	listComments,
	markSeen,
	resolveComment,
	updateComment,
} from '../api.js'
import { mergeComments } from '../lib/merge.js'

/** How often the Review view asks for changes, in ms; a hidden tab asks less often */
export const POLL_INTERVAL = 5000
export const POLL_INTERVAL_HIDDEN = 30000

export const useCommentsStore = defineStore('comments', {
	state: () => ({
		versionId: null,
		comments: [],
		canWrite: false,
		/** Null until the first answer; false where the person may only read */
		canComment: null,
		/** Me, in the shape of a Comment's author */
		me: null,
		/**
		 * Comments written after this are Unseen. The server's mark moves on as
		 * soon as Comments are on screen; this one only when the view opens or
		 * the person clears the badges, so a badge does not vanish while it is read.
		 */
		seenUntil: 0,
		/** Who approved or requested changes: [{ author, status, updatedAt }] */
		approvals: [],
		/**
		 * Server time of the last answer, and the `since` of the next poll.
		 * Inclusive, because timestamps count whole seconds: "newer than"
		 * would miss a Comment written in the same second.
		 */
		now: 0,
		timer: null,
	}),
	getters: {
		/**
		 * @param {object} state - the store state
		 * @return {Array<object>} top-level Comments, each with its Replies
		 */
		threads: (state) => state.comments
			.filter((comment) => comment.parentId === null)
			.map((comment) => ({
				...comment,
				replies: state.comments.filter((reply) => reply.parentId === comment.id),
			})),
		mine: (state) => (comment) => state.me !== null
			&& comment.author.type === state.me.type
			&& comment.author.id === state.me.id,
		/**
		 * @param {object} state - the store state
		 * @return {number} how many Comments by others are Unseen
		 */
		myDecision(state) {
			return state.approvals.find((approval) => this.mine(approval))?.status ?? null
		},
		unseenCount(state) {
			return state.comments.filter((comment) => comment.createdAt > state.seenUntil && !this.mine(comment)).length
		},
	},
	actions: {
		async open(versionId) {
			this.stop()
			this.versionId = versionId
			this.comments = []
			this.approvals = []
			await this.reload()
			if (this.versionId !== versionId) {
				// Another Version was opened while this one loaded
				return
			}
			this.retime()
			document.addEventListener('visibilitychange', this.retime)
		},
		stop() {
			clearInterval(this.timer)
			this.timer = null
			document.removeEventListener('visibilitychange', this.retime)
		},
		/** A hidden tab polls less often (spec: API) */
		retime() {
			clearInterval(this.timer)
			this.timer = setInterval(() => this.poll(), document.hidden ? POLL_INTERVAL_HIDDEN : POLL_INTERVAL)
		},
		async reload() {
			const versionId = this.versionId
			const answer = await listComments(versionId)
			if (this.versionId !== versionId) {
				return
			}
			this.comments = mergeComments([], answer.comments, null)
			this.canWrite = answer.canWrite
			this.canComment = answer.canComment
			this.me = answer.me
			this.seenUntil = answer.seenUntil
			this.approvals = answer.approvals ?? []
			this.now = answer.now
			this.onScreen()
		},
		async poll() {
			const versionId = this.versionId
			try {
				const answer = await commentChanges(versionId, this.now)
				if (this.versionId !== versionId) {
					return
				}
				this.comments = mergeComments(this.comments, answer.comments, answer.ids)
				this.approvals = answer.approvals ?? this.approvals
				this.now = answer.now
				this.onScreen()
			} catch {
				// Offline for a moment: the next poll asks for the same span again
			}
		},
		/** Whatever a visible tab shows counts as seen on the server (story 36) */
		onScreen() {
			if (!document.hidden && this.me?.type !== 'unnamed') {
				markSeen(this.versionId, this.now).catch(() => {})
			}
		},
		async add({ inFrame, outFrame = null, body, parentId = null }) {
			const comment = await createComment(this.versionId, { inFrame, outFrame, body, parentId })
			this.comments = mergeComments(this.comments, [comment], null)
			return comment
		},
		async edit(id, body) {
			this.comments = mergeComments(this.comments, [await updateComment(id, body)], null)
		},
		async remove(id) {
			await deleteComment(id)
			const gone = new Set([id, ...this.comments.filter((comment) => comment.parentId === id).map((comment) => comment.id)])
			this.comments = this.comments.filter((comment) => !gone.has(comment.id))
		},
		async setResolved(id, resolved) {
			this.comments = mergeComments(this.comments, [await resolveComment(id, resolved)], null)
		},
		/**
		 * @param {string|null} status - approved, changes, or null to take my decision back
		 */
		async decide(status) {
			this.approvals = await decideVersion(this.versionId, status)
		},
		/** Clears the Unseen badges on screen */
		clearUnseen() {
			this.seenUntil = this.now
		},
	},
})
