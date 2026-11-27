import { chromium, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { DOUBLE_TAP_MS } from '../../src/lib/gestures.js'
import { CLIP, CLIP_SCRUB, CUT_A, CUT_B, DNXHR, HAND_PROXY, LONG, LONG_MIX, MIX, MIX_A, MIX_B } from './fixtures.js'

const URL = process.env.DELIVER_TEST_URL ?? 'http://localhost:8080'
const ADMIN = process.env.DELIVER_TEST_USER ?? 'admin'
const ADMIN_PASSWORD = process.env.DELIVER_TEST_PASSWORD ?? 'adminadmin123'
/** A user of its own, in English: the tests find buttons by their names, whatever language the admin speaks */
const USER = 'deliver-e2e'
const PASSWORD = 'deliver-e2e-' + randomBytes(12).toString('hex')
/** A second Member, someone to mention */
const MATE = 'deliver-e2e-mate'
const MATE_PASSWORD = 'mate-' + randomBytes(12).toString('hex')
const CDP = process.env.DELIVER_CDP ?? 'http://127.0.0.1:9222'
/** The browser may sit in its own container, where localhost is not Nextcloud */
const BROWSER_URL = process.env.DELIVER_BROWSER_URL ?? URL

const auth = { username: USER, password: PASSWORD, send: 'always' }
/** An iPhone as Nextcloud accepts it: a current Safari, touch, and its size */
const PHONE = {
	viewport: { width: 390, height: 844 },
	deviceScaleFactor: 3,
	isMobile: true,
	hasTouch: true,
	userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1',
}
/** A phone whose zoom Nextcloud leaves free */
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36'
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
			form: { path: `/${folder}`, shareType: 0, shareWith: MATE, permissions: 17 },
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
		// A click ticks the card, a double click opens it (story 141)
		const link = page.locator('.deliver-card__link').first()
		await link.click()
		await expect(page.locator('.deliver-card').first()).toHaveClass(/deliver-card--selected/)
		await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`))
		await link.dblclick()
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

	test('a Project opens as a list, a card keeps its actions as a row, and the cards are remembered for the Project', async () => {
		await page.goto(`/apps/deliver/projects/${projectId}`)
		const layout = page.getByRole('button', { name: 'Show the Assets as a list' })
		// Rows until someone picks the cards
		await expect(page.locator('.deliver-card').first()).toHaveClass(/deliver-card--row/)
		await expect(layout).toHaveAttribute('aria-pressed', 'true')
		await expect(page.locator('.deliver-card__facts').first()).toContainText('V1')
		// The menu is still there, as a row
		await page.getByRole('button', { name: /^Actions for / }).first().click()
		await expect(page.getByRole('menuitem', { name: 'Rename…' })).toBeVisible()
		await page.keyboard.press('Escape')
		await layout.click()
		await expect(page.locator('.deliver-card')).not.toHaveClass(/deliver-card--row/)
		await page.reload()
		await expect(page.locator('.deliver-card')).not.toHaveClass(/deliver-card--row/)
		await expect(layout).toHaveAttribute('aria-pressed', 'false')
		// Picked again, the list is remembered as well
		await layout.click()
		await page.reload()
		await expect(page.locator('.deliver-card').first()).toHaveClass(/deliver-card--row/)
	})

	test('uploads into the Project, then filters and finds its Assets', async () => {
		// Cards, for the badges only a card shows
		await page.evaluate((key) => localStorage.setItem(key, 'grid'), `deliver.layout.project-${projectId}`)
		await page.goto(`/apps/deliver/projects/${projectId}`)
		// The upload button opens the Uploads dialog (story 133)
		await page.getByRole('button', { name: 'Upload', exact: true }).click()
		const uploads = page.getByRole('dialog', { name: 'Uploads' })
		await uploads.locator('input[type=file][multiple]').setInputFiles({ name: 'second.webm', mimeType: 'video/webm', buffer: readFileSync(CLIP) })
		// Auto Intake would take the file anyway; the upload itself must not fail
		await expect(uploads.getByText('Open', { exact: true })).toBeVisible()
		await expect(uploads.locator('.deliver-uploads__status--error')).toHaveCount(0)
		await page.keyboard.press('Escape')
		const second = card(page, 'second')
		await expect(second).toBeVisible()

		await page.getByRole('button', { name: /^Changes requested/ }).click()
		await expect(page).toHaveURL(/filter=changes/)
		await expect(second).toHaveCount(0)
		await page.getByRole('button', { name: /^All/ }).click()

		// Whoever uploads delivers: the card names them, and the filter finds what they delivered
		await expect(second.locator('.deliver-card__meta')).toContainText(/^deliver-e2e · /)
		await page.getByRole('button', { name: /^Delivered by me/ }).click()
		await expect(page).toHaveURL(/filter=mine/)
		await expect(second).toBeVisible()
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
		await expect(card(page, 'third')).toBeVisible()
		await expect(page.locator('.deliver-card', { hasText: 'notes' })).toHaveCount(0)
		// They go with the card in the corner, which opens the dialog again (story 134)
		await page.locator('.deliver-uploads-card__open').click()
		await expect(uploads).toContainText('Only video, audio and image files')
		await page.keyboard.press('Escape')

		// A Version Stack is managed from its card, not in the Review view
		await second.click({ button: 'right' })
		await page.getByRole('menuitem', { name: 'Manage Versions' }).click()
		await expect(page.getByRole('dialog', { name: 'Versions of second' })).toContainText('Version 1')
		await page.keyboard.press('Escape')

		// So is its Due Date, through a visible field: Safari opens no picker for a hidden one
		await second.click({ button: 'right' })
		await page.getByRole('menuitem', { name: 'Set a Due Date' }).click()
		const due = page.getByRole('dialog', { name: 'Due Date' })
		await due.getByLabel('Due Date').fill('2030-01-15')
		await due.getByRole('button', { name: 'Save' }).click()
		await expect(second.locator('.deliver-card__due')).toContainText('15')
		await second.click({ button: 'right' })
		await expect(page.getByRole('menuitem', { name: 'Change the Due Date' })).toBeVisible()
		await page.keyboard.press('Escape')

		// Ticked, two cards share one menu with what applies to both (story 141)
		const third = card(page, 'third')
		await second.getByRole('checkbox', { name: 'Select second' }).check()
		await third.getByRole('checkbox', { name: 'Select third' }).check()
		await third.click({ button: 'right' })
		await expect(page.getByRole('menu', { name: '2 Assets selected' })).toBeVisible()
		await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible()
		await expect(page.getByRole('menuitem', { name: 'Open' })).toHaveCount(0)
		await page.getByRole('menuitem', { name: 'Clear the selection' }).click()
		await expect(second.getByRole('checkbox', { name: 'Select second' })).not.toBeChecked()
		// A shift-click ticks every card from the one clicked last
		const cards = page.locator('.deliver-card__select')
		await cards.first().check()
		await cards.last().click({ modifiers: ['Shift'] })
		await expect(page.locator('.deliver-card__select:checked')).toHaveCount(await cards.count())
		await page.getByRole('checkbox', { name: 'Clear the selection' }).uncheck()

		// The checkbox at the start of the filter row ticks every card, and clears them again
		await page.getByRole('checkbox', { name: 'Select all' }).check()
		await expect(third.getByRole('checkbox', { name: 'Select third' })).toBeChecked()
		await page.getByRole('checkbox', { name: 'Clear the selection' }).uncheck()
		await expect(third.getByRole('checkbox', { name: 'Select third' })).not.toBeChecked()
	})

	test('renames, removes and stacks from the menus of the cards', async () => {
		// Cards, for the badges only a card shows
		await page.evaluate((key) => localStorage.setItem(key, 'grid'), `deliver.layout.project-${projectId}`)
		await page.goto(`/apps/deliver/projects/${projectId}`)
		// The menu has a button on every screen, beside the name
		const second = card(page, 'second')
		await second.getByRole('button', { name: 'Actions for second' }).click()
		await expect(page.getByRole('menuitem', { name: 'Download' })).toHaveAttribute('href', /\/second\.webm$/)
		await page.getByRole('menuitem', { name: 'Rename…' }).click()
		const rename = page.getByRole('dialog', { name: 'Rename file' })
		await expect(rename).toContainText('actively being worked on')
		// Nextcloud reads the type from the extension, so it stays
		await rename.getByLabel('Name').fill('renamed.mov')
		await expect(rename.getByRole('button', { name: 'Rename' })).toBeDisabled()
		// A name with & and ' shows as it is, in labels too (#93)
		await rename.getByLabel('Name').fill('Smith & O\'Neil.webm')
		await rename.getByRole('button', { name: 'Rename' }).click()
		const renamed = card(page, 'Smith & O\'Neil')
		await expect(renamed.getByRole('button', { name: 'Actions for Smith & O\'Neil', exact: true })).toBeVisible()

		// Removed from a Folder Project with Auto Intake, a file waits as not up for review (#45)
		await card(page, 'third').click({ button: 'right' })
		await page.getByRole('menuitem', { name: 'Remove from Project' }).click()
		await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click()
		const third = page.locator('.deliver-not-up', { hasText: 'third.webm' })
		await expect(third).toBeVisible()
		await page.reload()
		await expect(third).toBeVisible()

		// and joins an Asset from its own menu
		await third.getByRole('button', { name: 'Actions for third.webm' }).click()
		await page.getByRole('menuitem', { name: 'Add as a new Version of…' }).click()
		const stacking = page.getByRole('dialog', { name: 'Add third.webm as a new Version' })
		await stacking.locator('.v-select').click()
		await page.getByRole('option', { name: 'Smith & O\'Neil' }).click()
		await stacking.getByRole('button', { name: 'Add', exact: true }).click()
		// The Asset is named after its newest Version's file
		await expect(card(page, 'third').locator('.deliver-card__version')).toHaveText('V2')
		await expect(renamed).toHaveCount(0)
		await expect(third).toHaveCount(0)
	})

	test('comments on a Frame and on a Range, resolves and replies', async () => {
		await page.goto(`/apps/deliver/versions/${versionId}`)
		await expect(page.locator('video.deliver-player__video')).toHaveJSProperty('readyState', 4)

		// Frame stepping is exact: five steps at 25 fps land on 00:00:00:05; C brings hidden Comments back
		await page.getByRole('button', { name: 'Hide Comments' }).click()
		await expect(page.locator('.deliver-player__circle')).toHaveCount(0)
		const height = (await page.locator('.deliver-player__stage').boundingBox()).height
		// Focus the page without touching the player
		await page.locator('.deliver-review__title').click()
		for (let i = 0; i < 5; i++) {
			await page.keyboard.press('ArrowRight')
		}
		await expect(page.locator('.deliver-player__timecode')).toContainText('00:00:00:05')

		await page.keyboard.press('c')
		await expect(page.locator('#deliver-comment-body')).toBeFocused()
		await expect(page.locator('.deliver-comments__anchor')).toHaveText(/00:00:00:05/)
		await page.locator('#deliver-comment-body').fill('sound starts too early')
		await page.locator('.deliver-comments__form button[title="Send (Enter)"]').click()

		const first = page.locator('.deliver-comment').first()
		await expect(first).toContainText('sound starts too early')
		// No row of its own: the Comment takes nothing from the picture
		await expect(page.locator('.deliver-player__circle')).toBeVisible()
		expect((await page.locator('.deliver-player__stage').boundingBox()).height).toBe(height)
		await expect(first.locator('.deliver-comment__time')).not.toBeEmpty()
		await expect(page.locator('.deliver-comment__anchor').first()).toHaveText('00:00:00:05')
		// Its author's initials, on the bar, which lies between the picture and the buttons with nothing beside it
		await expect(page.locator('.deliver-player__circle')).toHaveText('D')
		const [circle, under, above, buttons] = await Promise.all(['circle', 'timeline', 'stage', 'controls'].map((each) => page.locator(`.deliver-player__${each}`).boundingBox()))
		expect(circle.y + circle.height / 2).toBeCloseTo(under.y + under.height / 2, 0)
		expect(circle.x + circle.width / 2).toBeCloseTo(under.x + under.width * 5 / 100, 0)
		expect(under.y).toBeCloseTo(above.y + above.height, 0)
		expect(buttons.y).toBeCloseTo(under.y + under.height, 0)
		expect(circle.y).toBeGreaterThanOrEqual(above.y + above.height - 2)
		expect(circle.y + circle.height).toBeLessThanOrEqual((await page.getByRole('button', { name: 'Play (Space)' }).boundingBox()).y)

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
		// Both start on the same Frame: one circle with their count
		await expect(page.locator('.deliver-player__circle')).toHaveText('2')

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
		// React waits for the pointer, as on Frame.io
		await page.mouse.move(0, 0)
		await expect(reacted.locator('.deliver-comment__react-at').first()).toBeHidden()
		await reacted.hover()
		await reacted.getByRole('button', { name: 'React' }).first().click()
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
		await page.locator('.deliver-comments__form input[type=file]').setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: pixel })
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
		await page.locator('.deliver-due__button').click()
		const due = page.getByRole('dialog', { name: 'Due Date' })
		await due.getByLabel('Due Date').fill('2030-01-31')
		await due.getByRole('button', { name: 'Save' }).click()
		await expect(page.locator('.deliver-due')).toContainText('Due')
		await expect(page.locator('.deliver-due__clear')).toBeVisible()
		// It lights up under the pointer, as other buttons do
		await page.locator('.deliver-due__button').hover()
		await expect(page.locator('.deliver-due__button')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

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

		// On a phone half the height of the sheet leaves Compare's controls, taller than the player's one row, their room
		const phone = await browser.newContext({ baseURL: BROWSER_URL, ...PHONE })
		const touchPage = await phone.newPage()
		await login(touchPage)
		await touchPage.goto(`/apps/deliver/compare/${stack[1].id}/${stack[0].id}`)
		await touchPage.locator('.deliver-layout__grabber').tap()
		await expect(touchPage.locator('.deliver-layout--middle')).toHaveCount(1)
		expect((await touchPage.locator('.deliver-layout__main').boundingBox()).height).toBeCloseTo(390 * 9 / 16 + 136.5, 0)
		await phone.close()
	})

	test('on a phone at half height the layout keeps its height through a step to the next Asset, loading or still', async ({ playwright }) => {
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		const dav = `/remote.php/dav/files/${USER}/${folder}`
		const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
		expect((await api.fetch(`${dav}/clip2.webm`, { method: 'PUT', data: readFileSync(CLIP) })).status()).toBe(201)
		expect((await api.fetch(`${dav}/clip3.png`, { method: 'PUT', data: pixel })).status()).toBe(201)
		const project = await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)).json()
		await api.dispose()
		const first = project.ocs.data.assets.find((asset) => asset.name === 'clip').versions[0].id

		const phone = await browser.newContext({ baseURL: BROWSER_URL, ...PHONE })
		const touchPage = await phone.newPage()
		await login(touchPage)
		// Each Asset's own load is held back, so that the stage stands empty for a while
		await touchPage.route(/\/versions\/\d+(\?|$)/, async (route) => {
			if (route.request().method() === 'GET' && route.request().resourceType() !== 'document') {
				await new Promise((resolve) => setTimeout(resolve, 1500))
			}
			await route.fallback()
		})
		await touchPage.goto(`/apps/deliver/versions/${first}`)
		await touchPage.locator('.deliver-layout__grabber').tap()
		await expect(touchPage.locator('.deliver-layout--middle')).toHaveCount(1)
		await expect(touchPage.locator('.deliver-player, .deliver-still')).toHaveCount(1)
		const main = touchPage.locator('.deliver-layout__main')
		const height = (await main.boundingBox()).height
		// Sampled in the page, every frame, while the next Assets load and show
		await touchPage.evaluate(() => {
			window.deliverHeights = new Set()
			const watch = () => {
				window.deliverHeights.add(Math.round(document.querySelector('.deliver-layout__main').getBoundingClientRect().height * 10))
				requestAnimationFrame(watch)
			}
			watch()
		})
		const next = async () => {
			await touchPage.getByRole('button', { name: 'More' }).tap()
			await touchPage.getByRole('menuitem', { name: 'Next Asset' }).tap()
		}
		await next()
		await expect(touchPage.locator('.deliver-player, .deliver-still')).toHaveCount(0)
		await expect(touchPage.locator('.deliver-player, .deliver-still')).toHaveCount(1)
		await next()
		await expect(touchPage.locator('.deliver-player, .deliver-still')).toHaveCount(0)
		await expect(touchPage.locator('.deliver-still')).toHaveCount(1)
		const heights = await touchPage.evaluate(() => [...window.deliverHeights])
		expect(heights).toEqual([Math.round(height * 10)])
		await phone.close()

		const cleanup = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		const left = await (await cleanup.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)).json()
		for (const name of ['clip2', 'clip3']) {
			const { id } = left.ocs.data.assets.find((asset) => asset.name === name)
			expect((await cleanup.delete(`/ocs/v2.php/apps/deliver/api/v1/assets/${id}/files?format=json`)).ok()).toBe(true)
		}
		await cleanup.dispose()
	})

	test('on a phone: stacked, by touch, and a Reviewer comments on a Range', async ({ playwright }) => {
		const phone = await browser.newContext({ baseURL: BROWSER_URL, ...PHONE })
		const page = await phone.newPage()
		await login(page)
		await page.goto(`/apps/deliver/projects/${projectId}`)
		// A card's menu has a button of its own on a phone, with the Due Date in it
		const clip = page.locator('.deliver-card', { hasText: 'clip' })
		await clip.locator('.deliver-card__more').tap()
		await page.getByRole('menuitem', { name: /Due Date/ }).tap()
		const due = page.getByRole('dialog', { name: 'Due Date' })
		await due.getByLabel('Due Date').fill('2030-02-20')
		await due.getByRole('button', { name: 'Save' }).tap()
		await expect(clip.locator('.deliver-due')).toContainText('20')

		await page.locator('.deliver-card__more').first().tap()
		await page.getByRole('menuitem', { name: 'Open', exact: true }).tap()
		await expect(page).toHaveURL(/\/versions\/\d+$/)
		const video = page.locator('video.deliver-player__video')
		await expect(video).toHaveJSProperty('readyState', 4)

		// Upright, only the field sits under the picture, without Nextcloud's header; the list pulls up in its place
		await expect(page.locator('#header')).toBeHidden()
		const stage = await page.locator('.deliver-player__stage').boundingBox()
		const panel = await page.locator('.deliver-layout__panel').boundingBox()
		expect(panel.y).toBeGreaterThanOrEqual(stage.y + stage.height)
		await expect(page.locator('.deliver-comments__head')).toBeHidden()
		// Halfway a 16:9 picture fits above the list, then the list takes its place
		const grabber = page.locator('.deliver-layout__grabber')
		await grabber.tap()
		await expect(page.locator('.deliver-layout--middle')).toHaveCount(1)
		await expect(page.locator('.deliver-comments__head')).toBeVisible()
		for (const width of [360, 393, 430, 440, 460, 390]) {
			await page.setViewportSize({ width, height: PHONE.viewport.height })
			await expect.poll(async () => (await page.locator('.deliver-player__stage').boundingBox()).height).toBeCloseTo(width * 9 / 16, 1)
		}
		await grabber.tap()
		await expect(page.locator('.deliver-layout--up')).toHaveCount(1)
		// A stroke down goes back a level at a time
		for (const level of ['middle', 'down']) {
			const box = await grabber.boundingBox()
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
			await page.mouse.down()
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 80)
			await page.mouse.up()
			await expect(page.locator(`.deliver-layout--${level}`)).toHaveCount(1)
		}

		// The controls are one row: Play and the time with the length on the left, the rest on the right
		const row = await page.locator('.deliver-player__controls').boundingBox()
		for (const control of [page.getByRole('button', { name: 'Play', exact: true }), page.locator('.deliver-player__time'), page.getByRole('button', { name: 'Fullscreen', exact: true })]) {
			const box = await control.boundingBox()
			expect(box.y + box.height).toBeLessThanOrEqual(row.y + row.height)
		}
		expect(row.height).toBeLessThan(50)
		await expect(page.locator('.deliver-player__time')).toHaveText('00:00:00:00 / 00:00:04:00')

		// A tap on the timeline seeks and leaves no thumbnail behind
		await page.locator('.deliver-player__timeline').tap()
		await page.waitForTimeout(300)
		await expect(page.locator('.deliver-player__hover')).toBeHidden()

		// A double tap on the right jumps ahead, a tap goes fullscreen
		const right = { x: stage.x + stage.width * 0.85, y: stage.y + stage.height / 2 }
		await page.touchscreen.tap(right.x, right.y)
		await page.touchscreen.tap(right.x, right.y)
		await expect(page.locator('.deliver-player__flash')).toContainText('+10')
		await page.waitForTimeout(700)
		// A tap beside the open menu only closes it, and the first of two makes no double tap
		const settings = page.getByRole('button', { name: 'Playback settings' })
		const tapBesideMenu = async (fullscreen) => {
			await settings.tap()
			await expect(page.getByRole('menuitem', { name: 'One Frame back' })).toBeVisible()
			await page.touchscreen.tap(10, right.y)
			await expect(page.getByRole('menuitem', { name: 'One Frame back' })).toBeHidden()
			await page.waitForTimeout(700)
			await expect(page.locator('.deliver-player--fullscreen')).toHaveCount(fullscreen)
		}
		await tapBesideMenu(0)
		await settings.tap()
		await expect(page.getByRole('menuitem', { name: 'One Frame back' })).toBeVisible()
		const standing = await page.locator('.deliver-player__time').textContent()
		await page.touchscreen.tap(10, right.y)
		await page.touchscreen.tap(10, right.y)
		// The second is a tap of its own
		await expect(page.locator('.deliver-player--fullscreen')).toHaveCount(1)
		await expect(page.locator('.deliver-player__time')).toHaveText(standing)
		// The menu shows in the browser's own fullscreen too
		expect(await page.evaluate(() => document.fullscreenElement !== null)).toBe(true)
		await tapBesideMenu(1)
		await settings.tap()
		const before = await page.locator('.deliver-player__time').textContent()
		await page.getByRole('menuitem', { name: 'One Frame back' }).tap()
		await expect(page.locator('.deliver-player__time')).not.toHaveText(before)
		await settings.tap()
		await expect(page.getByRole('menuitem', { name: 'One Frame back' })).toBeHidden()
		await page.waitForTimeout(700)
		await page.touchscreen.tap(stage.x + stage.width / 2, right.y)
		await expect(page.locator('.deliver-player--fullscreen')).toHaveCount(0)
		// Nor does it leave fullscreen where the player fills the window
		await page.evaluate(() => Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false }))
		await page.getByRole('button', { name: 'Fullscreen', exact: true }).tap()
		await expect(page.locator('.deliver-player--filling')).toHaveCount(1)
		await tapBesideMenu(1)
		await page.getByRole('button', { name: 'Leave fullscreen' }).tap()
		await expect(page.locator('.deliver-player--fullscreen')).toHaveCount(0)

		// Sideways, the picture fills the window under a slim bar and the list opens beside it
		await page.setViewportSize({ width: PHONE.viewport.height, height: PHONE.viewport.width })
		await expect(page.locator('.deliver-layout__bar')).toBeVisible()
		await expect(page.locator('.deliver-layout__panel')).toBeHidden()
		await page.getByRole('button', { name: 'Show Comments' }).tap()
		await expect(page.locator('.deliver-comments__head')).toBeVisible()
		await phone.close()

		// A Reviewer on a phone: name first, then a Range by its button
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		const link = (await (await api.post(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}/links?format=json`)).json()).ocs.data
		// Only the newest Version takes Comments on this link
		const project = await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)).json()
		const newest = project.ocs.data.assets.find((asset) => asset.versions.some((version) => version.id === versionId)).versions[0].id
		await api.dispose()
		const guest = await browser.newContext({ baseURL: BROWSER_URL, ...PHONE })
		const reviewer = await guest.newPage()
		await reviewer.goto(`/apps/deliver/s/${link.token}/versions/${newest}`)
		await reviewer.locator('#deliver-reviewer-name').fill('Pia')
		await reviewer.getByRole('button', { name: 'Start reviewing' }).tap()
		await expect(reviewer.locator('.deliver-comments__gate')).toHaveCount(0)
		// The composer's tools sit in its menu
		const options = reviewer.getByRole('button', { name: 'Comment options' })
		await options.tap()
		await reviewer.getByRole('menuitem', { name: 'Start a Range here' }).tap()
		// Frame steps and skipping are in the player's menu, which stays open
		await reviewer.getByRole('button', { name: 'Playback settings' }).tap()
		await expect(reviewer.getByRole('menuitem', { name: 'Forward 10 seconds' })).toBeVisible()
		for (let i = 0; i < 3; i++) {
			await reviewer.getByRole('menuitem', { name: 'One Frame forward' }).tap()
		}
		await reviewer.keyboard.press('Escape')
		await options.tap()
		await reviewer.getByRole('menuitem', { name: 'End the Range here' }).tap()
		await expect(reviewer.locator('.deliver-comments__anchor')).toContainText('–')
		await reviewer.locator('#deliver-comment-body').fill('on the phone')
		await reviewer.getByRole('button', { name: 'Send (Enter)' }).tap()
		await expect(reviewer.locator('.deliver-comment').filter({ hasText: 'on the phone' })).toContainText('Pia')
		// Its circle is on the bar, alone or in a count with others of its place
		await expect(reviewer.locator('.deliver-player__circle').first()).toHaveText(/^(P|\d+)$/)
		await guest.close()
	})

	test('a Reviewer names themselves and comments through a Review Link', async ({ playwright }) => {
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		const link = (await (await api.post(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}/links?format=json`)).json()).ocs.data
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
		await reviewer.getByRole('button', { name: 'Reviewing as Mara' }).click()
		await expect(reviewer.getByRole('checkbox', { name: 'New Versions' })).toBeChecked()
		// Their Personal Link, to be Mara on another device (story 128)
		await reviewer.getByRole('button', { name: 'Copy Personal Link' }).click()
		await expect(reviewer.getByText('Personal Link copied', { exact: true })).toBeVisible()
		await reviewer.keyboard.press('Escape')
		await reviewer.locator('#deliver-comment-body').fill('from the client')
		await reviewer.locator('.deliver-comments__form button[title="Send (Enter)"]').click()
		await expect(reviewer.locator('.deliver-comment').filter({ hasText: 'from the client' })).toContainText('Mara')
		await visitor.close()
	})

	test('the navigation lists a colleague\'s link and says who made it', async ({ playwright }) => {
		const mate = await playwright.request.newContext({ baseURL: URL, httpCredentials: { username: MATE, password: MATE_PASSWORD, send: 'always' }, extraHTTPHeaders: ocsHeaders })
		// Reading and resharing in Files is not Share in Deliver: the owner switches it on
		const owner = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		const members = `/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}/members?format=json`
		expect((await mate.post(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}/links?format=json`)).status()).toBe(403)
		expect((await owner.put(members, { data: { type: 'user', principal: MATE, level: 'comment', share: true, approve: false } })).status()).toBe(200)
		const made = await mate.post(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}/links?format=json`, { data: { label: 'Colleague link' } })
		expect(made.status()).toBe(201)
		const link = (await made.json()).ocs.data
		await mate.put(`/ocs/v2.php/apps/deliver/api/v1/links/${link.id}?format=json`, { data: { label: 'Mara\'s link' } })
		try {
			await page.goto(`/apps/deliver/projects/${projectId}`)
			const theirs = page.locator('.app-navigation li').filter({ hasText: 'Mara\'s link' }).first()
			await expect(theirs).toContainText('Made by Mara Mate')
			// Their link, though, is not marked as made by someone else
			await page.locator('.app-navigation').getByRole('button', { name: 'Create Review Link' }).click()
			await expect(page.getByRole('dialog')).toBeVisible()
			await page.keyboard.press('Escape')
			await expect(page.locator('.app-navigation').getByText('Made by deliver-e2e', { exact: true })).toHaveCount(0)
		} finally {
			await mate.delete(`/ocs/v2.php/apps/deliver/api/v1/links/${link.id}?format=json`)
			await owner.delete(members + `&type=user&principal=${MATE}`)
			await mate.dispose()
			await owner.dispose()
		}
	})

	test('the Project settings list the Members and set what each may do', async ({ playwright }) => {
		const owner = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		const api = `/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}`
		const listed = async () => (await (await owner.get(`${api}/members?format=json`)).json()).ocs.data.find((each) => each.id === MATE)
		try {
			await page.goto(`/apps/deliver/projects/${projectId}`)
			await page.getByRole('button', { name: 'Project settings' }).click()
			const dialog = page.getByRole('dialog')
			const mate = dialog.locator('.deliver-members__row', { hasText: 'Mara Mate' })
			const level = mate.getByLabel('Access level of Mara Mate')
			// Read access in Files gives Comment, and no Approve
			await expect(level).toHaveValue('comment')
			await expect(mate.getByRole('checkbox', { name: 'Approve' })).not.toBeChecked()

			await mate.getByText('Approve', { exact: true }).click()
			await expect.poll(async () => (await listed()).stored).toEqual({ level: 'comment', share: false, approve: true })
			await level.selectOption('view')
			// A View cannot approve, so the switch goes off and is fixed
			await expect.poll(async () => (await listed()).stored).toEqual({ level: 'view', share: false, approve: false })
			await expect(mate.getByRole('checkbox', { name: 'Approve' })).toBeDisabled()

			// The owner is marked and cannot be lowered
			const me = dialog.locator('.deliver-members__row', { hasText: USER })
			await expect(me).toContainText('Owner')
			await expect(me.getByLabel(`Access level of ${USER}`)).toBeDisabled()

			// Back to what Files gives
			await mate.getByRole('button', { name: 'Reset' }).click()
			await expect(level).toHaveValue('comment')
			expect((await listed()).stored).toBeNull()

			// What someone newly given access in Files starts with
			await dialog.getByLabel('Someone newly given access in Files starts with').selectOption('view')
			await expect.poll(async () => (await (await owner.get(`${api}?format=json`)).json()).ocs.data.newcomers).toBe('view')
			// Everyone who was a Member keeps what Files gives, with no entry made for them
			expect(await listed()).toMatchObject({ level: 'comment', stored: null })
		} finally {
			await owner.put(`${api}?format=json`, { data: { newcomers: 'files' } })
			await owner.delete(`${api}/members?format=json&type=user&principal=${MATE}`)
			await owner.dispose()
			await page.keyboard.press('Escape').catch(() => {})
		}
	})

	test('a Member invites someone from their contacts on a link of their own', async ({ playwright }) => {
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		// The test user keeps their address book between runs: a name of this run's own
		const run = randomBytes(3).toString('hex')
		const zoeName = `Zoe Quill ${run}`
		const uid = `deliver-e2e-${run}`
		const card = `/remote.php/dav/addressbooks/users/${USER}/contacts/${uid}.vcf`
		const vcard = `BEGIN:VCARD\r\nVERSION:3.0\r\nUID:${uid}\r\nFN:${zoeName}\r\n`
			+ 'EMAIL;TYPE=WORK:zoe@studio.test\r\nEMAIL;TYPE=HOME:zoe@home.test\r\nEND:VCARD\r\n'
		expect((await api.fetch(card, { method: 'PUT', data: vcard, headers: { 'Content-Type': 'text/vcard' } })).status()).toBe(201)
		// A link of the Project to put Zoe on later
		await api.post(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}/links?format=json`)

		try {
			await page.goto(`/apps/deliver/projects/${projectId}`)
			await page.locator('.app-navigation').getByRole('button', { name: 'Invite a Reviewer' }).click()
			const dialog = page.getByRole('dialog', { name: 'Invite a Reviewer' })
			const name = dialog.getByRole('combobox', { name: 'Name' })
			await name.pressSequentially(run)
			// One row per address; the arrow keys move, Enter picks
			await expect(page.getByRole('option')).toHaveCount(2)
			await name.press('ArrowDown')
			await name.press('Enter')
			await expect(page.getByRole('listbox')).toHaveCount(0)
			await expect(name).toHaveValue(zoeName)
			await expect(dialog.getByLabel('Email (optional)')).toHaveValue('zoe@home.test')
			await dialog.getByText('Reviewers may download the original').click()
			await dialog.getByRole('button', { name: 'Invite', exact: true }).click()
			await expect(dialog).toHaveCount(0)

			// A link of their own, titled by what it shows, with them under it
			const listed = await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}/links?format=json`)).json()
			const zoeId = listed.ocs.data.reviewers.find((each) => each.name === zoeName).id
			const theirs = listed.ocs.data.links.find((link) => link.reviewerIds.includes(zoeId))
			expect([theirs.reviewerIds, theirs.assetIds, theirs.canDownload]).toEqual([[zoeId], null, false])

			// Already a contact: nothing to save
			const zoe = page.locator('.app-navigation li').filter({ hasText: zoeName }).last()
			await zoe.hover()
			await zoe.getByRole('button', { name: 'Actions' }).click()
			await expect(page.getByRole('menuitem', { name: 'In your contacts' })).toBeDisabled()
			await page.keyboard.press('Escape')

			// Rights of their own on that link, from the gear at it in their dialog (ADR 0014)
			await zoe.getByText(zoeName).click()
			const person = page.getByRole('dialog', { name: zoeName })
			await person.getByRole('button', { name: `Rights of ${zoeName} on this link` }).click()
			const rights = page.getByRole('dialog', { name: `${zoeName} on “Whole Project”` })
			await rights.getByRole('radiogroup', { name: 'Comment', exact: true }).getByText('No', { exact: true }).click()
			await expect.poll(async () => {
				const now = await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}/links?format=json`)).json()
				return now.ocs.data.reviewers.find((each) => each.id === zoeId).links.find((each) => each.token === theirs.token).rights.canComment
			}).toBe(false)
			// One dialog at a time, by its own close button
			await rights.getByRole('button', { name: 'Close' }).click()
			await expect(rights).toHaveCount(0)
			await person.getByRole('button', { name: 'Close' }).click()
			await expect(person).toHaveCount(0)

			// Under the link, a click opens their rights on that very link
			await page.locator('.app-navigation').getByText(zoeName).first().click()
			const nested = page.getByRole('dialog', { name: `${zoeName} on “Whole Project”` })
			await expect(nested).toBeVisible()
			await nested.getByRole('button', { name: 'Close' }).click()
			await expect(nested).toHaveCount(0)

			// Put on another link of the Project from their dialog, with a Personal Link of its own (story 55)
			const zoeLinks = async () => {
				const now = await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}/links?format=json`)).json()
				return now.ocs.data.reviewers.find((each) => each.id === zoeId).links.map((each) => each.token)
			}
			await zoe.getByText(zoeName).click()
			const again = page.getByRole('dialog', { name: zoeName })
			await expect(again.getByLabel('Name', { exact: true })).toBeFocused()
			await again.getByRole('combobox', { name: 'Put on another Review Link' }).click()
			await page.getByRole('option').first().click()
			await expect.poll(async () => (await zoeLinks()).length).toBe(2)
			await again.getByRole('button', { name: 'Close' }).click()
			await expect(again).toHaveCount(0)

			// And taken off that one in its settings; the link of their own stays
			const other = (await zoeLinks()).find((token) => token !== theirs.token)
			const linkItem = page.locator('.app-navigation li').filter({ has: page.locator('ul li', { hasText: zoeName }) }).first()
			await linkItem.locator('.app-navigation-entry__name').first().click()
			const settings = page.getByRole('dialog').first()
			await settings.locator('.deliver-link__reviewer').filter({ hasText: zoeName }).getByRole('button', { name: `Take ${zoeName} off this link` }).click()
			await page.getByRole('button', { name: 'Take off' }).click()
			await expect.poll(zoeLinks).toEqual([theirs.token])
			expect(other).not.toBe(theirs.token)
		} finally {
			const cleanup = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth })
			await cleanup.fetch(card, { method: 'DELETE' })
			await cleanup.dispose()
			await api.dispose()
			await page.keyboard.press('Escape').catch(() => {})
		}
	})

	test('a file with Comments is locked, and an overwrite without the lock marks them', async ({ playwright }) => {
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		const lock = (lockFiles) => api.put(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`, { data: { lockFiles } })
		const clip = `/remote.php/dav/files/${USER}/${folder}/overwrite.webm`
		try {
			// A file of its own, as the Versions of the tests before are no longer the newest
			expect((await api.fetch(clip, { method: 'PUT', data: readFileSync(CLIP) })).status()).toBe(201)
			const project = await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)
			const mine = (await project.json()).ocs.data.assets.find((asset) => asset.versions[0].name === 'overwrite.webm').versions[0].id

			// A Comment locks the file against a sync client
			const commented = await api.post(`/ocs/v2.php/apps/deliver/api/v1/versions/${mine}/comments?format=json`, { data: { inFrame: 1, body: 'lock me' } })
			expect(commented.status(), await commented.text()).toBe(201)
			expect((await api.fetch(clip, { method: 'PUT', data: readFileSync(CLIP) })).status()).toBe(423)

			// The switch is in the Project settings, and off frees the file
			await page.goto(`/apps/deliver/projects/${projectId}`)
			await page.getByRole('button', { name: 'Project settings' }).click()
			const settings = page.getByRole('dialog', { name: /^Settings of/ })
			await settings.getByText('Protect files with Comments against deleting and renaming').click()
			await expect.poll(async () => (await api.fetch(clip, { method: 'PUT', data: readFileSync(CLIP) })).status()).toBe(204)
			await page.keyboard.press('Escape')

			await page.goto(`/apps/deliver/versions/${mine}`)
			await expect(page.locator('.deliver-comment__overwritten').first()).toContainText('before the overwrite on')
		} finally {
			await lock(true)
			await api.dispose()
		}
	})

	test('Captions are added on the Asset card and turned on under the CC button', async ({ playwright }) => {
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		expect((await api.fetch(`/remote.php/dav/files/${USER}/${folder}/captioned.webm`, { method: 'PUT', data: readFileSync(CLIP) })).status()).toBe(201)
		await api.dispose()

		await page.goto(`/apps/deliver/projects/${projectId}`)
		await card(page, 'captioned').click({ button: 'right' })
		await page.getByRole('menuitem', { name: 'Add Captions…' }).click()
		const dialog = page.getByRole('dialog', { name: 'Captions' })
		// The language comes from the file name
		await dialog.locator('input[type=file]').setInputFiles({ name: 'captioned.de.srt', mimeType: 'application/x-subrip', buffer: Buffer.from('1\n00:00:00,000 --> 00:00:03,000\nHallo\n') })
		await expect(dialog.locator('.vs__selected')).toHaveText('German')
		// Focus stays in the file field, as where a click does not focus the button (Safari); Escape in a field leaves a dialog open
		await dialog.locator('input[type=file]').focus()
		await dialog.getByRole('button', { name: 'Add Captions' }).dispatchEvent('click')
		await expect(dialog.locator('.deliver-captions__list')).toHaveText('German')
		await page.keyboard.press('Escape')
		await expect(dialog).toBeHidden()

		await card(page, 'captioned').locator('.deliver-card__link').dblclick()
		const shown = () => page.evaluate(() => [...document.querySelector('.deliver-player__video').textTracks].filter((track) => track.mode === 'showing').map((track) => track.language))
		// Off until someone turns them on
		await expect(page.getByRole('button', { name: 'Captions' })).toBeVisible()
		expect(await shown()).toEqual([])
		await page.getByRole('button', { name: 'Captions' }).click()
		await page.getByRole('menuitemradio', { name: 'German' }).click()
		await expect.poll(shown).toEqual(['de'])
		await page.getByRole('button', { name: 'Captions' }).click()
		await page.getByRole('menuitemradio', { name: 'Off' }).click()
		await expect.poll(shown).toEqual([])
	})

	test('the timeline hover scrubs through what plays where this browser cannot play the Scrub Proxy', async () => {
		// ffmpeg makes the clip's Scrub Proxy, an H.264 MP4, which open-source Chromium does not decode
		execFileSync('docker', ['compose', 'exec', '-T', '-u', 'www-data', 'nextcloud', 'php', 'occ', 'deliver:worker', '--once'], { stdio: 'inherit' })
		await page.goto(`/apps/deliver/versions/${versionId}`)
		const h264 = await page.evaluate(() => document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E"') !== '')
		await expect(page.locator('.deliver-player__scrub-video')).toHaveAttribute('src', h264 ? /\/media\/scrub$/ : /clip\.webm$/)
		const bar = await page.locator('.deliver-player__timeline').boundingBox()
		await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2)
		await expect(page.locator('.deliver-player__hover canvas')).toBeVisible()
	})

	test('a click on the timeline keeps playing if it played, and stays paused if it did not', async () => {
		await page.goto(`/apps/deliver/versions/${versionId}`)
		const video = page.locator('video.deliver-player__video')
		await expect(video).toHaveJSProperty('readyState', 4)
		const bar = await page.locator('.deliver-player__timeline').boundingBox()
		const clickAt = (share) => page.mouse.click(bar.x + bar.width * share, bar.y + bar.height / 2)

		await clickAt(0.1)
		await page.waitForTimeout(300)
		expect(await video.evaluate((element) => element.paused)).toBe(true)

		await page.getByRole('button', { name: /^Play \(/ }).click()
		await expect.poll(() => video.evaluate((element) => element.currentTime)).toBeGreaterThan(0.1)
		await clickAt(0.5)
		await page.waitForTimeout(300)
		expect(await video.evaluate((element) => element.paused)).toBe(false)
		expect(await video.evaluate((element) => element.currentTime)).toBeGreaterThan(1.9)
		await expect(page.getByRole('button', { name: /^Pause \(/ })).toBeVisible()
	})

	test('dragging the playhead with the mouse seeks before release, holds playback and goes on if it played', async () => {
		await page.goto(`/apps/deliver/versions/${versionId}`)
		const video = page.locator('video.deliver-player__video')
		await expect(video).toHaveJSProperty('readyState', 4)
		const bar = await page.locator('.deliver-player__timeline').boundingBox()
		const y = bar.y + bar.height / 2
		const time = () => video.evaluate((element) => element.currentTime)
		const paused = () => video.evaluate((element) => element.paused)

		await page.getByRole('button', { name: /^Play \(/ }).click()
		await expect.poll(paused).toBe(false)
		await page.mouse.move(bar.x + bar.width * 0.2, y)
		await page.mouse.down()
		await page.mouse.move(bar.x + bar.width * 0.5, y, { steps: 5 })
		// Still pressed: the picture is already there and playback is held
		await expect.poll(time).toBeGreaterThan(1.8)
		expect(await time()).toBeLessThan(2.3)
		expect(await paused()).toBe(true)
		await page.mouse.move(bar.x + bar.width * 0.75, y, { steps: 5 })
		await expect.poll(time).toBeGreaterThan(2.8)
		await page.mouse.up()
		await expect.poll(paused).toBe(false)

		// Paused stays paused
		await page.getByRole('button', { name: /^Pause \(/ }).click()
		await page.mouse.move(bar.x + bar.width * 0.8, y)
		await page.mouse.down()
		await page.mouse.move(bar.x + bar.width * 0.1, y, { steps: 5 })
		await expect.poll(time).toBeLessThan(0.7)
		await page.mouse.up()
		await page.waitForTimeout(300)
		expect(await paused()).toBe(true)
	})

	test('a click on the bar keeps a backwards shuttle going, from where it was clicked', async () => {
		await page.goto(`/apps/deliver/versions/${versionId}`)
		const video = page.locator('video.deliver-player__video')
		await expect(video).toHaveJSProperty('readyState', 4)
		await page.locator('.deliver-layout__bar h2').click()
		const bar = await page.locator('.deliver-player__timeline').boundingBox()
		const y = bar.y + bar.height / 2
		await page.mouse.click(bar.x + bar.width * 0.9, y)
		await page.keyboard.press('j')
		await expect(page.getByRole('button', { name: /^Pause \(/ })).toBeVisible()
		// A click is only a seek: the shuttle goes on backwards from there (holding playback would drop it,
		// and letting go would play forwards from 2.0 s)
		await page.mouse.click(bar.x + bar.width * 0.5, y)
		await page.waitForTimeout(300)
		expect(await video.evaluate((element) => element.currentTime)).toBeLessThan(2)
		await expect(page.getByRole('button', { name: /^Pause \(/ })).toBeVisible()
		await page.keyboard.press('k')
	})

	test('a click on a Comment in the list pauses on its Frame', async ({ playwright }) => {
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		// The Compare test stacked a newer Version on the Asset; only the newest takes Comments
		const project = await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)).json()
		const newest = Math.max(...project.ocs.data.assets[0].versions.map((each) => each.id))
		const commented = await api.post(`/ocs/v2.php/apps/deliver/api/v1/versions/${newest}/comments?format=json`, { data: { inFrame: 50, body: 'stop here' } })
		expect(commented.ok()).toBe(true)
		await page.goto(`/apps/deliver/versions/${newest}`)
		const video = page.locator('video.deliver-player__video')
		await expect(video).toHaveJSProperty('readyState', 4)
		await page.getByRole('button', { name: /^Play \(/ }).click()
		await expect.poll(() => video.evaluate((element) => element.paused)).toBe(false)
		await page.locator('.deliver-comment').filter({ hasText: 'stop here' }).locator('.deliver-comment__anchor').click()
		await expect.poll(() => video.evaluate((element) => element.paused)).toBe(true)
		expect(await video.evaluate((element) => element.currentTime)).toBeCloseTo(2, 1)
		const id = (await commented.json()).ocs.data.id
		expect((await api.delete(`/ocs/v2.php/apps/deliver/api/v1/comments/${id}?format=json`)).ok()).toBe(true)
		await api.dispose()
	})

	test('close Comments share a circle with their count, reached by Tab, and the bar grows under a mouse and takes a finger up to its edges', async ({ playwright }) => {
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		const project = await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)).json()
		const newest = Math.max(...project.ocs.data.assets[0].versions.map((each) => each.id))
		const ids = []
		for (const inFrame of [60, 85, 86, 87]) {
			const made = await api.post(`/ocs/v2.php/apps/deliver/api/v1/versions/${newest}/comments?format=json`, { data: { inFrame, body: `at ${inFrame}` } })
			ids.push((await made.json()).ocs.data.id)
		}
		await page.goto(`/apps/deliver/versions/${newest}`)
		await expect(page.locator('video.deliver-player__video')).toHaveJSProperty('readyState', 4)
		const count = page.locator('.deliver-player__circle').filter({ hasText: '3' })
		await expect(count).toHaveCount(1)
		// Selected in the list, its circle is ringed
		await page.locator('.deliver-comment').filter({ hasText: 'at 60' }).locator('.deliver-comment__anchor').click()
		await expect(page.locator('.deliver-player__circle--ringed')).toHaveCount(1)
		await expect(count).not.toHaveClass(/--ringed/)
		// Tab reaches each circle by its name; Enter opens its card, the count's with previous and next; Escape hands the focus back
		const single = page.getByRole('button', { name: 'Comment by deliver-e2e at 00:00:02:10' })
		await single.focus()
		await page.keyboard.press('Tab')
		await expect(page.getByRole('button', { name: '3 Comments at 00:00:03:10' })).toBeFocused()
		await page.keyboard.press('Shift+Tab')
		await expect(single).toBeFocused()
		await page.keyboard.press('Enter')
		const card = page.getByRole('dialog', { name: /^Comment #/ })
		await expect(card).toContainText('at 60')
		await expect(card).toBeFocused()
		await page.keyboard.press('Escape')
		await expect(card).toHaveCount(0)
		await expect(single).toBeFocused()
		await page.keyboard.press('Tab')
		await page.keyboard.press('Enter')
		await expect(card).toContainText('at 85')
		await expect(card).toContainText('1 of 3')
		await card.getByRole('button', { name: 'Next Comment' }).click()
		await expect(card).toContainText('at 86')
		await expect(card).toContainText('2 of 3')
		await page.keyboard.press('Escape')
		await expect(page.getByRole('button', { name: '3 Comments at 00:00:03:10' })).toBeFocused()
		expect(await page.locator('video.deliver-player__video').evaluate((element) => Math.floor(element.currentTime * 25 + 0.001))).toBe(60)
		// The bar grows under a mouse, on a narrow window too, not under a finger
		await page.setViewportSize({ width: 900, height: 800 })
		await page.locator('.deliver-player__timeline').hover()
		await expect(page.locator('.deliver-player__track')).toHaveCSS('height', '12px')
		const [knob, track] = await Promise.all(['.deliver-player__timeline', '.deliver-player__track'].map((each) => page.locator(each).boundingBox()))
		expect(track.y + track.height / 2).toBeCloseTo(knob.y + knob.height / 2, 0)
		await page.setViewportSize({ width: 1280, height: 720 })

		const phone = await browser.newContext({ baseURL: BROWSER_URL, ...PHONE })
		const touchPage = await phone.newPage()
		await login(touchPage)
		const video = touchPage.locator('video.deliver-player__video')
		const frame = () => video.evaluate((element) => Math.floor(element.currentTime * 25 + 0.001))
		for (const edge of ['top', 'bottom']) {
			await touchPage.goto(`/apps/deliver/versions/${newest}`)
			await expect(video).toHaveJSProperty('readyState', 4)
			const bar = await touchPage.locator('.deliver-player__timeline').boundingBox()
			await touchPage.touchscreen.tap(bar.x + bar.width * 0.855, bar.y + (edge === 'top' ? 2 : bar.height - 2))
			await expect.poll(frame).toBe(85)
			await touchPage.waitForTimeout(300)
			await expect(touchPage.locator('.deliver-player__track')).toHaveCSS('height', '6px')
		}
		// Its lower edge is the bar's over every control of the one row under it: it seeks, and none of them answers
		const bottom = await touchPage.locator('.deliver-player__timeline').boundingBox()
		const menu = touchPage.getByRole('button', { name: 'Playback settings' })
		for (const control of [touchPage.getByRole('button', { name: 'Play', exact: true }), touchPage.locator('.deliver-player__time'), menu]) {
			const box = await control.boundingBox()
			const x = box.x + box.width / 2
			await touchPage.touchscreen.tap(x, bottom.y + bottom.height - 1)
			await expect.poll(frame).toBe(Math.floor((x - bottom.x) / bottom.width * 100))
			await touchPage.waitForTimeout(300)
			expect(await video.evaluate((element) => element.paused)).toBe(true)
			await expect(menu).toHaveAttribute('aria-expanded', 'false')
		}
		// The half of a circle beyond either end is the bar's too
		const ends = await touchPage.locator('.deliver-player__timeline').boundingBox()
		for (const [x, at] of [[ends.x + ends.width + 8, 99], [ends.x - 8, 0]]) {
			await touchPage.touchscreen.tap(x, ends.y + ends.height / 2)
			await expect.poll(frame).toBe(at)
		}
		// Above it the picture keeps its own
		const bar = await touchPage.locator('.deliver-player__timeline').boundingBox()
		await touchPage.touchscreen.tap(bar.x + bar.width * 0.3, bar.y - 4)
		await expect(touchPage.locator('.deliver-player--fullscreen, .deliver-player--filling')).toHaveCount(1)
		await phone.close()
		for (const id of ids) {
			expect((await api.delete(`/ocs/v2.php/apps/deliver/api/v1/comments/${id}?format=json`)).ok()).toBe(true)
		}
		await api.dispose()
	})

	test('a tap on a Comment\'s circle on the bar opens its small card and seeks nowhere, a press beside it or one that moves seeks as anywhere, by mouse, finger and pen', async ({ playwright }) => {
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		const project = await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)).json()
		const newest = Math.max(...project.ocs.data.assets[0].versions.map((each) => each.id))
		const made = await api.post(`/ocs/v2.php/apps/deliver/api/v1/versions/${newest}/comments?format=json`, { data: { inFrame: 30, body: 'look at me' } })
		const id = (await made.json()).ocs.data.id
		const phone = await browser.newContext({ baseURL: BROWSER_URL, ...PHONE })
		const touchPage = await phone.newPage()
		await login(touchPage)
		const touch = await phone.newCDPSession(touchPage)
		const cdp = await context.newCDPSession(page)
		const finger = (x, y) => ({
			down: () => touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }),
			move: (dx) => touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y }] }),
			up: () => touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
		})
		const mouse = (x, y) => ({
			down: async () => {
				await page.mouse.move(x, y)
				await page.mouse.down()
			},
			move: (dx) => page.mouse.move(x + dx, y),
			up: () => page.mouse.up(),
		})
		const pen = (x, y) => {
			const send = (type, at, buttons) => cdp.send('Input.dispatchMouseEvent', { type, x: at, y, button: 'left', buttons, clickCount: 1, pointerType: 'pen' })
			let at = x
			return {
				down: () => send('mousePressed', x, 1),
				move: (dx) => {
					at = x + dx
					return send('mouseMoved', at, 1)
				},
				up: () => send('mouseReleased', at, 0),
			}
		}

		for (const [target, pointer] of [[page, mouse], [touchPage, finger], [page, pen]]) {
			await target.goto(`/apps/deliver/versions/${newest}`)
			const video = target.locator('video.deliver-player__video')
			await expect(video).toHaveJSProperty('readyState', 4)
			const frame = () => video.evaluate((element) => Math.floor(element.currentTime * 25 + 0.001))
			const paused = () => video.evaluate((element) => element.paused)
			const bar = await target.locator('.deliver-player__timeline').boundingBox()
			const circle = target.locator('.deliver-player__circle').filter({ hasText: 'D' })
			const box = await circle.boundingBox()
			expect(box.x + box.width / 2).toBeCloseTo(bar.x + bar.width * 0.3, 0)
			// Off its middle, a Frame of its own
			const x = box.x + box.width / 2 - 6
			const { down, move, up } = pointer(x, box.y + box.height / 2)
			const at = (px) => Math.floor((px - bar.x) / bar.width * 100)
			const card = target.getByRole('dialog', { name: /^Comment #/ })

			// Tapped it opens its card over it, inside the window, and the player stays where it was
			await down()
			await up()
			await expect(card).toContainText('look at me')
			await expect(circle).toHaveClass(/--ringed/)
			expect(await frame()).toBe(0)
			expect(await paused()).toBe(true)
			const over = await card.boundingBox()
			expect(over.y + over.height).toBeLessThanOrEqual(box.y)
			expect(over.x).toBeGreaterThanOrEqual(0)
			expect(over.x + over.width).toBeLessThanOrEqual(target.viewportSize().width)
			expect(over.x).toBeLessThan(box.x + box.width / 2)
			expect(over.x + over.width).toBeGreaterThan(box.x + box.width / 2)
			// A press beside it, past its edge, closes the card and is there at once, under the pointer; the playback state stays
			const beside = pointer(box.x - 4, box.y + box.height / 2)
			await beside.down()
			await expect(card).toHaveCount(0)
			await expect.poll(frame).toBe(at(box.x - 4))
			await beside.up()
			await target.waitForTimeout(400)
			expect(await frame()).toBe(at(box.x - 4))
			expect(await paused()).toBe(true)
			await expect(card).toHaveCount(0)
			// Twice in a row on the circle opens it again, no seek
			await down()
			await up()
			await down()
			await up()
			await target.waitForTimeout(400)
			expect(await frame()).toBe(at(box.x - 4))
			await expect(card).toBeVisible()
			await target.keyboard.press('Escape')
			await expect(card).toHaveCount(0)

			// Playing, a press on the circle that moves past the slop is a drag: it holds playback, shows the Frame over the pointer and opens nothing
			await target.getByRole('button', { name: /^Play/ }).first().click()
			await expect.poll(paused).toBe(false)
			await down()
			await move(40)
			await move(120)
			await expect.poll(frame).toBe(at(x + 120))
			expect(await paused()).toBe(true)
			await expect(target.locator('.deliver-player__hover')).toBeVisible()
			await move(0)
			await expect.poll(frame).toBe(at(x))
			await up()
			await expect.poll(paused).toBe(false)
			await expect(card).toHaveCount(0)
			// A tap on it while playing opens it and goes on playing
			await down()
			await up()
			await expect(card).toBeVisible()
			await target.waitForTimeout(200)
			expect(await paused()).toBe(false)
			await target.getByRole('button', { name: /^Pause/ }).first().click()
		}
		// A finger held on the circle is a hold, not a tap: the zoomed section opens around the circle's place, and letting go seeks there and opens no card
		await touchPage.goto(`/apps/deliver/versions/${newest}`)
		const video = touchPage.locator('video.deliver-player__video')
		await expect(video).toHaveJSProperty('readyState', 4)
		const held = await touchPage.locator('.deliver-player__circle').filter({ hasText: 'D' }).boundingBox()
		const bar = await touchPage.locator('.deliver-player__timeline').boundingBox()
		const x = held.x + held.width / 2 - 6
		const there = Math.floor((x - bar.x) / bar.width * 100)
		const hold = finger(x, held.y + held.height / 2)
		const frame = () => video.evaluate((element) => Math.floor(element.currentTime * 25 + 0.001))
		await hold.down()
		await expect(touchPage.locator('.deliver-player__loupe')).toBeVisible()
		await expect.poll(frame).toBe(there)
		await expect(touchPage.locator('.deliver-player__loupe-ends span').first()).not.toHaveText('00:00:00:00')
		await hold.up()
		await expect(touchPage.locator('.deliver-player__loupe')).toHaveCount(0)
		await expect.poll(frame).toBe(there)
		await touchPage.waitForTimeout(300)
		await expect(touchPage.getByRole('dialog', { name: /^Comment #/ })).toHaveCount(0)
		// The mouse shows the Frame's time over a circle as beside it
		const box = await page.locator('.deliver-player__circle').filter({ hasText: 'D' }).boundingBox()
		await page.mouse.move(0, 0)
		await expect(page.locator('.deliver-player__hover')).toBeHidden()
		await page.mouse.move(box.x + box.width / 2 + 0.5, box.y + box.height / 2)
		await expect(page.locator('.deliver-player__hover-time')).toHaveText('00:00:01:05')
		await phone.close()
		expect((await api.delete(`/ocs/v2.php/apps/deliver/api/v1/comments/${id}?format=json`)).ok()).toBe(true)
		await api.dispose()
	})

	test('a finger on the timeline holds playback and resumes on lifting only if it played', async () => {
		const phone = await browser.newContext({ baseURL: BROWSER_URL, ...PHONE })
		const touchPage = await phone.newPage()
		await login(touchPage)
		await touchPage.goto(`/apps/deliver/versions/${versionId}`)
		const video = touchPage.locator('video.deliver-player__video')
		await expect(video).toHaveJSProperty('readyState', 4)
		const cdp = await phone.newCDPSession(touchPage)
		const bar = await touchPage.locator('.deliver-player__timeline').boundingBox()
		const y = bar.y + bar.height / 2
		const touch = (type, x) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
		const paused = () => video.evaluate((element) => element.paused)

		// Playing: held while the finger is down, going on from where it lifted
		await touchPage.getByRole('button', { name: 'Play', exact: true }).tap()
		await expect.poll(paused).toBe(false)
		await touch('touchStart', bar.x + bar.width * 0.2)
		await touch('touchMove', bar.x + bar.width * 0.6)
		await expect.poll(paused).toBe(true)
		// The picture followed the finger before it lifted
		await expect.poll(() => video.evaluate((element) => element.currentTime)).toBeGreaterThan(2)
		await touch('touchEnd')
		await expect.poll(paused).toBe(false)
		expect(await video.evaluate((element) => element.currentTime)).toBeGreaterThan(2)

		// A second finger lands during the drag: both lift, and it still goes on
		await touch('touchStart', bar.x + bar.width * 0.2)
		await touch('touchMove', bar.x + bar.width * 0.4)
		await expect.poll(paused).toBe(true)
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bar.x + bar.width * 0.4, y, id: 0 }, { x: bar.x + bar.width * 0.7, y, id: 1 }] })
		await touch('touchEnd')
		await expect.poll(paused).toBe(false)

		// Paused: stays paused
		await touchPage.getByRole('button', { name: 'Pause', exact: true }).tap()
		await touch('touchStart', bar.x + bar.width * 0.2)
		await touch('touchMove', bar.x + bar.width * 0.3)
		await touch('touchEnd')
		await touchPage.waitForTimeout(400)
		expect(await paused()).toBe(true)
		await phone.close()
	})

	test('a click on the Compare timeline starts a side that had run out again', async ({ playwright }) => {
		// The Compare test left a second Version on the Asset
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		const project = await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)).json()
		await api.dispose()
		const stack = project.ocs.data.assets.find((each) => each.versions.length >= 2).versions
		await page.goto(`/apps/deliver/compare/${stack[1].id}/${stack[0].id}`)
		const videos = page.locator('.deliver-compare video')
		await expect(videos.first()).toHaveJSProperty('readyState', 4)
		// B runs 50 Frames (2 s) ahead of A, so it is out of picture before A is
		await page.locator('.deliver-compare__offset').fill('50')
		await page.getByRole('button', { name: /^Play \(/ }).click()
		await expect.poll(() => videos.nth(1).evaluate((element) => element.ended), { timeout: 10_000 }).toBe(true)
		const bar = await page.locator('.deliver-compare__timeline').boundingBox()
		await page.mouse.click(bar.x + bar.width * 0.1, bar.y + bar.height / 2)
		await page.waitForTimeout(300)
		expect(await videos.first().evaluate((element) => element.paused)).toBe(false)
		expect(await videos.nth(1).evaluate((element) => element.paused)).toBe(false)
	})

	test('dragging the Compare bar seeks both sides live, B offset from A, holds playback and goes on after', async ({ playwright }) => {
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		const project = await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)).json()
		await api.dispose()
		const stack = project.ocs.data.assets.find((each) => each.versions.length >= 2).versions
		await page.goto(`/apps/deliver/compare/${stack[1].id}/${stack[0].id}`)
		const videos = page.locator('.deliver-compare video')
		await expect(videos.first()).toHaveJSProperty('readyState', 4)
		// B stands 25 Frames (1 s) ahead of A
		await page.locator('.deliver-compare__offset').fill('25')
		const times = () => videos.evaluateAll((all) => all.map((video) => video.currentTime))
		const paused = () => videos.evaluateAll((all) => all.map((video) => video.paused))
		const bar = await page.locator('.deliver-compare__timeline').boundingBox()
		const y = bar.y + bar.height / 2
		await page.getByRole('button', { name: /^Play \(/ }).click()
		await expect.poll(paused).toEqual([false, false])
		await page.mouse.move(bar.x + bar.width * 0.1, y)
		await page.mouse.down()
		// A steady drag: A is sought one seek at a time, the latest Frame next, and not once for every move
		// (a drag holds playback once; pausing seeks again, which would abort the seek on its way)
		await videos.first().evaluate((element) => {
			const { get, set } = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')
			window.assigned = 0
			window.settled = 0
			element.addEventListener('seeked', () => window.settled++)
			Object.defineProperty(element, 'currentTime', {
				get: () => get.call(element),
				set: (value) => {
					window.assigned++
					set.call(element, value)
				},
			})
		})
		for (let step = 1; step <= 60; step++) {
			await page.mouse.move(bar.x + bar.width * (0.1 + step * 0.0075), y)
		}
		const drag = await page.evaluate(() => ({ assigned: window.assigned, settled: window.settled }))
		expect(drag.assigned).toBeLessThanOrEqual(drag.settled + 4)
		// Still pressed: both sides are there already, B a second on from A, and neither plays
		await expect.poll(async () => (await times())[0]).toBeGreaterThan(1.8)
		await expect.poll(async () => (await times())[1] - (await times())[0]).toBeCloseTo(1, 1)
		expect(await paused()).toEqual([true, true])
		await page.mouse.up()
		await expect.poll(paused).toEqual([false, false])
		await page.keyboard.press('k')
		await page.locator('.deliver-compare__offset').fill('0')
	})

	test('Shift+arrows skip ten seconds in Compare, both sides together', async ({ playwright }) => {
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		const project = await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)).json()
		await api.dispose()
		const stack = project.ocs.data.assets.find((each) => each.versions.length >= 2).versions
		await page.goto(`/apps/deliver/compare/${stack[1].id}/${stack[0].id}`)
		const videos = page.locator('.deliver-compare video')
		await expect(videos.first()).toHaveJSProperty('readyState', 4)
		await page.locator('.deliver-compare__offset').fill('0')
		const bar = await page.locator('.deliver-compare__timeline').boundingBox()
		await page.mouse.click(bar.x + bar.width * 0.5, bar.y + bar.height / 2)
		await page.locator('.deliver-layout__bar h2').click()
		// Ten seconds are more than the 4 s clip: they land on its last Frame, and back on the first
		await page.keyboard.press('Shift+ArrowRight')
		await expect(page.locator('.deliver-compare__timecode')).toContainText('00:00:03:24')
		await page.keyboard.press('Shift+ArrowLeft')
		await expect(page.locator('.deliver-compare__timecode')).toContainText('00:00:00:00')
		const times = await videos.evaluateAll((all) => all.map((video) => video.currentTime))
		expect(times[1]).toBeCloseTo(times[0], 3)
	})

	test('a Review Link opens as a list and remembers the cards for itself', async ({ playwright }) => {
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		// The landing page opens only where a link shows several Assets
		const dav = `/remote.php/dav/files/${USER}/${folder}`
		const count = async () => (await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)).json()).ocs.data.assets.length
		const before = await count()
		expect((await api.fetch(`${dav}/linklist.webm`, { method: 'PUT', data: readFileSync(CLIP) })).status()).toBe(201)
		await expect.poll(count).toBe(before + 1)
		const make = async () => (await (await api.post(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}/links?format=json`)).json()).ocs.data.token
		const [one, other] = [await make(), await make()]
		await api.dispose()

		const visitor = await browser.newContext({ baseURL: BROWSER_URL })
		const reviewer = await visitor.newPage()
		await reviewer.goto(`/apps/deliver/s/${one}`)
		await expect(reviewer.locator('.deliver-landing__card').first()).toBeVisible()
		await expect(reviewer.locator('.deliver-landing__grid--list')).toHaveCount(1)
		await expect(reviewer.locator('.deliver-landing__facts').first()).toContainText('V1')
		// An Asset is picked for the ZIP in rows and in cards
		const pick = reviewer.locator('.deliver-landing__pick:not(:disabled)').first()
		await pick.check()
		await expect(reviewer.getByRole('link', { name: 'Download selection' })).toBeVisible()
		await pick.uncheck()
		await expect(reviewer.getByRole('link', { name: 'Download selection' })).toHaveCount(0)
		await reviewer.getByRole('button', { name: 'Show the Assets as a list' }).click()
		await pick.check()
		await expect(reviewer.getByRole('link', { name: 'Download selection' })).toBeVisible()
		await pick.uncheck()
		await expect(reviewer.locator('.deliver-landing__grid--list')).toHaveCount(0)
		await reviewer.reload()
		await expect(reviewer.locator('.deliver-landing__card').first()).toBeVisible()
		await expect(reviewer.locator('.deliver-landing__grid--list')).toHaveCount(0)
		// Another link of the same Project is still a list
		await reviewer.goto(`/apps/deliver/s/${other}`)
		await expect(reviewer.locator('.deliver-landing__card').first()).toBeVisible()
		await expect(reviewer.locator('.deliver-landing__grid--list')).toHaveCount(1)
		await visitor.close()
		const cleanup = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth })
		await cleanup.fetch(`${dav}/linklist.webm`, { method: 'DELETE' })
		await cleanup.dispose()
	})

	test('a long name takes two smaller lines on its card, breaks where it has no spaces, and shows whole in its title', async ({ playwright }) => {
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		const dav = `/remote.php/dav/files/${USER}/${folder}`
		const name = 'interview_with_the_director_rough_cut_colour_graded_final_final_v12_for_the_client_to_approve_before_friday'
		const count = async () => (await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)).json()).ocs.data.assets.length
		const before = await count()
		expect((await api.fetch(`${dav}/${name}.webm`, { method: 'PUT', data: readFileSync(CLIP) })).status()).toBe(201)
		await expect.poll(count).toBe(before + 1)
		await api.dispose()

		await page.goto(`/apps/deliver/projects/${projectId}`)
		await page.evaluate((key) => localStorage.setItem(key, 'grid'), `deliver.layout.project-${projectId}`)
		await page.reload()
		const long = card(page, name)
		const label = long.locator('.deliver-card__name')
		await expect(label).toHaveAttribute('title', `${name}.webm`)
		const shown = await label.evaluate((element) => {
			const style = getComputedStyle(element)
			return {
				lines: Math.round(element.clientHeight / parseFloat(style.lineHeight)),
				cut: element.scrollHeight > element.clientHeight,
				sideways: element.scrollWidth > element.clientWidth,
				size: parseFloat(style.fontSize),
				body: parseFloat(getComputedStyle(document.body).fontSize),
			}
		})
		expect(shown).toMatchObject({ lines: 2, cut: true, sideways: false })
		expect(shown.size).toBeLessThan(shown.body)
		// What reads it out gets the whole name
		await expect(long.locator('.deliver-card__link')).toHaveAccessibleName(new RegExp(name))
		// The cards beside it in its row are as tall as it
		const row = await page.locator('.deliver-card__link').evaluateAll((links, picked) => {
			const boxes = links.map((link) => link.getBoundingClientRect())
			const own = boxes[links.findIndex((link) => link.textContent.includes(picked))]
			return boxes.filter((box) => Math.abs(box.top - own.top) < 1).map((box) => Math.round(box.height))
		}, name)
		expect(row.length).toBeGreaterThan(1)
		expect(new Set(row).size).toBe(1)

		const cleanup = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth })
		await cleanup.fetch(`${dav}/${name}.webm`, { method: 'DELETE' })
		await cleanup.dispose()
	})

	test('a Review Link named after a long folder without spaces keeps its heading within a phone\'s width', async ({ playwright }) => {
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		const dav = `/remote.php/dav/files/${USER}/${folder}_festival_submission_directors_cut_colour_graded_final`
		expect((await api.fetch(dav, { method: 'MKCOL' })).status()).toBe(201)
		for (const file of ['one', 'two']) {
			expect((await api.fetch(`${dav}/${file}.webm`, { method: 'PUT', data: readFileSync(CLIP) })).status()).toBe(201)
		}
		const id = (await (await api.post('/ocs/v2.php/apps/deliver/api/v1/projects?format=json', { data: { folderId: await fileId(api, dav), autoIntake: true } })).json()).ocs.data.id
		const token = (await (await api.post(`/ocs/v2.php/apps/deliver/api/v1/projects/${id}/links?format=json`)).json()).ocs.data.token

		const guest = await browser.newContext({ baseURL: BROWSER_URL, ...PHONE, viewport: { width: 375, height: 667 } })
		try {
			const reviewer = await guest.newPage()
			await reviewer.goto(`/apps/deliver/s/${token}`)
			const heading = reviewer.locator('.deliver-landing__intro h2')
			await expect(heading).toContainText('festival_submission')
			expect(await heading.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0)
			expect(await reviewer.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
		} finally {
			await guest.close()
			await api.delete(`/ocs/v2.php/apps/deliver/api/v1/projects/${id}?format=json`)
			await api.fetch(dav, { method: 'DELETE' })
			await api.dispose()
		}
	})
})

test.describe('The bar on a phone', () => {
	let browser
	let folder
	let projectId
	/** The Asset's Versions, newest first */
	let versions
	let token
	/** Too long for a phone's bar beside its buttons */
	const NAME = 'final-mix-of-the-trailer-for-the-festival-with-the-long-title'

	test.beforeAll(async ({ playwright }) => {
		await testUser(playwright)
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		folder = 'deliver-e2e-' + randomBytes(4).toString('hex')
		const dav = `/remote.php/dav/files/${USER}/${folder}`
		expect((await api.fetch(dav, { method: 'MKCOL' })).status()).toBe(201)
		const created = await api.post('/ocs/v2.php/apps/deliver/api/v1/projects?format=json', { data: { folderId: await fileId(api, dav), autoIntake: true } })
		projectId = (await created.json()).ocs.data.id
		// One after the other, so the second stacks on the first as its V2
		for (const name of [`${NAME}.webm`, `${NAME}_v2.webm`]) {
			expect((await api.fetch(`${dav}/${name}`, { method: 'PUT', data: readFileSync(CLIP) })).status()).toBe(201)
		}
		const assets = async () => (await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)).json()).ocs.data.assets
		await expect.poll(async () => (await assets())[0]?.versions.length).toBe(2)
		versions = (await assets())[0].versions
		// A Due Date adds its line to the name's block in the bar
		expect((await api.put(`/ocs/v2.php/apps/deliver/api/v1/assets/${(await assets())[0].id}?format=json`, { data: { dueDate: '2030-02-20' } })).ok()).toBe(true)
		token = (await (await api.post(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}/links?format=json`)).json()).ocs.data.token
		await api.dispose()
		browser = await chromium.connectOverCDP(CDP)
	})

	test.afterAll(async ({ playwright }) => {
		await browser?.close()
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		await api.delete(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)
		await api.fetch(`/remote.php/dav/files/${USER}/${folder}`, { method: 'DELETE' })
		await api.dispose()
	})

	/**
	 * Whether a finger on the middle of it reaches it, not whatever covers it
	 *
	 * @param {import('@playwright/test').Locator} locator - a button
	 * @return {Promise<boolean>}
	 */
	const reachable = (locator) => locator.evaluate((element) => {
		const box = element.getBoundingClientRect()
		const x = box.left + box.width / 2
		const y = box.top + box.height / 2
		return box.width > 0 && x > 0 && x < window.innerWidth && y > 0 && y < window.innerHeight && element.contains(document.elementFromPoint(x, y))
	})

	/**
	 * @param {import('@playwright/test').Page} page - a Review view or Compare
	 * @param {import('@playwright/test').Locator[]} buttons - what the bar has to offer
	 * @param {number} height - the bar's most, one row
	 */
	async function oneRow(page, buttons, height) {
		const bar = page.locator('.deliver-layout__bar')
		await expect(bar).toBeVisible()
		const box = await bar.boundingBox()
		expect(box.height).toBeLessThanOrEqual(height)
		for (const button of buttons) {
			const each = await button.boundingBox()
			expect(each.y).toBeGreaterThanOrEqual(box.y)
			expect(each.y + each.height).toBeLessThanOrEqual(box.y + box.height)
			expect(await reachable(button)).toBe(true)
		}
		// What plays starts under the bar
		const below = await page.locator('.deliver-layout__body').boundingBox()
		expect(below.y).toBeGreaterThanOrEqual(box.y + box.height - 0.5)
	}

	/**
	 * Nothing of the layout lies over the picture's top end corner, where the Comments button floated sideways
	 *
	 * @param {import('@playwright/test').Locator} stage - the picture, or Compare's pictures
	 * @return {Promise<boolean>}
	 */
	const clearCorner = (stage) => stage.evaluate((element) => {
		const box = element.getBoundingClientRect()
		return element.contains(document.elementFromPoint(box.right - 20, box.top + 20))
	})

	test('back, name, Version, Approval and Share stand in one row upright and sideways, and fullscreen or writing sideways hide it (#285)', async () => {
		const phone = await browser.newContext({ baseURL: BROWSER_URL, ...PHONE, viewport: { width: 393, height: 852 } })
		const page = await phone.newPage()
		await login(page)
		await page.goto(`/apps/deliver/versions/${versions[0].id}`)
		await expect(page.locator('video.deliver-player__video')).toHaveJSProperty('readyState', 4)
		const share = page.getByRole('button', { name: 'Share', exact: true })
		await expect(page.locator('.deliver-layout__bar .deliver-due')).toBeVisible()
		const buttons = [
			page.getByRole('link', { name: /^Back to/ }),
			page.getByRole('button', { name: 'Approve', exact: true }),
			page.locator('.deliver-layout__bar .deliver-version-picker button'),
			share,
			page.getByRole('button', { name: 'More', exact: true }),
		]
		for (const [width, height] of [[393, 852], [375, 667], [852, 393], [932, 430], [640, 360]]) {
			await page.setViewportSize({ width, height })
			const sideways = width > height
			await expect(page.locator(sideways ? '.deliver-layout--sideways' : '.deliver-layout--upright')).toHaveCount(1)
			// Sideways the list beside the picture opens from the bar, not from a button over the picture
			await oneRow(page, sideways ? [...buttons, page.getByRole('button', { name: 'Show Comments' })] : buttons, sideways ? 44 : 56)
			expect(await clearCorner(page.locator('.deliver-player__stage'))).toBe(true)
		}
		// Upright on the smallest, the long name gives way to the buttons
		await page.setViewportSize({ width: 375, height: 667 })
		await expect(page.locator('.deliver-layout--upright')).toHaveCount(1)
		expect(await page.locator('.deliver-review__title').evaluate((title) => title.scrollWidth > title.clientWidth)).toBe(true)
		await share.tap()
		const links = page.getByRole('dialog', { name: /^Review Links on/ })
		await expect(links).toBeVisible()
		await page.keyboard.press('Escape')
		await expect(links).toBeHidden()

		// Sideways, Share opens the links as well
		await page.setViewportSize({ width: 852, height: 393 })
		await expect(page.locator('.deliver-layout--sideways')).toHaveCount(1)
		await share.tap()
		await expect(links).toBeVisible()
		await page.keyboard.press('Escape')
		await expect(links).toBeHidden()
		// Writing, the keyboard takes the room: the bar steps aside with the list, and comes back after
		await page.getByRole('button', { name: 'Show Comments' }).tap()
		await page.locator('#deliver-comment-body').tap()
		await expect(page.locator('.deliver-layout__bar')).toBeHidden()
		await page.locator('#deliver-comment-body').blur()
		await expect(page.locator('.deliver-layout__bar')).toBeVisible()
		// Fullscreen covers it
		await page.getByRole('button', { name: 'Hide Comments' }).tap()
		await page.getByRole('button', { name: 'Fullscreen', exact: true }).tap()
		await expect(page.locator('.deliver-player--fullscreen')).toHaveCount(1)
		await expect.poll(() => reachable(share)).toBe(false)
		await page.getByRole('button', { name: 'Leave fullscreen' }).tap()
		await expect(page.locator('.deliver-player--fullscreen')).toHaveCount(0)
		await expect.poll(() => reachable(share)).toBe(true)
		await phone.close()
	})

	test('a Reviewer\'s link and Compare keep their bar sideways, with the Comments button in it (#285)', async () => {
		const guest = await browser.newContext({ baseURL: BROWSER_URL, ...PHONE, viewport: { width: 852, height: 393 } })
		const reviewer = await guest.newPage()
		await reviewer.goto(`/apps/deliver/s/${token}/versions/${versions[0].id}`)
		await expect(reviewer.locator('video.deliver-player__video')).toHaveJSProperty('readyState', 4)
		await expect(reviewer.locator('.deliver-layout__bar .deliver-due')).toBeVisible()
		// Only to read: no pointer over it
		await expect(reviewer.locator('.deliver-layout__bar span.deliver-due__button')).toHaveCSS('cursor', 'default')
		await oneRow(reviewer, [reviewer.locator('.deliver-layout__bar .deliver-version-picker').first(), reviewer.getByRole('button', { name: 'Show Comments' })], 44)
		expect(await clearCorner(reviewer.locator('.deliver-player__stage'))).toBe(true)
		await guest.close()

		const phone = await browser.newContext({ baseURL: BROWSER_URL, ...PHONE, viewport: { width: 852, height: 393 } })
		const page = await phone.newPage()
		await login(page)
		await page.goto(`/apps/deliver/compare/${versions[1].id}/${versions[0].id}`)
		await expect(page.locator('.deliver-compare video').first()).toHaveJSProperty('readyState', 4)
		for (const [width, height] of [[852, 393], [932, 430], [640, 360]]) {
			await page.setViewportSize({ width, height })
			await oneRow(page, [page.getByRole('link', { name: 'Back to the Review' }), page.getByRole('radio').first(), page.getByRole('button', { name: 'Show Comments' })], 44)
			expect(await clearCorner(page.locator('.deliver-compare__stage'))).toBe(true)
		}
		await page.getByRole('link', { name: 'Back to the Review' }).tap()
		await expect(page).toHaveURL(new RegExp(`/versions/${versions[0].id}$`))
		await phone.close()
	})
})

