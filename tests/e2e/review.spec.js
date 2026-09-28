import { chromium, expect, test } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { CLIP } from './fixtures.js'

const URL = process.env.DELIVER_TEST_URL ?? 'http://localhost:8080'
const ADMIN = process.env.DELIVER_TEST_USER ?? 'admin'
const ADMIN_PASSWORD = process.env.DELIVER_TEST_PASSWORD ?? 'adminadmin123'
/** A user of its own, in English: the tests find buttons by their names, whatever language the admin speaks */
const USER = 'deliver-e2e'
const PASSWORD = 'deliver-e2e-' + randomBytes(12).toString('hex')
/** A second Member, someone to mention */
const MATE = 'deliver-e2e-mate'
const CDP = process.env.DELIVER_CDP ?? 'http://127.0.0.1:9222'
/** The browser may sit in its own container, where localhost is not Nextcloud */
const BROWSER_URL = process.env.DELIVER_BROWSER_URL ?? URL

const auth = { username: USER, password: PASSWORD, send: 'always' }
const ocsHeaders = { 'OCS-APIREQUEST': 'true', Accept: 'application/json' }

test.describe('Review view', () => {
	let browser
	let context
	let page
	let folder
	let versionId
	let projectId

	test.beforeAll(async ({ playwright }) => {
		await testUser(playwright)
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		folder = 'deliver-e2e-' + randomBytes(4).toString('hex')
		const dav = `/remote.php/dav/files/${USER}/${folder}`
		expect((await api.fetch(dav, { method: 'MKCOL' })).status()).toBe(201)
		expect((await api.fetch(`${dav}/clip.webm`, { method: 'PUT', data: readFileSync(CLIP) })).status()).toBe(201)
		const shared = await api.post('/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json', {
			form: { path: `/${folder}`, shareType: 0, shareWith: MATE, permissions: 1 },
		})
		expect(shared.ok()).toBe(true)

		const created = await api.post('/ocs/v2.php/apps/deliver/api/v1/projects?format=json', {
			data: { folderId: await fileId(api, dav), autoIntake: true },
		})
		projectId = (await created.json()).ocs.data.id
		const project = await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)
		versionId = (await project.json()).ocs.data.assets[0].versions[0].id
		await api.dispose()

		browser = await chromium.connectOverCDP(CDP)
		context = await browser.newContext({ baseURL: BROWSER_URL })
		page = await context.newPage()
		await login(page)
	})

	test.afterAll(async ({ playwright }) => {
		await context?.close()
		await browser?.close()
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		await api.delete(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)
		await api.fetch(`/remote.php/dav/files/${USER}/${folder}`, { method: 'DELETE' })
		await api.dispose()
	})

	test('the Project list leads into a Review and back', async () => {
		await page.goto('/apps/deliver/')
		const tile = page.locator('.deliver-project-card', { hasText: folder })
		await expect(tile).toContainText('1 Asset')
		await tile.click()
		await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`))
		await page.locator('.deliver-card__link').first().click()
		await expect(page).toHaveURL(new RegExp(`/versions/${versionId}$`))
		await page.getByRole('link', { name: folder, exact: true }).click()
		await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`))

		// The Project list finds a Project by name, and a right click opens it too
		await page.goto('/apps/deliver/')
		await page.getByRole('searchbox', { name: 'Find a Project' }).fill(folder)
		await expect(page.locator('.deliver-project-card')).toHaveCount(1)
		await tile.click({ button: 'right' })
		await page.getByRole('menuitem', { name: 'Open', exact: true }).click()
		await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`))
	})

	test('uploads into the Project, then filters and finds its Assets', async () => {
		await page.goto(`/apps/deliver/projects/${projectId}`)
		await page.locator('input[type=file][multiple]').setInputFiles({ name: 'second.webm', mimeType: 'video/webm', buffer: readFileSync(CLIP) })
		const second = page.locator('.deliver-card', { hasText: 'second.webm' })
		await expect(second).toBeVisible()
		// Auto Intake would take the file anyway; the upload itself must not fail
		await expect(page.locator('.deliver-project .notecard')).toHaveCount(0)

		await page.getByRole('button', { name: /^Changes requested/ }).click()
		await expect(page).toHaveURL(/filter=changes/)
		await expect(second).toHaveCount(0)
		await page.getByRole('button', { name: /^All/ }).click()

		// The latest activity comes first, until the order is by name
		await expect(page.locator('.deliver-card__name').first()).toHaveText('second')
		await page.getByRole('button', { name: 'Latest activity' }).click()
		await page.getByRole('menuitemradio', { name: 'Name' }).click()
		await expect(page).toHaveURL(/sort=name/)
		await expect(page.locator('.deliver-card__name').first()).toHaveText('clip')

		await page.getByRole('searchbox', { name: 'Find an Asset' }).fill('SECOND')
		await expect(page.locator('.deliver-card')).toHaveCount(1)

		// Dropped files go the same way; anything but media stays out
		await page.getByRole('searchbox', { name: 'Find an Asset' }).fill('')
		await page.evaluate((bytes) => {
			const files = new DataTransfer()
			files.items.add(new File([new Uint8Array(bytes)], 'third.webm', { type: 'video/webm' }))
			files.items.add(new File(['notes'], 'notes.txt', { type: 'text/plain' }))
			const view = document.querySelector('.deliver-project')
			for (const type of ['dragenter', 'dragover', 'drop']) {
				view.dispatchEvent(new DragEvent(type, { dataTransfer: files, bubbles: true, cancelable: true }))
			}
		}, [...readFileSync(CLIP)])
		await expect(page.locator('.deliver-card', { hasText: 'third.webm' })).toBeVisible()
		await expect(page.locator('.deliver-project .notecard')).toContainText('Only video, audio and image files')
		await expect(page.locator('.deliver-card', { hasText: 'notes' })).toHaveCount(0)
	})

	test('comments on a Frame and on a Range, resolves and replies', async () => {
		await page.goto(`/apps/deliver/versions/${versionId}`)
		await expect(page.locator('video.deliver-player__video')).toHaveJSProperty('readyState', 4)

		// Frame stepping is exact: five steps at 25 fps land on 00:00:00:05
		// Focus the page without touching the player
		await page.locator('.deliver-review__title').click()
		for (let i = 0; i < 5; i++) {
			await page.keyboard.press('ArrowRight')
		}
		await expect(page.locator('.deliver-player__timecode')).toContainText('00:00:00:05')

		await page.keyboard.press('c')
		await expect(page.locator('.deliver-comments__anchor')).toHaveText(/00:00:00:05/)
		await page.locator('#deliver-comment-body').fill('sound starts too early')
		await page.locator('.deliver-comments__form button[title="Send (Enter)"]').click()

		const first = page.locator('.deliver-comment').first()
		await expect(first).toContainText('sound starts too early')
		await expect(first.locator('.deliver-comment__time')).not.toBeEmpty()
		await expect(page.locator('.deliver-comment__anchor').first()).toHaveText('00:00:00:05')
		await expect(page.locator('.deliver-player__marker')).toHaveCount(1)

		// A Range, set with I and O
		// Focus the page without touching the player
		await page.locator('.deliver-review__title').click()
		await page.keyboard.press('i')
		for (let i = 0; i < 20; i++) {
			await page.keyboard.press('ArrowRight')
		}
		await page.keyboard.press('o')
		await page.keyboard.press('c')
		await expect(page.locator('.deliver-comments__anchor')).toHaveText(/–/)
		await page.locator('#deliver-comment-body').fill('shorten this passage')
		await page.locator('.deliver-comments__form button[title="Send (Enter)"]').click()
		await expect(page.locator('.deliver-player__marker')).toHaveCount(2)

		// Resolving hides it from the unresolved filter, a Reply stays with its parent
		await page.locator('.deliver-comment').first().getByRole('button', { name: 'Mark as resolved' }).click()
		await expect(page.locator('.deliver-comment').first()).toHaveClass(/deliver-comment--resolved/)
		await page.locator('.deliver-comments__show button').click()
		await page.getByRole('menuitemradio', { name: 'Unresolved' }).click()
		await expect(page.locator('.deliver-comments__list > .deliver-comment')).toHaveCount(1)
		await page.locator('.deliver-comments__show button').click()
		await page.getByRole('menuitemradio', { name: 'All Comments' }).click()
		await expect(page.locator('.deliver-comments__list > .deliver-comment')).toHaveCount(2)

		const target = page.locator('.deliver-comment').filter({ hasText: 'sound starts too early' }).first()
		await target.getByRole('button', { name: 'Reply', exact: true }).click()
		await target.locator('textarea').fill('agreed, from frame 5')
		await target.locator('.deliver-comment__reply-form').getByRole('button', { name: 'Reply' }).click()
		await expect(page.locator('.deliver-comment--reply')).toContainText('agreed, from frame 5')

		// The export carries both Comments as markers, the Reply folded into its parent's note.
		// The browser may run in another container where its downloads are out of reach,
		// so the test fetches the link the menu offers with the page's own session.
		await page.getByRole('button', { name: 'Export' }).click()
		const link = page.getByRole('menuitem', { name: 'EDL for DaVinci Resolve' })
		const response = await page.request.get(await link.getAttribute('href'))
		expect(response.headers()['content-disposition']).toMatch(/\.edl"/)
		const edl = await response.text()
		expect(edl.match(/\|M:/g)).toHaveLength(2)
		expect(edl).toContain(`sound starts too early / ${USER}: agreed, from frame 5`)

		// Typing fixes the Frame: moving the player afterwards does not move the Comment
		await page.keyboard.press('Escape')
		await page.locator('.deliver-comments__list').getByRole('button', { name: '00:00:00:05', exact: true }).click()
		await page.locator('#deliver-comment-body').fill('t')
		await expect(page.locator('.deliver-comments__anchor')).toHaveText(/00:00:00:05/)
		const timeline = page.locator('.deliver-player__timeline')
		const box = await timeline.boundingBox()
		await timeline.click({ position: { x: box.width * 0.8, y: box.height / 2 } })
		await expect(page.locator('.deliver-player__timecode')).not.toContainText('00:00:00:05')
		await expect(page.locator('.deliver-comments__anchor')).toHaveText(/00:00:00:05/)
		await page.locator('#deliver-comment-body').fill('typed while the player moved on')
		await page.locator('.deliver-comments__form button[title="Send (Enter)"]').click()
		await expect(page.locator('.deliver-comment').filter({ hasText: 'typed while the player moved on' }).locator('.deliver-comment__anchor')).toHaveText('00:00:00:05')

		// A reaction shows as a pill with its count, mine highlighted (story 91)
		const reacted = page.locator('.deliver-comment').filter({ hasText: 'shorten this passage' }).first()
		await reacted.getByRole('button', { name: 'React' }).click()
		await page.locator('.emoji-mart input').fill('tooth')
		await page.locator('.emoji-mart .emoji-mart-scroll .emoji-mart-emoji').first().click()
		await expect(reacted.locator('.deliver-comment__reaction--mine')).toHaveText('🦷 1')

		// Typing @ offers the Members; the Comment shows the name (story 90)
		await page.locator('#deliver-comment-body').fill('')
		await page.locator('#deliver-comment-body').pressSequentially('look @Ma')
		await page.getByRole('option', { name: 'Mara Mate' }).click()
		await expect(page.locator('#deliver-comment-body')).toHaveValue(`look @${MATE} `)
		await page.locator('#deliver-comment-body').pressSequentially('here')
		await page.locator('.deliver-comments__form button[title="Send (Enter)"]').click()
		await expect(page.locator('.deliver-comment__mention').first()).toHaveText('@Mara Mate')

		// An attached picture shows under its Comment (story 92)
		const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
		await page.locator('.deliver-comments__actions input[type=file]').setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: pixel })
		await expect(page.locator('.deliver-comments__files li')).toHaveText('reference.png')
		await page.locator('#deliver-comment-body').fill('like this')
		await page.locator('.deliver-comments__form button[title="Send (Enter)"]').click()
		const picture = page.locator('.deliver-comment').filter({ hasText: 'like this' }).locator('.deliver-comment__attachments img')
		await expect(picture).toHaveJSProperty('naturalWidth', 1)

		// A drawing goes with the Comment and shows while the player stands on it (story 89)
		await page.getByRole('button', { name: 'Draw on the picture' }).click()
		const stage = await page.locator('.deliver-player__stage').boundingBox()
		await page.mouse.move(stage.x + stage.width * 0.3, stage.y + stage.height * 0.3)
		await page.mouse.down()
		await page.mouse.move(stage.x + stage.width * 0.6, stage.y + stage.height * 0.5, { steps: 8 })
		await page.mouse.up()
		await expect(page.locator('.deliver-comments__drawn')).toHaveText('1 shape drawn')
		await page.locator('#deliver-comment-body').fill('this corner')
		await page.locator('.deliver-comments__form button[title="Send (Enter)"]').click()
		await expect(page.locator('.deliver-comment').filter({ hasText: 'this corner' })).toBeVisible()
		await expect(page.locator('.deliver-drawing path')).toHaveCount(1)

		// A Due Date set in the header shows there (story 93)
		await page.locator('.deliver-due__input').fill('2030-01-31')
		await expect(page.locator('.deliver-due')).toContainText('Due')
		await expect(page.locator('.deliver-due__clear')).toBeVisible()

		// Approving shows the decision next to the menu (story 88)
		await page.locator('.deliver-approval__menu button').click()
		await page.getByRole('menuitemradio', { name: 'Approve this Version' }).click()
		await expect(page.locator('.deliver-approval__people li')).toHaveCount(1)
		await expect(page.locator('.deliver-approval__menu button')).toContainText('Approved')
	})

	test('compares two Versions in step', async ({ playwright }) => {
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		expect((await api.fetch(`/remote.php/dav/files/${USER}/${folder}/clip_v2.webm`, { method: 'PUT', data: readFileSync(CLIP) })).status()).toBe(201)
		const project = await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)).json()
		await api.dispose()
		const stack = project.ocs.data.assets[0].versions
		expect(stack).toHaveLength(2)

		await page.goto(`/apps/deliver/compare/${stack[1].id}/${stack[0].id}`)
		const videos = page.locator('.deliver-compare video')
		await expect(videos).toHaveCount(2)
		await expect(videos.first()).toHaveJSProperty('readyState', 4)
		await page.locator('.deliver-layout__bar h2').click()
		await page.keyboard.press('ArrowRight')
		await page.keyboard.press('ArrowRight')
		await expect(page.locator('.deliver-compare__timecode')).toContainText('00:00:00:02')
		// B follows A to the same Frame
		const times = await videos.evaluateAll((all) => all.map((video) => video.currentTime))
		expect(times[1]).toBeCloseTo(times[0], 3)

		await page.getByRole('radio', { name: 'Wipe' }).click()
		await expect(page.locator('.deliver-compare__handle')).toBeVisible()
	})

	test('a Reviewer names themselves and comments through a Share Link', async ({ playwright }) => {
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		const folderId = await fileId(api, `/remote.php/dav/files/${USER}/${folder}`)
		const link = (await (await api.post(`/ocs/v2.php/apps/deliver/api/v1/files/${folderId}/shares?format=json`)).json()).ocs.data
		// Only the newest Version takes Comments on this link
		const project = await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)).json()
		const newest = project.ocs.data.assets[0].versions[0].id
		await api.dispose()

		// A browser that has never been here
		const visitor = await browser.newContext({ baseURL: BROWSER_URL })
		const reviewer = await visitor.newPage()
		await reviewer.goto(`/apps/deliver/s/${link.token}/versions/${newest}`)
		// The name comes first, over the Comments; with an address come the mail wishes
		await expect(reviewer.locator('.deliver-comments__gate')).toBeVisible()
		await reviewer.locator('#deliver-reviewer-name').fill('Mara')
		await reviewer.locator('.deliver-comments__claim input[type=email]').fill('mara@example.test')
		await reviewer.getByText('New Versions').click()
		await reviewer.getByRole('button', { name: 'Start reviewing' }).click()
		await expect(reviewer.locator('.deliver-comments__gate')).toHaveCount(0)
		await reviewer.getByRole('button', { name: 'Mail settings' }).click()
		await expect(reviewer.getByRole('checkbox', { name: 'New Versions' })).toBeChecked()
		await reviewer.keyboard.press('Escape')
		await reviewer.locator('#deliver-comment-body').fill('from the client')
		await reviewer.locator('.deliver-comments__form button[title="Send (Enter)"]').click()
		await expect(reviewer.locator('.deliver-comment').filter({ hasText: 'from the client' })).toContainText('Mara')
		await visitor.close()
	})
})

/**
 * Creates the test user, or sets a fresh password on it, and keeps it in English
 *
 * @param {import('@playwright/test').PlaywrightWorkerArgs['playwright']} playwright - to talk to the API as admin
 */
async function testUser(playwright) {
	const admin = await playwright.request.newContext({
		baseURL: URL,
		httpCredentials: { username: ADMIN, password: ADMIN_PASSWORD, send: 'always' },
		extraHTTPHeaders: ocsHeaders,
	})
	const users = '/ocs/v2.php/cloud/users'
	const created = await admin.post(`${users}?format=json`, { form: { userid: USER, password: PASSWORD } })
	if (!created.ok()) {
		expect((await admin.put(`${users}/${USER}?format=json`, { form: { key: 'password', value: PASSWORD } })).ok()).toBe(true)
	}
	expect((await admin.put(`${users}/${USER}?format=json`, { form: { key: 'language', value: 'en' } })).ok()).toBe(true)
	// The mate never logs in; a random password it is
	await admin.post(`${users}?format=json`, { form: { userid: MATE, password: 'mate-' + randomBytes(12).toString('hex'), displayName: 'Mara Mate' } })
	await admin.dispose()
}

/**
 * @param {import('@playwright/test').APIRequestContext} api - request context
 * @param {string} dav - WebDAV path of the folder
 * @return {Promise<number>} the Nextcloud file id
 */
async function fileId(api, dav) {
	const response = await api.fetch(dav, {
		method: 'PROPFIND',
		headers: { Depth: '0', 'Content-Type': 'application/xml' },
		data: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:fileid/></d:prop></d:propfind>',
	})
	return Number(/<oc:fileid>(\d+)<\/oc:fileid>/.exec(await response.text())[1])
}

/**
 * @param {import('@playwright/test').Page} page - the page to log in
 */
async function login(page) {
	await page.goto('/index.php/login')
	await page.locator('#user').fill(USER)
	await page.locator('#password').fill(PASSWORD)
	await page.getByRole('button', { name: 'Log in', exact: true }).click()
	await page.waitForURL(/apps|dashboard/)
}