test.describe('Menus on a phone', () => {
	let browser
	let folder
	let projectId
	/** Longer than any row or card shows whole */
	const NAME = 'the-final-mix-of-the-trailer-for-the-festival-in-autumn-with-its-very-long-title.webm'
	const UPRIGHT = { width: 393, height: 852 }
	const SIDEWAYS = { width: 852, height: 393 }

	test.beforeAll(async ({ playwright }) => {
		await testUser(playwright)
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		folder = 'deliver-e2e-' + randomBytes(4).toString('hex')
		const dav = `/remote.php/dav/files/${USER}/${folder}`
		expect((await api.fetch(dav, { method: 'MKCOL' })).status()).toBe(201)
		for (const name of [NAME, 'other.webm']) {
			expect((await api.fetch(`${dav}/${name}`, { method: 'PUT', data: readFileSync(CLIP) })).status()).toBe(201)
		}
		const created = await api.post('/ocs/v2.php/apps/deliver/api/v1/projects?format=json', { data: { folderId: await fileId(api, dav), autoIntake: true } })
		projectId = (await created.json()).ocs.data.id
		const assets = async () => (await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)).json()).ocs.data.assets
		// Ready, so that the menus offer what they offer for a ready video
		await expect.poll(async () => (await assets()).filter((asset) => asset.versions[0].state === 'ready' && !asset.versions[0].processing).length, { timeout: 30000 }).toBe(2)
		const long = (await assets()).find((asset) => asset.versions[0].name === NAME)
		expect((await api.post(`/ocs/v2.php/apps/deliver/api/v1/versions/${long.versions[0].id}/comments?format=json`, { data: { inFrame: 1, body: 'one' } })).ok()).toBe(true)
		await api.dispose()
		browser = await chromium.connectOverCDP(CDP)
	})

	test.afterAll(async ({ playwright }) => {
		await browser?.close()
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		await api.delete(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)
		await api.fetch(`/remote.php/dav/files/${USER}/${folder}`, { method: 'DELETE' })
		await api.dispose()
	})

	/**
	 * @param {import('@playwright/test').Locator} menu - a menu or a sheet
	 * @return {Promise<string[]>} the labels of its entries, in their order
	 */
	const labels = (menu) => menu.getByRole('menuitem').evaluateAll((items) => items.map((item) => item.textContent.trim()))

	/**
	 * @param {import('@playwright/test').Page} page - any page
	 * @return {import('@playwright/test').Locator} the sheet the long name's menu opens in
	 */
	const sheetOf = (page) => page.getByRole('dialog', { name: NAME })

	/** The entries of the long name's menu on a desktop, read once */
	let onDesktop = null

	/**
	 * @return {Promise<string[]>} what a desktop's menu of the long name offers
	 */
	async function desktopLabels() {
		if (!onDesktop) {
			const desktop = await browser.newContext({ baseURL: BROWSER_URL, viewport: { width: 1280, height: 800 } })
			const page = await desktop.newPage()
			await login(page)
			await page.goto(`/apps/deliver/projects/${projectId}`)
			await page.getByRole('button', { name: /^Actions for the-final-mix/ }).click()
			onDesktop = await labels(page.getByRole('menu'))
			await desktop.close()
		}
		return onDesktop
	}

	/**
	 * A finger strokes down from the middle of an element, as Playwright has no swipe
	 *
	 * @param {import('@playwright/test').Page} page - the page
	 * @param {import('@playwright/test').Locator} from - where the finger comes down
	 * @param {number} by - how far, in pixels
	 */
	async function strokeDown(page, from, by) {
		const box = await from.boundingBox()
		const [x, y] = [box.x + box.width / 2, box.y + box.height / 2]
		const touch = await page.context().newCDPSession(page)
		await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
		for (let step = 1; step <= 5; step++) {
			await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + by * step / 5 }] })
		}
		await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
		await touch.detach()
	}

	test('on a desktop the menu stays a menu, and the click outside that closes it only closes it', async () => {
		const desktop = await browser.newContext({ baseURL: BROWSER_URL, viewport: { width: 1280, height: 800 } })
		const page = await desktop.newPage()
		await login(page)
		await page.goto(`/apps/deliver/projects/${projectId}`)
		const more = page.getByRole('button', { name: /^Actions for the-final-mix/ })
		await more.click()
		const menu = page.getByRole('menu')
		await expect(menu).toHaveClass(/deliver-context-menu/)
		await expect(page.getByRole('dialog')).toHaveCount(0)
		expect(await labels(menu)).toEqual(['Open', 'Upload a new Version', 'Add Captions…', 'Set a Due Date', 'Manage Versions', 'Move to Project…', 'Download', 'Rename…', 'Show in Files', 'Remove from Project', 'Delete'])
		// A click on the other row closes the menu and neither ticks nor opens the row (#298)
		await card(page, 'other').locator('.deliver-card__name').click()
		await expect(menu).toHaveCount(0)
		await expect(page.locator('.deliver-card--selected')).toHaveCount(0)
		// A second click on ⋯ closes the menu rather than opening it again
		await more.click()
		await expect(menu).toBeVisible()
		await more.click()
		await expect(menu).toHaveCount(0)
		await page.waitForTimeout(300)
		await expect(menu).toHaveCount(0)
		await desktop.close()
	})

	for (const viewport of [UPRIGHT, SIDEWAYS]) {
		test(`on a phone ${viewport === UPRIGHT ? 'upright' : 'sideways'} the ⋯ menu of a row opens as a sheet, and a tap on the strip or on ⋯ only closes it`, async () => {
			const phone = await browser.newContext({ baseURL: BROWSER_URL, ...PHONE, viewport })
			const page = await phone.newPage()
			await login(page)
			await page.goto(`/apps/deliver/projects/${projectId}`)
			const url = page.url()
			const more = page.getByRole('button', { name: /^Actions for the-final-mix/ })
			await more.tap()
			const sheet = sheetOf(page)
			await expect(sheet).toBeVisible()
			// The whole name, the Comment on the still, and the Version
			const name = sheet.locator('.deliver-menu-sheet__name')
			await expect(name).toHaveText(NAME)
			expect(await name.evaluate((element) => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight)).toBe(true)
			await expect(sheet.locator('.deliver-menu-sheet__still')).toContainText('1')
			await expect(sheet.locator('.deliver-menu-sheet__line')).toContainText('V1')
			// The same entries as on a desktop, in groups, Delete last in red
			expect(await labels(sheet)).toEqual(await desktopLabels())
			expect(await sheet.getByRole('group').count()).toBeGreaterThan(2)
			const remove = sheet.getByRole('menuitem', { name: 'Delete', exact: true })
			expect(await remove.evaluate((element) => getComputedStyle(element).color)).toBe(await page.evaluate(() => {
				const probe = document.createElement('span')
				probe.style.color = 'var(--color-error-text)'
				document.body.append(probe)
				const color = getComputedStyle(probe).color
				probe.remove()
				return color
			}))
			// A strip of the page stays above it; on a phone held sideways the sheet scrolls to its last entry
			const panel = await sheet.boundingBox()
			expect(panel.y).toBeGreaterThanOrEqual(40)
			expect(panel.y + panel.height).toBeCloseTo(viewport.height, 0)
			await remove.scrollIntoViewIfNeeded()
			await expect(remove).toBeInViewport()

			// A tap on the strip, over the other row, closes the sheet and opens nothing (#298)
			const other = await card(page, 'other').boundingBox()
			const y = Math.min(other.y + other.height / 2, panel.y / 2)
			await page.touchscreen.tap(viewport.width / 2, y)
			await expect(sheet).toHaveCount(0)
			await page.waitForTimeout(300)
			expect(page.url()).toBe(url)

			// A second tap on ⋯ closes it and does not open it again (#298)
			await more.tap()
			await expect(sheet).toBeVisible()
			const button = await more.boundingBox()
			await page.touchscreen.tap(button.x + button.width / 2, button.y + button.height / 2)
			await expect(sheet).toHaveCount(0)
			await page.waitForTimeout(300)
			await expect(sheet).toHaveCount(0)
			expect(page.url()).toBe(url)
			await phone.close()
		})
	}

	test('on a phone the sheet closes by Escape and a stroke down, keeps the focus inside, and its entries work', async () => {
		const phone = await browser.newContext({ baseURL: BROWSER_URL, ...PHONE, viewport: UPRIGHT })
		const page = await phone.newPage()
		await login(page)
		await page.goto(`/apps/deliver/projects/${projectId}`)
		const url = page.url()
		const more = page.getByRole('button', { name: /^Actions for the-final-mix/ })
		const sheet = sheetOf(page)

		await more.tap()
		await expect(sheet).toBeFocused()
		// Tab walks the entries and stays in the sheet
		const count = await sheet.getByRole('menuitem').count()
		for (let step = 0; step <= count; step++) {
			await page.keyboard.press('Tab')
		}
		expect(await sheet.evaluate((element) => element.contains(document.activeElement))).toBe(true)
		await page.keyboard.press('Escape')
		await expect(sheet).toHaveCount(0)
		await expect(more).toBeFocused()

		// A short stroke lets it spring back, a long one closes it
		await more.tap()
		await strokeDown(page, sheet.locator('.deliver-menu-sheet__name'), 20)
		await expect(sheet).toBeVisible()
		await strokeDown(page, sheet.locator('.deliver-menu-sheet__name'), 200)
		await expect(sheet).toHaveCount(0)
		expect(page.url()).toBe(url)

		// An entry does what it does on a desktop
		await more.tap()
		await sheet.getByRole('menuitem', { name: 'Rename…' }).tap()
		await expect(sheet).toHaveCount(0)
		const rename = page.getByRole('dialog', { name: 'Rename file' })
		await expect(rename.getByRole('textbox')).toBeFocused()
		await page.goto(`/apps/deliver/projects/${projectId}`)

		// Cards open the same sheet
		await page.getByRole('button', { name: 'Show the Assets as a list' }).tap()
		await expect(page.locator('.deliver-card--row')).toHaveCount(0)
		await more.tap()
		await expect(sheet).toBeVisible()
		await expect(sheet.locator('.deliver-menu-sheet__name')).toHaveText(NAME)
		await page.keyboard.press('Escape')
		await page.getByRole('button', { name: 'Show the Assets as a list' }).tap()
		await phone.close()
	})

	test('on a phone a Project\'s menu opens as a sheet with its icon and its Assets', async () => {
		const phone = await browser.newContext({ baseURL: BROWSER_URL, ...PHONE, viewport: UPRIGHT })
		const page = await phone.newPage()
		await login(page)
		await page.goto('/apps/deliver/')
		await page.getByRole('button', { name: `Actions for ${folder}` }).tap()
		const sheet = page.getByRole('dialog', { name: folder })
		await expect(sheet).toBeVisible()
		await expect(sheet.locator('.deliver-menu-sheet__still svg')).toBeVisible()
		await expect(sheet.locator('.deliver-menu-sheet__line')).toContainText('2 Assets')
		await expect(sheet.getByRole('menuitem', { name: 'Open', exact: true })).toBeVisible()
		const box = await sheet.boundingBox()
		await page.touchscreen.tap(UPRIGHT.width / 2, box.y / 2)
		await expect(sheet).toHaveCount(0)
		await expect(page).toHaveURL(/\/apps\/deliver\/?$/)
		await phone.close()
	})
})

test.describe('Audio review', () => {
	let browser
	let context
	let page
	let folder
	let versionId
	let clipVersionId
	let projectId

	test.beforeAll(async ({ playwright }) => {
		await testUser(playwright)
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		folder = 'deliver-e2e-' + randomBytes(4).toString('hex')
		const dav = `/remote.php/dav/files/${USER}/${folder}`
		expect((await api.fetch(dav, { method: 'MKCOL' })).status()).toBe(201)
		expect((await api.fetch(`${dav}/long-mix.webm`, { method: 'PUT', data: readFileSync(LONG_MIX) })).status()).toBe(201)
		// A video beside it, to step to from the Review view
		expect((await api.fetch(`${dav}/clip.webm`, { method: 'PUT', data: readFileSync(CLIP) })).status()).toBe(201)
		const created = await api.post('/ocs/v2.php/apps/deliver/api/v1/projects?format=json', {
			data: { folderId: await fileId(api, dav), autoIntake: true },
		})
		projectId = (await created.json()).ocs.data.id
		const project = await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)
		const assets = (await project.json()).ocs.data.assets
		versionId = assets.find((asset) => asset.name === 'long-mix').versions[0].id
		clipVersionId = assets.find((asset) => asset.name === 'clip').versions[0].id
		await api.dispose()
		// ffmpeg reads the mix and makes its Waveform
		execFileSync('docker', ['compose', 'exec', '-T', '-u', 'www-data', 'nextcloud', 'php', 'occ', 'deliver:worker', '--once'], { stdio: 'inherit' })

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

	test('a long audio Version opens zoomed, scrolls under its centred playhead and seeks without stopping', async () => {
		await page.goto(`/apps/deliver/versions/${versionId}`)
		const canvas = page.locator('.deliver-wave canvas')
		await expect(canvas).toBeVisible()
		const audio = page.locator('video.deliver-player__video')
		await expect(audio).toHaveJSProperty('readyState', 4)
		const time = () => audio.evaluate((element) => element.currentTime)
		// The playhead is the white line down the middle of the stage
		const centre = () => canvas.evaluate((element) => {
			const pixel = element.getContext('2d').getImageData(Math.round(element.width / 2) - 1, element.height - Math.round(44 * element.width / element.clientWidth), 1, 1).data
			return pixel[0] + pixel[1] + pixel[2]
		})

		// One minute of the six on the stage; on the bar under it the half after the start
		await expect(page.getByRole('button', { name: '1 min' })).toHaveAttribute('aria-pressed', 'true')
		await expect(page.getByRole('button', { name: '5 min' })).toBeVisible()
		const shown = page.locator('.deliver-player__window')
		const width = async () => parseFloat(await shown.evaluate((element) => element.style.width.match(/[\d.]+%/)[0]))
		expect(await width()).toBeCloseTo(30 / 360 * 100, 0)
		expect(await centre()).toBe(765)

		// Playing, the wave moves under the playhead, which stays in the middle
		const still = await canvas.evaluate((element) => element.toDataURL())
		await page.getByRole('button', { name: 'Play (Space)' }).click()
		await expect.poll(time).toBeGreaterThan(1)
		expect(await canvas.evaluate((element) => element.toDataURL())).not.toBe(still)
		expect(await centre()).toBe(765)
		await expect.poll(width).toBeGreaterThan(30 / 360 * 100 + 0.1)

		// A click in the strip, a quarter of the stage to the right, goes 15 seconds on and keeps playing
		const box = await canvas.boundingBox()
		const before = await time()
		await canvas.click({ position: { x: box.width * 0.75, y: box.height - 20 } })
		expect(await time() - before).toBeGreaterThan(14)
		expect(await time() - before).toBeLessThan(17)
		expect(await audio.evaluate((element) => element.paused)).toBe(false)

		// A zoom step narrows the window, and the whole shows all of it
		await page.getByRole('button', { name: '15 s' }).click()
		await expect(page.getByRole('button', { name: '15 s' })).toHaveAttribute('aria-pressed', 'true')
		expect(await width()).toBeCloseTo(15 / 360 * 100, 0)
		await page.getByRole('button', { name: 'Whole', exact: true }).click()
		expect(await width()).toBe(100)
		// Over the whole piece the wave after the playhead is not drawn as played
		const playedAfter = await canvas.evaluate((element) => {
			const probe = document.createElement('span')
			probe.style.color = 'var(--color-primary-element)'
			element.parentElement.append(probe)
			const primary = getComputedStyle(probe).color.match(/\d+/g).map(Number)
			probe.remove()
			const ratio = element.width / element.clientWidth
			const row = element.getContext('2d').getImageData(Math.round(element.width / 2), Math.round((40 + (element.clientHeight - 80) / 2) * ratio), Math.round(element.width / 2), 1).data
			let count = 0
			for (let at = 0; at < row.length; at += 4) {
				count += Math.max(...[0, 1, 2].map((channel) => Math.abs(row[at + channel] - primary[channel]))) < 8 ? 1 : 0
			}
			return count
		})
		expect(playedAfter).toBe(0)
		await page.getByRole('button', { name: 'Pause (Space)' }).click()
	})

	test('the bars keep their heights and move by whole pixels from one moment to another, on a stage of an odd width too', async () => {
		// An odd number of pixels across, where a playhead and window rounded apart trembled
		await page.setViewportSize({ width: 1281, height: 800 })
		await page.goto(`/apps/deliver/versions/${versionId}`)
		const canvas = page.locator('.deliver-wave canvas')
		await expect(canvas).toBeVisible()
		const audio = page.locator('video.deliver-player__video')
		await expect(audio).toHaveJSProperty('readyState', 4)
		await page.getByRole('button', { name: '1 min' }).click()
		// The coverage of each device-pixel column right of the playhead, where every bar is drawn alike
		const columns = async (seconds) => {
			// Once the audio stands there, and the stage has glided there and stands still
			await audio.evaluate((element, at) => new Promise((resolve) => {
				element.addEventListener('seeked', resolve, { once: true })
				element.currentTime = at
			}), seconds)
			await canvas.evaluate((element) => new Promise((resolve) => {
				let before = ''
				const frame = () => {
					const now = element.toDataURL()
					if (now === before) {
						resolve()
					} else {
						before = now
						setTimeout(() => requestAnimationFrame(frame), 50)
					}
				}
				requestAnimationFrame(frame)
			}))
			return canvas.evaluate((element) => {
				const ratio = element.width / element.clientWidth
				const top = Math.round(40 * ratio)
				const bottom = element.height - Math.round(40 * ratio)
				const data = element.getContext('2d').getImageData(0, top, element.width, bottom - top).data
				return Array.from({ length: element.width }, (_, x) => {
					let sum = 0
					for (let y = 0; y < bottom - top; y++) {
						sum += data[(y * element.width + x) * 4 + 3]
					}
					return sum
				})
			})
		}
		const before = await columns(100)
		const after = await columns(103.3)
		const width = before.length
		// 3.3 s at a minute across is 5.5 % of the stage; the best whole shift explains every column exactly
		let best = { shift: 0, difference: Infinity }
		for (let shift = 0; shift <= width / 10; shift++) {
			let difference = 0
			for (let x = Math.round(width * 0.6) + shift; x < width - 2; x++) {
				difference += Math.abs(before[x] - after[x - shift])
			}
			if (difference < best.difference) {
				best = { shift, difference }
			}
		}
		expect(best.difference).toBe(0)
		expect(Math.abs(best.shift - width * 3.3 / 60)).toBeLessThanOrEqual(1)
		await page.setViewportSize({ width: 1280, height: 720 })
	})

	test('after a click in the strip the wave glides to the new place within half a second, and jumps under reduced motion', async () => {
		await page.goto(`/apps/deliver/versions/${versionId}`)
		const canvas = page.locator('.deliver-wave canvas')
		await expect(canvas).toBeVisible()
		const audio = page.locator('video.deliver-player__video')
		await expect(audio).toHaveJSProperty('readyState', 4)
		await page.getByRole('button', { name: '1 min' }).click()
		await audio.evaluate((element) => {
			element.currentTime = 100
		})
		await expect.poll(() => canvas.evaluate((element) => element.drawnAt)).toBeCloseTo(100.0005, 2)
		const box = await canvas.boundingBox()
		// The seconds drawn, on every frame for 0.7 s: cheap to record, analysed afterwards
		const record = () => canvas.evaluate((element) => new Promise((resolve) => {
			const samples = []
			const start = performance.now()
			const frame = () => {
				samples.push({ at: performance.now() - start, drawn: element.drawnAt })
				if (performance.now() - start < 700) {
					requestAnimationFrame(frame)
				} else {
					resolve(samples)
				}
			}
			requestAnimationFrame(frame)
		}))
		const quarterOn = { position: { x: box.width * 0.75, y: box.height - 20 } }

		let recording = record()
		await canvas.click(quarterOn)
		let samples = await recording
		const target = await audio.evaluate((element) => element.currentTime)
		expect(target).toBeCloseTo(115, 0)
		expect(samples.at(-1).drawn).toBeCloseTo(target, 2)
		// On the way, somewhere strictly between, and there within half a second of setting off
		expect(samples.some((each) => each.drawn > 100.5 && each.drawn < target - 0.5)).toBe(true)
		const moved = samples.find((each) => each.drawn > 100.01)
		const arrived = samples.find((each) => Math.abs(each.drawn - target) < 0.01)
		expect(arrived.at - moved.at).toBeLessThan(500)

		// With reduced motion it is there at once
		await page.emulateMedia({ reducedMotion: 'reduce' })
		recording = record()
		await canvas.click(quarterOn)
		samples = await recording
		expect(samples.every((each) => Math.abs(each.drawn - target) < 0.01 || Math.abs(each.drawn - (target + 15)) < 0.01)).toBe(true)
		await page.emulateMedia({ reducedMotion: null })
	})

	test('the wave follows a swipe at once, never falls a glide behind a held key, and a click during a glide lands where the pointer is', async () => {
		await page.goto(`/apps/deliver/versions/${versionId}`)
		const canvas = page.locator('.deliver-wave canvas')
		await expect(canvas).toBeVisible()
		const audio = page.locator('video.deliver-player__video')
		await expect(audio).toHaveJSProperty('readyState', 4)
		await page.getByRole('button', { name: '1 min' }).click()
		const goTo = async (seconds) => {
			await audio.evaluate((element, at) => {
				element.currentTime = at
			}, seconds)
			await expect.poll(() => canvas.evaluate((element) => element.drawnAt)).toBeCloseTo(seconds + 0.0005, 2)
		}

		// A trackpad's sideways swipe sends a wheel event on every frame: the wave stays with the sound
		await goTo(100)
		const swipe = await canvas.evaluate((element) => new Promise((resolve) => {
			const audio = document.querySelector('video.deliver-player__video')
			const gaps = []
			let count = 0
			const frame = () => {
				gaps.push(Math.abs(element.drawnAt - audio.currentTime))
				if (count++ < 50) {
					element.dispatchEvent(new WheelEvent('wheel', { deltaX: 6, bubbles: true, cancelable: true }))
					requestAnimationFrame(frame)
				} else {
					resolve({ gaps, end: audio.currentTime })
				}
			}
			requestAnimationFrame(frame)
		}))
		expect(swipe.end).toBeGreaterThan(110)
		// One wheel event is 6 px of 840: less than half a second
		expect(Math.max(...swipe.gaps)).toBeLessThan(1)

		// Shift+→ held: the wave is never behind where the sound was a glide (and a frame) earlier
		await goTo(100)
		const watching = canvas.evaluate((element) => new Promise((resolve) => {
			const audio = document.querySelector('video.deliver-player__video')
			const samples = []
			const start = performance.now()
			const frame = () => {
				samples.push({ at: performance.now() - start, drawn: element.drawnAt, sound: audio.currentTime })
				if (performance.now() - start < 1200) {
					requestAnimationFrame(frame)
				} else {
					resolve(samples)
				}
			}
			requestAnimationFrame(frame)
		}))
		await page.locator('.deliver-review__title').click()
		await page.keyboard.down('Shift')
		for (let repeat = 0; repeat < 15; repeat++) {
			await page.keyboard.press('ArrowRight')
			await page.waitForTimeout(33)
		}
		await page.keyboard.up('Shift')
		const held = await watching
		const soundAt = (time) => [...held].reverse().find((each) => each.at <= time)?.sound ?? 100
		for (const each of held) {
			expect(each.drawn).toBeGreaterThanOrEqual(soundAt(each.at - 250) - 0.01)
		}
		expect(held.at(-1).drawn).toBeCloseTo(held.at(-1).sound, 2)

		// A click in the strip 40 px right of the playhead while a glide runs goes to what is drawn under it, not beside it
		await goTo(100)
		const box = await canvas.boundingBox()
		// Two clicks in the page itself, two frames apart, so the second surely comes while the first one's glide runs
		const { drawn, landed } = await canvas.evaluate((element) => new Promise((resolve) => {
			const audio = document.querySelector('video.deliver-player__video')
			const box = element.getBoundingClientRect()
			const click = (x) => {
				const at = { clientX: box.left + x, clientY: box.bottom - 20, pointerId: 7, pointerType: 'mouse', button: 0, bubbles: true }
				element.dispatchEvent(new PointerEvent('pointerdown', at))
				element.dispatchEvent(new PointerEvent('pointerup', at))
			}
			click(box.width * 0.75)
			requestAnimationFrame(() => requestAnimationFrame(() => {
				const drawn = element.drawnAt
				click(box.width / 2 + 40)
				resolve({ drawn, landed: audio.currentTime })
			}))
		}))
		expect(drawn).toBeLessThan(114.5)
		expect(Math.abs(landed - (drawn + 40 / box.width * 60))).toBeLessThan(0.4)
	})

	test('dragging the bar under the stage moves the wave live and leaves it where the playhead is, with reduced motion too', async () => {
		await page.emulateMedia({ reducedMotion: 'reduce' })
		await page.goto(`/apps/deliver/versions/${versionId}`)
		const canvas = page.locator('.deliver-wave canvas')
		await expect(canvas).toBeVisible()
		const audio = page.locator('video.deliver-player__video')
		await expect(audio).toHaveJSProperty('readyState', 4)
		await page.getByRole('button', { name: '1 min' }).click()
		const wave = () => canvas.evaluate((element) => element.toDataURL())
		const bar = await page.locator('.deliver-player__timeline').boundingBox()
		const y = bar.y + bar.height / 2
		await page.mouse.move(bar.x + bar.width * 0.1, y)
		const start = await wave()
		await page.mouse.down()
		await page.mouse.move(bar.x + bar.width * 0.5, y, { steps: 8 })
		await expect.poll(() => audio.evaluate((element) => element.currentTime)).toBeGreaterThan(170)
		// The wave moved with the pointer before release
		await expect.poll(wave).not.toBe(start)
		await page.mouse.move(bar.x + bar.width * 0.9, y, { steps: 12 })
		await page.mouse.up()
		await page.waitForTimeout(500)
		// Drawn from the time the element is at: a fresh draw changes nothing
		const settled = await wave()
		await page.getByRole('button', { name: '15 s' }).click()
		await page.getByRole('button', { name: '1 min' }).click()
		await page.waitForTimeout(300)
		expect(await wave()).toBe(settled)
		// A seek that changes no prop of the stage (the last of a drag lands so, while the drag holds timeupdate
		// back) still draws the wave again: here timeupdate is stopped on its way to the player. Once it has
		// settled, whatever else redraws is let go of, and the wave must draw within two animation frames
		const drawn = await audio.evaluate((element) => new Promise((resolve) => {
			window.addEventListener('timeupdate', (event) => event.stopPropagation(), true)
			const clear = CanvasRenderingContext2D.prototype.clearRect
			let draws = 0
			CanvasRenderingContext2D.prototype.clearRect = function(...args) {
				draws++
				return clear.apply(this, args)
			}
			element.addEventListener('seeked', () => {
				draws = 0
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(draws)))
			}, { once: true })
			element.currentTime -= 20
		}))
		expect(drawn).toBeGreaterThan(0)
		await page.emulateMedia({ reducedMotion: 'no-preference' })
	})

	test('a drag on the wave holds playback and lets it go on, but not past the end; Ctrl and the wheel zoom within the steps, remembered', async () => {
		await page.goto(`/apps/deliver/versions/${versionId}`)
		const canvas = page.locator('.deliver-wave canvas')
		await expect(canvas).toBeVisible()
		const audio = page.locator('video.deliver-player__video')
		await expect(audio).toHaveJSProperty('readyState', 4)
		const state = () => audio.evaluate((element) => ({ time: element.currentTime, paused: element.paused }))
		const shown = page.locator('.deliver-player__window')
		const width = async () => parseFloat(await shown.evaluate((element) => element.style.width.match(/[\d.]+%/)[0]))
		await page.getByRole('button', { name: '1 min' }).click()

		// A quarter of the stage dragged to the left is 15 seconds on; playback holds meanwhile and goes on
		const box = await canvas.boundingBox()
		const y = box.y + box.height / 2
		await page.getByRole('button', { name: 'Play (Space)' }).click()
		await expect.poll(async () => (await state()).time).toBeGreaterThan(1)
		const before = (await state()).time
		await page.mouse.move(box.x + box.width * 0.75, y)
		await page.mouse.down()
		for (let step = 1; step <= 10; step++) {
			await page.mouse.move(box.x + box.width * (0.75 - step * 0.025), y)
		}
		expect((await state()).paused).toBe(true)
		await page.mouse.up()
		const after = await state()
		expect(after.paused).toBe(false)
		expect(after.time - before).toBeGreaterThan(14)
		expect(after.time - before).toBeLessThan(17)

		// Dragged past the end it stays there, paused, as at the natural end, and does not start over
		await page.getByRole('button', { name: 'Whole', exact: true }).click()
		await page.mouse.move(box.x + box.width / 2, y)
		await page.mouse.down()
		await page.mouse.move(box.x + box.width * 0.8, y)
		await page.mouse.move(box.x + box.width + 50, y)
		await page.mouse.up()
		await page.waitForTimeout(500)
		const end = await state()
		expect(end.paused).toBe(true)
		expect(end.time).toBeGreaterThan(359)

		// Ctrl and the wheel zoom in down to 15 seconds and out up to the whole, and a reload keeps it
		await page.getByRole('button', { name: '1 min' }).click()
		await audio.evaluate((element) => {
			element.currentTime = 180
		})
		await page.mouse.move(box.x + box.width / 2, y)
		await page.keyboard.down('Control')
		for (let notch = 0; notch < 5; notch++) {
			await page.mouse.wheel(0, -100)
		}
		await expect(page.getByRole('button', { name: '15 s' })).toHaveAttribute('aria-pressed', 'true')
		expect(await width()).toBeCloseTo(15 / 360 * 100, 0)
		for (let notch = 0; notch < 12; notch++) {
			await page.mouse.wheel(0, 100)
		}
		await page.keyboard.up('Control')
		await expect(page.getByRole('button', { name: 'Whole', exact: true })).toHaveAttribute('aria-pressed', 'true')
		await page.reload()
		await expect(page.getByRole('button', { name: 'Whole', exact: true })).toHaveAttribute('aria-pressed', 'true')
		await page.getByRole('button', { name: '1 min' }).click()
	})

	test('C comments on the wave, an empty field lets go of the place, and a circle opens a small card whose Reply answers in the list', async () => {
		await page.goto(`/apps/deliver/versions/${versionId}`)
		const canvas = page.locator('.deliver-wave canvas')
		await expect(canvas).toBeVisible()
		const audio = page.locator('video.deliver-player__video')
		await expect(audio).toHaveJSProperty('readyState', 4)
		await page.getByRole('button', { name: '1 min' }).click()
		const box = await canvas.boundingBox()
		const field = page.locator('#deliver-comment-body')
		const anchor = page.locator('.deliver-comments__anchor')
		// A seek, and the wave glided there: clicks land on what is drawn
		const goTo = async (seconds) => {
			await audio.evaluate((element, at) => {
				element.currentTime = at
			}, seconds)
			await expect.poll(() => canvas.evaluate((element) => element.drawnAt)).toBeCloseTo(seconds + 0.0005, 2)
		}
		const send = () => page.locator('.deliver-comments__form button[title="Send (Enter)"]').click()
		const quarterOn = { position: { x: box.width * 0.75, y: box.height - 20 } }

		// A click in the strip a quarter of the stage on seeks 15 seconds on, and C comments there
		await commentOnQuarter(page, canvas, quarterOn)
		await expect(field).toBeFocused()
		await expect(anchor).toHaveText('0:15.000')
		// Escape in the empty field lets go of it: the next Comment follows the player again
		await field.press('Escape')
		await goTo(40)
		await expect(anchor).toHaveText('0:40.000')
		// With a word in the field the place stays, until the field is emptied
		await commentOnQuarter(page, canvas, quarterOn)
		await expect(anchor).toHaveText('0:55.000')
		await field.fill('kept')
		await field.press('Escape')
		await goTo(100)
		await expect(anchor).toHaveText('0:55.000')
		await field.fill('')
		await expect(anchor).toHaveText('1:40.000')
		// A click in the strip, which seeks, lets go too
		await commentOnQuarter(page, canvas, quarterOn)
		await expect(anchor).toHaveText('1:55.000')
		// Once the wave has glided there: a click lands on what is drawn under it
		await expect.poll(() => canvas.evaluate((element) => Math.abs(element.drawnAt - document.querySelector('video.deliver-player__video').currentTime))).toBeLessThan(0.01)
		await canvas.click({ position: { x: box.width * 0.25, y: box.height - 20 } })
		await expect(anchor).toHaveText('1:40.000')
		await expect.poll(() => canvas.evaluate((element) => Math.abs(element.drawnAt - document.querySelector('video.deliver-player__video').currentTime))).toBeLessThan(0.01)

		await commentOnQuarter(page, canvas, quarterOn)
		await expect(anchor).toHaveText('1:55.000')
		await field.fill('clicked here')
		await send()
		await expect(page.locator('.deliver-comment').filter({ hasText: 'clicked here' })).toBeVisible()

		// C on audio stops it, as on video, the Comment where it was at the key press
		await page.getByRole('button', { name: 'Play (Space)' }).click()
		await expect.poll(() => audio.evaluate((element) => element.currentTime)).toBeGreaterThan(117)
		await page.locator('.deliver-review__title').click()
		await page.keyboard.press('c')
		await expect(field).toBeFocused()
		await page.waitForTimeout(500)
		expect(await audio.evaluate((element) => element.paused)).toBe(true)
		// The Frame of the key press: where the element stopped, to the millisecond
		const stopped = await audio.evaluate((element) => Math.round(element.currentTime * 1000))
		const clockOf = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms % 60000 / 1000)).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`
		// The Frame's own time may differ from the element's by the last millisecond
		await expect(anchor).toHaveText(new RegExp(`^(${clockOf(stopped - 1)}|${clockOf(stopped)}|${clockOf(stopped + 1)})$`))
		await field.fill('while it played')
		await send()
		await expect(page.locator('.deliver-comment').filter({ hasText: 'while it played' })).toBeVisible()

		// Standing on the first Comment, its circle is under the playhead; a click on it opens its card and does not seek
		await page.getByRole('button', { name: '15 s' }).click()
		const first = page.locator('.deliver-comments__list > .deliver-comment').filter({ hasText: 'clicked here' })
		const second = page.locator('.deliver-comments__list > .deliver-comment').filter({ hasText: 'while it played' })
		const openFirst = async () => {
			await first.locator('.deliver-comment__anchor').click()
			const at = await audio.evaluate((element) => element.currentTime)
			await canvas.click({ position: { x: box.width / 2, y: box.height - 20 } })
			expect(await audio.evaluate((element) => element.currentTime)).toBe(at)
		}
		await openFirst()
		const card = page.getByRole('dialog', { name: /^Comment #/ })
		await expect(card).toContainText('clicked here')
		await expect(first).toHaveClass(/deliver-comment--selected/)
		// Small: who, where, the text, and Reply; no thread and no field. It covers neither its circle nor the playhead over it
		await expect(card).toContainText('1:55.000')
		await expect(card.locator('textarea, .deliver-comment')).toHaveCount(0)
		const [over, stage] = await Promise.all([card.boundingBox(), canvas.boundingBox()])
		expect(over.width).toBeLessThanOrEqual(264)
		expect(over.height).toBeLessThan(120)
		expect(over.y + over.height).toBeLessThanOrEqual(stage.y + stage.height - 32)
		expect(over.x >= stage.x + stage.width / 2 + 1 || over.x + over.width <= stage.x + stage.width / 2 - 1).toBe(true)
		// A click anywhere else closes it, in the list too
		await second.locator('.deliver-comment__body').click()
		await expect(card).toHaveCount(0)
		await openFirst()
		await page.locator('.deliver-player__timeline').click({ position: { x: 4, y: 8 } })
		await expect(card).toHaveCount(0)
		// A Reply half written in the list waits for the next Reply on the card, which opens the list's field at that Comment
		await first.locator('.deliver-comment__link', { hasText: 'Reply' }).click()
		await first.getByPlaceholder('Write a Reply').fill('half')
		await first.getByRole('button', { name: 'Cancel' }).click()
		await openFirst()
		await card.getByRole('button', { name: 'Reply', exact: true }).click()
		await expect(card).toHaveCount(0)
		await expect(first.getByPlaceholder('Write a Reply')).toBeFocused()
		await expect(first.getByPlaceholder('Write a Reply')).toHaveValue('half')
		await first.getByPlaceholder('Write a Reply').fill('answered from the wave')
		await first.getByRole('button', { name: 'Reply', exact: true }).click()
		await expect(first.locator('.deliver-comment--reply')).toContainText('answered from the wave')
		// Its Replies are counted on the card; Escape closes it wherever the focus is
		await openFirst()
		await expect(card).toContainText('1 reply')
		await page.locator('.deliver-review__title').click()
		await page.keyboard.press('Escape')
		await expect(card).toHaveCount(0)
		// A double click on the wave whose first click closed the card skips nothing
		await openFirst()
		await expect(card).toBeVisible()
		const closing = await audio.evaluate((element) => element.currentTime)
		await canvas.dblclick({ position: { x: box.width * 0.95, y: box.height / 4 } })
		await expect(card).toHaveCount(0)
		// Its second click is a click of its own: it plays, from where it stood
		await expect.poll(() => audio.evaluate((element) => element.paused)).toBe(false)
		const after = await audio.evaluate((element) => element.currentTime)
		expect(after).toBeGreaterThanOrEqual(closing)
		expect(after).toBeLessThan(closing + 5)
		await audio.evaluate((element) => element.pause())
	})

	test('with the Comment list hidden, a Comment on audio is written at the Waveform and the list stays hidden', async () => {
		await page.goto(`/apps/deliver/versions/${versionId}`)
		const canvas = page.locator('.deliver-wave canvas')
		await expect(canvas).toBeVisible()
		const audio = page.locator('video.deliver-player__video')
		await expect(audio).toHaveJSProperty('readyState', 4)
		await page.getByRole('button', { name: '1 min' }).click()
		await audio.evaluate((element) => {
			element.currentTime = 200
		})
		await page.getByRole('button', { name: 'Hide Comments' }).click()
		const list = page.locator('.deliver-layout__panel')
		await expect(list).toBeHidden()
		const box = await canvas.boundingBox()
		const quarterOn = { position: { x: box.width * 0.75, y: box.height - 20 } }
		const popup = page.getByRole('dialog', { name: 'New Comment' })
		const field = popup.locator('#deliver-comment-body-inline')

		// A double click opens no field
		await canvas.dblclick({ position: { x: box.width * 0.75, y: box.height / 2 } })
		await expect(popup).toHaveCount(0)
		await canvas.dblclick(quarterOn)
		await expect(popup).toHaveCount(0)
		await audio.evaluate((element) => {
			element.currentTime = 200
		})
		await expect.poll(() => canvas.evaluate((element) => Math.abs(element.drawnAt - 200))).toBeLessThan(0.01)
		// C opens the field at the wave, at that Frame, instead of the list
		await commentOnQuarter(page, canvas, quarterOn)
		await expect(popup).toBeVisible()
		await expect(field).toBeFocused()
		await expect(popup.locator('.deliver-comments__anchor')).toHaveText('3:35.000')
		await field.fill('written at the wave')
		await field.press('Enter')
		await expect(popup).toHaveCount(0)
		await expect(list).toBeHidden()
		// Its circle stands under the playhead, which stands on its Frame
		await expect.poll(() => canvas.evaluate((element) => {
			const ratio = element.width / element.clientWidth
			const pixel = element.getContext('2d').getImageData(Math.round(element.width / 2) + Math.round(8 * ratio), element.height - Math.round(20 * ratio), 1, 1).data
			return pixel[3]
		})).toBeGreaterThan(0)

		// Escape on the empty field closes it and lets go of the place
		await commentOnQuarter(page, canvas, quarterOn)
		await expect(field).toBeFocused()
		await field.press('Escape')
		await expect(popup).toHaveCount(0)
		await audio.evaluate((element) => {
			element.currentTime = 250
		})

		// The draft is the list's: opening the list mid-sentence takes it there and closes the field at the wave
		await commentOnQuarter(page, canvas, quarterOn)
		await field.fill('half a thought')
		await page.getByRole('button', { name: 'Show Comments' }).click()
		await expect(popup).toHaveCount(0)
		await expect(page.locator('#deliver-comment-body')).toHaveValue('half a thought')
		await expect(page.locator('.deliver-comments__list')).toContainText('written at the wave')
		await expect(page.locator('.deliver-comments__anchor')).toHaveText('4:25.000')
		// Emptied, the field follows the player again
		await page.locator('#deliver-comment-body').fill('')
		await audio.evaluate((element) => {
			element.currentTime = 300
		})
		await expect(page.locator('.deliver-comments__anchor')).toHaveText('5:00.000')
	})

	test('the field at the Waveform keeps its place while empty, takes its own buttons, keeps text on an outside click, and never shows with a Comment card', async () => {
		await page.goto(`/apps/deliver/versions/${versionId}`)
		const canvas = page.locator('.deliver-wave canvas')
		await expect(canvas).toBeVisible()
		const audio = page.locator('video.deliver-player__video')
		await expect(audio).toHaveJSProperty('readyState', 4)
		await page.getByRole('button', { name: '1 min' }).click()
		// Standing on the Comment written at the wave before, 3:35
		await audio.evaluate((element) => {
			element.currentTime = 215
		})
		await expect.poll(() => canvas.evaluate((element) => Math.abs(element.drawnAt - document.querySelector('video.deliver-player__video').currentTime))).toBeLessThan(0.01)
		if (await page.getByRole('button', { name: 'Hide Comments' }).isVisible()) {
			await page.getByRole('button', { name: 'Hide Comments' }).click()
		}
		const box = await canvas.boundingBox()
		const quarterOn = { position: { x: box.width * 0.75, y: box.height - 20 } }
		const popup = page.getByRole('dialog', { name: 'New Comment' })
		const field = popup.locator('#deliver-comment-body-inline')
		const anchor = popup.locator('.deliver-comments__anchor')

		// Emptied again, it stays with its place, and keys go on into the field, not to the player
		await commentOnQuarter(page, canvas, quarterOn)
		await expect(anchor).toHaveText('3:50.000')
		await field.pressSequentially('ab')
		await field.press('Backspace')
		await field.press('Backspace')
		await expect(popup).toBeVisible()
		await expect(field).toBeFocused()
		await field.press('k')
		await expect(field).toHaveValue('k')
		expect(await audio.evaluate((element) => element.paused)).toBe(true)
		await field.fill('')

		// Its own buttons do not let go of an empty field: the paperclip opens the file dialog, the Range starts
		const chooser = page.waitForEvent('filechooser')
		await popup.getByRole('button', { name: 'Attach files' }).click()
		await (await chooser).setFiles([])
		await expect(popup).toBeVisible()
		await popup.getByRole('button', { name: 'Start a Range here' }).click()
		await expect(popup).toBeVisible()
		await expect(popup.getByRole('button', { name: 'End the Range here' })).toBeVisible()
		// Ending and clearing the Range keep the card and a place, with and without text
		await popup.getByRole('button', { name: 'End the Range here' }).click()
		await popup.getByRole('button', { name: 'Clear the Range' }).click()
		await expect(popup).toBeVisible()
		await expect(field).toBeFocused()
		await field.fill('about this stretch')
		await popup.getByRole('button', { name: 'Start a Range here' }).click()
		await popup.getByRole('button', { name: 'End the Range here' }).click()
		await popup.getByRole('button', { name: 'Clear the Range' }).click()
		await expect(popup).toBeVisible()
		await expect(field).toHaveValue('about this stretch')
		await field.fill('')
		// A file's ✕ goes away when clicked: the card stays, the focus goes back into the field
		const picking = page.waitForEvent('filechooser')
		await popup.getByRole('button', { name: 'Attach files' }).click()
		await (await picking).setFiles({ name: 'wrong.txt', mimeType: 'text/plain', buffer: Buffer.from('x') })
		await popup.getByRole('button', { name: 'Remove wrong.txt' }).click()
		await expect(popup).toBeVisible()
		await expect(field).toBeFocused()
		// As in Safari, where a clicked button takes no focus: the field is left for the page, and still the card stays
		await popup.getByRole('button', { name: 'Start a Range here' }).evaluate((button) => button.addEventListener('mousedown', (event) => {
			event.preventDefault()
			document.activeElement.blur()
		}))
		await popup.getByRole('button', { name: 'Start a Range here' }).click()
		await expect(popup).toBeVisible()
		await page.keyboard.press('Escape')
		await expect(popup).toHaveCount(0)

		// With text, a click outside leaves it open; emptied, the next one closes it
		await commentOnQuarter(page, canvas, quarterOn)
		await field.fill('kept')
		await page.locator('.deliver-review__title').click()
		await expect(popup).toBeVisible()
		await expect(field).toHaveValue('kept')
		await field.fill('')
		await page.locator('.deliver-review__title').click()
		await expect(popup).toHaveCount(0)

		// A Comment's card and the field never show at once
		await audio.evaluate((element) => {
			element.currentTime = 215
		})
		await expect.poll(() => canvas.evaluate((element) => Math.abs(element.drawnAt - document.querySelector('video.deliver-player__video').currentTime))).toBeLessThan(0.01)
		await commentOnQuarter(page, canvas, quarterOn)
		await expect(popup).toBeVisible()
		// 3:35 is a quarter of the stage left of the playhead now standing at 3:50, once the wave has glided there
		await expect.poll(() => canvas.evaluate((element) => Math.abs(element.drawnAt - document.querySelector('video.deliver-player__video').currentTime))).toBeLessThan(0.01)
		await canvas.click({ position: { x: box.width * 0.25, y: box.height - 20 } })
		const card = page.getByRole('dialog', { name: /^Comment #/ })
		await expect(card).toContainText('written at the wave')
		await expect(popup).toHaveCount(0)
		await commentOnQuarter(page, canvas, quarterOn)
		await expect(popup).toBeVisible()
		await expect(card).toHaveCount(0)
		await page.keyboard.press('Escape')
		await page.getByRole('button', { name: 'Show Comments' }).click()
	})

	test('under the list an empty pinned field lets go on a click elsewhere and on another Comment\'s Reply, but not on its own buttons', async () => {
		await page.goto(`/apps/deliver/versions/${versionId}`)
		const canvas = page.locator('.deliver-wave canvas')
		await expect(canvas).toBeVisible()
		const audio = page.locator('video.deliver-player__video')
		await expect(audio).toHaveJSProperty('readyState', 4)
		await page.getByRole('button', { name: '1 min' }).click()
		if (await page.getByRole('button', { name: 'Show Comments' }).isVisible()) {
			await page.getByRole('button', { name: 'Show Comments' }).click()
		}
		const anchor = page.locator('.deliver-comments__anchor')
		const goTo = async (seconds) => {
			await audio.evaluate((element, at) => {
				element.currentTime = at
			}, seconds)
			await expect(anchor).toHaveText(new RegExp(`^${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`))
		}
		await goTo(20)
		await page.keyboard.press('c')
		await expect(page.locator('#deliver-comment-body')).toBeFocused()
		// Its own paperclip keeps the place
		const picking = page.waitForEvent('filechooser')
		await page.locator('.deliver-comments__form').getByRole('button', { name: 'Attach files' }).click()
		await (await picking).setFiles([])
		await audio.evaluate((element) => {
			element.currentTime = 30
		})
		await expect(anchor).toHaveText(/^0:20/)
		// A click elsewhere lets go
		await page.locator('.deliver-review__title').click()
		await goTo(40)
		// So does a click into another Comment's Reply
		await page.keyboard.press('c')
		await expect(anchor).toHaveText(/^0:40/)
		await page.locator('.deliver-comments__list > .deliver-comment').first().getByRole('button', { name: 'Reply', exact: true }).click()
		await goTo(50)
	})

	test('a Comment half written stays with its Version: on the next Asset the field is empty and entering it stops the video', async () => {
		await page.goto(`/apps/deliver/versions/${versionId}`)
		await expect(page.locator('video.deliver-player__video')).toHaveJSProperty('readyState', 4)
		await page.locator('#deliver-comment-body').fill('left behind')
		const next = page.getByRole('button', { name: 'Next Asset' })
		await (await next.isEnabled() ? next : page.getByRole('button', { name: 'Previous Asset' })).click()
		await expect(page).toHaveURL(new RegExp(`/versions/${clipVersionId}$`))
		const video = page.locator('video.deliver-player__video')
		await expect(video).toHaveJSProperty('readyState', 4)
		const field = page.locator('#deliver-comment-body')
		await expect(field).toHaveValue('')
		await page.getByRole('button', { name: 'Play (Space)' }).click()
		await expect.poll(() => video.evaluate((element) => element.currentTime)).toBeGreaterThan(0.3)
		await field.pressSequentially('x')
		await expect.poll(() => video.evaluate((element) => element.paused)).toBe(true)
		await field.fill('')
	})

	test('entering the Comment field stops audio and video at the Frame of that moment, by mouse, on a phone without a key and as a Reviewer, and typing or drawing keeps that Frame', async ({ playwright }) => {
		await page.goto(`/apps/deliver/versions/${versionId}`)
		const audio = page.locator('video.deliver-player__video')
		await expect(audio).toHaveJSProperty('readyState', 4)
		const field = page.locator('#deliver-comment-body')
		const anchor = page.locator('.deliver-comments__anchor')
		const time = () => audio.evaluate((element) => element.currentTime)
		const paused = () => audio.evaluate((element) => element.paused)
		await page.getByRole('button', { name: 'Play (Space)' }).click()
		await expect.poll(time).toBeGreaterThan(1)
		await field.click()
		await expect.poll(paused).toBe(true)
		// The Frame where the element stopped, to the millisecond, give or take the last one
		const stopped = Math.round(await time() * 1000)
		const clockOf = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms % 60000 / 1000)).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`
		await expect(anchor).toHaveText(new RegExp(`^(${clockOf(stopped - 1)}|${clockOf(stopped)}|${clockOf(stopped + 1)})$`))
		const at = await anchor.textContent()
		// Played on with the field open, typing stops it again, and the Comment stays where the field was entered
		await audio.evaluate((element) => element.play())
		await expect.poll(time).toBeGreaterThan(stopped / 1000 + 0.3)
		await field.pressSequentially('here')
		await expect.poll(paused).toBe(true)
		await expect(anchor).toHaveText(at)
		await field.fill('')
		await page.locator('.deliver-review__title').click()

		// A Drawing keeps the Frame where the field was entered, its first stroke and a seek after it too
		await page.goto(`/apps/deliver/versions/${clipVersionId}`)
		const video = page.locator('video.deliver-player__video')
		await expect(video).toHaveJSProperty('readyState', 4)
		await video.evaluate((element) => {
			element.currentTime = 1
		})
		await expect(page.locator('.deliver-player__timecode')).toContainText('00:00:01:00')
		await field.click()
		await expect(anchor).toHaveText(/00:00:01:00/)
		await page.getByRole('button', { name: 'Draw on the picture' }).click()
		const stage = await page.locator('.deliver-player__stage').boundingBox()
		await page.mouse.move(stage.x + stage.width * 0.3, stage.y + stage.height * 0.3)
		await page.mouse.down()
		await page.mouse.move(stage.x + stage.width * 0.6, stage.y + stage.height * 0.5, { steps: 8 })
		await page.mouse.up()
		await expect(page.locator('.deliver-comments__drawn')).toHaveText('1 shape drawn')
		const timeline = page.locator('.deliver-player__timeline')
		const bar = await timeline.boundingBox()
		await timeline.click({ position: { x: bar.width * 0.8, y: bar.height / 2 } })
		await expect(page.locator('.deliver-player__timecode')).not.toContainText('00:00:01:00')
		await expect(anchor).toHaveText(/00:00:01:00/)

		// On a phone a tap into the field stops audio and video alike, with no key pressed
		const phone = await browser.newContext({ baseURL: BROWSER_URL, ...PHONE })
		const member = await phone.newPage()
		await login(member)
		const tapStops = async (where, path) => {
			await where.goto(path)
			const media = where.locator('video.deliver-player__video')
			await expect(media).toHaveJSProperty('readyState', 4)
			await where.getByRole('button', { name: 'Play', exact: true }).tap()
			await expect.poll(() => media.evaluate((element) => element.currentTime)).toBeGreaterThan(0.5)
			await where.locator('#deliver-comment-body').tap()
			await expect(where.locator('#deliver-comment-body')).toBeFocused()
			await expect.poll(() => media.evaluate((element) => element.paused)).toBe(true)
			// Played on while the field keeps the focus, as a tap on the Waveform does, a tap into it stops it again
			await media.evaluate((element) => element.play())
			await expect.poll(() => media.evaluate((element) => element.paused)).toBe(false)
			await where.locator('#deliver-comment-body').tap()
			await expect.poll(() => media.evaluate((element) => element.paused)).toBe(true)
		}
		await tapStops(member, `/apps/deliver/versions/${versionId}`)
		await tapStops(member, `/apps/deliver/versions/${clipVersionId}`)
		await phone.close()

		// A Reviewer's field does the same
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		const link = (await (await api.post(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}/links?format=json`)).json()).ocs.data
		await api.dispose()
		const guest = await browser.newContext({ baseURL: BROWSER_URL, ...PHONE })
		const reviewer = await guest.newPage()
		await reviewer.goto(`/apps/deliver/s/${link.token}/versions/${clipVersionId}`)
		await reviewer.locator('#deliver-reviewer-name').fill('Pia')
		await reviewer.getByRole('button', { name: 'Start reviewing' }).tap()
		await expect(reviewer.locator('.deliver-comments__gate')).toHaveCount(0)
		await tapStops(reviewer, `/apps/deliver/s/${link.token}/versions/${clipVersionId}`)
		await guest.close()
	})

	test('by mouse a click on the wave does not seek and a double click skips ten seconds; the strip under it seeks and shows a dashed line first', async ({ playwright }) => {
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		expect((await api.post(`/ocs/v2.php/apps/deliver/api/v1/versions/${versionId}/comments?format=json`, { data: { inFrame: 330000, body: 'in the strip' } })).ok()).toBe(true)
		await api.dispose()
		// Without the glide a click lands on the wave where it will rest
		await page.emulateMedia({ reducedMotion: 'reduce' })
		await page.goto(`/apps/deliver/versions/${versionId}`)
		const canvas = page.locator('.deliver-wave canvas')
		await expect(canvas).toBeVisible()
		const audio = page.locator('video.deliver-player__video')
		await expect(audio).toHaveJSProperty('readyState', 4)
		const box = await canvas.boundingBox()
		const strip = box.height - 20
		const time = () => audio.evaluate((element) => element.currentTime)
		const goTo = async (seconds) => {
			await audio.evaluate((element, at) => {
				element.currentTime = at
			}, seconds)
			await expect.poll(() => canvas.evaluate((element) => element.drawnAt)).toBeCloseTo(seconds + 0.0005, 2)
		}
		// Of the 16 px above the loudest bar at this place, how many are drawn on: 8 of a dashed line
		const line = (x) => canvas.evaluate((element, at) => {
			const ratio = element.width / element.clientWidth
			const data = element.getContext('2d').getImageData(Math.round(at * ratio), Math.round(36 * ratio), 1, Math.round(16 * ratio)).data
			return data.filter((value, index) => index % 4 === 3 && value > 0).length / ratio
		}, x)
		const cursor = () => page.locator('.deliver-wave').evaluate((element) => getComputedStyle(element).cursor)
		const hover = (x, y) => page.mouse.move(box.x + x, box.y + y)
		const card = page.getByRole('dialog', { name: /^Comment #/ })

		for (const zoom of ['1 min', 'Whole']) {
			const whole = zoom === 'Whole'
			await page.getByRole('button', { name: zoom, exact: true }).click()
			await goTo(20)
			const start = await time()
			// On the wave a click goes nowhere but plays or pauses; a double click skips ten seconds on the thirds, nothing in the middle, and neither plays
			const paused = () => audio.evaluate((element) => element.paused)
			await canvas.click({ position: { x: box.width * 0.85, y: box.height / 2 } })
			await expect.poll(paused).toBe(false)
			expect(await time()).toBeLessThan(start + 5)
			await canvas.click({ position: { x: box.width * 0.85, y: box.height / 2 } })
			await expect.poll(paused).toBe(true)
			// What else happens within the wait wins: C comments with the sound stopped, Space plays, a click into the field leaves it standing
			const field = page.locator('#deliver-comment-body')
			// The click and what follows it in one go in the page, so that a slow machine does not stretch the moment between them past the wait
			const clickThen = (then) => canvas.evaluate((element, key) => {
				const stage = element.getBoundingClientRect()
				const at = { clientX: stage.left + stage.width * 0.85, clientY: stage.top + stage.height / 2, pointerId: 7, pointerType: 'mouse', button: 0, bubbles: true }
				element.dispatchEvent(new PointerEvent('pointerdown', at))
				element.dispatchEvent(new PointerEvent('pointerup', at))
				if (key === null) {
					const into = document.getElementById('deliver-comment-body')
					into.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 8, pointerType: 'mouse', button: 0, bubbles: true }))
					into.focus()
				} else {
					document.body.dispatchEvent(new KeyboardEvent('keydown', { key, code: key === ' ' ? 'Space' : 'KeyC', bubbles: true, cancelable: true }))
				}
			}, then)
			await clickThen('c')
			await expect(field).toBeFocused()
			await page.waitForTimeout(500)
			expect(await paused()).toBe(true)
			await field.press('Escape')
			await page.locator('.deliver-review__title').click()
			await clickThen(' ')
			await page.waitForTimeout(500)
			expect(await paused()).toBe(false)
			await page.keyboard.press(' ')
			await expect.poll(paused).toBe(true)
			await clickThen(null)
			await expect(field).toBeFocused()
			await page.waitForTimeout(500)
			expect(await paused()).toBe(true)
			await page.locator('.deliver-review__title').click()
			await goTo(20)
			await canvas.dblclick({ position: { x: box.width * 0.45, y: box.height / 2 } })
			await page.waitForTimeout(400)
			expect(await time()).toBe(start)
			expect(await paused()).toBe(true)
			await canvas.dblclick({ position: { x: box.width * 0.85, y: box.height / 2 } })
			await expect.poll(time).toBeCloseTo(start + 10, 1)
			await expect(page.locator('.deliver-player__flash')).toContainText('+10')
			await canvas.dblclick({ position: { x: box.width * 0.1, y: box.height / 2 } })
			await expect.poll(time).toBeCloseTo(start, 1)

			// Hovering the strip shows where a click goes; off it there is no line
			const x = Math.round(box.width * 0.75)
			await hover(x, box.height / 2)
			expect(await line(x)).toBe(0)
			await hover(x, strip)
			await expect.poll(() => line(x)).toBe(8)
			expect(await cursor()).toBe('pointer')
			await hover(x + 30, strip)
			await expect.poll(() => line(x + 30)).toBe(8)
			expect(await line(x)).toBe(0)
			await hover(x, box.height / 2)
			await expect.poll(() => line(x + 30)).toBe(0)
			expect(await cursor()).toBe('grab')
			await hover(x, strip)
			await expect.poll(() => line(x)).toBe(8)
			await hover(x, box.height + 60)
			await expect.poll(() => line(x)).toBe(0)

			// A click there seeks, and two quick ones seek twice
			await canvas.dblclick({ position: { x, y: strip } })
			await expect.poll(time).toBeCloseTo(whole ? 270 : start + 30, 0)
			await goTo(20)

			// A drag that begins there drags, without the line
			await hover(x, strip)
			await page.mouse.down()
			await page.mouse.move(box.x + x - 40, box.y + strip)
			await page.mouse.move(box.x + box.width / 2, box.y + strip)
			await page.waitForTimeout(100)
			for (const at of [x, x - 40, Math.round(box.width / 2) + 5]) {
				expect(await line(at)).toBe(0)
			}
			expect(await time()).toBeCloseTo(whole ? 180 : 35, 0)
			await page.mouse.up()

			// Over a circle there is no line, but a click opens it
			await goTo(330)
			const circle = whole ? Math.round(box.width * 330 / 360) : Math.round(box.width / 2)
			await hover(circle + 8, strip)
			await page.waitForTimeout(100)
			expect(await line(circle + 8)).toBe(0)
			expect(await cursor()).toBe('pointer')
			await hover(circle + 40, strip)
			await expect.poll(() => line(circle + 40)).toBe(8)
			await page.mouse.click(box.x + circle + 4, box.y + strip)
			await expect(card).toContainText('in the strip')
			expect(await time()).toBeCloseTo(330, 1)
			await page.keyboard.press('Escape')
			await expect(card).toHaveCount(0)
		}

		// With the card open a click in the strip beside the circles goes where the line says, and closes it; on the wave it only closes
		await page.getByRole('button', { name: '1 min' }).click()
		for (const inStrip of [true, false]) {
			await goTo(330)
			await page.mouse.click(box.x + box.width / 2 + 4, box.y + strip)
			await expect(card).toContainText('in the strip')
			const x = Math.round(box.width * 0.6)
			await hover(x, inStrip ? strip : 60)
			await expect.poll(() => line(x)).toBe(inStrip ? 8 : 0)
			await page.mouse.click(box.x + x, box.y + (inStrip ? strip : 60))
			await expect(card).toHaveCount(0)
			await expect.poll(time).toBeCloseTo(inStrip ? 336 : 330, 0)
		}
		// Pressed on the wave and lifted in the strip the mouse goes nowhere, so there is no line
		await goTo(20)
		await hover(600, 100)
		await page.mouse.down()
		await hover(600, strip)
		await page.waitForTimeout(100)
		expect(await line(600)).toBe(0)
		await page.mouse.up()
		expect(await time()).toBeCloseTo(20, 1)
		await expect.poll(() => line(600)).toBe(8)
		// A stage resized under the resting mouse, now on the wave, keeps no line
		await page.setViewportSize({ width: 1280, height: 900 })
		await page.waitForTimeout(300)
		expect(await line(600)).toBe(0)
		await page.setViewportSize({ width: 1280, height: 720 })
		await expect.poll(async () => (await canvas.boundingBox()).height).toBe(box.height)

		// Before the start of the piece a click goes to the start, and the line shows it there
		await page.getByRole('button', { name: '1 min' }).click()
		await goTo(20)
		const first = Math.round(box.width / 2 - 20 * box.width / 60)
		await hover(first - 40, strip)
		await expect.poll(() => line(first)).toBe(8)
		expect(await line(first - 40)).toBe(0)
		// While it plays on under it, the line stays at the mouse
		await page.getByRole('button', { name: 'Play (Space)' }).click()
		await hover(200, strip)
		await expect.poll(time).toBeGreaterThan(22)
		expect(await line(200)).toBe(8)
		await page.getByRole('button', { name: 'Pause (Space)' }).click()
		// Standing, the mouse over the wave or still in the strip draws nothing again
		await page.waitForTimeout(300)
		const draws = await canvas.evaluate(async (element) => {
			const clear = CanvasRenderingContext2D.prototype.clearRect
			let count = 0
			CanvasRenderingContext2D.prototype.clearRect = function(...args) {
				count++
				return clear.apply(this, args)
			}
			const frames = (n) => new Promise((resolve) => {
				const next = (left) => left ? requestAnimationFrame(() => next(left - 1)) : resolve()
				next(n)
			})
			// A slow machine may still be drawing what the pause and the mouse leaving for the button asked for: counted from once that is done
			let before = -1
			while (count !== before) {
				before = count
				await frames(10)
			}
			count = 0
			const box = element.getBoundingClientRect()
			const counts = []
			for (const [x, y] of [[100, 100], [120, 100], [200, box.height - 20], [200, box.height - 10], [200, 100]]) {
				element.dispatchEvent(new PointerEvent('pointermove', { clientX: box.left + x, clientY: box.top + y, pointerId: 7, pointerType: 'mouse', bubbles: true }))
				await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
				counts.push(count)
			}
			CanvasRenderingContext2D.prototype.clearRect = clear
			return counts
		})
		// No line, no line, a line, the same line, no line
		expect(draws).toEqual([0, 0, 1, 1, 2])
		await page.emulateMedia({ reducedMotion: null })
	})

	test('on a phone held sideways with the list closed, the field opens as a sheet and sends from there', async () => {
		const phone = await browser.newContext({ baseURL: BROWSER_URL, ...PHONE, viewport: { width: 844, height: 390 } })
		const member = await phone.newPage()
		await login(member)
		await member.goto(`/apps/deliver/versions/${versionId}`)
		const canvas = member.locator('.deliver-wave canvas')
		await expect(canvas).toBeVisible()
		await expect(member.locator('video.deliver-player__video')).toHaveJSProperty('readyState', 4)
		await expect(member.locator('.deliver-layout__panel')).toBeHidden()
		const box = await canvas.boundingBox()
		const touch = await phone.newCDPSession(member)
		await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width * 0.75, y: box.y + box.height / 2 }] })
		await member.waitForTimeout(700)
		await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
		const sheet = member.getByRole('dialog', { name: 'New Comment' })
		await expect(sheet).toBeVisible()
		// From below, across the width
		const at = await sheet.boundingBox()
		expect(Math.round(at.y + at.height)).toBe(390)
		expect(Math.round(at.width)).toBe(844)
		await member.locator('#deliver-comment-body-inline').fill('from the sheet')
		await sheet.getByRole('button', { name: 'Send (Enter)' }).tap()
		await expect(sheet).toHaveCount(0)
		await expect(member.locator('.deliver-layout__panel')).toBeHidden()
		await phone.close()
	})

	test('over the whole piece the Comments are on the wave only, zoomed in on the bar too, where a tap opens the card and a drag seeks', async ({ playwright }) => {
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		const ids = []
		const open = async (target, zoom) => {
			await target.goto(`/apps/deliver/versions/${versionId}`)
			await expect(target.locator('.deliver-wave canvas')).toBeVisible()
			await expect(target.locator('video.deliver-player__video')).toHaveJSProperty('readyState', 4)
			await target.getByRole('button', { name: zoom, exact: true }).click()
		}
		const timeOf = (target) => target.locator('video.deliver-player__video').evaluate((element) => element.currentTime)
		// The circle at 90 s, a quarter on: other cases leave Comments too, in counts of their own
		const circleOf = async (target) => {
			const circles = target.locator('.deliver-player__circle')
			await expect(circles.first()).toBeVisible()
			return circles.nth(await circles.evaluateAll((all) => all.findIndex((each) => Math.abs(parseFloat(each.style.left) - each.parentElement.clientWidth / 4) < 1)))
		}
		const card = (target) => target.getByRole('dialog', { name: /^Comment #/ })
		const canvas = page.locator('.deliver-wave canvas')

		// The wave is as high with Comments as without, at every zoom
		await page.route('**/versions/*/comments*', (route) => route.fulfill({ json: { ocs: { meta: { status: 'ok', statuscode: 200 }, data: { comments: [], manages: true, overwrittenAt: null, canComment: true, canApprove: false } } } }))
		await open(page, 'Whole')
		const heights = [(await canvas.boundingBox()).height]
		await page.getByRole('button', { name: '1 min', exact: true }).click()
		heights.push((await canvas.boundingBox()).height)
		await expect(page.locator('.deliver-player__circle')).toHaveCount(0)
		await page.unroute('**/versions/*/comments*')
		for (const [inFrame, body] of [[90000, 'on the bar'], [90100, 'close by']]) {
			const made = await api.post(`/ocs/v2.php/apps/deliver/api/v1/versions/${versionId}/comments?format=json`, { data: { inFrame, body } })
			ids.push((await made.json()).ocs.data.id)
		}
		await open(page, 'Whole')
		await expect(page.locator('.deliver-comment').filter({ hasText: 'on the bar' })).toBeVisible()
		const stage = await canvas.boundingBox()
		const under = await page.locator('.deliver-player__timeline').boundingBox()
		expect([stage.height, stage.height]).toEqual(heights)
		expect(under.y).toBeCloseTo(stage.y + stage.height, 0)

		// Over the whole the circle is on the wave's lane, where it opens, and none is on the bar
		expect(await canvas.evaluate((element) => {
			const ratio = element.width / element.clientWidth
			const data = element.getContext('2d').getImageData(Math.round((element.clientWidth / 4 + 8) * ratio), element.height - Math.round(20 * ratio), 1, 1).data
			return data[3]
		})).toBe(255)
		await expect(page.locator('.deliver-player__circle')).toHaveCount(0)
		const row = { x: under.x + under.width / 4, y: under.y + under.height / 2 }
		await page.mouse.click(row.x, row.y)
		await expect.poll(() => timeOf(page)).toBeCloseTo(90, 0)
		await expect(card(page)).toHaveCount(0)

		// Zoomed in the bar has it too, translucent until the list selects it; a click on it opens the card of its count, which seeks nowhere
		await page.getByRole('button', { name: '1 min', exact: true }).click()
		expect((await canvas.boundingBox()).height).toBe(stage.height)
		const circle = await circleOf(page)
		await expect(circle).toHaveText('2')
		const back = () => circle.evaluate((element) => getComputedStyle(element).backgroundColor)
		expect(await back()).toMatch(/rgba\(0, 0, 0, 0\.\d+\)/)
		await page.mouse.click(row.x + 6, row.y)
		await expect(card(page)).toContainText('on the bar')
		await expect(card(page)).toContainText('1 of 2')
		expect(await timeOf(page)).toBeCloseTo(90, 0)
		await expect(circle).toHaveClass(/--ringed/)
		// A click on the wave closes the bar's card and does only that: no Play after the double-click wait
		const paused = (target) => target.locator('video.deliver-player__video').evaluate((element) => element.paused)
		await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 3)
		await expect(card(page)).toHaveCount(0)
		await page.waitForTimeout(600)
		expect(await paused(page)).toBe(true)
		await page.mouse.click(row.x + 6, row.y)
		await expect(card(page)).toContainText('on the bar')
		// A click beside it closes the card and seeks there exactly; a drag from the circle is the bar's
		await page.mouse.click(row.x + 14, row.y)
		await expect(card(page)).toHaveCount(0)
		await expect.poll(() => timeOf(page)).toBeCloseTo(90 + 14 / under.width * 360, 0)
		await page.mouse.move(row.x + 6, row.y)
		await page.mouse.down()
		await page.mouse.move(under.x + under.width / 2, row.y, { steps: 4 })
		await expect.poll(() => timeOf(page)).toBeCloseTo(180, 0)
		await page.mouse.up()
		await page.waitForTimeout(400)
		await expect(card(page)).toHaveCount(0)
		await page.locator('.deliver-comment').filter({ hasText: 'close by' }).locator('.deliver-comment__anchor').click()
		await expect(circle).toHaveClass(/--ringed/)
		await expect.poll(back).toBe('rgb(0, 0, 0)')

		const phone = await browser.newContext({ baseURL: BROWSER_URL, ...PHONE, viewport: { width: 852, height: 393 } })
		const member = await phone.newPage()
		await login(member)
		await open(member, '1 min')
		const at = await (await circleOf(member)).boundingBox()
		const touch = await phone.newCDPSession(member)
		const y = at.y + at.height / 2
		// A tap on it opens the card over it, held sideways too, and seeks nowhere; a tap elsewhere closes it
		await member.touchscreen.tap(at.x + at.width / 2, y)
		await expect(card(member)).toContainText('on the bar')
		const over = await card(member).boundingBox()
		expect(over.y + over.height).toBeLessThanOrEqual(at.y)
		expect(over.width).toBeLessThanOrEqual(264)
		expect(await timeOf(member)).toBeLessThan(1)
		await member.touchscreen.tap(at.x + at.width / 2, y - 120)
		await expect(card(member)).toHaveCount(0)
		await member.waitForTimeout(600)
		expect(await paused(member)).toBe(true)
		await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x + at.width / 2, y }] })
		for (const x of [at.x + 60, at.x + 160, at.x + 260]) {
			await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
		}
		await expect.poll(() => timeOf(member)).toBeGreaterThan(150)
		await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
		await member.waitForTimeout(500)
		await expect(card(member)).toHaveCount(0)
		await phone.close()
		for (const id of ids) {
			expect((await api.delete(`/ocs/v2.php/apps/deliver/api/v1/comments/${id}?format=json`)).ok()).toBe(true)
		}
		await api.dispose()
	})

	test('on a phone a pinch only zooms, a long press comments, and the card hands the focus back; a Reviewer who may not comment reads the cards and writes nothing', async ({ playwright }) => {
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		const comments = `/ocs/v2.php/apps/deliver/api/v1/versions/${versionId}/comments?format=json`
		const parent = (await (await api.post(comments, { data: { inFrame: 7500, body: 'for the phone' } })).json()).ocs.data
		expect((await api.post(comments, { data: { inFrame: 7500, body: 'and a reply', parentId: parent.id } })).ok()).toBe(true)

		const phone = await browser.newContext({ baseURL: BROWSER_URL, ...PHONE })
		const member = await phone.newPage()
		await login(member)
		await member.goto(`/apps/deliver/versions/${versionId}`)
		const canvas = member.locator('.deliver-wave canvas')
		await expect(canvas).toBeVisible()
		await expect(member.locator('video.deliver-player__video')).toHaveJSProperty('readyState', 4)
		const field = member.locator('#deliver-comment-body')
		const anchor = member.locator('.deliver-comments__anchor')
		const box = await canvas.boundingBox()
		const y = box.y + box.height / 2
		const touch = await phone.newCDPSession(member)
		const fingers = (type, points) => touch.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, at], id) => ({ x, y: at, id })) })
		const shown = () => member.locator('.deliver-player__window').evaluate((element) => parseFloat(element.style.width.match(/[\d.]+%/)[0]))

		// Two fingers moving apart for most of a second zoom in and open no field
		const before = await shown()
		await fingers('touchStart', [[box.x + 150, y], [box.x + 240, y]])
		for (let step = 1; step <= 8; step++) {
			await member.waitForTimeout(100)
			await fingers('touchMove', [[box.x + 150 - step * 10, y], [box.x + 240 + step * 10, y]])
		}
		await fingers('touchEnd', [])
		await member.waitForTimeout(300)
		expect(await shown()).toBeLessThan(before)
		await expect(field).not.toBeFocused()
		await expect(anchor).toHaveText('0:00.000')

		// A finger resting a quarter of the stage to the right, 15 seconds on, opens the field there; it neither seeks nor goes fullscreen
		await member.getByRole('button', { name: '1 min' }).tap()
		const cancelled = () => member.evaluate(() => window.touchEnds.at(-1))
		await member.evaluate(() => {
			window.touchEnds = []
			document.addEventListener('touchend', (event) => window.touchEnds.push(event.defaultPrevented))
		})
		await fingers('touchStart', [[box.x + box.width * 0.75, y]])
		await member.waitForTimeout(700)
		await fingers('touchEnd', [])
		await expect(field).toBeFocused()
		// Its touchend is cancelled: iOS Safari sends a finger's mouse events otherwise, whose mousedown takes the focus from the field
		expect(await cancelled()).toBe(true)
		await expect(anchor).toHaveText('0:15.000')
		// The place waits on the wave as a line in the primary colour, over the wave not yet played
		const mark = await canvas.evaluate((element) => {
			const probe = document.createElement('span')
			probe.style.color = 'var(--color-primary-element)'
			element.parentElement.append(probe)
			const primary = getComputedStyle(probe).color.match(/\d+/g).map(Number)
			probe.remove()
			const ratio = element.width / element.clientWidth
			const pixel = element.getContext('2d').getImageData(Math.round(element.width * 0.75), Math.round(42 * ratio), 1, 1).data
			return Math.max(...primary.slice(0, 3).map((value, at) => Math.abs(value - pixel[at])))
		})
		expect(mark).toBeLessThan(8)
		expect(await member.locator('video.deliver-player__video').evaluate((element) => element.currentTime)).toBeLessThan(1)
		await expect(member.locator('.deliver-player--fullscreen')).toHaveCount(0)
		// A tap on a circle, 7.5 seconds on, opens its card: small, over the circle, beside the playhead, not a sheet
		const lane = await canvas.boundingBox()
		await fingers('touchStart', [[lane.x + lane.width * 0.625, lane.y + lane.height - 20]])
		await fingers('touchEnd', [])
		const small = member.getByRole('dialog', { name: /^Comment #/ })
		await expect(small).toContainText('for the phone')
		await expect(small).toContainText('1 reply')
		await expect(small).toBeFocused()
		// A tap is no long press: its touchend stays
		expect(await cancelled()).toBe(false)
		const over = await small.boundingBox()
		expect(over.width).toBeLessThan(lane.width / 2)
		expect(over.x).toBeGreaterThan(lane.x + lane.width / 2)
		expect(over.x + over.width).toBeLessThanOrEqual(lane.x + lane.width)
		expect(over.y + over.height).toBeLessThanOrEqual(lane.y + lane.height - 32)
		// A tap anywhere else closes it and hands the focus back to the field
		await fingers('touchStart', [[lane.x + lane.width * 0.3, y]])
		await fingers('touchEnd', [])
		await expect(small).toHaveCount(0)
		await expect(field).toBeFocused()
		// A single tap on the wave seeks nowhere but plays or pauses; a double tap on its right third skips ten seconds, in the middle nothing
		const time = () => member.locator('video.deliver-player__video').evaluate((element) => element.currentTime)
		const paused = () => member.locator('video.deliver-player__video').evaluate((element) => element.paused)
		const back = (at) => member.locator('video.deliver-player__video').evaluate((element, seconds) => {
			element.currentTime = seconds
		}, at)
		const tapAt = async (at, high = y) => {
			await fingers('touchStart', [[at, high]])
			await fingers('touchEnd', [])
		}
		// Both taps in one go in the page, so that a slow machine does not stretch them apart past DOUBLE_TAP_MS
		const doubleTapAt = (at) => canvas.evaluate((element, [x, high]) => {
			for (const type of ['pointerdown', 'pointerup', 'pointerdown', 'pointerup']) {
				element.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: high, pointerId: 9, pointerType: 'touch', bubbles: true, cancelable: true }))
			}
		}, [at, y])
		// A first tap that lets go of the empty field skips nothing either; the second is a tap of its own and plays
		await fingers('touchStart', [[box.x + box.width * 0.75, y]])
		await member.waitForTimeout(700)
		await fingers('touchEnd', [])
		await expect(anchor).toHaveText('0:15.000')
		await tapAt(box.x + box.width * 0.85)
		await tapAt(box.x + box.width * 0.85)
		await expect(anchor).toHaveText(/^0:00\./)
		await expect.poll(paused).toBe(false)
		expect(await time()).toBeLessThan(5)
		// Not at once: it waits whether a second tap comes, measured in the page, where a slow machine does not stretch it
		await member.locator('video.deliver-player__video').evaluate((element) => {
			document.addEventListener('pointerup', () => {
				element.tappedAt = performance.now()
			}, { capture: true, once: true })
			element.addEventListener('pause', () => {
				element.pausedAt = performance.now()
			}, { once: true })
		})
		await tapAt(box.x + box.width * 0.85)
		await expect.poll(paused).toBe(true)
		expect(await member.locator('video.deliver-player__video').evaluate((element) => element.pausedAt - element.tappedAt)).toBeGreaterThanOrEqual(DOUBLE_TAP_MS)
		const start = await time()
		await tapAt(box.x + box.width * 0.85)
		await expect.poll(paused).toBe(false)
		await tapAt(box.x + box.width * 0.85)
		await expect.poll(paused).toBe(true)
		// The seek back can land a microsecond beside where it was set, so the time after it is compared to a tenth of a millisecond, far below a moment of playback
		await back(start)
		// A tap beside the player's open menu, clear of it at the top, only closes it (#268), and two quick ones skip nothing: the second plays
		const beside = () => tapAt(box.x + box.width * 0.85, box.y + 60)
		const settings = member.getByRole('button', { name: 'Playback settings' })
		await settings.tap()
		await expect(member.getByRole('menuitem', { name: 'One Frame back' })).toBeVisible()
		await beside()
		await expect(member.getByRole('menuitem', { name: 'One Frame back' })).toBeHidden()
		await member.waitForTimeout(500)
		expect(await paused()).toBe(true)
		expect(await time()).toBeCloseTo(start, 4)
		await settings.tap()
		await expect(member.getByRole('menuitem', { name: 'One Frame back' })).toBeVisible()
		await beside()
		// The menu closes a frame after the touch; a second tap before that would still close it, which no finger is quick enough for
		await member.waitForFunction(() => document.querySelector('.v-popper__popper--shown') === null, null, { polling: 'raf' })
		await beside()
		await expect.poll(paused).toBe(false)
		expect(await time()).toBeLessThan(start + 5)
		await beside()
		await expect.poll(paused).toBe(true)
		await back(start)
		// A tap and then a resting finger opens the field without a moment of sound; the tap and the finger's coming down in one go in the page, within DOUBLE_TAP_MS on a slow machine too
		const pointer = (steps) => canvas.evaluate((element, [all, high]) => {
			for (const [type, x] of all) {
				element.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: high, pointerId: 9, pointerType: 'touch', bubbles: true, cancelable: true }))
			}
		}, [steps, y])
		await pointer([['pointerdown', box.x + box.width * 0.85], ['pointerup', box.x + box.width * 0.85], ['pointerdown', box.x + box.width * 0.75]])
		await member.waitForTimeout(700)
		await pointer([['pointerup', box.x + box.width * 0.75]])
		await expect(field).toBeFocused()
		expect(await paused()).toBe(true)
		expect(await time()).toBeCloseTo(start, 4)
		// A tap lets go of the empty field, and only does that
		await tapAt(box.x + box.width * 0.85)
		await member.waitForTimeout(500)
		expect(await paused()).toBe(true)
		await doubleTapAt(box.x + box.width * 0.5)
		await member.waitForTimeout(500)
		expect(await time()).toBeCloseTo(start, 4)
		expect(await paused()).toBe(true)
		await doubleTapAt(box.x + box.width * 0.85)
		await expect.poll(time).toBeCloseTo(start + 10, 0)
		await expect(member.locator('.deliver-player__flash')).toContainText('+10')
		await member.waitForTimeout(500)
		expect(await paused()).toBe(true)
		await doubleTapAt(box.x + box.width * 0.1)
		await expect.poll(time).toBeCloseTo(start, 0)
		// A long press on playing audio stops it
		await member.getByRole('button', { name: 'Play', exact: true }).tap()
		await expect.poll(() => member.locator('video.deliver-player__video').evaluate((element) => element.paused)).toBe(false)
		await fingers('touchStart', [[box.x + box.width * 0.75, y]])
		await member.waitForTimeout(700)
		await fingers('touchEnd', [])
		await expect.poll(() => member.locator('video.deliver-player__video').evaluate((element) => element.paused)).toBe(true)
		await phone.close()

		const link = (await (await api.post(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}/links?format=json`)).json()).ocs.data
		expect((await api.put(`/ocs/v2.php/apps/deliver/api/v1/links/${link.id}?format=json`, { data: { canComment: false } })).ok()).toBe(true)
		await api.dispose()
		const visitor = await browser.newContext({ baseURL: BROWSER_URL })
		const reviewer = await visitor.newPage()
		await reviewer.goto(`/apps/deliver/s/${link.token}/versions/${versionId}`)
		const wave = reviewer.locator('.deliver-wave canvas')
		await expect(wave).toBeVisible()
		await reviewer.getByRole('button', { name: '15 s' }).click()
		await reviewer.locator('.deliver-comment').filter({ hasText: 'for the phone' }).locator('.deliver-comment__anchor').click()
		const stage = await wave.boundingBox()
		await wave.click({ position: { x: stage.width / 2, y: stage.height - 20 } })
		const card = reviewer.getByRole('dialog', { name: /^Comment #/ })
		await expect(card).toContainText('for the phone')
		await expect(card).toContainText('1 reply')
		await expect(card.locator('textarea')).toHaveCount(0)
		await expect(card.getByRole('button', { name: 'Reply' })).toHaveCount(0)
		await expect(card.getByTitle('Go to this Frame')).toBeVisible()
		// A click elsewhere in the strip closes it, seeks, and opens no field
		await wave.click({ position: { x: stage.width * 0.75, y: stage.height - 20 } })
		await expect(card).toHaveCount(0)
		await expect.poll(() => reviewer.locator('video.deliver-player__video').evaluate((element) => element.currentTime)).toBeCloseTo(11.25, 0)
		await expect(reviewer.locator('#deliver-comment-body')).toHaveCount(0)
		await visitor.close()
	})

	test('Reply on a circle\'s card opens the Comment list at that Comment with its Reply field focused: upright, sideways and with the panel closed', async ({ playwright }) => {
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		const made = await api.post(`/ocs/v2.php/apps/deliver/api/v1/versions/${versionId}/comments?format=json`, { data: { inFrame: 22500, body: 'answer me' } })
		const id = (await made.json()).ocs.data.id
		/**
		 * Opens the Version, taps or clicks the circle 22.5 seconds on and Reply on its card
		 *
		 * @param {import('@playwright/test').Page} target - the Review view
		 * @param {boolean} touch - a finger, else the mouse
		 */
		const reply = async (target, touch) => {
			await target.goto(`/apps/deliver/versions/${versionId}`)
			const canvas = target.locator('.deliver-wave canvas')
			await expect(canvas).toBeVisible()
			await expect(target.locator('video.deliver-player__video')).toHaveJSProperty('readyState', 4)
			await target.getByRole('button', { name: '1 min', exact: true }).click()
			const lane = await canvas.boundingBox()
			const at = { x: lane.x + lane.width * 0.875, y: lane.y + lane.height - 20 }
			await (touch ? target.touchscreen.tap(at.x, at.y) : target.mouse.click(at.x, at.y))
			const card = target.getByRole('dialog', { name: /^Comment #/ })
			await expect(card).toContainText('answer me')
			await card.getByRole('button', { name: 'Reply', exact: true }).click()
			await expect(card).toHaveCount(0)
			const item = target.locator('.deliver-comments__list > .deliver-comment').filter({ hasText: 'answer me' })
			await expect(item.getByPlaceholder('Write a Reply')).toBeFocused()
			await expect(item.getByPlaceholder('Write a Reply')).toBeInViewport()
			await expect(item).toHaveClass(/deliver-comment--selected/)
		}

		// Upright the list comes up under the picture
		const upright = await browser.newContext({ baseURL: BROWSER_URL, ...PHONE })
		const phone = await upright.newPage()
		await login(phone)
		await reply(phone, true)
		await expect(phone.locator('.deliver-layout--middle')).toHaveCount(1)
		await upright.close()
		// Sideways with the list closed, it opens beside the picture
		const sideways = await browser.newContext({ baseURL: BROWSER_URL, ...PHONE, viewport: { width: 852, height: 393 } })
		const held = await sideways.newPage()
		await login(held)
		await held.goto(`/apps/deliver/versions/${versionId}`)
		await expect(held.locator('.deliver-layout__panel')).toBeHidden()
		await reply(held, true)
		await expect(held.locator('.deliver-layout__panel')).toBeVisible()
		await sideways.close()
		// On a desktop the closed panel opens
		await page.goto(`/apps/deliver/versions/${versionId}`)
		await page.getByRole('button', { name: 'Hide Comments' }).click()
		await expect(page.locator('.deliver-layout__panel')).toBeHidden()
		await reply(page, false)
		await expect(page.locator('.deliver-layout__panel')).toBeVisible()
		expect((await api.delete(`/ocs/v2.php/apps/deliver/api/v1/comments/${id}?format=json`)).ok()).toBe(true)
		await api.dispose()
	})

	test('on a phone Reply on the card brings its field above the keyboard, upright and sideways, as a tap into the field does (#284)', async ({ playwright }) => {
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		const made = await api.post(`/ocs/v2.php/apps/deliver/api/v1/versions/${versionId}/comments?format=json`, { data: { inFrame: 22500, body: 'answer me above the keyboard' } })
		const id = (await made.json()).ocs.data.id
		for (const viewport of [PHONE.viewport, { width: 852, height: 393 }]) {
			// Nextcloud holds an iPhone's zoom at 1, and the zoom below stands in for the keyboard
			const phone = await browser.newContext({ baseURL: BROWSER_URL, ...PHONE, viewport, userAgent: ANDROID })
			// iOS brings a field above its keyboard as the field takes the focus, unless that focus
			// prevents scrolling; a scrollIntoView knows nothing of the keyboard. Chromium's would pan
			// the zoomed view below, so here it stays out
			await phone.addInitScript(() => {
				Element.prototype.scrollIntoView = () => {}
			})
			const target = await phone.newPage()
			await login(target)
			await target.goto(`/apps/deliver/versions/${versionId}`)
			const canvas = target.locator('.deliver-wave canvas')
			await expect(canvas).toBeVisible()
			await expect(target.locator('video.deliver-player__video')).toHaveJSProperty('readyState', 4)
			await target.getByRole('button', { name: '1 min', exact: true }).click()
			const lane = await canvas.boundingBox()
			await target.touchscreen.tap(lane.x + lane.width * 0.875, lane.y + lane.height - 20)
			const card = target.getByRole('dialog', { name: /^Comment #/ })
			await expect(card).toContainText('answer me above the keyboard')
			// The keyboard as iOS opens it: the visual viewport shrinks, the layout keeps the window's size.
			// Zoomed in, the visual viewport is as much smaller, and a field the browser brings into view lands in it
			const cdp = await phone.newCDPSession(target)
			await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 })
			await expect.poll(() => target.evaluate(() => window.visualViewport.scale)).toBe(2)
			// Zoomed, a click would miss: the press goes to the button itself
			await card.getByRole('button', { name: 'Reply', exact: true }).dispatchEvent('click')
			const field = target.locator('.deliver-comments__list > .deliver-comment').filter({ hasText: 'answer me above the keyboard' }).getByPlaceholder('Write a Reply')
			await expect(field).toBeFocused()
			// Its first line, where the text goes, in the zoomed view: as the browser brings the caret into view
			await expect.poll(() => field.evaluate((element) => {
				const box = element.getBoundingClientRect()
				const seen = window.visualViewport
				return box.top >= seen.offsetTop && box.top + 24 <= seen.offsetTop + seen.height
					&& box.left >= seen.offsetLeft && box.left < seen.offsetLeft + seen.width
			})).toBe(true)
			await phone.close()
		}
		expect((await api.delete(`/ocs/v2.php/apps/deliver/api/v1/comments/${id}?format=json`)).ok()).toBe(true)
		await api.dispose()
	})

	test('on a phone Reply on the card takes the focus from the Comment field, whose list would step aside for it (#284)', async ({ playwright }) => {
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		const made = await api.post(`/ocs/v2.php/apps/deliver/api/v1/versions/${versionId}/comments?format=json`, { data: { inFrame: 22500, body: 'answer me while writing' } })
		const id = (await made.json()).ocs.data.id
		const phone = await browser.newContext({ baseURL: BROWSER_URL, ...PHONE })
		const target = await phone.newPage()
		await login(target)
		await target.goto(`/apps/deliver/versions/${versionId}`)
		const canvas = target.locator('.deliver-wave canvas')
		await expect(canvas).toBeVisible()
		await expect(target.locator('video.deliver-player__video')).toHaveJSProperty('readyState', 4)
		await target.getByRole('button', { name: '1 min', exact: true }).click()
		// Writing in the Comment field, then a tap on a circle: on touch the field keeps the focus
		const composer = target.getByPlaceholder('Leave a Comment…')
		await composer.tap()
		await expect(composer).toBeFocused()
		const lane = await canvas.boundingBox()
		await target.touchscreen.tap(lane.x + lane.width * 0.875, lane.y + lane.height - 20)
		const card = target.getByRole('dialog', { name: /^Comment #/ })
		await expect(card).toContainText('answer me while writing')
		// The card took the focus, so the list is back once the Comment field has let go of writing
		await expect(target.locator('.deliver-layout--writing')).toHaveCount(0)
		await card.getByRole('button', { name: 'Reply', exact: true }).tap()
		const field = target.locator('.deliver-comments__list > .deliver-comment').filter({ hasText: 'answer me while writing' }).getByPlaceholder('Write a Reply')
		await expect(field).toBeFocused()
		await expect(field).toBeInViewport()
		await expect(target.locator('.deliver-layout--writing')).toHaveCount(0)
		await phone.close()
		expect((await api.delete(`/ocs/v2.php/apps/deliver/api/v1/comments/${id}?format=json`)).ok()).toBe(true)
		await api.dispose()
	})

	test('Reply shows its Comment where the list\'s search or filter hides it, and the small card closes as soon as playback starts', async ({ playwright }) => {
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		const made = await api.post(`/ocs/v2.php/apps/deliver/api/v1/versions/${versionId}/comments?format=json`, { data: { inFrame: 22500, body: 'hidden from the list' } })
		const id = (await made.json()).ocs.data.id
		expect((await api.put(`/ocs/v2.php/apps/deliver/api/v1/comments/${id}/resolved?format=json`, { data: { resolved: true } })).ok()).toBe(true)
		await page.goto(`/apps/deliver/versions/${versionId}`)
		const canvas = page.locator('.deliver-wave canvas')
		await expect(canvas).toBeVisible()
		const video = page.locator('video.deliver-player__video')
		await expect(video).toHaveJSProperty('readyState', 4)
		await page.getByRole('button', { name: '1 min', exact: true }).click()
		const lane = await canvas.boundingBox()
		const circle = { x: lane.x + lane.width * 0.875, y: lane.y + lane.height - 20 }
		const card = page.getByRole('dialog', { name: /^Comment #/ })
		const item = page.locator('.deliver-comments__list > .deliver-comment').filter({ hasText: 'hidden from the list' })
		const replyThere = async () => {
			await page.mouse.click(circle.x, circle.y)
			await expect(card).toContainText('hidden from the list')
			await card.getByRole('button', { name: 'Reply', exact: true }).click()
			await expect(card).toHaveCount(0)
			await expect(item.getByPlaceholder('Write a Reply')).toBeFocused()
			await expect(item.getByPlaceholder('Write a Reply')).toBeInViewport()
		}

		// A search that leaves it out goes
		await page.getByRole('button', { name: 'Search Comments' }).click()
		await page.locator('.deliver-comments__search').fill('nothing like it')
		await expect(item).toHaveCount(0)
		await replyThere()
		await expect(page.locator('.deliver-comments__search')).toHaveCount(0)
		// So does "Unresolved" for a resolved one
		await page.locator('.deliver-comments__show button').click()
		await page.getByRole('menuitemradio', { name: 'Unresolved' }).click()
		await expect(item).toHaveCount(0)
		await replyThere()
		await expect(page.locator('.deliver-comments__show')).toContainText('All Comments')

		// Playback starting closes the card, on the wave and on the bar
		await page.locator('.deliver-review__title').click()
		await page.mouse.click(circle.x, circle.y)
		await expect(card).toBeVisible()
		await page.keyboard.press('Space')
		await expect(card).toHaveCount(0)
		await expect.poll(() => video.evaluate((element) => element.paused)).toBe(false)
		await page.keyboard.press('Space')
		await expect.poll(() => video.evaluate((element) => element.paused)).toBe(true)
		const onBar = await page.locator('.deliver-player__circles > .deliver-player__circle').first().boundingBox()
		await page.mouse.click(onBar.x + onBar.width / 2, onBar.y + onBar.height / 2)
		await expect(card).toBeVisible()
		await page.keyboard.press('Space')
		await expect(card).toHaveCount(0)
		await expect.poll(() => video.evaluate((element) => element.paused)).toBe(false)
		await page.keyboard.press('Space')
		expect((await api.delete(`/ocs/v2.php/apps/deliver/api/v1/comments/${id}?format=json`)).ok()).toBe(true)
		await api.dispose()
	})
})

/**
 * @param {import('@playwright/test').Locator} videos - Compare's two media elements
 * @return {Promise<boolean[]>} whether each side is heard: by its gain where both play into the AudioContext (A7), by muting until then
 */
const heard = (videos) => videos.evaluateAll((all) => all.map((video) => video.deliverGain && !video.muted ? video.deliverGain.gain.value > 0.5 : !video.muted))

/**
 * The rows of Compare's lanes drawn all the way across, in CSS px from the canvas's top: bars leave gaps, a dividing line does not
 *
 * @param {import('@playwright/test').Page} on - the page
 * @return {Promise<number[]>} the rows
 */
function dividers(on) {
	return on.locator('.deliver-compare__lanes canvas').evaluate((element) => {
		const { width, height } = element
		const data = element.getContext('2d').getImageData(0, 0, width, height).data
		const rows = []
		for (let y = 0; y < height; y++) {
			let drawn = 0
			for (let x = 0; x < width; x++) {
				drawn += data[(y * width + x) * 4 + 3] > 0 ? 1 : 0
			}
			if (drawn > width * 0.95) {
				rows.push(y * element.clientHeight / height)
			}
		}
		return rows
	})
}

/**
 * Each divider row's colour near the canvas's left and right edge: drawn once, it is the same on both sides of the playhead
 *
 * @param {import('@playwright/test').Page} on - the page
 * @return {Promise<Array<Array<number[]>>>} per row, the left and the right pixel
 */
function dividerEnds(on) {
	return on.locator('.deliver-compare__lanes canvas').evaluate((element) => {
		const context = element.getContext('2d')
		const rows = []
		for (let y = 0; y < element.height; y++) {
			const row = context.getImageData(0, y, element.width, 1).data
			if (row.filter((value, index) => index % 4 === 3 && value > 0).length > element.width * 0.95) {
				rows.push([[...context.getImageData(2, y, 1, 1).data], [...context.getImageData(element.width - 3, y, 1, 1).data]])
			}
		}
		return rows
	})
}

/**
 * A line divides the two lanes, in the gap between them: under the first lane's name, above the second's
 *
 * @param {import('@playwright/test').Page} on - the page
 */
async function expectDivider(on) {
	await expect.poll(async () => (await dividers(on)).length).toBeGreaterThan(0)
	const canvas = await on.locator('.deliver-compare__lanes canvas').boundingBox()
	const [first, second] = await on.locator('.deliver-compare__lanes .deliver-wave__lane').evaluateAll((all) => all.map((each) => each.getBoundingClientRect()))
	for (const row of await dividers(on)) {
		expect(row).toBeGreaterThan(first.bottom - canvas.y)
		expect(row).toBeLessThan(second.top - canvas.y)
	}
}

test.describe('Comparing sound', () => {
	let browser
	let context
	let page
	let folder
	let projectId
	/** Each Asset's Versions, newest first */
	let mix
	let cut

	test.beforeAll(async ({ playwright }) => {
		await testUser(playwright)
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		folder = 'deliver-e2e-' + randomBytes(4).toString('hex')
		const dav = `/remote.php/dav/files/${USER}/${folder}`
		expect((await api.fetch(dav, { method: 'MKCOL' })).status()).toBe(201)
		const created = await api.post('/ocs/v2.php/apps/deliver/api/v1/projects?format=json', { data: { folderId: await fileId(api, dav), autoIntake: true } })
		projectId = (await created.json()).ocs.data.id
		// One after the other, so the second of each stacks on the first as its V2
		for (const [name, file] of [['mix.webm', MIX_A], ['mix_v2.webm', MIX_B], ['cut.webm', CUT_A], ['cut_v2.webm', CUT_B]]) {
			expect((await api.fetch(`${dav}/${name}`, { method: 'PUT', data: readFileSync(file) })).status()).toBe(201)
		}
		const assets = async () => (await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)).json()).ocs.data.assets
		await expect.poll(async () => (await assets()).map((asset) => asset.versions.length).join()).toBe('2,2')
		const all = await assets()
		mix = all.find((asset) => asset.name === 'mix').versions
		cut = all.find((asset) => asset.name === 'cut').versions
		// ffmpeg makes the Waveforms
		const ready = async (version) => (await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/versions/${version.id}?format=json`)).json()).ocs.data.versions
			.every((each) => each.derived.waveform.state === 'ready')
		await expect.poll(async () => {
			execFileSync('docker', ['compose', 'exec', '-T', '-u', 'www-data', 'nextcloud', 'php', 'occ', 'deliver:worker', '--once'], { stdio: 'inherit' })
			return await ready(mix[0]) && await ready(cut[0])
		}, { timeout: 60_000 }).toBe(true)
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

	test('two audio Versions compare on two lanes under one playhead, and 1, 2, Tab and the lanes\' names switch the sound while both play on', async () => {
		await page.goto(`/apps/deliver/compare/${mix[1].id}/${mix[0].id}`)
		const videos = page.locator('.deliver-compare video')
		await expect(videos).toHaveCount(2)
		await expect(videos.first()).toHaveJSProperty('readyState', 4)
		// No picture area and nothing to lay out: the lanes are the view
		await expect(page.locator('.deliver-compare__stage')).toBeHidden()
		await expect(page.getByRole('radio', { name: 'Wipe' })).toHaveCount(0)
		const canvas = page.locator('.deliver-compare__lanes canvas')
		await expect(canvas).toBeVisible()
		await expect(page.locator('.deliver-wave__lane')).toHaveText(['V1', 'V2'])
		await expectDivider(page)
		const side = page.getByRole('radio', { name: /^V2/ })
		expect(await heard(videos)).toEqual([true, false])

		await page.getByRole('button', { name: 'Play (Space)' }).click()
		await expect.poll(() => videos.first().evaluate((video) => video.currentTime)).toBeGreaterThan(0.5)
		// Both play unmuted into one AudioContext, the gains decide
		expect(await videos.evaluateAll((all) => all.map((video) => !video.muted && !!video.deliverGain))).toEqual([true, true])
		// The heard side's sound comes through the graph: a media element from another origin would give silence
		const level = await videos.first().evaluate((video) => new Promise((resolve) => {
			const analyser = video.deliverGain.context.createAnalyser()
			video.deliverGain.connect(analyser)
			setTimeout(() => {
				const data = new Float32Array(analyser.fftSize)
				analyser.getFloatTimeDomainData(data)
				resolve(Math.max(...data.map(Math.abs)))
			}, 300)
		}))
		expect(level).toBeGreaterThan(0.05)
		await page.keyboard.press('2')
		await expect.poll(() => heard(videos)).toEqual([false, true])
		await expect(side).toHaveAttribute('aria-checked', 'true')
		expect(await videos.evaluateAll((all) => all.map((video) => video.paused))).toEqual([false, false])
		await page.keyboard.press('1')
		await expect.poll(() => heard(videos)).toEqual([true, false])

		// A click on a wave seeks and keeps playing; the player then has the focus, and Tab switches
		const box = await canvas.boundingBox()
		const sought = videos.first().evaluate((video) => new Promise((resolve) => video.addEventListener('seeking', () => resolve(true), { once: true })))
		await canvas.click({ position: { x: box.width * 0.6, y: box.height * 0.6 } })
		expect(await sought).toBe(true)
		// Over the whole piece the played part is laid over the rest: the line keeps its colour left of the playhead
		const ends = await dividerEnds(page)
		expect(ends.length).toBeGreaterThan(0)
		for (const [left, right] of ends) {
			expect(left).toEqual(right)
		}
		// Lanes have no strip: at their foot the mouse shows no place to go to
		await canvas.hover({ position: { x: box.width * 0.6, y: box.height - 5 } })
		expect(await page.locator('.deliver-wave').evaluate((element) => element.style.cursor)).toBe('')
		expect(await videos.first().evaluate((video) => video.paused)).toBe(false)
		await page.keyboard.press('Tab')
		await expect.poll(() => heard(videos)).toEqual([false, true])
		await page.keyboard.press('Tab')
		await expect.poll(() => heard(videos)).toEqual([true, false])
		// Moving through the page by keyboard, Tab moves the focus and leaves the sound alone
		await page.keyboard.press('Shift+Tab')
		await page.keyboard.press('Tab')
		await page.keyboard.press('Tab')
		expect(await heard(videos)).toEqual([true, false])
		expect(await page.evaluate(() => document.activeElement.classList.contains('deliver-compare'))).toBe(false)

		// A lane's name plays its side
		await page.locator('.deliver-wave__lane').nth(1).click()
		await expect.poll(() => heard(videos)).toEqual([false, true])
		await expect(side).toHaveAttribute('aria-checked', 'true')
		expect(await videos.evaluateAll((all) => all.map((video) => video.paused))).toEqual([false, false])
		await page.getByRole('button', { name: 'Pause (Space)' }).click()
	})

	test('switching ten times while both play seeks neither side, the heard sound runs on with the output, and the sides stay within milliseconds', async () => {
		await page.goto(`/apps/deliver/compare/${mix[1].id}/${mix[0].id}`)
		const videos = page.locator('.deliver-compare video')
		await expect(videos.first()).toHaveJSProperty('readyState', 4)
		await page.getByRole('button', { name: 'Play (Space)' }).click()
		await page.waitForTimeout(1500)
		// On every animation frame: both times, the clock of the output they play on, whose sound is heard, and every seek; a switch every 400 ms
		const run = await page.evaluate(() => new Promise((resolve) => {
			const [a, b] = document.querySelectorAll('.deliver-compare video')
			const halves = document.querySelectorAll('.deliver-compare__sound')
			let seeks = 0
			a.addEventListener('seeking', () => seeks++)
			b.addEventListener('seeking', () => seeks++)
			// What the app may not do to the output: suspend it or keep it waiting for sound
			const output = a.deliverGain.context
			let states = 0
			output.addEventListener('statechange', () => states++)
			const underrun = () => output.playbackStats?.underrunDuration
			const before = underrun()
			const samples = []
			const start = performance.now()
			let switches = 0
			const side = () => halves[0].getAttribute('aria-checked') === 'true' ? 'a' : 'b'
			const read = () => {
				const clock = output.currentTime
				return { ahead: (side() === 'a' ? a : b).currentTime - clock, apart: Math.abs(b.currentTime - a.currentTime) }
			}
			const tick = async () => {
				// Read twice, as on a page's first Play below; held up after the clock, a reading is too far ahead, never behind
				const first = read()
				await null
				const second = read()
				const now = performance.now()
				samples.push({ ahead: Math.min(first.ahead, second.ahead), apart: Math.min(first.apart, second.apart), running: output.state === 'running', side: side() })
				if (now - start > (switches + 1) * 400 && switches < 10) {
					switches++
					halves[switches % 2].click()
				}
				if (now - start < 4600) {
					requestAnimationFrame(tick)
				} else {
					resolve({ seeks, samples, states, underrun: [before, underrun()], playing: !a.paused && !b.paused })
				}
			}
			requestAnimationFrame(tick)
		}))
		await page.getByRole('button', { name: 'Pause (Space)' }).click()
		expect(run.playing).toBe(true)
		expect(run.seeks).toBe(0)
		expect(new Set(run.samples.map((sample) => sample.side)).size).toBe(2)
		// Without an offset the sides stand on the same second
		for (const sample of run.samples) {
			expect(sample.apart).toBeLessThan(0.01)
		}
		// The heard sound goes on with the output across every switch, ahead of its clock by the same on every frame. Not the
		// wall's clock: headless Chrome's stand-in for a sound card drops a buffer when the machine is late with it
		expect(run.samples.length).toBeGreaterThan(50)
		expect(run.samples.every((sample) => sample.running)).toBe(true)
		const ahead = run.samples.map((sample) => sample.ahead)
		expect(Math.max(...ahead) - Math.min(...ahead)).toBeLessThan(0.015)
		// And the app does not hold up the output: never suspended, and no more of its time without sound than the few buffers
		// a loaded machine is late with (AudioContext.playbackStats, Chrome only, brought up to date once a second)
		expect(run.states).toBe(0)
		expect(run.underrun, 'the browser has no AudioContext.playbackStats to tell a held up output by').toEqual([expect.any(Number), expect.any(Number)])
		expect(run.underrun[1] - run.underrun[0]).toBeLessThan(0.1)
	})

	test('on a page\'s first Play the sides are in step from the first second on, video and audio alike', async () => {
		for (const pair of [cut, mix]) {
			// A page of its own: the AudioContext is made by this Play
			const fresh = await context.newPage()
			await fresh.goto(`/apps/deliver/compare/${pair[1].id}/${pair[0].id}`)
			const videos = fresh.locator('.deliver-compare video')
			await expect(videos.first()).toHaveJSProperty('readyState', 4)
			// Each side is sought once, by the start itself: the heard side is never sought again
			await fresh.evaluate(() => {
				window.seeks = [0, 0]
				document.querySelectorAll('.deliver-compare video').forEach((video, side) => video.addEventListener('seeking', () => window.seeks[side]++))
			})
			await fresh.getByRole('button', { name: 'Play (Space)' }).click()
			await fresh.waitForTimeout(1000)
			expect(await fresh.evaluate(() => window.seeks)).toEqual([1, 1])
			const apart = await fresh.evaluate(() => new Promise((resolve) => {
				const [a, b] = document.querySelectorAll('.deliver-compare video')
				const found = []
				const start = performance.now()
				const read = () => Math.abs(b.currentTime - a.currentTime)
				const tick = async () => {
					// Read twice: the output may take a buffer (10 ms) between the readings of A and B, and is past it on the second
					const first = read()
					await null
					found.push(Math.min(first, read()))
					if (performance.now() - start < 1500) {
						requestAnimationFrame(tick)
					} else {
						resolve(Math.max(...found))
					}
				}
				requestAnimationFrame(tick)
			}))
			expect(apart).toBeLessThan(0.005)
			expect(await fresh.evaluate(() => window.seeks)).toEqual([1, 1])
			await fresh.close()
		}
	})

	test('the sides start as one although the second\'s play comes 50 ms after the first\'s', async () => {
		const fresh = await context.newPage()
		await fresh.addInitScript(() => {
			const play = HTMLMediaElement.prototype.play
			HTMLMediaElement.prototype.play = function() {
				const late = this === document.querySelectorAll('.deliver-compare video')[1] ? 50 : 0
				return new Promise((done) => setTimeout(done, late)).then(() => play.call(this))
			}
		})
		await fresh.goto(`/apps/deliver/compare/${mix[1].id}/${mix[0].id}`)
		const videos = fresh.locator('.deliver-compare video')
		await expect(videos.first()).toHaveJSProperty('readyState', 4)
		// The readings of the first 400 ms both play, before the side not heard would be put back
		const apart = await fresh.evaluate(() => new Promise((resolve) => {
			const [a, b] = document.querySelectorAll('.deliver-compare video')
			const found = []
			b.addEventListener('playing', () => {
				const start = performance.now()
				const tick = () => {
					found.push(b.currentTime - a.currentTime)
					if (performance.now() - start < 400) {
						requestAnimationFrame(tick)
					} else {
						resolve(found)
					}
				}
				tick()
			}, { once: true })
			document.querySelector('.deliver-compare__controls button[aria-label="Play (Space)"]').click()
		}))
		expect(Math.abs(apart.reduce((sum, each) => sum + each, 0) / apart.length)).toBeLessThan(0.005)
		await fresh.close()
	})

	test('only a start from a stand cuts the output: a seek while playing and a loop\'s next pass leave no hole in what is heard', async () => {
		const fresh = await context.newPage()
		// Every cut of the way out of the graph, and whether a side was playing
		await fresh.addInitScript(() => {
			window.cuts = []
			const disconnect = AudioNode.prototype.disconnect
			AudioNode.prototype.disconnect = function(...args) {
				window.cuts.push([...document.querySelectorAll('.deliver-compare video')].some((video) => !video.paused) ? 'playing' : 'standing')
				return disconnect.apply(this, args)
			}
		})
		await fresh.goto(`/apps/deliver/compare/${mix[1].id}/${mix[0].id}`)
		const videos = fresh.locator('.deliver-compare video')
		await expect(videos.first()).toHaveJSProperty('readyState', 4)
		const bar = await fresh.locator('.deliver-compare__timeline').boundingBox()
		const at = (share) => fresh.mouse.click(bar.x + bar.width * share, bar.y + bar.height / 2)
		const time = () => videos.first().evaluate((video) => video.currentTime)

		// A seek while playing
		await fresh.getByRole('button', { name: 'Play (Space)' }).click()
		await expect.poll(time).toBeGreaterThan(0.3)
		await fresh.keyboard.press('Shift+ArrowRight')
		await expect.poll(time).toBeGreaterThan(10)
		await at(0.2)
		await expect.poll(time).toBeLessThan(6)
		expect(await videos.evaluateAll((all) => all.map((video) => video.paused))).toEqual([false, false])
		await fresh.getByRole('button', { name: 'Pause (Space)' }).click()

		// A looped Range, round twice
		await at(0.25)
		await fresh.keyboard.press('i')
		await at(0.3)
		await fresh.keyboard.press('o')
		await at(0.25)
		await fresh.getByRole('button', { name: 'Loop the Range' }).click()
		await videos.first().evaluate((video) => {
			window.seeks = 0
			video.addEventListener('seeking', () => window.seeks++)
		})
		await fresh.getByRole('button', { name: 'Play (Space)' }).click()
		// The start's own and one a pass
		await expect.poll(() => fresh.evaluate(() => window.seeks)).toBeGreaterThan(2)
		expect(await fresh.evaluate(() => window.cuts)).toEqual(['standing', 'standing'])
		await fresh.close()
	})

	test('while the AudioContext is slow to start, one start waits at a time and a switch made meanwhile is the side heard', async () => {
		// A context that takes 300 ms to run, as a slow output may
		const slow = await browser.newContext({ baseURL: BROWSER_URL })
		await slow.addInitScript(() => {
			const resume = AudioContext.prototype.resume
			AudioContext.prototype.resume = function() {
				return new Promise((done) => setTimeout(done, 300)).then(() => resume.call(this))
			}
		})
		const page = await slow.newPage()
		await login(page)
		const open = async () => {
			await page.goto(`/apps/deliver/compare/${mix[1].id}/${mix[0].id}`)
			const videos = page.locator('.deliver-compare video')
			await expect(videos.first()).toHaveJSProperty('readyState', 4)
			await page.locator('.deliver-layout__bar h2').click()
			return videos
		}

		// Play, Pause and Play within the wait: each side is sought by the Pause and by the one start, never again while it plays
		let videos = await open()
		await videos.evaluateAll((all) => {
			window.seeks = [0, 0]
			all.forEach((video, side) => video.addEventListener('seeking', () => window.seeks[side]++))
		})
		await page.keyboard.press('Space')
		await page.keyboard.press('Space')
		await page.keyboard.press('Space')
		await page.waitForTimeout(1500)
		expect(await page.evaluate(() => window.seeks)).toEqual([2, 2])
		const state = await videos.evaluateAll((all) => all.map((video) => ({ paused: video.paused, time: video.currentTime })))
		expect(state.map((each) => each.paused)).toEqual([false, false])
		expect(Math.abs(state[1].time - state[0].time)).toBeLessThan(0.005)

		// A switch made while the context starts is the side heard once it runs
		videos = await open()
		await page.keyboard.press('Space')
		await page.waitForTimeout(100)
		await page.keyboard.press('2')
		await page.waitForTimeout(600)
		expect(await videos.evaluateAll((all) => all.map((video) => !!video.deliverGain && !video.muted))).toEqual([true, true])
		await expect.poll(() => heard(videos)).toEqual([false, true])
		await expect(page.getByRole('radio', { name: /^V2/ })).toHaveAttribute('aria-checked', 'true')
		await slow.close()
	})

	test('a looped Range alternating A and B plays A, then B, then A, switching at each wrap', async () => {
		await page.goto(`/apps/deliver/compare/${mix[1].id}/${mix[0].id}`)
		const videos = page.locator('.deliver-compare video')
		await expect(videos.first()).toHaveJSProperty('readyState', 4)
		// The Range from 5 s to 6 s of the 20, by the bar and I and O, and back to its start
		const bar = await page.locator('.deliver-compare__timeline').boundingBox()
		const at = (share) => page.mouse.click(bar.x + bar.width * share, bar.y + bar.height / 2)
		await at(0.25)
		await page.keyboard.press('i')
		await at(0.3)
		await page.keyboard.press('o')
		await expect(page.locator('.deliver-compare__chip')).toContainText(/0:05\.0\d\d – 0:06\.0\d\d/)
		await at(0.25)
		await page.getByRole('button', { name: 'Alternate A/B' }).click()
		// Alternating loops
		await expect(page.getByRole('button', { name: 'Loop the Range' })).toHaveAttribute('aria-pressed', 'true')

		// Whose sound plays on every animation frame, cut into passes where the time jumps back; where a pass starts is read
		// as A starts playing, as the next frame may come late, and from every frame, less what the output's clock went on since
		// the pass was sought (the frame before the time jumps back, or A starting to play), so that a jump right after it counts
		const passes = await page.evaluate(() => new Promise((resolve) => {
			const [a, b] = document.querySelectorAll('.deliver-compare video')
			const found = []
			let last = Infinity
			let sought
			const clock = () => a.deliverGain?.context.currentTime
			const cut = () => {
				const time = a.currentTime
				if (time < last - 0.3) {
					found.push({ from: sought && !a.seeking ? time - (clock() - sought) : time, to: time, heard: new Set(), at: sought })
				}
				last = time
				return time
			}
			a.addEventListener('playing', () => {
				cut()
				found.at(-1).at ??= clock()
			})
			const tick = () => {
				const time = cut()
				const gain = (video) => video.deliverGain && !video.muted ? video.deliverGain.gain.value > 0.5 : !video.muted
				const heard = gain(a) ? (gain(b) ? 'both' : 'a') : (gain(b) ? 'b' : 'none')
				const pass = found.at(-1)
				if (pass && !a.paused) {
					pass.to = time
					pass.heard.add(heard)
					if (pass.at) {
						pass.from = Math.max(pass.from, time - (clock() - pass.at))
					}
				}
				// The player seeks for the next pass in this very frame
				sought = a.paused ? undefined : clock()
				if (found.length > 3) {
					resolve(found.slice(0, 3).map((each) => ({ ...each, heard: [...each.heard] })))
				} else {
					requestAnimationFrame(tick)
				}
			}
			requestAnimationFrame(tick)
			document.querySelector('.deliver-compare__controls button[aria-label="Play (Space)"]').click()
		}))
		expect(passes.map((pass) => pass.heard)).toEqual([['a'], ['b'], ['a']])
		for (const pass of passes) {
			expect(pass.from).toBeCloseTo(5, 1)
			expect(pass.to).toBeGreaterThan(5.9)
			expect(pass.to).toBeLessThan(6.1)
		}
		await page.getByRole('button', { name: 'Pause (Space)' }).click()
		// The switch tells whose pass it is
		const now = (await heard(videos))[0] ? /^V1/ : /^V2/
		await expect(page.getByRole('radio', { name: now })).toHaveAttribute('aria-checked', 'true')
	})

	test('the Comments shown follow the side someone switches the sound to, named by its Version, and an alternating loop leaves the list alone', async ({ playwright }) => {
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		const made = []
		// Only the newest Version takes Comments: V1's list stays empty
		for (const [version, body] of [[mix[0], 'Heard on V2']]) {
			const commented = await api.post(`/ocs/v2.php/apps/deliver/api/v1/versions/${version.id}/comments?format=json`, { data: { inFrame: 1, body } })
			expect(commented.status(), await commented.text()).toBe(201)
			made.push((await commented.json()).ocs.data.id)
		}
		const heading = page.locator('.deliver-compare-view__heading')
		try {
			for (const pair of [cut, mix]) {
				await page.goto(`/apps/deliver/compare/${pair[1].id}/${pair[0].id}`)
				await expect(page.locator('.deliver-compare video').first()).toHaveJSProperty('readyState', 4)
				// No tabs: the heading, and on the mix, whose Comments the list holds
				await expect(page.getByRole('radio', { name: /^Comments on/ })).toHaveCount(0)
				const shows = async (number) => {
					await expect(heading).toHaveText(`Comments on V${number}`)
					if (pair === mix) {
						await expect(page.locator('.deliver-layout__panel')).toContainText(number === 2 ? 'Heard on V2' : 'No Comments yet.')
					}
				}
				await shows(1)
				await page.locator('.deliver-layout__bar h2').click()
				await page.keyboard.press('2')
				await shows(2)
				// The halves of the A/B switch
				await page.getByRole('radio', { name: /^V1/ }).click()
				await shows(1)
				await page.locator('.deliver-layout__bar h2').click()
				await page.keyboard.press('2')
				await shows(2)
				await page.keyboard.press('1')
				await shows(1)
			}
			// Tab, after a click into the player, and a lane's name
			await page.locator('.deliver-compare__lanes canvas').click()
			await page.keyboard.press('Tab')
			await expect(heading).toHaveText('Comments on V2')
			await page.locator('.deliver-wave__lane').first().click()
			await expect(heading).toHaveText('Comments on V1')

			// Alternating, the passes switch the sound but not the list: V2's Comments stay with the focus on one
			const bar = await page.locator('.deliver-compare__timeline').boundingBox()
			const at = (share) => page.mouse.click(bar.x + bar.width * share, bar.y + bar.height / 2)
			await at(0.25)
			await page.keyboard.press('i')
			await at(0.3)
			await page.keyboard.press('o')
			await at(0.25)
			await page.keyboard.press('2')
			await page.getByRole('button', { name: 'Alternate A/B' }).click()
			await expect(heading).toHaveText('Comments on V2')
			const anchor = page.locator('.deliver-compare-view__anchor')
			await anchor.focus()
			await page.evaluate(() => {
				window.passes = new Set()
				const halves = document.querySelectorAll('.deliver-compare__sound')
				new MutationObserver(() => window.passes.add(halves[0].getAttribute('aria-checked'))).observe(halves[0], { attributes: true })
			})
			await page.locator('.deliver-compare__controls button[aria-label="Play (Space)"]').evaluate((button) => button.click())
			// A pass of each side
			await expect.poll(() => page.evaluate(() => window.passes.size), { timeout: 15_000 }).toBe(2)
			await page.locator('.deliver-compare__controls button[aria-label="Pause (Space)"]').evaluate((button) => button.click())
			await expect(heading).toHaveText('Comments on V2')
			await expect(page.locator('.deliver-compare-view__list')).toHaveText(/Heard on V2/)
			await expect(anchor).toBeFocused()
		} finally {
			for (const id of made) {
				await api.delete(`/ocs/v2.php/apps/deliver/api/v1/comments/${id}?format=json`)
			}
			await api.dispose()
		}
	})

	test('a video Compare shows both Waveforms under the pictures when asked, and the pictures stay', async () => {
		await page.goto(`/apps/deliver/compare/${cut[1].id}/${cut[0].id}`)
		const videos = page.locator('.deliver-compare video')
		await expect(videos.first()).toHaveJSProperty('readyState', 4)
		await expect(page.locator('.deliver-compare__lanes')).toHaveCount(0)
		// The A/B switch replaces the small sound button of the bar
		await page.getByRole('radio', { name: /^V2/ }).click()
		await expect.poll(() => heard(videos)).toEqual([false, true])

		await page.getByRole('button', { name: 'Waveforms' }).click()
		await expect(page.locator('.deliver-compare__lanes canvas')).toBeVisible()
		await expect(page.locator('.deliver-compare__stage')).toBeVisible()
		for (const video of await videos.all()) {
			expect((await video.boundingBox()).height).toBeGreaterThan(100)
		}
		await page.getByRole('radio', { name: 'Wipe' }).click()
		await expect(page.locator('.deliver-compare__handle')).toBeVisible()
		await expect(page.locator('.deliver-compare__lanes canvas')).toBeVisible()
	})

	test('on a phone the Comment sheet pulled up takes the place of the pictures and Waveforms, and nothing of the player lies in it', async () => {
		const phone = await browser.newContext({ baseURL: BROWSER_URL, ...PHONE })
		const page = await phone.newPage()
		const errors = []
		page.on('pageerror', (error) => errors.push(error.message))
		await login(page)
		await page.goto(`/apps/deliver/compare/${cut[1].id}/${cut[0].id}`)
		await expect(page.locator('.deliver-compare video').first()).toHaveJSProperty('readyState', 4)
		await page.getByRole('button', { name: 'Playback settings' }).tap()
		await page.getByRole('menuitemcheckbox', { name: 'Waveforms' }).tap()
		await page.keyboard.press('Escape')
		await expect(page.locator('.deliver-compare__lanes canvas')).toBeVisible()
		const sheet = page.locator('.deliver-layout__panel')
		const grabber = page.locator('.deliver-layout__grabber')
		// Whatever of the player lies in the sheet's box, and whether a finger there reaches it
		const inSheet = () => page.evaluate(() => {
			const box = document.querySelector('.deliver-layout__panel').getBoundingClientRect()
			const found = []
			for (const element of document.querySelectorAll('.deliver-compare *')) {
				const each = element.getBoundingClientRect()
				if (each.width && each.height && each.bottom > box.top + 0.5 && each.top < box.bottom && each.right > box.left && each.left < box.right) {
					found.push(String(element.className?.baseVal ?? element.className))
				}
			}
			for (let y = box.top + 2; y < box.bottom; y += 8) {
				for (let x = box.left + 2; x < box.right; x += 8) {
					if (document.elementFromPoint(x, y)?.closest('.deliver-compare')) {
						found.push(`reached at ${x},${y}`)
					}
				}
			}
			return found
		})
		// The heights of the pictures and the Waveforms
		const folded = () => page.evaluate(() => ['.deliver-compare__stage', '.deliver-compare__lanes'].map((each) => document.querySelector(each).getBoundingClientRect().height))
		await grabber.tap()
		for (const width of [375, 390, 430]) {
			await page.setViewportSize({ width, height: PHONE.viewport.height })
			await expect(page.locator('.deliver-layout--middle')).toHaveCount(1)
			const halfway = (await sheet.boundingBox()).y
			expect(await inSheet()).toEqual([])
			await grabber.tap()
			await expect(page.locator('.deliver-layout--up')).toHaveCount(1)
			// Up, the list stands right under the A/B switch and the transport, well above its half height, as in the Review view
			const controls = await page.locator('.deliver-compare__controls').boundingBox()
			const top = (await sheet.boundingBox()).y
			expect(top).toBeLessThan(halfway - 100)
			expect(top).toBeCloseTo(controls.y + controls.height, 0)
			expect(await folded()).toEqual([0, 0])
			await expect(page.getByRole('radio', { name: /^V2/ })).toBeVisible()
			expect(await inSheet()).toEqual([])
			await grabber.tap()
		}
		// Sideways the list opens beside the pictures, clear of them too
		await page.setViewportSize({ width: 844, height: 390 })
		await page.getByRole('button', { name: 'Show Comments' }).tap()
		await expect(sheet).toBeVisible()
		expect(await inSheet()).toEqual([])

		// Two pieces of audio: their lanes, the view itself, fold away as the Review view's Waveform does
		await page.setViewportSize({ width: 390, height: PHONE.viewport.height })
		await page.goto(`/apps/deliver/compare/${mix[1].id}/${mix[0].id}`)
		await expect(page.locator('.deliver-compare video').first()).toHaveJSProperty('readyState', 4)
		await grabber.tap()
		await expect(page.locator('.deliver-layout--middle')).toHaveCount(1)
		const halfway = (await sheet.boundingBox()).y
		await grabber.tap()
		await expect(page.locator('.deliver-layout--up')).toHaveCount(1)
		expect(await folded()).toEqual([0, 0])
		const controls = await page.locator('.deliver-compare__controls').boundingBox()
		expect((await sheet.boundingBox()).y).toBeCloseTo(controls.y + controls.height, 0)
		expect((await sheet.boundingBox()).y).toBeLessThan(halfway - 100)
		expect(await inSheet()).toEqual([])
		// The Waveforms folded away to nothing and back draw on without an error
		expect(errors).toEqual([])
		await phone.close()
	})

	test('on a phone the grabber of Compare\'s sheet sits in the heading\'s row at its middle and top height, as in the Review view, beside the heading and clear of the list', async ({ playwright }) => {
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		const commented = await api.post(`/ocs/v2.php/apps/deliver/api/v1/versions/${cut[0].id}/comments?format=json`, { data: { inFrame: 1, body: 'On V2' } })
		expect(commented.status(), await commented.text()).toBe(201)
		const phone = await browser.newContext({ baseURL: BROWSER_URL, ...PHONE, viewport: { width: 375, height: 667 } })
		try {
			const page = await phone.newPage()
			await login(page)
			// V2 leads, so its Comment is in the list
			await page.goto(`/apps/deliver/compare/${cut[0].id}/${cut[1].id}`)
			await expect(page.locator('.deliver-compare video').first()).toHaveJSProperty('readyState', 4)
			const grabber = page.locator('.deliver-layout__grabber')
			const heading = page.locator('.deliver-compare-view__heading')
			for (const level of ['middle', 'up']) {
				await grabber.tap()
				await expect(page.locator(`.deliver-layout--${level}`)).toHaveCount(1)
				const grab = await grabber.boundingBox()
				// In the heading's row, not a row of its own above it
				const head = await heading.boundingBox()
				expect(grab.y).toBeLessThan(head.y + head.height / 2)
				expect(grab.y + grab.height).toBeGreaterThan(head.y + head.height)
				expect(grab.y + grab.height).toBeLessThanOrEqual((await page.locator('.deliver-compare-view__list li').boundingBox()).y)
				const text = await heading.evaluate((element) => {
					const range = document.createRange()
					range.selectNodeContents(element)
					return range.getBoundingClientRect().right
				})
				// The handle drawn in the grabber's middle, 40 px wide, stays off the heading's text
				expect(text).toBeLessThan(grab.x + grab.width / 2 - 20)
			}
		} finally {
			await phone.close()
			await api.delete(`/ocs/v2.php/apps/deliver/api/v1/comments/${(await commented.json()).ocs.data.id}?format=json`)
			await api.dispose()
		}
	})

	test('on a phone held sideways, pictures, both lanes and the transport fit without scrolling', async () => {
		const phone = await browser.newContext({ baseURL: BROWSER_URL, ...PHONE, viewport: { width: 844, height: 390 } })
		const sideways = await phone.newPage()
		await login(sideways)
		await sideways.goto(`/apps/deliver/compare/${cut[1].id}/${cut[0].id}`)
		await expect(sideways.locator('.deliver-compare video').first()).toHaveJSProperty('readyState', 4)
		await sideways.getByRole('button', { name: 'Playback settings' }).click()
		await sideways.getByRole('menuitemcheckbox', { name: 'Waveforms' }).click()
		await sideways.keyboard.press('Escape')
		await expect(sideways.locator('.deliver-compare__lanes canvas')).toBeVisible()
		const stage = await sideways.locator('.deliver-compare__stage').boundingBox()
		const controls = await sideways.locator('.deliver-compare__controls').boundingBox()
		expect(stage.height).toBeGreaterThan(80)
		expect(controls.y + controls.height).toBeLessThanOrEqual(390)
		const sound = await sideways.getByRole('radio', { name: /^V1/ }).boundingBox()
		expect(sound.height).toBeGreaterThanOrEqual(44)
		await expectDivider(sideways)
		await phone.close()
	})
})

test.describe('Skipping ten seconds', () => {
	let browser
	let context
	let page
	let folder
	let projectId
	let versionId

	test.beforeAll(async ({ playwright }) => {
		await testUser(playwright)
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		folder = 'deliver-e2e-' + randomBytes(4).toString('hex')
		const dav = `/remote.php/dav/files/${USER}/${folder}`
		expect((await api.fetch(dav, { method: 'MKCOL' })).status()).toBe(201)
		expect((await api.fetch(`${dav}/long.webm`, { method: 'PUT', data: readFileSync(LONG) })).status()).toBe(201)
		const created = await api.post('/ocs/v2.php/apps/deliver/api/v1/projects?format=json', { data: { folderId: await fileId(api, dav), autoIntake: true } })
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

	test('the buttons and Shift+arrows jump ten seconds and keep the playback state', async () => {
		await page.goto(`/apps/deliver/versions/${versionId}`)
		const video = page.locator('video.deliver-player__video')
		await expect(video).toHaveJSProperty('readyState', 4)
		const time = () => video.evaluate((element) => element.currentTime)

		await page.getByRole('button', { name: /^Forward 10 seconds/ }).click()
		await expect.poll(time).toBeCloseTo(10, 0)
		expect(await video.evaluate((element) => element.paused)).toBe(true)
		await page.getByRole('button', { name: /^Back 10 seconds/ }).click()
		await expect.poll(time).toBeCloseTo(0, 0)

		await page.getByRole('button', { name: /^Play \(/ }).click()
		await expect.poll(time).toBeGreaterThan(0.1)
		await page.locator('.deliver-review__title').click()
		const beforeForward = await time()
		await page.keyboard.press('Shift+ArrowRight')
		await page.waitForTimeout(300)
		expect(await time()).toBeGreaterThan(beforeForward + 9.5)
		expect(await video.evaluate((element) => element.paused)).toBe(false)
		const beforeBack = await time()
		await page.keyboard.press('Shift+ArrowLeft')
		await page.waitForTimeout(300)
		expect(await time()).toBeLessThan(beforeBack - 9)
		expect(await video.evaluate((element) => element.paused)).toBe(false)
	})

	test('a finger held on the bar opens a zoomed section above it and seeks through it; a quick drag stays the bar\'s (#273)', async () => {
		const phone = await browser.newContext({ baseURL: BROWSER_URL, ...PHONE })
		const touchPage = await phone.newPage()
		await login(touchPage)
		await touchPage.goto(`/apps/deliver/versions/${versionId}`)
		const video = touchPage.locator('video.deliver-player__video')
		await expect.poll(() => video.evaluate((element) => element.duration)).toBeCloseTo(30, 0)
		const cdp = await phone.newCDPSession(touchPage)
		const bar = await touchPage.locator('.deliver-player__timeline').boundingBox()
		const y = bar.y + bar.height / 2
		const touch = (type, x) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
		const frame = () => video.evaluate((element) => Math.floor(element.currentTime * 25 + 0.001))
		const paused = () => video.evaluate((element) => element.paused)
		const loupe = touchPage.locator('.deliver-player__loupe')
		const x = bar.x + bar.width / 2
		const onBar = (px) => Math.floor((px - bar.x) / bar.width * 750)

		// A quick drag goes through the whole piece, as ever
		await touch('touchStart', x)
		await touch('touchMove', x + bar.width * 0.2)
		await expect.poll(frame).toBe(onBar(x + bar.width * 0.2))
		await touch('touchEnd')
		await expect(loupe).toHaveCount(0)

		// Held still, a tenth of the piece opens above the bar, as wide as it, the playhead where the finger came down
		await touch('touchStart', x)
		await expect(loupe).toBeVisible()
		const at = onBar(x)
		expect(await frame()).toBe(at)
		const box = await loupe.boundingBox()
		expect(box.y + box.height).toBeLessThanOrEqual(bar.y)
		expect(box.x).toBeGreaterThanOrEqual(0)
		expect(box.x + box.width).toBeLessThanOrEqual(390)
		// Opaque, so nothing under it shows through
		await expect(loupe).toHaveCSS('background-color', 'rgb(0, 0, 0)')
		// Its ends are as far as the finger reaches, beyond the bar's ends too
		const ends = loupe.locator('.deliver-player__loupe-ends span')
		await expect(ends).toHaveCount(2)
		for (const [end, px] of [[1, bar.x + bar.width + 20], [0, bar.x - 20]]) {
			await touch('touchMove', px)
			await expect(touchPage.locator('.deliver-player__hover-time')).toHaveText(await ends.nth(end).textContent())
		}
		// The finger seeks through those three seconds, the Frame over it
		await touch('touchMove', x + bar.width * 0.4)
		const there = at + Math.round(0.4 * 75)
		await expect.poll(frame).toBe(there)
		await expect(touchPage.locator('.deliver-player__hover-time')).toHaveText('00:00:16:05')
		// Letting go keeps the place and opens nothing
		await touch('touchEnd')
		await expect(loupe).toHaveCount(0)
		await touchPage.waitForTimeout(300)
		expect(await frame()).toBe(there)
		expect(await paused()).toBe(true)
		await expect(touchPage.locator('[role="dialog"], .deliver-comment--selected')).toHaveCount(0)

		// A second finger on the bar starts no hold of its own: a drag goes on through the whole piece
		const fingers = (type, one, two) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: two === undefined ? [{ x: one, y, id: 0 }] : [{ x: one, y, id: 0 }, { x: two, y, id: 1 }] })
		await fingers('touchStart', x)
		await touchPage.waitForTimeout(60)
		await fingers('touchStart', x, x + 60)
		await fingers('touchMove', x + 50, x + 60)
		await touchPage.waitForTimeout(700)
		await expect(loupe).toHaveCount(0)
		await touch('touchEnd')

		// Playing, a hold holds playback as a drag does and lets it go on
		await touchPage.getByRole('button', { name: 'Play', exact: true }).tap()
		await expect.poll(paused).toBe(false)
		await touch('touchStart', x)
		await expect(loupe).toBeVisible()
		expect(await paused()).toBe(true)
		await touch('touchEnd')
		await expect.poll(paused).toBe(false)
		await phone.close()
	})
})

test.describe('Uploads whose name is taken', () => {
	let api
	let dav
	let projectId
	let browser
	let context
	let page

	test.beforeAll(async ({ playwright }) => {
		await testUser(playwright)
	})

	// A Folder Project with one mix in it, open in the Project view
	test.beforeEach(async ({ playwright }) => {
		api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		dav = `/remote.php/dav/files/${USER}/deliver-e2e-${randomBytes(4).toString('hex')}`
		expect((await api.fetch(dav, { method: 'MKCOL' })).status()).toBe(201)
		const created = await api.post('/ocs/v2.php/apps/deliver/api/v1/projects?format=json', { data: { folderId: await fileId(api, dav), autoIntake: true } })
		projectId = (await created.json()).ocs.data.id
		expect((await api.fetch(`${dav}/mix.wav`, { method: 'PUT', data: readFileSync(MIX) })).status()).toBe(201)
		browser = await chromium.connectOverCDP(CDP)
		context = await browser.newContext({ baseURL: BROWSER_URL })
		page = await context.newPage()
		await login(page)
		await page.goto(`/apps/deliver/projects/${projectId}`)
	})

	test.afterEach(async () => {
		await context?.close()
		await browser?.close()
		await api.delete(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)
		await api.fetch(dav, { method: 'DELETE' })
		await api.dispose()
	})

	const assets = async () => (await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)).json()).ocs.data.assets
	const versions = async () => (await assets()).map((asset) => asset.versions.map((version) => [version.name, version.number, version.autoStacked]))
	// Another file than the one there, which must stay as it is
	const other = Buffer.concat([readFileSync(MIX), Buffer.alloc(2)])

	test('a new Version gets its number in its name, wherever it is uploaded, and replaces nothing', async () => {
		// Another upload, interrupted, that was on its way to the name this one takes
		const interrupted = await page.evaluate((target) => {
			const record = { name: 'elsewhere.wav', size: 1, lastModified: 1, type: 'audio/wav', target, projectId: null, assetId: 1, folder: '/remote.php/dav/uploads/none', loaded: 0, status: 'uploading', seen: Date.now(), left: true }
			localStorage.setItem(`deliver.upload:${target}`, JSON.stringify(record))
			return `deliver.upload:${target}`
		}, `${BROWSER_URL}${dav}/mix_v2.wav`)
		await card(page, 'mix').click({ button: 'right' })
		let chooser = page.waitForEvent('filechooser')
		await page.getByRole('menuitem', { name: 'Upload a new Version' }).click()
		await (await chooser).setFiles({ name: 'mix.wav', mimeType: 'audio/wav', buffer: other })
		// The Member's own choice, so nothing to undo, though Auto Intake goes by the name
		await expect.poll(versions).toEqual([[['mix_v2.wav', 2, false], ['mix.wav', 1, false]]])
		expect((await api.fetch(`${dav}/mix.wav`, { method: 'HEAD' })).headers()['content-length']).toBe(String(readFileSync(MIX).length))
		await page.locator('.deliver-uploads-card__open').click()
		const uploads = page.getByRole('dialog', { name: 'Uploads' })
		await expect(uploads.locator('.deliver-uploads__name', { hasText: 'mix_v2.wav' })).toHaveCount(1)
		expect(await page.evaluate((key) => localStorage.getItem(key), interrupted)).not.toBeNull()
		await page.keyboard.press('Escape')

		// The next number is taken by a file outside the Stack, so the one after it
		expect((await api.fetch(`${dav}/mix_v3.wav`, { method: 'PUT', data: 'not a Version', headers: { 'If-None-Match': '*' } })).status()).toBe(201)
		const stray = (await assets()).find((asset) => asset.versions.some((version) => version.name === 'mix_v3.wav'))
		const strayed = stray.versions.find((version) => version.name === 'mix_v3.wav')
		if (stray.versions.length > 1) {
			expect((await api.post(`/ocs/v2.php/apps/deliver/api/v1/versions/${strayed.id}/unstack?format=json`)).ok()).toBe(true)
		}
		await page.reload()
		const stack = page.locator('.deliver-card', { hasText: 'V2' })
		await stack.click({ button: 'right' })
		await page.getByRole('menuitem', { name: 'Manage Versions' }).click()
		await expect(page.locator('.deliver-stack')).toBeVisible()
		await page.evaluate((bytes) => {
			const files = new DataTransfer()
			files.items.add(new File([new Uint8Array(bytes)], 'mix_v2.wav', { type: 'audio/wav' }))
			document.querySelector('.deliver-stack').dispatchEvent(new DragEvent('drop', { dataTransfer: files, bubbles: true, cancelable: true }))
		}, [...other])
		await expect.poll(async () => (await versions()).find((names) => names.length === 3)?.[0][0]).toBe('mix_v4.wav')

		// The button in the Review view, where a name that is free stays as it is
		const newest = (await assets()).find((asset) => asset.versions.length === 3).versions[0]
		await page.goto(`/apps/deliver/versions/${newest.id}`)
		chooser = page.waitForEvent('filechooser')
		await page.getByRole('button', { name: 'New Version' }).click()
		await (await chooser).setFiles({ name: 'master.wav', mimeType: 'audio/wav', buffer: other })
		await expect.poll(async () => (await versions()).find((names) => names.length === 4)?.[0][0]).toBe('master.wav')
	})

	test('an upload is renamed in its row, with the keyboard, and told why a name does not do', async () => {
		await page.getByRole('button', { name: 'Upload', exact: true }).click()
		const uploads = page.getByRole('dialog', { name: 'Uploads' })
		await uploads.locator('input[type=file][multiple]').setInputFiles({ name: 'mix.wav', mimeType: 'audio/wav', buffer: other })
		const field = uploads.getByLabel('New name')
		await expect(field).toHaveValue('mix (2).wav')
		await expect(uploads.locator('.deliver-uploads__status--error')).toHaveText('A file with this name is already in the folder.')
		// It takes the focus from nobody; opened again, the dialog goes there, with the name without its extension selected
		await expect(field).not.toBeFocused()
		await page.keyboard.press('Escape')
		await page.locator('.deliver-uploads-card__open').click()
		await expect(field).toBeFocused()
		await expect(field).toHaveAccessibleName('New name for mix.wav')
		await expect(field).toHaveAccessibleDescription('A file with this name is already in the folder.')
		expect(await field.evaluate((input) => input.value.slice(input.selectionStart, input.selectionEnd))).toBe('mix (2)')

		// Escape leaves the upload refused, and the dialog open
		await page.keyboard.press('Escape')
		await expect(field).toHaveCount(0)
		await expect(uploads.getByRole('button', { name: 'Rename…' })).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(field).toBeFocused()

		const form = uploads.locator('.deliver-upload-rename')
		for (const [name, why] of [['mix.mp3', 'Keep the extension .wav.'], ['a/b.wav', '"/" is not allowed in a filename.'], ['mix.wav', '"mix.wav" is already in the folder.'], [`${'a'.repeat(250)}.wav`, 'This name is too long.']]) {
			await field.fill(name)
			await page.keyboard.press('Enter')
			await expect(form.getByRole('alert')).toHaveText(why)
			await expect(field).toBeFocused()
		}
		// From the button too, the focus comes back to the field
		await field.fill('mix.wav')
		await page.keyboard.press('Tab')
		await expect(form.getByRole('button', { name: 'Rename and upload' })).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(form.getByRole('alert')).toHaveText('"mix.wav" is already in the folder.')
		await expect(field).toBeFocused()

		// Escape while the name is checked leaves the upload refused
		let release
		const held = new Promise((resolve) => {
			release = resolve
		})
		await page.route('**/never.wav', async (route) => {
			await held
			await route.continue()
		})
		await field.fill('never.wav')
		const asked = page.waitForRequest('**/never.wav')
		await page.keyboard.press('Enter')
		await asked
		await page.keyboard.press('Escape')
		const answered = page.waitForResponse('**/never.wav')
		release()
		await answered
		await page.keyboard.press('Enter')
		await expect(field).toBeFocused()

		// A name the server does not take is asked for again
		let refused = 0
		await page.route('**/other%20mix.wav', (route) => route.request().method() === 'PUT' && ++refused === 1 ? route.fulfill({ status: 400 }) : route.continue())
		await field.fill('other mix.wav')
		await page.keyboard.press('Enter')
		await expect(uploads.locator('.deliver-uploads__status--error')).toHaveText('This name is not allowed.')
		await expect(field).toHaveValue('mix (2).wav')
		await field.focus()
		await field.fill('other mix.wav')
		await page.keyboard.press('Enter')
		await expect(uploads.getByText('Open', { exact: true })).toBeVisible()
		await expect(uploads.locator('.deliver-uploads__name')).toHaveText('other mix.wav')
		// Whoever was in the field stays with its upload
		await expect(uploads.locator('.deliver-uploads__item')).toBeFocused()
		expect((await versions()).flat().map(([name]) => name).sort()).toEqual(['mix.wav', 'other mix.wav'])
		expect((await api.fetch(`${dav}/mix.wav`, { method: 'HEAD' })).headers()['content-length']).toBe(String(readFileSync(MIX).length))
	})

	test('an upload dropped on the Project is renamed in the card in the corner', async () => {
		await page.evaluate((bytes) => {
			const files = new DataTransfer()
			files.items.add(new File([new Uint8Array(bytes)], 'mix.wav', { type: 'audio/wav' }))
			document.querySelector('.deliver-project').dispatchEvent(new DragEvent('drop', { dataTransfer: files, bubbles: true, cancelable: true }))
		}, [...other])
		const corner = page.locator('.deliver-uploads-card')
		await expect(corner.getByLabel('New name')).toHaveValue('mix (2).wav')
		// Whoever is typing elsewhere is not interrupted
		await expect(corner.getByLabel('New name')).not.toBeFocused()
		await corner.getByRole('button', { name: 'Rename and upload' }).click()
		await expect.poll(async () => (await versions()).flat().map(([name]) => name).sort()).toEqual(['mix (2).wav', 'mix.wav'])
		await expect(corner.getByLabel('New name')).toHaveCount(0)
	})

	test('an upload is renamed on a phone, by touch, or cancelled', async () => {
		await context.close()
		context = await browser.newContext({ baseURL: BROWSER_URL, ...PHONE })
		page = await context.newPage()
		await login(page)
		await page.goto(`/apps/deliver/projects/${projectId}`)
		await page.getByRole('button', { name: 'Upload', exact: true }).tap()
		const uploads = page.getByRole('dialog', { name: 'Uploads' })
		await uploads.locator('input[type=file][multiple]').setInputFiles([
			{ name: 'mix.wav', mimeType: 'audio/wav', buffer: other },
			{ name: 'mix.wav', mimeType: 'audio/wav', buffer: other },
		])
		const fields = uploads.getByLabel('New name')
		await expect(fields).toHaveCount(2)
		expect(await fields.evaluateAll((inputs) => inputs.map((input) => input.value))).toEqual(['mix (2).wav', 'mix (3).wav'])
		await uploads.getByRole('button', { name: 'Cancel the upload of mix.wav' }).last().tap()
		await expect(fields).toHaveCount(1)
		expect(await uploads.locator('.deliver-uploads').evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0)
		// Taken meanwhile, the suggestion gives way to the next one
		expect((await api.fetch(`${dav}/mix%20(2).wav`, { method: 'PUT', data: readFileSync(MIX) })).status()).toBe(201)
		await uploads.getByRole('button', { name: 'Rename and upload' }).tap()
		await expect(uploads.getByRole('alert')).toHaveText('"mix (2).wav" is already in the folder.')
		await expect(fields).toHaveValue('mix (3).wav')
		await uploads.getByRole('button', { name: 'Rename and upload' }).tap()
		await expect(uploads.getByText('Open', { exact: true })).toBeVisible()
		expect((await versions()).flat().map(([name]) => name).sort()).toEqual(['mix (2).wav', 'mix (3).wav', 'mix.wav'])
	})

	test('an upload whose answer was lost offers no other name, since the file there may be itself', async () => {
		let lost = false
		await page.route('**/lost.wav', async (route) => {
			if (route.request().method() === 'PUT' && !lost) {
				lost = true
				await api.fetch(`${dav}/lost.wav`, { method: 'PUT', data: other })
				await route.abort()
			} else {
				await route.continue()
			}
		})
		await page.getByRole('button', { name: 'Upload', exact: true }).click()
		const uploads = page.getByRole('dialog', { name: 'Uploads' })
		await uploads.locator('input[type=file][multiple]').setInputFiles({ name: 'lost.wav', mimeType: 'audio/wav', buffer: other })
		const said = uploads.locator('.deliver-uploads__status--error')
		for (let tries = 0; tries < 2; tries++) {
			await expect(said).toHaveText('A file with this name is already in the folder.')
			await expect(uploads.getByLabel('New name')).toHaveCount(0)
			await uploads.getByRole('button', { name: 'Try again' }).click()
		}
		await expect(said).toHaveText('A file with this name is already in the folder.')
		expect((await versions()).flat().map(([name]) => name).sort()).toEqual(['lost.wav', 'mix.wav'])
	})
})

test.describe('Uploads without ffmpeg', () => {
	let admin
	let projectId

	test.beforeAll(async ({ playwright }) => {
		await testUser(playwright)
		admin = await playwright.request.newContext({ baseURL: URL, httpCredentials: { username: ADMIN, password: ADMIN_PASSWORD, send: 'always' }, extraHTTPHeaders: ocsHeaders })
		expect((await admin.put('/ocs/v2.php/apps/deliver/api/v1/admin/settings?format=json', { data: { ffmpegPath: '/nonexistent/ffmpeg', ffprobePath: '/nonexistent/ffprobe' } })).ok()).toBe(true)
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		const dav = `/remote.php/dav/files/${USER}/deliver-e2e-${randomBytes(4).toString('hex')}`
		expect((await api.fetch(dav, { method: 'MKCOL' })).status()).toBe(201)
		const created = await api.post('/ocs/v2.php/apps/deliver/api/v1/projects?format=json', { data: { folderId: await fileId(api, dav) } })
		projectId = (await created.json()).ocs.data.id
		await api.dispose()
	})

	test.afterAll(async () => {
		await admin.put('/ocs/v2.php/apps/deliver/api/v1/admin/settings?format=json', { data: { ffmpegPath: '', ffprobePath: '' } })
		await admin.dispose()
	})

	test('refuses what this browser can neither play nor convert, before it goes up, and takes what plays', async () => {
		const browser = await chromium.connectOverCDP(CDP)
		const context = await browser.newContext({ baseURL: BROWSER_URL })
		const page = await context.newPage()
		try {
			await login(page)
			await page.goto(`/apps/deliver/projects/${projectId}`)
			await page.getByRole('button', { name: 'Upload', exact: true }).click()
			const uploads = page.getByRole('dialog', { name: 'Uploads' })
			await uploads.locator('input[type=file][multiple]').setInputFiles({ name: 'master.mov', mimeType: 'video/quicktime', buffer: readFileSync(DNXHR) })
			await expect(uploads.locator('.deliver-uploads__status--error')).toContainText('This format needs ffmpeg, which this Nextcloud lacks.')
			await expect(uploads.getByText('Open', { exact: true })).toHaveCount(0)

			// What plays as it is goes up as ever
			await uploads.locator('input[type=file][multiple]').setInputFiles({ name: 'mix.wav', mimeType: 'audio/wav', buffer: readFileSync(MIX) })
			await expect(uploads.getByText('Open', { exact: true })).toHaveCount(1)
			await expect(uploads.locator('.deliver-uploads__status--error')).toHaveCount(1)
		} finally {
			await context.close()
		}
	})

	test('a cancel while the file is checked leaves nothing behind', async ({ playwright }) => {
		const browser = await chromium.connectOverCDP(CDP)
		const context = await browser.newContext({ baseURL: BROWSER_URL })
		const page = await context.newPage()
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		try {
			await login(page)
			await page.goto(`/apps/deliver/projects/${projectId}`)
			await page.getByRole('button', { name: 'Upload', exact: true }).click()
			const uploads = page.getByRole('dialog', { name: 'Uploads' })
			// Mediabunny loads lazily when the check starts; hold its chunks back so the cancel comes first
			let release
			const held = new Promise((resolve) => {
				release = resolve
			})
			await page.route('**/*.chunk.mjs*', async (route) => {
				await held
				await route.continue()
			})
			await uploads.locator('input[type=file][multiple]').setInputFiles({ name: 'cancelled.wav', mimeType: 'audio/wav', buffer: readFileSync(MIX) })
			await uploads.getByRole('button', { name: 'Cancel the upload of cancelled.wav' }).click()
			await expect(uploads.getByText('cancelled.wav')).toHaveCount(0)
			release()
			// The next upload only starts once the cancelled one has let go, so when it is done, a stray one would be too
			await uploads.locator('input[type=file][multiple]').setInputFiles({ name: 'after-cancel.wav', mimeType: 'audio/wav', buffer: readFileSync(MIX) })
			await expect(uploads.getByText('Open', { exact: true })).toHaveCount(1)
			const project = await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)).json()
			const names = project.ocs.data.assets.map((asset) => asset.versions[0].name)
			expect(names).toContain('after-cancel.wav')
			expect(names).not.toContain('cancelled.wav')
			await expect(uploads.getByText('cancelled.wav')).toHaveCount(0)
		} finally {
			await api.dispose()
			await context.close()
		}
	})

	test('a renamed upload keeps what this browser made of it', async () => {
		// Six minutes of sound and a video, each decoded and handed in
		test.setTimeout(120000)
		const browser = await chromium.connectOverCDP(CDP)
		const context = await browser.newContext({ baseURL: BROWSER_URL })
		const page = await context.newPage()
		try {
			await page.addInitScript(() => {
				window.decoders = 0
				for (const kind of ['AudioDecoder', 'VideoDecoder']) {
					window[kind] = class extends window[kind] {
						constructor(init) {
							super(init)
							window.decoders++
						}
					}
				}
			})
			const decoders = () => page.evaluate(() => window.decoders)
			await login(page)
			await page.goto(`/apps/deliver/projects/${projectId}`)
			await page.getByRole('button', { name: 'Upload', exact: true }).click()
			const uploads = page.getByRole('dialog', { name: 'Uploads' })
			const picker = uploads.locator('input[type=file][multiple]')
			const opened = uploads.getByText('Open', { exact: true })
			for (const [index, file] of [
				{ name: 'song.ogg', mimeType: 'audio/ogg', buffer: readFileSync(LONG_MIX) },
				{ name: 'again.webm', mimeType: 'video/webm', buffer: readFileSync(CLIP) },
			].entries()) {
				// The Waveform of the one; the pass and the Thumbnail Strip of the other
				const [first, second] = [[1, 2], [4, 6]][index]
				await picker.setInputFiles(file)
				await expect(opened).toHaveCount(2 * index + 1)
				await expect(uploads.locator('.deliver-uploads__made')).toHaveCount(first, { timeout: 30000 })

				const before = await decoders()
				await picker.setInputFiles(file)
				await expect(uploads.getByLabel('New name')).toBeVisible()
				// It is made while the name is asked for
				await expect.poll(decoders).toBeGreaterThan(before)
				const made = await decoders()
				// Finished before it has a name, it does not stay at the last percent
				await expect(uploads.locator('.deliver-uploads__item').last()).not.toContainText('Encoding')
				await uploads.getByRole('button', { name: 'Rename and upload' }).click()
				await expect(opened).toHaveCount(2 * index + 2)
				await expect(uploads.locator('.deliver-uploads__made')).toHaveCount(second, { timeout: 30000 })
				expect(await decoders()).toBe(made)
			}
		} finally {
			await context.close()
		}
	})

	test('a Member uploads a Proxy of their own from the Asset card and removes it (ADR 0020)', async ({ playwright }) => {
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		const dav = `/remote.php/dav/files/${USER}/deliver-e2e-${randomBytes(4).toString('hex')}`
		expect((await api.fetch(dav, { method: 'MKCOL' })).status()).toBe(201)
		const created = await api.post('/ocs/v2.php/apps/deliver/api/v1/projects?format=json', { data: { folderId: await fileId(api, dav), autoIntake: true } })
		const id = (await created.json()).ocs.data.id
		expect((await api.fetch(`${dav}/master.mov`, { method: 'PUT', data: readFileSync(DNXHR) })).status()).toBe(201)
		// The probe, so the card knows the Version gets a Proxy
		execFileSync('docker', ['compose', 'exec', '-T', '-u', 'www-data', 'nextcloud', 'php', 'occ', 'deliver:worker', '--once'], { stdio: 'inherit' })
		const newest = async () => (await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${id}?format=json`)).json()).ocs.data.assets[0].versions[0]
		const browser = await chromium.connectOverCDP(CDP)
		const context = await browser.newContext({ baseURL: BROWSER_URL })
		const page = await context.newPage()
		try {
			await login(page)
			await page.goto(`/apps/deliver/projects/${id}`)
			await card(page, 'master').click({ button: 'right' })
			const chooser = page.waitForEvent('filechooser')
			await page.getByRole('menuitem', { name: 'Upload Proxy…' }).click()
			await (await chooser).setFiles({ name: 'master.proxy.mp4', mimeType: 'video/mp4', buffer: readFileSync(HAND_PROXY) })
			await expect.poll(async () => (await newest()).proxyHandedIn).toBe(true)
			// The card shows the upload until the server's answer is in, and its menu follows once the Project is read again
			await expect(async () => {
				await page.keyboard.press('Escape')
				await card(page, 'master').click({ button: 'right' })
				await expect(page.getByRole('menuitem', { name: 'Remove Proxy' })).toBeVisible({ timeout: 1000 })
			}).toPass()
			// The browser's pass from the hand Proxy is over by then: where it decodes H.264 it made the strip from it,
			// where it does not (CI's Chromium) that is no error, as the Proxy is in (#168)
			await expect(page.locator('.notecard--error')).toHaveCount(0)
			if (await page.evaluate(async () => (await VideoDecoder.isConfigSupported({ codec: 'avc1.42001e' })).supported)) {
				const shown = await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/versions/${(await newest()).id}?format=json`)).json()
				expect(shown.ocs.data.versions[0].derived.thumbs.state).toBe('ready')
			}
			// Another one of their own would replace it
			await expect(page.getByRole('menuitem', { name: 'Upload Proxy…' })).toBeVisible()
			await page.getByRole('menuitem', { name: 'Remove Proxy' }).click()
			await expect.poll(async () => (await newest()).proxyHandedIn).toBe(false)
			await card(page, 'master').click({ button: 'right' })
			await expect(page.getByRole('menuitem', { name: 'Upload Proxy…' })).toBeVisible()
			await expect(page.getByRole('menuitem', { name: 'Remove Proxy' })).toHaveCount(0)
			// Only the master became an Asset: the upload was hidden and is gone
			expect((await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${id}?format=json`)).json()).ocs.data.assets).toHaveLength(1)
		} finally {
			await context.close()
			await api.delete(`/ocs/v2.php/apps/deliver/api/v1/projects/${id}?format=json`)
			await api.fetch(dav, { method: 'DELETE' })
			await api.dispose()
		}
	})
	test('a video that needs no Proxy, uploaded in the Files app where Auto Intake takes it, gets its strip from this browser (#168)', async ({ playwright }) => {
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		const folder = `deliver-e2e-${randomBytes(4).toString('hex')}`
		const dav = `/remote.php/dav/files/${USER}/${folder}`
		expect((await api.fetch(dav, { method: 'MKCOL' })).status()).toBe(201)
		const created = await api.post('/ocs/v2.php/apps/deliver/api/v1/projects?format=json', { data: { folderId: await fileId(api, dav), autoIntake: true } })
		const id = (await created.json()).ocs.data.id
		const browser = await chromium.connectOverCDP(CDP)
		const context = await browser.newContext({ baseURL: BROWSER_URL })
		const page = await context.newPage()
		const derived = async () => {
			const versionId = (await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${id}?format=json`)).json()).ocs.data.assets[0]?.versions[0].id
			return versionId && (await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/versions/${versionId}?format=json`)).json()).ocs.data.versions[0].derived
		}
		try {
			await login(page)
			await page.goto(`/apps/files/files?dir=/${folder}`)
			await page.locator('input[type=file]').first().setInputFiles({ name: 'clip.webm', mimeType: 'video/webm', buffer: readFileSync(CLIP) })
			// VP9 plays as it is, so no Proxy; the pass decodes it all the same, also without an H.264 encoder for the Scrub Proxy
			await expect.poll(async () => (await derived())?.thumbs.state, { timeout: 60_000 }).toBe('ready')
			expect((await derived()).proxy.state).toBe('none')
		} finally {
			await context.close()
			await api.delete(`/ocs/v2.php/apps/deliver/api/v1/projects/${id}?format=json`)
			await api.fetch(dav, { method: 'DELETE' })
			await api.dispose()
		}
	})

	test('the Asset card offers to make missing derived media in this browser only while something is missing, and never with ffmpeg (#168)', async ({ playwright }) => {
		const api = await playwright.request.newContext({ baseURL: URL, httpCredentials: auth, extraHTTPHeaders: ocsHeaders })
		const dav = `/remote.php/dav/files/${USER}/deliver-e2e-${randomBytes(4).toString('hex')}`
		expect((await api.fetch(dav, { method: 'MKCOL' })).status()).toBe(201)
		const created = await api.post('/ocs/v2.php/apps/deliver/api/v1/projects?format=json', { data: { folderId: await fileId(api, dav), autoIntake: true } })
		const id = (await created.json()).ocs.data.id
		// From a sync client: no browser made anything of it
		expect((await api.fetch(`${dav}/clip.webm`, { method: 'PUT', data: readFileSync(CLIP) })).status()).toBe(201)
		execFileSync('docker', ['compose', 'exec', '-T', '-u', 'www-data', 'nextcloud', 'php', 'occ', 'deliver:worker', '--once'], { stdio: 'inherit' })
		const newest = async () => (await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${id}?format=json`)).json()).ocs.data.assets[0].versions[0]
		const { id: versionId } = await newest()
		const browser = await chromium.connectOverCDP(CDP)
		const context = await browser.newContext({ baseURL: BROWSER_URL })
		const page = await context.newPage()
		const action = page.getByRole('menuitem', { name: 'Make missing derived media in this browser' })
		const menu = async () => {
			await page.keyboard.press('Escape')
			await card(page, 'clip').click({ button: 'right' })
		}
		try {
			await login(page)
			await page.goto(`/apps/deliver/projects/${id}`)
			// Offered once this browser has read the headers: it decodes VP9, even where it encodes no H.264 for a Scrub Proxy
			await expect(async () => {
				await menu()
				await expect(action).toBeVisible({ timeout: 1000 })
			}).toPass()
			await action.click()
			await expect.poll(async () => (await newest()).derivedFromBrowser, { timeout: 30_000 }).not.toContain('thumbs')
			const shown = await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/versions/${versionId}?format=json`)).json()
			expect(shown.ocs.data.versions[0].derived.thumbs.state).toBe('ready')

			// A Scrub Proxy from elsewhere, where this browser could not make one: nothing is missing any more
			const upload = `${dav}/.scrub-upload`
			expect((await api.fetch(upload, { method: 'PUT', data: readFileSync(CLIP_SCRUB) })).status()).toBe(201)
			const given = await api.post(`/ocs/v2.php/apps/deliver/api/v1/versions/${versionId}/scrub?format=json`, { data: { fileId: await fileId(api, upload) } })
			expect([200, 409]).toContain(given.status())
			await expect.poll(async () => (await newest()).derivedFromBrowser).toEqual([])
			await page.reload()
			await menu()
			await expect(page.getByRole('menuitem', { name: 'Open' })).toBeVisible()
			await expect(action).toHaveCount(0)

			// With ffmpeg the server makes it all
			expect((await api.post(`/ocs/v2.php/apps/deliver/api/v1/versions/${versionId}/regenerate?format=json`)).ok()).toBe(true)
			expect((await admin.put('/ocs/v2.php/apps/deliver/api/v1/admin/settings?format=json', { data: { ffmpegPath: '', ffprobePath: '' } })).ok()).toBe(true)
			await page.reload()
			await menu()
			await expect(page.getByRole('menuitem', { name: 'Open' })).toBeVisible()
			await expect(action).toHaveCount(0)
		} finally {
			await admin.put('/ocs/v2.php/apps/deliver/api/v1/admin/settings?format=json', { data: { ffmpegPath: '/nonexistent/ffmpeg', ffprobePath: '/nonexistent/ffprobe' } })
			await context.close()
			await api.delete(`/ocs/v2.php/apps/deliver/api/v1/projects/${id}?format=json`)
			await api.fetch(dav, { method: 'DELETE' })
			await api.dispose()
		}
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
	// The mate never logs in to the browser, but makes a link through the API
	const mate = await admin.post(`${users}?format=json`, { form: { userid: MATE, password: MATE_PASSWORD, displayName: 'Mara Mate' } })
	if (!mate.ok()) {
		expect((await admin.put(`${users}/${MATE}?format=json`, { form: { key: 'password', value: MATE_PASSWORD } })).ok()).toBe(true)
	}
	await admin.dispose()
}

/**
 * @param {import('@playwright/test').Page} page - the Project view
 * @param {string} name - an Asset's name; "8 seconds ago" below it would match "second" by text alone
 * @return {import('@playwright/test').Locator} its card
 */
function card(page, name) {
	return page.locator('.deliver-card').filter({ has: page.locator('.deliver-card__name', { hasText: new RegExp(`^\\s*${name}\\s*$`) }) })
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

/**
 * A click in the strip a quarter of the stage on seeks there, and C comments where it went
 * once the wave has glided: a click lands on what is drawn
 *
 * @param {import('@playwright/test').Page} page - the Review view
 * @param {import('@playwright/test').Locator} canvas - the Waveform's canvas
 * @param {{position: {x: number, y: number}}} quarterOn - where to click
 */
async function commentOnQuarter(page, canvas, quarterOn) {
	await expect.poll(() => canvas.evaluate((element) => Math.abs(element.drawnAt - document.querySelector('video.deliver-player__video').currentTime))).toBeLessThan(0.01)
	await canvas.click(quarterOn)
	await page.keyboard.press('c')
}
