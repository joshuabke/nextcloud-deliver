// 5e059a2a637ad4aa53f17c4f94dcb5f8fc571f22
import { chromium, expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CLIP, CLIP_SCRUB, CUT_A, CUT_B, DNXHR, HAND_PROXY, LONG, LONG_MIX, MIX, MIX_A, MIX_B } from './fixtures.js';
const URL = process.env.DELIVER_TEST_URL ?? 'http://localhost:8080';
const ADMIN = process.env.DELIVER_TEST_USER ?? 'admin';
const ADMIN_PASSWORD = process.env.DELIVER_TEST_PASSWORD ?? 'adminadmin123';
/** A user of its own, in English: the tests find buttons by their names, whatever language the admin speaks */
const USER = 'deliver-e2e';
const PASSWORD = 'deliver-e2e-' + randomBytes(12).toString('hex');
/** A second Member, someone to mention */
const MATE = 'deliver-e2e-mate';
const MATE_PASSWORD = 'mate-' + randomBytes(12).toString('hex');
const CDP = process.env.DELIVER_CDP ?? 'http://127.0.0.1:9222';
/** The browser may sit in its own container, where localhost is not Nextcloud */
const BROWSER_URL = process.env.DELIVER_BROWSER_URL ?? URL;
const auth = {
  username: USER,
  password: PASSWORD,
  send: 'always'
};
/** An iPhone as Nextcloud accepts it: a current Safari, touch, and its size */
const PHONE = {
  viewport: {
    width: 390,
    height: 844
  },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1'
};
const ocsHeaders = {
  'OCS-APIREQUEST': 'true',
  Accept: 'application/json'
};
test.describe('Review view', () => {
  let browser;
  let context;
  let page;
  let folder;
  let versionId;
  let projectId;
  test.beforeAll(async ({
    playwright
  }) => {
    await testUser(playwright);
    const api = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: auth,
      extraHTTPHeaders: ocsHeaders
    });
    folder = 'deliver-e2e-' + randomBytes(4).toString('hex');
    const dav = `/remote.php/dav/files/${USER}/${folder}`;
    expect((await api.fetch(dav, {
      method: 'MKCOL'
    })).status()).toBe(201);
    expect((await api.fetch(`${dav}/clip.webm`, {
      method: 'PUT',
      data: readFileSync(CLIP)
    })).status()).toBe(201);
    const shared = await api.post('/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json', {
      form: {
        path: `/${folder}`,
        shareType: 0,
        shareWith: MATE,
        permissions: 17
      }
    });
    expect(shared.ok()).toBe(true);
    const created = await api.post('/ocs/v2.php/apps/deliver/api/v1/projects?format=json', {
      data: {
        folderId: await fileId(api, dav),
        autoIntake: true
      }
    });
    projectId = (await created.json()).ocs.data.id;
    const project = await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`);
    versionId = (await project.json()).ocs.data.assets[0].versions[0].id;
    await api.dispose();
    browser = await chromium.connectOverCDP(CDP);
    context = await browser.newContext({
      baseURL: BROWSER_URL
    });
    page = await context.newPage();
    await login(page);
  });
  test.afterAll(async ({
    playwright
  }) => {
    await context?.close();
    await browser?.close();
    const api = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: auth,
      extraHTTPHeaders: ocsHeaders
    });
    await api.delete(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`);
    await api.fetch(`/remote.php/dav/files/${USER}/${folder}`, {
      method: 'DELETE'
    });
    await api.dispose();
  });
  test('the Project list leads into a Review and back', async () => {
    await page.goto('/apps/deliver/');
    const tile = page.locator('.deliver-project-card', {
      hasText: folder
    });
    await expect(tile).toContainText('1 Asset');
    await tile.click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
    // A click ticks the card, a double click opens it (story 141)
    const link = page.locator('.deliver-card__link').first();
    await link.click();
    await expect(page.locator('.deliver-card').first()).toHaveClass(/deliver-card--selected/);
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
    await link.dblclick();
    await expect(page).toHaveURL(new RegExp(`/versions/${versionId}$`));
    await page.getByRole('link', {
      name: folder,
      exact: true
    }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));

    // The Project list finds a Project by name, and a right click opens it too
    await page.goto('/apps/deliver/');
    await page.getByRole('searchbox', {
      name: 'Find a Project'
    }).fill(folder);
    await expect(page.locator('.deliver-project-card')).toHaveCount(1);
    await tile.click({
      button: 'right'
    });
    await page.getByRole('menuitem', {
      name: 'Open',
      exact: true
    }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
  });
  test('the list is remembered for the Project, and a card keeps its actions as a row', async () => {
    await page.goto(`/apps/deliver/projects/${projectId}`);
    await expect(page.locator('.deliver-card')).not.toHaveClass(/deliver-card--row/);
    await page.getByRole('button', {
      name: 'Show the Assets as a list'
    }).click();
    await expect(page.locator('.deliver-card').first()).toHaveClass(/deliver-card--row/);
    await expect(page.locator('.deliver-card__facts').first()).toContainText('V1');
    await page.reload();
    await expect(page.locator('.deliver-card').first()).toHaveClass(/deliver-card--row/);
    await expect(page.getByRole('button', {
      name: 'Show the Assets as a list'
    })).toHaveAttribute('aria-pressed', 'true');
    // The menu is still there, as a row
    await page.getByRole('button', {
      name: /^Actions for /
    }).first().click();
    await expect(page.getByRole('menuitem', {
      name: 'Rename…'
    })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', {
      name: 'Show the Assets as a list'
    }).click();
    await expect(page.locator('.deliver-card').first()).not.toHaveClass(/deliver-card--row/);
  });
  test('uploads into the Project, then filters and finds its Assets', async () => {
    await page.goto(`/apps/deliver/projects/${projectId}`);
    // The upload button opens the Uploads dialog (story 133)
    await page.getByRole('button', {
      name: 'Upload',
      exact: true
    }).click();
    const uploads = page.getByRole('dialog', {
      name: 'Uploads'
    });
    await uploads.locator('input[type=file][multiple]').setInputFiles({
      name: 'second.webm',
      mimeType: 'video/webm',
      buffer: readFileSync(CLIP)
    });
    // Auto Intake would take the file anyway; the upload itself must not fail
    await expect(uploads.getByText('Open', {
      exact: true
    })).toBeVisible();
    await expect(uploads.locator('.deliver-uploads__status--error')).toHaveCount(0);
    await page.keyboard.press('Escape');
    const second = card(page, 'second');
    await expect(second).toBeVisible();
    await page.getByRole('button', {
      name: /^Changes requested/
    }).click();
    await expect(page).toHaveURL(/filter=changes/);
    await expect(second).toHaveCount(0);
    await page.getByRole('button', {
      name: /^All/
    }).click();

    // Whoever uploads delivers: the card names them, and the filter finds what they delivered
    await expect(second.locator('.deliver-card__meta')).toContainText(/^deliver-e2e · /);
    await page.getByRole('button', {
      name: /^Delivered by me/
    }).click();
    await expect(page).toHaveURL(/filter=mine/);
    await expect(second).toBeVisible();
    await page.getByRole('button', {
      name: /^All/
    }).click();

    // The latest activity comes first, until the order is by name
    await expect(page.locator('.deliver-card__name').first()).toHaveText('second');
    await page.getByRole('button', {
      name: 'Latest activity'
    }).click();
    await page.getByRole('menuitemradio', {
      name: 'Name'
    }).click();
    await expect(page).toHaveURL(/sort=name/);
    await expect(page.locator('.deliver-card__name').first()).toHaveText('clip');
    await page.getByRole('searchbox', {
      name: 'Find an Asset'
    }).fill('SECOND');
    await expect(page.locator('.deliver-card')).toHaveCount(1);

    // Dropped files go the same way; anything but media stays out
    await page.getByRole('searchbox', {
      name: 'Find an Asset'
    }).fill('');
    await page.evaluate(bytes => {
      const files = new DataTransfer();
      files.items.add(new File([new Uint8Array(bytes)], 'third.webm', {
        type: 'video/webm'
      }));
      files.items.add(new File(['notes'], 'notes.txt', {
        type: 'text/plain'
      }));
      const view = document.querySelector('.deliver-project');
      for (const type of ['dragenter', 'dragover', 'drop']) {
        view.dispatchEvent(new DragEvent(type, {
          dataTransfer: files,
          bubbles: true,
          cancelable: true
        }));
      }
    }, [...readFileSync(CLIP)]);
    await expect(card(page, 'third')).toBeVisible();
    await expect(page.locator('.deliver-card', {
      hasText: 'notes'
    })).toHaveCount(0);
    // They go with the card in the corner, which opens the dialog again (story 134)
    await page.locator('.deliver-uploads-card__open').click();
    await expect(uploads).toContainText('Only video, audio and image files');
    await page.keyboard.press('Escape');

    // A Version Stack is managed from its card, not in the Review view
    await second.click({
      button: 'right'
    });
    await page.getByRole('menuitem', {
      name: 'Manage Versions'
    }).click();
    await expect(page.getByRole('dialog', {
      name: 'Versions of second'
    })).toContainText('Version 1');
    await page.keyboard.press('Escape');

    // So is its Due Date, through a visible field: Safari opens no picker for a hidden one
    await second.click({
      button: 'right'
    });
    await page.getByRole('menuitem', {
      name: 'Set a Due Date'
    }).click();
    const due = page.getByRole('dialog', {
      name: 'Due Date'
    });
    await due.getByLabel('Due Date').fill('2030-01-15');
    await due.getByRole('button', {
      name: 'Save'
    }).click();
    await expect(second.locator('.deliver-card__due')).toContainText('15');
    await second.click({
      button: 'right'
    });
    await expect(page.getByRole('menuitem', {
      name: 'Change the Due Date'
    })).toBeVisible();
    await page.keyboard.press('Escape');

    // Ticked, two cards share one menu with what applies to both (story 141)
    const third = card(page, 'third');
    await second.getByRole('checkbox', {
      name: 'Select second'
    }).check();
    await third.getByRole('checkbox', {
      name: 'Select third'
    }).check();
    await third.click({
      button: 'right'
    });
    await expect(page.getByRole('menu', {
      name: '2 Assets selected'
    })).toBeVisible();
    await expect(page.getByRole('menuitem', {
      name: 'Delete'
    })).toBeVisible();
    await expect(page.getByRole('menuitem', {
      name: 'Open'
    })).toHaveCount(0);
    await page.getByRole('menuitem', {
      name: 'Clear the selection'
    }).click();
    await expect(second.getByRole('checkbox', {
      name: 'Select second'
    })).not.toBeChecked();
    // A shift-click ticks every card from the one clicked last
    const cards = page.locator('.deliver-card__select');
    await cards.first().check();
    await cards.last().click({
      modifiers: ['Shift']
    });
    await expect(page.locator('.deliver-card__select:checked')).toHaveCount(await cards.count());
    await page.getByRole('checkbox', {
      name: 'Clear the selection'
    }).uncheck();

    // The checkbox at the start of the filter row ticks every card, and clears them again
    await page.getByRole('checkbox', {
      name: 'Select all'
    }).check();
    await expect(third.getByRole('checkbox', {
      name: 'Select third'
    })).toBeChecked();
    await page.getByRole('checkbox', {
      name: 'Clear the selection'
    }).uncheck();
    await expect(third.getByRole('checkbox', {
      name: 'Select third'
    })).not.toBeChecked();
  });
  test('renames, removes and stacks from the menus of the cards', async () => {
    await page.goto(`/apps/deliver/projects/${projectId}`);
    // The menu has a button on every screen, beside the name
    const second = card(page, 'second');
    await second.getByRole('button', {
      name: 'Actions for second'
    }).click();
    await expect(page.getByRole('menuitem', {
      name: 'Download'
    })).toHaveAttribute('href', /\/second\.webm$/);
    await page.getByRole('menuitem', {
      name: 'Rename…'
    }).click();
    const rename = page.getByRole('dialog', {
      name: 'Rename file'
    });
    await expect(rename).toContainText('actively being worked on');
    // Nextcloud reads the type from the extension, so it stays
    await rename.getByLabel('Name').fill('renamed.mov');
    await expect(rename.getByRole('button', {
      name: 'Rename'
    })).toBeDisabled();
    // A name with & and ' shows as it is, in labels too (#93)
    await rename.getByLabel('Name').fill('Smith & O\'Neil.webm');
    await rename.getByRole('button', {
      name: 'Rename'
    }).click();
    const renamed = card(page, 'Smith & O\'Neil');
    await expect(renamed.getByRole('button', {
      name: 'Actions for Smith & O\'Neil',
      exact: true
    })).toBeVisible();

    // Removed from a Folder Project with Auto Intake, a file waits as not up for review (#45)
    await card(page, 'third').click({
      button: 'right'
    });
    await page.getByRole('menuitem', {
      name: 'Remove from Project'
    }).click();
    await page.getByRole('dialog').getByRole('button', {
      name: 'Remove'
    }).click();
    const third = page.locator('.deliver-not-up', {
      hasText: 'third.webm'
    });
    await expect(third).toBeVisible();
    await page.reload();
    await expect(third).toBeVisible();

    // and joins an Asset from its own menu
    await third.getByRole('button', {
      name: 'Actions for third.webm'
    }).click();
    await page.getByRole('menuitem', {
      name: 'Add as a new Version of…'
    }).click();
    const stacking = page.getByRole('dialog', {
      name: 'Add third.webm as a new Version'
    });
    await stacking.locator('.v-select').click();
    await page.getByRole('option', {
      name: 'Smith & O\'Neil'
    }).click();
    await stacking.getByRole('button', {
      name: 'Add',
      exact: true
    }).click();
    // The Asset is named after its newest Version's file
    await expect(card(page, 'third').locator('.deliver-card__version')).toHaveText('V2');
    await expect(renamed).toHaveCount(0);
    await expect(third).toHaveCount(0);
  });
  test('comments on a Frame and on a Range, resolves and replies', async () => {
    await page.goto(`/apps/deliver/versions/${versionId}`);
    await expect(page.locator('video.deliver-player__video')).toHaveJSProperty('readyState', 4);

    // Frame stepping is exact: five steps at 25 fps land on 00:00:00:05; C brings hidden Comments back
    await page.getByRole('button', {
      name: 'Hide Comments'
    }).click();
    await expect(page.locator('.deliver-player__marker')).toHaveCount(0);
    const height = (await page.locator('.deliver-player__stage').boundingBox()).height;
    // Focus the page without touching the player
    await page.locator('.deliver-review__title').click();
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('ArrowRight');
    }
    await expect(page.locator('.deliver-player__timecode')).toContainText('00:00:00:05');
    await page.keyboard.press('c');
    await expect(page.locator('#deliver-comment-body')).toBeFocused();
    await expect(page.locator('.deliver-comments__anchor')).toHaveText(/00:00:00:05/);
    await page.locator('#deliver-comment-body').fill('sound starts too early');
    await page.locator('.deliver-comments__form button[title="Send (Enter)"]').click();
    const first = page.locator('.deliver-comment').first();
    await expect(first).toContainText('sound starts too early');
    // No row of its own: the Comment takes nothing from the picture
    await expect(page.locator('.deliver-player__marker')).toBeVisible();
    expect((await page.locator('.deliver-player__stage').boundingBox()).height).toBe(height);
    await expect(first.locator('.deliver-comment__time')).not.toBeEmpty();
    await expect(page.locator('.deliver-comment__anchor').first()).toHaveText('00:00:00:05');
    // Its author's initials, on the bar, which lies between the picture and the buttons with nothing beside it
    await expect(page.locator('.deliver-player__marker')).toHaveText('D');
    const [marker, under, above, buttons] = await Promise.all(['marker', 'timeline', 'stage', 'controls'].map(each => page.locator(`.deliver-player__${each}`).boundingBox()));
    expect(marker.y + marker.height / 2).toBeCloseTo(under.y + under.height / 2, 0);
    expect(marker.x + marker.width / 2).toBeCloseTo(under.x + under.width * 5 / 100, 0);
    expect(under.y).toBeCloseTo(above.y + above.height, 0);
    expect(buttons.y).toBeCloseTo(under.y + under.height, 0);
    expect(marker.y).toBeGreaterThanOrEqual(above.y + above.height - 2);
    expect(marker.y + marker.height).toBeLessThanOrEqual((await page.getByRole('button', {
      name: 'Play (Space)'
    }).boundingBox()).y);

    // A Range, set with I and O
    // Focus the page without touching the player
    await page.locator('.deliver-review__title').click();
    await page.keyboard.press('i');
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('ArrowRight');
    }
    await page.keyboard.press('o');
    await page.keyboard.press('c');
    await expect(page.locator('.deliver-comments__anchor')).toHaveText(/–/);
    await page.locator('#deliver-comment-body').fill('shorten this passage');
    await page.locator('.deliver-comments__form button[title="Send (Enter)"]').click();
    // Both start on the same Frame: one circle with their count
    await expect(page.locator('.deliver-player__marker')).toHaveText('2');

    // Resolving hides it from the unresolved filter, a Reply stays with its parent
    await page.locator('.deliver-comment').first().getByRole('button', {
      name: 'Mark as resolved'
    }).click();
    await expect(page.locator('.deliver-comment').first()).toHaveClass(/deliver-comment--resolved/);
    await page.locator('.deliver-comments__show button').click();
    await page.getByRole('menuitemradio', {
      name: 'Unresolved'
    }).click();
    await expect(page.locator('.deliver-comments__list > .deliver-comment')).toHaveCount(1);
    await page.locator('.deliver-comments__show button').click();
    await page.getByRole('menuitemradio', {
      name: 'All Comments'
    }).click();
    await expect(page.locator('.deliver-comments__list > .deliver-comment')).toHaveCount(2);
    const target = page.locator('.deliver-comment').filter({
      hasText: 'sound starts too early'
    }).first();
    await target.getByRole('button', {
      name: 'Reply',
      exact: true
    }).click();
    await target.locator('textarea').fill('agreed, from frame 5');
    await target.locator('.deliver-comment__reply-form').getByRole('button', {
      name: 'Reply'
    }).click();
    await expect(page.locator('.deliver-comment--reply')).toContainText('agreed, from frame 5');

    // The export carries both Comments as markers, the Reply folded into its parent's note.
    // The browser may run in another container where its downloads are out of reach,
    // so the test fetches the link the menu offers with the page's own session.
    await page.getByRole('button', {
      name: 'Export'
    }).click();
    const link = page.getByRole('menuitem', {
      name: 'EDL for DaVinci Resolve'
    });
    const response = await page.request.get(await link.getAttribute('href'));
    expect(response.headers()['content-disposition']).toMatch(/\.edl"/);
    const edl = await response.text();
    expect(edl.match(/\|M:/g)).toHaveLength(2);
    expect(edl).toContain(`sound starts too early / ${USER}: agreed, from frame 5`);

    // Typing fixes the Frame: moving the player afterwards does not move the Comment
    await page.keyboard.press('Escape');
    await page.locator('.deliver-comments__list').getByRole('button', {
      name: '00:00:00:05',
      exact: true
    }).click();
    await page.locator('#deliver-comment-body').fill('t');
    await expect(page.locator('.deliver-comments__anchor')).toHaveText(/00:00:00:05/);
    const timeline = page.locator('.deliver-player__timeline');
    const box = await timeline.boundingBox();
    await timeline.click({
      position: {
        x: box.width * 0.8,
        y: box.height / 2
      }
    });
    await expect(page.locator('.deliver-player__timecode')).not.toContainText('00:00:00:05');
    await expect(page.locator('.deliver-comments__anchor')).toHaveText(/00:00:00:05/);
    await page.locator('#deliver-comment-body').fill('typed while the player moved on');
    await page.locator('.deliver-comments__form button[title="Send (Enter)"]').click();
    await expect(page.locator('.deliver-comment').filter({
      hasText: 'typed while the player moved on'
    }).locator('.deliver-comment__anchor')).toHaveText('00:00:00:05');

    // A reaction shows as a pill with its count, mine highlighted (story 91)
    const reacted = page.locator('.deliver-comment').filter({
      hasText: 'shorten this passage'
    }).first();
    // React waits for the pointer, as on Frame.io
    await page.mouse.move(0, 0);
    await expect(reacted.locator('.deliver-comment__react-at').first()).toBeHidden();
    await reacted.hover();
    await reacted.getByRole('button', {
      name: 'React'
    }).first().click();
    await page.locator('.emoji-mart input').fill('tooth');
    await page.locator('.emoji-mart .emoji-mart-scroll .emoji-mart-emoji').first().click();
    await expect(reacted.locator('.deliver-comment__reaction--mine')).toHaveText('🦷 1');

    // Typing @ offers the Members; the Comment shows the name (story 90)
    await page.locator('#deliver-comment-body').fill('');
    await page.locator('#deliver-comment-body').pressSequentially('look @Ma');
    await page.getByRole('option', {
      name: 'Mara Mate'
    }).click();
    await expect(page.locator('#deliver-comment-body')).toHaveValue(`look @${MATE} `);
    await page.locator('#deliver-comment-body').pressSequentially('here');
    await page.locator('.deliver-comments__form button[title="Send (Enter)"]').click();
    await expect(page.locator('.deliver-comment__mention').first()).toHaveText('@Mara Mate');

    // An attached picture shows under its Comment (story 92)
    const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    await page.locator('.deliver-comments__form input[type=file]').setInputFiles({
      name: 'reference.png',
      mimeType: 'image/png',
      buffer: pixel
    });
    await expect(page.locator('.deliver-comments__files li')).toHaveText('reference.png');
    await page.locator('#deliver-comment-body').fill('like this');
    await page.locator('.deliver-comments__form button[title="Send (Enter)"]').click();
    const picture = page.locator('.deliver-comment').filter({
      hasText: 'like this'
    }).locator('.deliver-comment__attachments img');
    await expect(picture).toHaveJSProperty('naturalWidth', 1);

    // A drawing goes with the Comment and shows while the player stands on it (story 89)
    await page.getByRole('button', {
      name: 'Draw on the picture'
    }).click();
    const stage = await page.locator('.deliver-player__stage').boundingBox();
    await page.mouse.move(stage.x + stage.width * 0.3, stage.y + stage.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(stage.x + stage.width * 0.6, stage.y + stage.height * 0.5, {
      steps: 8
    });
    await page.mouse.up();
    await expect(page.locator('.deliver-comments__drawn')).toHaveText('1 shape drawn');
    await page.locator('#deliver-comment-body').fill('this corner');
    await page.locator('.deliver-comments__form button[title="Send (Enter)"]').click();
    await expect(page.locator('.deliver-comment').filter({
      hasText: 'this corner'
    })).toBeVisible();
    await expect(page.locator('.deliver-drawing path')).toHaveCount(1);

    // A Due Date set in the header shows there (story 93)
    await page.locator('.deliver-due__button').click();
    const due = page.getByRole('dialog', {
      name: 'Due Date'
    });
    await due.getByLabel('Due Date').fill('2030-01-31');
    await due.getByRole('button', {
      name: 'Save'
    }).click();
    await expect(page.locator('.deliver-due')).toContainText('Due');
    await expect(page.locator('.deliver-due__clear')).toBeVisible();

    // Approving shows the decision next to the menu (story 88)
    await page.locator('.deliver-approval__menu button').click();
    await page.getByRole('menuitemradio', {
      name: 'Approve this Version'
    }).click();
    await expect(page.locator('.deliver-approval__people li')).toHaveCount(1);
    await expect(page.locator('.deliver-approval__menu button')).toContainText('Approved');
  });
  test('compares two Versions in step', async ({
    playwright
  }) => {
    const api = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: auth,
      extraHTTPHeaders: ocsHeaders
    });
    expect((await api.fetch(`/remote.php/dav/files/${USER}/${folder}/clip_v2.webm`, {
      method: 'PUT',
      data: readFileSync(CLIP)
    })).status()).toBe(201);
    const project = await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)).json();
    await api.dispose();
    const stack = project.ocs.data.assets[0].versions;
    expect(stack).toHaveLength(2);
    await page.goto(`/apps/deliver/compare/${stack[1].id}/${stack[0].id}`);
    const videos = page.locator('.deliver-compare video');
    await expect(videos).toHaveCount(2);
    await expect(videos.first()).toHaveJSProperty('readyState', 4);
    await page.locator('.deliver-layout__bar h2').click();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.deliver-compare__timecode')).toContainText('00:00:00:02');
    // B follows A to the same Frame
    const times = await videos.evaluateAll(all => all.map(video => video.currentTime));
    expect(times[1]).toBeCloseTo(times[0], 3);
    await page.getByRole('radio', {
      name: 'Wipe'
    }).click();
    await expect(page.locator('.deliver-compare__handle')).toBeVisible();
  });
  test('on a phone: stacked, by touch, and a Reviewer comments on a Range', async ({
    playwright
  }) => {
    const phone = await browser.newContext({
      baseURL: BROWSER_URL,
      ...PHONE
    });
    const page = await phone.newPage();
    await login(page);
    await page.goto(`/apps/deliver/projects/${projectId}`);
    // A card's menu has a button of its own on a phone, with the Due Date in it
    const clip = page.locator('.deliver-card', {
      hasText: 'clip'
    });
    await clip.locator('.deliver-card__more').tap();
    await page.getByRole('menuitem', {
      name: /Due Date/
    }).tap();
    const due = page.getByRole('dialog', {
      name: 'Due Date'
    });
    await due.getByLabel('Due Date').fill('2030-02-20');
    await due.getByRole('button', {
      name: 'Save'
    }).tap();
    await expect(clip.locator('.deliver-card__due')).toContainText('20');
    await page.locator('.deliver-card__more').first().tap();
    await page.getByRole('menuitem', {
      name: 'Open',
      exact: true
    }).tap();
    await expect(page).toHaveURL(/\/versions\/\d+$/);
    const video = page.locator('video.deliver-player__video');
    await expect(video).toHaveJSProperty('readyState', 4);

    // Upright, only the field sits under the picture, without Nextcloud's header; the list pulls up in its place
    await expect(page.locator('#header')).toBeHidden();
    const stage = await page.locator('.deliver-player__stage').boundingBox();
    const panel = await page.locator('.deliver-layout__panel').boundingBox();
    expect(panel.y).toBeGreaterThanOrEqual(stage.y + stage.height);
    await expect(page.locator('.deliver-comments__head')).toBeHidden();
    // Halfway a 16:9 picture fits above the list, then the list takes its place
    const grabber = page.locator('.deliver-layout__grabber');
    await grabber.tap();
    await expect(page.locator('.deliver-layout--middle')).toHaveCount(1);
    await expect(page.locator('.deliver-comments__head')).toBeVisible();
    expect((await page.locator('.deliver-player__stage').boundingBox()).height).toBeCloseTo(390 * 9 / 16, 0);
    await grabber.tap();
    await expect(page.locator('.deliver-layout--up')).toHaveCount(1);
    // A stroke down goes back a level at a time
    for (const level of ['middle', 'down']) {
      const box = await grabber.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 80);
      await page.mouse.up();
      await expect(page.locator(`.deliver-layout--${level}`)).toHaveCount(1);
    }

    // A tap on the timeline seeks and leaves no thumbnail behind
    await page.locator('.deliver-player__timeline').tap();
    await page.waitForTimeout(300);
    await expect(page.locator('.deliver-player__hover')).toBeHidden();

    // A double tap on the right jumps ahead, a tap goes fullscreen
    const right = {
      x: stage.x + stage.width * 0.85,
      y: stage.y + stage.height / 2
    };
    await page.touchscreen.tap(right.x, right.y);
    await page.touchscreen.tap(right.x, right.y);
    await expect(page.locator('.deliver-player__flash')).toContainText('+10');
    await page.waitForTimeout(700);
    await page.touchscreen.tap(stage.x + stage.width / 2, right.y);
    await expect(page.locator('.deliver-player--fullscreen')).toHaveCount(1);
    await page.waitForTimeout(700);
    await page.touchscreen.tap(stage.x + stage.width / 2, right.y);
    await expect(page.locator('.deliver-player--fullscreen')).toHaveCount(0);

    // Sideways, the picture fills the window and the list opens beside it
    await page.setViewportSize({
      width: PHONE.viewport.height,
      height: PHONE.viewport.width
    });
    await expect(page.locator('.deliver-layout__bar')).toHaveCount(0);
    await expect(page.locator('.deliver-layout__panel')).toBeHidden();
    await page.getByRole('button', {
      name: 'Show Comments'
    }).tap();
    await expect(page.locator('.deliver-comments__head')).toBeVisible();
    await phone.close();

    // A Reviewer on a phone: name first, then a Range by its button
    const api = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: auth,
      extraHTTPHeaders: ocsHeaders
    });
    const link = (await (await api.post(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}/links?format=json`)).json()).ocs.data;
    // Only the newest Version takes Comments on this link
    const project = await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)).json();
    const newest = project.ocs.data.assets.find(asset => asset.versions.some(version => version.id === versionId)).versions[0].id;
    await api.dispose();
    const guest = await browser.newContext({
      baseURL: BROWSER_URL,
      ...PHONE
    });
    const reviewer = await guest.newPage();
    await reviewer.goto(`/apps/deliver/s/${link.token}/versions/${newest}`);
    await reviewer.locator('#deliver-reviewer-name').fill('Pia');
    await reviewer.getByRole('button', {
      name: 'Start reviewing'
    }).tap();
    await expect(reviewer.locator('.deliver-comments__gate')).toHaveCount(0);
    // The composer's tools sit in its menu
    const options = reviewer.getByRole('button', {
      name: 'Comment options'
    });
    await options.tap();
    await reviewer.getByRole('menuitem', {
      name: 'Start a Range here'
    }).tap();
    for (let i = 0; i < 3; i++) {
      await reviewer.getByRole('button', {
        name: 'One Frame forward'
      }).tap();
    }
    await options.tap();
    await reviewer.getByRole('menuitem', {
      name: 'End the Range here'
    }).tap();
    await expect(reviewer.locator('.deliver-comments__anchor')).toContainText('–');
    await reviewer.locator('#deliver-comment-body').fill('on the phone');
    await reviewer.getByRole('button', {
      name: 'Send (Enter)'
    }).tap();
    await expect(reviewer.locator('.deliver-comment').filter({
      hasText: 'on the phone'
    })).toContainText('Pia');
    // A tap on its marker opens the Comment on the picture
    await reviewer.locator('.deliver-player__marker[aria-label^="Pia"]').tap({
      force: true
    });
    await expect(reviewer.locator('.deliver-player__peek--tapped')).toContainText('on the phone');
    // A tap on the picture then only closes it
    await reviewer.waitForTimeout(700);
    await reviewer.locator('.deliver-player__stage').tap({
      position: {
        x: 40,
        y: 40
      }
    });
    await expect(reviewer.locator('.deliver-player__peek')).toHaveCount(0);
    await reviewer.waitForTimeout(700);
    await expect(reviewer.locator('.deliver-player--fullscreen')).toHaveCount(0);
    await guest.close();
  });
  test('a Reviewer names themselves and comments through a Review Link', async ({
    playwright
  }) => {
    const api = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: auth,
      extraHTTPHeaders: ocsHeaders
    });
    const link = (await (await api.post(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}/links?format=json`)).json()).ocs.data;
    // Only the newest Version takes Comments on this link
    const project = await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)).json();
    const newest = project.ocs.data.assets[0].versions[0].id;
    await api.dispose();

    // A browser that has never been here
    const visitor = await browser.newContext({
      baseURL: BROWSER_URL
    });
    const reviewer = await visitor.newPage();
    await reviewer.goto(`/apps/deliver/s/${link.token}/versions/${newest}`);
    // The name comes first, over the Comments; with an address come the mail wishes
    await expect(reviewer.locator('.deliver-comments__gate')).toBeVisible();
    await reviewer.locator('#deliver-reviewer-name').fill('Mara');
    await reviewer.locator('.deliver-comments__claim input[type=email]').fill('mara@example.test');
    await reviewer.getByText('New Versions').click();
    await reviewer.getByRole('button', {
      name: 'Start reviewing'
    }).click();
    await expect(reviewer.locator('.deliver-comments__gate')).toHaveCount(0);
    await reviewer.getByRole('button', {
      name: 'Reviewing as Mara'
    }).click();
    await expect(reviewer.getByRole('checkbox', {
      name: 'New Versions'
    })).toBeChecked();
    // Their Personal Link, to be Mara on another device (story 128)
    await reviewer.getByRole('button', {
      name: 'Copy Personal Link'
    }).click();
    await expect(reviewer.getByText('Personal Link copied', {
      exact: true
    })).toBeVisible();
    await reviewer.keyboard.press('Escape');
    await reviewer.locator('#deliver-comment-body').fill('from the client');
    await reviewer.locator('.deliver-comments__form button[title="Send (Enter)"]').click();
    await expect(reviewer.locator('.deliver-comment').filter({
      hasText: 'from the client'
    })).toContainText('Mara');
    await visitor.close();
  });
  test('the navigation lists a colleague\'s link and says who made it', async ({
    playwright
  }) => {
    const mate = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: {
        username: MATE,
        password: MATE_PASSWORD,
        send: 'always'
      },
      extraHTTPHeaders: ocsHeaders
    });
    // Reading and resharing in Files is not Share in Deliver: the owner switches it on
    const owner = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: auth,
      extraHTTPHeaders: ocsHeaders
    });
    const members = `/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}/members?format=json`;
    expect((await mate.post(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}/links?format=json`)).status()).toBe(403);
    expect((await owner.put(members, {
      data: {
        type: 'user',
        principal: MATE,
        level: 'comment',
        share: true,
        approve: false
      }
    })).status()).toBe(200);
    const made = await mate.post(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}/links?format=json`, {
      data: {
        label: 'Colleague link'
      }
    });
    expect(made.status()).toBe(201);
    const link = (await made.json()).ocs.data;
    await mate.put(`/ocs/v2.php/apps/deliver/api/v1/links/${link.id}?format=json`, {
      data: {
        label: 'Mara\'s link'
      }
    });
    try {
      await page.goto(`/apps/deliver/projects/${projectId}`);
      const theirs = page.locator('.app-navigation li').filter({
        hasText: 'Mara\'s link'
      }).first();
      await expect(theirs).toContainText('Made by Mara Mate');
      // Their link, though, is not marked as made by someone else
      await page.locator('.app-navigation').getByRole('button', {
        name: 'Create Review Link'
      }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('.app-navigation').getByText('Made by deliver-e2e', {
        exact: true
      })).toHaveCount(0);
    } finally {
      await mate.delete(`/ocs/v2.php/apps/deliver/api/v1/links/${link.id}?format=json`);
      await owner.delete(members + `&type=user&principal=${MATE}`);
      await mate.dispose();
      await owner.dispose();
    }
  });
  test('the Project settings list the Members and set what each may do', async ({
    playwright
  }) => {
    const owner = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: auth,
      extraHTTPHeaders: ocsHeaders
    });
    const api = `/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}`;
    const listed = async () => (await (await owner.get(`${api}/members?format=json`)).json()).ocs.data.find(each => each.id === MATE);
    try {
      await page.goto(`/apps/deliver/projects/${projectId}`);
      await page.getByRole('button', {
        name: 'Project settings'
      }).click();
      const dialog = page.getByRole('dialog');
      const mate = dialog.locator('.deliver-members__row', {
        hasText: 'Mara Mate'
      });
      const level = mate.getByLabel('Access level of Mara Mate');
      // Read access in Files gives Comment, and no Approve
      await expect(level).toHaveValue('comment');
      await expect(mate.getByRole('checkbox', {
        name: 'Approve'
      })).not.toBeChecked();
      await mate.getByText('Approve', {
        exact: true
      }).click();
      await expect.poll(async () => (await listed()).stored).toEqual({
        level: 'comment',
        share: false,
        approve: true
      });
      await level.selectOption('view');
      // A View cannot approve, so the switch goes off and is fixed
      await expect.poll(async () => (await listed()).stored).toEqual({
        level: 'view',
        share: false,
        approve: false
      });
      await expect(mate.getByRole('checkbox', {
        name: 'Approve'
      })).toBeDisabled();

      // The owner is marked and cannot be lowered
      const me = dialog.locator('.deliver-members__row', {
        hasText: USER
      });
      await expect(me).toContainText('Owner');
      await expect(me.getByLabel(`Access level of ${USER}`)).toBeDisabled();

      // Back to what Files gives
      await mate.getByRole('button', {
        name: 'Reset'
      }).click();
      await expect(level).toHaveValue('comment');
      expect((await listed()).stored).toBeNull();

      // What someone newly given access in Files starts with
      await dialog.getByLabel('Someone newly given access in Files starts with').selectOption('view');
      await expect.poll(async () => (await (await owner.get(`${api}?format=json`)).json()).ocs.data.newcomers).toBe('view');
      // Everyone who was a Member keeps what Files gives, with no entry made for them
      expect(await listed()).toMatchObject({
        level: 'comment',
        stored: null
      });
    } finally {
      await owner.put(`${api}?format=json`, {
        data: {
          newcomers: 'files'
        }
      });
      await owner.delete(`${api}/members?format=json&type=user&principal=${MATE}`);
      await owner.dispose();
      await page.keyboard.press('Escape').catch(() => {});
    }
  });
  test('a Member invites someone from their contacts on a link of their own', async ({
    playwright
  }) => {
    const api = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: auth,
      extraHTTPHeaders: ocsHeaders
    });
    // The test user keeps their address book between runs: a name of this run's own
    const run = randomBytes(3).toString('hex');
    const zoeName = `Zoe Quill ${run}`;
    const uid = `deliver-e2e-${run}`;
    const card = `/remote.php/dav/addressbooks/users/${USER}/contacts/${uid}.vcf`;
    const vcard = `BEGIN:VCARD\r\nVERSION:3.0\r\nUID:${uid}\r\nFN:${zoeName}\r\n` + 'EMAIL;TYPE=WORK:zoe@studio.test\r\nEMAIL;TYPE=HOME:zoe@home.test\r\nEND:VCARD\r\n';
    expect((await api.fetch(card, {
      method: 'PUT',
      data: vcard,
      headers: {
        'Content-Type': 'text/vcard'
      }
    })).status()).toBe(201);
    // A link of the Project to put Zoe on later
    await api.post(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}/links?format=json`);
    try {
      await page.goto(`/apps/deliver/projects/${projectId}`);
      await page.locator('.app-navigation').getByRole('button', {
        name: 'Invite a Reviewer'
      }).click();
      const dialog = page.getByRole('dialog', {
        name: 'Invite a Reviewer'
      });
      const name = dialog.getByRole('combobox', {
        name: 'Name'
      });
      await name.pressSequentially(run);
      // One row per address; the arrow keys move, Enter picks
      await expect(page.getByRole('option')).toHaveCount(2);
      await name.press('ArrowDown');
      await name.press('Enter');
      await expect(page.getByRole('listbox')).toHaveCount(0);
      await expect(name).toHaveValue(zoeName);
      await expect(dialog.getByLabel('Email (optional)')).toHaveValue('zoe@home.test');
      await dialog.getByText('Reviewers may download the original').click();
      await dialog.getByRole('button', {
        name: 'Invite',
        exact: true
      }).click();
      await expect(dialog).toHaveCount(0);

      // A link of their own, titled by what it shows, with them under it
      const listed = await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}/links?format=json`)).json();
      const zoeId = listed.ocs.data.reviewers.find(each => each.name === zoeName).id;
      const theirs = listed.ocs.data.links.find(link => link.reviewerIds.includes(zoeId));
      expect([theirs.reviewerIds, theirs.assetIds, theirs.canDownload]).toEqual([[zoeId], null, false]);

      // Already a contact: nothing to save
      const zoe = page.locator('.app-navigation li').filter({
        hasText: zoeName
      }).last();
      await zoe.hover();
      await zoe.getByRole('button', {
        name: 'Actions'
      }).click();
      await expect(page.getByRole('menuitem', {
        name: 'In your contacts'
      })).toBeDisabled();
      await page.keyboard.press('Escape');

      // Rights of their own on that link, from the gear at it in their dialog (ADR 0014)
      await zoe.getByText(zoeName).click();
      const person = page.getByRole('dialog', {
        name: zoeName
      });
      await person.getByRole('button', {
        name: `Rights of ${zoeName} on this link`
      }).click();
      const rights = page.getByRole('dialog', {
        name: `${zoeName} on “Whole Project”`
      });
      await rights.getByRole('radiogroup', {
        name: 'Comment',
        exact: true
      }).getByText('No', {
        exact: true
      }).click();
      await expect.poll(async () => {
        const now = await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}/links?format=json`)).json();
        return now.ocs.data.reviewers.find(each => each.id === zoeId).links.find(each => each.token === theirs.token).rights.canComment;
      }).toBe(false);
      // One dialog at a time, by its own close button
      await rights.getByRole('button', {
        name: 'Close'
      }).click();
      await expect(rights).toHaveCount(0);
      await person.getByRole('button', {
        name: 'Close'
      }).click();
      await expect(person).toHaveCount(0);

      // Under the link, a click opens their rights on that very link
      await page.locator('.app-navigation').getByText(zoeName).first().click();
      const nested = page.getByRole('dialog', {
        name: `${zoeName} on “Whole Project”`
      });
      await expect(nested).toBeVisible();
      await nested.getByRole('button', {
        name: 'Close'
      }).click();
      await expect(nested).toHaveCount(0);

      // Put on another link of the Project from their dialog, with a Personal Link of its own (story 55)
      const zoeLinks = async () => {
        const now = await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}/links?format=json`)).json();
        return now.ocs.data.reviewers.find(each => each.id === zoeId).links.map(each => each.token);
      };
      await zoe.getByText(zoeName).click();
      const again = page.getByRole('dialog', {
        name: zoeName
      });
      await expect(again.getByLabel('Name', {
        exact: true
      })).toBeFocused();
      await again.getByRole('combobox', {
        name: 'Put on another Review Link'
      }).click();
      await page.getByRole('option').first().click();
      await expect.poll(async () => (await zoeLinks()).length).toBe(2);
      await again.getByRole('button', {
        name: 'Close'
      }).click();
      await expect(again).toHaveCount(0);

      // And taken off that one in its settings; the link of their own stays
      const other = (await zoeLinks()).find(token => token !== theirs.token);
      const linkItem = page.locator('.app-navigation li').filter({
        has: page.locator('ul li', {
          hasText: zoeName
        })
      }).first();
      await linkItem.locator('.app-navigation-entry__name').first().click();
      const settings = page.getByRole('dialog').first();
      await settings.locator('.deliver-link__reviewer').filter({
        hasText: zoeName
      }).getByRole('button', {
        name: `Take ${zoeName} off this link`
      }).click();
      await page.getByRole('button', {
        name: 'Take off'
      }).click();
      await expect.poll(zoeLinks).toEqual([theirs.token]);
      expect(other).not.toBe(theirs.token);
    } finally {
      const cleanup = await playwright.request.newContext({
        baseURL: URL,
        httpCredentials: auth
      });
      await cleanup.fetch(card, {
        method: 'DELETE'
      });
      await cleanup.dispose();
      await api.dispose();
      await page.keyboard.press('Escape').catch(() => {});
    }
  });
  test('a file with Comments is locked, and an overwrite without the lock marks them', async ({
    playwright
  }) => {
    const api = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: auth,
      extraHTTPHeaders: ocsHeaders
    });
    const lock = lockFiles => api.put(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`, {
      data: {
        lockFiles
      }
    });
    const clip = `/remote.php/dav/files/${USER}/${folder}/overwrite.webm`;
    try {
      // A file of its own, as the Versions of the tests before are no longer the newest
      expect((await api.fetch(clip, {
        method: 'PUT',
        data: readFileSync(CLIP)
      })).status()).toBe(201);
      const project = await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`);
      const mine = (await project.json()).ocs.data.assets.find(asset => asset.versions[0].name === 'overwrite.webm').versions[0].id;

      // A Comment locks the file against a sync client
      const commented = await api.post(`/ocs/v2.php/apps/deliver/api/v1/versions/${mine}/comments?format=json`, {
        data: {
          inFrame: 1,
          body: 'lock me'
        }
      });
      expect(commented.status(), await commented.text()).toBe(201);
      expect((await api.fetch(clip, {
        method: 'PUT',
        data: readFileSync(CLIP)
      })).status()).toBe(423);

      // The switch is in the Project settings, and off frees the file
      await page.goto(`/apps/deliver/projects/${projectId}`);
      await page.getByRole('button', {
        name: 'Project settings'
      }).click();
      const settings = page.getByRole('dialog', {
        name: /^Settings of/
      });
      await settings.getByText('Protect files with Comments against deleting and renaming').click();
      await expect.poll(async () => (await api.fetch(clip, {
        method: 'PUT',
        data: readFileSync(CLIP)
      })).status()).toBe(204);
      await page.keyboard.press('Escape');
      await page.goto(`/apps/deliver/versions/${mine}`);
      await expect(page.locator('.deliver-comment__overwritten').first()).toContainText('before the overwrite on');
    } finally {
      await lock(true);
      await api.dispose();
    }
  });
  test('Captions are added on the Asset card and turned on under the CC button', async ({
    playwright
  }) => {
    const api = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: auth,
      extraHTTPHeaders: ocsHeaders
    });
    expect((await api.fetch(`/remote.php/dav/files/${USER}/${folder}/captioned.webm`, {
      method: 'PUT',
      data: readFileSync(CLIP)
    })).status()).toBe(201);
    await api.dispose();
    await page.goto(`/apps/deliver/projects/${projectId}`);
    await card(page, 'captioned').click({
      button: 'right'
    });
    await page.getByRole('menuitem', {
      name: 'Add Captions…'
    }).click();
    const dialog = page.getByRole('dialog', {
      name: 'Captions'
    });
    // The language comes from the file name
    await dialog.locator('input[type=file]').setInputFiles({
      name: 'captioned.de.srt',
      mimeType: 'application/x-subrip',
      buffer: Buffer.from('1\n00:00:00,000 --> 00:00:03,000\nHallo\n')
    });
    await expect(dialog.locator('.vs__selected')).toHaveText('German');
    // Focus stays in the file field, as where a click does not focus the button (Safari); Escape in a field leaves a dialog open
    await dialog.locator('input[type=file]').focus();
    await dialog.getByRole('button', {
      name: 'Add Captions'
    }).dispatchEvent('click');
    await expect(dialog.locator('.deliver-captions__list')).toHaveText('German');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await card(page, 'captioned').locator('.deliver-card__link').dblclick();
    const shown = () => page.evaluate(() => [...document.querySelector('.deliver-player__video').textTracks].filter(track => track.mode === 'showing').map(track => track.language));
    // Off until someone turns them on
    await expect(page.getByRole('button', {
      name: 'Captions'
    })).toBeVisible();
    expect(await shown()).toEqual([]);
    await page.getByRole('button', {
      name: 'Captions'
    }).click();
    await page.getByRole('menuitemradio', {
      name: 'German'
    }).click();
    await expect.poll(shown).toEqual(['de']);
    await page.getByRole('button', {
      name: 'Captions'
    }).click();
    await page.getByRole('menuitemradio', {
      name: 'Off'
    }).click();
    await expect.poll(shown).toEqual([]);
  });
  test('the timeline hover scrubs through what plays where this browser cannot play the Scrub Proxy', async () => {
    // ffmpeg makes the clip's Scrub Proxy, an H.264 MP4, which open-source Chromium does not decode
    execFileSync('docker', ['compose', 'exec', '-T', '-u', 'www-data', 'nextcloud', 'php', 'occ', 'deliver:worker', '--once'], {
      stdio: 'inherit'
    });
    await page.goto(`/apps/deliver/versions/${versionId}`);
    const h264 = await page.evaluate(() => document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E"') !== '');
    await expect(page.locator('.deliver-player__scrub-video')).toHaveAttribute('src', h264 ? /\/media\/scrub$/ : /clip\.webm$/);
    const bar = await page.locator('.deliver-player__timeline').boundingBox();
    await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
    await expect(page.locator('.deliver-player__hover canvas')).toBeVisible();
  });
  test('a click on the timeline keeps playing if it played, and stays paused if it did not', async () => {
    await page.goto(`/apps/deliver/versions/${versionId}`);
    const video = page.locator('video.deliver-player__video');
    await expect(video).toHaveJSProperty('readyState', 4);
    const bar = await page.locator('.deliver-player__timeline').boundingBox();
    const clickAt = share => page.mouse.click(bar.x + bar.width * share, bar.y + bar.height / 2);
    await clickAt(0.1);
    await page.waitForTimeout(300);
    expect(await video.evaluate(element => element.paused)).toBe(true);
    await page.getByRole('button', {
      name: /^Play \(/
    }).click();
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(0.1);
    await clickAt(0.5);
    await page.waitForTimeout(300);
    expect(await video.evaluate(element => element.paused)).toBe(false);
    expect(await video.evaluate(element => element.currentTime)).toBeGreaterThan(1.9);
    await expect(page.getByRole('button', {
      name: /^Pause \(/
    })).toBeVisible();
  });
  test('dragging the playhead with the mouse seeks before release, holds playback and goes on if it played', async () => {
    await page.goto(`/apps/deliver/versions/${versionId}`);
    const video = page.locator('video.deliver-player__video');
    await expect(video).toHaveJSProperty('readyState', 4);
    const bar = await page.locator('.deliver-player__timeline').boundingBox();
    const y = bar.y + bar.height / 2;
    const time = () => video.evaluate(element => element.currentTime);
    const paused = () => video.evaluate(element => element.paused);
    await page.getByRole('button', {
      name: /^Play \(/
    }).click();
    await expect.poll(paused).toBe(false);
    await page.mouse.move(bar.x + bar.width * 0.2, y);
    await page.mouse.down();
    await page.mouse.move(bar.x + bar.width * 0.5, y, {
      steps: 5
    });
    // Still pressed: the picture is already there and playback is held
    await expect.poll(time).toBeGreaterThan(1.8);
    expect(await time()).toBeLessThan(2.3);
    expect(await paused()).toBe(true);
    await page.mouse.move(bar.x + bar.width * 0.75, y, {
      steps: 5
    });
    await expect.poll(time).toBeGreaterThan(2.8);
    await page.mouse.up();
    await expect.poll(paused).toBe(false);

    // Paused stays paused
    await page.getByRole('button', {
      name: /^Pause \(/
    }).click();
    await page.mouse.move(bar.x + bar.width * 0.8, y);
    await page.mouse.down();
    await page.mouse.move(bar.x + bar.width * 0.1, y, {
      steps: 5
    });
    await expect.poll(time).toBeLessThan(0.7);
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect(await paused()).toBe(true);
  });
  test('a click on the bar keeps a backwards shuttle going, from where it was clicked', async () => {
    await page.goto(`/apps/deliver/versions/${versionId}`);
    const video = page.locator('video.deliver-player__video');
    await expect(video).toHaveJSProperty('readyState', 4);
    await page.locator('.deliver-layout__bar h2').click();
    const bar = await page.locator('.deliver-player__timeline').boundingBox();
    const y = bar.y + bar.height / 2;
    await page.mouse.click(bar.x + bar.width * 0.9, y);
    await page.keyboard.press('j');
    await expect(page.getByRole('button', {
      name: /^Pause \(/
    })).toBeVisible();
    // A click is only a seek: the shuttle goes on backwards from there (holding playback would drop it,
    // and letting go would play forwards from 2.0 s)
    await page.mouse.click(bar.x + bar.width * 0.5, y);
    await page.waitForTimeout(300);
    expect(await video.evaluate(element => element.currentTime)).toBeLessThan(2);
    await expect(page.getByRole('button', {
      name: /^Pause \(/
    })).toBeVisible();
    await page.keyboard.press('k');
  });
  test('a click on a Comment\'s marker pauses', async ({
    playwright
  }) => {
    const api = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: auth,
      extraHTTPHeaders: ocsHeaders
    });
    // The Compare test stacked a newer Version on the Asset; only the newest takes Comments
    const project = await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)).json();
    const newest = Math.max(...project.ocs.data.assets[0].versions.map(each => each.id));
    const commented = await api.post(`/ocs/v2.php/apps/deliver/api/v1/versions/${newest}/comments?format=json`, {
      data: {
        inFrame: 50,
        body: 'stop here'
      }
    });
    expect(commented.ok()).toBe(true);
    await api.dispose();
    await page.goto(`/apps/deliver/versions/${newest}`);
    const video = page.locator('video.deliver-player__video');
    await expect(video).toHaveJSProperty('readyState', 4);
    await page.getByRole('button', {
      name: /^Play \(/
    }).click();
    await expect.poll(() => video.evaluate(element => element.paused)).toBe(false);
    await page.locator('.deliver-player__marker').first().click({
      force: true
    });
    await expect.poll(() => video.evaluate(element => element.paused)).toBe(true);
    expect(await video.evaluate(element => element.currentTime)).toBeCloseTo(2, 1);
  });
  test('close Comments share a marker with their count: each press takes the next, a double tap or click goes to the one that showed', async ({
    playwright
  }) => {
    const api = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: auth,
      extraHTTPHeaders: ocsHeaders
    });
    const project = await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)).json();
    const newest = Math.max(...project.ocs.data.assets[0].versions.map(each => each.id));
    const ids = [];
    for (const inFrame of [85, 86, 87]) {
      const made = await api.post(`/ocs/v2.php/apps/deliver/api/v1/versions/${newest}/comments?format=json`, {
        data: {
          inFrame,
          body: `at ${inFrame}`
        }
      });
      ids.push((await made.json()).ocs.data.id);
    }
    await page.goto(`/apps/deliver/versions/${newest}`);
    const video = page.locator('video.deliver-player__video');
    await expect(video).toHaveJSProperty('readyState', 4);
    const frameOf = target => target.evaluate(element => Math.floor(element.currentTime * 25 + 0.001));
    const marker = page.locator('.deliver-player__marker[aria-label*=": at 8"]');
    await expect(marker).toHaveAttribute('aria-label', /^1 of 3, .*: at 85$/);
    // The mouse shows the first and steps on with every click; the wrap comes back to it (forced: the bar takes the pointer for its circles)
    await marker.hover({
      force: true
    });
    await expect(page.locator('.deliver-player__peek')).toContainText('1 of 3');
    for (const frame of [85, 86, 87, 85, 86]) {
      await marker.click({
        force: true
      });
      await expect.poll(() => frameOf(video)).toBe(frame);
      await page.waitForTimeout(400);
    }
    // A double click does not step on: the second press takes the one that showed before the first
    await expect(page.locator('.deliver-player__peek')).toContainText('2 of 3');
    await marker.dblclick({
      force: true
    });
    await expect(page.locator('.deliver-player__peek')).toContainText('2 of 3');
    await expect.poll(() => frameOf(video)).toBe(86);
    await page.mouse.move(0, 0);
    await expect(page.locator('.deliver-player__peek')).toHaveCount(0);
    // The keyboard too: the Tab key shows the first, Enter goes there and then on
    await page.locator('.deliver-layout__bar h2').click();
    await marker.focus();
    await expect(page.locator('.deliver-player__peek')).toHaveCount(0);
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(marker).toBeFocused();
    await expect(page.locator('.deliver-player__peek')).toContainText('1 of 3');
    await page.keyboard.press('Enter');
    await expect.poll(() => frameOf(video)).toBe(85);
    await page.keyboard.press('Enter');
    await expect.poll(() => frameOf(video)).toBe(86);
    await expect(marker).toHaveAttribute('aria-label', /^2 of 3, .*: at 86$/);
    const phone = await browser.newContext({
      baseURL: BROWSER_URL,
      ...PHONE
    });
    const touchPage = await phone.newPage();
    await login(touchPage);
    await touchPage.goto(`/apps/deliver/versions/${newest}`);
    const touchVideo = touchPage.locator('video.deliver-player__video');
    await expect(touchVideo).toHaveJSProperty('readyState', 4);
    const card = touchPage.locator('.deliver-player__peek--tapped');
    // A finger on the circle opens the card without seeking
    const box = await touchPage.locator('.deliver-player__marker[aria-label*=": at 8"]').boundingBox();
    const tap = (beside = 0) => touchPage.touchscreen.tap(box.x + box.width / 2 - beside, box.y + box.height / 2);
    await tap(6);
    await expect(card).toContainText('at 85');
    expect(await touchVideo.evaluate(element => element.currentTime)).toBe(0);
    await touchPage.waitForTimeout(700);
    await tap();
    await expect(card).toContainText('2 of 3');
    await touchPage.waitForTimeout(700);
    await tap();
    await tap();
    await expect(card).toContainText('2 of 3');
    await expect(card).toContainText('at 86');
    await expect.poll(() => frameOf(touchVideo)).toBe(86);
    // It reaches no further than it is drawn: beside, above and below it the bar seeks
    const bar = await touchPage.locator('.deliver-player__timeline').boundingBox();
    const tapAt = async (x, y) => {
      await touchPage.reload();
      await expect(touchVideo).toHaveJSProperty('readyState', 4);
      await expect(touchPage.locator('.deliver-player__marker[aria-label*=": at 8"]')).toBeVisible();
      await touchPage.touchscreen.tap(box.x + box.width / 2 + x, y);
    };
    for (const [x, y, frame] of [[-18, 16, 85 - 18 / bar.width * 100], [0, 1, 85], [0, 2, 85], [0, 4, 85], [0, 5, 85], [0, bar.height - 5, 85], [0, bar.height - 4, 85], [0, bar.height - 1, 85], [-11, 16, 1], [0, bar.height - 2, 85]]) {
      await touchPage.evaluate(() => 0);
      await tapAt(x, bar.y + y);
      await touchPage.waitForTimeout(500);
      console.log(x, y, await frameOf(touchVideo), await touchPage.evaluate(() => [document.querySelector('video').paused, document.querySelector('.deliver-player__peek')?.className]));
      await touchPage.screenshot({
        path: '.tmp/b.png'
      });
      //			await expect.poll(() => frameOf(touchVideo)).toBeGreaterThan(frame - 2)
      //			expect(await frameOf(touchVideo)).toBeLessThan(frame + 2)
      //			await expect(card).toHaveCount(0)
    }
    // The bar grows under a mouse, on a narrow window too, not under a finger
    await page.setViewportSize({
      width: 900,
      height: 800
    });
    await page.locator('.deliver-player__timeline').hover();
    await expect(page.locator('.deliver-player__track')).toHaveCSS('height', '12px');
    const [knob, track] = await Promise.all(['.deliver-player__timeline', '.deliver-player__track'].map(each => page.locator(each).boundingBox()));
    expect(track.y + track.height / 2).toBeCloseTo(knob.y + knob.height / 2, 0);
    await page.setViewportSize({
      width: 1280,
      height: 720
    });
    await expect(touchPage.locator('.deliver-player__track')).toHaveCSS('height', '6px');
    await tapAt(0, bar.y - 4);
    await expect(touchPage.locator('.deliver-player--fullscreen, .deliver-player--filling')).toHaveCount(1);
    await expect(card).toHaveCount(0);
    await phone.close();
    for (const id of ids) {
      expect((await api.delete(`/ocs/v2.php/apps/deliver/api/v1/comments/${id}?format=json`)).ok()).toBe(true);
    }
    await api.dispose();
  });
  test('a press on a Comment\'s circle that does not move opens it, one that moves drags the playhead, by mouse and by finger', async ({
    playwright
  }) => {
    const api = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: auth,
      extraHTTPHeaders: ocsHeaders
    });
    const project = await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)).json();
    const newest = Math.max(...project.ocs.data.assets[0].versions.map(each => each.id));
    const made = await api.post(`/ocs/v2.php/apps/deliver/api/v1/versions/${newest}/comments?format=json`, {
      data: {
        inFrame: 30,
        body: 'drag me'
      }
    });
    const id = (await made.json()).ocs.data.id;
    const phone = await browser.newContext({
      baseURL: BROWSER_URL,
      ...PHONE
    });
    const touchPage = await phone.newPage();
    await login(touchPage);
    const cdp = await phone.newCDPSession(touchPage);
    const finger = (x, y) => ({
      down: () => cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{
          x,
          y
        }]
      }),
      move: dx => cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{
          x: x + dx,
          y
        }]
      }),
      up: () => cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: []
      })
    });
    const mouse = (x, y) => ({
      down: async () => {
        await page.mouse.move(x, y);
        await page.mouse.down();
      },
      move: dx => page.mouse.move(x + dx, y),
      up: () => page.mouse.up()
    });
    for (const [target, pointer] of [[page, mouse], [touchPage, finger]]) {
      await target.goto(`/apps/deliver/versions/${newest}`);
      const video = target.locator('video.deliver-player__video');
      await expect(video).toHaveJSProperty('readyState', 4);
      const frame = () => video.evaluate(element => Math.floor(element.currentTime * 25 + 0.001));
      const paused = () => video.evaluate(element => element.paused);
      const bar = await target.locator('.deliver-player__timeline').boundingBox();
      const box = await target.locator('.deliver-player__marker[aria-label$="drag me"]').boundingBox();
      // A little off its middle, a Frame of its own
      const x = box.x + box.width / 2 - 5;
      const {
        down,
        move,
        up
      } = pointer(x, box.y + box.height / 2);
      const at = px => Math.floor((px - bar.x) / bar.width * 100);
      const peek = target.locator('.deliver-player__peek');
      const shown = target.locator('.deliver-player__hover');

      // Within the slop it does not seek but opens
      await down();
      await move(6);
      await target.waitForTimeout(150);
      expect(await frame()).toBe(0);
      await up();
      await expect(peek).toContainText('drag me');
      await expect.poll(frame).toBe(target === page ? 30 : 0);
      await target.reload();
      await expect(video).toHaveJSProperty('readyState', 4);
      await expect(target.locator('.deliver-player__marker[aria-label$="drag me"]')).toBeVisible();

      // Past it the playhead goes along, with the Frame over the pointer and no card, and playback held
      await target.getByRole('button', {
        name: /^Play/
      }).first().click();
      await expect.poll(paused).toBe(false);
      await down();
      await move(40);
      await move(120);
      await expect.poll(frame).toBe(at(x + 120));
      expect(await paused()).toBe(true);
      await expect(shown).toBeVisible();
      await expect(peek).toHaveCount(0);
      // Back on the circle and let go, it is where the pointer is, still no click
      await move(0);
      await target.getByRole('button', {
        name: /^Pause|^Play/
      }).first().waitFor();
      await expect.poll(frame).toBe(at(x));
      await up();
      await expect.poll(paused).toBe(false);
      await expect(target.locator('.deliver-player__peek--tapped')).toHaveCount(0);
      await target.waitForTimeout(400);
      expect(await paused()).toBe(false);
      expect(await frame()).toBeGreaterThanOrEqual(at(x));
    }
    // A click counts again after a drag
    await page.locator('.deliver-player__marker[aria-label$="drag me"]').click({
      force: true
    });
    await expect.poll(() => page.locator('video.deliver-player__video').evaluate(element => element.currentTime)).toBeCloseTo(1.2, 1);
    await phone.close();
    expect((await api.delete(`/ocs/v2.php/apps/deliver/api/v1/comments/${id}?format=json`)).ok()).toBe(true);
    await api.dispose();
  });
  test('a finger on the timeline holds playback and resumes on lifting only if it played', async () => {
    const phone = await browser.newContext({
      baseURL: BROWSER_URL,
      ...PHONE
    });
    const touchPage = await phone.newPage();
    await login(touchPage);
    await touchPage.goto(`/apps/deliver/versions/${versionId}`);
    const video = touchPage.locator('video.deliver-player__video');
    await expect(video).toHaveJSProperty('readyState', 4);
    const cdp = await phone.newCDPSession(touchPage);
    const bar = await touchPage.locator('.deliver-player__timeline').boundingBox();
    const y = bar.y + bar.height / 2;
    const touch = (type, x) => cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{
        x,
        y
      }]
    });
    const paused = () => video.evaluate(element => element.paused);

    // Playing: held while the finger is down, going on from where it lifted
    await touchPage.getByRole('button', {
      name: 'Play',
      exact: true
    }).tap();
    await expect.poll(paused).toBe(false);
    await touch('touchStart', bar.x + bar.width * 0.2);
    await touch('touchMove', bar.x + bar.width * 0.6);
    await expect.poll(paused).toBe(true);
    // The picture followed the finger before it lifted
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(2);
    await touch('touchEnd');
    await expect.poll(paused).toBe(false);
    expect(await video.evaluate(element => element.currentTime)).toBeGreaterThan(2);

    // A second finger lands during the drag: both lift, and it still goes on
    await touch('touchStart', bar.x + bar.width * 0.2);
    await touch('touchMove', bar.x + bar.width * 0.4);
    await expect.poll(paused).toBe(true);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{
        x: bar.x + bar.width * 0.4,
        y,
        id: 0
      }, {
        x: bar.x + bar.width * 0.7,
        y,
        id: 1
      }]
    });
    await touch('touchEnd');
    await expect.poll(paused).toBe(false);

    // Paused: stays paused
    await touchPage.getByRole('button', {
      name: 'Pause',
      exact: true
    }).tap();
    await touch('touchStart', bar.x + bar.width * 0.2);
    await touch('touchMove', bar.x + bar.width * 0.3);
    await touch('touchEnd');
    await touchPage.waitForTimeout(400);
    expect(await paused()).toBe(true);
    await phone.close();
  });
  test('a click on the Compare timeline starts a side that had run out again', async ({
    playwright
  }) => {
    // The Compare test left a second Version on the Asset
    const api = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: auth,
      extraHTTPHeaders: ocsHeaders
    });
    const project = await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)).json();
    await api.dispose();
    const stack = project.ocs.data.assets.find(each => each.versions.length >= 2).versions;
    await page.goto(`/apps/deliver/compare/${stack[1].id}/${stack[0].id}`);
    const videos = page.locator('.deliver-compare video');
    await expect(videos.first()).toHaveJSProperty('readyState', 4);
    // B runs 50 Frames (2 s) ahead of A, so it is out of picture before A is
    await page.locator('.deliver-compare__offset').fill('50');
    await page.getByRole('button', {
      name: /^Play \(/
    }).click();
    await expect.poll(() => videos.nth(1).evaluate(element => element.ended), {
      timeout: 10_000
    }).toBe(true);
    const bar = await page.locator('.deliver-compare__timeline').boundingBox();
    await page.mouse.click(bar.x + bar.width * 0.1, bar.y + bar.height / 2);
    await page.waitForTimeout(300);
    expect(await videos.first().evaluate(element => element.paused)).toBe(false);
    expect(await videos.nth(1).evaluate(element => element.paused)).toBe(false);
  });
  test('dragging the Compare bar seeks both sides live, B offset from A, holds playback and goes on after', async ({
    playwright
  }) => {
    const api = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: auth,
      extraHTTPHeaders: ocsHeaders
    });
    const project = await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)).json();
    await api.dispose();
    const stack = project.ocs.data.assets.find(each => each.versions.length >= 2).versions;
    await page.goto(`/apps/deliver/compare/${stack[1].id}/${stack[0].id}`);
    const videos = page.locator('.deliver-compare video');
    await expect(videos.first()).toHaveJSProperty('readyState', 4);
    // B stands 25 Frames (1 s) ahead of A
    await page.locator('.deliver-compare__offset').fill('25');
    const times = () => videos.evaluateAll(all => all.map(video => video.currentTime));
    const paused = () => videos.evaluateAll(all => all.map(video => video.paused));
    const bar = await page.locator('.deliver-compare__timeline').boundingBox();
    const y = bar.y + bar.height / 2;
    await page.getByRole('button', {
      name: /^Play \(/
    }).click();
    await expect.poll(paused).toEqual([false, false]);
    await page.mouse.move(bar.x + bar.width * 0.1, y);
    await page.mouse.down();
    // A steady drag: A is sought one seek at a time, the latest Frame next, and not once for every move
    // (a drag holds playback once; pausing seeks again, which would abort the seek on its way)
    await videos.first().evaluate(element => {
      const {
        get,
        set
      } = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
      window.assigned = 0;
      window.settled = 0;
      element.addEventListener('seeked', () => window.settled++);
      Object.defineProperty(element, 'currentTime', {
        get: () => get.call(element),
        set: value => {
          window.assigned++;
          set.call(element, value);
        }
      });
    });
    for (let step = 1; step <= 60; step++) {
      await page.mouse.move(bar.x + bar.width * (0.1 + step * 0.0075), y);
    }
    const drag = await page.evaluate(() => ({
      assigned: window.assigned,
      settled: window.settled
    }));
    expect(drag.assigned).toBeLessThanOrEqual(drag.settled + 4);
    // Still pressed: both sides are there already, B a second on from A, and neither plays
    await expect.poll(async () => (await times())[0]).toBeGreaterThan(1.8);
    await expect.poll(async () => (await times())[1] - (await times())[0]).toBeCloseTo(1, 1);
    expect(await paused()).toEqual([true, true]);
    await page.mouse.up();
    await expect.poll(paused).toEqual([false, false]);
    await page.keyboard.press('k');
    await page.locator('.deliver-compare__offset').fill('0');
  });
  test('Shift+arrows skip ten seconds in Compare, both sides together', async ({
    playwright
  }) => {
    const api = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: auth,
      extraHTTPHeaders: ocsHeaders
    });
    const project = await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)).json();
    await api.dispose();
    const stack = project.ocs.data.assets.find(each => each.versions.length >= 2).versions;
    await page.goto(`/apps/deliver/compare/${stack[1].id}/${stack[0].id}`);
    const videos = page.locator('.deliver-compare video');
    await expect(videos.first()).toHaveJSProperty('readyState', 4);
    await page.locator('.deliver-compare__offset').fill('0');
    const bar = await page.locator('.deliver-compare__timeline').boundingBox();
    await page.mouse.click(bar.x + bar.width * 0.5, bar.y + bar.height / 2);
    await page.locator('.deliver-layout__bar h2').click();
    // Ten seconds are more than the 4 s clip: they land on its last Frame, and back on the first
    await page.keyboard.press('Shift+ArrowRight');
    await expect(page.locator('.deliver-compare__timecode')).toContainText('00:00:03:24');
    await page.keyboard.press('Shift+ArrowLeft');
    await expect(page.locator('.deliver-compare__timecode')).toContainText('00:00:00:00');
    const times = await videos.evaluateAll(all => all.map(video => video.currentTime));
    expect(times[1]).toBeCloseTo(times[0], 3);
  });
  test('a Review Link remembers the list for itself', async ({
    playwright
  }) => {
    const api = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: auth,
      extraHTTPHeaders: ocsHeaders
    });
    // The landing page opens only where a link shows several Assets
    const dav = `/remote.php/dav/files/${USER}/${folder}`;
    const count = async () => (await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)).json()).ocs.data.assets.length;
    const before = await count();
    expect((await api.fetch(`${dav}/linklist.webm`, {
      method: 'PUT',
      data: readFileSync(CLIP)
    })).status()).toBe(201);
    await expect.poll(count).toBe(before + 1);
    const make = async () => (await (await api.post(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}/links?format=json`)).json()).ocs.data.token;
    const [one, other] = [await make(), await make()];
    await api.dispose();
    const visitor = await browser.newContext({
      baseURL: BROWSER_URL
    });
    const reviewer = await visitor.newPage();
    await reviewer.goto(`/apps/deliver/s/${one}`);
    await expect(reviewer.locator('.deliver-landing__card').first()).toBeVisible();
    await expect(reviewer.locator('.deliver-landing__grid--list')).toHaveCount(0);
    // An Asset is picked for the ZIP in cards and in rows
    const pick = reviewer.locator('.deliver-landing__pick:not(:disabled)').first();
    await pick.check();
    await expect(reviewer.getByRole('link', {
      name: 'Download selection'
    })).toBeVisible();
    await pick.uncheck();
    await expect(reviewer.getByRole('link', {
      name: 'Download selection'
    })).toHaveCount(0);
    await reviewer.getByRole('button', {
      name: 'Show the Assets as a list'
    }).click();
    await pick.check();
    await expect(reviewer.getByRole('link', {
      name: 'Download selection'
    })).toBeVisible();
    await pick.uncheck();
    await expect(reviewer.locator('.deliver-landing__grid--list')).toHaveCount(1);
    await expect(reviewer.locator('.deliver-landing__facts').first()).toContainText('V1');
    await reviewer.reload();
    await expect(reviewer.locator('.deliver-landing__grid--list')).toHaveCount(1);
    // Another link of the same Project is still cards
    await reviewer.goto(`/apps/deliver/s/${other}`);
    await expect(reviewer.locator('.deliver-landing__card').first()).toBeVisible();
    await expect(reviewer.locator('.deliver-landing__grid--list')).toHaveCount(0);
    await visitor.close();
    const cleanup = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: auth
    });
    await cleanup.fetch(`${dav}/linklist.webm`, {
      method: 'DELETE'
    });
    await cleanup.dispose();
  });
});
test.describe('Audio review', () => {
  let browser;
  let context;
  let page;
  let folder;
  let versionId;
  let clipVersionId;
  let projectId;
  test.beforeAll(async ({
    playwright
  }) => {
    await testUser(playwright);
    const api = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: auth,
      extraHTTPHeaders: ocsHeaders
    });
    folder = 'deliver-e2e-' + randomBytes(4).toString('hex');
    const dav = `/remote.php/dav/files/${USER}/${folder}`;
    expect((await api.fetch(dav, {
      method: 'MKCOL'
    })).status()).toBe(201);
    expect((await api.fetch(`${dav}/long-mix.webm`, {
      method: 'PUT',
      data: readFileSync(LONG_MIX)
    })).status()).toBe(201);
    // A video beside it, to step to from the Review view
    expect((await api.fetch(`${dav}/clip.webm`, {
      method: 'PUT',
      data: readFileSync(CLIP)
    })).status()).toBe(201);
    const created = await api.post('/ocs/v2.php/apps/deliver/api/v1/projects?format=json', {
      data: {
        folderId: await fileId(api, dav),
        autoIntake: true
      }
    });
    projectId = (await created.json()).ocs.data.id;
    const project = await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`);
    const assets = (await project.json()).ocs.data.assets;
    versionId = assets.find(asset => asset.name === 'long-mix').versions[0].id;
    clipVersionId = assets.find(asset => asset.name === 'clip').versions[0].id;
    await api.dispose();
    // ffmpeg reads the mix and makes its Waveform
    execFileSync('docker', ['compose', 'exec', '-T', '-u', 'www-data', 'nextcloud', 'php', 'occ', 'deliver:worker', '--once'], {
      stdio: 'inherit'
    });
    browser = await chromium.connectOverCDP(CDP);
    context = await browser.newContext({
      baseURL: BROWSER_URL
    });
    page = await context.newPage();
    await login(page);
  });
  test.afterAll(async ({
    playwright
  }) => {
    await context?.close();
    await browser?.close();
    const api = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: auth,
      extraHTTPHeaders: ocsHeaders
    });
    await api.delete(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`);
    await api.fetch(`/remote.php/dav/files/${USER}/${folder}`, {
      method: 'DELETE'
    });
    await api.dispose();
  });
  test('a long audio Version opens zoomed, scrolls under its centred playhead and seeks without stopping', async () => {
    await page.goto(`/apps/deliver/versions/${versionId}`);
    const canvas = page.locator('.deliver-wave canvas');
    await expect(canvas).toBeVisible();
    const audio = page.locator('video.deliver-player__video');
    await expect(audio).toHaveJSProperty('readyState', 4);
    const time = () => audio.evaluate(element => element.currentTime);
    // The playhead is the white line down the middle of the stage
    const centre = () => canvas.evaluate(element => {
      const pixel = element.getContext('2d').getImageData(Math.round(element.width / 2) - 1, element.height - Math.round(44 * element.width / element.clientWidth), 1, 1).data;
      return pixel[0] + pixel[1] + pixel[2];
    });

    // One minute of the six on the stage; on the bar under it the half after the start
    await expect(page.getByRole('button', {
      name: '1 min'
    })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', {
      name: '5 min'
    })).toBeVisible();
    const shown = page.locator('.deliver-player__window');
    const width = async () => parseFloat(await shown.evaluate(element => element.style.width.match(/[\d.]+%/)[0]));
    expect(await width()).toBeCloseTo(30 / 360 * 100, 0);
    expect(await centre()).toBe(765);

    // Playing, the wave moves under the playhead, which stays in the middle
    const still = await canvas.evaluate(element => element.toDataURL());
    await page.getByRole('button', {
      name: 'Play (Space)'
    }).click();
    await expect.poll(time).toBeGreaterThan(1);
    expect(await canvas.evaluate(element => element.toDataURL())).not.toBe(still);
    expect(await centre()).toBe(765);
    await expect.poll(width).toBeGreaterThan(30 / 360 * 100 + 0.1);

    // A click in the strip, a quarter of the stage to the right, goes 15 seconds on and keeps playing
    const box = await canvas.boundingBox();
    const before = await time();
    await canvas.click({
      position: {
        x: box.width * 0.75,
        y: box.height - 20
      }
    });
    expect((await time()) - before).toBeGreaterThan(14);
    expect((await time()) - before).toBeLessThan(17);
    expect(await audio.evaluate(element => element.paused)).toBe(false);

    // A zoom step narrows the window, and the whole shows all of it
    await page.getByRole('button', {
      name: '15 s'
    }).click();
    await expect(page.getByRole('button', {
      name: '15 s'
    })).toHaveAttribute('aria-pressed', 'true');
    expect(await width()).toBeCloseTo(15 / 360 * 100, 0);
    await page.getByRole('button', {
      name: 'Whole',
      exact: true
    }).click();
    expect(await width()).toBe(100);
    // Over the whole piece the wave after the playhead is not drawn as played
    const playedAfter = await canvas.evaluate(element => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--color-primary-element)';
      element.parentElement.append(probe);
      const primary = getComputedStyle(probe).color.match(/\d+/g).map(Number);
      probe.remove();
      const ratio = element.width / element.clientWidth;
      const row = element.getContext('2d').getImageData(Math.round(element.width / 2), Math.round((40 + (element.clientHeight - 80) / 2) * ratio), Math.round(element.width / 2), 1).data;
      let count = 0;
      for (let at = 0; at < row.length; at += 4) {
        count += Math.max(...[0, 1, 2].map(channel => Math.abs(row[at + channel] - primary[channel]))) < 8 ? 1 : 0;
      }
      return count;
    });
    expect(playedAfter).toBe(0);
    await page.getByRole('button', {
      name: 'Pause (Space)'
    }).click();
  });
  test('the bars keep their heights and move by whole pixels from one moment to another, on a stage of an odd width too', async () => {
    // An odd number of pixels across, where a playhead and window rounded apart trembled
    await page.setViewportSize({
      width: 1281,
      height: 800
    });
    await page.goto(`/apps/deliver/versions/${versionId}`);
    const canvas = page.locator('.deliver-wave canvas');
    await expect(canvas).toBeVisible();
    const audio = page.locator('video.deliver-player__video');
    await expect(audio).toHaveJSProperty('readyState', 4);
    await page.getByRole('button', {
      name: '1 min'
    }).click();
    // The coverage of each device-pixel column right of the playhead, where every bar is drawn alike
    const columns = async seconds => {
      // Once the audio stands there, and the stage has glided there and stands still
      await audio.evaluate((element, at) => new Promise(resolve => {
        element.addEventListener('seeked', resolve, {
          once: true
        });
        element.currentTime = at;
      }), seconds);
      await canvas.evaluate(element => new Promise(resolve => {
        let before = '';
        const frame = () => {
          const now = element.toDataURL();
          if (now === before) {
            resolve();
          } else {
            before = now;
            setTimeout(() => requestAnimationFrame(frame), 50);
          }
        };
        requestAnimationFrame(frame);
      }));
      return canvas.evaluate(element => {
        const ratio = element.width / element.clientWidth;
        const top = Math.round(40 * ratio);
        const bottom = element.height - Math.round(40 * ratio);
        const data = element.getContext('2d').getImageData(0, top, element.width, bottom - top).data;
        return Array.from({
          length: element.width
        }, (_, x) => {
          let sum = 0;
          for (let y = 0; y < bottom - top; y++) {
            sum += data[(y * element.width + x) * 4 + 3];
          }
          return sum;
        });
      });
    };
    const before = await columns(100);
    const after = await columns(103.3);
    const width = before.length;
    // 3.3 s at a minute across is 5.5 % of the stage; the best whole shift explains every column exactly
    let best = {
      shift: 0,
      difference: Infinity
    };
    for (let shift = 0; shift <= width / 10; shift++) {
      let difference = 0;
      for (let x = Math.round(width * 0.6) + shift; x < width - 2; x++) {
        difference += Math.abs(before[x] - after[x - shift]);
      }
      if (difference < best.difference) {
        best = {
          shift,
          difference
        };
      }
    }
    expect(best.difference).toBe(0);
    expect(Math.abs(best.shift - width * 3.3 / 60)).toBeLessThanOrEqual(1);
    await page.setViewportSize({
      width: 1280,
      height: 720
    });
  });
  test('after a click in the strip the wave glides to the new place within half a second, and jumps under reduced motion', async () => {
    await page.goto(`/apps/deliver/versions/${versionId}`);
    const canvas = page.locator('.deliver-wave canvas');
    await expect(canvas).toBeVisible();
    const audio = page.locator('video.deliver-player__video');
    await expect(audio).toHaveJSProperty('readyState', 4);
    await page.getByRole('button', {
      name: '1 min'
    }).click();
    await audio.evaluate(element => {
      element.currentTime = 100;
    });
    await expect.poll(() => canvas.evaluate(element => element.drawnAt)).toBeCloseTo(100.0005, 2);
    const box = await canvas.boundingBox();
    // The seconds drawn, on every frame for 0.7 s: cheap to record, analysed afterwards
    const record = () => canvas.evaluate(element => new Promise(resolve => {
      const samples = [];
      const start = performance.now();
      const frame = () => {
        samples.push({
          at: performance.now() - start,
          drawn: element.drawnAt
        });
        if (performance.now() - start < 700) {
          requestAnimationFrame(frame);
        } else {
          resolve(samples);
        }
      };
      requestAnimationFrame(frame);
    }));
    const quarterOn = {
      position: {
        x: box.width * 0.75,
        y: box.height - 20
      }
    };
    let recording = record();
    await canvas.click(quarterOn);
    let samples = await recording;
    const target = await audio.evaluate(element => element.currentTime);
    expect(target).toBeCloseTo(115, 0);
    expect(samples.at(-1).drawn).toBeCloseTo(target, 2);
    // On the way, somewhere strictly between, and there within half a second of setting off
    expect(samples.some(each => each.drawn > 100.5 && each.drawn < target - 0.5)).toBe(true);
    const moved = samples.find(each => each.drawn > 100.01);
    const arrived = samples.find(each => Math.abs(each.drawn - target) < 0.01);
    expect(arrived.at - moved.at).toBeLessThan(500);

    // With reduced motion it is there at once
    await page.emulateMedia({
      reducedMotion: 'reduce'
    });
    recording = record();
    await canvas.click(quarterOn);
    samples = await recording;
    expect(samples.every(each => Math.abs(each.drawn - target) < 0.01 || Math.abs(each.drawn - (target + 15)) < 0.01)).toBe(true);
    await page.emulateMedia({
      reducedMotion: null
    });
  });
  test('the wave follows a swipe at once, never falls a glide behind a held key, and a click during a glide lands where the pointer is', async () => {
    await page.goto(`/apps/deliver/versions/${versionId}`);
    const canvas = page.locator('.deliver-wave canvas');
    await expect(canvas).toBeVisible();
    const audio = page.locator('video.deliver-player__video');
    await expect(audio).toHaveJSProperty('readyState', 4);
    await page.getByRole('button', {
      name: '1 min'
    }).click();
    const goTo = async seconds => {
      await audio.evaluate((element, at) => {
        element.currentTime = at;
      }, seconds);
      await expect.poll(() => canvas.evaluate(element => element.drawnAt)).toBeCloseTo(seconds + 0.0005, 2);
    };

    // A trackpad's sideways swipe sends a wheel event on every frame: the wave stays with the sound
    await goTo(100);
    const swipe = await canvas.evaluate(element => new Promise(resolve => {
      const audio = document.querySelector('video.deliver-player__video');
      const gaps = [];
      let count = 0;
      const frame = () => {
        gaps.push(Math.abs(element.drawnAt - audio.currentTime));
        if (count++ < 50) {
          element.dispatchEvent(new WheelEvent('wheel', {
            deltaX: 6,
            bubbles: true,
            cancelable: true
          }));
          requestAnimationFrame(frame);
        } else {
          resolve({
            gaps,
            end: audio.currentTime
          });
        }
      };
      requestAnimationFrame(frame);
    }));
    expect(swipe.end).toBeGreaterThan(110);
    // One wheel event is 6 px of 840: less than half a second
    expect(Math.max(...swipe.gaps)).toBeLessThan(1);

    // Shift+→ held: the wave is never behind where the sound was a glide (and a frame) earlier
    await goTo(100);
    const watching = canvas.evaluate(element => new Promise(resolve => {
      const audio = document.querySelector('video.deliver-player__video');
      const samples = [];
      const start = performance.now();
      const frame = () => {
        samples.push({
          at: performance.now() - start,
          drawn: element.drawnAt,
          sound: audio.currentTime
        });
        if (performance.now() - start < 1200) {
          requestAnimationFrame(frame);
        } else {
          resolve(samples);
        }
      };
      requestAnimationFrame(frame);
    }));
    await page.locator('.deliver-review__title').click();
    await page.keyboard.down('Shift');
    for (let repeat = 0; repeat < 15; repeat++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(33);
    }
    await page.keyboard.up('Shift');
    const held = await watching;
    const soundAt = time => [...held].reverse().find(each => each.at <= time)?.sound ?? 100;
    for (const each of held) {
      expect(each.drawn).toBeGreaterThanOrEqual(soundAt(each.at - 250) - 0.01);
    }
    expect(held.at(-1).drawn).toBeCloseTo(held.at(-1).sound, 2);

    // A click in the strip 40 px right of the playhead while a glide runs goes to what is drawn under it, not beside it
    await goTo(100);
    const box = await canvas.boundingBox();
    // Two clicks in the page itself, two frames apart, so the second surely comes while the first one's glide runs
    const {
      drawn,
      landed
    } = await canvas.evaluate(element => new Promise(resolve => {
      const audio = document.querySelector('video.deliver-player__video');
      const box = element.getBoundingClientRect();
      const click = x => {
        const at = {
          clientX: box.left + x,
          clientY: box.bottom - 20,
          pointerId: 7,
          pointerType: 'mouse',
          button: 0,
          bubbles: true
        };
        element.dispatchEvent(new PointerEvent('pointerdown', at));
        element.dispatchEvent(new PointerEvent('pointerup', at));
      };
      click(box.width * 0.75);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const drawn = element.drawnAt;
        click(box.width / 2 + 40);
        resolve({
          drawn,
          landed: audio.currentTime
        });
      }));
    }));
    expect(drawn).toBeLessThan(114.5);
    expect(Math.abs(landed - (drawn + 40 / box.width * 60))).toBeLessThan(0.4);
  });
  test('dragging the bar under the stage moves the wave live and leaves it where the playhead is, with reduced motion too', async () => {
    await page.emulateMedia({
      reducedMotion: 'reduce'
    });
    await page.goto(`/apps/deliver/versions/${versionId}`);
    const canvas = page.locator('.deliver-wave canvas');
    await expect(canvas).toBeVisible();
    const audio = page.locator('video.deliver-player__video');
    await expect(audio).toHaveJSProperty('readyState', 4);
    await page.getByRole('button', {
      name: '1 min'
    }).click();
    const wave = () => canvas.evaluate(element => element.toDataURL());
    const bar = await page.locator('.deliver-player__timeline').boundingBox();
    const y = bar.y + bar.height / 2;
    await page.mouse.move(bar.x + bar.width * 0.1, y);
    const start = await wave();
    await page.mouse.down();
    await page.mouse.move(bar.x + bar.width * 0.5, y, {
      steps: 8
    });
    await expect.poll(() => audio.evaluate(element => element.currentTime)).toBeGreaterThan(170);
    // The wave moved with the pointer before release
    await expect.poll(wave).not.toBe(start);
    await page.mouse.move(bar.x + bar.width * 0.9, y, {
      steps: 12
    });
    await page.mouse.up();
    await page.waitForTimeout(500);
    // Drawn from the time the element is at: a fresh draw changes nothing
    const settled = await wave();
    await page.getByRole('button', {
      name: '15 s'
    }).click();
    await page.getByRole('button', {
      name: '1 min'
    }).click();
    await page.waitForTimeout(300);
    expect(await wave()).toBe(settled);
    // A seek that changes no prop of the stage (the last of a drag lands so, while the drag holds timeupdate
    // back) still draws the wave again: here timeupdate is stopped on its way to the player. Once it has
    // settled, whatever else redraws is let go of, and the wave must draw within two animation frames
    const drawn = await audio.evaluate(element => new Promise(resolve => {
      window.addEventListener('timeupdate', event => event.stopPropagation(), true);
      const clear = CanvasRenderingContext2D.prototype.clearRect;
      let draws = 0;
      CanvasRenderingContext2D.prototype.clearRect = function (...args) {
        draws++;
        return clear.apply(this, args);
      };
      element.addEventListener('seeked', () => {
        draws = 0;
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(draws)));
      }, {
        once: true
      });
      element.currentTime -= 20;
    }));
    expect(drawn).toBeGreaterThan(0);
    await page.emulateMedia({
      reducedMotion: 'no-preference'
    });
  });
  test('a drag on the wave holds playback and lets it go on, but not past the end; Ctrl and the wheel zoom within the steps, remembered', async () => {
    await page.goto(`/apps/deliver/versions/${versionId}`);
    const canvas = page.locator('.deliver-wave canvas');
    await expect(canvas).toBeVisible();
    const audio = page.locator('video.deliver-player__video');
    await expect(audio).toHaveJSProperty('readyState', 4);
    const state = () => audio.evaluate(element => ({
      time: element.currentTime,
      paused: element.paused
    }));
    const shown = page.locator('.deliver-player__window');
    const width = async () => parseFloat(await shown.evaluate(element => element.style.width.match(/[\d.]+%/)[0]));
    await page.getByRole('button', {
      name: '1 min'
    }).click();

    // A quarter of the stage dragged to the left is 15 seconds on; playback holds meanwhile and goes on
    const box = await canvas.boundingBox();
    const y = box.y + box.height / 2;
    await page.getByRole('button', {
      name: 'Play (Space)'
    }).click();
    await expect.poll(async () => (await state()).time).toBeGreaterThan(1);
    const before = (await state()).time;
    await page.mouse.move(box.x + box.width * 0.75, y);
    await page.mouse.down();
    for (let step = 1; step <= 10; step++) {
      await page.mouse.move(box.x + box.width * (0.75 - step * 0.025), y);
    }
    expect((await state()).paused).toBe(true);
    await page.mouse.up();
    const after = await state();
    expect(after.paused).toBe(false);
    expect(after.time - before).toBeGreaterThan(14);
    expect(after.time - before).toBeLessThan(17);

    // Dragged past the end it stays there, paused, as at the natural end, and does not start over
    await page.getByRole('button', {
      name: 'Whole',
      exact: true
    }).click();
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, y);
    await page.mouse.move(box.x + box.width + 50, y);
    await page.mouse.up();
    await page.waitForTimeout(500);
    const end = await state();
    expect(end.paused).toBe(true);
    expect(end.time).toBeGreaterThan(359);

    // Ctrl and the wheel zoom in down to 15 seconds and out up to the whole, and a reload keeps it
    await page.getByRole('button', {
      name: '1 min'
    }).click();
    await audio.evaluate(element => {
      element.currentTime = 180;
    });
    await page.mouse.move(box.x + box.width / 2, y);
    await page.keyboard.down('Control');
    for (let notch = 0; notch < 5; notch++) {
      await page.mouse.wheel(0, -100);
    }
    await expect(page.getByRole('button', {
      name: '15 s'
    })).toHaveAttribute('aria-pressed', 'true');
    expect(await width()).toBeCloseTo(15 / 360 * 100, 0);
    for (let notch = 0; notch < 12; notch++) {
      await page.mouse.wheel(0, 100);
    }
    await page.keyboard.up('Control');
    await expect(page.getByRole('button', {
      name: 'Whole',
      exact: true
    })).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.getByRole('button', {
      name: 'Whole',
      exact: true
    })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', {
      name: '1 min'
    }).click();
  });
  test('C comments on the wave, an empty field lets go of the place, and a circle opens a card that follows the list and keeps a Reply half written', async () => {
    await page.goto(`/apps/deliver/versions/${versionId}`);
    const canvas = page.locator('.deliver-wave canvas');
    await expect(canvas).toBeVisible();
    const audio = page.locator('video.deliver-player__video');
    await expect(audio).toHaveJSProperty('readyState', 4);
    await page.getByRole('button', {
      name: '1 min'
    }).click();
    const box = await canvas.boundingBox();
    const field = page.locator('#deliver-comment-body');
    const anchor = page.locator('.deliver-comments__anchor');
    // A seek, and the wave glided there: clicks land on what is drawn
    const goTo = async seconds => {
      await audio.evaluate((element, at) => {
        element.currentTime = at;
      }, seconds);
      await expect.poll(() => canvas.evaluate(element => element.drawnAt)).toBeCloseTo(seconds + 0.0005, 2);
    };
    const send = () => page.locator('.deliver-comments__form button[title="Send (Enter)"]').click();
    const quarterOn = {
      position: {
        x: box.width * 0.75,
        y: box.height - 20
      }
    };

    // A click in the strip a quarter of the stage on seeks 15 seconds on, and C comments there
    await commentOnQuarter(page, canvas, quarterOn);
    await expect(field).toBeFocused();
    await expect(anchor).toHaveText('0:15.000');
    // Escape in the empty field lets go of it: the next Comment follows the player again
    await field.press('Escape');
    await goTo(40);
    await expect(anchor).toHaveText('0:40.000');
    // With a word in the field the place stays, until the field is emptied
    await commentOnQuarter(page, canvas, quarterOn);
    await expect(anchor).toHaveText('0:55.000');
    await field.fill('kept');
    await field.press('Escape');
    await goTo(100);
    await expect(anchor).toHaveText('0:55.000');
    await field.fill('');
    await expect(anchor).toHaveText('1:40.000');
    // A click in the strip, which seeks, lets go too
    await commentOnQuarter(page, canvas, quarterOn);
    await expect(anchor).toHaveText('1:55.000');
    // Once the wave has glided there: a click lands on what is drawn under it
    await expect.poll(() => canvas.evaluate(element => Math.abs(element.drawnAt - document.querySelector('video.deliver-player__video').currentTime))).toBeLessThan(0.01);
    await canvas.click({
      position: {
        x: box.width * 0.25,
        y: box.height - 20
      }
    });
    await expect(anchor).toHaveText('1:40.000');
    await expect.poll(() => canvas.evaluate(element => Math.abs(element.drawnAt - document.querySelector('video.deliver-player__video').currentTime))).toBeLessThan(0.01);
    await commentOnQuarter(page, canvas, quarterOn);
    await expect(anchor).toHaveText('1:55.000');
    await field.fill('clicked here');
    await send();
    await expect(page.locator('.deliver-comment').filter({
      hasText: 'clicked here'
    })).toBeVisible();

    // C on audio stops it, as on video, the Comment where it was at the key press
    await page.getByRole('button', {
      name: 'Play (Space)'
    }).click();
    await expect.poll(() => audio.evaluate(element => element.currentTime)).toBeGreaterThan(117);
    await page.locator('.deliver-review__title').click();
    await page.keyboard.press('c');
    await expect(field).toBeFocused();
    await page.waitForTimeout(500);
    expect(await audio.evaluate(element => element.paused)).toBe(true);
    // The Frame of the key press: where the element stopped, to the millisecond
    const stopped = await audio.evaluate(element => Math.round(element.currentTime * 1000));
    const clockOf = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms % 60000 / 1000)).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
    // The Frame's own time may differ from the element's by the last millisecond
    await expect(anchor).toHaveText(new RegExp(`^(${clockOf(stopped - 1)}|${clockOf(stopped)}|${clockOf(stopped + 1)})$`));
    await field.fill('while it played');
    await send();
    await expect(page.locator('.deliver-comment').filter({
      hasText: 'while it played'
    })).toBeVisible();

    // Standing on the first Comment, its circle is under the playhead; a click on it opens its card and does not seek
    await page.getByRole('button', {
      name: '15 s'
    }).click();
    const first = page.locator('.deliver-comments__list > .deliver-comment').filter({
      hasText: 'clicked here'
    });
    const second = page.locator('.deliver-comments__list > .deliver-comment').filter({
      hasText: 'while it played'
    });
    const openFirst = async () => {
      await first.locator('.deliver-comment__anchor').click();
      const at = await audio.evaluate(element => element.currentTime);
      await canvas.click({
        position: {
          x: box.width / 2,
          y: box.height - 20
        }
      });
      expect(await audio.evaluate(element => element.currentTime)).toBe(at);
    };
    await openFirst();
    const card = page.getByRole('dialog', {
      name: /^Comment #/
    });
    await expect(card).toContainText('clicked here');
    await expect(first).toHaveClass(/deliver-comment--selected/);
    // It follows the list: another Comment picked there shows in it
    await second.locator('.deliver-comment__body').click();
    await expect(card).toContainText('while it played');
    await first.locator('.deliver-comment__body').click();
    await expect(card).toContainText('clicked here');
    // Escape leaves a Reply half written alone; a click on the bar closes the card, and the Reply waits for it
    await card.getByPlaceholder('Write a Reply').fill('half');
    await page.keyboard.press('Escape');
    await expect(card).toBeVisible();
    await page.locator('.deliver-player__timeline').click();
    await expect(card).toHaveCount(0);
    await openFirst();
    await expect(card.getByPlaceholder('Write a Reply')).toHaveValue('half');
    await card.getByPlaceholder('Write a Reply').fill('answered on the wave');
    await card.getByRole('button', {
      name: 'Reply',
      exact: true
    }).click();
    await expect(first.locator('.deliver-comment--reply')).toContainText('answered on the wave');
    await expect(card.locator('.deliver-comment--reply')).toContainText('answered on the wave');
    // With nothing half written, Escape closes it wherever the focus is
    await page.locator('.deliver-review__title').click();
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    // A double click on the wave whose first click closed the card skips nothing
    await openFirst();
    await expect(card).toBeVisible();
    const closing = await audio.evaluate(element => element.currentTime);
    await canvas.dblclick({
      position: {
        x: box.width * 0.95,
        y: box.height / 4
      }
    });
    await expect(card).toHaveCount(0);
    expect(await audio.evaluate(element => element.currentTime)).toBe(closing);
  });
  test('with the Comment list hidden, a Comment on audio is written at the Waveform and the list stays hidden', async () => {
    await page.goto(`/apps/deliver/versions/${versionId}`);
    const canvas = page.locator('.deliver-wave canvas');
    await expect(canvas).toBeVisible();
    const audio = page.locator('video.deliver-player__video');
    await expect(audio).toHaveJSProperty('readyState', 4);
    await page.getByRole('button', {
      name: '1 min'
    }).click();
    await audio.evaluate(element => {
      element.currentTime = 200;
    });
    await page.getByRole('button', {
      name: 'Hide Comments'
    }).click();
    const list = page.locator('.deliver-layout__panel');
    await expect(list).toBeHidden();
    const box = await canvas.boundingBox();
    const quarterOn = {
      position: {
        x: box.width * 0.75,
        y: box.height - 20
      }
    };
    const popup = page.getByRole('dialog', {
      name: 'New Comment'
    });
    const field = popup.locator('#deliver-comment-body-inline');

    // A double click opens no field
    await canvas.dblclick({
      position: {
        x: box.width * 0.75,
        y: box.height / 2
      }
    });
    await expect(popup).toHaveCount(0);
    await canvas.dblclick(quarterOn);
    await expect(popup).toHaveCount(0);
    await audio.evaluate(element => {
      element.currentTime = 200;
    });
    await expect.poll(() => canvas.evaluate(element => Math.abs(element.drawnAt - 200))).toBeLessThan(0.01);
    // C opens the field at the wave, at that Frame, instead of the list
    await commentOnQuarter(page, canvas, quarterOn);
    await expect(popup).toBeVisible();
    await expect(field).toBeFocused();
    await expect(popup.locator('.deliver-comments__anchor')).toHaveText('3:35.000');
    await field.fill('written at the wave');
    await field.press('Enter');
    await expect(popup).toHaveCount(0);
    await expect(list).toBeHidden();
    // Its circle stands under the playhead, which stands on its Frame
    await expect.poll(() => canvas.evaluate(element => {
      const ratio = element.width / element.clientWidth;
      const pixel = element.getContext('2d').getImageData(Math.round(element.width / 2) + Math.round(8 * ratio), element.height - Math.round(20 * ratio), 1, 1).data;
      return pixel[3];
    })).toBeGreaterThan(0);

    // Escape on the empty field closes it and lets go of the place
    await commentOnQuarter(page, canvas, quarterOn);
    await expect(field).toBeFocused();
    await field.press('Escape');
    await expect(popup).toHaveCount(0);
    await audio.evaluate(element => {
      element.currentTime = 250;
    });

    // The draft is the list's: opening the list mid-sentence takes it there and closes the field at the wave
    await commentOnQuarter(page, canvas, quarterOn);
    await field.fill('half a thought');
    await page.getByRole('button', {
      name: 'Show Comments'
    }).click();
    await expect(popup).toHaveCount(0);
    await expect(page.locator('#deliver-comment-body')).toHaveValue('half a thought');
    await expect(page.locator('.deliver-comments__list')).toContainText('written at the wave');
    await expect(page.locator('.deliver-comments__anchor')).toHaveText('4:25.000');
    // Emptied, the field follows the player again
    await page.locator('#deliver-comment-body').fill('');
    await audio.evaluate(element => {
      element.currentTime = 300;
    });
    await expect(page.locator('.deliver-comments__anchor')).toHaveText('5:00.000');
  });
  test('the field at the Waveform keeps its place while empty, takes its own buttons, keeps text on an outside click, and never shows with a Comment card', async () => {
    await page.goto(`/apps/deliver/versions/${versionId}`);
    const canvas = page.locator('.deliver-wave canvas');
    await expect(canvas).toBeVisible();
    const audio = page.locator('video.deliver-player__video');
    await expect(audio).toHaveJSProperty('readyState', 4);
    await page.getByRole('button', {
      name: '1 min'
    }).click();
    // Standing on the Comment written at the wave before, 3:35
    await audio.evaluate(element => {
      element.currentTime = 215;
    });
    await expect.poll(() => canvas.evaluate(element => Math.abs(element.drawnAt - document.querySelector('video.deliver-player__video').currentTime))).toBeLessThan(0.01);
    if (await page.getByRole('button', {
      name: 'Hide Comments'
    }).isVisible()) {
      await page.getByRole('button', {
        name: 'Hide Comments'
      }).click();
    }
    const box = await canvas.boundingBox();
    const quarterOn = {
      position: {
        x: box.width * 0.75,
        y: box.height - 20
      }
    };
    const popup = page.getByRole('dialog', {
      name: 'New Comment'
    });
    const field = popup.locator('#deliver-comment-body-inline');
    const anchor = popup.locator('.deliver-comments__anchor');

    // Emptied again, it stays with its place, and keys go on into the field, not to the player
    await commentOnQuarter(page, canvas, quarterOn);
    await expect(anchor).toHaveText('3:50.000');
    await field.pressSequentially('ab');
    await field.press('Backspace');
    await field.press('Backspace');
    await expect(popup).toBeVisible();
    await expect(field).toBeFocused();
    await field.press('k');
    await expect(field).toHaveValue('k');
    expect(await audio.evaluate(element => element.paused)).toBe(true);
    await field.fill('');

    // Its own buttons do not let go of an empty field: the paperclip opens the file dialog, the Range starts
    const chooser = page.waitForEvent('filechooser');
    await popup.getByRole('button', {
      name: 'Attach files'
    }).click();
    await (await chooser).setFiles([]);
    await expect(popup).toBeVisible();
    await popup.getByRole('button', {
      name: 'Start a Range here'
    }).click();
    await expect(popup).toBeVisible();
    await expect(popup.getByRole('button', {
      name: 'End the Range here'
    })).toBeVisible();
    // Ending and clearing the Range keep the card and a place, with and without text
    await popup.getByRole('button', {
      name: 'End the Range here'
    }).click();
    await popup.getByRole('button', {
      name: 'Clear the Range'
    }).click();
    await expect(popup).toBeVisible();
    await expect(field).toBeFocused();
    await field.fill('about this stretch');
    await popup.getByRole('button', {
      name: 'Start a Range here'
    }).click();
    await popup.getByRole('button', {
      name: 'End the Range here'
    }).click();
    await popup.getByRole('button', {
      name: 'Clear the Range'
    }).click();
    await expect(popup).toBeVisible();
    await expect(field).toHaveValue('about this stretch');
    await field.fill('');
    // A file's ✕ goes away when clicked: the card stays, the focus goes back into the field
    const picking = page.waitForEvent('filechooser');
    await popup.getByRole('button', {
      name: 'Attach files'
    }).click();
    await (await picking).setFiles({
      name: 'wrong.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('x')
    });
    await popup.getByRole('button', {
      name: 'Remove wrong.txt'
    }).click();
    await expect(popup).toBeVisible();
    await expect(field).toBeFocused();
    // As in Safari, where a clicked button takes no focus: the field is left for the page, and still the card stays
    await popup.getByRole('button', {
      name: 'Start a Range here'
    }).evaluate(button => button.addEventListener('mousedown', event => {
      event.preventDefault();
      document.activeElement.blur();
    }));
    await popup.getByRole('button', {
      name: 'Start a Range here'
    }).click();
    await expect(popup).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popup).toHaveCount(0);

    // With text, a click outside leaves it open; emptied, the next one closes it
    await commentOnQuarter(page, canvas, quarterOn);
    await field.fill('kept');
    await page.locator('.deliver-review__title').click();
    await expect(popup).toBeVisible();
    await expect(field).toHaveValue('kept');
    await field.fill('');
    await page.locator('.deliver-review__title').click();
    await expect(popup).toHaveCount(0);

    // A Comment's card and the field never show at once
    await audio.evaluate(element => {
      element.currentTime = 215;
    });
    await expect.poll(() => canvas.evaluate(element => Math.abs(element.drawnAt - document.querySelector('video.deliver-player__video').currentTime))).toBeLessThan(0.01);
    await commentOnQuarter(page, canvas, quarterOn);
    await expect(popup).toBeVisible();
    // 3:35 is a quarter of the stage left of the playhead now standing at 3:50, once the wave has glided there
    await expect.poll(() => canvas.evaluate(element => Math.abs(element.drawnAt - document.querySelector('video.deliver-player__video').currentTime))).toBeLessThan(0.01);
    await canvas.click({
      position: {
        x: box.width * 0.25,
        y: box.height - 20
      }
    });
    const card = page.getByRole('dialog', {
      name: /^Comment #/
    });
    await expect(card).toContainText('written at the wave');
    await expect(popup).toHaveCount(0);
    await commentOnQuarter(page, canvas, quarterOn);
    await expect(popup).toBeVisible();
    await expect(card).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', {
      name: 'Show Comments'
    }).click();
  });
  test('under the list an empty pinned field lets go on a click elsewhere and on another Comment\'s Reply, but not on its own buttons', async () => {
    await page.goto(`/apps/deliver/versions/${versionId}`);
    const canvas = page.locator('.deliver-wave canvas');
    await expect(canvas).toBeVisible();
    const audio = page.locator('video.deliver-player__video');
    await expect(audio).toHaveJSProperty('readyState', 4);
    await page.getByRole('button', {
      name: '1 min'
    }).click();
    if (await page.getByRole('button', {
      name: 'Show Comments'
    }).isVisible()) {
      await page.getByRole('button', {
        name: 'Show Comments'
      }).click();
    }
    const anchor = page.locator('.deliver-comments__anchor');
    const goTo = async seconds => {
      await audio.evaluate((element, at) => {
        element.currentTime = at;
      }, seconds);
      await expect(anchor).toHaveText(new RegExp(`^${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`));
    };
    await goTo(20);
    await page.keyboard.press('c');
    await expect(page.locator('#deliver-comment-body')).toBeFocused();
    // Its own paperclip keeps the place
    const picking = page.waitForEvent('filechooser');
    await page.locator('.deliver-comments__form').getByRole('button', {
      name: 'Attach files'
    }).click();
    await (await picking).setFiles([]);
    await audio.evaluate(element => {
      element.currentTime = 30;
    });
    await expect(anchor).toHaveText(/^0:20/);
    // A click elsewhere lets go
    await page.locator('.deliver-review__title').click();
    await goTo(40);
    // So does a click into another Comment's Reply
    await page.keyboard.press('c');
    await expect(anchor).toHaveText(/^0:40/);
    await page.locator('.deliver-comments__list > .deliver-comment').first().getByRole('button', {
      name: 'Reply',
      exact: true
    }).click();
    await goTo(50);
  });
  test('a Comment half written stays with its Version: on the next Asset the field is empty and a keystroke stops the video', async () => {
    await page.goto(`/apps/deliver/versions/${versionId}`);
    await expect(page.locator('video.deliver-player__video')).toHaveJSProperty('readyState', 4);
    await page.locator('#deliver-comment-body').fill('left behind');
    const next = page.getByRole('button', {
      name: 'Next Asset'
    });
    await ((await next.isEnabled()) ? next : page.getByRole('button', {
      name: 'Previous Asset'
    })).click();
    await expect(page).toHaveURL(new RegExp(`/versions/${clipVersionId}$`));
    const video = page.locator('video.deliver-player__video');
    await expect(video).toHaveJSProperty('readyState', 4);
    const field = page.locator('#deliver-comment-body');
    await expect(field).toHaveValue('');
    await page.getByRole('button', {
      name: 'Play (Space)'
    }).click();
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(0.3);
    await field.pressSequentially('x');
    await expect.poll(() => video.evaluate(element => element.paused)).toBe(true);
    await field.fill('');
  });
  test('by mouse a click on the wave does not seek and a double click skips ten seconds; the strip under it seeks and shows a dashed line first', async ({
    playwright
  }) => {
    const api = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: auth,
      extraHTTPHeaders: ocsHeaders
    });
    expect((await api.post(`/ocs/v2.php/apps/deliver/api/v1/versions/${versionId}/comments?format=json`, {
      data: {
        inFrame: 330000,
        body: 'in the strip'
      }
    })).ok()).toBe(true);
    await api.dispose();
    // Without the glide a click lands on the wave where it will rest
    await page.emulateMedia({
      reducedMotion: 'reduce'
    });
    await page.goto(`/apps/deliver/versions/${versionId}`);
    const canvas = page.locator('.deliver-wave canvas');
    await expect(canvas).toBeVisible();
    const audio = page.locator('video.deliver-player__video');
    await expect(audio).toHaveJSProperty('readyState', 4);
    const box = await canvas.boundingBox();
    const strip = box.height - 20;
    const time = () => audio.evaluate(element => element.currentTime);
    const goTo = async seconds => {
      await audio.evaluate((element, at) => {
        element.currentTime = at;
      }, seconds);
      await expect.poll(() => canvas.evaluate(element => element.drawnAt)).toBeCloseTo(seconds + 0.0005, 2);
    };
    // Of the 16 px above the loudest bar at this place, how many are drawn on: 8 of a dashed line
    const line = x => canvas.evaluate((element, at) => {
      const ratio = element.width / element.clientWidth;
      const data = element.getContext('2d').getImageData(Math.round(at * ratio), Math.round(36 * ratio), 1, Math.round(16 * ratio)).data;
      return data.filter((value, index) => index % 4 === 3 && value > 0).length / ratio;
    }, x);
    const cursor = () => page.locator('.deliver-wave').evaluate(element => getComputedStyle(element).cursor);
    const hover = (x, y) => page.mouse.move(box.x + x, box.y + y);
    const card = page.getByRole('dialog', {
      name: /^Comment #/
    });
    for (const zoom of ['1 min', 'Whole']) {
      const whole = zoom === 'Whole';
      await page.getByRole('button', {
        name: zoom,
        exact: true
      }).click();
      await goTo(20);
      const start = await time();
      // On the wave a click goes nowhere; a double click skips ten seconds on the thirds, nothing in the middle
      await canvas.click({
        position: {
          x: box.width * 0.85,
          y: box.height / 2
        }
      });
      await page.waitForTimeout(400);
      expect(await time()).toBe(start);
      await canvas.dblclick({
        position: {
          x: box.width * 0.45,
          y: box.height / 2
        }
      });
      await page.waitForTimeout(400);
      expect(await time()).toBe(start);
      await canvas.dblclick({
        position: {
          x: box.width * 0.85,
          y: box.height / 2
        }
      });
      await expect.poll(time).toBeCloseTo(start + 10, 1);
      await expect(page.locator('.deliver-player__flash')).toContainText('+10');
      await canvas.dblclick({
        position: {
          x: box.width * 0.1,
          y: box.height / 2
        }
      });
      await expect.poll(time).toBeCloseTo(start, 1);

      // Hovering the strip shows where a click goes; off it there is no line
      const x = Math.round(box.width * 0.75);
      await hover(x, box.height / 2);
      expect(await line(x)).toBe(0);
      await hover(x, strip);
      await expect.poll(() => line(x)).toBe(8);
      expect(await cursor()).toBe('pointer');
      await hover(x + 30, strip);
      await expect.poll(() => line(x + 30)).toBe(8);
      expect(await line(x)).toBe(0);
      await hover(x, box.height / 2);
      await expect.poll(() => line(x + 30)).toBe(0);
      expect(await cursor()).toBe('grab');
      await hover(x, strip);
      await expect.poll(() => line(x)).toBe(8);
      await hover(x, box.height + 60);
      await expect.poll(() => line(x)).toBe(0);

      // A click there seeks, and two quick ones seek twice
      await canvas.dblclick({
        position: {
          x,
          y: strip
        }
      });
      await expect.poll(time).toBeCloseTo(whole ? 270 : start + 30, 0);
      await goTo(20);

      // A drag that begins there drags, without the line
      await hover(x, strip);
      await page.mouse.down();
      await page.mouse.move(box.x + x - 40, box.y + strip);
      await page.mouse.move(box.x + box.width / 2, box.y + strip);
      await page.waitForTimeout(100);
      for (const at of [x, x - 40, Math.round(box.width / 2) + 5]) {
        expect(await line(at)).toBe(0);
      }
      expect(await time()).toBeCloseTo(whole ? 180 : 35, 0);
      await page.mouse.up();

      // Over a circle there is no line, but a click opens it
      await goTo(330);
      const circle = whole ? Math.round(box.width * 330 / 360) : Math.round(box.width / 2);
      await hover(circle + 8, strip);
      await page.waitForTimeout(100);
      expect(await line(circle + 8)).toBe(0);
      expect(await cursor()).toBe('pointer');
      await hover(circle + 40, strip);
      await expect.poll(() => line(circle + 40)).toBe(8);
      await page.mouse.click(box.x + circle + 4, box.y + strip);
      await expect(card).toContainText('in the strip');
      expect(await time()).toBeCloseTo(330, 1);
      await page.keyboard.press('Escape');
      await expect(card).toHaveCount(0);
    }

    // With the card open a click in the strip beside the circles goes where the line says, and closes it; on the wave it only closes
    await page.getByRole('button', {
      name: '1 min'
    }).click();
    for (const inStrip of [true, false]) {
      await goTo(330);
      await page.mouse.click(box.x + box.width / 2 + 4, box.y + strip);
      await expect(card).toContainText('in the strip');
      const x = Math.round(box.width * 0.6);
      await hover(x, inStrip ? strip : 60);
      await expect.poll(() => line(x)).toBe(inStrip ? 8 : 0);
      await page.mouse.click(box.x + x, box.y + (inStrip ? strip : 60));
      await expect(card).toHaveCount(0);
      await expect.poll(time).toBeCloseTo(inStrip ? 336 : 330, 0);
    }
    // Pressed on the wave and lifted in the strip the mouse goes nowhere, so there is no line
    await goTo(20);
    await hover(600, 100);
    await page.mouse.down();
    await hover(600, strip);
    await page.waitForTimeout(100);
    expect(await line(600)).toBe(0);
    await page.mouse.up();
    expect(await time()).toBeCloseTo(20, 1);
    await expect.poll(() => line(600)).toBe(8);
    // A stage resized under the resting mouse, now on the wave, keeps no line
    await page.setViewportSize({
      width: 1280,
      height: 900
    });
    await page.waitForTimeout(300);
    expect(await line(600)).toBe(0);
    await page.setViewportSize({
      width: 1280,
      height: 720
    });
    await expect.poll(async () => (await canvas.boundingBox()).height).toBe(box.height);

    // Before the start of the piece a click goes to the start, and the line shows it there
    await page.getByRole('button', {
      name: '1 min'
    }).click();
    await goTo(20);
    const first = Math.round(box.width / 2 - 20 * box.width / 60);
    await hover(first - 40, strip);
    await expect.poll(() => line(first)).toBe(8);
    expect(await line(first - 40)).toBe(0);
    // While it plays on under it, the line stays at the mouse
    await page.getByRole('button', {
      name: 'Play (Space)'
    }).click();
    await hover(200, strip);
    await expect.poll(time).toBeGreaterThan(22);
    expect(await line(200)).toBe(8);
    await page.getByRole('button', {
      name: 'Pause (Space)'
    }).click();
    // Standing, the mouse over the wave or still in the strip draws nothing again
    await page.waitForTimeout(300);
    const draws = await canvas.evaluate(async element => {
      const clear = CanvasRenderingContext2D.prototype.clearRect;
      let count = 0;
      CanvasRenderingContext2D.prototype.clearRect = function (...args) {
        count++;
        return clear.apply(this, args);
      };
      const box = element.getBoundingClientRect();
      const counts = [];
      for (const [x, y] of [[100, 100], [120, 100], [200, box.height - 20], [200, box.height - 10], [200, 100]]) {
        element.dispatchEvent(new PointerEvent('pointermove', {
          clientX: box.left + x,
          clientY: box.top + y,
          pointerId: 7,
          pointerType: 'mouse',
          bubbles: true
        }));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        counts.push(count);
      }
      CanvasRenderingContext2D.prototype.clearRect = clear;
      return counts;
    });
    // No line, no line, a line, the same line, no line
    expect(draws).toEqual([0, 0, 1, 1, 2]);
    await page.emulateMedia({
      reducedMotion: null
    });
  });
  test('on a phone held sideways with the list closed, the field opens as a sheet and sends from there', async () => {
    const phone = await browser.newContext({
      baseURL: BROWSER_URL,
      ...PHONE,
      viewport: {
        width: 844,
        height: 390
      }
    });
    const member = await phone.newPage();
    await login(member);
    await member.goto(`/apps/deliver/versions/${versionId}`);
    const canvas = member.locator('.deliver-wave canvas');
    await expect(canvas).toBeVisible();
    await expect(member.locator('video.deliver-player__video')).toHaveJSProperty('readyState', 4);
    await expect(member.locator('.deliver-layout__panel')).toBeHidden();
    const box = await canvas.boundingBox();
    const touch = await phone.newCDPSession(member);
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{
        x: box.x + box.width * 0.75,
        y: box.y + box.height / 2
      }]
    });
    await member.waitForTimeout(700);
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: []
    });
    const sheet = member.getByRole('dialog', {
      name: 'New Comment'
    });
    await expect(sheet).toBeVisible();
    // From below, across the width
    const at = await sheet.boundingBox();
    expect(Math.round(at.y + at.height)).toBe(390);
    expect(Math.round(at.width)).toBe(844);
    await member.locator('#deliver-comment-body-inline').fill('from the sheet');
    await sheet.getByRole('button', {
      name: 'Send (Enter)'
    }).tap();
    await expect(sheet).toHaveCount(0);
    await expect(member.locator('.deliver-layout__panel')).toBeHidden();
    await phone.close();
  });
  test('over the whole piece the Comments are on the wave only, zoomed in on the bar too, where a press opens the wave\'s card, by mouse, keyboard and finger', async ({
    playwright
  }) => {
    const api = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: auth,
      extraHTTPHeaders: ocsHeaders
    });
    const ids = [];
    const open = async (target, zoom) => {
      await target.goto(`/apps/deliver/versions/${versionId}`);
      await expect(target.locator('.deliver-wave canvas')).toBeVisible();
      await expect(target.locator('video.deliver-player__video')).toHaveJSProperty('readyState', 4);
      await target.getByRole('button', {
        name: zoom,
        exact: true
      }).click();
    };
    const timeOf = target => target.locator('video.deliver-player__video').evaluate(element => element.currentTime);
    const markerOf = target => target.locator('.deliver-player__marker[aria-label*="on the bar"]');
    const card = target => target.getByRole('dialog', {
      name: /^Comment #/
    });
    const peek = page.locator('.deliver-player__peek');
    const canvas = page.locator('.deliver-wave canvas');
    const bar = page.locator('.deliver-player__timeline');
    // The wave is as high with Comments as without, at every zoom
    await page.route('**/versions/*/comments*', route => route.fulfill({
      json: {
        ocs: {
          meta: {
            status: 'ok',
            statuscode: 200
          },
          data: {
            comments: [],
            manages: true,
            overwrittenAt: null,
            canComment: true,
            canApprove: false
          }
        }
      }
    }));
    await open(page, 'Whole');
    const heights = [(await canvas.boundingBox()).height];
    await page.getByRole('button', {
      name: '1 min',
      exact: true
    }).click();
    heights.push((await canvas.boundingBox()).height);
    await expect(page.locator('.deliver-player__marker')).toHaveCount(0);
    await page.unroute('**/versions/*/comments*');
    for (const [inFrame, body] of [[90000, 'on the bar'], [90100, 'close by']]) {
      const made = await api.post(`/ocs/v2.php/apps/deliver/api/v1/versions/${versionId}/comments?format=json`, {
        data: {
          inFrame,
          body
        }
      });
      ids.push((await made.json()).ocs.data.id);
    }
    await open(page, 'Whole');
    const marker = markerOf(page);
    await expect(marker).toHaveText('2');
    const stage = await canvas.boundingBox();
    const under = await bar.boundingBox();
    expect([stage.height, stage.height]).toEqual(heights);
    expect(under.y).toBeCloseTo(stage.y + stage.height, 0);

    // Over the whole the circle is on the wave's lane, and the bar at its place only seeks
    expect(await canvas.evaluate(element => {
      const ratio = element.width / element.clientWidth;
      const data = element.getContext('2d').getImageData(Math.round((element.clientWidth / 4 + 8) * ratio), element.height - Math.round(20 * ratio), 1, 1).data;
      return data[3];
    })).toBe(255);
    await page.mouse.click(under.x + under.width / 4, under.y + under.height / 2);
    await expect.poll(() => timeOf(page)).toBeCloseTo(90, 0);
    await expect(peek).toHaveCount(0);
    await expect(card(page)).toHaveCount(0);
    // The keyboard still reaches it there, and it shows while it has the focus
    await expect(marker).toHaveCSS('clip-path', 'inset(50%)');
    await marker.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(marker).toBeFocused();
    await expect(marker).toHaveCSS('clip-path', 'none');
    await expect(peek).toContainText('1 of 2');
    await page.keyboard.press('Enter');
    await expect(card(page)).toContainText('on the bar');
    // Escape hands the focus back, without the small card
    await page.keyboard.press('Escape');
    await expect(card(page)).toHaveCount(0);
    await expect(marker).toBeFocused();
    await page.waitForTimeout(200);
    await expect(peek).toHaveCount(0);

    // Zoomed in the bar has it too
    await page.getByRole('button', {
      name: '1 min',
      exact: true
    }).click();
    expect((await canvas.boundingBox()).height).toBe(stage.height);
    // Translucent, until the mouse is over it
    const back = () => marker.evaluate(element => getComputedStyle(element).backgroundColor);
    await open(page, '1 min');
    await page.mouse.move(0, 0);
    await expect.poll(back).toMatch(/rgba\(0, 0, 0, 0\.\d+\)/);
    await marker.hover({
      force: true
    });
    await expect.poll(back).toBe('rgb(0, 0, 0)');
    await expect(peek).toContainText('1 of 2');
    // In place of the Frame's time, which is beside it
    await expect(page.locator('.deliver-player__hover')).toBeHidden();
    await page.mouse.move(under.x + under.width / 4 + 14, under.y + under.height / 2);
    await expect(peek).toHaveCount(0);
    await expect(page.locator('.deliver-player__hover')).toBeVisible();
    await marker.click({
      force: true
    });
    await expect(card(page)).toContainText('on the bar');
    await expect(card(page).getByPlaceholder('Write a Reply')).toBeVisible();
    await expect.poll(() => timeOf(page)).toBeCloseTo(90, 1);
    // The mouse's small card is gone, the list selected, and the circle ringed
    await expect(peek).toHaveCount(0);
    await expect(page.locator('.deliver-comment--selected')).toContainText('on the bar');
    await expect(marker).toHaveAttribute('style', /--deliver-marker-line: #fff/);
    await expect(marker).toHaveClass(/--opaque/);
    // The card steps through the count, and a double click goes to the one it shows
    await card(page).getByRole('button', {
      name: 'Next Comment'
    }).click();
    await expect(card(page)).toContainText('close by');
    await page.locator('.deliver-player__marker[aria-label^="2 of 2"]').dblclick({
      force: true
    });
    await expect(card(page)).toContainText('close by');
    await expect.poll(() => timeOf(page)).toBeCloseTo(90.1, 2);
    await page.keyboard.press('Escape');
    await expect(card(page)).toHaveCount(0);
    await page.locator('.deliver-player__marker[aria-label^="2 of 2"]').focus();
    await page.keyboard.press('Enter');
    await expect(card(page)).toContainText('close by');
    await page.keyboard.press('Escape');
    // A drag from it moves the wave and opens nothing
    await page.mouse.move(under.x + under.width / 4, under.y + under.height / 2);
    await page.mouse.down();
    await page.mouse.move(under.x + under.width / 2, under.y + under.height / 2, {
      steps: 4
    });
    await expect.poll(() => timeOf(page)).toBeCloseTo(180, 0);
    await page.mouse.up();
    await page.waitForTimeout(400);
    await expect(card(page)).toHaveCount(0);
    expect(await timeOf(page)).toBeCloseTo(180, 0);
    const phone = await browser.newContext({
      baseURL: BROWSER_URL,
      ...PHONE,
      viewport: {
        width: 852,
        height: 393
      }
    });
    const member = await phone.newPage();
    await login(member);
    await open(member, 'Whole');
    await expect(markerOf(member)).toHaveText('2');
    const row = await member.locator('.deliver-player__timeline').boundingBox();
    await member.touchscreen.tap(row.x + row.width / 4, row.y + row.height / 2);
    await expect.poll(() => timeOf(member)).toBeCloseTo(90, 0);
    await member.waitForTimeout(400);
    await expect(card(member)).toHaveCount(0);
    await open(member, '1 min');
    await expect(markerOf(member)).toHaveText('2');
    // A tap reads and answers without seeking; a double tap goes there, though the sheet would cover the bar
    const at = await markerOf(member).boundingBox();
    const tap = () => member.touchscreen.tap(at.x + at.width / 2, at.y + at.height / 2);
    await tap();
    await expect(card(member)).toContainText('on the bar');
    expect(await timeOf(member)).toBe(0);
    await card(member).getByRole('button', {
      name: 'Close'
    }).tap();
    await tap();
    await tap();
    await expect.poll(() => timeOf(member)).toBeCloseTo(90, 1);
    await member.waitForTimeout(400);
    await expect(card(member)).toHaveCount(0);
    // A finger dragging from it moves the wave
    const touch = await phone.newCDPSession(member);
    const y = at.y + at.height / 2;
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{
        x: at.x + at.width / 2,
        y
      }]
    });
    for (const x of [at.x + 60, at.x + 160, at.x + 260]) {
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{
          x,
          y
        }]
      });
    }
    await expect.poll(() => timeOf(member)).toBeGreaterThan(150);
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: []
    });
    await member.waitForTimeout(500);
    await expect(card(member)).toHaveCount(0);
    await phone.close();
    for (const id of ids) {
      expect((await api.delete(`/ocs/v2.php/apps/deliver/api/v1/comments/${id}?format=json`)).ok()).toBe(true);
    }
    await api.dispose();
  });
  test('on a phone a pinch only zooms, a long press comments, and the card hands the focus back; a Reviewer who may not comment reads the cards and writes nothing', async ({
    playwright
  }) => {
    const api = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: auth,
      extraHTTPHeaders: ocsHeaders
    });
    const comments = `/ocs/v2.php/apps/deliver/api/v1/versions/${versionId}/comments?format=json`;
    const parent = (await (await api.post(comments, {
      data: {
        inFrame: 7500,
        body: 'for the phone'
      }
    })).json()).ocs.data;
    expect((await api.post(comments, {
      data: {
        inFrame: 7500,
        body: 'and a reply',
        parentId: parent.id
      }
    })).ok()).toBe(true);
    const phone = await browser.newContext({
      baseURL: BROWSER_URL,
      ...PHONE
    });
    const member = await phone.newPage();
    await login(member);
    await member.goto(`/apps/deliver/versions/${versionId}`);
    const canvas = member.locator('.deliver-wave canvas');
    await expect(canvas).toBeVisible();
    await expect(member.locator('video.deliver-player__video')).toHaveJSProperty('readyState', 4);
    const field = member.locator('#deliver-comment-body');
    const anchor = member.locator('.deliver-comments__anchor');
    const box = await canvas.boundingBox();
    const y = box.y + box.height / 2;
    const touch = await phone.newCDPSession(member);
    const fingers = (type, points) => touch.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map(([x, at], id) => ({
        x,
        y: at,
        id
      }))
    });
    const shown = () => member.locator('.deliver-player__window').evaluate(element => parseFloat(element.style.width.match(/[\d.]+%/)[0]));

    // Two fingers moving apart for most of a second zoom in and open no field
    const before = await shown();
    await fingers('touchStart', [[box.x + 150, y], [box.x + 240, y]]);
    for (let step = 1; step <= 8; step++) {
      await member.waitForTimeout(100);
      await fingers('touchMove', [[box.x + 150 - step * 10, y], [box.x + 240 + step * 10, y]]);
    }
    await fingers('touchEnd', []);
    await member.waitForTimeout(300);
    expect(await shown()).toBeLessThan(before);
    await expect(field).not.toBeFocused();
    await expect(anchor).toHaveText('0:00.000');

    // A finger resting a quarter of the stage to the right, 15 seconds on, opens the field there; it neither seeks nor goes fullscreen
    await member.getByRole('button', {
      name: '1 min'
    }).tap();
    await fingers('touchStart', [[box.x + box.width * 0.75, y]]);
    await member.waitForTimeout(700);
    await fingers('touchEnd', []);
    await expect(field).toBeFocused();
    await expect(anchor).toHaveText('0:15.000');
    // The place waits on the wave as a line in the primary colour, over the wave not yet played
    const mark = await canvas.evaluate(element => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--color-primary-element)';
      element.parentElement.append(probe);
      const primary = getComputedStyle(probe).color.match(/\d+/g).map(Number);
      probe.remove();
      const ratio = element.width / element.clientWidth;
      const pixel = element.getContext('2d').getImageData(Math.round(element.width * 0.75), Math.round(42 * ratio), 1, 1).data;
      return Math.max(...primary.slice(0, 3).map((value, at) => Math.abs(value - pixel[at])));
    });
    expect(mark).toBeLessThan(8);
    expect(await member.locator('video.deliver-player__video').evaluate(element => element.currentTime)).toBeLessThan(1);
    await expect(member.locator('.deliver-player--fullscreen')).toHaveCount(0);
    // A tap on a circle, 7.5 seconds on, opens its card; closing it hands the focus back to the field
    const lane = await canvas.boundingBox();
    await fingers('touchStart', [[lane.x + lane.width * 0.625, lane.y + lane.height - 20]]);
    await fingers('touchEnd', []);
    const sheet = member.getByRole('dialog', {
      name: /^Comment #/
    });
    await expect(sheet).toContainText('for the phone');
    await expect(sheet).toBeFocused();
    await sheet.getByRole('button', {
      name: 'Close'
    }).tap();
    await expect(sheet).toHaveCount(0);
    await expect(field).toBeFocused();
    // A single tap on the wave seeks nowhere; a double tap on its right third skips ten seconds, in the middle nothing
    const time = () => member.locator('video.deliver-player__video').evaluate(element => element.currentTime);
    const tapAt = async at => {
      await fingers('touchStart', [[at, y]]);
      await fingers('touchEnd', []);
    };
    const start = await time();
    // A first tap that lets go of the empty field skips nothing either
    await fingers('touchStart', [[box.x + box.width * 0.75, y]]);
    await member.waitForTimeout(700);
    await fingers('touchEnd', []);
    await expect(anchor).toHaveText('0:15.000');
    await tapAt(box.x + box.width * 0.85);
    await tapAt(box.x + box.width * 0.85);
    await member.waitForTimeout(500);
    await expect(anchor).toHaveText('0:00.000');
    expect(await time()).toBe(start);
    await tapAt(box.x + box.width * 0.85);
    await member.waitForTimeout(500);
    expect(await time()).toBe(start);
    await tapAt(box.x + box.width * 0.5);
    await tapAt(box.x + box.width * 0.5);
    await member.waitForTimeout(500);
    expect(await time()).toBe(start);
    await tapAt(box.x + box.width * 0.85);
    await tapAt(box.x + box.width * 0.85);
    await expect.poll(time).toBeCloseTo(start + 10, 0);
    await expect(member.locator('.deliver-player__flash')).toContainText('+10');
    await tapAt(box.x + box.width * 0.1);
    await tapAt(box.x + box.width * 0.1);
    await expect.poll(time).toBeCloseTo(start, 0);
    // A long press on playing audio stops it
    await member.getByRole('button', {
      name: 'Play',
      exact: true
    }).tap();
    await expect.poll(() => member.locator('video.deliver-player__video').evaluate(element => element.paused)).toBe(false);
    await fingers('touchStart', [[box.x + box.width * 0.75, y]]);
    await member.waitForTimeout(700);
    await fingers('touchEnd', []);
    await expect.poll(() => member.locator('video.deliver-player__video').evaluate(element => element.paused)).toBe(true);
    await phone.close();
    const link = (await (await api.post(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}/links?format=json`)).json()).ocs.data;
    expect((await api.put(`/ocs/v2.php/apps/deliver/api/v1/links/${link.id}?format=json`, {
      data: {
        canComment: false
      }
    })).ok()).toBe(true);
    await api.dispose();
    const visitor = await browser.newContext({
      baseURL: BROWSER_URL
    });
    const reviewer = await visitor.newPage();
    await reviewer.goto(`/apps/deliver/s/${link.token}/versions/${versionId}`);
    const wave = reviewer.locator('.deliver-wave canvas');
    await expect(wave).toBeVisible();
    await reviewer.getByRole('button', {
      name: '15 s'
    }).click();
    await reviewer.locator('.deliver-comment').filter({
      hasText: 'for the phone'
    }).locator('.deliver-comment__anchor').click();
    const stage = await wave.boundingBox();
    await wave.click({
      position: {
        x: stage.width / 2,
        y: stage.height - 20
      }
    });
    const card = reviewer.getByRole('dialog', {
      name: /^Comment #/
    });
    await expect(card).toContainText('and a reply');
    await expect(card.locator('textarea')).toHaveCount(0);
    await expect(card.getByRole('button', {
      name: 'Go to'
    })).toBeVisible();
    // A click elsewhere in the strip seeks but opens no field
    await card.getByRole('button', {
      name: 'Close'
    }).click();
    await wave.click({
      position: {
        x: stage.width * 0.75,
        y: stage.height - 20
      }
    });
    await expect.poll(() => reviewer.locator('video.deliver-player__video').evaluate(element => element.currentTime)).toBeCloseTo(11.25, 0);
    await expect(reviewer.locator('#deliver-comment-body')).toHaveCount(0);
    await visitor.close();
  });
});

/**
 * @param {import('@playwright/test').Locator} videos - Compare's two media elements
 * @return {Promise<boolean[]>} whether each side is heard: by its gain where both play into the AudioContext (A7), by muting until then
 */
const heard = videos => videos.evaluateAll(all => all.map(video => video.deliverGain && !video.muted ? video.deliverGain.gain.value > 0.5 : !video.muted));
test.describe('Comparing sound', () => {
  let browser;
  let context;
  let page;
  let folder;
  let projectId;
  /** Each Asset's Versions, newest first */
  let mix;
  let cut;
  test.beforeAll(async ({
    playwright
  }) => {
    await testUser(playwright);
    const api = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: auth,
      extraHTTPHeaders: ocsHeaders
    });
    folder = 'deliver-e2e-' + randomBytes(4).toString('hex');
    const dav = `/remote.php/dav/files/${USER}/${folder}`;
    expect((await api.fetch(dav, {
      method: 'MKCOL'
    })).status()).toBe(201);
    const created = await api.post('/ocs/v2.php/apps/deliver/api/v1/projects?format=json', {
      data: {
        folderId: await fileId(api, dav),
        autoIntake: true
      }
    });
    projectId = (await created.json()).ocs.data.id;
    // One after the other, so the second of each stacks on the first as its V2
    for (const [name, file] of [['mix.webm', MIX_A], ['mix_v2.webm', MIX_B], ['cut.webm', CUT_A], ['cut_v2.webm', CUT_B]]) {
      expect((await api.fetch(`${dav}/${name}`, {
        method: 'PUT',
        data: readFileSync(file)
      })).status()).toBe(201);
    }
    const assets = async () => (await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)).json()).ocs.data.assets;
    await expect.poll(async () => (await assets()).map(asset => asset.versions.length).join()).toBe('2,2');
    const all = await assets();
    mix = all.find(asset => asset.name === 'mix').versions;
    cut = all.find(asset => asset.name === 'cut').versions;
    // ffmpeg makes the Waveforms
    const ready = async version => (await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/versions/${version.id}?format=json`)).json()).ocs.data.versions.every(each => each.derived.waveform.state === 'ready');
    await expect.poll(async () => {
      execFileSync('docker', ['compose', 'exec', '-T', '-u', 'www-data', 'nextcloud', 'php', 'occ', 'deliver:worker', '--once'], {
        stdio: 'inherit'
      });
      return (await ready(mix[0])) && (await ready(cut[0]));
    }, {
      timeout: 60_000
    }).toBe(true);
    await api.dispose();
    browser = await chromium.connectOverCDP(CDP);
    context = await browser.newContext({
      baseURL: BROWSER_URL
    });
    page = await context.newPage();
    await login(page);
  });
  test.afterAll(async ({
    playwright
  }) => {
    await context?.close();
    await browser?.close();
    const api = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: auth,
      extraHTTPHeaders: ocsHeaders
    });
    await api.delete(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`);
    await api.fetch(`/remote.php/dav/files/${USER}/${folder}`, {
      method: 'DELETE'
    });
    await api.dispose();
  });
  test('two audio Versions compare on two lanes under one playhead, and 1, 2, Tab and the lanes\' names switch the sound while both play on', async () => {
    await page.goto(`/apps/deliver/compare/${mix[1].id}/${mix[0].id}`);
    const videos = page.locator('.deliver-compare video');
    await expect(videos).toHaveCount(2);
    await expect(videos.first()).toHaveJSProperty('readyState', 4);
    // No picture area and nothing to lay out: the lanes are the view
    await expect(page.locator('.deliver-compare__stage')).toBeHidden();
    await expect(page.getByRole('radio', {
      name: 'Wipe'
    })).toHaveCount(0);
    const canvas = page.locator('.deliver-compare__lanes canvas');
    await expect(canvas).toBeVisible();
    await expect(page.locator('.deliver-wave__lane')).toHaveText(['V1', 'V2']);
    const side = page.getByRole('radio', {
      name: /^V2/
    });
    expect(await heard(videos)).toEqual([true, false]);
    await page.getByRole('button', {
      name: 'Play (Space)'
    }).click();
    await expect.poll(() => videos.first().evaluate(video => video.currentTime)).toBeGreaterThan(0.5);
    // Both play unmuted into one AudioContext, the gains decide
    expect(await videos.evaluateAll(all => all.map(video => !video.muted && !!video.deliverGain))).toEqual([true, true]);
    // The heard side's sound comes through the graph: a media element from another origin would give silence
    const level = await videos.first().evaluate(video => new Promise(resolve => {
      const analyser = video.deliverGain.context.createAnalyser();
      video.deliverGain.connect(analyser);
      setTimeout(() => {
        const data = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(data);
        resolve(Math.max(...data.map(Math.abs)));
      }, 300);
    }));
    expect(level).toBeGreaterThan(0.05);
    await page.keyboard.press('2');
    await expect.poll(() => heard(videos)).toEqual([false, true]);
    await expect(side).toHaveAttribute('aria-checked', 'true');
    expect(await videos.evaluateAll(all => all.map(video => video.paused))).toEqual([false, false]);
    await page.keyboard.press('1');
    await expect.poll(() => heard(videos)).toEqual([true, false]);

    // A click on a wave seeks and keeps playing; the player then has the focus, and Tab switches
    const box = await canvas.boundingBox();
    const sought = videos.first().evaluate(video => new Promise(resolve => video.addEventListener('seeking', () => resolve(true), {
      once: true
    })));
    await canvas.click({
      position: {
        x: box.width * 0.6,
        y: box.height * 0.6
      }
    });
    expect(await sought).toBe(true);
    // Lanes have no strip: at their foot the mouse shows no place to go to
    await canvas.hover({
      position: {
        x: box.width * 0.6,
        y: box.height - 5
      }
    });
    expect(await page.locator('.deliver-wave').evaluate(element => element.style.cursor)).toBe('');
    expect(await videos.first().evaluate(video => video.paused)).toBe(false);
    await page.keyboard.press('Tab');
    await expect.poll(() => heard(videos)).toEqual([false, true]);
    await page.keyboard.press('Tab');
    await expect.poll(() => heard(videos)).toEqual([true, false]);
    // Moving through the page by keyboard, Tab moves the focus and leaves the sound alone
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    expect(await heard(videos)).toEqual([true, false]);
    expect(await page.evaluate(() => document.activeElement.classList.contains('deliver-compare'))).toBe(false);

    // A lane's name plays its side
    await page.locator('.deliver-wave__lane').nth(1).click();
    await expect.poll(() => heard(videos)).toEqual([false, true]);
    await expect(side).toHaveAttribute('aria-checked', 'true');
    expect(await videos.evaluateAll(all => all.map(video => video.paused))).toEqual([false, false]);
    await page.getByRole('button', {
      name: 'Pause (Space)'
    }).click();
  });
  test('switching ten times while both play seeks neither side, the heard sound runs on in real time, and the sides stay within milliseconds', async () => {
    await page.goto(`/apps/deliver/compare/${mix[1].id}/${mix[0].id}`);
    const videos = page.locator('.deliver-compare video');
    await expect(videos.first()).toHaveJSProperty('readyState', 4);
    await page.getByRole('button', {
      name: 'Play (Space)'
    }).click();
    await page.waitForTimeout(1500);
    // On every animation frame: both times, whose sound is heard, and every seek; a switch every 400 ms
    const run = await page.evaluate(() => new Promise(resolve => {
      const [a, b] = document.querySelectorAll('.deliver-compare video');
      const halves = document.querySelectorAll('.deliver-compare__sound');
      let seeks = 0;
      a.addEventListener('seeking', () => seeks++);
      b.addEventListener('seeking', () => seeks++);
      const samples = [];
      const start = performance.now();
      let switches = 0;
      const tick = () => {
        const now = performance.now();
        const side = halves[0].getAttribute('aria-checked') === 'true' ? 'a' : 'b';
        samples.push({
          now,
          a: a.currentTime,
          b: b.currentTime,
          side
        });
        if (now - start > (switches + 1) * 400 && switches < 10) {
          switches++;
          halves[switches % 2].click();
        }
        if (now - start < 4600) {
          requestAnimationFrame(tick);
        } else {
          resolve({
            seeks,
            samples,
            playing: !a.paused && !b.paused
          });
        }
      };
      requestAnimationFrame(tick);
    }));
    await page.getByRole('button', {
      name: 'Pause (Space)'
    }).click();
    expect(run.playing).toBe(true);
    expect(run.seeks).toBe(0);
    expect(new Set(run.samples.map(sample => sample.side)).size).toBe(2);
    const position = sample => sample.side === 'a' ? sample.a : sample.b;
    for (const [at, sample] of run.samples.entries()) {
      // Without an offset the sides stand on the same second
      expect(Math.abs(sample.b - sample.a)).toBeLessThan(0.01);
      if (at > 0) {
        const before = run.samples[at - 1];
        // The heard sound goes on with the clock across every switch; a reading of a media element's time is off by a few ms
        expect(Math.abs(position(sample) - position(before) - (sample.now - before.now) / 1000)).toBeLessThan(0.015);
      }
    }
  });
  test('on a page\'s first Play the sides are in step from the first second on, video and audio alike', async () => {
    for (const pair of [cut, mix]) {
      // A page of its own: the AudioContext is made by this Play
      const fresh = await context.newPage();
      await fresh.goto(`/apps/deliver/compare/${pair[1].id}/${pair[0].id}`);
      const videos = fresh.locator('.deliver-compare video');
      await expect(videos.first()).toHaveJSProperty('readyState', 4);
      // Each side is sought once, by the start itself: the heard side is never sought again
      await fresh.evaluate(() => {
        window.seeks = [0, 0];
        document.querySelectorAll('.deliver-compare video').forEach((video, side) => video.addEventListener('seeking', () => window.seeks[side]++));
      });
      await fresh.getByRole('button', {
        name: 'Play (Space)'
      }).click();
      await fresh.waitForTimeout(1000);
      expect(await fresh.evaluate(() => window.seeks)).toEqual([1, 1]);
      const apart = await fresh.evaluate(() => new Promise(resolve => {
        const [a, b] = document.querySelectorAll('.deliver-compare video');
        const found = [];
        const start = performance.now();
        const tick = () => {
          found.push(Math.abs(b.currentTime - a.currentTime));
          if (performance.now() - start < 1500) {
            requestAnimationFrame(tick);
          } else {
            resolve(Math.max(...found));
          }
        };
        requestAnimationFrame(tick);
      }));
      expect(apart).toBeLessThan(0.005);
      expect(await fresh.evaluate(() => window.seeks)).toEqual([1, 1]);
      await fresh.close();
    }
  });
  test('while the AudioContext is slow to start, one start waits at a time and a switch made meanwhile is the side heard', async () => {
    // A context that takes 300 ms to run, as a slow output may
    const slow = await browser.newContext({
      baseURL: BROWSER_URL
    });
    await slow.addInitScript(() => {
      const resume = AudioContext.prototype.resume;
      AudioContext.prototype.resume = function () {
        return new Promise(done => setTimeout(done, 300)).then(() => resume.call(this));
      };
    });
    const page = await slow.newPage();
    await login(page);
    const open = async () => {
      await page.goto(`/apps/deliver/compare/${mix[1].id}/${mix[0].id}`);
      const videos = page.locator('.deliver-compare video');
      await expect(videos.first()).toHaveJSProperty('readyState', 4);
      await page.locator('.deliver-layout__bar h2').click();
      return videos;
    };

    // Play, Pause and Play within the wait: each side is sought by the Pause and by the one start, never again while it plays
    let videos = await open();
    await videos.evaluateAll(all => {
      window.seeks = [0, 0];
      all.forEach((video, side) => video.addEventListener('seeking', () => window.seeks[side]++));
    });
    await page.keyboard.press('Space');
    await page.keyboard.press('Space');
    await page.keyboard.press('Space');
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => window.seeks)).toEqual([2, 2]);
    const state = await videos.evaluateAll(all => all.map(video => ({
      paused: video.paused,
      time: video.currentTime
    })));
    expect(state.map(each => each.paused)).toEqual([false, false]);
    expect(Math.abs(state[1].time - state[0].time)).toBeLessThan(0.005);

    // A switch made while the context starts is the side heard once it runs
    videos = await open();
    await page.keyboard.press('Space');
    await page.waitForTimeout(100);
    await page.keyboard.press('2');
    await page.waitForTimeout(600);
    expect(await videos.evaluateAll(all => all.map(video => !!video.deliverGain && !video.muted))).toEqual([true, true]);
    await expect.poll(() => heard(videos)).toEqual([false, true]);
    await expect(page.getByRole('radio', {
      name: /^V2/
    })).toHaveAttribute('aria-checked', 'true');
    await slow.close();
  });
  test('a looped Range alternating A and B plays A, then B, then A, switching at each wrap', async () => {
    await page.goto(`/apps/deliver/compare/${mix[1].id}/${mix[0].id}`);
    const videos = page.locator('.deliver-compare video');
    await expect(videos.first()).toHaveJSProperty('readyState', 4);
    // The Range from 5 s to 6 s of the 20, by the bar and I and O, and back to its start
    const bar = await page.locator('.deliver-compare__timeline').boundingBox();
    const at = share => page.mouse.click(bar.x + bar.width * share, bar.y + bar.height / 2);
    await at(0.25);
    await page.keyboard.press('i');
    await at(0.3);
    await page.keyboard.press('o');
    await expect(page.locator('.deliver-compare__chip')).toContainText(/0:05\.0\d\d – 0:06\.0\d\d/);
    await at(0.25);
    await page.getByRole('button', {
      name: 'Alternate A/B'
    }).click();
    // Alternating loops
    await expect(page.getByRole('button', {
      name: 'Loop the Range'
    })).toHaveAttribute('aria-pressed', 'true');

    // Whose sound plays on every animation frame, cut into passes where the time jumps back
    const passes = await page.evaluate(() => new Promise(resolve => {
      const [a, b] = document.querySelectorAll('.deliver-compare video');
      const found = [];
      let last = Infinity;
      const tick = () => {
        const time = a.currentTime;
        const gain = video => video.deliverGain && !video.muted ? video.deliverGain.gain.value > 0.5 : !video.muted;
        const heard = gain(a) ? gain(b) ? 'both' : 'a' : gain(b) ? 'b' : 'none';
        if (time < last - 0.3) {
          found.push({
            from: time,
            to: time,
            heard: new Set()
          });
        }
        last = time;
        const pass = found.at(-1);
        if (pass && !a.paused) {
          pass.to = time;
          pass.heard.add(heard);
        }
        if (found.length > 3) {
          resolve(found.slice(0, 3).map(each => ({
            ...each,
            heard: [...each.heard]
          })));
        } else {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
      document.querySelector('.deliver-compare__controls button[aria-label="Play (Space)"]').click();
    }));
    expect(passes.map(pass => pass.heard)).toEqual([['a'], ['b'], ['a']]);
    for (const pass of passes) {
      expect(pass.from).toBeCloseTo(5, 1);
      expect(pass.to).toBeGreaterThan(5.9);
      expect(pass.to).toBeLessThan(6.1);
    }
    await page.getByRole('button', {
      name: 'Pause (Space)'
    }).click();
    // The switch tells whose pass it is
    const now = (await heard(videos))[0] ? /^V1/ : /^V2/;
    await expect(page.getByRole('radio', {
      name: now
    })).toHaveAttribute('aria-checked', 'true');
  });
  test('a video Compare shows both Waveforms under the pictures when asked, and the pictures stay', async () => {
    await page.goto(`/apps/deliver/compare/${cut[1].id}/${cut[0].id}`);
    const videos = page.locator('.deliver-compare video');
    await expect(videos.first()).toHaveJSProperty('readyState', 4);
    await expect(page.locator('.deliver-compare__lanes')).toHaveCount(0);
    // The A/B switch replaces the small sound button of the bar
    await page.getByRole('radio', {
      name: /^V2/
    }).click();
    await expect.poll(() => heard(videos)).toEqual([false, true]);
    await page.getByRole('button', {
      name: 'Waveforms'
    }).click();
    await expect(page.locator('.deliver-compare__lanes canvas')).toBeVisible();
    await expect(page.locator('.deliver-compare__stage')).toBeVisible();
    for (const video of await videos.all()) {
      expect((await video.boundingBox()).height).toBeGreaterThan(100);
    }
    await page.getByRole('radio', {
      name: 'Wipe'
    }).click();
    await expect(page.locator('.deliver-compare__handle')).toBeVisible();
    await expect(page.locator('.deliver-compare__lanes canvas')).toBeVisible();
  });
  test('on a phone held sideways, pictures, both lanes and the transport fit without scrolling', async () => {
    const phone = await browser.newContext({
      baseURL: BROWSER_URL,
      ...PHONE,
      viewport: {
        width: 844,
        height: 390
      }
    });
    const sideways = await phone.newPage();
    await login(sideways);
    await sideways.goto(`/apps/deliver/compare/${cut[1].id}/${cut[0].id}`);
    await expect(sideways.locator('.deliver-compare video').first()).toHaveJSProperty('readyState', 4);
    await sideways.getByRole('button', {
      name: 'Playback settings'
    }).click();
    await sideways.getByRole('menuitemcheckbox', {
      name: 'Waveforms'
    }).click();
    await sideways.keyboard.press('Escape');
    await expect(sideways.locator('.deliver-compare__lanes canvas')).toBeVisible();
    const stage = await sideways.locator('.deliver-compare__stage').boundingBox();
    const controls = await sideways.locator('.deliver-compare__controls').boundingBox();
    expect(stage.height).toBeGreaterThan(80);
    expect(controls.y + controls.height).toBeLessThanOrEqual(390);
    const sound = await sideways.getByRole('radio', {
      name: /^V1/
    }).boundingBox();
    expect(sound.height).toBeGreaterThanOrEqual(44);
    await phone.close();
  });
});
test.describe('Skipping ten seconds', () => {
  let browser;
  let context;
  let page;
  let folder;
  let projectId;
  let versionId;
  test.beforeAll(async ({
    playwright
  }) => {
    await testUser(playwright);
    const api = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: auth,
      extraHTTPHeaders: ocsHeaders
    });
    folder = 'deliver-e2e-' + randomBytes(4).toString('hex');
    const dav = `/remote.php/dav/files/${USER}/${folder}`;
    expect((await api.fetch(dav, {
      method: 'MKCOL'
    })).status()).toBe(201);
    expect((await api.fetch(`${dav}/long.webm`, {
      method: 'PUT',
      data: readFileSync(LONG)
    })).status()).toBe(201);
    const created = await api.post('/ocs/v2.php/apps/deliver/api/v1/projects?format=json', {
      data: {
        folderId: await fileId(api, dav),
        autoIntake: true
      }
    });
    projectId = (await created.json()).ocs.data.id;
    const project = await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`);
    versionId = (await project.json()).ocs.data.assets[0].versions[0].id;
    await api.dispose();
    browser = await chromium.connectOverCDP(CDP);
    context = await browser.newContext({
      baseURL: BROWSER_URL
    });
    page = await context.newPage();
    await login(page);
  });
  test.afterAll(async ({
    playwright
  }) => {
    await context?.close();
    await browser?.close();
    const api = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: auth,
      extraHTTPHeaders: ocsHeaders
    });
    await api.delete(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`);
    await api.fetch(`/remote.php/dav/files/${USER}/${folder}`, {
      method: 'DELETE'
    });
    await api.dispose();
  });
  test('the buttons and Shift+arrows jump ten seconds and keep the playback state', async () => {
    await page.goto(`/apps/deliver/versions/${versionId}`);
    const video = page.locator('video.deliver-player__video');
    await expect(video).toHaveJSProperty('readyState', 4);
    const time = () => video.evaluate(element => element.currentTime);
    await page.getByRole('button', {
      name: /^Forward 10 seconds/
    }).click();
    await expect.poll(time).toBeCloseTo(10, 0);
    expect(await video.evaluate(element => element.paused)).toBe(true);
    await page.getByRole('button', {
      name: /^Back 10 seconds/
    }).click();
    await expect.poll(time).toBeCloseTo(0, 0);
    await page.getByRole('button', {
      name: /^Play \(/
    }).click();
    await expect.poll(time).toBeGreaterThan(0.1);
    await page.locator('.deliver-review__title').click();
    const beforeForward = await time();
    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(300);
    expect(await time()).toBeGreaterThan(beforeForward + 9.5);
    expect(await video.evaluate(element => element.paused)).toBe(false);
    const beforeBack = await time();
    await page.keyboard.press('Shift+ArrowLeft');
    await page.waitForTimeout(300);
    expect(await time()).toBeLessThan(beforeBack - 9);
    expect(await video.evaluate(element => element.paused)).toBe(false);
  });
});
test.describe('Uploads without ffmpeg', () => {
  let admin;
  let projectId;
  test.beforeAll(async ({
    playwright
  }) => {
    await testUser(playwright);
    admin = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: {
        username: ADMIN,
        password: ADMIN_PASSWORD,
        send: 'always'
      },
      extraHTTPHeaders: ocsHeaders
    });
    expect((await admin.put('/ocs/v2.php/apps/deliver/api/v1/admin/settings?format=json', {
      data: {
        ffmpegPath: '/nonexistent/ffmpeg',
        ffprobePath: '/nonexistent/ffprobe'
      }
    })).ok()).toBe(true);
    const api = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: auth,
      extraHTTPHeaders: ocsHeaders
    });
    const dav = `/remote.php/dav/files/${USER}/deliver-e2e-${randomBytes(4).toString('hex')}`;
    expect((await api.fetch(dav, {
      method: 'MKCOL'
    })).status()).toBe(201);
    const created = await api.post('/ocs/v2.php/apps/deliver/api/v1/projects?format=json', {
      data: {
        folderId: await fileId(api, dav)
      }
    });
    projectId = (await created.json()).ocs.data.id;
    await api.dispose();
  });
  test.afterAll(async () => {
    await admin.put('/ocs/v2.php/apps/deliver/api/v1/admin/settings?format=json', {
      data: {
        ffmpegPath: '',
        ffprobePath: ''
      }
    });
    await admin.dispose();
  });
  test('refuses what this browser can neither play nor convert, before it goes up, and takes what plays', async () => {
    const browser = await chromium.connectOverCDP(CDP);
    const context = await browser.newContext({
      baseURL: BROWSER_URL
    });
    const page = await context.newPage();
    try {
      await login(page);
      await page.goto(`/apps/deliver/projects/${projectId}`);
      await page.getByRole('button', {
        name: 'Upload',
        exact: true
      }).click();
      const uploads = page.getByRole('dialog', {
        name: 'Uploads'
      });
      await uploads.locator('input[type=file][multiple]').setInputFiles({
        name: 'master.mov',
        mimeType: 'video/quicktime',
        buffer: readFileSync(DNXHR)
      });
      await expect(uploads.locator('.deliver-uploads__status--error')).toContainText('This format needs ffmpeg, which this Nextcloud lacks.');
      await expect(uploads.getByText('Open', {
        exact: true
      })).toHaveCount(0);

      // What plays as it is goes up as ever
      await uploads.locator('input[type=file][multiple]').setInputFiles({
        name: 'mix.wav',
        mimeType: 'audio/wav',
        buffer: readFileSync(MIX)
      });
      await expect(uploads.getByText('Open', {
        exact: true
      })).toHaveCount(1);
      await expect(uploads.locator('.deliver-uploads__status--error')).toHaveCount(1);
    } finally {
      await context.close();
    }
  });
  test('a cancel while the file is checked leaves nothing behind', async ({
    playwright
  }) => {
    const browser = await chromium.connectOverCDP(CDP);
    const context = await browser.newContext({
      baseURL: BROWSER_URL
    });
    const page = await context.newPage();
    const api = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: auth,
      extraHTTPHeaders: ocsHeaders
    });
    try {
      await login(page);
      await page.goto(`/apps/deliver/projects/${projectId}`);
      await page.getByRole('button', {
        name: 'Upload',
        exact: true
      }).click();
      const uploads = page.getByRole('dialog', {
        name: 'Uploads'
      });
      // Mediabunny loads lazily when the check starts; hold its chunks back so the cancel comes first
      let release;
      const held = new Promise(resolve => {
        release = resolve;
      });
      await page.route('**/*.chunk.mjs*', async route => {
        await held;
        await route.continue();
      });
      await uploads.locator('input[type=file][multiple]').setInputFiles({
        name: 'cancelled.wav',
        mimeType: 'audio/wav',
        buffer: readFileSync(MIX)
      });
      await uploads.getByRole('button', {
        name: 'Cancel the upload of cancelled.wav'
      }).click();
      await expect(uploads.getByText('cancelled.wav')).toHaveCount(0);
      release();
      // The next upload only starts once the cancelled one has let go, so when it is done, a stray one would be too
      await uploads.locator('input[type=file][multiple]').setInputFiles({
        name: 'after-cancel.wav',
        mimeType: 'audio/wav',
        buffer: readFileSync(MIX)
      });
      await expect(uploads.getByText('Open', {
        exact: true
      })).toHaveCount(1);
      const project = await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${projectId}?format=json`)).json();
      const names = project.ocs.data.assets.map(asset => asset.versions[0].name);
      expect(names).toContain('after-cancel.wav');
      expect(names).not.toContain('cancelled.wav');
      await expect(uploads.getByText('cancelled.wav')).toHaveCount(0);
    } finally {
      await api.dispose();
      await context.close();
    }
  });
  test('a Member uploads a Proxy of their own from the Asset card and removes it (ADR 0020)', async ({
    playwright
  }) => {
    const api = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: auth,
      extraHTTPHeaders: ocsHeaders
    });
    const dav = `/remote.php/dav/files/${USER}/deliver-e2e-${randomBytes(4).toString('hex')}`;
    expect((await api.fetch(dav, {
      method: 'MKCOL'
    })).status()).toBe(201);
    const created = await api.post('/ocs/v2.php/apps/deliver/api/v1/projects?format=json', {
      data: {
        folderId: await fileId(api, dav),
        autoIntake: true
      }
    });
    const id = (await created.json()).ocs.data.id;
    expect((await api.fetch(`${dav}/master.mov`, {
      method: 'PUT',
      data: readFileSync(DNXHR)
    })).status()).toBe(201);
    // The probe, so the card knows the Version gets a Proxy
    execFileSync('docker', ['compose', 'exec', '-T', '-u', 'www-data', 'nextcloud', 'php', 'occ', 'deliver:worker', '--once'], {
      stdio: 'inherit'
    });
    const newest = async () => (await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${id}?format=json`)).json()).ocs.data.assets[0].versions[0];
    const browser = await chromium.connectOverCDP(CDP);
    const context = await browser.newContext({
      baseURL: BROWSER_URL
    });
    const page = await context.newPage();
    try {
      await login(page);
      await page.goto(`/apps/deliver/projects/${id}`);
      await card(page, 'master').click({
        button: 'right'
      });
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('menuitem', {
        name: 'Upload Proxy…'
      }).click();
      await (await chooser).setFiles({
        name: 'master.proxy.mp4',
        mimeType: 'video/mp4',
        buffer: readFileSync(HAND_PROXY)
      });
      await expect.poll(async () => (await newest()).proxyHandedIn).toBe(true);
      // The card shows the upload until the server's answer is in, and its menu follows once the Project is read again
      await expect(async () => {
        await page.keyboard.press('Escape');
        await card(page, 'master').click({
          button: 'right'
        });
        await expect(page.getByRole('menuitem', {
          name: 'Remove Proxy'
        })).toBeVisible({
          timeout: 1000
        });
      }).toPass();
      // The browser's pass from the hand Proxy is over by then: where it decodes H.264 it made the strip from it,
      // where it does not (CI's Chromium) that is no error, as the Proxy is in (#168)
      await expect(page.locator('.notecard--error')).toHaveCount(0);
      if (await page.evaluate(async () => (await VideoDecoder.isConfigSupported({
        codec: 'avc1.42001e'
      })).supported)) {
        const shown = await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/versions/${(await newest()).id}?format=json`)).json();
        expect(shown.ocs.data.versions[0].derived.thumbs.state).toBe('ready');
      }
      // Another one of their own would replace it
      await expect(page.getByRole('menuitem', {
        name: 'Upload Proxy…'
      })).toBeVisible();
      await page.getByRole('menuitem', {
        name: 'Remove Proxy'
      }).click();
      await expect.poll(async () => (await newest()).proxyHandedIn).toBe(false);
      await card(page, 'master').click({
        button: 'right'
      });
      await expect(page.getByRole('menuitem', {
        name: 'Upload Proxy…'
      })).toBeVisible();
      await expect(page.getByRole('menuitem', {
        name: 'Remove Proxy'
      })).toHaveCount(0);
      // Only the master became an Asset: the upload was hidden and is gone
      expect((await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${id}?format=json`)).json()).ocs.data.assets).toHaveLength(1);
    } finally {
      await context.close();
      await api.delete(`/ocs/v2.php/apps/deliver/api/v1/projects/${id}?format=json`);
      await api.fetch(dav, {
        method: 'DELETE'
      });
      await api.dispose();
    }
  });
  test('a video that needs no Proxy, uploaded in the Files app where Auto Intake takes it, gets its strip from this browser (#168)', async ({
    playwright
  }) => {
    const api = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: auth,
      extraHTTPHeaders: ocsHeaders
    });
    const folder = `deliver-e2e-${randomBytes(4).toString('hex')}`;
    const dav = `/remote.php/dav/files/${USER}/${folder}`;
    expect((await api.fetch(dav, {
      method: 'MKCOL'
    })).status()).toBe(201);
    const created = await api.post('/ocs/v2.php/apps/deliver/api/v1/projects?format=json', {
      data: {
        folderId: await fileId(api, dav),
        autoIntake: true
      }
    });
    const id = (await created.json()).ocs.data.id;
    const browser = await chromium.connectOverCDP(CDP);
    const context = await browser.newContext({
      baseURL: BROWSER_URL
    });
    const page = await context.newPage();
    const derived = async () => {
      const versionId = (await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${id}?format=json`)).json()).ocs.data.assets[0]?.versions[0].id;
      return versionId && (await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/versions/${versionId}?format=json`)).json()).ocs.data.versions[0].derived;
    };
    try {
      await login(page);
      await page.goto(`/apps/files/files?dir=/${folder}`);
      await page.locator('input[type=file]').first().setInputFiles({
        name: 'clip.webm',
        mimeType: 'video/webm',
        buffer: readFileSync(CLIP)
      });
      // VP9 plays as it is, so no Proxy; the pass decodes it all the same, also without an H.264 encoder for the Scrub Proxy
      await expect.poll(async () => (await derived())?.thumbs.state, {
        timeout: 60_000
      }).toBe('ready');
      expect((await derived()).proxy.state).toBe('none');
    } finally {
      await context.close();
      await api.delete(`/ocs/v2.php/apps/deliver/api/v1/projects/${id}?format=json`);
      await api.fetch(dav, {
        method: 'DELETE'
      });
      await api.dispose();
    }
  });
  test('the Asset card offers to make missing derived media in this browser only while something is missing, and never with ffmpeg (#168)', async ({
    playwright
  }) => {
    const api = await playwright.request.newContext({
      baseURL: URL,
      httpCredentials: auth,
      extraHTTPHeaders: ocsHeaders
    });
    const dav = `/remote.php/dav/files/${USER}/deliver-e2e-${randomBytes(4).toString('hex')}`;
    expect((await api.fetch(dav, {
      method: 'MKCOL'
    })).status()).toBe(201);
    const created = await api.post('/ocs/v2.php/apps/deliver/api/v1/projects?format=json', {
      data: {
        folderId: await fileId(api, dav),
        autoIntake: true
      }
    });
    const id = (await created.json()).ocs.data.id;
    // From a sync client: no browser made anything of it
    expect((await api.fetch(`${dav}/clip.webm`, {
      method: 'PUT',
      data: readFileSync(CLIP)
    })).status()).toBe(201);
    execFileSync('docker', ['compose', 'exec', '-T', '-u', 'www-data', 'nextcloud', 'php', 'occ', 'deliver:worker', '--once'], {
      stdio: 'inherit'
    });
    const newest = async () => (await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${id}?format=json`)).json()).ocs.data.assets[0].versions[0];
    const {
      id: versionId
    } = await newest();
    const browser = await chromium.connectOverCDP(CDP);
    const context = await browser.newContext({
      baseURL: BROWSER_URL
    });
    const page = await context.newPage();
    const action = page.getByRole('menuitem', {
      name: 'Make missing derived media in this browser'
    });
    const menu = async () => {
      await page.keyboard.press('Escape');
      await card(page, 'clip').click({
        button: 'right'
      });
    };
    try {
      await login(page);
      await page.goto(`/apps/deliver/projects/${id}`);
      // Offered once this browser has read the headers: it decodes VP9, even where it encodes no H.264 for a Scrub Proxy
      await expect(async () => {
        await menu();
        await expect(action).toBeVisible({
          timeout: 1000
        });
      }).toPass();
      await action.click();
      await expect.poll(async () => (await newest()).derivedFromBrowser, {
        timeout: 30_000
      }).not.toContain('thumbs');
      const shown = await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/versions/${versionId}?format=json`)).json();
      expect(shown.ocs.data.versions[0].derived.thumbs.state).toBe('ready');

      // A Scrub Proxy from elsewhere, where this browser could not make one: nothing is missing any more
      const upload = `${dav}/.scrub-upload`;
      expect((await api.fetch(upload, {
        method: 'PUT',
        data: readFileSync(CLIP_SCRUB)
      })).status()).toBe(201);
      const given = await api.post(`/ocs/v2.php/apps/deliver/api/v1/versions/${versionId}/scrub?format=json`, {
        data: {
          fileId: await fileId(api, upload)
        }
      });
      expect([200, 409]).toContain(given.status());
      await expect.poll(async () => (await newest()).derivedFromBrowser).toEqual([]);
      await page.reload();
      await menu();
      await expect(page.getByRole('menuitem', {
        name: 'Open'
      })).toBeVisible();
      await expect(action).toHaveCount(0);

      // With ffmpeg the server makes it all
      expect((await api.post(`/ocs/v2.php/apps/deliver/api/v1/versions/${versionId}/regenerate?format=json`)).ok()).toBe(true);
      expect((await admin.put('/ocs/v2.php/apps/deliver/api/v1/admin/settings?format=json', {
        data: {
          ffmpegPath: '',
          ffprobePath: ''
        }
      })).ok()).toBe(true);
      await page.reload();
      await menu();
      await expect(page.getByRole('menuitem', {
        name: 'Open'
      })).toBeVisible();
      await expect(action).toHaveCount(0);
    } finally {
      await admin.put('/ocs/v2.php/apps/deliver/api/v1/admin/settings?format=json', {
        data: {
          ffmpegPath: '/nonexistent/ffmpeg',
          ffprobePath: '/nonexistent/ffprobe'
        }
      });
      await context.close();
      await api.delete(`/ocs/v2.php/apps/deliver/api/v1/projects/${id}?format=json`);
      await api.fetch(dav, {
        method: 'DELETE'
      });
      await api.dispose();
    }
  });
});

/**
 * Creates the test user, or sets a fresh password on it, and keeps it in English
 *
 * @param {import('@playwright/test').PlaywrightWorkerArgs['playwright']} playwright - to talk to the API as admin
 */
async function testUser(playwright) {
  const admin = await playwright.request.newContext({
    baseURL: URL,
    httpCredentials: {
      username: ADMIN,
      password: ADMIN_PASSWORD,
      send: 'always'
    },
    extraHTTPHeaders: ocsHeaders
  });
  const users = '/ocs/v2.php/cloud/users';
  const created = await admin.post(`${users}?format=json`, {
    form: {
      userid: USER,
      password: PASSWORD
    }
  });
  if (!created.ok()) {
    expect((await admin.put(`${users}/${USER}?format=json`, {
      form: {
        key: 'password',
        value: PASSWORD
      }
    })).ok()).toBe(true);
  }
  expect((await admin.put(`${users}/${USER}?format=json`, {
    form: {
      key: 'language',
      value: 'en'
    }
  })).ok()).toBe(true);
  // The mate never logs in to the browser, but makes a link through the API
  const mate = await admin.post(`${users}?format=json`, {
    form: {
      userid: MATE,
      password: MATE_PASSWORD,
      displayName: 'Mara Mate'
    }
  });
  if (!mate.ok()) {
    expect((await admin.put(`${users}/${MATE}?format=json`, {
      form: {
        key: 'password',
        value: MATE_PASSWORD
      }
    })).ok()).toBe(true);
  }
  await admin.dispose();
}

/**
 * @param {import('@playwright/test').Page} page - the Project view
 * @param {string} name - an Asset's name; "8 seconds ago" below it would match "second" by text alone
 * @return {import('@playwright/test').Locator} its card
 */
function card(page, name) {
  return page.locator('.deliver-card').filter({
    has: page.locator('.deliver-card__name', {
      hasText: new RegExp(`^\\s*${name}\\s*$`)
    })
  });
}

/**
 * @param {import('@playwright/test').APIRequestContext} api - request context
 * @param {string} dav - WebDAV path of the folder
 * @return {Promise<number>} the Nextcloud file id
 */
async function fileId(api, dav) {
  const response = await api.fetch(dav, {
    method: 'PROPFIND',
    headers: {
      Depth: '0',
      'Content-Type': 'application/xml'
    },
    data: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:fileid/></d:prop></d:propfind>'
  });
  return Number(/<oc:fileid>(\d+)<\/oc:fileid>/.exec(await response.text())[1]);
}

/**
 * @param {import('@playwright/test').Page} page - the page to log in
 */
async function login(page) {
  await page.goto('/index.php/login');
  await page.locator('#user').fill(USER);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', {
    name: 'Log in',
    exact: true
  }).click();
  await page.waitForURL(/apps|dashboard/);
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
  await expect.poll(() => canvas.evaluate(element => Math.abs(element.drawnAt - document.querySelector('video.deliver-player__video').currentTime))).toBeLessThan(0.01);
  await canvas.click(quarterOn);
  await page.keyboard.press('c');
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjaHJvbWl1bSIsImV4cGVjdCIsInRlc3QiLCJleGVjRmlsZVN5bmMiLCJyYW5kb21CeXRlcyIsInJlYWRGaWxlU3luYyIsIkNMSVAiLCJDTElQX1NDUlVCIiwiQ1VUX0EiLCJDVVRfQiIsIkROWEhSIiwiSEFORF9QUk9YWSIsIkxPTkciLCJMT05HX01JWCIsIk1JWCIsIk1JWF9BIiwiTUlYX0IiLCJVUkwiLCJwcm9jZXNzIiwiZW52IiwiREVMSVZFUl9URVNUX1VSTCIsIkFETUlOIiwiREVMSVZFUl9URVNUX1VTRVIiLCJBRE1JTl9QQVNTV09SRCIsIkRFTElWRVJfVEVTVF9QQVNTV09SRCIsIlVTRVIiLCJQQVNTV09SRCIsInRvU3RyaW5nIiwiTUFURSIsIk1BVEVfUEFTU1dPUkQiLCJDRFAiLCJERUxJVkVSX0NEUCIsIkJST1dTRVJfVVJMIiwiREVMSVZFUl9CUk9XU0VSX1VSTCIsImF1dGgiLCJ1c2VybmFtZSIsInBhc3N3b3JkIiwic2VuZCIsIlBIT05FIiwidmlld3BvcnQiLCJ3aWR0aCIsImhlaWdodCIsImRldmljZVNjYWxlRmFjdG9yIiwiaXNNb2JpbGUiLCJoYXNUb3VjaCIsInVzZXJBZ2VudCIsIm9jc0hlYWRlcnMiLCJBY2NlcHQiLCJkZXNjcmliZSIsImJyb3dzZXIiLCJjb250ZXh0IiwicGFnZSIsImZvbGRlciIsInZlcnNpb25JZCIsInByb2plY3RJZCIsImJlZm9yZUFsbCIsInBsYXl3cmlnaHQiLCJ0ZXN0VXNlciIsImFwaSIsInJlcXVlc3QiLCJuZXdDb250ZXh0IiwiYmFzZVVSTCIsImh0dHBDcmVkZW50aWFscyIsImV4dHJhSFRUUEhlYWRlcnMiLCJkYXYiLCJmZXRjaCIsIm1ldGhvZCIsInN0YXR1cyIsInRvQmUiLCJkYXRhIiwic2hhcmVkIiwicG9zdCIsImZvcm0iLCJwYXRoIiwic2hhcmVUeXBlIiwic2hhcmVXaXRoIiwicGVybWlzc2lvbnMiLCJvayIsImNyZWF0ZWQiLCJmb2xkZXJJZCIsImZpbGVJZCIsImF1dG9JbnRha2UiLCJqc29uIiwib2NzIiwiaWQiLCJwcm9qZWN0IiwiZ2V0IiwiYXNzZXRzIiwidmVyc2lvbnMiLCJkaXNwb3NlIiwiY29ubmVjdE92ZXJDRFAiLCJuZXdQYWdlIiwibG9naW4iLCJhZnRlckFsbCIsImNsb3NlIiwiZGVsZXRlIiwiZ290byIsInRpbGUiLCJsb2NhdG9yIiwiaGFzVGV4dCIsInRvQ29udGFpblRleHQiLCJjbGljayIsInRvSGF2ZVVSTCIsIlJlZ0V4cCIsImxpbmsiLCJmaXJzdCIsInRvSGF2ZUNsYXNzIiwiZGJsY2xpY2siLCJnZXRCeVJvbGUiLCJuYW1lIiwiZXhhY3QiLCJmaWxsIiwidG9IYXZlQ291bnQiLCJidXR0b24iLCJub3QiLCJyZWxvYWQiLCJ0b0hhdmVBdHRyaWJ1dGUiLCJ0b0JlVmlzaWJsZSIsImtleWJvYXJkIiwicHJlc3MiLCJ1cGxvYWRzIiwic2V0SW5wdXRGaWxlcyIsIm1pbWVUeXBlIiwiYnVmZmVyIiwiZ2V0QnlUZXh0Iiwic2Vjb25kIiwiY2FyZCIsInRvSGF2ZVRleHQiLCJldmFsdWF0ZSIsImJ5dGVzIiwiZmlsZXMiLCJEYXRhVHJhbnNmZXIiLCJpdGVtcyIsImFkZCIsIkZpbGUiLCJVaW50OEFycmF5IiwidHlwZSIsInZpZXciLCJkb2N1bWVudCIsInF1ZXJ5U2VsZWN0b3IiLCJkaXNwYXRjaEV2ZW50IiwiRHJhZ0V2ZW50IiwiZGF0YVRyYW5zZmVyIiwiYnViYmxlcyIsImNhbmNlbGFibGUiLCJkdWUiLCJnZXRCeUxhYmVsIiwidGhpcmQiLCJjaGVjayIsInRvQmVDaGVja2VkIiwiY2FyZHMiLCJsYXN0IiwibW9kaWZpZXJzIiwiY291bnQiLCJ1bmNoZWNrIiwicmVuYW1lIiwidG9CZURpc2FibGVkIiwicmVuYW1lZCIsInN0YWNraW5nIiwidG9IYXZlSlNQcm9wZXJ0eSIsImJvdW5kaW5nQm94IiwiaSIsInRvQmVGb2N1c2VkIiwidG9CZUVtcHR5IiwibWFya2VyIiwidW5kZXIiLCJhYm92ZSIsImJ1dHRvbnMiLCJQcm9taXNlIiwiYWxsIiwibWFwIiwiZWFjaCIsInkiLCJ0b0JlQ2xvc2VUbyIsIngiLCJ0b0JlR3JlYXRlclRoYW5PckVxdWFsIiwidG9CZUxlc3NUaGFuT3JFcXVhbCIsInRhcmdldCIsImZpbHRlciIsInJlc3BvbnNlIiwiZ2V0QXR0cmlidXRlIiwiaGVhZGVycyIsInRvTWF0Y2giLCJlZGwiLCJ0ZXh0IiwibWF0Y2giLCJ0b0hhdmVMZW5ndGgiLCJ0b0NvbnRhaW4iLCJ0aW1lbGluZSIsImJveCIsInBvc2l0aW9uIiwicmVhY3RlZCIsIm1vdXNlIiwibW92ZSIsInRvQmVIaWRkZW4iLCJob3ZlciIsInByZXNzU2VxdWVudGlhbGx5IiwidG9IYXZlVmFsdWUiLCJwaXhlbCIsIkJ1ZmZlciIsImZyb20iLCJwaWN0dXJlIiwic3RhZ2UiLCJkb3duIiwic3RlcHMiLCJ1cCIsInN0YWNrIiwidmlkZW9zIiwidGltZXMiLCJldmFsdWF0ZUFsbCIsInZpZGVvIiwiY3VycmVudFRpbWUiLCJwaG9uZSIsImNsaXAiLCJ0YXAiLCJwYW5lbCIsImdyYWJiZXIiLCJsZXZlbCIsIndhaXRGb3JUaW1lb3V0IiwicmlnaHQiLCJ0b3VjaHNjcmVlbiIsInNldFZpZXdwb3J0U2l6ZSIsIm5ld2VzdCIsImZpbmQiLCJhc3NldCIsInNvbWUiLCJ2ZXJzaW9uIiwiZ3Vlc3QiLCJyZXZpZXdlciIsInRva2VuIiwib3B0aW9ucyIsImZvcmNlIiwidmlzaXRvciIsIm1hdGUiLCJvd25lciIsIm1lbWJlcnMiLCJwdXQiLCJwcmluY2lwYWwiLCJzaGFyZSIsImFwcHJvdmUiLCJtYWRlIiwibGFiZWwiLCJ0aGVpcnMiLCJsaXN0ZWQiLCJkaWFsb2ciLCJwb2xsIiwic3RvcmVkIiwidG9FcXVhbCIsInNlbGVjdE9wdGlvbiIsIm1lIiwidG9CZU51bGwiLCJuZXdjb21lcnMiLCJ0b01hdGNoT2JqZWN0IiwiY2F0Y2giLCJydW4iLCJ6b2VOYW1lIiwidWlkIiwidmNhcmQiLCJ6b2VJZCIsInJldmlld2VycyIsImxpbmtzIiwicmV2aWV3ZXJJZHMiLCJpbmNsdWRlcyIsImFzc2V0SWRzIiwiY2FuRG93bmxvYWQiLCJ6b2UiLCJwZXJzb24iLCJyaWdodHMiLCJub3ciLCJjYW5Db21tZW50IiwibmVzdGVkIiwiem9lTGlua3MiLCJhZ2FpbiIsImxlbmd0aCIsIm90aGVyIiwibGlua0l0ZW0iLCJoYXMiLCJzZXR0aW5ncyIsImNsZWFudXAiLCJsb2NrIiwibG9ja0ZpbGVzIiwibWluZSIsImNvbW1lbnRlZCIsImluRnJhbWUiLCJib2R5IiwiZm9jdXMiLCJzaG93biIsInRleHRUcmFja3MiLCJ0cmFjayIsIm1vZGUiLCJsYW5ndWFnZSIsInN0ZGlvIiwiaDI2NCIsImNyZWF0ZUVsZW1lbnQiLCJjYW5QbGF5VHlwZSIsImJhciIsImNsaWNrQXQiLCJlbGVtZW50IiwicGF1c2VkIiwidG9CZUdyZWF0ZXJUaGFuIiwidGltZSIsInRvQmVMZXNzVGhhbiIsIk1hdGgiLCJtYXgiLCJpZHMiLCJwdXNoIiwiZnJhbWVPZiIsImZsb29yIiwiZnJhbWUiLCJ0b3VjaFBhZ2UiLCJ0b3VjaFZpZGVvIiwiYmVzaWRlIiwidGFwQXQiLCJjb25zb2xlIiwibG9nIiwiY2xhc3NOYW1lIiwic2NyZWVuc2hvdCIsInRvSGF2ZUNTUyIsImtub2IiLCJjZHAiLCJuZXdDRFBTZXNzaW9uIiwiZmluZ2VyIiwidG91Y2hQb2ludHMiLCJkeCIsInBvaW50ZXIiLCJhdCIsInB4IiwicGVlayIsIndhaXRGb3IiLCJ0b3VjaCIsIm50aCIsImVuZGVkIiwidGltZW91dCIsInNldCIsIk9iamVjdCIsImdldE93blByb3BlcnR5RGVzY3JpcHRvciIsIkhUTUxNZWRpYUVsZW1lbnQiLCJwcm90b3R5cGUiLCJ3aW5kb3ciLCJhc3NpZ25lZCIsInNldHRsZWQiLCJhZGRFdmVudExpc3RlbmVyIiwiZGVmaW5lUHJvcGVydHkiLCJjYWxsIiwidmFsdWUiLCJzdGVwIiwiZHJhZyIsImJlZm9yZSIsIm1ha2UiLCJvbmUiLCJwaWNrIiwiY2xpcFZlcnNpb25JZCIsImNhbnZhcyIsImF1ZGlvIiwiY2VudHJlIiwiZ2V0Q29udGV4dCIsImdldEltYWdlRGF0YSIsInJvdW5kIiwiY2xpZW50V2lkdGgiLCJwYXJzZUZsb2F0Iiwic3R5bGUiLCJzdGlsbCIsInRvRGF0YVVSTCIsInBsYXllZEFmdGVyIiwicHJvYmUiLCJjb2xvciIsInBhcmVudEVsZW1lbnQiLCJhcHBlbmQiLCJwcmltYXJ5IiwiZ2V0Q29tcHV0ZWRTdHlsZSIsIk51bWJlciIsInJlbW92ZSIsInJhdGlvIiwicm93IiwiY2xpZW50SGVpZ2h0IiwiY2hhbm5lbCIsImFicyIsImNvbHVtbnMiLCJzZWNvbmRzIiwicmVzb2x2ZSIsIm9uY2UiLCJzZXRUaW1lb3V0IiwicmVxdWVzdEFuaW1hdGlvbkZyYW1lIiwidG9wIiwiYm90dG9tIiwiQXJyYXkiLCJfIiwic3VtIiwiYWZ0ZXIiLCJiZXN0Iiwic2hpZnQiLCJkaWZmZXJlbmNlIiwiSW5maW5pdHkiLCJkcmF3bkF0IiwicmVjb3JkIiwic2FtcGxlcyIsInN0YXJ0IiwicGVyZm9ybWFuY2UiLCJkcmF3biIsInF1YXJ0ZXJPbiIsInJlY29yZGluZyIsIm1vdmVkIiwiYXJyaXZlZCIsImVtdWxhdGVNZWRpYSIsInJlZHVjZWRNb3Rpb24iLCJldmVyeSIsImdvVG8iLCJzd2lwZSIsImdhcHMiLCJXaGVlbEV2ZW50IiwiZGVsdGFYIiwiZW5kIiwid2F0Y2hpbmciLCJzb3VuZCIsInJlcGVhdCIsImhlbGQiLCJzb3VuZEF0IiwicmV2ZXJzZSIsImxhbmRlZCIsImdldEJvdW5kaW5nQ2xpZW50UmVjdCIsImNsaWVudFgiLCJsZWZ0IiwiY2xpZW50WSIsInBvaW50ZXJJZCIsInBvaW50ZXJUeXBlIiwiUG9pbnRlckV2ZW50Iiwid2F2ZSIsImV2ZW50Iiwic3RvcFByb3BhZ2F0aW9uIiwiY2xlYXIiLCJDYW52YXNSZW5kZXJpbmdDb250ZXh0MkQiLCJjbGVhclJlY3QiLCJkcmF3cyIsImFyZ3MiLCJhcHBseSIsInN0YXRlIiwibm90Y2giLCJ3aGVlbCIsImZpZWxkIiwiYW5jaG9yIiwiY29tbWVudE9uUXVhcnRlciIsInN0b3BwZWQiLCJjbG9ja09mIiwibXMiLCJTdHJpbmciLCJwYWRTdGFydCIsIm9wZW5GaXJzdCIsImdldEJ5UGxhY2Vob2xkZXIiLCJjbG9zaW5nIiwibGlzdCIsInBvcHVwIiwiaXNWaXNpYmxlIiwiY2hvb3NlciIsIndhaXRGb3JFdmVudCIsInNldEZpbGVzIiwicGlja2luZyIsInByZXZlbnREZWZhdWx0IiwiYWN0aXZlRWxlbWVudCIsImJsdXIiLCJuZXh0IiwiaXNFbmFibGVkIiwic3RyaXAiLCJsaW5lIiwiaW5kZXgiLCJjdXJzb3IiLCJ6b29tIiwid2hvbGUiLCJjaXJjbGUiLCJpblN0cmlwIiwiY291bnRzIiwibWVtYmVyIiwic2hlZXQiLCJvcGVuIiwidGltZU9mIiwibWFya2VyT2YiLCJyb3V0ZSIsImZ1bGZpbGwiLCJtZXRhIiwic3RhdHVzY29kZSIsImNvbW1lbnRzIiwibWFuYWdlcyIsIm92ZXJ3cml0dGVuQXQiLCJjYW5BcHByb3ZlIiwiaGVpZ2h0cyIsInVucm91dGUiLCJiYWNrIiwiYmFja2dyb3VuZENvbG9yIiwicGFyZW50IiwicGFyZW50SWQiLCJmaW5nZXJzIiwicG9pbnRzIiwibWFyayIsInNsaWNlIiwibGFuZSIsImhlYXJkIiwiZGVsaXZlckdhaW4iLCJtdXRlZCIsImdhaW4iLCJtaXgiLCJjdXQiLCJmaWxlIiwiam9pbiIsInJlYWR5IiwiZGVyaXZlZCIsIndhdmVmb3JtIiwic2lkZSIsImFuYWx5c2VyIiwiY3JlYXRlQW5hbHlzZXIiLCJjb25uZWN0IiwiRmxvYXQzMkFycmF5IiwiZmZ0U2l6ZSIsImdldEZsb2F0VGltZURvbWFpbkRhdGEiLCJzb3VnaHQiLCJjbGFzc0xpc3QiLCJjb250YWlucyIsImEiLCJiIiwicXVlcnlTZWxlY3RvckFsbCIsImhhbHZlcyIsInNlZWtzIiwic3dpdGNoZXMiLCJ0aWNrIiwicGxheWluZyIsIlNldCIsInNhbXBsZSIsInNpemUiLCJlbnRyaWVzIiwicGFpciIsImZyZXNoIiwiZm9yRWFjaCIsImFwYXJ0IiwiZm91bmQiLCJzbG93IiwiYWRkSW5pdFNjcmlwdCIsInJlc3VtZSIsIkF1ZGlvQ29udGV4dCIsImRvbmUiLCJ0aGVuIiwicGFzc2VzIiwidG8iLCJwYXNzIiwic2lkZXdheXMiLCJjb250cm9scyIsImJlZm9yZUZvcndhcmQiLCJiZWZvcmVCYWNrIiwiYWRtaW4iLCJmZm1wZWdQYXRoIiwiZmZwcm9iZVBhdGgiLCJyZWxlYXNlIiwiY29udGludWUiLCJuYW1lcyIsInByb3h5SGFuZGVkSW4iLCJ0b1Bhc3MiLCJWaWRlb0RlY29kZXIiLCJpc0NvbmZpZ1N1cHBvcnRlZCIsImNvZGVjIiwic3VwcG9ydGVkIiwidGh1bWJzIiwicHJveHkiLCJhY3Rpb24iLCJtZW51IiwiZGVyaXZlZEZyb21Ccm93c2VyIiwidXBsb2FkIiwiZ2l2ZW4iLCJ1c2VycyIsInVzZXJpZCIsImtleSIsImRpc3BsYXlOYW1lIiwiRGVwdGgiLCJleGVjIiwid2FpdEZvclVSTCJdLCJzb3VyY2VzIjpbInJldmlldy5zcGVjLmpzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGNocm9taXVtLCBleHBlY3QsIHRlc3QgfSBmcm9tICdAcGxheXdyaWdodC90ZXN0J1xuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJ1xuaW1wb3J0IHsgcmFuZG9tQnl0ZXMgfSBmcm9tICdub2RlOmNyeXB0bydcbmltcG9ydCB7IHJlYWRGaWxlU3luYyB9IGZyb20gJ25vZGU6ZnMnXG5pbXBvcnQgeyBDTElQLCBDTElQX1NDUlVCLCBDVVRfQSwgQ1VUX0IsIEROWEhSLCBIQU5EX1BST1hZLCBMT05HLCBMT05HX01JWCwgTUlYLCBNSVhfQSwgTUlYX0IgfSBmcm9tICcuL2ZpeHR1cmVzLmpzJ1xuXG5jb25zdCBVUkwgPSBwcm9jZXNzLmVudi5ERUxJVkVSX1RFU1RfVVJMID8/ICdodHRwOi8vbG9jYWxob3N0OjgwODAnXG5jb25zdCBBRE1JTiA9IHByb2Nlc3MuZW52LkRFTElWRVJfVEVTVF9VU0VSID8/ICdhZG1pbidcbmNvbnN0IEFETUlOX1BBU1NXT1JEID0gcHJvY2Vzcy5lbnYuREVMSVZFUl9URVNUX1BBU1NXT1JEID8/ICdhZG1pbmFkbWluMTIzJ1xuLyoqIEEgdXNlciBvZiBpdHMgb3duLCBpbiBFbmdsaXNoOiB0aGUgdGVzdHMgZmluZCBidXR0b25zIGJ5IHRoZWlyIG5hbWVzLCB3aGF0ZXZlciBsYW5ndWFnZSB0aGUgYWRtaW4gc3BlYWtzICovXG5jb25zdCBVU0VSID0gJ2RlbGl2ZXItZTJlJ1xuY29uc3QgUEFTU1dPUkQgPSAnZGVsaXZlci1lMmUtJyArIHJhbmRvbUJ5dGVzKDEyKS50b1N0cmluZygnaGV4Jylcbi8qKiBBIHNlY29uZCBNZW1iZXIsIHNvbWVvbmUgdG8gbWVudGlvbiAqL1xuY29uc3QgTUFURSA9ICdkZWxpdmVyLWUyZS1tYXRlJ1xuY29uc3QgTUFURV9QQVNTV09SRCA9ICdtYXRlLScgKyByYW5kb21CeXRlcygxMikudG9TdHJpbmcoJ2hleCcpXG5jb25zdCBDRFAgPSBwcm9jZXNzLmVudi5ERUxJVkVSX0NEUCA/PyAnaHR0cDovLzEyNy4wLjAuMTo5MjIyJ1xuLyoqIFRoZSBicm93c2VyIG1heSBzaXQgaW4gaXRzIG93biBjb250YWluZXIsIHdoZXJlIGxvY2FsaG9zdCBpcyBub3QgTmV4dGNsb3VkICovXG5jb25zdCBCUk9XU0VSX1VSTCA9IHByb2Nlc3MuZW52LkRFTElWRVJfQlJPV1NFUl9VUkwgPz8gVVJMXG5cbmNvbnN0IGF1dGggPSB7IHVzZXJuYW1lOiBVU0VSLCBwYXNzd29yZDogUEFTU1dPUkQsIHNlbmQ6ICdhbHdheXMnIH1cbi8qKiBBbiBpUGhvbmUgYXMgTmV4dGNsb3VkIGFjY2VwdHMgaXQ6IGEgY3VycmVudCBTYWZhcmksIHRvdWNoLCBhbmQgaXRzIHNpemUgKi9cbmNvbnN0IFBIT05FID0ge1xuXHR2aWV3cG9ydDogeyB3aWR0aDogMzkwLCBoZWlnaHQ6IDg0NCB9LFxuXHRkZXZpY2VTY2FsZUZhY3RvcjogMyxcblx0aXNNb2JpbGU6IHRydWUsXG5cdGhhc1RvdWNoOiB0cnVlLFxuXHR1c2VyQWdlbnQ6ICdNb3ppbGxhLzUuMCAoaVBob25lOyBDUFUgaVBob25lIE9TIDI2XzEgbGlrZSBNYWMgT1MgWCkgQXBwbGVXZWJLaXQvNjA1LjEuMTUgKEtIVE1MLCBsaWtlIEdlY2tvKSBWZXJzaW9uLzI2LjEgTW9iaWxlLzE1RTE0OCBTYWZhcmkvNjA0LjEnLFxufVxuY29uc3Qgb2NzSGVhZGVycyA9IHsgJ09DUy1BUElSRVFVRVNUJzogJ3RydWUnLCBBY2NlcHQ6ICdhcHBsaWNhdGlvbi9qc29uJyB9XG5cbnRlc3QuZGVzY3JpYmUoJ1JldmlldyB2aWV3JywgKCkgPT4ge1xuXHRsZXQgYnJvd3NlclxuXHRsZXQgY29udGV4dFxuXHRsZXQgcGFnZVxuXHRsZXQgZm9sZGVyXG5cdGxldCB2ZXJzaW9uSWRcblx0bGV0IHByb2plY3RJZFxuXG5cdHRlc3QuYmVmb3JlQWxsKGFzeW5jICh7IHBsYXl3cmlnaHQgfSkgPT4ge1xuXHRcdGF3YWl0IHRlc3RVc2VyKHBsYXl3cmlnaHQpXG5cdFx0Y29uc3QgYXBpID0gYXdhaXQgcGxheXdyaWdodC5yZXF1ZXN0Lm5ld0NvbnRleHQoeyBiYXNlVVJMOiBVUkwsIGh0dHBDcmVkZW50aWFsczogYXV0aCwgZXh0cmFIVFRQSGVhZGVyczogb2NzSGVhZGVycyB9KVxuXHRcdGZvbGRlciA9ICdkZWxpdmVyLWUyZS0nICsgcmFuZG9tQnl0ZXMoNCkudG9TdHJpbmcoJ2hleCcpXG5cdFx0Y29uc3QgZGF2ID0gYC9yZW1vdGUucGhwL2Rhdi9maWxlcy8ke1VTRVJ9LyR7Zm9sZGVyfWBcblx0XHRleHBlY3QoKGF3YWl0IGFwaS5mZXRjaChkYXYsIHsgbWV0aG9kOiAnTUtDT0wnIH0pKS5zdGF0dXMoKSkudG9CZSgyMDEpXG5cdFx0ZXhwZWN0KChhd2FpdCBhcGkuZmV0Y2goYCR7ZGF2fS9jbGlwLndlYm1gLCB7IG1ldGhvZDogJ1BVVCcsIGRhdGE6IHJlYWRGaWxlU3luYyhDTElQKSB9KSkuc3RhdHVzKCkpLnRvQmUoMjAxKVxuXHRcdGNvbnN0IHNoYXJlZCA9IGF3YWl0IGFwaS5wb3N0KCcvb2NzL3YyLnBocC9hcHBzL2ZpbGVzX3NoYXJpbmcvYXBpL3YxL3NoYXJlcz9mb3JtYXQ9anNvbicsIHtcblx0XHRcdGZvcm06IHsgcGF0aDogYC8ke2ZvbGRlcn1gLCBzaGFyZVR5cGU6IDAsIHNoYXJlV2l0aDogTUFURSwgcGVybWlzc2lvbnM6IDE3IH0sXG5cdFx0fSlcblx0XHRleHBlY3Qoc2hhcmVkLm9rKCkpLnRvQmUodHJ1ZSlcblxuXHRcdGNvbnN0IGNyZWF0ZWQgPSBhd2FpdCBhcGkucG9zdCgnL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS9wcm9qZWN0cz9mb3JtYXQ9anNvbicsIHtcblx0XHRcdGRhdGE6IHsgZm9sZGVySWQ6IGF3YWl0IGZpbGVJZChhcGksIGRhdiksIGF1dG9JbnRha2U6IHRydWUgfSxcblx0XHR9KVxuXHRcdHByb2plY3RJZCA9IChhd2FpdCBjcmVhdGVkLmpzb24oKSkub2NzLmRhdGEuaWRcblx0XHRjb25zdCBwcm9qZWN0ID0gYXdhaXQgYXBpLmdldChgL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS9wcm9qZWN0cy8ke3Byb2plY3RJZH0/Zm9ybWF0PWpzb25gKVxuXHRcdHZlcnNpb25JZCA9IChhd2FpdCBwcm9qZWN0Lmpzb24oKSkub2NzLmRhdGEuYXNzZXRzWzBdLnZlcnNpb25zWzBdLmlkXG5cdFx0YXdhaXQgYXBpLmRpc3Bvc2UoKVxuXG5cdFx0YnJvd3NlciA9IGF3YWl0IGNocm9taXVtLmNvbm5lY3RPdmVyQ0RQKENEUClcblx0XHRjb250ZXh0ID0gYXdhaXQgYnJvd3Nlci5uZXdDb250ZXh0KHsgYmFzZVVSTDogQlJPV1NFUl9VUkwgfSlcblx0XHRwYWdlID0gYXdhaXQgY29udGV4dC5uZXdQYWdlKClcblx0XHRhd2FpdCBsb2dpbihwYWdlKVxuXHR9KVxuXG5cdHRlc3QuYWZ0ZXJBbGwoYXN5bmMgKHsgcGxheXdyaWdodCB9KSA9PiB7XG5cdFx0YXdhaXQgY29udGV4dD8uY2xvc2UoKVxuXHRcdGF3YWl0IGJyb3dzZXI/LmNsb3NlKClcblx0XHRjb25zdCBhcGkgPSBhd2FpdCBwbGF5d3JpZ2h0LnJlcXVlc3QubmV3Q29udGV4dCh7IGJhc2VVUkw6IFVSTCwgaHR0cENyZWRlbnRpYWxzOiBhdXRoLCBleHRyYUhUVFBIZWFkZXJzOiBvY3NIZWFkZXJzIH0pXG5cdFx0YXdhaXQgYXBpLmRlbGV0ZShgL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS9wcm9qZWN0cy8ke3Byb2plY3RJZH0/Zm9ybWF0PWpzb25gKVxuXHRcdGF3YWl0IGFwaS5mZXRjaChgL3JlbW90ZS5waHAvZGF2L2ZpbGVzLyR7VVNFUn0vJHtmb2xkZXJ9YCwgeyBtZXRob2Q6ICdERUxFVEUnIH0pXG5cdFx0YXdhaXQgYXBpLmRpc3Bvc2UoKVxuXHR9KVxuXG5cdHRlc3QoJ3RoZSBQcm9qZWN0IGxpc3QgbGVhZHMgaW50byBhIFJldmlldyBhbmQgYmFjaycsIGFzeW5jICgpID0+IHtcblx0XHRhd2FpdCBwYWdlLmdvdG8oJy9hcHBzL2RlbGl2ZXIvJylcblx0XHRjb25zdCB0aWxlID0gcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wcm9qZWN0LWNhcmQnLCB7IGhhc1RleHQ6IGZvbGRlciB9KVxuXHRcdGF3YWl0IGV4cGVjdCh0aWxlKS50b0NvbnRhaW5UZXh0KCcxIEFzc2V0Jylcblx0XHRhd2FpdCB0aWxlLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKG5ldyBSZWdFeHAoYC9wcm9qZWN0cy8ke3Byb2plY3RJZH0kYCkpXG5cdFx0Ly8gQSBjbGljayB0aWNrcyB0aGUgY2FyZCwgYSBkb3VibGUgY2xpY2sgb3BlbnMgaXQgKHN0b3J5IDE0MSlcblx0XHRjb25zdCBsaW5rID0gcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jYXJkX19saW5rJykuZmlyc3QoKVxuXHRcdGF3YWl0IGxpbmsuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNhcmQnKS5maXJzdCgpKS50b0hhdmVDbGFzcygvZGVsaXZlci1jYXJkLS1zZWxlY3RlZC8pXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTChuZXcgUmVnRXhwKGAvcHJvamVjdHMvJHtwcm9qZWN0SWR9JGApKVxuXHRcdGF3YWl0IGxpbmsuZGJsY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwobmV3IFJlZ0V4cChgL3ZlcnNpb25zLyR7dmVyc2lvbklkfSRgKSlcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnbGluaycsIHsgbmFtZTogZm9sZGVyLCBleGFjdDogdHJ1ZSB9KS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTChuZXcgUmVnRXhwKGAvcHJvamVjdHMvJHtwcm9qZWN0SWR9JGApKVxuXG5cdFx0Ly8gVGhlIFByb2plY3QgbGlzdCBmaW5kcyBhIFByb2plY3QgYnkgbmFtZSwgYW5kIGEgcmlnaHQgY2xpY2sgb3BlbnMgaXQgdG9vXG5cdFx0YXdhaXQgcGFnZS5nb3RvKCcvYXBwcy9kZWxpdmVyLycpXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ3NlYXJjaGJveCcsIHsgbmFtZTogJ0ZpbmQgYSBQcm9qZWN0JyB9KS5maWxsKGZvbGRlcilcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wcm9qZWN0LWNhcmQnKSkudG9IYXZlQ291bnQoMSlcblx0XHRhd2FpdCB0aWxlLmNsaWNrKHsgYnV0dG9uOiAncmlnaHQnIH0pXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ21lbnVpdGVtJywgeyBuYW1lOiAnT3BlbicsIGV4YWN0OiB0cnVlIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKG5ldyBSZWdFeHAoYC9wcm9qZWN0cy8ke3Byb2plY3RJZH0kYCkpXG5cdH0pXG5cblx0dGVzdCgndGhlIGxpc3QgaXMgcmVtZW1iZXJlZCBmb3IgdGhlIFByb2plY3QsIGFuZCBhIGNhcmQga2VlcHMgaXRzIGFjdGlvbnMgYXMgYSByb3cnLCBhc3luYyAoKSA9PiB7XG5cdFx0YXdhaXQgcGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL3Byb2plY3RzLyR7cHJvamVjdElkfWApXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY2FyZCcpKS5ub3QudG9IYXZlQ2xhc3MoL2RlbGl2ZXItY2FyZC0tcm93Lylcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnU2hvdyB0aGUgQXNzZXRzIGFzIGEgbGlzdCcgfSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNhcmQnKS5maXJzdCgpKS50b0hhdmVDbGFzcygvZGVsaXZlci1jYXJkLS1yb3cvKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNhcmRfX2ZhY3RzJykuZmlyc3QoKSkudG9Db250YWluVGV4dCgnVjEnKVxuXHRcdGF3YWl0IHBhZ2UucmVsb2FkKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jYXJkJykuZmlyc3QoKSkudG9IYXZlQ2xhc3MoL2RlbGl2ZXItY2FyZC0tcm93Lylcblx0XHRhd2FpdCBleHBlY3QocGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1Nob3cgdGhlIEFzc2V0cyBhcyBhIGxpc3QnIH0pKS50b0hhdmVBdHRyaWJ1dGUoJ2FyaWEtcHJlc3NlZCcsICd0cnVlJylcblx0XHQvLyBUaGUgbWVudSBpcyBzdGlsbCB0aGVyZSwgYXMgYSByb3dcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAvXkFjdGlvbnMgZm9yIC8gfSkuZmlyc3QoKS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKCdtZW51aXRlbScsIHsgbmFtZTogJ1JlbmFtZeKApicgfSkpLnRvQmVWaXNpYmxlKClcblx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdFc2NhcGUnKVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdTaG93IHRoZSBBc3NldHMgYXMgYSBsaXN0JyB9KS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY2FyZCcpLmZpcnN0KCkpLm5vdC50b0hhdmVDbGFzcygvZGVsaXZlci1jYXJkLS1yb3cvKVxuXHR9KVxuXG5cdHRlc3QoJ3VwbG9hZHMgaW50byB0aGUgUHJvamVjdCwgdGhlbiBmaWx0ZXJzIGFuZCBmaW5kcyBpdHMgQXNzZXRzJywgYXN5bmMgKCkgPT4ge1xuXHRcdGF3YWl0IHBhZ2UuZ290byhgL2FwcHMvZGVsaXZlci9wcm9qZWN0cy8ke3Byb2plY3RJZH1gKVxuXHRcdC8vIFRoZSB1cGxvYWQgYnV0dG9uIG9wZW5zIHRoZSBVcGxvYWRzIGRpYWxvZyAoc3RvcnkgMTMzKVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdVcGxvYWQnLCBleGFjdDogdHJ1ZSB9KS5jbGljaygpXG5cdFx0Y29uc3QgdXBsb2FkcyA9IHBhZ2UuZ2V0QnlSb2xlKCdkaWFsb2cnLCB7IG5hbWU6ICdVcGxvYWRzJyB9KVxuXHRcdGF3YWl0IHVwbG9hZHMubG9jYXRvcignaW5wdXRbdHlwZT1maWxlXVttdWx0aXBsZV0nKS5zZXRJbnB1dEZpbGVzKHsgbmFtZTogJ3NlY29uZC53ZWJtJywgbWltZVR5cGU6ICd2aWRlby93ZWJtJywgYnVmZmVyOiByZWFkRmlsZVN5bmMoQ0xJUCkgfSlcblx0XHQvLyBBdXRvIEludGFrZSB3b3VsZCB0YWtlIHRoZSBmaWxlIGFueXdheTsgdGhlIHVwbG9hZCBpdHNlbGYgbXVzdCBub3QgZmFpbFxuXHRcdGF3YWl0IGV4cGVjdCh1cGxvYWRzLmdldEJ5VGV4dCgnT3BlbicsIHsgZXhhY3Q6IHRydWUgfSkpLnRvQmVWaXNpYmxlKClcblx0XHRhd2FpdCBleHBlY3QodXBsb2Fkcy5sb2NhdG9yKCcuZGVsaXZlci11cGxvYWRzX19zdGF0dXMtLWVycm9yJykpLnRvSGF2ZUNvdW50KDApXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnRXNjYXBlJylcblx0XHRjb25zdCBzZWNvbmQgPSBjYXJkKHBhZ2UsICdzZWNvbmQnKVxuXHRcdGF3YWl0IGV4cGVjdChzZWNvbmQpLnRvQmVWaXNpYmxlKClcblxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6IC9eQ2hhbmdlcyByZXF1ZXN0ZWQvIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKC9maWx0ZXI9Y2hhbmdlcy8pXG5cdFx0YXdhaXQgZXhwZWN0KHNlY29uZCkudG9IYXZlQ291bnQoMClcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAvXkFsbC8gfSkuY2xpY2soKVxuXG5cdFx0Ly8gV2hvZXZlciB1cGxvYWRzIGRlbGl2ZXJzOiB0aGUgY2FyZCBuYW1lcyB0aGVtLCBhbmQgdGhlIGZpbHRlciBmaW5kcyB3aGF0IHRoZXkgZGVsaXZlcmVkXG5cdFx0YXdhaXQgZXhwZWN0KHNlY29uZC5sb2NhdG9yKCcuZGVsaXZlci1jYXJkX19tZXRhJykpLnRvQ29udGFpblRleHQoL15kZWxpdmVyLWUyZSDCtyAvKVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6IC9eRGVsaXZlcmVkIGJ5IG1lLyB9KS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTCgvZmlsdGVyPW1pbmUvKVxuXHRcdGF3YWl0IGV4cGVjdChzZWNvbmQpLnRvQmVWaXNpYmxlKClcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAvXkFsbC8gfSkuY2xpY2soKVxuXG5cdFx0Ly8gVGhlIGxhdGVzdCBhY3Rpdml0eSBjb21lcyBmaXJzdCwgdW50aWwgdGhlIG9yZGVyIGlzIGJ5IG5hbWVcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jYXJkX19uYW1lJykuZmlyc3QoKSkudG9IYXZlVGV4dCgnc2Vjb25kJylcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnTGF0ZXN0IGFjdGl2aXR5JyB9KS5jbGljaygpXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ21lbnVpdGVtcmFkaW8nLCB7IG5hbWU6ICdOYW1lJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTCgvc29ydD1uYW1lLylcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jYXJkX19uYW1lJykuZmlyc3QoKSkudG9IYXZlVGV4dCgnY2xpcCcpXG5cblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnc2VhcmNoYm94JywgeyBuYW1lOiAnRmluZCBhbiBBc3NldCcgfSkuZmlsbCgnU0VDT05EJylcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jYXJkJykpLnRvSGF2ZUNvdW50KDEpXG5cblx0XHQvLyBEcm9wcGVkIGZpbGVzIGdvIHRoZSBzYW1lIHdheTsgYW55dGhpbmcgYnV0IG1lZGlhIHN0YXlzIG91dFxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdzZWFyY2hib3gnLCB7IG5hbWU6ICdGaW5kIGFuIEFzc2V0JyB9KS5maWxsKCcnKVxuXHRcdGF3YWl0IHBhZ2UuZXZhbHVhdGUoKGJ5dGVzKSA9PiB7XG5cdFx0XHRjb25zdCBmaWxlcyA9IG5ldyBEYXRhVHJhbnNmZXIoKVxuXHRcdFx0ZmlsZXMuaXRlbXMuYWRkKG5ldyBGaWxlKFtuZXcgVWludDhBcnJheShieXRlcyldLCAndGhpcmQud2VibScsIHsgdHlwZTogJ3ZpZGVvL3dlYm0nIH0pKVxuXHRcdFx0ZmlsZXMuaXRlbXMuYWRkKG5ldyBGaWxlKFsnbm90ZXMnXSwgJ25vdGVzLnR4dCcsIHsgdHlwZTogJ3RleHQvcGxhaW4nIH0pKVxuXHRcdFx0Y29uc3QgdmlldyA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJy5kZWxpdmVyLXByb2plY3QnKVxuXHRcdFx0Zm9yIChjb25zdCB0eXBlIG9mIFsnZHJhZ2VudGVyJywgJ2RyYWdvdmVyJywgJ2Ryb3AnXSkge1xuXHRcdFx0XHR2aWV3LmRpc3BhdGNoRXZlbnQobmV3IERyYWdFdmVudCh0eXBlLCB7IGRhdGFUcmFuc2ZlcjogZmlsZXMsIGJ1YmJsZXM6IHRydWUsIGNhbmNlbGFibGU6IHRydWUgfSkpXG5cdFx0XHR9XG5cdFx0fSwgWy4uLnJlYWRGaWxlU3luYyhDTElQKV0pXG5cdFx0YXdhaXQgZXhwZWN0KGNhcmQocGFnZSwgJ3RoaXJkJykpLnRvQmVWaXNpYmxlKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jYXJkJywgeyBoYXNUZXh0OiAnbm90ZXMnIH0pKS50b0hhdmVDb3VudCgwKVxuXHRcdC8vIFRoZXkgZ28gd2l0aCB0aGUgY2FyZCBpbiB0aGUgY29ybmVyLCB3aGljaCBvcGVucyB0aGUgZGlhbG9nIGFnYWluIChzdG9yeSAxMzQpXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci11cGxvYWRzLWNhcmRfX29wZW4nKS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KHVwbG9hZHMpLnRvQ29udGFpblRleHQoJ09ubHkgdmlkZW8sIGF1ZGlvIGFuZCBpbWFnZSBmaWxlcycpXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnRXNjYXBlJylcblxuXHRcdC8vIEEgVmVyc2lvbiBTdGFjayBpcyBtYW5hZ2VkIGZyb20gaXRzIGNhcmQsIG5vdCBpbiB0aGUgUmV2aWV3IHZpZXdcblx0XHRhd2FpdCBzZWNvbmQuY2xpY2soeyBidXR0b246ICdyaWdodCcgfSlcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnbWVudWl0ZW0nLCB7IG5hbWU6ICdNYW5hZ2UgVmVyc2lvbnMnIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5nZXRCeVJvbGUoJ2RpYWxvZycsIHsgbmFtZTogJ1ZlcnNpb25zIG9mIHNlY29uZCcgfSkpLnRvQ29udGFpblRleHQoJ1ZlcnNpb24gMScpXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnRXNjYXBlJylcblxuXHRcdC8vIFNvIGlzIGl0cyBEdWUgRGF0ZSwgdGhyb3VnaCBhIHZpc2libGUgZmllbGQ6IFNhZmFyaSBvcGVucyBubyBwaWNrZXIgZm9yIGEgaGlkZGVuIG9uZVxuXHRcdGF3YWl0IHNlY29uZC5jbGljayh7IGJ1dHRvbjogJ3JpZ2h0JyB9KVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdtZW51aXRlbScsIHsgbmFtZTogJ1NldCBhIER1ZSBEYXRlJyB9KS5jbGljaygpXG5cdFx0Y29uc3QgZHVlID0gcGFnZS5nZXRCeVJvbGUoJ2RpYWxvZycsIHsgbmFtZTogJ0R1ZSBEYXRlJyB9KVxuXHRcdGF3YWl0IGR1ZS5nZXRCeUxhYmVsKCdEdWUgRGF0ZScpLmZpbGwoJzIwMzAtMDEtMTUnKVxuXHRcdGF3YWl0IGR1ZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1NhdmUnIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3Qoc2Vjb25kLmxvY2F0b3IoJy5kZWxpdmVyLWNhcmRfX2R1ZScpKS50b0NvbnRhaW5UZXh0KCcxNScpXG5cdFx0YXdhaXQgc2Vjb25kLmNsaWNrKHsgYnV0dG9uOiAncmlnaHQnIH0pXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKCdtZW51aXRlbScsIHsgbmFtZTogJ0NoYW5nZSB0aGUgRHVlIERhdGUnIH0pKS50b0JlVmlzaWJsZSgpXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnRXNjYXBlJylcblxuXHRcdC8vIFRpY2tlZCwgdHdvIGNhcmRzIHNoYXJlIG9uZSBtZW51IHdpdGggd2hhdCBhcHBsaWVzIHRvIGJvdGggKHN0b3J5IDE0MSlcblx0XHRjb25zdCB0aGlyZCA9IGNhcmQocGFnZSwgJ3RoaXJkJylcblx0XHRhd2FpdCBzZWNvbmQuZ2V0QnlSb2xlKCdjaGVja2JveCcsIHsgbmFtZTogJ1NlbGVjdCBzZWNvbmQnIH0pLmNoZWNrKClcblx0XHRhd2FpdCB0aGlyZC5nZXRCeVJvbGUoJ2NoZWNrYm94JywgeyBuYW1lOiAnU2VsZWN0IHRoaXJkJyB9KS5jaGVjaygpXG5cdFx0YXdhaXQgdGhpcmQuY2xpY2soeyBidXR0b246ICdyaWdodCcgfSlcblx0XHRhd2FpdCBleHBlY3QocGFnZS5nZXRCeVJvbGUoJ21lbnUnLCB7IG5hbWU6ICcyIEFzc2V0cyBzZWxlY3RlZCcgfSkpLnRvQmVWaXNpYmxlKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5nZXRCeVJvbGUoJ21lbnVpdGVtJywgeyBuYW1lOiAnRGVsZXRlJyB9KSkudG9CZVZpc2libGUoKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5Um9sZSgnbWVudWl0ZW0nLCB7IG5hbWU6ICdPcGVuJyB9KSkudG9IYXZlQ291bnQoMClcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnbWVudWl0ZW0nLCB7IG5hbWU6ICdDbGVhciB0aGUgc2VsZWN0aW9uJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KHNlY29uZC5nZXRCeVJvbGUoJ2NoZWNrYm94JywgeyBuYW1lOiAnU2VsZWN0IHNlY29uZCcgfSkpLm5vdC50b0JlQ2hlY2tlZCgpXG5cdFx0Ly8gQSBzaGlmdC1jbGljayB0aWNrcyBldmVyeSBjYXJkIGZyb20gdGhlIG9uZSBjbGlja2VkIGxhc3Rcblx0XHRjb25zdCBjYXJkcyA9IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY2FyZF9fc2VsZWN0Jylcblx0XHRhd2FpdCBjYXJkcy5maXJzdCgpLmNoZWNrKClcblx0XHRhd2FpdCBjYXJkcy5sYXN0KCkuY2xpY2soeyBtb2RpZmllcnM6IFsnU2hpZnQnXSB9KVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNhcmRfX3NlbGVjdDpjaGVja2VkJykpLnRvSGF2ZUNvdW50KGF3YWl0IGNhcmRzLmNvdW50KCkpXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2NoZWNrYm94JywgeyBuYW1lOiAnQ2xlYXIgdGhlIHNlbGVjdGlvbicgfSkudW5jaGVjaygpXG5cblx0XHQvLyBUaGUgY2hlY2tib3ggYXQgdGhlIHN0YXJ0IG9mIHRoZSBmaWx0ZXIgcm93IHRpY2tzIGV2ZXJ5IGNhcmQsIGFuZCBjbGVhcnMgdGhlbSBhZ2FpblxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdjaGVja2JveCcsIHsgbmFtZTogJ1NlbGVjdCBhbGwnIH0pLmNoZWNrKClcblx0XHRhd2FpdCBleHBlY3QodGhpcmQuZ2V0QnlSb2xlKCdjaGVja2JveCcsIHsgbmFtZTogJ1NlbGVjdCB0aGlyZCcgfSkpLnRvQmVDaGVja2VkKClcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnY2hlY2tib3gnLCB7IG5hbWU6ICdDbGVhciB0aGUgc2VsZWN0aW9uJyB9KS51bmNoZWNrKClcblx0XHRhd2FpdCBleHBlY3QodGhpcmQuZ2V0QnlSb2xlKCdjaGVja2JveCcsIHsgbmFtZTogJ1NlbGVjdCB0aGlyZCcgfSkpLm5vdC50b0JlQ2hlY2tlZCgpXG5cdH0pXG5cblx0dGVzdCgncmVuYW1lcywgcmVtb3ZlcyBhbmQgc3RhY2tzIGZyb20gdGhlIG1lbnVzIG9mIHRoZSBjYXJkcycsIGFzeW5jICgpID0+IHtcblx0XHRhd2FpdCBwYWdlLmdvdG8oYC9hcHBzL2RlbGl2ZXIvcHJvamVjdHMvJHtwcm9qZWN0SWR9YClcblx0XHQvLyBUaGUgbWVudSBoYXMgYSBidXR0b24gb24gZXZlcnkgc2NyZWVuLCBiZXNpZGUgdGhlIG5hbWVcblx0XHRjb25zdCBzZWNvbmQgPSBjYXJkKHBhZ2UsICdzZWNvbmQnKVxuXHRcdGF3YWl0IHNlY29uZC5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ0FjdGlvbnMgZm9yIHNlY29uZCcgfSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5Um9sZSgnbWVudWl0ZW0nLCB7IG5hbWU6ICdEb3dubG9hZCcgfSkpLnRvSGF2ZUF0dHJpYnV0ZSgnaHJlZicsIC9cXC9zZWNvbmRcXC53ZWJtJC8pXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ21lbnVpdGVtJywgeyBuYW1lOiAnUmVuYW1l4oCmJyB9KS5jbGljaygpXG5cdFx0Y29uc3QgcmVuYW1lID0gcGFnZS5nZXRCeVJvbGUoJ2RpYWxvZycsIHsgbmFtZTogJ1JlbmFtZSBmaWxlJyB9KVxuXHRcdGF3YWl0IGV4cGVjdChyZW5hbWUpLnRvQ29udGFpblRleHQoJ2FjdGl2ZWx5IGJlaW5nIHdvcmtlZCBvbicpXG5cdFx0Ly8gTmV4dGNsb3VkIHJlYWRzIHRoZSB0eXBlIGZyb20gdGhlIGV4dGVuc2lvbiwgc28gaXQgc3RheXNcblx0XHRhd2FpdCByZW5hbWUuZ2V0QnlMYWJlbCgnTmFtZScpLmZpbGwoJ3JlbmFtZWQubW92Jylcblx0XHRhd2FpdCBleHBlY3QocmVuYW1lLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnUmVuYW1lJyB9KSkudG9CZURpc2FibGVkKClcblx0XHQvLyBBIG5hbWUgd2l0aCAmIGFuZCAnIHNob3dzIGFzIGl0IGlzLCBpbiBsYWJlbHMgdG9vICgjOTMpXG5cdFx0YXdhaXQgcmVuYW1lLmdldEJ5TGFiZWwoJ05hbWUnKS5maWxsKCdTbWl0aCAmIE9cXCdOZWlsLndlYm0nKVxuXHRcdGF3YWl0IHJlbmFtZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1JlbmFtZScgfSkuY2xpY2soKVxuXHRcdGNvbnN0IHJlbmFtZWQgPSBjYXJkKHBhZ2UsICdTbWl0aCAmIE9cXCdOZWlsJylcblx0XHRhd2FpdCBleHBlY3QocmVuYW1lZC5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ0FjdGlvbnMgZm9yIFNtaXRoICYgT1xcJ05laWwnLCBleGFjdDogdHJ1ZSB9KSkudG9CZVZpc2libGUoKVxuXG5cdFx0Ly8gUmVtb3ZlZCBmcm9tIGEgRm9sZGVyIFByb2plY3Qgd2l0aCBBdXRvIEludGFrZSwgYSBmaWxlIHdhaXRzIGFzIG5vdCB1cCBmb3IgcmV2aWV3ICgjNDUpXG5cdFx0YXdhaXQgY2FyZChwYWdlLCAndGhpcmQnKS5jbGljayh7IGJ1dHRvbjogJ3JpZ2h0JyB9KVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdtZW51aXRlbScsIHsgbmFtZTogJ1JlbW92ZSBmcm9tIFByb2plY3QnIH0pLmNsaWNrKClcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnZGlhbG9nJykuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdSZW1vdmUnIH0pLmNsaWNrKClcblx0XHRjb25zdCB0aGlyZCA9IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItbm90LXVwJywgeyBoYXNUZXh0OiAndGhpcmQud2VibScgfSlcblx0XHRhd2FpdCBleHBlY3QodGhpcmQpLnRvQmVWaXNpYmxlKClcblx0XHRhd2FpdCBwYWdlLnJlbG9hZCgpXG5cdFx0YXdhaXQgZXhwZWN0KHRoaXJkKS50b0JlVmlzaWJsZSgpXG5cblx0XHQvLyBhbmQgam9pbnMgYW4gQXNzZXQgZnJvbSBpdHMgb3duIG1lbnVcblx0XHRhd2FpdCB0aGlyZC5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ0FjdGlvbnMgZm9yIHRoaXJkLndlYm0nIH0pLmNsaWNrKClcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnbWVudWl0ZW0nLCB7IG5hbWU6ICdBZGQgYXMgYSBuZXcgVmVyc2lvbiBvZuKApicgfSkuY2xpY2soKVxuXHRcdGNvbnN0IHN0YWNraW5nID0gcGFnZS5nZXRCeVJvbGUoJ2RpYWxvZycsIHsgbmFtZTogJ0FkZCB0aGlyZC53ZWJtIGFzIGEgbmV3IFZlcnNpb24nIH0pXG5cdFx0YXdhaXQgc3RhY2tpbmcubG9jYXRvcignLnYtc2VsZWN0JykuY2xpY2soKVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdvcHRpb24nLCB7IG5hbWU6ICdTbWl0aCAmIE9cXCdOZWlsJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgc3RhY2tpbmcuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdBZGQnLCBleGFjdDogdHJ1ZSB9KS5jbGljaygpXG5cdFx0Ly8gVGhlIEFzc2V0IGlzIG5hbWVkIGFmdGVyIGl0cyBuZXdlc3QgVmVyc2lvbidzIGZpbGVcblx0XHRhd2FpdCBleHBlY3QoY2FyZChwYWdlLCAndGhpcmQnKS5sb2NhdG9yKCcuZGVsaXZlci1jYXJkX192ZXJzaW9uJykpLnRvSGF2ZVRleHQoJ1YyJylcblx0XHRhd2FpdCBleHBlY3QocmVuYW1lZCkudG9IYXZlQ291bnQoMClcblx0XHRhd2FpdCBleHBlY3QodGhpcmQpLnRvSGF2ZUNvdW50KDApXG5cdH0pXG5cblx0dGVzdCgnY29tbWVudHMgb24gYSBGcmFtZSBhbmQgb24gYSBSYW5nZSwgcmVzb2x2ZXMgYW5kIHJlcGxpZXMnLCBhc3luYyAoKSA9PiB7XG5cdFx0YXdhaXQgcGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL3ZlcnNpb25zLyR7dmVyc2lvbklkfWApXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcigndmlkZW8uZGVsaXZlci1wbGF5ZXJfX3ZpZGVvJykpLnRvSGF2ZUpTUHJvcGVydHkoJ3JlYWR5U3RhdGUnLCA0KVxuXG5cdFx0Ly8gRnJhbWUgc3RlcHBpbmcgaXMgZXhhY3Q6IGZpdmUgc3RlcHMgYXQgMjUgZnBzIGxhbmQgb24gMDA6MDA6MDA6MDU7IEMgYnJpbmdzIGhpZGRlbiBDb21tZW50cyBiYWNrXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ0hpZGUgQ29tbWVudHMnIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX21hcmtlcicpKS50b0hhdmVDb3VudCgwKVxuXHRcdGNvbnN0IGhlaWdodCA9IChhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fc3RhZ2UnKS5ib3VuZGluZ0JveCgpKS5oZWlnaHRcblx0XHQvLyBGb2N1cyB0aGUgcGFnZSB3aXRob3V0IHRvdWNoaW5nIHRoZSBwbGF5ZXJcblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXJldmlld19fdGl0bGUnKS5jbGljaygpXG5cdFx0Zm9yIChsZXQgaSA9IDA7IGkgPCA1OyBpKyspIHtcblx0XHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ0Fycm93UmlnaHQnKVxuXHRcdH1cblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX3RpbWVjb2RlJykpLnRvQ29udGFpblRleHQoJzAwOjAwOjAwOjA1JylcblxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ2MnKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJyNkZWxpdmVyLWNvbW1lbnQtYm9keScpKS50b0JlRm9jdXNlZCgpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tbWVudHNfX2FuY2hvcicpKS50b0hhdmVUZXh0KC8wMDowMDowMDowNS8pXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcjZGVsaXZlci1jb21tZW50LWJvZHknKS5maWxsKCdzb3VuZCBzdGFydHMgdG9vIGVhcmx5Jylcblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRzX19mb3JtIGJ1dHRvblt0aXRsZT1cIlNlbmQgKEVudGVyKVwiXScpLmNsaWNrKClcblxuXHRcdGNvbnN0IGZpcnN0ID0gcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50JykuZmlyc3QoKVxuXHRcdGF3YWl0IGV4cGVjdChmaXJzdCkudG9Db250YWluVGV4dCgnc291bmQgc3RhcnRzIHRvbyBlYXJseScpXG5cdFx0Ly8gTm8gcm93IG9mIGl0cyBvd246IHRoZSBDb21tZW50IHRha2VzIG5vdGhpbmcgZnJvbSB0aGUgcGljdHVyZVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fbWFya2VyJykpLnRvQmVWaXNpYmxlKClcblx0XHRleHBlY3QoKGF3YWl0IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX19zdGFnZScpLmJvdW5kaW5nQm94KCkpLmhlaWdodCkudG9CZShoZWlnaHQpXG5cdFx0YXdhaXQgZXhwZWN0KGZpcnN0LmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRfX3RpbWUnKSkubm90LnRvQmVFbXB0eSgpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tbWVudF9fYW5jaG9yJykuZmlyc3QoKSkudG9IYXZlVGV4dCgnMDA6MDA6MDA6MDUnKVxuXHRcdC8vIEl0cyBhdXRob3IncyBpbml0aWFscywgb24gdGhlIGJhciwgd2hpY2ggbGllcyBiZXR3ZWVuIHRoZSBwaWN0dXJlIGFuZCB0aGUgYnV0dG9ucyB3aXRoIG5vdGhpbmcgYmVzaWRlIGl0XG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX19tYXJrZXInKSkudG9IYXZlVGV4dCgnRCcpXG5cdFx0Y29uc3QgW21hcmtlciwgdW5kZXIsIGFib3ZlLCBidXR0b25zXSA9IGF3YWl0IFByb21pc2UuYWxsKFsnbWFya2VyJywgJ3RpbWVsaW5lJywgJ3N0YWdlJywgJ2NvbnRyb2xzJ10ubWFwKChlYWNoKSA9PiBwYWdlLmxvY2F0b3IoYC5kZWxpdmVyLXBsYXllcl9fJHtlYWNofWApLmJvdW5kaW5nQm94KCkpKVxuXHRcdGV4cGVjdChtYXJrZXIueSArIG1hcmtlci5oZWlnaHQgLyAyKS50b0JlQ2xvc2VUbyh1bmRlci55ICsgdW5kZXIuaGVpZ2h0IC8gMiwgMClcblx0XHRleHBlY3QobWFya2VyLnggKyBtYXJrZXIud2lkdGggLyAyKS50b0JlQ2xvc2VUbyh1bmRlci54ICsgdW5kZXIud2lkdGggKiA1IC8gMTAwLCAwKVxuXHRcdGV4cGVjdCh1bmRlci55KS50b0JlQ2xvc2VUbyhhYm92ZS55ICsgYWJvdmUuaGVpZ2h0LCAwKVxuXHRcdGV4cGVjdChidXR0b25zLnkpLnRvQmVDbG9zZVRvKHVuZGVyLnkgKyB1bmRlci5oZWlnaHQsIDApXG5cdFx0ZXhwZWN0KG1hcmtlci55KS50b0JlR3JlYXRlclRoYW5PckVxdWFsKGFib3ZlLnkgKyBhYm92ZS5oZWlnaHQgLSAyKVxuXHRcdGV4cGVjdChtYXJrZXIueSArIG1hcmtlci5oZWlnaHQpLnRvQmVMZXNzVGhhbk9yRXF1YWwoKGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdQbGF5IChTcGFjZSknIH0pLmJvdW5kaW5nQm94KCkpLnkpXG5cblx0XHQvLyBBIFJhbmdlLCBzZXQgd2l0aCBJIGFuZCBPXG5cdFx0Ly8gRm9jdXMgdGhlIHBhZ2Ugd2l0aG91dCB0b3VjaGluZyB0aGUgcGxheWVyXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1yZXZpZXdfX3RpdGxlJykuY2xpY2soKVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ2knKVxuXHRcdGZvciAobGV0IGkgPSAwOyBpIDwgMjA7IGkrKykge1xuXHRcdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnQXJyb3dSaWdodCcpXG5cdFx0fVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ28nKVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ2MnKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRzX19hbmNob3InKSkudG9IYXZlVGV4dCgv4oCTLylcblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJyNkZWxpdmVyLWNvbW1lbnQtYm9keScpLmZpbGwoJ3Nob3J0ZW4gdGhpcyBwYXNzYWdlJylcblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRzX19mb3JtIGJ1dHRvblt0aXRsZT1cIlNlbmQgKEVudGVyKVwiXScpLmNsaWNrKClcblx0XHQvLyBCb3RoIHN0YXJ0IG9uIHRoZSBzYW1lIEZyYW1lOiBvbmUgY2lyY2xlIHdpdGggdGhlaXIgY291bnRcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX21hcmtlcicpKS50b0hhdmVUZXh0KCcyJylcblxuXHRcdC8vIFJlc29sdmluZyBoaWRlcyBpdCBmcm9tIHRoZSB1bnJlc29sdmVkIGZpbHRlciwgYSBSZXBseSBzdGF5cyB3aXRoIGl0cyBwYXJlbnRcblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnQnKS5maXJzdCgpLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnTWFyayBhcyByZXNvbHZlZCcgfSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnQnKS5maXJzdCgpKS50b0hhdmVDbGFzcygvZGVsaXZlci1jb21tZW50LS1yZXNvbHZlZC8pXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50c19fc2hvdyBidXR0b24nKS5jbGljaygpXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ21lbnVpdGVtcmFkaW8nLCB7IG5hbWU6ICdVbnJlc29sdmVkJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tbWVudHNfX2xpc3QgPiAuZGVsaXZlci1jb21tZW50JykpLnRvSGF2ZUNvdW50KDEpXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50c19fc2hvdyBidXR0b24nKS5jbGljaygpXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ21lbnVpdGVtcmFkaW8nLCB7IG5hbWU6ICdBbGwgQ29tbWVudHMnIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50c19fbGlzdCA+IC5kZWxpdmVyLWNvbW1lbnQnKSkudG9IYXZlQ291bnQoMilcblxuXHRcdGNvbnN0IHRhcmdldCA9IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tbWVudCcpLmZpbHRlcih7IGhhc1RleHQ6ICdzb3VuZCBzdGFydHMgdG9vIGVhcmx5JyB9KS5maXJzdCgpXG5cdFx0YXdhaXQgdGFyZ2V0LmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnUmVwbHknLCBleGFjdDogdHJ1ZSB9KS5jbGljaygpXG5cdFx0YXdhaXQgdGFyZ2V0LmxvY2F0b3IoJ3RleHRhcmVhJykuZmlsbCgnYWdyZWVkLCBmcm9tIGZyYW1lIDUnKVxuXHRcdGF3YWl0IHRhcmdldC5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50X19yZXBseS1mb3JtJykuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdSZXBseScgfSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnQtLXJlcGx5JykpLnRvQ29udGFpblRleHQoJ2FncmVlZCwgZnJvbSBmcmFtZSA1JylcblxuXHRcdC8vIFRoZSBleHBvcnQgY2FycmllcyBib3RoIENvbW1lbnRzIGFzIG1hcmtlcnMsIHRoZSBSZXBseSBmb2xkZWQgaW50byBpdHMgcGFyZW50J3Mgbm90ZS5cblx0XHQvLyBUaGUgYnJvd3NlciBtYXkgcnVuIGluIGFub3RoZXIgY29udGFpbmVyIHdoZXJlIGl0cyBkb3dubG9hZHMgYXJlIG91dCBvZiByZWFjaCxcblx0XHQvLyBzbyB0aGUgdGVzdCBmZXRjaGVzIHRoZSBsaW5rIHRoZSBtZW51IG9mZmVycyB3aXRoIHRoZSBwYWdlJ3Mgb3duIHNlc3Npb24uXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ0V4cG9ydCcgfSkuY2xpY2soKVxuXHRcdGNvbnN0IGxpbmsgPSBwYWdlLmdldEJ5Um9sZSgnbWVudWl0ZW0nLCB7IG5hbWU6ICdFREwgZm9yIERhVmluY2kgUmVzb2x2ZScgfSlcblx0XHRjb25zdCByZXNwb25zZSA9IGF3YWl0IHBhZ2UucmVxdWVzdC5nZXQoYXdhaXQgbGluay5nZXRBdHRyaWJ1dGUoJ2hyZWYnKSlcblx0XHRleHBlY3QocmVzcG9uc2UuaGVhZGVycygpWydjb250ZW50LWRpc3Bvc2l0aW9uJ10pLnRvTWF0Y2goL1xcLmVkbFwiLylcblx0XHRjb25zdCBlZGwgPSBhd2FpdCByZXNwb25zZS50ZXh0KClcblx0XHRleHBlY3QoZWRsLm1hdGNoKC9cXHxNOi9nKSkudG9IYXZlTGVuZ3RoKDIpXG5cdFx0ZXhwZWN0KGVkbCkudG9Db250YWluKGBzb3VuZCBzdGFydHMgdG9vIGVhcmx5IC8gJHtVU0VSfTogYWdyZWVkLCBmcm9tIGZyYW1lIDVgKVxuXG5cdFx0Ly8gVHlwaW5nIGZpeGVzIHRoZSBGcmFtZTogbW92aW5nIHRoZSBwbGF5ZXIgYWZ0ZXJ3YXJkcyBkb2VzIG5vdCBtb3ZlIHRoZSBDb21tZW50XG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnRXNjYXBlJylcblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRzX19saXN0JykuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICcwMDowMDowMDowNScsIGV4YWN0OiB0cnVlIH0pLmNsaWNrKClcblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJyNkZWxpdmVyLWNvbW1lbnQtYm9keScpLmZpbGwoJ3QnKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRzX19hbmNob3InKSkudG9IYXZlVGV4dCgvMDA6MDA6MDA6MDUvKVxuXHRcdGNvbnN0IHRpbWVsaW5lID0gcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX3RpbWVsaW5lJylcblx0XHRjb25zdCBib3ggPSBhd2FpdCB0aW1lbGluZS5ib3VuZGluZ0JveCgpXG5cdFx0YXdhaXQgdGltZWxpbmUuY2xpY2soeyBwb3NpdGlvbjogeyB4OiBib3gud2lkdGggKiAwLjgsIHk6IGJveC5oZWlnaHQgLyAyIH0gfSlcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX3RpbWVjb2RlJykpLm5vdC50b0NvbnRhaW5UZXh0KCcwMDowMDowMDowNScpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tbWVudHNfX2FuY2hvcicpKS50b0hhdmVUZXh0KC8wMDowMDowMDowNS8pXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcjZGVsaXZlci1jb21tZW50LWJvZHknKS5maWxsKCd0eXBlZCB3aGlsZSB0aGUgcGxheWVyIG1vdmVkIG9uJylcblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRzX19mb3JtIGJ1dHRvblt0aXRsZT1cIlNlbmQgKEVudGVyKVwiXScpLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50JykuZmlsdGVyKHsgaGFzVGV4dDogJ3R5cGVkIHdoaWxlIHRoZSBwbGF5ZXIgbW92ZWQgb24nIH0pLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRfX2FuY2hvcicpKS50b0hhdmVUZXh0KCcwMDowMDowMDowNScpXG5cblx0XHQvLyBBIHJlYWN0aW9uIHNob3dzIGFzIGEgcGlsbCB3aXRoIGl0cyBjb3VudCwgbWluZSBoaWdobGlnaHRlZCAoc3RvcnkgOTEpXG5cdFx0Y29uc3QgcmVhY3RlZCA9IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tbWVudCcpLmZpbHRlcih7IGhhc1RleHQ6ICdzaG9ydGVuIHRoaXMgcGFzc2FnZScgfSkuZmlyc3QoKVxuXHRcdC8vIFJlYWN0IHdhaXRzIGZvciB0aGUgcG9pbnRlciwgYXMgb24gRnJhbWUuaW9cblx0XHRhd2FpdCBwYWdlLm1vdXNlLm1vdmUoMCwgMClcblx0XHRhd2FpdCBleHBlY3QocmVhY3RlZC5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50X19yZWFjdC1hdCcpLmZpcnN0KCkpLnRvQmVIaWRkZW4oKVxuXHRcdGF3YWl0IHJlYWN0ZWQuaG92ZXIoKVxuXHRcdGF3YWl0IHJlYWN0ZWQuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdSZWFjdCcgfSkuZmlyc3QoKS5jbGljaygpXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZW1vamktbWFydCBpbnB1dCcpLmZpbGwoJ3Rvb3RoJylcblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJy5lbW9qaS1tYXJ0IC5lbW9qaS1tYXJ0LXNjcm9sbCAuZW1vamktbWFydC1lbW9qaScpLmZpcnN0KCkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdChyZWFjdGVkLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRfX3JlYWN0aW9uLS1taW5lJykpLnRvSGF2ZVRleHQoJ/CfprcgMScpXG5cblx0XHQvLyBUeXBpbmcgQCBvZmZlcnMgdGhlIE1lbWJlcnM7IHRoZSBDb21tZW50IHNob3dzIHRoZSBuYW1lIChzdG9yeSA5MClcblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJyNkZWxpdmVyLWNvbW1lbnQtYm9keScpLmZpbGwoJycpXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcjZGVsaXZlci1jb21tZW50LWJvZHknKS5wcmVzc1NlcXVlbnRpYWxseSgnbG9vayBATWEnKVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdvcHRpb24nLCB7IG5hbWU6ICdNYXJhIE1hdGUnIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcjZGVsaXZlci1jb21tZW50LWJvZHknKSkudG9IYXZlVmFsdWUoYGxvb2sgQCR7TUFURX0gYClcblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJyNkZWxpdmVyLWNvbW1lbnQtYm9keScpLnByZXNzU2VxdWVudGlhbGx5KCdoZXJlJylcblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRzX19mb3JtIGJ1dHRvblt0aXRsZT1cIlNlbmQgKEVudGVyKVwiXScpLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50X19tZW50aW9uJykuZmlyc3QoKSkudG9IYXZlVGV4dCgnQE1hcmEgTWF0ZScpXG5cblx0XHQvLyBBbiBhdHRhY2hlZCBwaWN0dXJlIHNob3dzIHVuZGVyIGl0cyBDb21tZW50IChzdG9yeSA5Milcblx0XHRjb25zdCBwaXhlbCA9IEJ1ZmZlci5mcm9tKCdpVkJPUncwS0dnb0FBQUFOU1VoRVVnQUFBQUVBQUFBQkNBUUFBQUMxSEF3Q0FBQUFDMGxFUVZSNDJtTmsrQThBQVFVQkFTY1k0MllBQUFBQVNVVk9SSzVDWUlJPScsICdiYXNlNjQnKVxuXHRcdGF3YWl0IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tbWVudHNfX2Zvcm0gaW5wdXRbdHlwZT1maWxlXScpLnNldElucHV0RmlsZXMoeyBuYW1lOiAncmVmZXJlbmNlLnBuZycsIG1pbWVUeXBlOiAnaW1hZ2UvcG5nJywgYnVmZmVyOiBwaXhlbCB9KVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRzX19maWxlcyBsaScpKS50b0hhdmVUZXh0KCdyZWZlcmVuY2UucG5nJylcblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJyNkZWxpdmVyLWNvbW1lbnQtYm9keScpLmZpbGwoJ2xpa2UgdGhpcycpXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50c19fZm9ybSBidXR0b25bdGl0bGU9XCJTZW5kIChFbnRlcilcIl0nKS5jbGljaygpXG5cdFx0Y29uc3QgcGljdHVyZSA9IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tbWVudCcpLmZpbHRlcih7IGhhc1RleHQ6ICdsaWtlIHRoaXMnIH0pLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRfX2F0dGFjaG1lbnRzIGltZycpXG5cdFx0YXdhaXQgZXhwZWN0KHBpY3R1cmUpLnRvSGF2ZUpTUHJvcGVydHkoJ25hdHVyYWxXaWR0aCcsIDEpXG5cblx0XHQvLyBBIGRyYXdpbmcgZ29lcyB3aXRoIHRoZSBDb21tZW50IGFuZCBzaG93cyB3aGlsZSB0aGUgcGxheWVyIHN0YW5kcyBvbiBpdCAoc3RvcnkgODkpXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ0RyYXcgb24gdGhlIHBpY3R1cmUnIH0pLmNsaWNrKClcblx0XHRjb25zdCBzdGFnZSA9IGF3YWl0IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX19zdGFnZScpLmJvdW5kaW5nQm94KClcblx0XHRhd2FpdCBwYWdlLm1vdXNlLm1vdmUoc3RhZ2UueCArIHN0YWdlLndpZHRoICogMC4zLCBzdGFnZS55ICsgc3RhZ2UuaGVpZ2h0ICogMC4zKVxuXHRcdGF3YWl0IHBhZ2UubW91c2UuZG93bigpXG5cdFx0YXdhaXQgcGFnZS5tb3VzZS5tb3ZlKHN0YWdlLnggKyBzdGFnZS53aWR0aCAqIDAuNiwgc3RhZ2UueSArIHN0YWdlLmhlaWdodCAqIDAuNSwgeyBzdGVwczogOCB9KVxuXHRcdGF3YWl0IHBhZ2UubW91c2UudXAoKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRzX19kcmF3bicpKS50b0hhdmVUZXh0KCcxIHNoYXBlIGRyYXduJylcblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJyNkZWxpdmVyLWNvbW1lbnQtYm9keScpLmZpbGwoJ3RoaXMgY29ybmVyJylcblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRzX19mb3JtIGJ1dHRvblt0aXRsZT1cIlNlbmQgKEVudGVyKVwiXScpLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50JykuZmlsdGVyKHsgaGFzVGV4dDogJ3RoaXMgY29ybmVyJyB9KSkudG9CZVZpc2libGUoKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWRyYXdpbmcgcGF0aCcpKS50b0hhdmVDb3VudCgxKVxuXG5cdFx0Ly8gQSBEdWUgRGF0ZSBzZXQgaW4gdGhlIGhlYWRlciBzaG93cyB0aGVyZSAoc3RvcnkgOTMpXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1kdWVfX2J1dHRvbicpLmNsaWNrKClcblx0XHRjb25zdCBkdWUgPSBwYWdlLmdldEJ5Um9sZSgnZGlhbG9nJywgeyBuYW1lOiAnRHVlIERhdGUnIH0pXG5cdFx0YXdhaXQgZHVlLmdldEJ5TGFiZWwoJ0R1ZSBEYXRlJykuZmlsbCgnMjAzMC0wMS0zMScpXG5cdFx0YXdhaXQgZHVlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnU2F2ZScgfSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWR1ZScpKS50b0NvbnRhaW5UZXh0KCdEdWUnKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWR1ZV9fY2xlYXInKSkudG9CZVZpc2libGUoKVxuXG5cdFx0Ly8gQXBwcm92aW5nIHNob3dzIHRoZSBkZWNpc2lvbiBuZXh0IHRvIHRoZSBtZW51IChzdG9yeSA4OClcblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWFwcHJvdmFsX19tZW51IGJ1dHRvbicpLmNsaWNrKClcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnbWVudWl0ZW1yYWRpbycsIHsgbmFtZTogJ0FwcHJvdmUgdGhpcyBWZXJzaW9uJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItYXBwcm92YWxfX3Blb3BsZSBsaScpKS50b0hhdmVDb3VudCgxKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWFwcHJvdmFsX19tZW51IGJ1dHRvbicpKS50b0NvbnRhaW5UZXh0KCdBcHByb3ZlZCcpXG5cdH0pXG5cblx0dGVzdCgnY29tcGFyZXMgdHdvIFZlcnNpb25zIGluIHN0ZXAnLCBhc3luYyAoeyBwbGF5d3JpZ2h0IH0pID0+IHtcblx0XHRjb25zdCBhcGkgPSBhd2FpdCBwbGF5d3JpZ2h0LnJlcXVlc3QubmV3Q29udGV4dCh7IGJhc2VVUkw6IFVSTCwgaHR0cENyZWRlbnRpYWxzOiBhdXRoLCBleHRyYUhUVFBIZWFkZXJzOiBvY3NIZWFkZXJzIH0pXG5cdFx0ZXhwZWN0KChhd2FpdCBhcGkuZmV0Y2goYC9yZW1vdGUucGhwL2Rhdi9maWxlcy8ke1VTRVJ9LyR7Zm9sZGVyfS9jbGlwX3YyLndlYm1gLCB7IG1ldGhvZDogJ1BVVCcsIGRhdGE6IHJlYWRGaWxlU3luYyhDTElQKSB9KSkuc3RhdHVzKCkpLnRvQmUoMjAxKVxuXHRcdGNvbnN0IHByb2plY3QgPSBhd2FpdCAoYXdhaXQgYXBpLmdldChgL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS9wcm9qZWN0cy8ke3Byb2plY3RJZH0/Zm9ybWF0PWpzb25gKSkuanNvbigpXG5cdFx0YXdhaXQgYXBpLmRpc3Bvc2UoKVxuXHRcdGNvbnN0IHN0YWNrID0gcHJvamVjdC5vY3MuZGF0YS5hc3NldHNbMF0udmVyc2lvbnNcblx0XHRleHBlY3Qoc3RhY2spLnRvSGF2ZUxlbmd0aCgyKVxuXG5cdFx0YXdhaXQgcGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL2NvbXBhcmUvJHtzdGFja1sxXS5pZH0vJHtzdGFja1swXS5pZH1gKVxuXHRcdGNvbnN0IHZpZGVvcyA9IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tcGFyZSB2aWRlbycpXG5cdFx0YXdhaXQgZXhwZWN0KHZpZGVvcykudG9IYXZlQ291bnQoMilcblx0XHRhd2FpdCBleHBlY3QodmlkZW9zLmZpcnN0KCkpLnRvSGF2ZUpTUHJvcGVydHkoJ3JlYWR5U3RhdGUnLCA0KVxuXHRcdGF3YWl0IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItbGF5b3V0X19iYXIgaDInKS5jbGljaygpXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnQXJyb3dSaWdodCcpXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnQXJyb3dSaWdodCcpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tcGFyZV9fdGltZWNvZGUnKSkudG9Db250YWluVGV4dCgnMDA6MDA6MDA6MDInKVxuXHRcdC8vIEIgZm9sbG93cyBBIHRvIHRoZSBzYW1lIEZyYW1lXG5cdFx0Y29uc3QgdGltZXMgPSBhd2FpdCB2aWRlb3MuZXZhbHVhdGVBbGwoKGFsbCkgPT4gYWxsLm1hcCgodmlkZW8pID0+IHZpZGVvLmN1cnJlbnRUaW1lKSlcblx0XHRleHBlY3QodGltZXNbMV0pLnRvQmVDbG9zZVRvKHRpbWVzWzBdLCAzKVxuXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ3JhZGlvJywgeyBuYW1lOiAnV2lwZScgfSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbXBhcmVfX2hhbmRsZScpKS50b0JlVmlzaWJsZSgpXG5cdH0pXG5cblx0dGVzdCgnb24gYSBwaG9uZTogc3RhY2tlZCwgYnkgdG91Y2gsIGFuZCBhIFJldmlld2VyIGNvbW1lbnRzIG9uIGEgUmFuZ2UnLCBhc3luYyAoeyBwbGF5d3JpZ2h0IH0pID0+IHtcblx0XHRjb25zdCBwaG9uZSA9IGF3YWl0IGJyb3dzZXIubmV3Q29udGV4dCh7IGJhc2VVUkw6IEJST1dTRVJfVVJMLCAuLi5QSE9ORSB9KVxuXHRcdGNvbnN0IHBhZ2UgPSBhd2FpdCBwaG9uZS5uZXdQYWdlKClcblx0XHRhd2FpdCBsb2dpbihwYWdlKVxuXHRcdGF3YWl0IHBhZ2UuZ290byhgL2FwcHMvZGVsaXZlci9wcm9qZWN0cy8ke3Byb2plY3RJZH1gKVxuXHRcdC8vIEEgY2FyZCdzIG1lbnUgaGFzIGEgYnV0dG9uIG9mIGl0cyBvd24gb24gYSBwaG9uZSwgd2l0aCB0aGUgRHVlIERhdGUgaW4gaXRcblx0XHRjb25zdCBjbGlwID0gcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jYXJkJywgeyBoYXNUZXh0OiAnY2xpcCcgfSlcblx0XHRhd2FpdCBjbGlwLmxvY2F0b3IoJy5kZWxpdmVyLWNhcmRfX21vcmUnKS50YXAoKVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdtZW51aXRlbScsIHsgbmFtZTogL0R1ZSBEYXRlLyB9KS50YXAoKVxuXHRcdGNvbnN0IGR1ZSA9IHBhZ2UuZ2V0QnlSb2xlKCdkaWFsb2cnLCB7IG5hbWU6ICdEdWUgRGF0ZScgfSlcblx0XHRhd2FpdCBkdWUuZ2V0QnlMYWJlbCgnRHVlIERhdGUnKS5maWxsKCcyMDMwLTAyLTIwJylcblx0XHRhd2FpdCBkdWUuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdTYXZlJyB9KS50YXAoKVxuXHRcdGF3YWl0IGV4cGVjdChjbGlwLmxvY2F0b3IoJy5kZWxpdmVyLWNhcmRfX2R1ZScpKS50b0NvbnRhaW5UZXh0KCcyMCcpXG5cblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNhcmRfX21vcmUnKS5maXJzdCgpLnRhcCgpXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ21lbnVpdGVtJywgeyBuYW1lOiAnT3BlbicsIGV4YWN0OiB0cnVlIH0pLnRhcCgpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTCgvXFwvdmVyc2lvbnNcXC9cXGQrJC8pXG5cdFx0Y29uc3QgdmlkZW8gPSBwYWdlLmxvY2F0b3IoJ3ZpZGVvLmRlbGl2ZXItcGxheWVyX192aWRlbycpXG5cdFx0YXdhaXQgZXhwZWN0KHZpZGVvKS50b0hhdmVKU1Byb3BlcnR5KCdyZWFkeVN0YXRlJywgNClcblxuXHRcdC8vIFVwcmlnaHQsIG9ubHkgdGhlIGZpZWxkIHNpdHMgdW5kZXIgdGhlIHBpY3R1cmUsIHdpdGhvdXQgTmV4dGNsb3VkJ3MgaGVhZGVyOyB0aGUgbGlzdCBwdWxscyB1cCBpbiBpdHMgcGxhY2Vcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcjaGVhZGVyJykpLnRvQmVIaWRkZW4oKVxuXHRcdGNvbnN0IHN0YWdlID0gYXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX3N0YWdlJykuYm91bmRpbmdCb3goKVxuXHRcdGNvbnN0IHBhbmVsID0gYXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1sYXlvdXRfX3BhbmVsJykuYm91bmRpbmdCb3goKVxuXHRcdGV4cGVjdChwYW5lbC55KS50b0JlR3JlYXRlclRoYW5PckVxdWFsKHN0YWdlLnkgKyBzdGFnZS5oZWlnaHQpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tbWVudHNfX2hlYWQnKSkudG9CZUhpZGRlbigpXG5cdFx0Ly8gSGFsZndheSBhIDE2OjkgcGljdHVyZSBmaXRzIGFib3ZlIHRoZSBsaXN0LCB0aGVuIHRoZSBsaXN0IHRha2VzIGl0cyBwbGFjZVxuXHRcdGNvbnN0IGdyYWJiZXIgPSBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWxheW91dF9fZ3JhYmJlcicpXG5cdFx0YXdhaXQgZ3JhYmJlci50YXAoKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWxheW91dC0tbWlkZGxlJykpLnRvSGF2ZUNvdW50KDEpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tbWVudHNfX2hlYWQnKSkudG9CZVZpc2libGUoKVxuXHRcdGV4cGVjdCgoYXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX3N0YWdlJykuYm91bmRpbmdCb3goKSkuaGVpZ2h0KS50b0JlQ2xvc2VUbygzOTAgKiA5IC8gMTYsIDApXG5cdFx0YXdhaXQgZ3JhYmJlci50YXAoKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWxheW91dC0tdXAnKSkudG9IYXZlQ291bnQoMSlcblx0XHQvLyBBIHN0cm9rZSBkb3duIGdvZXMgYmFjayBhIGxldmVsIGF0IGEgdGltZVxuXHRcdGZvciAoY29uc3QgbGV2ZWwgb2YgWydtaWRkbGUnLCAnZG93biddKSB7XG5cdFx0XHRjb25zdCBib3ggPSBhd2FpdCBncmFiYmVyLmJvdW5kaW5nQm94KClcblx0XHRcdGF3YWl0IHBhZ2UubW91c2UubW92ZShib3gueCArIGJveC53aWR0aCAvIDIsIGJveC55ICsgYm94LmhlaWdodCAvIDIpXG5cdFx0XHRhd2FpdCBwYWdlLm1vdXNlLmRvd24oKVxuXHRcdFx0YXdhaXQgcGFnZS5tb3VzZS5tb3ZlKGJveC54ICsgYm94LndpZHRoIC8gMiwgYm94LnkgKyBib3guaGVpZ2h0IC8gMiArIDgwKVxuXHRcdFx0YXdhaXQgcGFnZS5tb3VzZS51cCgpXG5cdFx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKGAuZGVsaXZlci1sYXlvdXQtLSR7bGV2ZWx9YCkpLnRvSGF2ZUNvdW50KDEpXG5cdFx0fVxuXG5cdFx0Ly8gQSB0YXAgb24gdGhlIHRpbWVsaW5lIHNlZWtzIGFuZCBsZWF2ZXMgbm8gdGh1bWJuYWlsIGJlaGluZFxuXHRcdGF3YWl0IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX190aW1lbGluZScpLnRhcCgpXG5cdFx0YXdhaXQgcGFnZS53YWl0Rm9yVGltZW91dCgzMDApXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX19ob3ZlcicpKS50b0JlSGlkZGVuKClcblxuXHRcdC8vIEEgZG91YmxlIHRhcCBvbiB0aGUgcmlnaHQganVtcHMgYWhlYWQsIGEgdGFwIGdvZXMgZnVsbHNjcmVlblxuXHRcdGNvbnN0IHJpZ2h0ID0geyB4OiBzdGFnZS54ICsgc3RhZ2Uud2lkdGggKiAwLjg1LCB5OiBzdGFnZS55ICsgc3RhZ2UuaGVpZ2h0IC8gMiB9XG5cdFx0YXdhaXQgcGFnZS50b3VjaHNjcmVlbi50YXAocmlnaHQueCwgcmlnaHQueSlcblx0XHRhd2FpdCBwYWdlLnRvdWNoc2NyZWVuLnRhcChyaWdodC54LCByaWdodC55KVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fZmxhc2gnKSkudG9Db250YWluVGV4dCgnKzEwJylcblx0XHRhd2FpdCBwYWdlLndhaXRGb3JUaW1lb3V0KDcwMClcblx0XHRhd2FpdCBwYWdlLnRvdWNoc2NyZWVuLnRhcChzdGFnZS54ICsgc3RhZ2Uud2lkdGggLyAyLCByaWdodC55KVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllci0tZnVsbHNjcmVlbicpKS50b0hhdmVDb3VudCgxKVxuXHRcdGF3YWl0IHBhZ2Uud2FpdEZvclRpbWVvdXQoNzAwKVxuXHRcdGF3YWl0IHBhZ2UudG91Y2hzY3JlZW4udGFwKHN0YWdlLnggKyBzdGFnZS53aWR0aCAvIDIsIHJpZ2h0LnkpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyLS1mdWxsc2NyZWVuJykpLnRvSGF2ZUNvdW50KDApXG5cblx0XHQvLyBTaWRld2F5cywgdGhlIHBpY3R1cmUgZmlsbHMgdGhlIHdpbmRvdyBhbmQgdGhlIGxpc3Qgb3BlbnMgYmVzaWRlIGl0XG5cdFx0YXdhaXQgcGFnZS5zZXRWaWV3cG9ydFNpemUoeyB3aWR0aDogUEhPTkUudmlld3BvcnQuaGVpZ2h0LCBoZWlnaHQ6IFBIT05FLnZpZXdwb3J0LndpZHRoIH0pXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItbGF5b3V0X19iYXInKSkudG9IYXZlQ291bnQoMClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1sYXlvdXRfX3BhbmVsJykpLnRvQmVIaWRkZW4oKVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdTaG93IENvbW1lbnRzJyB9KS50YXAoKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRzX19oZWFkJykpLnRvQmVWaXNpYmxlKClcblx0XHRhd2FpdCBwaG9uZS5jbG9zZSgpXG5cblx0XHQvLyBBIFJldmlld2VyIG9uIGEgcGhvbmU6IG5hbWUgZmlyc3QsIHRoZW4gYSBSYW5nZSBieSBpdHMgYnV0dG9uXG5cdFx0Y29uc3QgYXBpID0gYXdhaXQgcGxheXdyaWdodC5yZXF1ZXN0Lm5ld0NvbnRleHQoeyBiYXNlVVJMOiBVUkwsIGh0dHBDcmVkZW50aWFsczogYXV0aCwgZXh0cmFIVFRQSGVhZGVyczogb2NzSGVhZGVycyB9KVxuXHRcdGNvbnN0IGxpbmsgPSAoYXdhaXQgKGF3YWl0IGFwaS5wb3N0KGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3Byb2plY3RzLyR7cHJvamVjdElkfS9saW5rcz9mb3JtYXQ9anNvbmApKS5qc29uKCkpLm9jcy5kYXRhXG5cdFx0Ly8gT25seSB0aGUgbmV3ZXN0IFZlcnNpb24gdGFrZXMgQ29tbWVudHMgb24gdGhpcyBsaW5rXG5cdFx0Y29uc3QgcHJvamVjdCA9IGF3YWl0IChhd2FpdCBhcGkuZ2V0KGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3Byb2plY3RzLyR7cHJvamVjdElkfT9mb3JtYXQ9anNvbmApKS5qc29uKClcblx0XHRjb25zdCBuZXdlc3QgPSBwcm9qZWN0Lm9jcy5kYXRhLmFzc2V0cy5maW5kKChhc3NldCkgPT4gYXNzZXQudmVyc2lvbnMuc29tZSgodmVyc2lvbikgPT4gdmVyc2lvbi5pZCA9PT0gdmVyc2lvbklkKSkudmVyc2lvbnNbMF0uaWRcblx0XHRhd2FpdCBhcGkuZGlzcG9zZSgpXG5cdFx0Y29uc3QgZ3Vlc3QgPSBhd2FpdCBicm93c2VyLm5ld0NvbnRleHQoeyBiYXNlVVJMOiBCUk9XU0VSX1VSTCwgLi4uUEhPTkUgfSlcblx0XHRjb25zdCByZXZpZXdlciA9IGF3YWl0IGd1ZXN0Lm5ld1BhZ2UoKVxuXHRcdGF3YWl0IHJldmlld2VyLmdvdG8oYC9hcHBzL2RlbGl2ZXIvcy8ke2xpbmsudG9rZW59L3ZlcnNpb25zLyR7bmV3ZXN0fWApXG5cdFx0YXdhaXQgcmV2aWV3ZXIubG9jYXRvcignI2RlbGl2ZXItcmV2aWV3ZXItbmFtZScpLmZpbGwoJ1BpYScpXG5cdFx0YXdhaXQgcmV2aWV3ZXIuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdTdGFydCByZXZpZXdpbmcnIH0pLnRhcCgpXG5cdFx0YXdhaXQgZXhwZWN0KHJldmlld2VyLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRzX19nYXRlJykpLnRvSGF2ZUNvdW50KDApXG5cdFx0Ly8gVGhlIGNvbXBvc2VyJ3MgdG9vbHMgc2l0IGluIGl0cyBtZW51XG5cdFx0Y29uc3Qgb3B0aW9ucyA9IHJldmlld2VyLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnQ29tbWVudCBvcHRpb25zJyB9KVxuXHRcdGF3YWl0IG9wdGlvbnMudGFwKClcblx0XHRhd2FpdCByZXZpZXdlci5nZXRCeVJvbGUoJ21lbnVpdGVtJywgeyBuYW1lOiAnU3RhcnQgYSBSYW5nZSBoZXJlJyB9KS50YXAoKVxuXHRcdGZvciAobGV0IGkgPSAwOyBpIDwgMzsgaSsrKSB7XG5cdFx0XHRhd2FpdCByZXZpZXdlci5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ09uZSBGcmFtZSBmb3J3YXJkJyB9KS50YXAoKVxuXHRcdH1cblx0XHRhd2FpdCBvcHRpb25zLnRhcCgpXG5cdFx0YXdhaXQgcmV2aWV3ZXIuZ2V0QnlSb2xlKCdtZW51aXRlbScsIHsgbmFtZTogJ0VuZCB0aGUgUmFuZ2UgaGVyZScgfSkudGFwKClcblx0XHRhd2FpdCBleHBlY3QocmV2aWV3ZXIubG9jYXRvcignLmRlbGl2ZXItY29tbWVudHNfX2FuY2hvcicpKS50b0NvbnRhaW5UZXh0KCfigJMnKVxuXHRcdGF3YWl0IHJldmlld2VyLmxvY2F0b3IoJyNkZWxpdmVyLWNvbW1lbnQtYm9keScpLmZpbGwoJ29uIHRoZSBwaG9uZScpXG5cdFx0YXdhaXQgcmV2aWV3ZXIuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdTZW5kIChFbnRlciknIH0pLnRhcCgpXG5cdFx0YXdhaXQgZXhwZWN0KHJldmlld2VyLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnQnKS5maWx0ZXIoeyBoYXNUZXh0OiAnb24gdGhlIHBob25lJyB9KSkudG9Db250YWluVGV4dCgnUGlhJylcblx0XHQvLyBBIHRhcCBvbiBpdHMgbWFya2VyIG9wZW5zIHRoZSBDb21tZW50IG9uIHRoZSBwaWN0dXJlXG5cdFx0YXdhaXQgcmV2aWV3ZXIubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX19tYXJrZXJbYXJpYS1sYWJlbF49XCJQaWFcIl0nKS50YXAoeyBmb3JjZTogdHJ1ZSB9KVxuXHRcdGF3YWl0IGV4cGVjdChyZXZpZXdlci5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX3BlZWstLXRhcHBlZCcpKS50b0NvbnRhaW5UZXh0KCdvbiB0aGUgcGhvbmUnKVxuXHRcdC8vIEEgdGFwIG9uIHRoZSBwaWN0dXJlIHRoZW4gb25seSBjbG9zZXMgaXRcblx0XHRhd2FpdCByZXZpZXdlci53YWl0Rm9yVGltZW91dCg3MDApXG5cdFx0YXdhaXQgcmV2aWV3ZXIubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX19zdGFnZScpLnRhcCh7IHBvc2l0aW9uOiB7IHg6IDQwLCB5OiA0MCB9IH0pXG5cdFx0YXdhaXQgZXhwZWN0KHJldmlld2VyLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fcGVlaycpKS50b0hhdmVDb3VudCgwKVxuXHRcdGF3YWl0IHJldmlld2VyLndhaXRGb3JUaW1lb3V0KDcwMClcblx0XHRhd2FpdCBleHBlY3QocmV2aWV3ZXIubG9jYXRvcignLmRlbGl2ZXItcGxheWVyLS1mdWxsc2NyZWVuJykpLnRvSGF2ZUNvdW50KDApXG5cdFx0YXdhaXQgZ3Vlc3QuY2xvc2UoKVxuXHR9KVxuXG5cdHRlc3QoJ2EgUmV2aWV3ZXIgbmFtZXMgdGhlbXNlbHZlcyBhbmQgY29tbWVudHMgdGhyb3VnaCBhIFJldmlldyBMaW5rJywgYXN5bmMgKHsgcGxheXdyaWdodCB9KSA9PiB7XG5cdFx0Y29uc3QgYXBpID0gYXdhaXQgcGxheXdyaWdodC5yZXF1ZXN0Lm5ld0NvbnRleHQoeyBiYXNlVVJMOiBVUkwsIGh0dHBDcmVkZW50aWFsczogYXV0aCwgZXh0cmFIVFRQSGVhZGVyczogb2NzSGVhZGVycyB9KVxuXHRcdGNvbnN0IGxpbmsgPSAoYXdhaXQgKGF3YWl0IGFwaS5wb3N0KGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3Byb2plY3RzLyR7cHJvamVjdElkfS9saW5rcz9mb3JtYXQ9anNvbmApKS5qc29uKCkpLm9jcy5kYXRhXG5cdFx0Ly8gT25seSB0aGUgbmV3ZXN0IFZlcnNpb24gdGFrZXMgQ29tbWVudHMgb24gdGhpcyBsaW5rXG5cdFx0Y29uc3QgcHJvamVjdCA9IGF3YWl0IChhd2FpdCBhcGkuZ2V0KGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3Byb2plY3RzLyR7cHJvamVjdElkfT9mb3JtYXQ9anNvbmApKS5qc29uKClcblx0XHRjb25zdCBuZXdlc3QgPSBwcm9qZWN0Lm9jcy5kYXRhLmFzc2V0c1swXS52ZXJzaW9uc1swXS5pZFxuXHRcdGF3YWl0IGFwaS5kaXNwb3NlKClcblxuXHRcdC8vIEEgYnJvd3NlciB0aGF0IGhhcyBuZXZlciBiZWVuIGhlcmVcblx0XHRjb25zdCB2aXNpdG9yID0gYXdhaXQgYnJvd3Nlci5uZXdDb250ZXh0KHsgYmFzZVVSTDogQlJPV1NFUl9VUkwgfSlcblx0XHRjb25zdCByZXZpZXdlciA9IGF3YWl0IHZpc2l0b3IubmV3UGFnZSgpXG5cdFx0YXdhaXQgcmV2aWV3ZXIuZ290byhgL2FwcHMvZGVsaXZlci9zLyR7bGluay50b2tlbn0vdmVyc2lvbnMvJHtuZXdlc3R9YClcblx0XHQvLyBUaGUgbmFtZSBjb21lcyBmaXJzdCwgb3ZlciB0aGUgQ29tbWVudHM7IHdpdGggYW4gYWRkcmVzcyBjb21lIHRoZSBtYWlsIHdpc2hlc1xuXHRcdGF3YWl0IGV4cGVjdChyZXZpZXdlci5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50c19fZ2F0ZScpKS50b0JlVmlzaWJsZSgpXG5cdFx0YXdhaXQgcmV2aWV3ZXIubG9jYXRvcignI2RlbGl2ZXItcmV2aWV3ZXItbmFtZScpLmZpbGwoJ01hcmEnKVxuXHRcdGF3YWl0IHJldmlld2VyLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRzX19jbGFpbSBpbnB1dFt0eXBlPWVtYWlsXScpLmZpbGwoJ21hcmFAZXhhbXBsZS50ZXN0Jylcblx0XHRhd2FpdCByZXZpZXdlci5nZXRCeVRleHQoJ05ldyBWZXJzaW9ucycpLmNsaWNrKClcblx0XHRhd2FpdCByZXZpZXdlci5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1N0YXJ0IHJldmlld2luZycgfSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdChyZXZpZXdlci5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50c19fZ2F0ZScpKS50b0hhdmVDb3VudCgwKVxuXHRcdGF3YWl0IHJldmlld2VyLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnUmV2aWV3aW5nIGFzIE1hcmEnIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QocmV2aWV3ZXIuZ2V0QnlSb2xlKCdjaGVja2JveCcsIHsgbmFtZTogJ05ldyBWZXJzaW9ucycgfSkpLnRvQmVDaGVja2VkKClcblx0XHQvLyBUaGVpciBQZXJzb25hbCBMaW5rLCB0byBiZSBNYXJhIG9uIGFub3RoZXIgZGV2aWNlIChzdG9yeSAxMjgpXG5cdFx0YXdhaXQgcmV2aWV3ZXIuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdDb3B5IFBlcnNvbmFsIExpbmsnIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QocmV2aWV3ZXIuZ2V0QnlUZXh0KCdQZXJzb25hbCBMaW5rIGNvcGllZCcsIHsgZXhhY3Q6IHRydWUgfSkpLnRvQmVWaXNpYmxlKClcblx0XHRhd2FpdCByZXZpZXdlci5rZXlib2FyZC5wcmVzcygnRXNjYXBlJylcblx0XHRhd2FpdCByZXZpZXdlci5sb2NhdG9yKCcjZGVsaXZlci1jb21tZW50LWJvZHknKS5maWxsKCdmcm9tIHRoZSBjbGllbnQnKVxuXHRcdGF3YWl0IHJldmlld2VyLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRzX19mb3JtIGJ1dHRvblt0aXRsZT1cIlNlbmQgKEVudGVyKVwiXScpLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QocmV2aWV3ZXIubG9jYXRvcignLmRlbGl2ZXItY29tbWVudCcpLmZpbHRlcih7IGhhc1RleHQ6ICdmcm9tIHRoZSBjbGllbnQnIH0pKS50b0NvbnRhaW5UZXh0KCdNYXJhJylcblx0XHRhd2FpdCB2aXNpdG9yLmNsb3NlKClcblx0fSlcblxuXHR0ZXN0KCd0aGUgbmF2aWdhdGlvbiBsaXN0cyBhIGNvbGxlYWd1ZVxcJ3MgbGluayBhbmQgc2F5cyB3aG8gbWFkZSBpdCcsIGFzeW5jICh7IHBsYXl3cmlnaHQgfSkgPT4ge1xuXHRcdGNvbnN0IG1hdGUgPSBhd2FpdCBwbGF5d3JpZ2h0LnJlcXVlc3QubmV3Q29udGV4dCh7IGJhc2VVUkw6IFVSTCwgaHR0cENyZWRlbnRpYWxzOiB7IHVzZXJuYW1lOiBNQVRFLCBwYXNzd29yZDogTUFURV9QQVNTV09SRCwgc2VuZDogJ2Fsd2F5cycgfSwgZXh0cmFIVFRQSGVhZGVyczogb2NzSGVhZGVycyB9KVxuXHRcdC8vIFJlYWRpbmcgYW5kIHJlc2hhcmluZyBpbiBGaWxlcyBpcyBub3QgU2hhcmUgaW4gRGVsaXZlcjogdGhlIG93bmVyIHN3aXRjaGVzIGl0IG9uXG5cdFx0Y29uc3Qgb3duZXIgPSBhd2FpdCBwbGF5d3JpZ2h0LnJlcXVlc3QubmV3Q29udGV4dCh7IGJhc2VVUkw6IFVSTCwgaHR0cENyZWRlbnRpYWxzOiBhdXRoLCBleHRyYUhUVFBIZWFkZXJzOiBvY3NIZWFkZXJzIH0pXG5cdFx0Y29uc3QgbWVtYmVycyA9IGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3Byb2plY3RzLyR7cHJvamVjdElkfS9tZW1iZXJzP2Zvcm1hdD1qc29uYFxuXHRcdGV4cGVjdCgoYXdhaXQgbWF0ZS5wb3N0KGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3Byb2plY3RzLyR7cHJvamVjdElkfS9saW5rcz9mb3JtYXQ9anNvbmApKS5zdGF0dXMoKSkudG9CZSg0MDMpXG5cdFx0ZXhwZWN0KChhd2FpdCBvd25lci5wdXQobWVtYmVycywgeyBkYXRhOiB7IHR5cGU6ICd1c2VyJywgcHJpbmNpcGFsOiBNQVRFLCBsZXZlbDogJ2NvbW1lbnQnLCBzaGFyZTogdHJ1ZSwgYXBwcm92ZTogZmFsc2UgfSB9KSkuc3RhdHVzKCkpLnRvQmUoMjAwKVxuXHRcdGNvbnN0IG1hZGUgPSBhd2FpdCBtYXRlLnBvc3QoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHMvJHtwcm9qZWN0SWR9L2xpbmtzP2Zvcm1hdD1qc29uYCwgeyBkYXRhOiB7IGxhYmVsOiAnQ29sbGVhZ3VlIGxpbmsnIH0gfSlcblx0XHRleHBlY3QobWFkZS5zdGF0dXMoKSkudG9CZSgyMDEpXG5cdFx0Y29uc3QgbGluayA9IChhd2FpdCBtYWRlLmpzb24oKSkub2NzLmRhdGFcblx0XHRhd2FpdCBtYXRlLnB1dChgL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS9saW5rcy8ke2xpbmsuaWR9P2Zvcm1hdD1qc29uYCwgeyBkYXRhOiB7IGxhYmVsOiAnTWFyYVxcJ3MgbGluaycgfSB9KVxuXHRcdHRyeSB7XG5cdFx0XHRhd2FpdCBwYWdlLmdvdG8oYC9hcHBzL2RlbGl2ZXIvcHJvamVjdHMvJHtwcm9qZWN0SWR9YClcblx0XHRcdGNvbnN0IHRoZWlycyA9IHBhZ2UubG9jYXRvcignLmFwcC1uYXZpZ2F0aW9uIGxpJykuZmlsdGVyKHsgaGFzVGV4dDogJ01hcmFcXCdzIGxpbmsnIH0pLmZpcnN0KClcblx0XHRcdGF3YWl0IGV4cGVjdCh0aGVpcnMpLnRvQ29udGFpblRleHQoJ01hZGUgYnkgTWFyYSBNYXRlJylcblx0XHRcdC8vIFRoZWlyIGxpbmssIHRob3VnaCwgaXMgbm90IG1hcmtlZCBhcyBtYWRlIGJ5IHNvbWVvbmUgZWxzZVxuXHRcdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuYXBwLW5hdmlnYXRpb24nKS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ0NyZWF0ZSBSZXZpZXcgTGluaycgfSkuY2xpY2soKVxuXHRcdFx0YXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKCdkaWFsb2cnKSkudG9CZVZpc2libGUoKVxuXHRcdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnRXNjYXBlJylcblx0XHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5hcHAtbmF2aWdhdGlvbicpLmdldEJ5VGV4dCgnTWFkZSBieSBkZWxpdmVyLWUyZScsIHsgZXhhY3Q6IHRydWUgfSkpLnRvSGF2ZUNvdW50KDApXG5cdFx0fSBmaW5hbGx5IHtcblx0XHRcdGF3YWl0IG1hdGUuZGVsZXRlKGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL2xpbmtzLyR7bGluay5pZH0/Zm9ybWF0PWpzb25gKVxuXHRcdFx0YXdhaXQgb3duZXIuZGVsZXRlKG1lbWJlcnMgKyBgJnR5cGU9dXNlciZwcmluY2lwYWw9JHtNQVRFfWApXG5cdFx0XHRhd2FpdCBtYXRlLmRpc3Bvc2UoKVxuXHRcdFx0YXdhaXQgb3duZXIuZGlzcG9zZSgpXG5cdFx0fVxuXHR9KVxuXG5cdHRlc3QoJ3RoZSBQcm9qZWN0IHNldHRpbmdzIGxpc3QgdGhlIE1lbWJlcnMgYW5kIHNldCB3aGF0IGVhY2ggbWF5IGRvJywgYXN5bmMgKHsgcGxheXdyaWdodCB9KSA9PiB7XG5cdFx0Y29uc3Qgb3duZXIgPSBhd2FpdCBwbGF5d3JpZ2h0LnJlcXVlc3QubmV3Q29udGV4dCh7IGJhc2VVUkw6IFVSTCwgaHR0cENyZWRlbnRpYWxzOiBhdXRoLCBleHRyYUhUVFBIZWFkZXJzOiBvY3NIZWFkZXJzIH0pXG5cdFx0Y29uc3QgYXBpID0gYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHMvJHtwcm9qZWN0SWR9YFxuXHRcdGNvbnN0IGxpc3RlZCA9IGFzeW5jICgpID0+IChhd2FpdCAoYXdhaXQgb3duZXIuZ2V0KGAke2FwaX0vbWVtYmVycz9mb3JtYXQ9anNvbmApKS5qc29uKCkpLm9jcy5kYXRhLmZpbmQoKGVhY2gpID0+IGVhY2guaWQgPT09IE1BVEUpXG5cdFx0dHJ5IHtcblx0XHRcdGF3YWl0IHBhZ2UuZ290byhgL2FwcHMvZGVsaXZlci9wcm9qZWN0cy8ke3Byb2plY3RJZH1gKVxuXHRcdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1Byb2plY3Qgc2V0dGluZ3MnIH0pLmNsaWNrKClcblx0XHRcdGNvbnN0IGRpYWxvZyA9IHBhZ2UuZ2V0QnlSb2xlKCdkaWFsb2cnKVxuXHRcdFx0Y29uc3QgbWF0ZSA9IGRpYWxvZy5sb2NhdG9yKCcuZGVsaXZlci1tZW1iZXJzX19yb3cnLCB7IGhhc1RleHQ6ICdNYXJhIE1hdGUnIH0pXG5cdFx0XHRjb25zdCBsZXZlbCA9IG1hdGUuZ2V0QnlMYWJlbCgnQWNjZXNzIGxldmVsIG9mIE1hcmEgTWF0ZScpXG5cdFx0XHQvLyBSZWFkIGFjY2VzcyBpbiBGaWxlcyBnaXZlcyBDb21tZW50LCBhbmQgbm8gQXBwcm92ZVxuXHRcdFx0YXdhaXQgZXhwZWN0KGxldmVsKS50b0hhdmVWYWx1ZSgnY29tbWVudCcpXG5cdFx0XHRhd2FpdCBleHBlY3QobWF0ZS5nZXRCeVJvbGUoJ2NoZWNrYm94JywgeyBuYW1lOiAnQXBwcm92ZScgfSkpLm5vdC50b0JlQ2hlY2tlZCgpXG5cblx0XHRcdGF3YWl0IG1hdGUuZ2V0QnlUZXh0KCdBcHByb3ZlJywgeyBleGFjdDogdHJ1ZSB9KS5jbGljaygpXG5cdFx0XHRhd2FpdCBleHBlY3QucG9sbChhc3luYyAoKSA9PiAoYXdhaXQgbGlzdGVkKCkpLnN0b3JlZCkudG9FcXVhbCh7IGxldmVsOiAnY29tbWVudCcsIHNoYXJlOiBmYWxzZSwgYXBwcm92ZTogdHJ1ZSB9KVxuXHRcdFx0YXdhaXQgbGV2ZWwuc2VsZWN0T3B0aW9uKCd2aWV3Jylcblx0XHRcdC8vIEEgVmlldyBjYW5ub3QgYXBwcm92ZSwgc28gdGhlIHN3aXRjaCBnb2VzIG9mZiBhbmQgaXMgZml4ZWRcblx0XHRcdGF3YWl0IGV4cGVjdC5wb2xsKGFzeW5jICgpID0+IChhd2FpdCBsaXN0ZWQoKSkuc3RvcmVkKS50b0VxdWFsKHsgbGV2ZWw6ICd2aWV3Jywgc2hhcmU6IGZhbHNlLCBhcHByb3ZlOiBmYWxzZSB9KVxuXHRcdFx0YXdhaXQgZXhwZWN0KG1hdGUuZ2V0QnlSb2xlKCdjaGVja2JveCcsIHsgbmFtZTogJ0FwcHJvdmUnIH0pKS50b0JlRGlzYWJsZWQoKVxuXG5cdFx0XHQvLyBUaGUgb3duZXIgaXMgbWFya2VkIGFuZCBjYW5ub3QgYmUgbG93ZXJlZFxuXHRcdFx0Y29uc3QgbWUgPSBkaWFsb2cubG9jYXRvcignLmRlbGl2ZXItbWVtYmVyc19fcm93JywgeyBoYXNUZXh0OiBVU0VSIH0pXG5cdFx0XHRhd2FpdCBleHBlY3QobWUpLnRvQ29udGFpblRleHQoJ093bmVyJylcblx0XHRcdGF3YWl0IGV4cGVjdChtZS5nZXRCeUxhYmVsKGBBY2Nlc3MgbGV2ZWwgb2YgJHtVU0VSfWApKS50b0JlRGlzYWJsZWQoKVxuXG5cdFx0XHQvLyBCYWNrIHRvIHdoYXQgRmlsZXMgZ2l2ZXNcblx0XHRcdGF3YWl0IG1hdGUuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdSZXNldCcgfSkuY2xpY2soKVxuXHRcdFx0YXdhaXQgZXhwZWN0KGxldmVsKS50b0hhdmVWYWx1ZSgnY29tbWVudCcpXG5cdFx0XHRleHBlY3QoKGF3YWl0IGxpc3RlZCgpKS5zdG9yZWQpLnRvQmVOdWxsKClcblxuXHRcdFx0Ly8gV2hhdCBzb21lb25lIG5ld2x5IGdpdmVuIGFjY2VzcyBpbiBGaWxlcyBzdGFydHMgd2l0aFxuXHRcdFx0YXdhaXQgZGlhbG9nLmdldEJ5TGFiZWwoJ1NvbWVvbmUgbmV3bHkgZ2l2ZW4gYWNjZXNzIGluIEZpbGVzIHN0YXJ0cyB3aXRoJykuc2VsZWN0T3B0aW9uKCd2aWV3Jylcblx0XHRcdGF3YWl0IGV4cGVjdC5wb2xsKGFzeW5jICgpID0+IChhd2FpdCAoYXdhaXQgb3duZXIuZ2V0KGAke2FwaX0/Zm9ybWF0PWpzb25gKSkuanNvbigpKS5vY3MuZGF0YS5uZXdjb21lcnMpLnRvQmUoJ3ZpZXcnKVxuXHRcdFx0Ly8gRXZlcnlvbmUgd2hvIHdhcyBhIE1lbWJlciBrZWVwcyB3aGF0IEZpbGVzIGdpdmVzLCB3aXRoIG5vIGVudHJ5IG1hZGUgZm9yIHRoZW1cblx0XHRcdGV4cGVjdChhd2FpdCBsaXN0ZWQoKSkudG9NYXRjaE9iamVjdCh7IGxldmVsOiAnY29tbWVudCcsIHN0b3JlZDogbnVsbCB9KVxuXHRcdH0gZmluYWxseSB7XG5cdFx0XHRhd2FpdCBvd25lci5wdXQoYCR7YXBpfT9mb3JtYXQ9anNvbmAsIHsgZGF0YTogeyBuZXdjb21lcnM6ICdmaWxlcycgfSB9KVxuXHRcdFx0YXdhaXQgb3duZXIuZGVsZXRlKGAke2FwaX0vbWVtYmVycz9mb3JtYXQ9anNvbiZ0eXBlPXVzZXImcHJpbmNpcGFsPSR7TUFURX1gKVxuXHRcdFx0YXdhaXQgb3duZXIuZGlzcG9zZSgpXG5cdFx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdFc2NhcGUnKS5jYXRjaCgoKSA9PiB7fSlcblx0XHR9XG5cdH0pXG5cblx0dGVzdCgnYSBNZW1iZXIgaW52aXRlcyBzb21lb25lIGZyb20gdGhlaXIgY29udGFjdHMgb24gYSBsaW5rIG9mIHRoZWlyIG93bicsIGFzeW5jICh7IHBsYXl3cmlnaHQgfSkgPT4ge1xuXHRcdGNvbnN0IGFwaSA9IGF3YWl0IHBsYXl3cmlnaHQucmVxdWVzdC5uZXdDb250ZXh0KHsgYmFzZVVSTDogVVJMLCBodHRwQ3JlZGVudGlhbHM6IGF1dGgsIGV4dHJhSFRUUEhlYWRlcnM6IG9jc0hlYWRlcnMgfSlcblx0XHQvLyBUaGUgdGVzdCB1c2VyIGtlZXBzIHRoZWlyIGFkZHJlc3MgYm9vayBiZXR3ZWVuIHJ1bnM6IGEgbmFtZSBvZiB0aGlzIHJ1bidzIG93blxuXHRcdGNvbnN0IHJ1biA9IHJhbmRvbUJ5dGVzKDMpLnRvU3RyaW5nKCdoZXgnKVxuXHRcdGNvbnN0IHpvZU5hbWUgPSBgWm9lIFF1aWxsICR7cnVufWBcblx0XHRjb25zdCB1aWQgPSBgZGVsaXZlci1lMmUtJHtydW59YFxuXHRcdGNvbnN0IGNhcmQgPSBgL3JlbW90ZS5waHAvZGF2L2FkZHJlc3Nib29rcy91c2Vycy8ke1VTRVJ9L2NvbnRhY3RzLyR7dWlkfS52Y2ZgXG5cdFx0Y29uc3QgdmNhcmQgPSBgQkVHSU46VkNBUkRcXHJcXG5WRVJTSU9OOjMuMFxcclxcblVJRDoke3VpZH1cXHJcXG5GTjoke3pvZU5hbWV9XFxyXFxuYFxuXHRcdFx0KyAnRU1BSUw7VFlQRT1XT1JLOnpvZUBzdHVkaW8udGVzdFxcclxcbkVNQUlMO1RZUEU9SE9NRTp6b2VAaG9tZS50ZXN0XFxyXFxuRU5EOlZDQVJEXFxyXFxuJ1xuXHRcdGV4cGVjdCgoYXdhaXQgYXBpLmZldGNoKGNhcmQsIHsgbWV0aG9kOiAnUFVUJywgZGF0YTogdmNhcmQsIGhlYWRlcnM6IHsgJ0NvbnRlbnQtVHlwZSc6ICd0ZXh0L3ZjYXJkJyB9IH0pKS5zdGF0dXMoKSkudG9CZSgyMDEpXG5cdFx0Ly8gQSBsaW5rIG9mIHRoZSBQcm9qZWN0IHRvIHB1dCBab2Ugb24gbGF0ZXJcblx0XHRhd2FpdCBhcGkucG9zdChgL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS9wcm9qZWN0cy8ke3Byb2plY3RJZH0vbGlua3M/Zm9ybWF0PWpzb25gKVxuXG5cdFx0dHJ5IHtcblx0XHRcdGF3YWl0IHBhZ2UuZ290byhgL2FwcHMvZGVsaXZlci9wcm9qZWN0cy8ke3Byb2plY3RJZH1gKVxuXHRcdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuYXBwLW5hdmlnYXRpb24nKS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ0ludml0ZSBhIFJldmlld2VyJyB9KS5jbGljaygpXG5cdFx0XHRjb25zdCBkaWFsb2cgPSBwYWdlLmdldEJ5Um9sZSgnZGlhbG9nJywgeyBuYW1lOiAnSW52aXRlIGEgUmV2aWV3ZXInIH0pXG5cdFx0XHRjb25zdCBuYW1lID0gZGlhbG9nLmdldEJ5Um9sZSgnY29tYm9ib3gnLCB7IG5hbWU6ICdOYW1lJyB9KVxuXHRcdFx0YXdhaXQgbmFtZS5wcmVzc1NlcXVlbnRpYWxseShydW4pXG5cdFx0XHQvLyBPbmUgcm93IHBlciBhZGRyZXNzOyB0aGUgYXJyb3cga2V5cyBtb3ZlLCBFbnRlciBwaWNrc1xuXHRcdFx0YXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKCdvcHRpb24nKSkudG9IYXZlQ291bnQoMilcblx0XHRcdGF3YWl0IG5hbWUucHJlc3MoJ0Fycm93RG93bicpXG5cdFx0XHRhd2FpdCBuYW1lLnByZXNzKCdFbnRlcicpXG5cdFx0XHRhd2FpdCBleHBlY3QocGFnZS5nZXRCeVJvbGUoJ2xpc3Rib3gnKSkudG9IYXZlQ291bnQoMClcblx0XHRcdGF3YWl0IGV4cGVjdChuYW1lKS50b0hhdmVWYWx1ZSh6b2VOYW1lKVxuXHRcdFx0YXdhaXQgZXhwZWN0KGRpYWxvZy5nZXRCeUxhYmVsKCdFbWFpbCAob3B0aW9uYWwpJykpLnRvSGF2ZVZhbHVlKCd6b2VAaG9tZS50ZXN0Jylcblx0XHRcdGF3YWl0IGRpYWxvZy5nZXRCeVRleHQoJ1Jldmlld2VycyBtYXkgZG93bmxvYWQgdGhlIG9yaWdpbmFsJykuY2xpY2soKVxuXHRcdFx0YXdhaXQgZGlhbG9nLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnSW52aXRlJywgZXhhY3Q6IHRydWUgfSkuY2xpY2soKVxuXHRcdFx0YXdhaXQgZXhwZWN0KGRpYWxvZykudG9IYXZlQ291bnQoMClcblxuXHRcdFx0Ly8gQSBsaW5rIG9mIHRoZWlyIG93biwgdGl0bGVkIGJ5IHdoYXQgaXQgc2hvd3MsIHdpdGggdGhlbSB1bmRlciBpdFxuXHRcdFx0Y29uc3QgbGlzdGVkID0gYXdhaXQgKGF3YWl0IGFwaS5nZXQoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHMvJHtwcm9qZWN0SWR9L2xpbmtzP2Zvcm1hdD1qc29uYCkpLmpzb24oKVxuXHRcdFx0Y29uc3Qgem9lSWQgPSBsaXN0ZWQub2NzLmRhdGEucmV2aWV3ZXJzLmZpbmQoKGVhY2gpID0+IGVhY2gubmFtZSA9PT0gem9lTmFtZSkuaWRcblx0XHRcdGNvbnN0IHRoZWlycyA9IGxpc3RlZC5vY3MuZGF0YS5saW5rcy5maW5kKChsaW5rKSA9PiBsaW5rLnJldmlld2VySWRzLmluY2x1ZGVzKHpvZUlkKSlcblx0XHRcdGV4cGVjdChbdGhlaXJzLnJldmlld2VySWRzLCB0aGVpcnMuYXNzZXRJZHMsIHRoZWlycy5jYW5Eb3dubG9hZF0pLnRvRXF1YWwoW1t6b2VJZF0sIG51bGwsIGZhbHNlXSlcblxuXHRcdFx0Ly8gQWxyZWFkeSBhIGNvbnRhY3Q6IG5vdGhpbmcgdG8gc2F2ZVxuXHRcdFx0Y29uc3Qgem9lID0gcGFnZS5sb2NhdG9yKCcuYXBwLW5hdmlnYXRpb24gbGknKS5maWx0ZXIoeyBoYXNUZXh0OiB6b2VOYW1lIH0pLmxhc3QoKVxuXHRcdFx0YXdhaXQgem9lLmhvdmVyKClcblx0XHRcdGF3YWl0IHpvZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ0FjdGlvbnMnIH0pLmNsaWNrKClcblx0XHRcdGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5Um9sZSgnbWVudWl0ZW0nLCB7IG5hbWU6ICdJbiB5b3VyIGNvbnRhY3RzJyB9KSkudG9CZURpc2FibGVkKClcblx0XHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ0VzY2FwZScpXG5cblx0XHRcdC8vIFJpZ2h0cyBvZiB0aGVpciBvd24gb24gdGhhdCBsaW5rLCBmcm9tIHRoZSBnZWFyIGF0IGl0IGluIHRoZWlyIGRpYWxvZyAoQURSIDAwMTQpXG5cdFx0XHRhd2FpdCB6b2UuZ2V0QnlUZXh0KHpvZU5hbWUpLmNsaWNrKClcblx0XHRcdGNvbnN0IHBlcnNvbiA9IHBhZ2UuZ2V0QnlSb2xlKCdkaWFsb2cnLCB7IG5hbWU6IHpvZU5hbWUgfSlcblx0XHRcdGF3YWl0IHBlcnNvbi5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogYFJpZ2h0cyBvZiAke3pvZU5hbWV9IG9uIHRoaXMgbGlua2AgfSkuY2xpY2soKVxuXHRcdFx0Y29uc3QgcmlnaHRzID0gcGFnZS5nZXRCeVJvbGUoJ2RpYWxvZycsIHsgbmFtZTogYCR7em9lTmFtZX0gb24g4oCcV2hvbGUgUHJvamVjdOKAnWAgfSlcblx0XHRcdGF3YWl0IHJpZ2h0cy5nZXRCeVJvbGUoJ3JhZGlvZ3JvdXAnLCB7IG5hbWU6ICdDb21tZW50JywgZXhhY3Q6IHRydWUgfSkuZ2V0QnlUZXh0KCdObycsIHsgZXhhY3Q6IHRydWUgfSkuY2xpY2soKVxuXHRcdFx0YXdhaXQgZXhwZWN0LnBvbGwoYXN5bmMgKCkgPT4ge1xuXHRcdFx0XHRjb25zdCBub3cgPSBhd2FpdCAoYXdhaXQgYXBpLmdldChgL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS9wcm9qZWN0cy8ke3Byb2plY3RJZH0vbGlua3M/Zm9ybWF0PWpzb25gKSkuanNvbigpXG5cdFx0XHRcdHJldHVybiBub3cub2NzLmRhdGEucmV2aWV3ZXJzLmZpbmQoKGVhY2gpID0+IGVhY2guaWQgPT09IHpvZUlkKS5saW5rcy5maW5kKChlYWNoKSA9PiBlYWNoLnRva2VuID09PSB0aGVpcnMudG9rZW4pLnJpZ2h0cy5jYW5Db21tZW50XG5cdFx0XHR9KS50b0JlKGZhbHNlKVxuXHRcdFx0Ly8gT25lIGRpYWxvZyBhdCBhIHRpbWUsIGJ5IGl0cyBvd24gY2xvc2UgYnV0dG9uXG5cdFx0XHRhd2FpdCByaWdodHMuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdDbG9zZScgfSkuY2xpY2soKVxuXHRcdFx0YXdhaXQgZXhwZWN0KHJpZ2h0cykudG9IYXZlQ291bnQoMClcblx0XHRcdGF3YWl0IHBlcnNvbi5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ0Nsb3NlJyB9KS5jbGljaygpXG5cdFx0XHRhd2FpdCBleHBlY3QocGVyc29uKS50b0hhdmVDb3VudCgwKVxuXG5cdFx0XHQvLyBVbmRlciB0aGUgbGluaywgYSBjbGljayBvcGVucyB0aGVpciByaWdodHMgb24gdGhhdCB2ZXJ5IGxpbmtcblx0XHRcdGF3YWl0IHBhZ2UubG9jYXRvcignLmFwcC1uYXZpZ2F0aW9uJykuZ2V0QnlUZXh0KHpvZU5hbWUpLmZpcnN0KCkuY2xpY2soKVxuXHRcdFx0Y29uc3QgbmVzdGVkID0gcGFnZS5nZXRCeVJvbGUoJ2RpYWxvZycsIHsgbmFtZTogYCR7em9lTmFtZX0gb24g4oCcV2hvbGUgUHJvamVjdOKAnWAgfSlcblx0XHRcdGF3YWl0IGV4cGVjdChuZXN0ZWQpLnRvQmVWaXNpYmxlKClcblx0XHRcdGF3YWl0IG5lc3RlZC5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ0Nsb3NlJyB9KS5jbGljaygpXG5cdFx0XHRhd2FpdCBleHBlY3QobmVzdGVkKS50b0hhdmVDb3VudCgwKVxuXG5cdFx0XHQvLyBQdXQgb24gYW5vdGhlciBsaW5rIG9mIHRoZSBQcm9qZWN0IGZyb20gdGhlaXIgZGlhbG9nLCB3aXRoIGEgUGVyc29uYWwgTGluayBvZiBpdHMgb3duIChzdG9yeSA1NSlcblx0XHRcdGNvbnN0IHpvZUxpbmtzID0gYXN5bmMgKCkgPT4ge1xuXHRcdFx0XHRjb25zdCBub3cgPSBhd2FpdCAoYXdhaXQgYXBpLmdldChgL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS9wcm9qZWN0cy8ke3Byb2plY3RJZH0vbGlua3M/Zm9ybWF0PWpzb25gKSkuanNvbigpXG5cdFx0XHRcdHJldHVybiBub3cub2NzLmRhdGEucmV2aWV3ZXJzLmZpbmQoKGVhY2gpID0+IGVhY2guaWQgPT09IHpvZUlkKS5saW5rcy5tYXAoKGVhY2gpID0+IGVhY2gudG9rZW4pXG5cdFx0XHR9XG5cdFx0XHRhd2FpdCB6b2UuZ2V0QnlUZXh0KHpvZU5hbWUpLmNsaWNrKClcblx0XHRcdGNvbnN0IGFnYWluID0gcGFnZS5nZXRCeVJvbGUoJ2RpYWxvZycsIHsgbmFtZTogem9lTmFtZSB9KVxuXHRcdFx0YXdhaXQgZXhwZWN0KGFnYWluLmdldEJ5TGFiZWwoJ05hbWUnLCB7IGV4YWN0OiB0cnVlIH0pKS50b0JlRm9jdXNlZCgpXG5cdFx0XHRhd2FpdCBhZ2Fpbi5nZXRCeVJvbGUoJ2NvbWJvYm94JywgeyBuYW1lOiAnUHV0IG9uIGFub3RoZXIgUmV2aWV3IExpbmsnIH0pLmNsaWNrKClcblx0XHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdvcHRpb24nKS5maXJzdCgpLmNsaWNrKClcblx0XHRcdGF3YWl0IGV4cGVjdC5wb2xsKGFzeW5jICgpID0+IChhd2FpdCB6b2VMaW5rcygpKS5sZW5ndGgpLnRvQmUoMilcblx0XHRcdGF3YWl0IGFnYWluLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnQ2xvc2UnIH0pLmNsaWNrKClcblx0XHRcdGF3YWl0IGV4cGVjdChhZ2FpbikudG9IYXZlQ291bnQoMClcblxuXHRcdFx0Ly8gQW5kIHRha2VuIG9mZiB0aGF0IG9uZSBpbiBpdHMgc2V0dGluZ3M7IHRoZSBsaW5rIG9mIHRoZWlyIG93biBzdGF5c1xuXHRcdFx0Y29uc3Qgb3RoZXIgPSAoYXdhaXQgem9lTGlua3MoKSkuZmluZCgodG9rZW4pID0+IHRva2VuICE9PSB0aGVpcnMudG9rZW4pXG5cdFx0XHRjb25zdCBsaW5rSXRlbSA9IHBhZ2UubG9jYXRvcignLmFwcC1uYXZpZ2F0aW9uIGxpJykuZmlsdGVyKHsgaGFzOiBwYWdlLmxvY2F0b3IoJ3VsIGxpJywgeyBoYXNUZXh0OiB6b2VOYW1lIH0pIH0pLmZpcnN0KClcblx0XHRcdGF3YWl0IGxpbmtJdGVtLmxvY2F0b3IoJy5hcHAtbmF2aWdhdGlvbi1lbnRyeV9fbmFtZScpLmZpcnN0KCkuY2xpY2soKVxuXHRcdFx0Y29uc3Qgc2V0dGluZ3MgPSBwYWdlLmdldEJ5Um9sZSgnZGlhbG9nJykuZmlyc3QoKVxuXHRcdFx0YXdhaXQgc2V0dGluZ3MubG9jYXRvcignLmRlbGl2ZXItbGlua19fcmV2aWV3ZXInKS5maWx0ZXIoeyBoYXNUZXh0OiB6b2VOYW1lIH0pLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiBgVGFrZSAke3pvZU5hbWV9IG9mZiB0aGlzIGxpbmtgIH0pLmNsaWNrKClcblx0XHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdUYWtlIG9mZicgfSkuY2xpY2soKVxuXHRcdFx0YXdhaXQgZXhwZWN0LnBvbGwoem9lTGlua3MpLnRvRXF1YWwoW3RoZWlycy50b2tlbl0pXG5cdFx0XHRleHBlY3Qob3RoZXIpLm5vdC50b0JlKHRoZWlycy50b2tlbilcblx0XHR9IGZpbmFsbHkge1xuXHRcdFx0Y29uc3QgY2xlYW51cCA9IGF3YWl0IHBsYXl3cmlnaHQucmVxdWVzdC5uZXdDb250ZXh0KHsgYmFzZVVSTDogVVJMLCBodHRwQ3JlZGVudGlhbHM6IGF1dGggfSlcblx0XHRcdGF3YWl0IGNsZWFudXAuZmV0Y2goY2FyZCwgeyBtZXRob2Q6ICdERUxFVEUnIH0pXG5cdFx0XHRhd2FpdCBjbGVhbnVwLmRpc3Bvc2UoKVxuXHRcdFx0YXdhaXQgYXBpLmRpc3Bvc2UoKVxuXHRcdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnRXNjYXBlJykuY2F0Y2goKCkgPT4ge30pXG5cdFx0fVxuXHR9KVxuXG5cdHRlc3QoJ2EgZmlsZSB3aXRoIENvbW1lbnRzIGlzIGxvY2tlZCwgYW5kIGFuIG92ZXJ3cml0ZSB3aXRob3V0IHRoZSBsb2NrIG1hcmtzIHRoZW0nLCBhc3luYyAoeyBwbGF5d3JpZ2h0IH0pID0+IHtcblx0XHRjb25zdCBhcGkgPSBhd2FpdCBwbGF5d3JpZ2h0LnJlcXVlc3QubmV3Q29udGV4dCh7IGJhc2VVUkw6IFVSTCwgaHR0cENyZWRlbnRpYWxzOiBhdXRoLCBleHRyYUhUVFBIZWFkZXJzOiBvY3NIZWFkZXJzIH0pXG5cdFx0Y29uc3QgbG9jayA9IChsb2NrRmlsZXMpID0+IGFwaS5wdXQoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHMvJHtwcm9qZWN0SWR9P2Zvcm1hdD1qc29uYCwgeyBkYXRhOiB7IGxvY2tGaWxlcyB9IH0pXG5cdFx0Y29uc3QgY2xpcCA9IGAvcmVtb3RlLnBocC9kYXYvZmlsZXMvJHtVU0VSfS8ke2ZvbGRlcn0vb3ZlcndyaXRlLndlYm1gXG5cdFx0dHJ5IHtcblx0XHRcdC8vIEEgZmlsZSBvZiBpdHMgb3duLCBhcyB0aGUgVmVyc2lvbnMgb2YgdGhlIHRlc3RzIGJlZm9yZSBhcmUgbm8gbG9uZ2VyIHRoZSBuZXdlc3Rcblx0XHRcdGV4cGVjdCgoYXdhaXQgYXBpLmZldGNoKGNsaXAsIHsgbWV0aG9kOiAnUFVUJywgZGF0YTogcmVhZEZpbGVTeW5jKENMSVApIH0pKS5zdGF0dXMoKSkudG9CZSgyMDEpXG5cdFx0XHRjb25zdCBwcm9qZWN0ID0gYXdhaXQgYXBpLmdldChgL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS9wcm9qZWN0cy8ke3Byb2plY3RJZH0/Zm9ybWF0PWpzb25gKVxuXHRcdFx0Y29uc3QgbWluZSA9IChhd2FpdCBwcm9qZWN0Lmpzb24oKSkub2NzLmRhdGEuYXNzZXRzLmZpbmQoKGFzc2V0KSA9PiBhc3NldC52ZXJzaW9uc1swXS5uYW1lID09PSAnb3ZlcndyaXRlLndlYm0nKS52ZXJzaW9uc1swXS5pZFxuXG5cdFx0XHQvLyBBIENvbW1lbnQgbG9ja3MgdGhlIGZpbGUgYWdhaW5zdCBhIHN5bmMgY2xpZW50XG5cdFx0XHRjb25zdCBjb21tZW50ZWQgPSBhd2FpdCBhcGkucG9zdChgL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS92ZXJzaW9ucy8ke21pbmV9L2NvbW1lbnRzP2Zvcm1hdD1qc29uYCwgeyBkYXRhOiB7IGluRnJhbWU6IDEsIGJvZHk6ICdsb2NrIG1lJyB9IH0pXG5cdFx0XHRleHBlY3QoY29tbWVudGVkLnN0YXR1cygpLCBhd2FpdCBjb21tZW50ZWQudGV4dCgpKS50b0JlKDIwMSlcblx0XHRcdGV4cGVjdCgoYXdhaXQgYXBpLmZldGNoKGNsaXAsIHsgbWV0aG9kOiAnUFVUJywgZGF0YTogcmVhZEZpbGVTeW5jKENMSVApIH0pKS5zdGF0dXMoKSkudG9CZSg0MjMpXG5cblx0XHRcdC8vIFRoZSBzd2l0Y2ggaXMgaW4gdGhlIFByb2plY3Qgc2V0dGluZ3MsIGFuZCBvZmYgZnJlZXMgdGhlIGZpbGVcblx0XHRcdGF3YWl0IHBhZ2UuZ290byhgL2FwcHMvZGVsaXZlci9wcm9qZWN0cy8ke3Byb2plY3RJZH1gKVxuXHRcdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1Byb2plY3Qgc2V0dGluZ3MnIH0pLmNsaWNrKClcblx0XHRcdGNvbnN0IHNldHRpbmdzID0gcGFnZS5nZXRCeVJvbGUoJ2RpYWxvZycsIHsgbmFtZTogL15TZXR0aW5ncyBvZi8gfSlcblx0XHRcdGF3YWl0IHNldHRpbmdzLmdldEJ5VGV4dCgnUHJvdGVjdCBmaWxlcyB3aXRoIENvbW1lbnRzIGFnYWluc3QgZGVsZXRpbmcgYW5kIHJlbmFtaW5nJykuY2xpY2soKVxuXHRcdFx0YXdhaXQgZXhwZWN0LnBvbGwoYXN5bmMgKCkgPT4gKGF3YWl0IGFwaS5mZXRjaChjbGlwLCB7IG1ldGhvZDogJ1BVVCcsIGRhdGE6IHJlYWRGaWxlU3luYyhDTElQKSB9KSkuc3RhdHVzKCkpLnRvQmUoMjA0KVxuXHRcdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnRXNjYXBlJylcblxuXHRcdFx0YXdhaXQgcGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL3ZlcnNpb25zLyR7bWluZX1gKVxuXHRcdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tbWVudF9fb3ZlcndyaXR0ZW4nKS5maXJzdCgpKS50b0NvbnRhaW5UZXh0KCdiZWZvcmUgdGhlIG92ZXJ3cml0ZSBvbicpXG5cdFx0fSBmaW5hbGx5IHtcblx0XHRcdGF3YWl0IGxvY2sodHJ1ZSlcblx0XHRcdGF3YWl0IGFwaS5kaXNwb3NlKClcblx0XHR9XG5cdH0pXG5cblx0dGVzdCgnQ2FwdGlvbnMgYXJlIGFkZGVkIG9uIHRoZSBBc3NldCBjYXJkIGFuZCB0dXJuZWQgb24gdW5kZXIgdGhlIENDIGJ1dHRvbicsIGFzeW5jICh7IHBsYXl3cmlnaHQgfSkgPT4ge1xuXHRcdGNvbnN0IGFwaSA9IGF3YWl0IHBsYXl3cmlnaHQucmVxdWVzdC5uZXdDb250ZXh0KHsgYmFzZVVSTDogVVJMLCBodHRwQ3JlZGVudGlhbHM6IGF1dGgsIGV4dHJhSFRUUEhlYWRlcnM6IG9jc0hlYWRlcnMgfSlcblx0XHRleHBlY3QoKGF3YWl0IGFwaS5mZXRjaChgL3JlbW90ZS5waHAvZGF2L2ZpbGVzLyR7VVNFUn0vJHtmb2xkZXJ9L2NhcHRpb25lZC53ZWJtYCwgeyBtZXRob2Q6ICdQVVQnLCBkYXRhOiByZWFkRmlsZVN5bmMoQ0xJUCkgfSkpLnN0YXR1cygpKS50b0JlKDIwMSlcblx0XHRhd2FpdCBhcGkuZGlzcG9zZSgpXG5cblx0XHRhd2FpdCBwYWdlLmdvdG8oYC9hcHBzL2RlbGl2ZXIvcHJvamVjdHMvJHtwcm9qZWN0SWR9YClcblx0XHRhd2FpdCBjYXJkKHBhZ2UsICdjYXB0aW9uZWQnKS5jbGljayh7IGJ1dHRvbjogJ3JpZ2h0JyB9KVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdtZW51aXRlbScsIHsgbmFtZTogJ0FkZCBDYXB0aW9uc+KApicgfSkuY2xpY2soKVxuXHRcdGNvbnN0IGRpYWxvZyA9IHBhZ2UuZ2V0QnlSb2xlKCdkaWFsb2cnLCB7IG5hbWU6ICdDYXB0aW9ucycgfSlcblx0XHQvLyBUaGUgbGFuZ3VhZ2UgY29tZXMgZnJvbSB0aGUgZmlsZSBuYW1lXG5cdFx0YXdhaXQgZGlhbG9nLmxvY2F0b3IoJ2lucHV0W3R5cGU9ZmlsZV0nKS5zZXRJbnB1dEZpbGVzKHsgbmFtZTogJ2NhcHRpb25lZC5kZS5zcnQnLCBtaW1lVHlwZTogJ2FwcGxpY2F0aW9uL3gtc3VicmlwJywgYnVmZmVyOiBCdWZmZXIuZnJvbSgnMVxcbjAwOjAwOjAwLDAwMCAtLT4gMDA6MDA6MDMsMDAwXFxuSGFsbG9cXG4nKSB9KVxuXHRcdGF3YWl0IGV4cGVjdChkaWFsb2cubG9jYXRvcignLnZzX19zZWxlY3RlZCcpKS50b0hhdmVUZXh0KCdHZXJtYW4nKVxuXHRcdC8vIEZvY3VzIHN0YXlzIGluIHRoZSBmaWxlIGZpZWxkLCBhcyB3aGVyZSBhIGNsaWNrIGRvZXMgbm90IGZvY3VzIHRoZSBidXR0b24gKFNhZmFyaSk7IEVzY2FwZSBpbiBhIGZpZWxkIGxlYXZlcyBhIGRpYWxvZyBvcGVuXG5cdFx0YXdhaXQgZGlhbG9nLmxvY2F0b3IoJ2lucHV0W3R5cGU9ZmlsZV0nKS5mb2N1cygpXG5cdFx0YXdhaXQgZGlhbG9nLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnQWRkIENhcHRpb25zJyB9KS5kaXNwYXRjaEV2ZW50KCdjbGljaycpXG5cdFx0YXdhaXQgZXhwZWN0KGRpYWxvZy5sb2NhdG9yKCcuZGVsaXZlci1jYXB0aW9uc19fbGlzdCcpKS50b0hhdmVUZXh0KCdHZXJtYW4nKVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ0VzY2FwZScpXG5cdFx0YXdhaXQgZXhwZWN0KGRpYWxvZykudG9CZUhpZGRlbigpXG5cblx0XHRhd2FpdCBjYXJkKHBhZ2UsICdjYXB0aW9uZWQnKS5sb2NhdG9yKCcuZGVsaXZlci1jYXJkX19saW5rJykuZGJsY2xpY2soKVxuXHRcdGNvbnN0IHNob3duID0gKCkgPT4gcGFnZS5ldmFsdWF0ZSgoKSA9PiBbLi4uZG9jdW1lbnQucXVlcnlTZWxlY3RvcignLmRlbGl2ZXItcGxheWVyX192aWRlbycpLnRleHRUcmFja3NdLmZpbHRlcigodHJhY2spID0+IHRyYWNrLm1vZGUgPT09ICdzaG93aW5nJykubWFwKCh0cmFjaykgPT4gdHJhY2subGFuZ3VhZ2UpKVxuXHRcdC8vIE9mZiB1bnRpbCBzb21lb25lIHR1cm5zIHRoZW0gb25cblx0XHRhd2FpdCBleHBlY3QocGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ0NhcHRpb25zJyB9KSkudG9CZVZpc2libGUoKVxuXHRcdGV4cGVjdChhd2FpdCBzaG93bigpKS50b0VxdWFsKFtdKVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdDYXB0aW9ucycgfSkuY2xpY2soKVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdtZW51aXRlbXJhZGlvJywgeyBuYW1lOiAnR2VybWFuJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoc2hvd24pLnRvRXF1YWwoWydkZSddKVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdDYXB0aW9ucycgfSkuY2xpY2soKVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdtZW51aXRlbXJhZGlvJywgeyBuYW1lOiAnT2ZmJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoc2hvd24pLnRvRXF1YWwoW10pXG5cdH0pXG5cblx0dGVzdCgndGhlIHRpbWVsaW5lIGhvdmVyIHNjcnVicyB0aHJvdWdoIHdoYXQgcGxheXMgd2hlcmUgdGhpcyBicm93c2VyIGNhbm5vdCBwbGF5IHRoZSBTY3J1YiBQcm94eScsIGFzeW5jICgpID0+IHtcblx0XHQvLyBmZm1wZWcgbWFrZXMgdGhlIGNsaXAncyBTY3J1YiBQcm94eSwgYW4gSC4yNjQgTVA0LCB3aGljaCBvcGVuLXNvdXJjZSBDaHJvbWl1bSBkb2VzIG5vdCBkZWNvZGVcblx0XHRleGVjRmlsZVN5bmMoJ2RvY2tlcicsIFsnY29tcG9zZScsICdleGVjJywgJy1UJywgJy11JywgJ3d3dy1kYXRhJywgJ25leHRjbG91ZCcsICdwaHAnLCAnb2NjJywgJ2RlbGl2ZXI6d29ya2VyJywgJy0tb25jZSddLCB7IHN0ZGlvOiAnaW5oZXJpdCcgfSlcblx0XHRhd2FpdCBwYWdlLmdvdG8oYC9hcHBzL2RlbGl2ZXIvdmVyc2lvbnMvJHt2ZXJzaW9uSWR9YClcblx0XHRjb25zdCBoMjY0ID0gYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PiBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd2aWRlbycpLmNhblBsYXlUeXBlKCd2aWRlby9tcDQ7IGNvZGVjcz1cImF2YzEuNDJFMDFFXCInKSAhPT0gJycpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX19zY3J1Yi12aWRlbycpKS50b0hhdmVBdHRyaWJ1dGUoJ3NyYycsIGgyNjQgPyAvXFwvbWVkaWFcXC9zY3J1YiQvIDogL2NsaXBcXC53ZWJtJC8pXG5cdFx0Y29uc3QgYmFyID0gYXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX3RpbWVsaW5lJykuYm91bmRpbmdCb3goKVxuXHRcdGF3YWl0IHBhZ2UubW91c2UubW92ZShiYXIueCArIGJhci53aWR0aCAvIDIsIGJhci55ICsgYmFyLmhlaWdodCAvIDIpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX19ob3ZlciBjYW52YXMnKSkudG9CZVZpc2libGUoKVxuXHR9KVxuXG5cdHRlc3QoJ2EgY2xpY2sgb24gdGhlIHRpbWVsaW5lIGtlZXBzIHBsYXlpbmcgaWYgaXQgcGxheWVkLCBhbmQgc3RheXMgcGF1c2VkIGlmIGl0IGRpZCBub3QnLCBhc3luYyAoKSA9PiB7XG5cdFx0YXdhaXQgcGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL3ZlcnNpb25zLyR7dmVyc2lvbklkfWApXG5cdFx0Y29uc3QgdmlkZW8gPSBwYWdlLmxvY2F0b3IoJ3ZpZGVvLmRlbGl2ZXItcGxheWVyX192aWRlbycpXG5cdFx0YXdhaXQgZXhwZWN0KHZpZGVvKS50b0hhdmVKU1Byb3BlcnR5KCdyZWFkeVN0YXRlJywgNClcblx0XHRjb25zdCBiYXIgPSBhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fdGltZWxpbmUnKS5ib3VuZGluZ0JveCgpXG5cdFx0Y29uc3QgY2xpY2tBdCA9IChzaGFyZSkgPT4gcGFnZS5tb3VzZS5jbGljayhiYXIueCArIGJhci53aWR0aCAqIHNoYXJlLCBiYXIueSArIGJhci5oZWlnaHQgLyAyKVxuXG5cdFx0YXdhaXQgY2xpY2tBdCgwLjEpXG5cdFx0YXdhaXQgcGFnZS53YWl0Rm9yVGltZW91dCgzMDApXG5cdFx0ZXhwZWN0KGF3YWl0IHZpZGVvLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LnBhdXNlZCkpLnRvQmUodHJ1ZSlcblxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6IC9eUGxheSBcXCgvIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiB2aWRlby5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5jdXJyZW50VGltZSkpLnRvQmVHcmVhdGVyVGhhbigwLjEpXG5cdFx0YXdhaXQgY2xpY2tBdCgwLjUpXG5cdFx0YXdhaXQgcGFnZS53YWl0Rm9yVGltZW91dCgzMDApXG5cdFx0ZXhwZWN0KGF3YWl0IHZpZGVvLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LnBhdXNlZCkpLnRvQmUoZmFsc2UpXG5cdFx0ZXhwZWN0KGF3YWl0IHZpZGVvLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LmN1cnJlbnRUaW1lKSkudG9CZUdyZWF0ZXJUaGFuKDEuOSlcblx0XHRhd2FpdCBleHBlY3QocGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogL15QYXVzZSBcXCgvIH0pKS50b0JlVmlzaWJsZSgpXG5cdH0pXG5cblx0dGVzdCgnZHJhZ2dpbmcgdGhlIHBsYXloZWFkIHdpdGggdGhlIG1vdXNlIHNlZWtzIGJlZm9yZSByZWxlYXNlLCBob2xkcyBwbGF5YmFjayBhbmQgZ29lcyBvbiBpZiBpdCBwbGF5ZWQnLCBhc3luYyAoKSA9PiB7XG5cdFx0YXdhaXQgcGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL3ZlcnNpb25zLyR7dmVyc2lvbklkfWApXG5cdFx0Y29uc3QgdmlkZW8gPSBwYWdlLmxvY2F0b3IoJ3ZpZGVvLmRlbGl2ZXItcGxheWVyX192aWRlbycpXG5cdFx0YXdhaXQgZXhwZWN0KHZpZGVvKS50b0hhdmVKU1Byb3BlcnR5KCdyZWFkeVN0YXRlJywgNClcblx0XHRjb25zdCBiYXIgPSBhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fdGltZWxpbmUnKS5ib3VuZGluZ0JveCgpXG5cdFx0Y29uc3QgeSA9IGJhci55ICsgYmFyLmhlaWdodCAvIDJcblx0XHRjb25zdCB0aW1lID0gKCkgPT4gdmlkZW8uZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQuY3VycmVudFRpbWUpXG5cdFx0Y29uc3QgcGF1c2VkID0gKCkgPT4gdmlkZW8uZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQucGF1c2VkKVxuXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogL15QbGF5IFxcKC8gfSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKHBhdXNlZCkudG9CZShmYWxzZSlcblx0XHRhd2FpdCBwYWdlLm1vdXNlLm1vdmUoYmFyLnggKyBiYXIud2lkdGggKiAwLjIsIHkpXG5cdFx0YXdhaXQgcGFnZS5tb3VzZS5kb3duKClcblx0XHRhd2FpdCBwYWdlLm1vdXNlLm1vdmUoYmFyLnggKyBiYXIud2lkdGggKiAwLjUsIHksIHsgc3RlcHM6IDUgfSlcblx0XHQvLyBTdGlsbCBwcmVzc2VkOiB0aGUgcGljdHVyZSBpcyBhbHJlYWR5IHRoZXJlIGFuZCBwbGF5YmFjayBpcyBoZWxkXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwodGltZSkudG9CZUdyZWF0ZXJUaGFuKDEuOClcblx0XHRleHBlY3QoYXdhaXQgdGltZSgpKS50b0JlTGVzc1RoYW4oMi4zKVxuXHRcdGV4cGVjdChhd2FpdCBwYXVzZWQoKSkudG9CZSh0cnVlKVxuXHRcdGF3YWl0IHBhZ2UubW91c2UubW92ZShiYXIueCArIGJhci53aWR0aCAqIDAuNzUsIHksIHsgc3RlcHM6IDUgfSlcblx0XHRhd2FpdCBleHBlY3QucG9sbCh0aW1lKS50b0JlR3JlYXRlclRoYW4oMi44KVxuXHRcdGF3YWl0IHBhZ2UubW91c2UudXAoKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKHBhdXNlZCkudG9CZShmYWxzZSlcblxuXHRcdC8vIFBhdXNlZCBzdGF5cyBwYXVzZWRcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAvXlBhdXNlIFxcKC8gfSkuY2xpY2soKVxuXHRcdGF3YWl0IHBhZ2UubW91c2UubW92ZShiYXIueCArIGJhci53aWR0aCAqIDAuOCwgeSlcblx0XHRhd2FpdCBwYWdlLm1vdXNlLmRvd24oKVxuXHRcdGF3YWl0IHBhZ2UubW91c2UubW92ZShiYXIueCArIGJhci53aWR0aCAqIDAuMSwgeSwgeyBzdGVwczogNSB9KVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKHRpbWUpLnRvQmVMZXNzVGhhbigwLjcpXG5cdFx0YXdhaXQgcGFnZS5tb3VzZS51cCgpXG5cdFx0YXdhaXQgcGFnZS53YWl0Rm9yVGltZW91dCgzMDApXG5cdFx0ZXhwZWN0KGF3YWl0IHBhdXNlZCgpKS50b0JlKHRydWUpXG5cdH0pXG5cblx0dGVzdCgnYSBjbGljayBvbiB0aGUgYmFyIGtlZXBzIGEgYmFja3dhcmRzIHNodXR0bGUgZ29pbmcsIGZyb20gd2hlcmUgaXQgd2FzIGNsaWNrZWQnLCBhc3luYyAoKSA9PiB7XG5cdFx0YXdhaXQgcGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL3ZlcnNpb25zLyR7dmVyc2lvbklkfWApXG5cdFx0Y29uc3QgdmlkZW8gPSBwYWdlLmxvY2F0b3IoJ3ZpZGVvLmRlbGl2ZXItcGxheWVyX192aWRlbycpXG5cdFx0YXdhaXQgZXhwZWN0KHZpZGVvKS50b0hhdmVKU1Byb3BlcnR5KCdyZWFkeVN0YXRlJywgNClcblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWxheW91dF9fYmFyIGgyJykuY2xpY2soKVxuXHRcdGNvbnN0IGJhciA9IGF3YWl0IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX190aW1lbGluZScpLmJvdW5kaW5nQm94KClcblx0XHRjb25zdCB5ID0gYmFyLnkgKyBiYXIuaGVpZ2h0IC8gMlxuXHRcdGF3YWl0IHBhZ2UubW91c2UuY2xpY2soYmFyLnggKyBiYXIud2lkdGggKiAwLjksIHkpXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnaicpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6IC9eUGF1c2UgXFwoLyB9KSkudG9CZVZpc2libGUoKVxuXHRcdC8vIEEgY2xpY2sgaXMgb25seSBhIHNlZWs6IHRoZSBzaHV0dGxlIGdvZXMgb24gYmFja3dhcmRzIGZyb20gdGhlcmUgKGhvbGRpbmcgcGxheWJhY2sgd291bGQgZHJvcCBpdCxcblx0XHQvLyBhbmQgbGV0dGluZyBnbyB3b3VsZCBwbGF5IGZvcndhcmRzIGZyb20gMi4wIHMpXG5cdFx0YXdhaXQgcGFnZS5tb3VzZS5jbGljayhiYXIueCArIGJhci53aWR0aCAqIDAuNSwgeSlcblx0XHRhd2FpdCBwYWdlLndhaXRGb3JUaW1lb3V0KDMwMClcblx0XHRleHBlY3QoYXdhaXQgdmlkZW8uZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQuY3VycmVudFRpbWUpKS50b0JlTGVzc1RoYW4oMilcblx0XHRhd2FpdCBleHBlY3QocGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogL15QYXVzZSBcXCgvIH0pKS50b0JlVmlzaWJsZSgpXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnaycpXG5cdH0pXG5cblx0dGVzdCgnYSBjbGljayBvbiBhIENvbW1lbnRcXCdzIG1hcmtlciBwYXVzZXMnLCBhc3luYyAoeyBwbGF5d3JpZ2h0IH0pID0+IHtcblx0XHRjb25zdCBhcGkgPSBhd2FpdCBwbGF5d3JpZ2h0LnJlcXVlc3QubmV3Q29udGV4dCh7IGJhc2VVUkw6IFVSTCwgaHR0cENyZWRlbnRpYWxzOiBhdXRoLCBleHRyYUhUVFBIZWFkZXJzOiBvY3NIZWFkZXJzIH0pXG5cdFx0Ly8gVGhlIENvbXBhcmUgdGVzdCBzdGFja2VkIGEgbmV3ZXIgVmVyc2lvbiBvbiB0aGUgQXNzZXQ7IG9ubHkgdGhlIG5ld2VzdCB0YWtlcyBDb21tZW50c1xuXHRcdGNvbnN0IHByb2plY3QgPSBhd2FpdCAoYXdhaXQgYXBpLmdldChgL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS9wcm9qZWN0cy8ke3Byb2plY3RJZH0/Zm9ybWF0PWpzb25gKSkuanNvbigpXG5cdFx0Y29uc3QgbmV3ZXN0ID0gTWF0aC5tYXgoLi4ucHJvamVjdC5vY3MuZGF0YS5hc3NldHNbMF0udmVyc2lvbnMubWFwKChlYWNoKSA9PiBlYWNoLmlkKSlcblx0XHRjb25zdCBjb21tZW50ZWQgPSBhd2FpdCBhcGkucG9zdChgL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS92ZXJzaW9ucy8ke25ld2VzdH0vY29tbWVudHM/Zm9ybWF0PWpzb25gLCB7IGRhdGE6IHsgaW5GcmFtZTogNTAsIGJvZHk6ICdzdG9wIGhlcmUnIH0gfSlcblx0XHRleHBlY3QoY29tbWVudGVkLm9rKCkpLnRvQmUodHJ1ZSlcblx0XHRhd2FpdCBhcGkuZGlzcG9zZSgpXG5cdFx0YXdhaXQgcGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL3ZlcnNpb25zLyR7bmV3ZXN0fWApXG5cdFx0Y29uc3QgdmlkZW8gPSBwYWdlLmxvY2F0b3IoJ3ZpZGVvLmRlbGl2ZXItcGxheWVyX192aWRlbycpXG5cdFx0YXdhaXQgZXhwZWN0KHZpZGVvKS50b0hhdmVKU1Byb3BlcnR5KCdyZWFkeVN0YXRlJywgNClcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAvXlBsYXkgXFwoLyB9KS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gdmlkZW8uZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQucGF1c2VkKSkudG9CZShmYWxzZSlcblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fbWFya2VyJykuZmlyc3QoKS5jbGljayh7IGZvcmNlOiB0cnVlIH0pXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gdmlkZW8uZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQucGF1c2VkKSkudG9CZSh0cnVlKVxuXHRcdGV4cGVjdChhd2FpdCB2aWRlby5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5jdXJyZW50VGltZSkpLnRvQmVDbG9zZVRvKDIsIDEpXG5cdH0pXG5cblx0dGVzdCgnY2xvc2UgQ29tbWVudHMgc2hhcmUgYSBtYXJrZXIgd2l0aCB0aGVpciBjb3VudDogZWFjaCBwcmVzcyB0YWtlcyB0aGUgbmV4dCwgYSBkb3VibGUgdGFwIG9yIGNsaWNrIGdvZXMgdG8gdGhlIG9uZSB0aGF0IHNob3dlZCcsIGFzeW5jICh7IHBsYXl3cmlnaHQgfSkgPT4ge1xuXHRcdGNvbnN0IGFwaSA9IGF3YWl0IHBsYXl3cmlnaHQucmVxdWVzdC5uZXdDb250ZXh0KHsgYmFzZVVSTDogVVJMLCBodHRwQ3JlZGVudGlhbHM6IGF1dGgsIGV4dHJhSFRUUEhlYWRlcnM6IG9jc0hlYWRlcnMgfSlcblx0XHRjb25zdCBwcm9qZWN0ID0gYXdhaXQgKGF3YWl0IGFwaS5nZXQoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHMvJHtwcm9qZWN0SWR9P2Zvcm1hdD1qc29uYCkpLmpzb24oKVxuXHRcdGNvbnN0IG5ld2VzdCA9IE1hdGgubWF4KC4uLnByb2plY3Qub2NzLmRhdGEuYXNzZXRzWzBdLnZlcnNpb25zLm1hcCgoZWFjaCkgPT4gZWFjaC5pZCkpXG5cdFx0Y29uc3QgaWRzID0gW11cblx0XHRmb3IgKGNvbnN0IGluRnJhbWUgb2YgWzg1LCA4NiwgODddKSB7XG5cdFx0XHRjb25zdCBtYWRlID0gYXdhaXQgYXBpLnBvc3QoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvdmVyc2lvbnMvJHtuZXdlc3R9L2NvbW1lbnRzP2Zvcm1hdD1qc29uYCwgeyBkYXRhOiB7IGluRnJhbWUsIGJvZHk6IGBhdCAke2luRnJhbWV9YCB9IH0pXG5cdFx0XHRpZHMucHVzaCgoYXdhaXQgbWFkZS5qc29uKCkpLm9jcy5kYXRhLmlkKVxuXHRcdH1cblx0XHRhd2FpdCBwYWdlLmdvdG8oYC9hcHBzL2RlbGl2ZXIvdmVyc2lvbnMvJHtuZXdlc3R9YClcblx0XHRjb25zdCB2aWRlbyA9IHBhZ2UubG9jYXRvcigndmlkZW8uZGVsaXZlci1wbGF5ZXJfX3ZpZGVvJylcblx0XHRhd2FpdCBleHBlY3QodmlkZW8pLnRvSGF2ZUpTUHJvcGVydHkoJ3JlYWR5U3RhdGUnLCA0KVxuXHRcdGNvbnN0IGZyYW1lT2YgPSAodGFyZ2V0KSA9PiB0YXJnZXQuZXZhbHVhdGUoKGVsZW1lbnQpID0+IE1hdGguZmxvb3IoZWxlbWVudC5jdXJyZW50VGltZSAqIDI1ICsgMC4wMDEpKVxuXHRcdGNvbnN0IG1hcmtlciA9IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX19tYXJrZXJbYXJpYS1sYWJlbCo9XCI6IGF0IDhcIl0nKVxuXHRcdGF3YWl0IGV4cGVjdChtYXJrZXIpLnRvSGF2ZUF0dHJpYnV0ZSgnYXJpYS1sYWJlbCcsIC9eMSBvZiAzLCAuKjogYXQgODUkLylcblx0XHQvLyBUaGUgbW91c2Ugc2hvd3MgdGhlIGZpcnN0IGFuZCBzdGVwcyBvbiB3aXRoIGV2ZXJ5IGNsaWNrOyB0aGUgd3JhcCBjb21lcyBiYWNrIHRvIGl0IChmb3JjZWQ6IHRoZSBiYXIgdGFrZXMgdGhlIHBvaW50ZXIgZm9yIGl0cyBjaXJjbGVzKVxuXHRcdGF3YWl0IG1hcmtlci5ob3Zlcih7IGZvcmNlOiB0cnVlIH0pXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX19wZWVrJykpLnRvQ29udGFpblRleHQoJzEgb2YgMycpXG5cdFx0Zm9yIChjb25zdCBmcmFtZSBvZiBbODUsIDg2LCA4NywgODUsIDg2XSkge1xuXHRcdFx0YXdhaXQgbWFya2VyLmNsaWNrKHsgZm9yY2U6IHRydWUgfSlcblx0XHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IGZyYW1lT2YodmlkZW8pKS50b0JlKGZyYW1lKVxuXHRcdFx0YXdhaXQgcGFnZS53YWl0Rm9yVGltZW91dCg0MDApXG5cdFx0fVxuXHRcdC8vIEEgZG91YmxlIGNsaWNrIGRvZXMgbm90IHN0ZXAgb246IHRoZSBzZWNvbmQgcHJlc3MgdGFrZXMgdGhlIG9uZSB0aGF0IHNob3dlZCBiZWZvcmUgdGhlIGZpcnN0XG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX19wZWVrJykpLnRvQ29udGFpblRleHQoJzIgb2YgMycpXG5cdFx0YXdhaXQgbWFya2VyLmRibGNsaWNrKHsgZm9yY2U6IHRydWUgfSlcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX3BlZWsnKSkudG9Db250YWluVGV4dCgnMiBvZiAzJylcblx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiBmcmFtZU9mKHZpZGVvKSkudG9CZSg4Nilcblx0XHRhd2FpdCBwYWdlLm1vdXNlLm1vdmUoMCwgMClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX3BlZWsnKSkudG9IYXZlQ291bnQoMClcblx0XHQvLyBUaGUga2V5Ym9hcmQgdG9vOiB0aGUgVGFiIGtleSBzaG93cyB0aGUgZmlyc3QsIEVudGVyIGdvZXMgdGhlcmUgYW5kIHRoZW4gb25cblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWxheW91dF9fYmFyIGgyJykuY2xpY2soKVxuXHRcdGF3YWl0IG1hcmtlci5mb2N1cygpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX19wZWVrJykpLnRvSGF2ZUNvdW50KDApXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnU2hpZnQrVGFiJylcblx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdUYWInKVxuXHRcdGF3YWl0IGV4cGVjdChtYXJrZXIpLnRvQmVGb2N1c2VkKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX3BlZWsnKSkudG9Db250YWluVGV4dCgnMSBvZiAzJylcblx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdFbnRlcicpXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gZnJhbWVPZih2aWRlbykpLnRvQmUoODUpXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnRW50ZXInKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IGZyYW1lT2YodmlkZW8pKS50b0JlKDg2KVxuXHRcdGF3YWl0IGV4cGVjdChtYXJrZXIpLnRvSGF2ZUF0dHJpYnV0ZSgnYXJpYS1sYWJlbCcsIC9eMiBvZiAzLCAuKjogYXQgODYkLylcblxuXHRcdGNvbnN0IHBob25lID0gYXdhaXQgYnJvd3Nlci5uZXdDb250ZXh0KHsgYmFzZVVSTDogQlJPV1NFUl9VUkwsIC4uLlBIT05FIH0pXG5cdFx0Y29uc3QgdG91Y2hQYWdlID0gYXdhaXQgcGhvbmUubmV3UGFnZSgpXG5cdFx0YXdhaXQgbG9naW4odG91Y2hQYWdlKVxuXHRcdGF3YWl0IHRvdWNoUGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL3ZlcnNpb25zLyR7bmV3ZXN0fWApXG5cdFx0Y29uc3QgdG91Y2hWaWRlbyA9IHRvdWNoUGFnZS5sb2NhdG9yKCd2aWRlby5kZWxpdmVyLXBsYXllcl9fdmlkZW8nKVxuXHRcdGF3YWl0IGV4cGVjdCh0b3VjaFZpZGVvKS50b0hhdmVKU1Byb3BlcnR5KCdyZWFkeVN0YXRlJywgNClcblx0XHRjb25zdCBjYXJkID0gdG91Y2hQYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fcGVlay0tdGFwcGVkJylcblx0XHQvLyBBIGZpbmdlciBvbiB0aGUgY2lyY2xlIG9wZW5zIHRoZSBjYXJkIHdpdGhvdXQgc2Vla2luZ1xuXHRcdGNvbnN0IGJveCA9IGF3YWl0IHRvdWNoUGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX21hcmtlclthcmlhLWxhYmVsKj1cIjogYXQgOFwiXScpLmJvdW5kaW5nQm94KClcblx0XHRjb25zdCB0YXAgPSAoYmVzaWRlID0gMCkgPT4gdG91Y2hQYWdlLnRvdWNoc2NyZWVuLnRhcChib3gueCArIGJveC53aWR0aCAvIDIgLSBiZXNpZGUsIGJveC55ICsgYm94LmhlaWdodCAvIDIpXG5cdFx0YXdhaXQgdGFwKDYpXG5cdFx0YXdhaXQgZXhwZWN0KGNhcmQpLnRvQ29udGFpblRleHQoJ2F0IDg1Jylcblx0XHRleHBlY3QoYXdhaXQgdG91Y2hWaWRlby5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5jdXJyZW50VGltZSkpLnRvQmUoMClcblx0XHRhd2FpdCB0b3VjaFBhZ2Uud2FpdEZvclRpbWVvdXQoNzAwKVxuXHRcdGF3YWl0IHRhcCgpXG5cdFx0YXdhaXQgZXhwZWN0KGNhcmQpLnRvQ29udGFpblRleHQoJzIgb2YgMycpXG5cdFx0YXdhaXQgdG91Y2hQYWdlLndhaXRGb3JUaW1lb3V0KDcwMClcblx0XHRhd2FpdCB0YXAoKVxuXHRcdGF3YWl0IHRhcCgpXG5cdFx0YXdhaXQgZXhwZWN0KGNhcmQpLnRvQ29udGFpblRleHQoJzIgb2YgMycpXG5cdFx0YXdhaXQgZXhwZWN0KGNhcmQpLnRvQ29udGFpblRleHQoJ2F0IDg2Jylcblx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiBmcmFtZU9mKHRvdWNoVmlkZW8pKS50b0JlKDg2KVxuXHRcdC8vIEl0IHJlYWNoZXMgbm8gZnVydGhlciB0aGFuIGl0IGlzIGRyYXduOiBiZXNpZGUsIGFib3ZlIGFuZCBiZWxvdyBpdCB0aGUgYmFyIHNlZWtzXG5cdFx0Y29uc3QgYmFyID0gYXdhaXQgdG91Y2hQYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fdGltZWxpbmUnKS5ib3VuZGluZ0JveCgpXG5cdFx0Y29uc3QgdGFwQXQgPSBhc3luYyAoeCwgeSkgPT4ge1xuXHRcdFx0YXdhaXQgdG91Y2hQYWdlLnJlbG9hZCgpXG5cdFx0XHRhd2FpdCBleHBlY3QodG91Y2hWaWRlbykudG9IYXZlSlNQcm9wZXJ0eSgncmVhZHlTdGF0ZScsIDQpXG5cdFx0XHRhd2FpdCBleHBlY3QodG91Y2hQYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fbWFya2VyW2FyaWEtbGFiZWwqPVwiOiBhdCA4XCJdJykpLnRvQmVWaXNpYmxlKClcblx0XHRcdGF3YWl0IHRvdWNoUGFnZS50b3VjaHNjcmVlbi50YXAoYm94LnggKyBib3gud2lkdGggLyAyICsgeCwgeSlcblx0XHR9XG5cdFx0Zm9yIChjb25zdCBbeCwgeSwgZnJhbWVdIG9mIFtbLTE4LCAxNiwgODUgLSAxOCAvIGJhci53aWR0aCAqIDEwMF0sIFswLCAxLCA4NV0sIFswLCAyLCA4NV0sIFswLCA0LCA4NV0sIFswLCA1LCA4NV0sIFswLCBiYXIuaGVpZ2h0IC0gNSwgODVdLCBbMCwgYmFyLmhlaWdodCAtNCwgODVdLCBbMCwgYmFyLmhlaWdodCAtMSwgODVdLCBbLTExLCAxNiwgMV0sIFswLCBiYXIuaGVpZ2h0IC0gMiwgODVdXSkge1xuXHRcdFx0YXdhaXQgdG91Y2hQYWdlLmV2YWx1YXRlKCgpID0+IDApOyBhd2FpdCB0YXBBdCh4LCBiYXIueSArIHkpOyBhd2FpdCB0b3VjaFBhZ2Uud2FpdEZvclRpbWVvdXQoNTAwKTsgY29uc29sZS5sb2coeCwgeSwgYXdhaXQgZnJhbWVPZih0b3VjaFZpZGVvKSwgYXdhaXQgdG91Y2hQYWdlLmV2YWx1YXRlKCgpID0+IFtkb2N1bWVudC5xdWVyeVNlbGVjdG9yKCd2aWRlbycpLnBhdXNlZCwgZG9jdW1lbnQucXVlcnlTZWxlY3RvcignLmRlbGl2ZXItcGxheWVyX19wZWVrJyk/LmNsYXNzTmFtZV0pKTsgYXdhaXQgdG91Y2hQYWdlLnNjcmVlbnNob3Qoe3BhdGg6ICcudG1wL2IucG5nJ30pXG4vL1x0XHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IGZyYW1lT2YodG91Y2hWaWRlbykpLnRvQmVHcmVhdGVyVGhhbihmcmFtZSAtIDIpXG4vL1x0XHRcdGV4cGVjdChhd2FpdCBmcmFtZU9mKHRvdWNoVmlkZW8pKS50b0JlTGVzc1RoYW4oZnJhbWUgKyAyKVxuLy9cdFx0XHRhd2FpdCBleHBlY3QoY2FyZCkudG9IYXZlQ291bnQoMClcblx0XHR9XG5cdFx0Ly8gVGhlIGJhciBncm93cyB1bmRlciBhIG1vdXNlLCBvbiBhIG5hcnJvdyB3aW5kb3cgdG9vLCBub3QgdW5kZXIgYSBmaW5nZXJcblx0XHRhd2FpdCBwYWdlLnNldFZpZXdwb3J0U2l6ZSh7IHdpZHRoOiA5MDAsIGhlaWdodDogODAwIH0pXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX3RpbWVsaW5lJykuaG92ZXIoKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fdHJhY2snKSkudG9IYXZlQ1NTKCdoZWlnaHQnLCAnMTJweCcpXG5cdFx0Y29uc3QgW2tub2IsIHRyYWNrXSA9IGF3YWl0IFByb21pc2UuYWxsKFsnLmRlbGl2ZXItcGxheWVyX190aW1lbGluZScsICcuZGVsaXZlci1wbGF5ZXJfX3RyYWNrJ10ubWFwKChlYWNoKSA9PiBwYWdlLmxvY2F0b3IoZWFjaCkuYm91bmRpbmdCb3goKSkpXG5cdFx0ZXhwZWN0KHRyYWNrLnkgKyB0cmFjay5oZWlnaHQgLyAyKS50b0JlQ2xvc2VUbyhrbm9iLnkgKyBrbm9iLmhlaWdodCAvIDIsIDApXG5cdFx0YXdhaXQgcGFnZS5zZXRWaWV3cG9ydFNpemUoeyB3aWR0aDogMTI4MCwgaGVpZ2h0OiA3MjAgfSlcblx0XHRhd2FpdCBleHBlY3QodG91Y2hQYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fdHJhY2snKSkudG9IYXZlQ1NTKCdoZWlnaHQnLCAnNnB4Jylcblx0XHRhd2FpdCB0YXBBdCgwLCBiYXIueSAtIDQpXG5cdFx0YXdhaXQgZXhwZWN0KHRvdWNoUGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXItLWZ1bGxzY3JlZW4sIC5kZWxpdmVyLXBsYXllci0tZmlsbGluZycpKS50b0hhdmVDb3VudCgxKVxuXHRcdGF3YWl0IGV4cGVjdChjYXJkKS50b0hhdmVDb3VudCgwKVxuXHRcdGF3YWl0IHBob25lLmNsb3NlKClcblx0XHRmb3IgKGNvbnN0IGlkIG9mIGlkcykge1xuXHRcdFx0ZXhwZWN0KChhd2FpdCBhcGkuZGVsZXRlKGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL2NvbW1lbnRzLyR7aWR9P2Zvcm1hdD1qc29uYCkpLm9rKCkpLnRvQmUodHJ1ZSlcblx0XHR9XG5cdFx0YXdhaXQgYXBpLmRpc3Bvc2UoKVxuXHR9KVxuXG5cdHRlc3QoJ2EgcHJlc3Mgb24gYSBDb21tZW50XFwncyBjaXJjbGUgdGhhdCBkb2VzIG5vdCBtb3ZlIG9wZW5zIGl0LCBvbmUgdGhhdCBtb3ZlcyBkcmFncyB0aGUgcGxheWhlYWQsIGJ5IG1vdXNlIGFuZCBieSBmaW5nZXInLCBhc3luYyAoeyBwbGF5d3JpZ2h0IH0pID0+IHtcblx0XHRjb25zdCBhcGkgPSBhd2FpdCBwbGF5d3JpZ2h0LnJlcXVlc3QubmV3Q29udGV4dCh7IGJhc2VVUkw6IFVSTCwgaHR0cENyZWRlbnRpYWxzOiBhdXRoLCBleHRyYUhUVFBIZWFkZXJzOiBvY3NIZWFkZXJzIH0pXG5cdFx0Y29uc3QgcHJvamVjdCA9IGF3YWl0IChhd2FpdCBhcGkuZ2V0KGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3Byb2plY3RzLyR7cHJvamVjdElkfT9mb3JtYXQ9anNvbmApKS5qc29uKClcblx0XHRjb25zdCBuZXdlc3QgPSBNYXRoLm1heCguLi5wcm9qZWN0Lm9jcy5kYXRhLmFzc2V0c1swXS52ZXJzaW9ucy5tYXAoKGVhY2gpID0+IGVhY2guaWQpKVxuXHRcdGNvbnN0IG1hZGUgPSBhd2FpdCBhcGkucG9zdChgL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS92ZXJzaW9ucy8ke25ld2VzdH0vY29tbWVudHM/Zm9ybWF0PWpzb25gLCB7IGRhdGE6IHsgaW5GcmFtZTogMzAsIGJvZHk6ICdkcmFnIG1lJyB9IH0pXG5cdFx0Y29uc3QgaWQgPSAoYXdhaXQgbWFkZS5qc29uKCkpLm9jcy5kYXRhLmlkXG5cdFx0Y29uc3QgcGhvbmUgPSBhd2FpdCBicm93c2VyLm5ld0NvbnRleHQoeyBiYXNlVVJMOiBCUk9XU0VSX1VSTCwgLi4uUEhPTkUgfSlcblx0XHRjb25zdCB0b3VjaFBhZ2UgPSBhd2FpdCBwaG9uZS5uZXdQYWdlKClcblx0XHRhd2FpdCBsb2dpbih0b3VjaFBhZ2UpXG5cdFx0Y29uc3QgY2RwID0gYXdhaXQgcGhvbmUubmV3Q0RQU2Vzc2lvbih0b3VjaFBhZ2UpXG5cdFx0Y29uc3QgZmluZ2VyID0gKHgsIHkpID0+ICh7XG5cdFx0XHRkb3duOiAoKSA9PiBjZHAuc2VuZCgnSW5wdXQuZGlzcGF0Y2hUb3VjaEV2ZW50JywgeyB0eXBlOiAndG91Y2hTdGFydCcsIHRvdWNoUG9pbnRzOiBbeyB4LCB5IH1dIH0pLFxuXHRcdFx0bW92ZTogKGR4KSA9PiBjZHAuc2VuZCgnSW5wdXQuZGlzcGF0Y2hUb3VjaEV2ZW50JywgeyB0eXBlOiAndG91Y2hNb3ZlJywgdG91Y2hQb2ludHM6IFt7IHg6IHggKyBkeCwgeSB9XSB9KSxcblx0XHRcdHVwOiAoKSA9PiBjZHAuc2VuZCgnSW5wdXQuZGlzcGF0Y2hUb3VjaEV2ZW50JywgeyB0eXBlOiAndG91Y2hFbmQnLCB0b3VjaFBvaW50czogW10gfSksXG5cdFx0fSlcblx0XHRjb25zdCBtb3VzZSA9ICh4LCB5KSA9PiAoe1xuXHRcdFx0ZG93bjogYXN5bmMgKCkgPT4ge1xuXHRcdFx0XHRhd2FpdCBwYWdlLm1vdXNlLm1vdmUoeCwgeSlcblx0XHRcdFx0YXdhaXQgcGFnZS5tb3VzZS5kb3duKClcblx0XHRcdH0sXG5cdFx0XHRtb3ZlOiAoZHgpID0+IHBhZ2UubW91c2UubW92ZSh4ICsgZHgsIHkpLFxuXHRcdFx0dXA6ICgpID0+IHBhZ2UubW91c2UudXAoKSxcblx0XHR9KVxuXG5cdFx0Zm9yIChjb25zdCBbdGFyZ2V0LCBwb2ludGVyXSBvZiBbW3BhZ2UsIG1vdXNlXSwgW3RvdWNoUGFnZSwgZmluZ2VyXV0pIHtcblx0XHRcdGF3YWl0IHRhcmdldC5nb3RvKGAvYXBwcy9kZWxpdmVyL3ZlcnNpb25zLyR7bmV3ZXN0fWApXG5cdFx0XHRjb25zdCB2aWRlbyA9IHRhcmdldC5sb2NhdG9yKCd2aWRlby5kZWxpdmVyLXBsYXllcl9fdmlkZW8nKVxuXHRcdFx0YXdhaXQgZXhwZWN0KHZpZGVvKS50b0hhdmVKU1Byb3BlcnR5KCdyZWFkeVN0YXRlJywgNClcblx0XHRcdGNvbnN0IGZyYW1lID0gKCkgPT4gdmlkZW8uZXZhbHVhdGUoKGVsZW1lbnQpID0+IE1hdGguZmxvb3IoZWxlbWVudC5jdXJyZW50VGltZSAqIDI1ICsgMC4wMDEpKVxuXHRcdFx0Y29uc3QgcGF1c2VkID0gKCkgPT4gdmlkZW8uZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQucGF1c2VkKVxuXHRcdFx0Y29uc3QgYmFyID0gYXdhaXQgdGFyZ2V0LmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fdGltZWxpbmUnKS5ib3VuZGluZ0JveCgpXG5cdFx0XHRjb25zdCBib3ggPSBhd2FpdCB0YXJnZXQubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX19tYXJrZXJbYXJpYS1sYWJlbCQ9XCJkcmFnIG1lXCJdJykuYm91bmRpbmdCb3goKVxuXHRcdFx0Ly8gQSBsaXR0bGUgb2ZmIGl0cyBtaWRkbGUsIGEgRnJhbWUgb2YgaXRzIG93blxuXHRcdFx0Y29uc3QgeCA9IGJveC54ICsgYm94LndpZHRoIC8gMiAtIDVcblx0XHRcdGNvbnN0IHsgZG93biwgbW92ZSwgdXAgfSA9IHBvaW50ZXIoeCwgYm94LnkgKyBib3guaGVpZ2h0IC8gMilcblx0XHRcdGNvbnN0IGF0ID0gKHB4KSA9PiBNYXRoLmZsb29yKChweCAtIGJhci54KSAvIGJhci53aWR0aCAqIDEwMClcblx0XHRcdGNvbnN0IHBlZWsgPSB0YXJnZXQubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX19wZWVrJylcblx0XHRcdGNvbnN0IHNob3duID0gdGFyZ2V0LmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9faG92ZXInKVxuXG5cdFx0XHQvLyBXaXRoaW4gdGhlIHNsb3AgaXQgZG9lcyBub3Qgc2VlayBidXQgb3BlbnNcblx0XHRcdGF3YWl0IGRvd24oKVxuXHRcdFx0YXdhaXQgbW92ZSg2KVxuXHRcdFx0YXdhaXQgdGFyZ2V0LndhaXRGb3JUaW1lb3V0KDE1MClcblx0XHRcdGV4cGVjdChhd2FpdCBmcmFtZSgpKS50b0JlKDApXG5cdFx0XHRhd2FpdCB1cCgpXG5cdFx0XHRhd2FpdCBleHBlY3QocGVlaykudG9Db250YWluVGV4dCgnZHJhZyBtZScpXG5cdFx0XHRhd2FpdCBleHBlY3QucG9sbChmcmFtZSkudG9CZSh0YXJnZXQgPT09IHBhZ2UgPyAzMCA6IDApXG5cdFx0XHRhd2FpdCB0YXJnZXQucmVsb2FkKClcblx0XHRcdGF3YWl0IGV4cGVjdCh2aWRlbykudG9IYXZlSlNQcm9wZXJ0eSgncmVhZHlTdGF0ZScsIDQpXG5cdFx0XHRhd2FpdCBleHBlY3QodGFyZ2V0LmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fbWFya2VyW2FyaWEtbGFiZWwkPVwiZHJhZyBtZVwiXScpKS50b0JlVmlzaWJsZSgpXG5cblx0XHRcdC8vIFBhc3QgaXQgdGhlIHBsYXloZWFkIGdvZXMgYWxvbmcsIHdpdGggdGhlIEZyYW1lIG92ZXIgdGhlIHBvaW50ZXIgYW5kIG5vIGNhcmQsIGFuZCBwbGF5YmFjayBoZWxkXG5cdFx0XHRhd2FpdCB0YXJnZXQuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6IC9eUGxheS8gfSkuZmlyc3QoKS5jbGljaygpXG5cdFx0XHRhd2FpdCBleHBlY3QucG9sbChwYXVzZWQpLnRvQmUoZmFsc2UpXG5cdFx0XHRhd2FpdCBkb3duKClcblx0XHRcdGF3YWl0IG1vdmUoNDApXG5cdFx0XHRhd2FpdCBtb3ZlKDEyMClcblx0XHRcdGF3YWl0IGV4cGVjdC5wb2xsKGZyYW1lKS50b0JlKGF0KHggKyAxMjApKVxuXHRcdFx0ZXhwZWN0KGF3YWl0IHBhdXNlZCgpKS50b0JlKHRydWUpXG5cdFx0XHRhd2FpdCBleHBlY3Qoc2hvd24pLnRvQmVWaXNpYmxlKClcblx0XHRcdGF3YWl0IGV4cGVjdChwZWVrKS50b0hhdmVDb3VudCgwKVxuXHRcdFx0Ly8gQmFjayBvbiB0aGUgY2lyY2xlIGFuZCBsZXQgZ28sIGl0IGlzIHdoZXJlIHRoZSBwb2ludGVyIGlzLCBzdGlsbCBubyBjbGlja1xuXHRcdFx0YXdhaXQgbW92ZSgwKVxuXHRcdFx0YXdhaXQgdGFyZ2V0LmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAvXlBhdXNlfF5QbGF5LyB9KS5maXJzdCgpLndhaXRGb3IoKVxuXHRcdFx0YXdhaXQgZXhwZWN0LnBvbGwoZnJhbWUpLnRvQmUoYXQoeCkpXG5cdFx0XHRhd2FpdCB1cCgpXG5cdFx0XHRhd2FpdCBleHBlY3QucG9sbChwYXVzZWQpLnRvQmUoZmFsc2UpXG5cdFx0XHRhd2FpdCBleHBlY3QodGFyZ2V0LmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fcGVlay0tdGFwcGVkJykpLnRvSGF2ZUNvdW50KDApXG5cdFx0XHRhd2FpdCB0YXJnZXQud2FpdEZvclRpbWVvdXQoNDAwKVxuXHRcdFx0ZXhwZWN0KGF3YWl0IHBhdXNlZCgpKS50b0JlKGZhbHNlKVxuXHRcdFx0ZXhwZWN0KGF3YWl0IGZyYW1lKCkpLnRvQmVHcmVhdGVyVGhhbk9yRXF1YWwoYXQoeCkpXG5cdFx0fVxuXHRcdC8vIEEgY2xpY2sgY291bnRzIGFnYWluIGFmdGVyIGEgZHJhZ1xuXHRcdGF3YWl0IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX19tYXJrZXJbYXJpYS1sYWJlbCQ9XCJkcmFnIG1lXCJdJykuY2xpY2soeyBmb3JjZTogdHJ1ZSB9KVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IHBhZ2UubG9jYXRvcigndmlkZW8uZGVsaXZlci1wbGF5ZXJfX3ZpZGVvJykuZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQuY3VycmVudFRpbWUpKS50b0JlQ2xvc2VUbygxLjIsIDEpXG5cdFx0YXdhaXQgcGhvbmUuY2xvc2UoKVxuXHRcdGV4cGVjdCgoYXdhaXQgYXBpLmRlbGV0ZShgL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS9jb21tZW50cy8ke2lkfT9mb3JtYXQ9anNvbmApKS5vaygpKS50b0JlKHRydWUpXG5cdFx0YXdhaXQgYXBpLmRpc3Bvc2UoKVxuXHR9KVxuXG5cdHRlc3QoJ2EgZmluZ2VyIG9uIHRoZSB0aW1lbGluZSBob2xkcyBwbGF5YmFjayBhbmQgcmVzdW1lcyBvbiBsaWZ0aW5nIG9ubHkgaWYgaXQgcGxheWVkJywgYXN5bmMgKCkgPT4ge1xuXHRcdGNvbnN0IHBob25lID0gYXdhaXQgYnJvd3Nlci5uZXdDb250ZXh0KHsgYmFzZVVSTDogQlJPV1NFUl9VUkwsIC4uLlBIT05FIH0pXG5cdFx0Y29uc3QgdG91Y2hQYWdlID0gYXdhaXQgcGhvbmUubmV3UGFnZSgpXG5cdFx0YXdhaXQgbG9naW4odG91Y2hQYWdlKVxuXHRcdGF3YWl0IHRvdWNoUGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL3ZlcnNpb25zLyR7dmVyc2lvbklkfWApXG5cdFx0Y29uc3QgdmlkZW8gPSB0b3VjaFBhZ2UubG9jYXRvcigndmlkZW8uZGVsaXZlci1wbGF5ZXJfX3ZpZGVvJylcblx0XHRhd2FpdCBleHBlY3QodmlkZW8pLnRvSGF2ZUpTUHJvcGVydHkoJ3JlYWR5U3RhdGUnLCA0KVxuXHRcdGNvbnN0IGNkcCA9IGF3YWl0IHBob25lLm5ld0NEUFNlc3Npb24odG91Y2hQYWdlKVxuXHRcdGNvbnN0IGJhciA9IGF3YWl0IHRvdWNoUGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX3RpbWVsaW5lJykuYm91bmRpbmdCb3goKVxuXHRcdGNvbnN0IHkgPSBiYXIueSArIGJhci5oZWlnaHQgLyAyXG5cdFx0Y29uc3QgdG91Y2ggPSAodHlwZSwgeCkgPT4gY2RwLnNlbmQoJ0lucHV0LmRpc3BhdGNoVG91Y2hFdmVudCcsIHsgdHlwZSwgdG91Y2hQb2ludHM6IHR5cGUgPT09ICd0b3VjaEVuZCcgPyBbXSA6IFt7IHgsIHkgfV0gfSlcblx0XHRjb25zdCBwYXVzZWQgPSAoKSA9PiB2aWRlby5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5wYXVzZWQpXG5cblx0XHQvLyBQbGF5aW5nOiBoZWxkIHdoaWxlIHRoZSBmaW5nZXIgaXMgZG93biwgZ29pbmcgb24gZnJvbSB3aGVyZSBpdCBsaWZ0ZWRcblx0XHRhd2FpdCB0b3VjaFBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdQbGF5JywgZXhhY3Q6IHRydWUgfSkudGFwKClcblx0XHRhd2FpdCBleHBlY3QucG9sbChwYXVzZWQpLnRvQmUoZmFsc2UpXG5cdFx0YXdhaXQgdG91Y2goJ3RvdWNoU3RhcnQnLCBiYXIueCArIGJhci53aWR0aCAqIDAuMilcblx0XHRhd2FpdCB0b3VjaCgndG91Y2hNb3ZlJywgYmFyLnggKyBiYXIud2lkdGggKiAwLjYpXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwocGF1c2VkKS50b0JlKHRydWUpXG5cdFx0Ly8gVGhlIHBpY3R1cmUgZm9sbG93ZWQgdGhlIGZpbmdlciBiZWZvcmUgaXQgbGlmdGVkXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gdmlkZW8uZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQuY3VycmVudFRpbWUpKS50b0JlR3JlYXRlclRoYW4oMilcblx0XHRhd2FpdCB0b3VjaCgndG91Y2hFbmQnKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKHBhdXNlZCkudG9CZShmYWxzZSlcblx0XHRleHBlY3QoYXdhaXQgdmlkZW8uZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQuY3VycmVudFRpbWUpKS50b0JlR3JlYXRlclRoYW4oMilcblxuXHRcdC8vIEEgc2Vjb25kIGZpbmdlciBsYW5kcyBkdXJpbmcgdGhlIGRyYWc6IGJvdGggbGlmdCwgYW5kIGl0IHN0aWxsIGdvZXMgb25cblx0XHRhd2FpdCB0b3VjaCgndG91Y2hTdGFydCcsIGJhci54ICsgYmFyLndpZHRoICogMC4yKVxuXHRcdGF3YWl0IHRvdWNoKCd0b3VjaE1vdmUnLCBiYXIueCArIGJhci53aWR0aCAqIDAuNClcblx0XHRhd2FpdCBleHBlY3QucG9sbChwYXVzZWQpLnRvQmUodHJ1ZSlcblx0XHRhd2FpdCBjZHAuc2VuZCgnSW5wdXQuZGlzcGF0Y2hUb3VjaEV2ZW50JywgeyB0eXBlOiAndG91Y2hTdGFydCcsIHRvdWNoUG9pbnRzOiBbeyB4OiBiYXIueCArIGJhci53aWR0aCAqIDAuNCwgeSwgaWQ6IDAgfSwgeyB4OiBiYXIueCArIGJhci53aWR0aCAqIDAuNywgeSwgaWQ6IDEgfV0gfSlcblx0XHRhd2FpdCB0b3VjaCgndG91Y2hFbmQnKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKHBhdXNlZCkudG9CZShmYWxzZSlcblxuXHRcdC8vIFBhdXNlZDogc3RheXMgcGF1c2VkXG5cdFx0YXdhaXQgdG91Y2hQYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnUGF1c2UnLCBleGFjdDogdHJ1ZSB9KS50YXAoKVxuXHRcdGF3YWl0IHRvdWNoKCd0b3VjaFN0YXJ0JywgYmFyLnggKyBiYXIud2lkdGggKiAwLjIpXG5cdFx0YXdhaXQgdG91Y2goJ3RvdWNoTW92ZScsIGJhci54ICsgYmFyLndpZHRoICogMC4zKVxuXHRcdGF3YWl0IHRvdWNoKCd0b3VjaEVuZCcpXG5cdFx0YXdhaXQgdG91Y2hQYWdlLndhaXRGb3JUaW1lb3V0KDQwMClcblx0XHRleHBlY3QoYXdhaXQgcGF1c2VkKCkpLnRvQmUodHJ1ZSlcblx0XHRhd2FpdCBwaG9uZS5jbG9zZSgpXG5cdH0pXG5cblx0dGVzdCgnYSBjbGljayBvbiB0aGUgQ29tcGFyZSB0aW1lbGluZSBzdGFydHMgYSBzaWRlIHRoYXQgaGFkIHJ1biBvdXQgYWdhaW4nLCBhc3luYyAoeyBwbGF5d3JpZ2h0IH0pID0+IHtcblx0XHQvLyBUaGUgQ29tcGFyZSB0ZXN0IGxlZnQgYSBzZWNvbmQgVmVyc2lvbiBvbiB0aGUgQXNzZXRcblx0XHRjb25zdCBhcGkgPSBhd2FpdCBwbGF5d3JpZ2h0LnJlcXVlc3QubmV3Q29udGV4dCh7IGJhc2VVUkw6IFVSTCwgaHR0cENyZWRlbnRpYWxzOiBhdXRoLCBleHRyYUhUVFBIZWFkZXJzOiBvY3NIZWFkZXJzIH0pXG5cdFx0Y29uc3QgcHJvamVjdCA9IGF3YWl0IChhd2FpdCBhcGkuZ2V0KGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3Byb2plY3RzLyR7cHJvamVjdElkfT9mb3JtYXQ9anNvbmApKS5qc29uKClcblx0XHRhd2FpdCBhcGkuZGlzcG9zZSgpXG5cdFx0Y29uc3Qgc3RhY2sgPSBwcm9qZWN0Lm9jcy5kYXRhLmFzc2V0cy5maW5kKChlYWNoKSA9PiBlYWNoLnZlcnNpb25zLmxlbmd0aCA+PSAyKS52ZXJzaW9uc1xuXHRcdGF3YWl0IHBhZ2UuZ290byhgL2FwcHMvZGVsaXZlci9jb21wYXJlLyR7c3RhY2tbMV0uaWR9LyR7c3RhY2tbMF0uaWR9YClcblx0XHRjb25zdCB2aWRlb3MgPSBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbXBhcmUgdmlkZW8nKVxuXHRcdGF3YWl0IGV4cGVjdCh2aWRlb3MuZmlyc3QoKSkudG9IYXZlSlNQcm9wZXJ0eSgncmVhZHlTdGF0ZScsIDQpXG5cdFx0Ly8gQiBydW5zIDUwIEZyYW1lcyAoMiBzKSBhaGVhZCBvZiBBLCBzbyBpdCBpcyBvdXQgb2YgcGljdHVyZSBiZWZvcmUgQSBpc1xuXHRcdGF3YWl0IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tcGFyZV9fb2Zmc2V0JykuZmlsbCgnNTAnKVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6IC9eUGxheSBcXCgvIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiB2aWRlb3MubnRoKDEpLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LmVuZGVkKSwgeyB0aW1lb3V0OiAxMF8wMDAgfSkudG9CZSh0cnVlKVxuXHRcdGNvbnN0IGJhciA9IGF3YWl0IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tcGFyZV9fdGltZWxpbmUnKS5ib3VuZGluZ0JveCgpXG5cdFx0YXdhaXQgcGFnZS5tb3VzZS5jbGljayhiYXIueCArIGJhci53aWR0aCAqIDAuMSwgYmFyLnkgKyBiYXIuaGVpZ2h0IC8gMilcblx0XHRhd2FpdCBwYWdlLndhaXRGb3JUaW1lb3V0KDMwMClcblx0XHRleHBlY3QoYXdhaXQgdmlkZW9zLmZpcnN0KCkuZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQucGF1c2VkKSkudG9CZShmYWxzZSlcblx0XHRleHBlY3QoYXdhaXQgdmlkZW9zLm50aCgxKS5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5wYXVzZWQpKS50b0JlKGZhbHNlKVxuXHR9KVxuXG5cdHRlc3QoJ2RyYWdnaW5nIHRoZSBDb21wYXJlIGJhciBzZWVrcyBib3RoIHNpZGVzIGxpdmUsIEIgb2Zmc2V0IGZyb20gQSwgaG9sZHMgcGxheWJhY2sgYW5kIGdvZXMgb24gYWZ0ZXInLCBhc3luYyAoeyBwbGF5d3JpZ2h0IH0pID0+IHtcblx0XHRjb25zdCBhcGkgPSBhd2FpdCBwbGF5d3JpZ2h0LnJlcXVlc3QubmV3Q29udGV4dCh7IGJhc2VVUkw6IFVSTCwgaHR0cENyZWRlbnRpYWxzOiBhdXRoLCBleHRyYUhUVFBIZWFkZXJzOiBvY3NIZWFkZXJzIH0pXG5cdFx0Y29uc3QgcHJvamVjdCA9IGF3YWl0IChhd2FpdCBhcGkuZ2V0KGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3Byb2plY3RzLyR7cHJvamVjdElkfT9mb3JtYXQ9anNvbmApKS5qc29uKClcblx0XHRhd2FpdCBhcGkuZGlzcG9zZSgpXG5cdFx0Y29uc3Qgc3RhY2sgPSBwcm9qZWN0Lm9jcy5kYXRhLmFzc2V0cy5maW5kKChlYWNoKSA9PiBlYWNoLnZlcnNpb25zLmxlbmd0aCA+PSAyKS52ZXJzaW9uc1xuXHRcdGF3YWl0IHBhZ2UuZ290byhgL2FwcHMvZGVsaXZlci9jb21wYXJlLyR7c3RhY2tbMV0uaWR9LyR7c3RhY2tbMF0uaWR9YClcblx0XHRjb25zdCB2aWRlb3MgPSBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbXBhcmUgdmlkZW8nKVxuXHRcdGF3YWl0IGV4cGVjdCh2aWRlb3MuZmlyc3QoKSkudG9IYXZlSlNQcm9wZXJ0eSgncmVhZHlTdGF0ZScsIDQpXG5cdFx0Ly8gQiBzdGFuZHMgMjUgRnJhbWVzICgxIHMpIGFoZWFkIG9mIEFcblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbXBhcmVfX29mZnNldCcpLmZpbGwoJzI1Jylcblx0XHRjb25zdCB0aW1lcyA9ICgpID0+IHZpZGVvcy5ldmFsdWF0ZUFsbCgoYWxsKSA9PiBhbGwubWFwKCh2aWRlbykgPT4gdmlkZW8uY3VycmVudFRpbWUpKVxuXHRcdGNvbnN0IHBhdXNlZCA9ICgpID0+IHZpZGVvcy5ldmFsdWF0ZUFsbCgoYWxsKSA9PiBhbGwubWFwKCh2aWRlbykgPT4gdmlkZW8ucGF1c2VkKSlcblx0XHRjb25zdCBiYXIgPSBhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbXBhcmVfX3RpbWVsaW5lJykuYm91bmRpbmdCb3goKVxuXHRcdGNvbnN0IHkgPSBiYXIueSArIGJhci5oZWlnaHQgLyAyXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogL15QbGF5IFxcKC8gfSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKHBhdXNlZCkudG9FcXVhbChbZmFsc2UsIGZhbHNlXSlcblx0XHRhd2FpdCBwYWdlLm1vdXNlLm1vdmUoYmFyLnggKyBiYXIud2lkdGggKiAwLjEsIHkpXG5cdFx0YXdhaXQgcGFnZS5tb3VzZS5kb3duKClcblx0XHQvLyBBIHN0ZWFkeSBkcmFnOiBBIGlzIHNvdWdodCBvbmUgc2VlayBhdCBhIHRpbWUsIHRoZSBsYXRlc3QgRnJhbWUgbmV4dCwgYW5kIG5vdCBvbmNlIGZvciBldmVyeSBtb3ZlXG5cdFx0Ly8gKGEgZHJhZyBob2xkcyBwbGF5YmFjayBvbmNlOyBwYXVzaW5nIHNlZWtzIGFnYWluLCB3aGljaCB3b3VsZCBhYm9ydCB0aGUgc2VlayBvbiBpdHMgd2F5KVxuXHRcdGF3YWl0IHZpZGVvcy5maXJzdCgpLmV2YWx1YXRlKChlbGVtZW50KSA9PiB7XG5cdFx0XHRjb25zdCB7IGdldCwgc2V0IH0gPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKEhUTUxNZWRpYUVsZW1lbnQucHJvdG90eXBlLCAnY3VycmVudFRpbWUnKVxuXHRcdFx0d2luZG93LmFzc2lnbmVkID0gMFxuXHRcdFx0d2luZG93LnNldHRsZWQgPSAwXG5cdFx0XHRlbGVtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ3NlZWtlZCcsICgpID0+IHdpbmRvdy5zZXR0bGVkKyspXG5cdFx0XHRPYmplY3QuZGVmaW5lUHJvcGVydHkoZWxlbWVudCwgJ2N1cnJlbnRUaW1lJywge1xuXHRcdFx0XHRnZXQ6ICgpID0+IGdldC5jYWxsKGVsZW1lbnQpLFxuXHRcdFx0XHRzZXQ6ICh2YWx1ZSkgPT4ge1xuXHRcdFx0XHRcdHdpbmRvdy5hc3NpZ25lZCsrXG5cdFx0XHRcdFx0c2V0LmNhbGwoZWxlbWVudCwgdmFsdWUpXG5cdFx0XHRcdH0sXG5cdFx0XHR9KVxuXHRcdH0pXG5cdFx0Zm9yIChsZXQgc3RlcCA9IDE7IHN0ZXAgPD0gNjA7IHN0ZXArKykge1xuXHRcdFx0YXdhaXQgcGFnZS5tb3VzZS5tb3ZlKGJhci54ICsgYmFyLndpZHRoICogKDAuMSArIHN0ZXAgKiAwLjAwNzUpLCB5KVxuXHRcdH1cblx0XHRjb25zdCBkcmFnID0gYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PiAoeyBhc3NpZ25lZDogd2luZG93LmFzc2lnbmVkLCBzZXR0bGVkOiB3aW5kb3cuc2V0dGxlZCB9KSlcblx0XHRleHBlY3QoZHJhZy5hc3NpZ25lZCkudG9CZUxlc3NUaGFuT3JFcXVhbChkcmFnLnNldHRsZWQgKyA0KVxuXHRcdC8vIFN0aWxsIHByZXNzZWQ6IGJvdGggc2lkZXMgYXJlIHRoZXJlIGFscmVhZHksIEIgYSBzZWNvbmQgb24gZnJvbSBBLCBhbmQgbmVpdGhlciBwbGF5c1xuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKGFzeW5jICgpID0+IChhd2FpdCB0aW1lcygpKVswXSkudG9CZUdyZWF0ZXJUaGFuKDEuOClcblx0XHRhd2FpdCBleHBlY3QucG9sbChhc3luYyAoKSA9PiAoYXdhaXQgdGltZXMoKSlbMV0gLSAoYXdhaXQgdGltZXMoKSlbMF0pLnRvQmVDbG9zZVRvKDEsIDEpXG5cdFx0ZXhwZWN0KGF3YWl0IHBhdXNlZCgpKS50b0VxdWFsKFt0cnVlLCB0cnVlXSlcblx0XHRhd2FpdCBwYWdlLm1vdXNlLnVwKClcblx0XHRhd2FpdCBleHBlY3QucG9sbChwYXVzZWQpLnRvRXF1YWwoW2ZhbHNlLCBmYWxzZV0pXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnaycpXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21wYXJlX19vZmZzZXQnKS5maWxsKCcwJylcblx0fSlcblxuXHR0ZXN0KCdTaGlmdCthcnJvd3Mgc2tpcCB0ZW4gc2Vjb25kcyBpbiBDb21wYXJlLCBib3RoIHNpZGVzIHRvZ2V0aGVyJywgYXN5bmMgKHsgcGxheXdyaWdodCB9KSA9PiB7XG5cdFx0Y29uc3QgYXBpID0gYXdhaXQgcGxheXdyaWdodC5yZXF1ZXN0Lm5ld0NvbnRleHQoeyBiYXNlVVJMOiBVUkwsIGh0dHBDcmVkZW50aWFsczogYXV0aCwgZXh0cmFIVFRQSGVhZGVyczogb2NzSGVhZGVycyB9KVxuXHRcdGNvbnN0IHByb2plY3QgPSBhd2FpdCAoYXdhaXQgYXBpLmdldChgL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS9wcm9qZWN0cy8ke3Byb2plY3RJZH0/Zm9ybWF0PWpzb25gKSkuanNvbigpXG5cdFx0YXdhaXQgYXBpLmRpc3Bvc2UoKVxuXHRcdGNvbnN0IHN0YWNrID0gcHJvamVjdC5vY3MuZGF0YS5hc3NldHMuZmluZCgoZWFjaCkgPT4gZWFjaC52ZXJzaW9ucy5sZW5ndGggPj0gMikudmVyc2lvbnNcblx0XHRhd2FpdCBwYWdlLmdvdG8oYC9hcHBzL2RlbGl2ZXIvY29tcGFyZS8ke3N0YWNrWzFdLmlkfS8ke3N0YWNrWzBdLmlkfWApXG5cdFx0Y29uc3QgdmlkZW9zID0gcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21wYXJlIHZpZGVvJylcblx0XHRhd2FpdCBleHBlY3QodmlkZW9zLmZpcnN0KCkpLnRvSGF2ZUpTUHJvcGVydHkoJ3JlYWR5U3RhdGUnLCA0KVxuXHRcdGF3YWl0IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tcGFyZV9fb2Zmc2V0JykuZmlsbCgnMCcpXG5cdFx0Y29uc3QgYmFyID0gYXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21wYXJlX190aW1lbGluZScpLmJvdW5kaW5nQm94KClcblx0XHRhd2FpdCBwYWdlLm1vdXNlLmNsaWNrKGJhci54ICsgYmFyLndpZHRoICogMC41LCBiYXIueSArIGJhci5oZWlnaHQgLyAyKVxuXHRcdGF3YWl0IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItbGF5b3V0X19iYXIgaDInKS5jbGljaygpXG5cdFx0Ly8gVGVuIHNlY29uZHMgYXJlIG1vcmUgdGhhbiB0aGUgNCBzIGNsaXA6IHRoZXkgbGFuZCBvbiBpdHMgbGFzdCBGcmFtZSwgYW5kIGJhY2sgb24gdGhlIGZpcnN0XG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnU2hpZnQrQXJyb3dSaWdodCcpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tcGFyZV9fdGltZWNvZGUnKSkudG9Db250YWluVGV4dCgnMDA6MDA6MDM6MjQnKVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ1NoaWZ0K0Fycm93TGVmdCcpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tcGFyZV9fdGltZWNvZGUnKSkudG9Db250YWluVGV4dCgnMDA6MDA6MDA6MDAnKVxuXHRcdGNvbnN0IHRpbWVzID0gYXdhaXQgdmlkZW9zLmV2YWx1YXRlQWxsKChhbGwpID0+IGFsbC5tYXAoKHZpZGVvKSA9PiB2aWRlby5jdXJyZW50VGltZSkpXG5cdFx0ZXhwZWN0KHRpbWVzWzFdKS50b0JlQ2xvc2VUbyh0aW1lc1swXSwgMylcblx0fSlcblxuXHR0ZXN0KCdhIFJldmlldyBMaW5rIHJlbWVtYmVycyB0aGUgbGlzdCBmb3IgaXRzZWxmJywgYXN5bmMgKHsgcGxheXdyaWdodCB9KSA9PiB7XG5cdFx0Y29uc3QgYXBpID0gYXdhaXQgcGxheXdyaWdodC5yZXF1ZXN0Lm5ld0NvbnRleHQoeyBiYXNlVVJMOiBVUkwsIGh0dHBDcmVkZW50aWFsczogYXV0aCwgZXh0cmFIVFRQSGVhZGVyczogb2NzSGVhZGVycyB9KVxuXHRcdC8vIFRoZSBsYW5kaW5nIHBhZ2Ugb3BlbnMgb25seSB3aGVyZSBhIGxpbmsgc2hvd3Mgc2V2ZXJhbCBBc3NldHNcblx0XHRjb25zdCBkYXYgPSBgL3JlbW90ZS5waHAvZGF2L2ZpbGVzLyR7VVNFUn0vJHtmb2xkZXJ9YFxuXHRcdGNvbnN0IGNvdW50ID0gYXN5bmMgKCkgPT4gKGF3YWl0IChhd2FpdCBhcGkuZ2V0KGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3Byb2plY3RzLyR7cHJvamVjdElkfT9mb3JtYXQ9anNvbmApKS5qc29uKCkpLm9jcy5kYXRhLmFzc2V0cy5sZW5ndGhcblx0XHRjb25zdCBiZWZvcmUgPSBhd2FpdCBjb3VudCgpXG5cdFx0ZXhwZWN0KChhd2FpdCBhcGkuZmV0Y2goYCR7ZGF2fS9saW5rbGlzdC53ZWJtYCwgeyBtZXRob2Q6ICdQVVQnLCBkYXRhOiByZWFkRmlsZVN5bmMoQ0xJUCkgfSkpLnN0YXR1cygpKS50b0JlKDIwMSlcblx0XHRhd2FpdCBleHBlY3QucG9sbChjb3VudCkudG9CZShiZWZvcmUgKyAxKVxuXHRcdGNvbnN0IG1ha2UgPSBhc3luYyAoKSA9PiAoYXdhaXQgKGF3YWl0IGFwaS5wb3N0KGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3Byb2plY3RzLyR7cHJvamVjdElkfS9saW5rcz9mb3JtYXQ9anNvbmApKS5qc29uKCkpLm9jcy5kYXRhLnRva2VuXG5cdFx0Y29uc3QgW29uZSwgb3RoZXJdID0gW2F3YWl0IG1ha2UoKSwgYXdhaXQgbWFrZSgpXVxuXHRcdGF3YWl0IGFwaS5kaXNwb3NlKClcblxuXHRcdGNvbnN0IHZpc2l0b3IgPSBhd2FpdCBicm93c2VyLm5ld0NvbnRleHQoeyBiYXNlVVJMOiBCUk9XU0VSX1VSTCB9KVxuXHRcdGNvbnN0IHJldmlld2VyID0gYXdhaXQgdmlzaXRvci5uZXdQYWdlKClcblx0XHRhd2FpdCByZXZpZXdlci5nb3RvKGAvYXBwcy9kZWxpdmVyL3MvJHtvbmV9YClcblx0XHRhd2FpdCBleHBlY3QocmV2aWV3ZXIubG9jYXRvcignLmRlbGl2ZXItbGFuZGluZ19fY2FyZCcpLmZpcnN0KCkpLnRvQmVWaXNpYmxlKClcblx0XHRhd2FpdCBleHBlY3QocmV2aWV3ZXIubG9jYXRvcignLmRlbGl2ZXItbGFuZGluZ19fZ3JpZC0tbGlzdCcpKS50b0hhdmVDb3VudCgwKVxuXHRcdC8vIEFuIEFzc2V0IGlzIHBpY2tlZCBmb3IgdGhlIFpJUCBpbiBjYXJkcyBhbmQgaW4gcm93c1xuXHRcdGNvbnN0IHBpY2sgPSByZXZpZXdlci5sb2NhdG9yKCcuZGVsaXZlci1sYW5kaW5nX19waWNrOm5vdCg6ZGlzYWJsZWQpJykuZmlyc3QoKVxuXHRcdGF3YWl0IHBpY2suY2hlY2soKVxuXHRcdGF3YWl0IGV4cGVjdChyZXZpZXdlci5nZXRCeVJvbGUoJ2xpbmsnLCB7IG5hbWU6ICdEb3dubG9hZCBzZWxlY3Rpb24nIH0pKS50b0JlVmlzaWJsZSgpXG5cdFx0YXdhaXQgcGljay51bmNoZWNrKClcblx0XHRhd2FpdCBleHBlY3QocmV2aWV3ZXIuZ2V0QnlSb2xlKCdsaW5rJywgeyBuYW1lOiAnRG93bmxvYWQgc2VsZWN0aW9uJyB9KSkudG9IYXZlQ291bnQoMClcblx0XHRhd2FpdCByZXZpZXdlci5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1Nob3cgdGhlIEFzc2V0cyBhcyBhIGxpc3QnIH0pLmNsaWNrKClcblx0XHRhd2FpdCBwaWNrLmNoZWNrKClcblx0XHRhd2FpdCBleHBlY3QocmV2aWV3ZXIuZ2V0QnlSb2xlKCdsaW5rJywgeyBuYW1lOiAnRG93bmxvYWQgc2VsZWN0aW9uJyB9KSkudG9CZVZpc2libGUoKVxuXHRcdGF3YWl0IHBpY2sudW5jaGVjaygpXG5cdFx0YXdhaXQgZXhwZWN0KHJldmlld2VyLmxvY2F0b3IoJy5kZWxpdmVyLWxhbmRpbmdfX2dyaWQtLWxpc3QnKSkudG9IYXZlQ291bnQoMSlcblx0XHRhd2FpdCBleHBlY3QocmV2aWV3ZXIubG9jYXRvcignLmRlbGl2ZXItbGFuZGluZ19fZmFjdHMnKS5maXJzdCgpKS50b0NvbnRhaW5UZXh0KCdWMScpXG5cdFx0YXdhaXQgcmV2aWV3ZXIucmVsb2FkKClcblx0XHRhd2FpdCBleHBlY3QocmV2aWV3ZXIubG9jYXRvcignLmRlbGl2ZXItbGFuZGluZ19fZ3JpZC0tbGlzdCcpKS50b0hhdmVDb3VudCgxKVxuXHRcdC8vIEFub3RoZXIgbGluayBvZiB0aGUgc2FtZSBQcm9qZWN0IGlzIHN0aWxsIGNhcmRzXG5cdFx0YXdhaXQgcmV2aWV3ZXIuZ290byhgL2FwcHMvZGVsaXZlci9zLyR7b3RoZXJ9YClcblx0XHRhd2FpdCBleHBlY3QocmV2aWV3ZXIubG9jYXRvcignLmRlbGl2ZXItbGFuZGluZ19fY2FyZCcpLmZpcnN0KCkpLnRvQmVWaXNpYmxlKClcblx0XHRhd2FpdCBleHBlY3QocmV2aWV3ZXIubG9jYXRvcignLmRlbGl2ZXItbGFuZGluZ19fZ3JpZC0tbGlzdCcpKS50b0hhdmVDb3VudCgwKVxuXHRcdGF3YWl0IHZpc2l0b3IuY2xvc2UoKVxuXHRcdGNvbnN0IGNsZWFudXAgPSBhd2FpdCBwbGF5d3JpZ2h0LnJlcXVlc3QubmV3Q29udGV4dCh7IGJhc2VVUkw6IFVSTCwgaHR0cENyZWRlbnRpYWxzOiBhdXRoIH0pXG5cdFx0YXdhaXQgY2xlYW51cC5mZXRjaChgJHtkYXZ9L2xpbmtsaXN0LndlYm1gLCB7IG1ldGhvZDogJ0RFTEVURScgfSlcblx0XHRhd2FpdCBjbGVhbnVwLmRpc3Bvc2UoKVxuXHR9KVxufSlcblxudGVzdC5kZXNjcmliZSgnQXVkaW8gcmV2aWV3JywgKCkgPT4ge1xuXHRsZXQgYnJvd3NlclxuXHRsZXQgY29udGV4dFxuXHRsZXQgcGFnZVxuXHRsZXQgZm9sZGVyXG5cdGxldCB2ZXJzaW9uSWRcblx0bGV0IGNsaXBWZXJzaW9uSWRcblx0bGV0IHByb2plY3RJZFxuXG5cdHRlc3QuYmVmb3JlQWxsKGFzeW5jICh7IHBsYXl3cmlnaHQgfSkgPT4ge1xuXHRcdGF3YWl0IHRlc3RVc2VyKHBsYXl3cmlnaHQpXG5cdFx0Y29uc3QgYXBpID0gYXdhaXQgcGxheXdyaWdodC5yZXF1ZXN0Lm5ld0NvbnRleHQoeyBiYXNlVVJMOiBVUkwsIGh0dHBDcmVkZW50aWFsczogYXV0aCwgZXh0cmFIVFRQSGVhZGVyczogb2NzSGVhZGVycyB9KVxuXHRcdGZvbGRlciA9ICdkZWxpdmVyLWUyZS0nICsgcmFuZG9tQnl0ZXMoNCkudG9TdHJpbmcoJ2hleCcpXG5cdFx0Y29uc3QgZGF2ID0gYC9yZW1vdGUucGhwL2Rhdi9maWxlcy8ke1VTRVJ9LyR7Zm9sZGVyfWBcblx0XHRleHBlY3QoKGF3YWl0IGFwaS5mZXRjaChkYXYsIHsgbWV0aG9kOiAnTUtDT0wnIH0pKS5zdGF0dXMoKSkudG9CZSgyMDEpXG5cdFx0ZXhwZWN0KChhd2FpdCBhcGkuZmV0Y2goYCR7ZGF2fS9sb25nLW1peC53ZWJtYCwgeyBtZXRob2Q6ICdQVVQnLCBkYXRhOiByZWFkRmlsZVN5bmMoTE9OR19NSVgpIH0pKS5zdGF0dXMoKSkudG9CZSgyMDEpXG5cdFx0Ly8gQSB2aWRlbyBiZXNpZGUgaXQsIHRvIHN0ZXAgdG8gZnJvbSB0aGUgUmV2aWV3IHZpZXdcblx0XHRleHBlY3QoKGF3YWl0IGFwaS5mZXRjaChgJHtkYXZ9L2NsaXAud2VibWAsIHsgbWV0aG9kOiAnUFVUJywgZGF0YTogcmVhZEZpbGVTeW5jKENMSVApIH0pKS5zdGF0dXMoKSkudG9CZSgyMDEpXG5cdFx0Y29uc3QgY3JlYXRlZCA9IGF3YWl0IGFwaS5wb3N0KCcvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3Byb2plY3RzP2Zvcm1hdD1qc29uJywge1xuXHRcdFx0ZGF0YTogeyBmb2xkZXJJZDogYXdhaXQgZmlsZUlkKGFwaSwgZGF2KSwgYXV0b0ludGFrZTogdHJ1ZSB9LFxuXHRcdH0pXG5cdFx0cHJvamVjdElkID0gKGF3YWl0IGNyZWF0ZWQuanNvbigpKS5vY3MuZGF0YS5pZFxuXHRcdGNvbnN0IHByb2plY3QgPSBhd2FpdCBhcGkuZ2V0KGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3Byb2plY3RzLyR7cHJvamVjdElkfT9mb3JtYXQ9anNvbmApXG5cdFx0Y29uc3QgYXNzZXRzID0gKGF3YWl0IHByb2plY3QuanNvbigpKS5vY3MuZGF0YS5hc3NldHNcblx0XHR2ZXJzaW9uSWQgPSBhc3NldHMuZmluZCgoYXNzZXQpID0+IGFzc2V0Lm5hbWUgPT09ICdsb25nLW1peCcpLnZlcnNpb25zWzBdLmlkXG5cdFx0Y2xpcFZlcnNpb25JZCA9IGFzc2V0cy5maW5kKChhc3NldCkgPT4gYXNzZXQubmFtZSA9PT0gJ2NsaXAnKS52ZXJzaW9uc1swXS5pZFxuXHRcdGF3YWl0IGFwaS5kaXNwb3NlKClcblx0XHQvLyBmZm1wZWcgcmVhZHMgdGhlIG1peCBhbmQgbWFrZXMgaXRzIFdhdmVmb3JtXG5cdFx0ZXhlY0ZpbGVTeW5jKCdkb2NrZXInLCBbJ2NvbXBvc2UnLCAnZXhlYycsICctVCcsICctdScsICd3d3ctZGF0YScsICduZXh0Y2xvdWQnLCAncGhwJywgJ29jYycsICdkZWxpdmVyOndvcmtlcicsICctLW9uY2UnXSwgeyBzdGRpbzogJ2luaGVyaXQnIH0pXG5cblx0XHRicm93c2VyID0gYXdhaXQgY2hyb21pdW0uY29ubmVjdE92ZXJDRFAoQ0RQKVxuXHRcdGNvbnRleHQgPSBhd2FpdCBicm93c2VyLm5ld0NvbnRleHQoeyBiYXNlVVJMOiBCUk9XU0VSX1VSTCB9KVxuXHRcdHBhZ2UgPSBhd2FpdCBjb250ZXh0Lm5ld1BhZ2UoKVxuXHRcdGF3YWl0IGxvZ2luKHBhZ2UpXG5cdH0pXG5cblx0dGVzdC5hZnRlckFsbChhc3luYyAoeyBwbGF5d3JpZ2h0IH0pID0+IHtcblx0XHRhd2FpdCBjb250ZXh0Py5jbG9zZSgpXG5cdFx0YXdhaXQgYnJvd3Nlcj8uY2xvc2UoKVxuXHRcdGNvbnN0IGFwaSA9IGF3YWl0IHBsYXl3cmlnaHQucmVxdWVzdC5uZXdDb250ZXh0KHsgYmFzZVVSTDogVVJMLCBodHRwQ3JlZGVudGlhbHM6IGF1dGgsIGV4dHJhSFRUUEhlYWRlcnM6IG9jc0hlYWRlcnMgfSlcblx0XHRhd2FpdCBhcGkuZGVsZXRlKGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3Byb2plY3RzLyR7cHJvamVjdElkfT9mb3JtYXQ9anNvbmApXG5cdFx0YXdhaXQgYXBpLmZldGNoKGAvcmVtb3RlLnBocC9kYXYvZmlsZXMvJHtVU0VSfS8ke2ZvbGRlcn1gLCB7IG1ldGhvZDogJ0RFTEVURScgfSlcblx0XHRhd2FpdCBhcGkuZGlzcG9zZSgpXG5cdH0pXG5cblx0dGVzdCgnYSBsb25nIGF1ZGlvIFZlcnNpb24gb3BlbnMgem9vbWVkLCBzY3JvbGxzIHVuZGVyIGl0cyBjZW50cmVkIHBsYXloZWFkIGFuZCBzZWVrcyB3aXRob3V0IHN0b3BwaW5nJywgYXN5bmMgKCkgPT4ge1xuXHRcdGF3YWl0IHBhZ2UuZ290byhgL2FwcHMvZGVsaXZlci92ZXJzaW9ucy8ke3ZlcnNpb25JZH1gKVxuXHRcdGNvbnN0IGNhbnZhcyA9IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItd2F2ZSBjYW52YXMnKVxuXHRcdGF3YWl0IGV4cGVjdChjYW52YXMpLnRvQmVWaXNpYmxlKClcblx0XHRjb25zdCBhdWRpbyA9IHBhZ2UubG9jYXRvcigndmlkZW8uZGVsaXZlci1wbGF5ZXJfX3ZpZGVvJylcblx0XHRhd2FpdCBleHBlY3QoYXVkaW8pLnRvSGF2ZUpTUHJvcGVydHkoJ3JlYWR5U3RhdGUnLCA0KVxuXHRcdGNvbnN0IHRpbWUgPSAoKSA9PiBhdWRpby5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5jdXJyZW50VGltZSlcblx0XHQvLyBUaGUgcGxheWhlYWQgaXMgdGhlIHdoaXRlIGxpbmUgZG93biB0aGUgbWlkZGxlIG9mIHRoZSBzdGFnZVxuXHRcdGNvbnN0IGNlbnRyZSA9ICgpID0+IGNhbnZhcy5ldmFsdWF0ZSgoZWxlbWVudCkgPT4ge1xuXHRcdFx0Y29uc3QgcGl4ZWwgPSBlbGVtZW50LmdldENvbnRleHQoJzJkJykuZ2V0SW1hZ2VEYXRhKE1hdGgucm91bmQoZWxlbWVudC53aWR0aCAvIDIpIC0gMSwgZWxlbWVudC5oZWlnaHQgLSBNYXRoLnJvdW5kKDQ0ICogZWxlbWVudC53aWR0aCAvIGVsZW1lbnQuY2xpZW50V2lkdGgpLCAxLCAxKS5kYXRhXG5cdFx0XHRyZXR1cm4gcGl4ZWxbMF0gKyBwaXhlbFsxXSArIHBpeGVsWzJdXG5cdFx0fSlcblxuXHRcdC8vIE9uZSBtaW51dGUgb2YgdGhlIHNpeCBvbiB0aGUgc3RhZ2U7IG9uIHRoZSBiYXIgdW5kZXIgaXQgdGhlIGhhbGYgYWZ0ZXIgdGhlIHN0YXJ0XG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICcxIG1pbicgfSkpLnRvSGF2ZUF0dHJpYnV0ZSgnYXJpYS1wcmVzc2VkJywgJ3RydWUnKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnNSBtaW4nIH0pKS50b0JlVmlzaWJsZSgpXG5cdFx0Y29uc3Qgc2hvd24gPSBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fd2luZG93Jylcblx0XHRjb25zdCB3aWR0aCA9IGFzeW5jICgpID0+IHBhcnNlRmxvYXQoYXdhaXQgc2hvd24uZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQuc3R5bGUud2lkdGgubWF0Y2goL1tcXGQuXSslLylbMF0pKVxuXHRcdGV4cGVjdChhd2FpdCB3aWR0aCgpKS50b0JlQ2xvc2VUbygzMCAvIDM2MCAqIDEwMCwgMClcblx0XHRleHBlY3QoYXdhaXQgY2VudHJlKCkpLnRvQmUoNzY1KVxuXG5cdFx0Ly8gUGxheWluZywgdGhlIHdhdmUgbW92ZXMgdW5kZXIgdGhlIHBsYXloZWFkLCB3aGljaCBzdGF5cyBpbiB0aGUgbWlkZGxlXG5cdFx0Y29uc3Qgc3RpbGwgPSBhd2FpdCBjYW52YXMuZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQudG9EYXRhVVJMKCkpXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1BsYXkgKFNwYWNlKScgfSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKHRpbWUpLnRvQmVHcmVhdGVyVGhhbigxKVxuXHRcdGV4cGVjdChhd2FpdCBjYW52YXMuZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQudG9EYXRhVVJMKCkpKS5ub3QudG9CZShzdGlsbClcblx0XHRleHBlY3QoYXdhaXQgY2VudHJlKCkpLnRvQmUoNzY1KVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKHdpZHRoKS50b0JlR3JlYXRlclRoYW4oMzAgLyAzNjAgKiAxMDAgKyAwLjEpXG5cblx0XHQvLyBBIGNsaWNrIGluIHRoZSBzdHJpcCwgYSBxdWFydGVyIG9mIHRoZSBzdGFnZSB0byB0aGUgcmlnaHQsIGdvZXMgMTUgc2Vjb25kcyBvbiBhbmQga2VlcHMgcGxheWluZ1xuXHRcdGNvbnN0IGJveCA9IGF3YWl0IGNhbnZhcy5ib3VuZGluZ0JveCgpXG5cdFx0Y29uc3QgYmVmb3JlID0gYXdhaXQgdGltZSgpXG5cdFx0YXdhaXQgY2FudmFzLmNsaWNrKHsgcG9zaXRpb246IHsgeDogYm94LndpZHRoICogMC43NSwgeTogYm94LmhlaWdodCAtIDIwIH0gfSlcblx0XHRleHBlY3QoYXdhaXQgdGltZSgpIC0gYmVmb3JlKS50b0JlR3JlYXRlclRoYW4oMTQpXG5cdFx0ZXhwZWN0KGF3YWl0IHRpbWUoKSAtIGJlZm9yZSkudG9CZUxlc3NUaGFuKDE3KVxuXHRcdGV4cGVjdChhd2FpdCBhdWRpby5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5wYXVzZWQpKS50b0JlKGZhbHNlKVxuXG5cdFx0Ly8gQSB6b29tIHN0ZXAgbmFycm93cyB0aGUgd2luZG93LCBhbmQgdGhlIHdob2xlIHNob3dzIGFsbCBvZiBpdFxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICcxNSBzJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICcxNSBzJyB9KSkudG9IYXZlQXR0cmlidXRlKCdhcmlhLXByZXNzZWQnLCAndHJ1ZScpXG5cdFx0ZXhwZWN0KGF3YWl0IHdpZHRoKCkpLnRvQmVDbG9zZVRvKDE1IC8gMzYwICogMTAwLCAwKVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdXaG9sZScsIGV4YWN0OiB0cnVlIH0pLmNsaWNrKClcblx0XHRleHBlY3QoYXdhaXQgd2lkdGgoKSkudG9CZSgxMDApXG5cdFx0Ly8gT3ZlciB0aGUgd2hvbGUgcGllY2UgdGhlIHdhdmUgYWZ0ZXIgdGhlIHBsYXloZWFkIGlzIG5vdCBkcmF3biBhcyBwbGF5ZWRcblx0XHRjb25zdCBwbGF5ZWRBZnRlciA9IGF3YWl0IGNhbnZhcy5ldmFsdWF0ZSgoZWxlbWVudCkgPT4ge1xuXHRcdFx0Y29uc3QgcHJvYmUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzcGFuJylcblx0XHRcdHByb2JlLnN0eWxlLmNvbG9yID0gJ3ZhcigtLWNvbG9yLXByaW1hcnktZWxlbWVudCknXG5cdFx0XHRlbGVtZW50LnBhcmVudEVsZW1lbnQuYXBwZW5kKHByb2JlKVxuXHRcdFx0Y29uc3QgcHJpbWFyeSA9IGdldENvbXB1dGVkU3R5bGUocHJvYmUpLmNvbG9yLm1hdGNoKC9cXGQrL2cpLm1hcChOdW1iZXIpXG5cdFx0XHRwcm9iZS5yZW1vdmUoKVxuXHRcdFx0Y29uc3QgcmF0aW8gPSBlbGVtZW50LndpZHRoIC8gZWxlbWVudC5jbGllbnRXaWR0aFxuXHRcdFx0Y29uc3Qgcm93ID0gZWxlbWVudC5nZXRDb250ZXh0KCcyZCcpLmdldEltYWdlRGF0YShNYXRoLnJvdW5kKGVsZW1lbnQud2lkdGggLyAyKSwgTWF0aC5yb3VuZCgoNDAgKyAoZWxlbWVudC5jbGllbnRIZWlnaHQgLSA4MCkgLyAyKSAqIHJhdGlvKSwgTWF0aC5yb3VuZChlbGVtZW50LndpZHRoIC8gMiksIDEpLmRhdGFcblx0XHRcdGxldCBjb3VudCA9IDBcblx0XHRcdGZvciAobGV0IGF0ID0gMDsgYXQgPCByb3cubGVuZ3RoOyBhdCArPSA0KSB7XG5cdFx0XHRcdGNvdW50ICs9IE1hdGgubWF4KC4uLlswLCAxLCAyXS5tYXAoKGNoYW5uZWwpID0+IE1hdGguYWJzKHJvd1thdCArIGNoYW5uZWxdIC0gcHJpbWFyeVtjaGFubmVsXSkpKSA8IDggPyAxIDogMFxuXHRcdFx0fVxuXHRcdFx0cmV0dXJuIGNvdW50XG5cdFx0fSlcblx0XHRleHBlY3QocGxheWVkQWZ0ZXIpLnRvQmUoMClcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnUGF1c2UgKFNwYWNlKScgfSkuY2xpY2soKVxuXHR9KVxuXG5cdHRlc3QoJ3RoZSBiYXJzIGtlZXAgdGhlaXIgaGVpZ2h0cyBhbmQgbW92ZSBieSB3aG9sZSBwaXhlbHMgZnJvbSBvbmUgbW9tZW50IHRvIGFub3RoZXIsIG9uIGEgc3RhZ2Ugb2YgYW4gb2RkIHdpZHRoIHRvbycsIGFzeW5jICgpID0+IHtcblx0XHQvLyBBbiBvZGQgbnVtYmVyIG9mIHBpeGVscyBhY3Jvc3MsIHdoZXJlIGEgcGxheWhlYWQgYW5kIHdpbmRvdyByb3VuZGVkIGFwYXJ0IHRyZW1ibGVkXG5cdFx0YXdhaXQgcGFnZS5zZXRWaWV3cG9ydFNpemUoeyB3aWR0aDogMTI4MSwgaGVpZ2h0OiA4MDAgfSlcblx0XHRhd2FpdCBwYWdlLmdvdG8oYC9hcHBzL2RlbGl2ZXIvdmVyc2lvbnMvJHt2ZXJzaW9uSWR9YClcblx0XHRjb25zdCBjYW52YXMgPSBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXdhdmUgY2FudmFzJylcblx0XHRhd2FpdCBleHBlY3QoY2FudmFzKS50b0JlVmlzaWJsZSgpXG5cdFx0Y29uc3QgYXVkaW8gPSBwYWdlLmxvY2F0b3IoJ3ZpZGVvLmRlbGl2ZXItcGxheWVyX192aWRlbycpXG5cdFx0YXdhaXQgZXhwZWN0KGF1ZGlvKS50b0hhdmVKU1Byb3BlcnR5KCdyZWFkeVN0YXRlJywgNClcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnMSBtaW4nIH0pLmNsaWNrKClcblx0XHQvLyBUaGUgY292ZXJhZ2Ugb2YgZWFjaCBkZXZpY2UtcGl4ZWwgY29sdW1uIHJpZ2h0IG9mIHRoZSBwbGF5aGVhZCwgd2hlcmUgZXZlcnkgYmFyIGlzIGRyYXduIGFsaWtlXG5cdFx0Y29uc3QgY29sdW1ucyA9IGFzeW5jIChzZWNvbmRzKSA9PiB7XG5cdFx0XHQvLyBPbmNlIHRoZSBhdWRpbyBzdGFuZHMgdGhlcmUsIGFuZCB0aGUgc3RhZ2UgaGFzIGdsaWRlZCB0aGVyZSBhbmQgc3RhbmRzIHN0aWxsXG5cdFx0XHRhd2FpdCBhdWRpby5ldmFsdWF0ZSgoZWxlbWVudCwgYXQpID0+IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG5cdFx0XHRcdGVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcignc2Vla2VkJywgcmVzb2x2ZSwgeyBvbmNlOiB0cnVlIH0pXG5cdFx0XHRcdGVsZW1lbnQuY3VycmVudFRpbWUgPSBhdFxuXHRcdFx0fSksIHNlY29uZHMpXG5cdFx0XHRhd2FpdCBjYW52YXMuZXZhbHVhdGUoKGVsZW1lbnQpID0+IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG5cdFx0XHRcdGxldCBiZWZvcmUgPSAnJ1xuXHRcdFx0XHRjb25zdCBmcmFtZSA9ICgpID0+IHtcblx0XHRcdFx0XHRjb25zdCBub3cgPSBlbGVtZW50LnRvRGF0YVVSTCgpXG5cdFx0XHRcdFx0aWYgKG5vdyA9PT0gYmVmb3JlKSB7XG5cdFx0XHRcdFx0XHRyZXNvbHZlKClcblx0XHRcdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRcdFx0YmVmb3JlID0gbm93XG5cdFx0XHRcdFx0XHRzZXRUaW1lb3V0KCgpID0+IHJlcXVlc3RBbmltYXRpb25GcmFtZShmcmFtZSksIDUwKVxuXHRcdFx0XHRcdH1cblx0XHRcdFx0fVxuXHRcdFx0XHRyZXF1ZXN0QW5pbWF0aW9uRnJhbWUoZnJhbWUpXG5cdFx0XHR9KSlcblx0XHRcdHJldHVybiBjYW52YXMuZXZhbHVhdGUoKGVsZW1lbnQpID0+IHtcblx0XHRcdFx0Y29uc3QgcmF0aW8gPSBlbGVtZW50LndpZHRoIC8gZWxlbWVudC5jbGllbnRXaWR0aFxuXHRcdFx0XHRjb25zdCB0b3AgPSBNYXRoLnJvdW5kKDQwICogcmF0aW8pXG5cdFx0XHRcdGNvbnN0IGJvdHRvbSA9IGVsZW1lbnQuaGVpZ2h0IC0gTWF0aC5yb3VuZCg0MCAqIHJhdGlvKVxuXHRcdFx0XHRjb25zdCBkYXRhID0gZWxlbWVudC5nZXRDb250ZXh0KCcyZCcpLmdldEltYWdlRGF0YSgwLCB0b3AsIGVsZW1lbnQud2lkdGgsIGJvdHRvbSAtIHRvcCkuZGF0YVxuXHRcdFx0XHRyZXR1cm4gQXJyYXkuZnJvbSh7IGxlbmd0aDogZWxlbWVudC53aWR0aCB9LCAoXywgeCkgPT4ge1xuXHRcdFx0XHRcdGxldCBzdW0gPSAwXG5cdFx0XHRcdFx0Zm9yIChsZXQgeSA9IDA7IHkgPCBib3R0b20gLSB0b3A7IHkrKykge1xuXHRcdFx0XHRcdFx0c3VtICs9IGRhdGFbKHkgKiBlbGVtZW50LndpZHRoICsgeCkgKiA0ICsgM11cblx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0cmV0dXJuIHN1bVxuXHRcdFx0XHR9KVxuXHRcdFx0fSlcblx0XHR9XG5cdFx0Y29uc3QgYmVmb3JlID0gYXdhaXQgY29sdW1ucygxMDApXG5cdFx0Y29uc3QgYWZ0ZXIgPSBhd2FpdCBjb2x1bW5zKDEwMy4zKVxuXHRcdGNvbnN0IHdpZHRoID0gYmVmb3JlLmxlbmd0aFxuXHRcdC8vIDMuMyBzIGF0IGEgbWludXRlIGFjcm9zcyBpcyA1LjUgJSBvZiB0aGUgc3RhZ2U7IHRoZSBiZXN0IHdob2xlIHNoaWZ0IGV4cGxhaW5zIGV2ZXJ5IGNvbHVtbiBleGFjdGx5XG5cdFx0bGV0IGJlc3QgPSB7IHNoaWZ0OiAwLCBkaWZmZXJlbmNlOiBJbmZpbml0eSB9XG5cdFx0Zm9yIChsZXQgc2hpZnQgPSAwOyBzaGlmdCA8PSB3aWR0aCAvIDEwOyBzaGlmdCsrKSB7XG5cdFx0XHRsZXQgZGlmZmVyZW5jZSA9IDBcblx0XHRcdGZvciAobGV0IHggPSBNYXRoLnJvdW5kKHdpZHRoICogMC42KSArIHNoaWZ0OyB4IDwgd2lkdGggLSAyOyB4KyspIHtcblx0XHRcdFx0ZGlmZmVyZW5jZSArPSBNYXRoLmFicyhiZWZvcmVbeF0gLSBhZnRlclt4IC0gc2hpZnRdKVxuXHRcdFx0fVxuXHRcdFx0aWYgKGRpZmZlcmVuY2UgPCBiZXN0LmRpZmZlcmVuY2UpIHtcblx0XHRcdFx0YmVzdCA9IHsgc2hpZnQsIGRpZmZlcmVuY2UgfVxuXHRcdFx0fVxuXHRcdH1cblx0XHRleHBlY3QoYmVzdC5kaWZmZXJlbmNlKS50b0JlKDApXG5cdFx0ZXhwZWN0KE1hdGguYWJzKGJlc3Quc2hpZnQgLSB3aWR0aCAqIDMuMyAvIDYwKSkudG9CZUxlc3NUaGFuT3JFcXVhbCgxKVxuXHRcdGF3YWl0IHBhZ2Uuc2V0Vmlld3BvcnRTaXplKHsgd2lkdGg6IDEyODAsIGhlaWdodDogNzIwIH0pXG5cdH0pXG5cblx0dGVzdCgnYWZ0ZXIgYSBjbGljayBpbiB0aGUgc3RyaXAgdGhlIHdhdmUgZ2xpZGVzIHRvIHRoZSBuZXcgcGxhY2Ugd2l0aGluIGhhbGYgYSBzZWNvbmQsIGFuZCBqdW1wcyB1bmRlciByZWR1Y2VkIG1vdGlvbicsIGFzeW5jICgpID0+IHtcblx0XHRhd2FpdCBwYWdlLmdvdG8oYC9hcHBzL2RlbGl2ZXIvdmVyc2lvbnMvJHt2ZXJzaW9uSWR9YClcblx0XHRjb25zdCBjYW52YXMgPSBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXdhdmUgY2FudmFzJylcblx0XHRhd2FpdCBleHBlY3QoY2FudmFzKS50b0JlVmlzaWJsZSgpXG5cdFx0Y29uc3QgYXVkaW8gPSBwYWdlLmxvY2F0b3IoJ3ZpZGVvLmRlbGl2ZXItcGxheWVyX192aWRlbycpXG5cdFx0YXdhaXQgZXhwZWN0KGF1ZGlvKS50b0hhdmVKU1Byb3BlcnR5KCdyZWFkeVN0YXRlJywgNClcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnMSBtaW4nIH0pLmNsaWNrKClcblx0XHRhd2FpdCBhdWRpby5ldmFsdWF0ZSgoZWxlbWVudCkgPT4ge1xuXHRcdFx0ZWxlbWVudC5jdXJyZW50VGltZSA9IDEwMFxuXHRcdH0pXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gY2FudmFzLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LmRyYXduQXQpKS50b0JlQ2xvc2VUbygxMDAuMDAwNSwgMilcblx0XHRjb25zdCBib3ggPSBhd2FpdCBjYW52YXMuYm91bmRpbmdCb3goKVxuXHRcdC8vIFRoZSBzZWNvbmRzIGRyYXduLCBvbiBldmVyeSBmcmFtZSBmb3IgMC43IHM6IGNoZWFwIHRvIHJlY29yZCwgYW5hbHlzZWQgYWZ0ZXJ3YXJkc1xuXHRcdGNvbnN0IHJlY29yZCA9ICgpID0+IGNhbnZhcy5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcblx0XHRcdGNvbnN0IHNhbXBsZXMgPSBbXVxuXHRcdFx0Y29uc3Qgc3RhcnQgPSBwZXJmb3JtYW5jZS5ub3coKVxuXHRcdFx0Y29uc3QgZnJhbWUgPSAoKSA9PiB7XG5cdFx0XHRcdHNhbXBsZXMucHVzaCh7IGF0OiBwZXJmb3JtYW5jZS5ub3coKSAtIHN0YXJ0LCBkcmF3bjogZWxlbWVudC5kcmF3bkF0IH0pXG5cdFx0XHRcdGlmIChwZXJmb3JtYW5jZS5ub3coKSAtIHN0YXJ0IDwgNzAwKSB7XG5cdFx0XHRcdFx0cmVxdWVzdEFuaW1hdGlvbkZyYW1lKGZyYW1lKVxuXHRcdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRcdHJlc29sdmUoc2FtcGxlcylcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdFx0cmVxdWVzdEFuaW1hdGlvbkZyYW1lKGZyYW1lKVxuXHRcdH0pKVxuXHRcdGNvbnN0IHF1YXJ0ZXJPbiA9IHsgcG9zaXRpb246IHsgeDogYm94LndpZHRoICogMC43NSwgeTogYm94LmhlaWdodCAtIDIwIH0gfVxuXG5cdFx0bGV0IHJlY29yZGluZyA9IHJlY29yZCgpXG5cdFx0YXdhaXQgY2FudmFzLmNsaWNrKHF1YXJ0ZXJPbilcblx0XHRsZXQgc2FtcGxlcyA9IGF3YWl0IHJlY29yZGluZ1xuXHRcdGNvbnN0IHRhcmdldCA9IGF3YWl0IGF1ZGlvLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LmN1cnJlbnRUaW1lKVxuXHRcdGV4cGVjdCh0YXJnZXQpLnRvQmVDbG9zZVRvKDExNSwgMClcblx0XHRleHBlY3Qoc2FtcGxlcy5hdCgtMSkuZHJhd24pLnRvQmVDbG9zZVRvKHRhcmdldCwgMilcblx0XHQvLyBPbiB0aGUgd2F5LCBzb21ld2hlcmUgc3RyaWN0bHkgYmV0d2VlbiwgYW5kIHRoZXJlIHdpdGhpbiBoYWxmIGEgc2Vjb25kIG9mIHNldHRpbmcgb2ZmXG5cdFx0ZXhwZWN0KHNhbXBsZXMuc29tZSgoZWFjaCkgPT4gZWFjaC5kcmF3biA+IDEwMC41ICYmIGVhY2guZHJhd24gPCB0YXJnZXQgLSAwLjUpKS50b0JlKHRydWUpXG5cdFx0Y29uc3QgbW92ZWQgPSBzYW1wbGVzLmZpbmQoKGVhY2gpID0+IGVhY2guZHJhd24gPiAxMDAuMDEpXG5cdFx0Y29uc3QgYXJyaXZlZCA9IHNhbXBsZXMuZmluZCgoZWFjaCkgPT4gTWF0aC5hYnMoZWFjaC5kcmF3biAtIHRhcmdldCkgPCAwLjAxKVxuXHRcdGV4cGVjdChhcnJpdmVkLmF0IC0gbW92ZWQuYXQpLnRvQmVMZXNzVGhhbig1MDApXG5cblx0XHQvLyBXaXRoIHJlZHVjZWQgbW90aW9uIGl0IGlzIHRoZXJlIGF0IG9uY2Vcblx0XHRhd2FpdCBwYWdlLmVtdWxhdGVNZWRpYSh7IHJlZHVjZWRNb3Rpb246ICdyZWR1Y2UnIH0pXG5cdFx0cmVjb3JkaW5nID0gcmVjb3JkKClcblx0XHRhd2FpdCBjYW52YXMuY2xpY2socXVhcnRlck9uKVxuXHRcdHNhbXBsZXMgPSBhd2FpdCByZWNvcmRpbmdcblx0XHRleHBlY3Qoc2FtcGxlcy5ldmVyeSgoZWFjaCkgPT4gTWF0aC5hYnMoZWFjaC5kcmF3biAtIHRhcmdldCkgPCAwLjAxIHx8IE1hdGguYWJzKGVhY2guZHJhd24gLSAodGFyZ2V0ICsgMTUpKSA8IDAuMDEpKS50b0JlKHRydWUpXG5cdFx0YXdhaXQgcGFnZS5lbXVsYXRlTWVkaWEoeyByZWR1Y2VkTW90aW9uOiBudWxsIH0pXG5cdH0pXG5cblx0dGVzdCgndGhlIHdhdmUgZm9sbG93cyBhIHN3aXBlIGF0IG9uY2UsIG5ldmVyIGZhbGxzIGEgZ2xpZGUgYmVoaW5kIGEgaGVsZCBrZXksIGFuZCBhIGNsaWNrIGR1cmluZyBhIGdsaWRlIGxhbmRzIHdoZXJlIHRoZSBwb2ludGVyIGlzJywgYXN5bmMgKCkgPT4ge1xuXHRcdGF3YWl0IHBhZ2UuZ290byhgL2FwcHMvZGVsaXZlci92ZXJzaW9ucy8ke3ZlcnNpb25JZH1gKVxuXHRcdGNvbnN0IGNhbnZhcyA9IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItd2F2ZSBjYW52YXMnKVxuXHRcdGF3YWl0IGV4cGVjdChjYW52YXMpLnRvQmVWaXNpYmxlKClcblx0XHRjb25zdCBhdWRpbyA9IHBhZ2UubG9jYXRvcigndmlkZW8uZGVsaXZlci1wbGF5ZXJfX3ZpZGVvJylcblx0XHRhd2FpdCBleHBlY3QoYXVkaW8pLnRvSGF2ZUpTUHJvcGVydHkoJ3JlYWR5U3RhdGUnLCA0KVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICcxIG1pbicgfSkuY2xpY2soKVxuXHRcdGNvbnN0IGdvVG8gPSBhc3luYyAoc2Vjb25kcykgPT4ge1xuXHRcdFx0YXdhaXQgYXVkaW8uZXZhbHVhdGUoKGVsZW1lbnQsIGF0KSA9PiB7XG5cdFx0XHRcdGVsZW1lbnQuY3VycmVudFRpbWUgPSBhdFxuXHRcdFx0fSwgc2Vjb25kcylcblx0XHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IGNhbnZhcy5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5kcmF3bkF0KSkudG9CZUNsb3NlVG8oc2Vjb25kcyArIDAuMDAwNSwgMilcblx0XHR9XG5cblx0XHQvLyBBIHRyYWNrcGFkJ3Mgc2lkZXdheXMgc3dpcGUgc2VuZHMgYSB3aGVlbCBldmVudCBvbiBldmVyeSBmcmFtZTogdGhlIHdhdmUgc3RheXMgd2l0aCB0aGUgc291bmRcblx0XHRhd2FpdCBnb1RvKDEwMClcblx0XHRjb25zdCBzd2lwZSA9IGF3YWl0IGNhbnZhcy5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcblx0XHRcdGNvbnN0IGF1ZGlvID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcigndmlkZW8uZGVsaXZlci1wbGF5ZXJfX3ZpZGVvJylcblx0XHRcdGNvbnN0IGdhcHMgPSBbXVxuXHRcdFx0bGV0IGNvdW50ID0gMFxuXHRcdFx0Y29uc3QgZnJhbWUgPSAoKSA9PiB7XG5cdFx0XHRcdGdhcHMucHVzaChNYXRoLmFicyhlbGVtZW50LmRyYXduQXQgLSBhdWRpby5jdXJyZW50VGltZSkpXG5cdFx0XHRcdGlmIChjb3VudCsrIDwgNTApIHtcblx0XHRcdFx0XHRlbGVtZW50LmRpc3BhdGNoRXZlbnQobmV3IFdoZWVsRXZlbnQoJ3doZWVsJywgeyBkZWx0YVg6IDYsIGJ1YmJsZXM6IHRydWUsIGNhbmNlbGFibGU6IHRydWUgfSkpXG5cdFx0XHRcdFx0cmVxdWVzdEFuaW1hdGlvbkZyYW1lKGZyYW1lKVxuXHRcdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRcdHJlc29sdmUoeyBnYXBzLCBlbmQ6IGF1ZGlvLmN1cnJlbnRUaW1lIH0pXG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHRcdHJlcXVlc3RBbmltYXRpb25GcmFtZShmcmFtZSlcblx0XHR9KSlcblx0XHRleHBlY3Qoc3dpcGUuZW5kKS50b0JlR3JlYXRlclRoYW4oMTEwKVxuXHRcdC8vIE9uZSB3aGVlbCBldmVudCBpcyA2IHB4IG9mIDg0MDogbGVzcyB0aGFuIGhhbGYgYSBzZWNvbmRcblx0XHRleHBlY3QoTWF0aC5tYXgoLi4uc3dpcGUuZ2FwcykpLnRvQmVMZXNzVGhhbigxKVxuXG5cdFx0Ly8gU2hpZnQr4oaSIGhlbGQ6IHRoZSB3YXZlIGlzIG5ldmVyIGJlaGluZCB3aGVyZSB0aGUgc291bmQgd2FzIGEgZ2xpZGUgKGFuZCBhIGZyYW1lKSBlYXJsaWVyXG5cdFx0YXdhaXQgZ29UbygxMDApXG5cdFx0Y29uc3Qgd2F0Y2hpbmcgPSBjYW52YXMuZXZhbHVhdGUoKGVsZW1lbnQpID0+IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG5cdFx0XHRjb25zdCBhdWRpbyA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJ3ZpZGVvLmRlbGl2ZXItcGxheWVyX192aWRlbycpXG5cdFx0XHRjb25zdCBzYW1wbGVzID0gW11cblx0XHRcdGNvbnN0IHN0YXJ0ID0gcGVyZm9ybWFuY2Uubm93KClcblx0XHRcdGNvbnN0IGZyYW1lID0gKCkgPT4ge1xuXHRcdFx0XHRzYW1wbGVzLnB1c2goeyBhdDogcGVyZm9ybWFuY2Uubm93KCkgLSBzdGFydCwgZHJhd246IGVsZW1lbnQuZHJhd25BdCwgc291bmQ6IGF1ZGlvLmN1cnJlbnRUaW1lIH0pXG5cdFx0XHRcdGlmIChwZXJmb3JtYW5jZS5ub3coKSAtIHN0YXJ0IDwgMTIwMCkge1xuXHRcdFx0XHRcdHJlcXVlc3RBbmltYXRpb25GcmFtZShmcmFtZSlcblx0XHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0XHRyZXNvbHZlKHNhbXBsZXMpXG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHRcdHJlcXVlc3RBbmltYXRpb25GcmFtZShmcmFtZSlcblx0XHR9KSlcblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXJldmlld19fdGl0bGUnKS5jbGljaygpXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5kb3duKCdTaGlmdCcpXG5cdFx0Zm9yIChsZXQgcmVwZWF0ID0gMDsgcmVwZWF0IDwgMTU7IHJlcGVhdCsrKSB7XG5cdFx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdBcnJvd1JpZ2h0Jylcblx0XHRcdGF3YWl0IHBhZ2Uud2FpdEZvclRpbWVvdXQoMzMpXG5cdFx0fVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQudXAoJ1NoaWZ0Jylcblx0XHRjb25zdCBoZWxkID0gYXdhaXQgd2F0Y2hpbmdcblx0XHRjb25zdCBzb3VuZEF0ID0gKHRpbWUpID0+IFsuLi5oZWxkXS5yZXZlcnNlKCkuZmluZCgoZWFjaCkgPT4gZWFjaC5hdCA8PSB0aW1lKT8uc291bmQgPz8gMTAwXG5cdFx0Zm9yIChjb25zdCBlYWNoIG9mIGhlbGQpIHtcblx0XHRcdGV4cGVjdChlYWNoLmRyYXduKS50b0JlR3JlYXRlclRoYW5PckVxdWFsKHNvdW5kQXQoZWFjaC5hdCAtIDI1MCkgLSAwLjAxKVxuXHRcdH1cblx0XHRleHBlY3QoaGVsZC5hdCgtMSkuZHJhd24pLnRvQmVDbG9zZVRvKGhlbGQuYXQoLTEpLnNvdW5kLCAyKVxuXG5cdFx0Ly8gQSBjbGljayBpbiB0aGUgc3RyaXAgNDAgcHggcmlnaHQgb2YgdGhlIHBsYXloZWFkIHdoaWxlIGEgZ2xpZGUgcnVucyBnb2VzIHRvIHdoYXQgaXMgZHJhd24gdW5kZXIgaXQsIG5vdCBiZXNpZGUgaXRcblx0XHRhd2FpdCBnb1RvKDEwMClcblx0XHRjb25zdCBib3ggPSBhd2FpdCBjYW52YXMuYm91bmRpbmdCb3goKVxuXHRcdC8vIFR3byBjbGlja3MgaW4gdGhlIHBhZ2UgaXRzZWxmLCB0d28gZnJhbWVzIGFwYXJ0LCBzbyB0aGUgc2Vjb25kIHN1cmVseSBjb21lcyB3aGlsZSB0aGUgZmlyc3Qgb25lJ3MgZ2xpZGUgcnVuc1xuXHRcdGNvbnN0IHsgZHJhd24sIGxhbmRlZCB9ID0gYXdhaXQgY2FudmFzLmV2YWx1YXRlKChlbGVtZW50KSA9PiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuXHRcdFx0Y29uc3QgYXVkaW8gPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKCd2aWRlby5kZWxpdmVyLXBsYXllcl9fdmlkZW8nKVxuXHRcdFx0Y29uc3QgYm94ID0gZWxlbWVudC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKVxuXHRcdFx0Y29uc3QgY2xpY2sgPSAoeCkgPT4ge1xuXHRcdFx0XHRjb25zdCBhdCA9IHsgY2xpZW50WDogYm94LmxlZnQgKyB4LCBjbGllbnRZOiBib3guYm90dG9tIC0gMjAsIHBvaW50ZXJJZDogNywgcG9pbnRlclR5cGU6ICdtb3VzZScsIGJ1dHRvbjogMCwgYnViYmxlczogdHJ1ZSB9XG5cdFx0XHRcdGVsZW1lbnQuZGlzcGF0Y2hFdmVudChuZXcgUG9pbnRlckV2ZW50KCdwb2ludGVyZG93bicsIGF0KSlcblx0XHRcdFx0ZWxlbWVudC5kaXNwYXRjaEV2ZW50KG5ldyBQb2ludGVyRXZlbnQoJ3BvaW50ZXJ1cCcsIGF0KSlcblx0XHRcdH1cblx0XHRcdGNsaWNrKGJveC53aWR0aCAqIDAuNzUpXG5cdFx0XHRyZXF1ZXN0QW5pbWF0aW9uRnJhbWUoKCkgPT4gcmVxdWVzdEFuaW1hdGlvbkZyYW1lKCgpID0+IHtcblx0XHRcdFx0Y29uc3QgZHJhd24gPSBlbGVtZW50LmRyYXduQXRcblx0XHRcdFx0Y2xpY2soYm94LndpZHRoIC8gMiArIDQwKVxuXHRcdFx0XHRyZXNvbHZlKHsgZHJhd24sIGxhbmRlZDogYXVkaW8uY3VycmVudFRpbWUgfSlcblx0XHRcdH0pKVxuXHRcdH0pKVxuXHRcdGV4cGVjdChkcmF3bikudG9CZUxlc3NUaGFuKDExNC41KVxuXHRcdGV4cGVjdChNYXRoLmFicyhsYW5kZWQgLSAoZHJhd24gKyA0MCAvIGJveC53aWR0aCAqIDYwKSkpLnRvQmVMZXNzVGhhbigwLjQpXG5cdH0pXG5cblx0dGVzdCgnZHJhZ2dpbmcgdGhlIGJhciB1bmRlciB0aGUgc3RhZ2UgbW92ZXMgdGhlIHdhdmUgbGl2ZSBhbmQgbGVhdmVzIGl0IHdoZXJlIHRoZSBwbGF5aGVhZCBpcywgd2l0aCByZWR1Y2VkIG1vdGlvbiB0b28nLCBhc3luYyAoKSA9PiB7XG5cdFx0YXdhaXQgcGFnZS5lbXVsYXRlTWVkaWEoeyByZWR1Y2VkTW90aW9uOiAncmVkdWNlJyB9KVxuXHRcdGF3YWl0IHBhZ2UuZ290byhgL2FwcHMvZGVsaXZlci92ZXJzaW9ucy8ke3ZlcnNpb25JZH1gKVxuXHRcdGNvbnN0IGNhbnZhcyA9IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItd2F2ZSBjYW52YXMnKVxuXHRcdGF3YWl0IGV4cGVjdChjYW52YXMpLnRvQmVWaXNpYmxlKClcblx0XHRjb25zdCBhdWRpbyA9IHBhZ2UubG9jYXRvcigndmlkZW8uZGVsaXZlci1wbGF5ZXJfX3ZpZGVvJylcblx0XHRhd2FpdCBleHBlY3QoYXVkaW8pLnRvSGF2ZUpTUHJvcGVydHkoJ3JlYWR5U3RhdGUnLCA0KVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICcxIG1pbicgfSkuY2xpY2soKVxuXHRcdGNvbnN0IHdhdmUgPSAoKSA9PiBjYW52YXMuZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQudG9EYXRhVVJMKCkpXG5cdFx0Y29uc3QgYmFyID0gYXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX3RpbWVsaW5lJykuYm91bmRpbmdCb3goKVxuXHRcdGNvbnN0IHkgPSBiYXIueSArIGJhci5oZWlnaHQgLyAyXG5cdFx0YXdhaXQgcGFnZS5tb3VzZS5tb3ZlKGJhci54ICsgYmFyLndpZHRoICogMC4xLCB5KVxuXHRcdGNvbnN0IHN0YXJ0ID0gYXdhaXQgd2F2ZSgpXG5cdFx0YXdhaXQgcGFnZS5tb3VzZS5kb3duKClcblx0XHRhd2FpdCBwYWdlLm1vdXNlLm1vdmUoYmFyLnggKyBiYXIud2lkdGggKiAwLjUsIHksIHsgc3RlcHM6IDggfSlcblx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiBhdWRpby5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5jdXJyZW50VGltZSkpLnRvQmVHcmVhdGVyVGhhbigxNzApXG5cdFx0Ly8gVGhlIHdhdmUgbW92ZWQgd2l0aCB0aGUgcG9pbnRlciBiZWZvcmUgcmVsZWFzZVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKHdhdmUpLm5vdC50b0JlKHN0YXJ0KVxuXHRcdGF3YWl0IHBhZ2UubW91c2UubW92ZShiYXIueCArIGJhci53aWR0aCAqIDAuOSwgeSwgeyBzdGVwczogMTIgfSlcblx0XHRhd2FpdCBwYWdlLm1vdXNlLnVwKClcblx0XHRhd2FpdCBwYWdlLndhaXRGb3JUaW1lb3V0KDUwMClcblx0XHQvLyBEcmF3biBmcm9tIHRoZSB0aW1lIHRoZSBlbGVtZW50IGlzIGF0OiBhIGZyZXNoIGRyYXcgY2hhbmdlcyBub3RoaW5nXG5cdFx0Y29uc3Qgc2V0dGxlZCA9IGF3YWl0IHdhdmUoKVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICcxNSBzJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJzEgbWluJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgcGFnZS53YWl0Rm9yVGltZW91dCgzMDApXG5cdFx0ZXhwZWN0KGF3YWl0IHdhdmUoKSkudG9CZShzZXR0bGVkKVxuXHRcdC8vIEEgc2VlayB0aGF0IGNoYW5nZXMgbm8gcHJvcCBvZiB0aGUgc3RhZ2UgKHRoZSBsYXN0IG9mIGEgZHJhZyBsYW5kcyBzbywgd2hpbGUgdGhlIGRyYWcgaG9sZHMgdGltZXVwZGF0ZVxuXHRcdC8vIGJhY2spIHN0aWxsIGRyYXdzIHRoZSB3YXZlIGFnYWluOiBoZXJlIHRpbWV1cGRhdGUgaXMgc3RvcHBlZCBvbiBpdHMgd2F5IHRvIHRoZSBwbGF5ZXIuIE9uY2UgaXQgaGFzXG5cdFx0Ly8gc2V0dGxlZCwgd2hhdGV2ZXIgZWxzZSByZWRyYXdzIGlzIGxldCBnbyBvZiwgYW5kIHRoZSB3YXZlIG11c3QgZHJhdyB3aXRoaW4gdHdvIGFuaW1hdGlvbiBmcmFtZXNcblx0XHRjb25zdCBkcmF3biA9IGF3YWl0IGF1ZGlvLmV2YWx1YXRlKChlbGVtZW50KSA9PiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuXHRcdFx0d2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ3RpbWV1cGRhdGUnLCAoZXZlbnQpID0+IGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpLCB0cnVlKVxuXHRcdFx0Y29uc3QgY2xlYXIgPSBDYW52YXNSZW5kZXJpbmdDb250ZXh0MkQucHJvdG90eXBlLmNsZWFyUmVjdFxuXHRcdFx0bGV0IGRyYXdzID0gMFxuXHRcdFx0Q2FudmFzUmVuZGVyaW5nQ29udGV4dDJELnByb3RvdHlwZS5jbGVhclJlY3QgPSBmdW5jdGlvbiguLi5hcmdzKSB7XG5cdFx0XHRcdGRyYXdzKytcblx0XHRcdFx0cmV0dXJuIGNsZWFyLmFwcGx5KHRoaXMsIGFyZ3MpXG5cdFx0XHR9XG5cdFx0XHRlbGVtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ3NlZWtlZCcsICgpID0+IHtcblx0XHRcdFx0ZHJhd3MgPSAwXG5cdFx0XHRcdHJlcXVlc3RBbmltYXRpb25GcmFtZSgoKSA9PiByZXF1ZXN0QW5pbWF0aW9uRnJhbWUoKCkgPT4gcmVzb2x2ZShkcmF3cykpKVxuXHRcdFx0fSwgeyBvbmNlOiB0cnVlIH0pXG5cdFx0XHRlbGVtZW50LmN1cnJlbnRUaW1lIC09IDIwXG5cdFx0fSkpXG5cdFx0ZXhwZWN0KGRyYXduKS50b0JlR3JlYXRlclRoYW4oMClcblx0XHRhd2FpdCBwYWdlLmVtdWxhdGVNZWRpYSh7IHJlZHVjZWRNb3Rpb246ICduby1wcmVmZXJlbmNlJyB9KVxuXHR9KVxuXG5cdHRlc3QoJ2EgZHJhZyBvbiB0aGUgd2F2ZSBob2xkcyBwbGF5YmFjayBhbmQgbGV0cyBpdCBnbyBvbiwgYnV0IG5vdCBwYXN0IHRoZSBlbmQ7IEN0cmwgYW5kIHRoZSB3aGVlbCB6b29tIHdpdGhpbiB0aGUgc3RlcHMsIHJlbWVtYmVyZWQnLCBhc3luYyAoKSA9PiB7XG5cdFx0YXdhaXQgcGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL3ZlcnNpb25zLyR7dmVyc2lvbklkfWApXG5cdFx0Y29uc3QgY2FudmFzID0gcGFnZS5sb2NhdG9yKCcuZGVsaXZlci13YXZlIGNhbnZhcycpXG5cdFx0YXdhaXQgZXhwZWN0KGNhbnZhcykudG9CZVZpc2libGUoKVxuXHRcdGNvbnN0IGF1ZGlvID0gcGFnZS5sb2NhdG9yKCd2aWRlby5kZWxpdmVyLXBsYXllcl9fdmlkZW8nKVxuXHRcdGF3YWl0IGV4cGVjdChhdWRpbykudG9IYXZlSlNQcm9wZXJ0eSgncmVhZHlTdGF0ZScsIDQpXG5cdFx0Y29uc3Qgc3RhdGUgPSAoKSA9PiBhdWRpby5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gKHsgdGltZTogZWxlbWVudC5jdXJyZW50VGltZSwgcGF1c2VkOiBlbGVtZW50LnBhdXNlZCB9KSlcblx0XHRjb25zdCBzaG93biA9IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX193aW5kb3cnKVxuXHRcdGNvbnN0IHdpZHRoID0gYXN5bmMgKCkgPT4gcGFyc2VGbG9hdChhd2FpdCBzaG93bi5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5zdHlsZS53aWR0aC5tYXRjaCgvW1xcZC5dKyUvKVswXSkpXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJzEgbWluJyB9KS5jbGljaygpXG5cblx0XHQvLyBBIHF1YXJ0ZXIgb2YgdGhlIHN0YWdlIGRyYWdnZWQgdG8gdGhlIGxlZnQgaXMgMTUgc2Vjb25kcyBvbjsgcGxheWJhY2sgaG9sZHMgbWVhbndoaWxlIGFuZCBnb2VzIG9uXG5cdFx0Y29uc3QgYm94ID0gYXdhaXQgY2FudmFzLmJvdW5kaW5nQm94KClcblx0XHRjb25zdCB5ID0gYm94LnkgKyBib3guaGVpZ2h0IC8gMlxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdQbGF5IChTcGFjZSknIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QucG9sbChhc3luYyAoKSA9PiAoYXdhaXQgc3RhdGUoKSkudGltZSkudG9CZUdyZWF0ZXJUaGFuKDEpXG5cdFx0Y29uc3QgYmVmb3JlID0gKGF3YWl0IHN0YXRlKCkpLnRpbWVcblx0XHRhd2FpdCBwYWdlLm1vdXNlLm1vdmUoYm94LnggKyBib3gud2lkdGggKiAwLjc1LCB5KVxuXHRcdGF3YWl0IHBhZ2UubW91c2UuZG93bigpXG5cdFx0Zm9yIChsZXQgc3RlcCA9IDE7IHN0ZXAgPD0gMTA7IHN0ZXArKykge1xuXHRcdFx0YXdhaXQgcGFnZS5tb3VzZS5tb3ZlKGJveC54ICsgYm94LndpZHRoICogKDAuNzUgLSBzdGVwICogMC4wMjUpLCB5KVxuXHRcdH1cblx0XHRleHBlY3QoKGF3YWl0IHN0YXRlKCkpLnBhdXNlZCkudG9CZSh0cnVlKVxuXHRcdGF3YWl0IHBhZ2UubW91c2UudXAoKVxuXHRcdGNvbnN0IGFmdGVyID0gYXdhaXQgc3RhdGUoKVxuXHRcdGV4cGVjdChhZnRlci5wYXVzZWQpLnRvQmUoZmFsc2UpXG5cdFx0ZXhwZWN0KGFmdGVyLnRpbWUgLSBiZWZvcmUpLnRvQmVHcmVhdGVyVGhhbigxNClcblx0XHRleHBlY3QoYWZ0ZXIudGltZSAtIGJlZm9yZSkudG9CZUxlc3NUaGFuKDE3KVxuXG5cdFx0Ly8gRHJhZ2dlZCBwYXN0IHRoZSBlbmQgaXQgc3RheXMgdGhlcmUsIHBhdXNlZCwgYXMgYXQgdGhlIG5hdHVyYWwgZW5kLCBhbmQgZG9lcyBub3Qgc3RhcnQgb3ZlclxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdXaG9sZScsIGV4YWN0OiB0cnVlIH0pLmNsaWNrKClcblx0XHRhd2FpdCBwYWdlLm1vdXNlLm1vdmUoYm94LnggKyBib3gud2lkdGggLyAyLCB5KVxuXHRcdGF3YWl0IHBhZ2UubW91c2UuZG93bigpXG5cdFx0YXdhaXQgcGFnZS5tb3VzZS5tb3ZlKGJveC54ICsgYm94LndpZHRoICogMC44LCB5KVxuXHRcdGF3YWl0IHBhZ2UubW91c2UubW92ZShib3gueCArIGJveC53aWR0aCArIDUwLCB5KVxuXHRcdGF3YWl0IHBhZ2UubW91c2UudXAoKVxuXHRcdGF3YWl0IHBhZ2Uud2FpdEZvclRpbWVvdXQoNTAwKVxuXHRcdGNvbnN0IGVuZCA9IGF3YWl0IHN0YXRlKClcblx0XHRleHBlY3QoZW5kLnBhdXNlZCkudG9CZSh0cnVlKVxuXHRcdGV4cGVjdChlbmQudGltZSkudG9CZUdyZWF0ZXJUaGFuKDM1OSlcblxuXHRcdC8vIEN0cmwgYW5kIHRoZSB3aGVlbCB6b29tIGluIGRvd24gdG8gMTUgc2Vjb25kcyBhbmQgb3V0IHVwIHRvIHRoZSB3aG9sZSwgYW5kIGEgcmVsb2FkIGtlZXBzIGl0XG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJzEgbWluJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgYXVkaW8uZXZhbHVhdGUoKGVsZW1lbnQpID0+IHtcblx0XHRcdGVsZW1lbnQuY3VycmVudFRpbWUgPSAxODBcblx0XHR9KVxuXHRcdGF3YWl0IHBhZ2UubW91c2UubW92ZShib3gueCArIGJveC53aWR0aCAvIDIsIHkpXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5kb3duKCdDb250cm9sJylcblx0XHRmb3IgKGxldCBub3RjaCA9IDA7IG5vdGNoIDwgNTsgbm90Y2grKykge1xuXHRcdFx0YXdhaXQgcGFnZS5tb3VzZS53aGVlbCgwLCAtMTAwKVxuXHRcdH1cblx0XHRhd2FpdCBleHBlY3QocGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJzE1IHMnIH0pKS50b0hhdmVBdHRyaWJ1dGUoJ2FyaWEtcHJlc3NlZCcsICd0cnVlJylcblx0XHRleHBlY3QoYXdhaXQgd2lkdGgoKSkudG9CZUNsb3NlVG8oMTUgLyAzNjAgKiAxMDAsIDApXG5cdFx0Zm9yIChsZXQgbm90Y2ggPSAwOyBub3RjaCA8IDEyOyBub3RjaCsrKSB7XG5cdFx0XHRhd2FpdCBwYWdlLm1vdXNlLndoZWVsKDAsIDEwMClcblx0XHR9XG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC51cCgnQ29udHJvbCcpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdXaG9sZScsIGV4YWN0OiB0cnVlIH0pKS50b0hhdmVBdHRyaWJ1dGUoJ2FyaWEtcHJlc3NlZCcsICd0cnVlJylcblx0XHRhd2FpdCBwYWdlLnJlbG9hZCgpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdXaG9sZScsIGV4YWN0OiB0cnVlIH0pKS50b0hhdmVBdHRyaWJ1dGUoJ2FyaWEtcHJlc3NlZCcsICd0cnVlJylcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnMSBtaW4nIH0pLmNsaWNrKClcblx0fSlcblxuXHR0ZXN0KCdDIGNvbW1lbnRzIG9uIHRoZSB3YXZlLCBhbiBlbXB0eSBmaWVsZCBsZXRzIGdvIG9mIHRoZSBwbGFjZSwgYW5kIGEgY2lyY2xlIG9wZW5zIGEgY2FyZCB0aGF0IGZvbGxvd3MgdGhlIGxpc3QgYW5kIGtlZXBzIGEgUmVwbHkgaGFsZiB3cml0dGVuJywgYXN5bmMgKCkgPT4ge1xuXHRcdGF3YWl0IHBhZ2UuZ290byhgL2FwcHMvZGVsaXZlci92ZXJzaW9ucy8ke3ZlcnNpb25JZH1gKVxuXHRcdGNvbnN0IGNhbnZhcyA9IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItd2F2ZSBjYW52YXMnKVxuXHRcdGF3YWl0IGV4cGVjdChjYW52YXMpLnRvQmVWaXNpYmxlKClcblx0XHRjb25zdCBhdWRpbyA9IHBhZ2UubG9jYXRvcigndmlkZW8uZGVsaXZlci1wbGF5ZXJfX3ZpZGVvJylcblx0XHRhd2FpdCBleHBlY3QoYXVkaW8pLnRvSGF2ZUpTUHJvcGVydHkoJ3JlYWR5U3RhdGUnLCA0KVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICcxIG1pbicgfSkuY2xpY2soKVxuXHRcdGNvbnN0IGJveCA9IGF3YWl0IGNhbnZhcy5ib3VuZGluZ0JveCgpXG5cdFx0Y29uc3QgZmllbGQgPSBwYWdlLmxvY2F0b3IoJyNkZWxpdmVyLWNvbW1lbnQtYm9keScpXG5cdFx0Y29uc3QgYW5jaG9yID0gcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50c19fYW5jaG9yJylcblx0XHQvLyBBIHNlZWssIGFuZCB0aGUgd2F2ZSBnbGlkZWQgdGhlcmU6IGNsaWNrcyBsYW5kIG9uIHdoYXQgaXMgZHJhd25cblx0XHRjb25zdCBnb1RvID0gYXN5bmMgKHNlY29uZHMpID0+IHtcblx0XHRcdGF3YWl0IGF1ZGlvLmV2YWx1YXRlKChlbGVtZW50LCBhdCkgPT4ge1xuXHRcdFx0XHRlbGVtZW50LmN1cnJlbnRUaW1lID0gYXRcblx0XHRcdH0sIHNlY29uZHMpXG5cdFx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiBjYW52YXMuZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQuZHJhd25BdCkpLnRvQmVDbG9zZVRvKHNlY29uZHMgKyAwLjAwMDUsIDIpXG5cdFx0fVxuXHRcdGNvbnN0IHNlbmQgPSAoKSA9PiBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRzX19mb3JtIGJ1dHRvblt0aXRsZT1cIlNlbmQgKEVudGVyKVwiXScpLmNsaWNrKClcblx0XHRjb25zdCBxdWFydGVyT24gPSB7IHBvc2l0aW9uOiB7IHg6IGJveC53aWR0aCAqIDAuNzUsIHk6IGJveC5oZWlnaHQgLSAyMCB9IH1cblxuXHRcdC8vIEEgY2xpY2sgaW4gdGhlIHN0cmlwIGEgcXVhcnRlciBvZiB0aGUgc3RhZ2Ugb24gc2Vla3MgMTUgc2Vjb25kcyBvbiwgYW5kIEMgY29tbWVudHMgdGhlcmVcblx0XHRhd2FpdCBjb21tZW50T25RdWFydGVyKHBhZ2UsIGNhbnZhcywgcXVhcnRlck9uKVxuXHRcdGF3YWl0IGV4cGVjdChmaWVsZCkudG9CZUZvY3VzZWQoKVxuXHRcdGF3YWl0IGV4cGVjdChhbmNob3IpLnRvSGF2ZVRleHQoJzA6MTUuMDAwJylcblx0XHQvLyBFc2NhcGUgaW4gdGhlIGVtcHR5IGZpZWxkIGxldHMgZ28gb2YgaXQ6IHRoZSBuZXh0IENvbW1lbnQgZm9sbG93cyB0aGUgcGxheWVyIGFnYWluXG5cdFx0YXdhaXQgZmllbGQucHJlc3MoJ0VzY2FwZScpXG5cdFx0YXdhaXQgZ29Ubyg0MClcblx0XHRhd2FpdCBleHBlY3QoYW5jaG9yKS50b0hhdmVUZXh0KCcwOjQwLjAwMCcpXG5cdFx0Ly8gV2l0aCBhIHdvcmQgaW4gdGhlIGZpZWxkIHRoZSBwbGFjZSBzdGF5cywgdW50aWwgdGhlIGZpZWxkIGlzIGVtcHRpZWRcblx0XHRhd2FpdCBjb21tZW50T25RdWFydGVyKHBhZ2UsIGNhbnZhcywgcXVhcnRlck9uKVxuXHRcdGF3YWl0IGV4cGVjdChhbmNob3IpLnRvSGF2ZVRleHQoJzA6NTUuMDAwJylcblx0XHRhd2FpdCBmaWVsZC5maWxsKCdrZXB0Jylcblx0XHRhd2FpdCBmaWVsZC5wcmVzcygnRXNjYXBlJylcblx0XHRhd2FpdCBnb1RvKDEwMClcblx0XHRhd2FpdCBleHBlY3QoYW5jaG9yKS50b0hhdmVUZXh0KCcwOjU1LjAwMCcpXG5cdFx0YXdhaXQgZmllbGQuZmlsbCgnJylcblx0XHRhd2FpdCBleHBlY3QoYW5jaG9yKS50b0hhdmVUZXh0KCcxOjQwLjAwMCcpXG5cdFx0Ly8gQSBjbGljayBpbiB0aGUgc3RyaXAsIHdoaWNoIHNlZWtzLCBsZXRzIGdvIHRvb1xuXHRcdGF3YWl0IGNvbW1lbnRPblF1YXJ0ZXIocGFnZSwgY2FudmFzLCBxdWFydGVyT24pXG5cdFx0YXdhaXQgZXhwZWN0KGFuY2hvcikudG9IYXZlVGV4dCgnMTo1NS4wMDAnKVxuXHRcdC8vIE9uY2UgdGhlIHdhdmUgaGFzIGdsaWRlZCB0aGVyZTogYSBjbGljayBsYW5kcyBvbiB3aGF0IGlzIGRyYXduIHVuZGVyIGl0XG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gY2FudmFzLmV2YWx1YXRlKChlbGVtZW50KSA9PiBNYXRoLmFicyhlbGVtZW50LmRyYXduQXQgLSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKCd2aWRlby5kZWxpdmVyLXBsYXllcl9fdmlkZW8nKS5jdXJyZW50VGltZSkpKS50b0JlTGVzc1RoYW4oMC4wMSlcblx0XHRhd2FpdCBjYW52YXMuY2xpY2soeyBwb3NpdGlvbjogeyB4OiBib3gud2lkdGggKiAwLjI1LCB5OiBib3guaGVpZ2h0IC0gMjAgfSB9KVxuXHRcdGF3YWl0IGV4cGVjdChhbmNob3IpLnRvSGF2ZVRleHQoJzE6NDAuMDAwJylcblx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiBjYW52YXMuZXZhbHVhdGUoKGVsZW1lbnQpID0+IE1hdGguYWJzKGVsZW1lbnQuZHJhd25BdCAtIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJ3ZpZGVvLmRlbGl2ZXItcGxheWVyX192aWRlbycpLmN1cnJlbnRUaW1lKSkpLnRvQmVMZXNzVGhhbigwLjAxKVxuXG5cdFx0YXdhaXQgY29tbWVudE9uUXVhcnRlcihwYWdlLCBjYW52YXMsIHF1YXJ0ZXJPbilcblx0XHRhd2FpdCBleHBlY3QoYW5jaG9yKS50b0hhdmVUZXh0KCcxOjU1LjAwMCcpXG5cdFx0YXdhaXQgZmllbGQuZmlsbCgnY2xpY2tlZCBoZXJlJylcblx0XHRhd2FpdCBzZW5kKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50JykuZmlsdGVyKHsgaGFzVGV4dDogJ2NsaWNrZWQgaGVyZScgfSkpLnRvQmVWaXNpYmxlKClcblxuXHRcdC8vIEMgb24gYXVkaW8gc3RvcHMgaXQsIGFzIG9uIHZpZGVvLCB0aGUgQ29tbWVudCB3aGVyZSBpdCB3YXMgYXQgdGhlIGtleSBwcmVzc1xuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdQbGF5IChTcGFjZSknIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiBhdWRpby5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5jdXJyZW50VGltZSkpLnRvQmVHcmVhdGVyVGhhbigxMTcpXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1yZXZpZXdfX3RpdGxlJykuY2xpY2soKVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ2MnKVxuXHRcdGF3YWl0IGV4cGVjdChmaWVsZCkudG9CZUZvY3VzZWQoKVxuXHRcdGF3YWl0IHBhZ2Uud2FpdEZvclRpbWVvdXQoNTAwKVxuXHRcdGV4cGVjdChhd2FpdCBhdWRpby5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5wYXVzZWQpKS50b0JlKHRydWUpXG5cdFx0Ly8gVGhlIEZyYW1lIG9mIHRoZSBrZXkgcHJlc3M6IHdoZXJlIHRoZSBlbGVtZW50IHN0b3BwZWQsIHRvIHRoZSBtaWxsaXNlY29uZFxuXHRcdGNvbnN0IHN0b3BwZWQgPSBhd2FpdCBhdWRpby5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gTWF0aC5yb3VuZChlbGVtZW50LmN1cnJlbnRUaW1lICogMTAwMCkpXG5cdFx0Y29uc3QgY2xvY2tPZiA9IChtcykgPT4gYCR7TWF0aC5mbG9vcihtcyAvIDYwMDAwKX06JHtTdHJpbmcoTWF0aC5mbG9vcihtcyAlIDYwMDAwIC8gMTAwMCkpLnBhZFN0YXJ0KDIsICcwJyl9LiR7U3RyaW5nKG1zICUgMTAwMCkucGFkU3RhcnQoMywgJzAnKX1gXG5cdFx0Ly8gVGhlIEZyYW1lJ3Mgb3duIHRpbWUgbWF5IGRpZmZlciBmcm9tIHRoZSBlbGVtZW50J3MgYnkgdGhlIGxhc3QgbWlsbGlzZWNvbmRcblx0XHRhd2FpdCBleHBlY3QoYW5jaG9yKS50b0hhdmVUZXh0KG5ldyBSZWdFeHAoYF4oJHtjbG9ja09mKHN0b3BwZWQgLSAxKX18JHtjbG9ja09mKHN0b3BwZWQpfXwke2Nsb2NrT2Yoc3RvcHBlZCArIDEpfSkkYCkpXG5cdFx0YXdhaXQgZmllbGQuZmlsbCgnd2hpbGUgaXQgcGxheWVkJylcblx0XHRhd2FpdCBzZW5kKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50JykuZmlsdGVyKHsgaGFzVGV4dDogJ3doaWxlIGl0IHBsYXllZCcgfSkpLnRvQmVWaXNpYmxlKClcblxuXHRcdC8vIFN0YW5kaW5nIG9uIHRoZSBmaXJzdCBDb21tZW50LCBpdHMgY2lyY2xlIGlzIHVuZGVyIHRoZSBwbGF5aGVhZDsgYSBjbGljayBvbiBpdCBvcGVucyBpdHMgY2FyZCBhbmQgZG9lcyBub3Qgc2Vla1xuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICcxNSBzJyB9KS5jbGljaygpXG5cdFx0Y29uc3QgZmlyc3QgPSBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRzX19saXN0ID4gLmRlbGl2ZXItY29tbWVudCcpLmZpbHRlcih7IGhhc1RleHQ6ICdjbGlja2VkIGhlcmUnIH0pXG5cdFx0Y29uc3Qgc2Vjb25kID0gcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50c19fbGlzdCA+IC5kZWxpdmVyLWNvbW1lbnQnKS5maWx0ZXIoeyBoYXNUZXh0OiAnd2hpbGUgaXQgcGxheWVkJyB9KVxuXHRcdGNvbnN0IG9wZW5GaXJzdCA9IGFzeW5jICgpID0+IHtcblx0XHRcdGF3YWl0IGZpcnN0LmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRfX2FuY2hvcicpLmNsaWNrKClcblx0XHRcdGNvbnN0IGF0ID0gYXdhaXQgYXVkaW8uZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQuY3VycmVudFRpbWUpXG5cdFx0XHRhd2FpdCBjYW52YXMuY2xpY2soeyBwb3NpdGlvbjogeyB4OiBib3gud2lkdGggLyAyLCB5OiBib3guaGVpZ2h0IC0gMjAgfSB9KVxuXHRcdFx0ZXhwZWN0KGF3YWl0IGF1ZGlvLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LmN1cnJlbnRUaW1lKSkudG9CZShhdClcblx0XHR9XG5cdFx0YXdhaXQgb3BlbkZpcnN0KClcblx0XHRjb25zdCBjYXJkID0gcGFnZS5nZXRCeVJvbGUoJ2RpYWxvZycsIHsgbmFtZTogL15Db21tZW50ICMvIH0pXG5cdFx0YXdhaXQgZXhwZWN0KGNhcmQpLnRvQ29udGFpblRleHQoJ2NsaWNrZWQgaGVyZScpXG5cdFx0YXdhaXQgZXhwZWN0KGZpcnN0KS50b0hhdmVDbGFzcygvZGVsaXZlci1jb21tZW50LS1zZWxlY3RlZC8pXG5cdFx0Ly8gSXQgZm9sbG93cyB0aGUgbGlzdDogYW5vdGhlciBDb21tZW50IHBpY2tlZCB0aGVyZSBzaG93cyBpbiBpdFxuXHRcdGF3YWl0IHNlY29uZC5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50X19ib2R5JykuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdChjYXJkKS50b0NvbnRhaW5UZXh0KCd3aGlsZSBpdCBwbGF5ZWQnKVxuXHRcdGF3YWl0IGZpcnN0LmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRfX2JvZHknKS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KGNhcmQpLnRvQ29udGFpblRleHQoJ2NsaWNrZWQgaGVyZScpXG5cdFx0Ly8gRXNjYXBlIGxlYXZlcyBhIFJlcGx5IGhhbGYgd3JpdHRlbiBhbG9uZTsgYSBjbGljayBvbiB0aGUgYmFyIGNsb3NlcyB0aGUgY2FyZCwgYW5kIHRoZSBSZXBseSB3YWl0cyBmb3IgaXRcblx0XHRhd2FpdCBjYXJkLmdldEJ5UGxhY2Vob2xkZXIoJ1dyaXRlIGEgUmVwbHknKS5maWxsKCdoYWxmJylcblx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdFc2NhcGUnKVxuXHRcdGF3YWl0IGV4cGVjdChjYXJkKS50b0JlVmlzaWJsZSgpXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX3RpbWVsaW5lJykuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdChjYXJkKS50b0hhdmVDb3VudCgwKVxuXHRcdGF3YWl0IG9wZW5GaXJzdCgpXG5cdFx0YXdhaXQgZXhwZWN0KGNhcmQuZ2V0QnlQbGFjZWhvbGRlcignV3JpdGUgYSBSZXBseScpKS50b0hhdmVWYWx1ZSgnaGFsZicpXG5cdFx0YXdhaXQgY2FyZC5nZXRCeVBsYWNlaG9sZGVyKCdXcml0ZSBhIFJlcGx5JykuZmlsbCgnYW5zd2VyZWQgb24gdGhlIHdhdmUnKVxuXHRcdGF3YWl0IGNhcmQuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdSZXBseScsIGV4YWN0OiB0cnVlIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QoZmlyc3QubG9jYXRvcignLmRlbGl2ZXItY29tbWVudC0tcmVwbHknKSkudG9Db250YWluVGV4dCgnYW5zd2VyZWQgb24gdGhlIHdhdmUnKVxuXHRcdGF3YWl0IGV4cGVjdChjYXJkLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnQtLXJlcGx5JykpLnRvQ29udGFpblRleHQoJ2Fuc3dlcmVkIG9uIHRoZSB3YXZlJylcblx0XHQvLyBXaXRoIG5vdGhpbmcgaGFsZiB3cml0dGVuLCBFc2NhcGUgY2xvc2VzIGl0IHdoZXJldmVyIHRoZSBmb2N1cyBpc1xuXHRcdGF3YWl0IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcmV2aWV3X190aXRsZScpLmNsaWNrKClcblx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdFc2NhcGUnKVxuXHRcdGF3YWl0IGV4cGVjdChjYXJkKS50b0hhdmVDb3VudCgwKVxuXHRcdC8vIEEgZG91YmxlIGNsaWNrIG9uIHRoZSB3YXZlIHdob3NlIGZpcnN0IGNsaWNrIGNsb3NlZCB0aGUgY2FyZCBza2lwcyBub3RoaW5nXG5cdFx0YXdhaXQgb3BlbkZpcnN0KClcblx0XHRhd2FpdCBleHBlY3QoY2FyZCkudG9CZVZpc2libGUoKVxuXHRcdGNvbnN0IGNsb3NpbmcgPSBhd2FpdCBhdWRpby5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5jdXJyZW50VGltZSlcblx0XHRhd2FpdCBjYW52YXMuZGJsY2xpY2soeyBwb3NpdGlvbjogeyB4OiBib3gud2lkdGggKiAwLjk1LCB5OiBib3guaGVpZ2h0IC8gNCB9IH0pXG5cdFx0YXdhaXQgZXhwZWN0KGNhcmQpLnRvSGF2ZUNvdW50KDApXG5cdFx0ZXhwZWN0KGF3YWl0IGF1ZGlvLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LmN1cnJlbnRUaW1lKSkudG9CZShjbG9zaW5nKVxuXHR9KVxuXG5cdHRlc3QoJ3dpdGggdGhlIENvbW1lbnQgbGlzdCBoaWRkZW4sIGEgQ29tbWVudCBvbiBhdWRpbyBpcyB3cml0dGVuIGF0IHRoZSBXYXZlZm9ybSBhbmQgdGhlIGxpc3Qgc3RheXMgaGlkZGVuJywgYXN5bmMgKCkgPT4ge1xuXHRcdGF3YWl0IHBhZ2UuZ290byhgL2FwcHMvZGVsaXZlci92ZXJzaW9ucy8ke3ZlcnNpb25JZH1gKVxuXHRcdGNvbnN0IGNhbnZhcyA9IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItd2F2ZSBjYW52YXMnKVxuXHRcdGF3YWl0IGV4cGVjdChjYW52YXMpLnRvQmVWaXNpYmxlKClcblx0XHRjb25zdCBhdWRpbyA9IHBhZ2UubG9jYXRvcigndmlkZW8uZGVsaXZlci1wbGF5ZXJfX3ZpZGVvJylcblx0XHRhd2FpdCBleHBlY3QoYXVkaW8pLnRvSGF2ZUpTUHJvcGVydHkoJ3JlYWR5U3RhdGUnLCA0KVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICcxIG1pbicgfSkuY2xpY2soKVxuXHRcdGF3YWl0IGF1ZGlvLmV2YWx1YXRlKChlbGVtZW50KSA9PiB7XG5cdFx0XHRlbGVtZW50LmN1cnJlbnRUaW1lID0gMjAwXG5cdFx0fSlcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnSGlkZSBDb21tZW50cycgfSkuY2xpY2soKVxuXHRcdGNvbnN0IGxpc3QgPSBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWxheW91dF9fcGFuZWwnKVxuXHRcdGF3YWl0IGV4cGVjdChsaXN0KS50b0JlSGlkZGVuKClcblx0XHRjb25zdCBib3ggPSBhd2FpdCBjYW52YXMuYm91bmRpbmdCb3goKVxuXHRcdGNvbnN0IHF1YXJ0ZXJPbiA9IHsgcG9zaXRpb246IHsgeDogYm94LndpZHRoICogMC43NSwgeTogYm94LmhlaWdodCAtIDIwIH0gfVxuXHRcdGNvbnN0IHBvcHVwID0gcGFnZS5nZXRCeVJvbGUoJ2RpYWxvZycsIHsgbmFtZTogJ05ldyBDb21tZW50JyB9KVxuXHRcdGNvbnN0IGZpZWxkID0gcG9wdXAubG9jYXRvcignI2RlbGl2ZXItY29tbWVudC1ib2R5LWlubGluZScpXG5cblx0XHQvLyBBIGRvdWJsZSBjbGljayBvcGVucyBubyBmaWVsZFxuXHRcdGF3YWl0IGNhbnZhcy5kYmxjbGljayh7IHBvc2l0aW9uOiB7IHg6IGJveC53aWR0aCAqIDAuNzUsIHk6IGJveC5oZWlnaHQgLyAyIH0gfSlcblx0XHRhd2FpdCBleHBlY3QocG9wdXApLnRvSGF2ZUNvdW50KDApXG5cdFx0YXdhaXQgY2FudmFzLmRibGNsaWNrKHF1YXJ0ZXJPbilcblx0XHRhd2FpdCBleHBlY3QocG9wdXApLnRvSGF2ZUNvdW50KDApXG5cdFx0YXdhaXQgYXVkaW8uZXZhbHVhdGUoKGVsZW1lbnQpID0+IHtcblx0XHRcdGVsZW1lbnQuY3VycmVudFRpbWUgPSAyMDBcblx0XHR9KVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IGNhbnZhcy5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gTWF0aC5hYnMoZWxlbWVudC5kcmF3bkF0IC0gMjAwKSkpLnRvQmVMZXNzVGhhbigwLjAxKVxuXHRcdC8vIEMgb3BlbnMgdGhlIGZpZWxkIGF0IHRoZSB3YXZlLCBhdCB0aGF0IEZyYW1lLCBpbnN0ZWFkIG9mIHRoZSBsaXN0XG5cdFx0YXdhaXQgY29tbWVudE9uUXVhcnRlcihwYWdlLCBjYW52YXMsIHF1YXJ0ZXJPbilcblx0XHRhd2FpdCBleHBlY3QocG9wdXApLnRvQmVWaXNpYmxlKClcblx0XHRhd2FpdCBleHBlY3QoZmllbGQpLnRvQmVGb2N1c2VkKClcblx0XHRhd2FpdCBleHBlY3QocG9wdXAubG9jYXRvcignLmRlbGl2ZXItY29tbWVudHNfX2FuY2hvcicpKS50b0hhdmVUZXh0KCczOjM1LjAwMCcpXG5cdFx0YXdhaXQgZmllbGQuZmlsbCgnd3JpdHRlbiBhdCB0aGUgd2F2ZScpXG5cdFx0YXdhaXQgZmllbGQucHJlc3MoJ0VudGVyJylcblx0XHRhd2FpdCBleHBlY3QocG9wdXApLnRvSGF2ZUNvdW50KDApXG5cdFx0YXdhaXQgZXhwZWN0KGxpc3QpLnRvQmVIaWRkZW4oKVxuXHRcdC8vIEl0cyBjaXJjbGUgc3RhbmRzIHVuZGVyIHRoZSBwbGF5aGVhZCwgd2hpY2ggc3RhbmRzIG9uIGl0cyBGcmFtZVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IGNhbnZhcy5ldmFsdWF0ZSgoZWxlbWVudCkgPT4ge1xuXHRcdFx0Y29uc3QgcmF0aW8gPSBlbGVtZW50LndpZHRoIC8gZWxlbWVudC5jbGllbnRXaWR0aFxuXHRcdFx0Y29uc3QgcGl4ZWwgPSBlbGVtZW50LmdldENvbnRleHQoJzJkJykuZ2V0SW1hZ2VEYXRhKE1hdGgucm91bmQoZWxlbWVudC53aWR0aCAvIDIpICsgTWF0aC5yb3VuZCg4ICogcmF0aW8pLCBlbGVtZW50LmhlaWdodCAtIE1hdGgucm91bmQoMjAgKiByYXRpbyksIDEsIDEpLmRhdGFcblx0XHRcdHJldHVybiBwaXhlbFszXVxuXHRcdH0pKS50b0JlR3JlYXRlclRoYW4oMClcblxuXHRcdC8vIEVzY2FwZSBvbiB0aGUgZW1wdHkgZmllbGQgY2xvc2VzIGl0IGFuZCBsZXRzIGdvIG9mIHRoZSBwbGFjZVxuXHRcdGF3YWl0IGNvbW1lbnRPblF1YXJ0ZXIocGFnZSwgY2FudmFzLCBxdWFydGVyT24pXG5cdFx0YXdhaXQgZXhwZWN0KGZpZWxkKS50b0JlRm9jdXNlZCgpXG5cdFx0YXdhaXQgZmllbGQucHJlc3MoJ0VzY2FwZScpXG5cdFx0YXdhaXQgZXhwZWN0KHBvcHVwKS50b0hhdmVDb3VudCgwKVxuXHRcdGF3YWl0IGF1ZGlvLmV2YWx1YXRlKChlbGVtZW50KSA9PiB7XG5cdFx0XHRlbGVtZW50LmN1cnJlbnRUaW1lID0gMjUwXG5cdFx0fSlcblxuXHRcdC8vIFRoZSBkcmFmdCBpcyB0aGUgbGlzdCdzOiBvcGVuaW5nIHRoZSBsaXN0IG1pZC1zZW50ZW5jZSB0YWtlcyBpdCB0aGVyZSBhbmQgY2xvc2VzIHRoZSBmaWVsZCBhdCB0aGUgd2F2ZVxuXHRcdGF3YWl0IGNvbW1lbnRPblF1YXJ0ZXIocGFnZSwgY2FudmFzLCBxdWFydGVyT24pXG5cdFx0YXdhaXQgZmllbGQuZmlsbCgnaGFsZiBhIHRob3VnaHQnKVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdTaG93IENvbW1lbnRzJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KHBvcHVwKS50b0hhdmVDb3VudCgwKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJyNkZWxpdmVyLWNvbW1lbnQtYm9keScpKS50b0hhdmVWYWx1ZSgnaGFsZiBhIHRob3VnaHQnKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRzX19saXN0JykpLnRvQ29udGFpblRleHQoJ3dyaXR0ZW4gYXQgdGhlIHdhdmUnKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRzX19hbmNob3InKSkudG9IYXZlVGV4dCgnNDoyNS4wMDAnKVxuXHRcdC8vIEVtcHRpZWQsIHRoZSBmaWVsZCBmb2xsb3dzIHRoZSBwbGF5ZXIgYWdhaW5cblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJyNkZWxpdmVyLWNvbW1lbnQtYm9keScpLmZpbGwoJycpXG5cdFx0YXdhaXQgYXVkaW8uZXZhbHVhdGUoKGVsZW1lbnQpID0+IHtcblx0XHRcdGVsZW1lbnQuY3VycmVudFRpbWUgPSAzMDBcblx0XHR9KVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRzX19hbmNob3InKSkudG9IYXZlVGV4dCgnNTowMC4wMDAnKVxuXHR9KVxuXG5cdHRlc3QoJ3RoZSBmaWVsZCBhdCB0aGUgV2F2ZWZvcm0ga2VlcHMgaXRzIHBsYWNlIHdoaWxlIGVtcHR5LCB0YWtlcyBpdHMgb3duIGJ1dHRvbnMsIGtlZXBzIHRleHQgb24gYW4gb3V0c2lkZSBjbGljaywgYW5kIG5ldmVyIHNob3dzIHdpdGggYSBDb21tZW50IGNhcmQnLCBhc3luYyAoKSA9PiB7XG5cdFx0YXdhaXQgcGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL3ZlcnNpb25zLyR7dmVyc2lvbklkfWApXG5cdFx0Y29uc3QgY2FudmFzID0gcGFnZS5sb2NhdG9yKCcuZGVsaXZlci13YXZlIGNhbnZhcycpXG5cdFx0YXdhaXQgZXhwZWN0KGNhbnZhcykudG9CZVZpc2libGUoKVxuXHRcdGNvbnN0IGF1ZGlvID0gcGFnZS5sb2NhdG9yKCd2aWRlby5kZWxpdmVyLXBsYXllcl9fdmlkZW8nKVxuXHRcdGF3YWl0IGV4cGVjdChhdWRpbykudG9IYXZlSlNQcm9wZXJ0eSgncmVhZHlTdGF0ZScsIDQpXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJzEgbWluJyB9KS5jbGljaygpXG5cdFx0Ly8gU3RhbmRpbmcgb24gdGhlIENvbW1lbnQgd3JpdHRlbiBhdCB0aGUgd2F2ZSBiZWZvcmUsIDM6MzVcblx0XHRhd2FpdCBhdWRpby5ldmFsdWF0ZSgoZWxlbWVudCkgPT4ge1xuXHRcdFx0ZWxlbWVudC5jdXJyZW50VGltZSA9IDIxNVxuXHRcdH0pXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gY2FudmFzLmV2YWx1YXRlKChlbGVtZW50KSA9PiBNYXRoLmFicyhlbGVtZW50LmRyYXduQXQgLSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKCd2aWRlby5kZWxpdmVyLXBsYXllcl9fdmlkZW8nKS5jdXJyZW50VGltZSkpKS50b0JlTGVzc1RoYW4oMC4wMSlcblx0XHRpZiAoYXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ0hpZGUgQ29tbWVudHMnIH0pLmlzVmlzaWJsZSgpKSB7XG5cdFx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnSGlkZSBDb21tZW50cycgfSkuY2xpY2soKVxuXHRcdH1cblx0XHRjb25zdCBib3ggPSBhd2FpdCBjYW52YXMuYm91bmRpbmdCb3goKVxuXHRcdGNvbnN0IHF1YXJ0ZXJPbiA9IHsgcG9zaXRpb246IHsgeDogYm94LndpZHRoICogMC43NSwgeTogYm94LmhlaWdodCAtIDIwIH0gfVxuXHRcdGNvbnN0IHBvcHVwID0gcGFnZS5nZXRCeVJvbGUoJ2RpYWxvZycsIHsgbmFtZTogJ05ldyBDb21tZW50JyB9KVxuXHRcdGNvbnN0IGZpZWxkID0gcG9wdXAubG9jYXRvcignI2RlbGl2ZXItY29tbWVudC1ib2R5LWlubGluZScpXG5cdFx0Y29uc3QgYW5jaG9yID0gcG9wdXAubG9jYXRvcignLmRlbGl2ZXItY29tbWVudHNfX2FuY2hvcicpXG5cblx0XHQvLyBFbXB0aWVkIGFnYWluLCBpdCBzdGF5cyB3aXRoIGl0cyBwbGFjZSwgYW5kIGtleXMgZ28gb24gaW50byB0aGUgZmllbGQsIG5vdCB0byB0aGUgcGxheWVyXG5cdFx0YXdhaXQgY29tbWVudE9uUXVhcnRlcihwYWdlLCBjYW52YXMsIHF1YXJ0ZXJPbilcblx0XHRhd2FpdCBleHBlY3QoYW5jaG9yKS50b0hhdmVUZXh0KCczOjUwLjAwMCcpXG5cdFx0YXdhaXQgZmllbGQucHJlc3NTZXF1ZW50aWFsbHkoJ2FiJylcblx0XHRhd2FpdCBmaWVsZC5wcmVzcygnQmFja3NwYWNlJylcblx0XHRhd2FpdCBmaWVsZC5wcmVzcygnQmFja3NwYWNlJylcblx0XHRhd2FpdCBleHBlY3QocG9wdXApLnRvQmVWaXNpYmxlKClcblx0XHRhd2FpdCBleHBlY3QoZmllbGQpLnRvQmVGb2N1c2VkKClcblx0XHRhd2FpdCBmaWVsZC5wcmVzcygnaycpXG5cdFx0YXdhaXQgZXhwZWN0KGZpZWxkKS50b0hhdmVWYWx1ZSgnaycpXG5cdFx0ZXhwZWN0KGF3YWl0IGF1ZGlvLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LnBhdXNlZCkpLnRvQmUodHJ1ZSlcblx0XHRhd2FpdCBmaWVsZC5maWxsKCcnKVxuXG5cdFx0Ly8gSXRzIG93biBidXR0b25zIGRvIG5vdCBsZXQgZ28gb2YgYW4gZW1wdHkgZmllbGQ6IHRoZSBwYXBlcmNsaXAgb3BlbnMgdGhlIGZpbGUgZGlhbG9nLCB0aGUgUmFuZ2Ugc3RhcnRzXG5cdFx0Y29uc3QgY2hvb3NlciA9IHBhZ2Uud2FpdEZvckV2ZW50KCdmaWxlY2hvb3NlcicpXG5cdFx0YXdhaXQgcG9wdXAuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdBdHRhY2ggZmlsZXMnIH0pLmNsaWNrKClcblx0XHRhd2FpdCAoYXdhaXQgY2hvb3Nlcikuc2V0RmlsZXMoW10pXG5cdFx0YXdhaXQgZXhwZWN0KHBvcHVwKS50b0JlVmlzaWJsZSgpXG5cdFx0YXdhaXQgcG9wdXAuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdTdGFydCBhIFJhbmdlIGhlcmUnIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QocG9wdXApLnRvQmVWaXNpYmxlKClcblx0XHRhd2FpdCBleHBlY3QocG9wdXAuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdFbmQgdGhlIFJhbmdlIGhlcmUnIH0pKS50b0JlVmlzaWJsZSgpXG5cdFx0Ly8gRW5kaW5nIGFuZCBjbGVhcmluZyB0aGUgUmFuZ2Uga2VlcCB0aGUgY2FyZCBhbmQgYSBwbGFjZSwgd2l0aCBhbmQgd2l0aG91dCB0ZXh0XG5cdFx0YXdhaXQgcG9wdXAuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdFbmQgdGhlIFJhbmdlIGhlcmUnIH0pLmNsaWNrKClcblx0XHRhd2FpdCBwb3B1cC5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ0NsZWFyIHRoZSBSYW5nZScgfSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdChwb3B1cCkudG9CZVZpc2libGUoKVxuXHRcdGF3YWl0IGV4cGVjdChmaWVsZCkudG9CZUZvY3VzZWQoKVxuXHRcdGF3YWl0IGZpZWxkLmZpbGwoJ2Fib3V0IHRoaXMgc3RyZXRjaCcpXG5cdFx0YXdhaXQgcG9wdXAuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdTdGFydCBhIFJhbmdlIGhlcmUnIH0pLmNsaWNrKClcblx0XHRhd2FpdCBwb3B1cC5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ0VuZCB0aGUgUmFuZ2UgaGVyZScgfSkuY2xpY2soKVxuXHRcdGF3YWl0IHBvcHVwLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnQ2xlYXIgdGhlIFJhbmdlJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KHBvcHVwKS50b0JlVmlzaWJsZSgpXG5cdFx0YXdhaXQgZXhwZWN0KGZpZWxkKS50b0hhdmVWYWx1ZSgnYWJvdXQgdGhpcyBzdHJldGNoJylcblx0XHRhd2FpdCBmaWVsZC5maWxsKCcnKVxuXHRcdC8vIEEgZmlsZSdzIOKclSBnb2VzIGF3YXkgd2hlbiBjbGlja2VkOiB0aGUgY2FyZCBzdGF5cywgdGhlIGZvY3VzIGdvZXMgYmFjayBpbnRvIHRoZSBmaWVsZFxuXHRcdGNvbnN0IHBpY2tpbmcgPSBwYWdlLndhaXRGb3JFdmVudCgnZmlsZWNob29zZXInKVxuXHRcdGF3YWl0IHBvcHVwLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnQXR0YWNoIGZpbGVzJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgKGF3YWl0IHBpY2tpbmcpLnNldEZpbGVzKHsgbmFtZTogJ3dyb25nLnR4dCcsIG1pbWVUeXBlOiAndGV4dC9wbGFpbicsIGJ1ZmZlcjogQnVmZmVyLmZyb20oJ3gnKSB9KVxuXHRcdGF3YWl0IHBvcHVwLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnUmVtb3ZlIHdyb25nLnR4dCcgfSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdChwb3B1cCkudG9CZVZpc2libGUoKVxuXHRcdGF3YWl0IGV4cGVjdChmaWVsZCkudG9CZUZvY3VzZWQoKVxuXHRcdC8vIEFzIGluIFNhZmFyaSwgd2hlcmUgYSBjbGlja2VkIGJ1dHRvbiB0YWtlcyBubyBmb2N1czogdGhlIGZpZWxkIGlzIGxlZnQgZm9yIHRoZSBwYWdlLCBhbmQgc3RpbGwgdGhlIGNhcmQgc3RheXNcblx0XHRhd2FpdCBwb3B1cC5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1N0YXJ0IGEgUmFuZ2UgaGVyZScgfSkuZXZhbHVhdGUoKGJ1dHRvbikgPT4gYnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNlZG93bicsIChldmVudCkgPT4ge1xuXHRcdFx0ZXZlbnQucHJldmVudERlZmF1bHQoKVxuXHRcdFx0ZG9jdW1lbnQuYWN0aXZlRWxlbWVudC5ibHVyKClcblx0XHR9KSlcblx0XHRhd2FpdCBwb3B1cC5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1N0YXJ0IGEgUmFuZ2UgaGVyZScgfSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdChwb3B1cCkudG9CZVZpc2libGUoKVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ0VzY2FwZScpXG5cdFx0YXdhaXQgZXhwZWN0KHBvcHVwKS50b0hhdmVDb3VudCgwKVxuXG5cdFx0Ly8gV2l0aCB0ZXh0LCBhIGNsaWNrIG91dHNpZGUgbGVhdmVzIGl0IG9wZW47IGVtcHRpZWQsIHRoZSBuZXh0IG9uZSBjbG9zZXMgaXRcblx0XHRhd2FpdCBjb21tZW50T25RdWFydGVyKHBhZ2UsIGNhbnZhcywgcXVhcnRlck9uKVxuXHRcdGF3YWl0IGZpZWxkLmZpbGwoJ2tlcHQnKVxuXHRcdGF3YWl0IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcmV2aWV3X190aXRsZScpLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QocG9wdXApLnRvQmVWaXNpYmxlKClcblx0XHRhd2FpdCBleHBlY3QoZmllbGQpLnRvSGF2ZVZhbHVlKCdrZXB0Jylcblx0XHRhd2FpdCBmaWVsZC5maWxsKCcnKVxuXHRcdGF3YWl0IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcmV2aWV3X190aXRsZScpLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QocG9wdXApLnRvSGF2ZUNvdW50KDApXG5cblx0XHQvLyBBIENvbW1lbnQncyBjYXJkIGFuZCB0aGUgZmllbGQgbmV2ZXIgc2hvdyBhdCBvbmNlXG5cdFx0YXdhaXQgYXVkaW8uZXZhbHVhdGUoKGVsZW1lbnQpID0+IHtcblx0XHRcdGVsZW1lbnQuY3VycmVudFRpbWUgPSAyMTVcblx0XHR9KVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IGNhbnZhcy5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gTWF0aC5hYnMoZWxlbWVudC5kcmF3bkF0IC0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcigndmlkZW8uZGVsaXZlci1wbGF5ZXJfX3ZpZGVvJykuY3VycmVudFRpbWUpKSkudG9CZUxlc3NUaGFuKDAuMDEpXG5cdFx0YXdhaXQgY29tbWVudE9uUXVhcnRlcihwYWdlLCBjYW52YXMsIHF1YXJ0ZXJPbilcblx0XHRhd2FpdCBleHBlY3QocG9wdXApLnRvQmVWaXNpYmxlKClcblx0XHQvLyAzOjM1IGlzIGEgcXVhcnRlciBvZiB0aGUgc3RhZ2UgbGVmdCBvZiB0aGUgcGxheWhlYWQgbm93IHN0YW5kaW5nIGF0IDM6NTAsIG9uY2UgdGhlIHdhdmUgaGFzIGdsaWRlZCB0aGVyZVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IGNhbnZhcy5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gTWF0aC5hYnMoZWxlbWVudC5kcmF3bkF0IC0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcigndmlkZW8uZGVsaXZlci1wbGF5ZXJfX3ZpZGVvJykuY3VycmVudFRpbWUpKSkudG9CZUxlc3NUaGFuKDAuMDEpXG5cdFx0YXdhaXQgY2FudmFzLmNsaWNrKHsgcG9zaXRpb246IHsgeDogYm94LndpZHRoICogMC4yNSwgeTogYm94LmhlaWdodCAtIDIwIH0gfSlcblx0XHRjb25zdCBjYXJkID0gcGFnZS5nZXRCeVJvbGUoJ2RpYWxvZycsIHsgbmFtZTogL15Db21tZW50ICMvIH0pXG5cdFx0YXdhaXQgZXhwZWN0KGNhcmQpLnRvQ29udGFpblRleHQoJ3dyaXR0ZW4gYXQgdGhlIHdhdmUnKVxuXHRcdGF3YWl0IGV4cGVjdChwb3B1cCkudG9IYXZlQ291bnQoMClcblx0XHRhd2FpdCBjb21tZW50T25RdWFydGVyKHBhZ2UsIGNhbnZhcywgcXVhcnRlck9uKVxuXHRcdGF3YWl0IGV4cGVjdChwb3B1cCkudG9CZVZpc2libGUoKVxuXHRcdGF3YWl0IGV4cGVjdChjYXJkKS50b0hhdmVDb3VudCgwKVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ0VzY2FwZScpXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1Nob3cgQ29tbWVudHMnIH0pLmNsaWNrKClcblx0fSlcblxuXHR0ZXN0KCd1bmRlciB0aGUgbGlzdCBhbiBlbXB0eSBwaW5uZWQgZmllbGQgbGV0cyBnbyBvbiBhIGNsaWNrIGVsc2V3aGVyZSBhbmQgb24gYW5vdGhlciBDb21tZW50XFwncyBSZXBseSwgYnV0IG5vdCBvbiBpdHMgb3duIGJ1dHRvbnMnLCBhc3luYyAoKSA9PiB7XG5cdFx0YXdhaXQgcGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL3ZlcnNpb25zLyR7dmVyc2lvbklkfWApXG5cdFx0Y29uc3QgY2FudmFzID0gcGFnZS5sb2NhdG9yKCcuZGVsaXZlci13YXZlIGNhbnZhcycpXG5cdFx0YXdhaXQgZXhwZWN0KGNhbnZhcykudG9CZVZpc2libGUoKVxuXHRcdGNvbnN0IGF1ZGlvID0gcGFnZS5sb2NhdG9yKCd2aWRlby5kZWxpdmVyLXBsYXllcl9fdmlkZW8nKVxuXHRcdGF3YWl0IGV4cGVjdChhdWRpbykudG9IYXZlSlNQcm9wZXJ0eSgncmVhZHlTdGF0ZScsIDQpXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJzEgbWluJyB9KS5jbGljaygpXG5cdFx0aWYgKGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdTaG93IENvbW1lbnRzJyB9KS5pc1Zpc2libGUoKSkge1xuXHRcdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1Nob3cgQ29tbWVudHMnIH0pLmNsaWNrKClcblx0XHR9XG5cdFx0Y29uc3QgYW5jaG9yID0gcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50c19fYW5jaG9yJylcblx0XHRjb25zdCBnb1RvID0gYXN5bmMgKHNlY29uZHMpID0+IHtcblx0XHRcdGF3YWl0IGF1ZGlvLmV2YWx1YXRlKChlbGVtZW50LCBhdCkgPT4ge1xuXHRcdFx0XHRlbGVtZW50LmN1cnJlbnRUaW1lID0gYXRcblx0XHRcdH0sIHNlY29uZHMpXG5cdFx0XHRhd2FpdCBleHBlY3QoYW5jaG9yKS50b0hhdmVUZXh0KG5ldyBSZWdFeHAoYF4ke01hdGguZmxvb3Ioc2Vjb25kcyAvIDYwKX06JHtTdHJpbmcoc2Vjb25kcyAlIDYwKS5wYWRTdGFydCgyLCAnMCcpfWApKVxuXHRcdH1cblx0XHRhd2FpdCBnb1RvKDIwKVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ2MnKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJyNkZWxpdmVyLWNvbW1lbnQtYm9keScpKS50b0JlRm9jdXNlZCgpXG5cdFx0Ly8gSXRzIG93biBwYXBlcmNsaXAga2VlcHMgdGhlIHBsYWNlXG5cdFx0Y29uc3QgcGlja2luZyA9IHBhZ2Uud2FpdEZvckV2ZW50KCdmaWxlY2hvb3NlcicpXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50c19fZm9ybScpLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnQXR0YWNoIGZpbGVzJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgKGF3YWl0IHBpY2tpbmcpLnNldEZpbGVzKFtdKVxuXHRcdGF3YWl0IGF1ZGlvLmV2YWx1YXRlKChlbGVtZW50KSA9PiB7XG5cdFx0XHRlbGVtZW50LmN1cnJlbnRUaW1lID0gMzBcblx0XHR9KVxuXHRcdGF3YWl0IGV4cGVjdChhbmNob3IpLnRvSGF2ZVRleHQoL14wOjIwLylcblx0XHQvLyBBIGNsaWNrIGVsc2V3aGVyZSBsZXRzIGdvXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1yZXZpZXdfX3RpdGxlJykuY2xpY2soKVxuXHRcdGF3YWl0IGdvVG8oNDApXG5cdFx0Ly8gU28gZG9lcyBhIGNsaWNrIGludG8gYW5vdGhlciBDb21tZW50J3MgUmVwbHlcblx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdjJylcblx0XHRhd2FpdCBleHBlY3QoYW5jaG9yKS50b0hhdmVUZXh0KC9eMDo0MC8pXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50c19fbGlzdCA+IC5kZWxpdmVyLWNvbW1lbnQnKS5maXJzdCgpLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnUmVwbHknLCBleGFjdDogdHJ1ZSB9KS5jbGljaygpXG5cdFx0YXdhaXQgZ29Ubyg1MClcblx0fSlcblxuXHR0ZXN0KCdhIENvbW1lbnQgaGFsZiB3cml0dGVuIHN0YXlzIHdpdGggaXRzIFZlcnNpb246IG9uIHRoZSBuZXh0IEFzc2V0IHRoZSBmaWVsZCBpcyBlbXB0eSBhbmQgYSBrZXlzdHJva2Ugc3RvcHMgdGhlIHZpZGVvJywgYXN5bmMgKCkgPT4ge1xuXHRcdGF3YWl0IHBhZ2UuZ290byhgL2FwcHMvZGVsaXZlci92ZXJzaW9ucy8ke3ZlcnNpb25JZH1gKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJ3ZpZGVvLmRlbGl2ZXItcGxheWVyX192aWRlbycpKS50b0hhdmVKU1Byb3BlcnR5KCdyZWFkeVN0YXRlJywgNClcblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJyNkZWxpdmVyLWNvbW1lbnQtYm9keScpLmZpbGwoJ2xlZnQgYmVoaW5kJylcblx0XHRjb25zdCBuZXh0ID0gcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ05leHQgQXNzZXQnIH0pXG5cdFx0YXdhaXQgKGF3YWl0IG5leHQuaXNFbmFibGVkKCkgPyBuZXh0IDogcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1ByZXZpb3VzIEFzc2V0JyB9KSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwobmV3IFJlZ0V4cChgL3ZlcnNpb25zLyR7Y2xpcFZlcnNpb25JZH0kYCkpXG5cdFx0Y29uc3QgdmlkZW8gPSBwYWdlLmxvY2F0b3IoJ3ZpZGVvLmRlbGl2ZXItcGxheWVyX192aWRlbycpXG5cdFx0YXdhaXQgZXhwZWN0KHZpZGVvKS50b0hhdmVKU1Byb3BlcnR5KCdyZWFkeVN0YXRlJywgNClcblx0XHRjb25zdCBmaWVsZCA9IHBhZ2UubG9jYXRvcignI2RlbGl2ZXItY29tbWVudC1ib2R5Jylcblx0XHRhd2FpdCBleHBlY3QoZmllbGQpLnRvSGF2ZVZhbHVlKCcnKVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdQbGF5IChTcGFjZSknIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiB2aWRlby5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5jdXJyZW50VGltZSkpLnRvQmVHcmVhdGVyVGhhbigwLjMpXG5cdFx0YXdhaXQgZmllbGQucHJlc3NTZXF1ZW50aWFsbHkoJ3gnKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IHZpZGVvLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LnBhdXNlZCkpLnRvQmUodHJ1ZSlcblx0XHRhd2FpdCBmaWVsZC5maWxsKCcnKVxuXHR9KVxuXG5cdHRlc3QoJ2J5IG1vdXNlIGEgY2xpY2sgb24gdGhlIHdhdmUgZG9lcyBub3Qgc2VlayBhbmQgYSBkb3VibGUgY2xpY2sgc2tpcHMgdGVuIHNlY29uZHM7IHRoZSBzdHJpcCB1bmRlciBpdCBzZWVrcyBhbmQgc2hvd3MgYSBkYXNoZWQgbGluZSBmaXJzdCcsIGFzeW5jICh7IHBsYXl3cmlnaHQgfSkgPT4ge1xuXHRcdGNvbnN0IGFwaSA9IGF3YWl0IHBsYXl3cmlnaHQucmVxdWVzdC5uZXdDb250ZXh0KHsgYmFzZVVSTDogVVJMLCBodHRwQ3JlZGVudGlhbHM6IGF1dGgsIGV4dHJhSFRUUEhlYWRlcnM6IG9jc0hlYWRlcnMgfSlcblx0XHRleHBlY3QoKGF3YWl0IGFwaS5wb3N0KGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3ZlcnNpb25zLyR7dmVyc2lvbklkfS9jb21tZW50cz9mb3JtYXQ9anNvbmAsIHsgZGF0YTogeyBpbkZyYW1lOiAzMzAwMDAsIGJvZHk6ICdpbiB0aGUgc3RyaXAnIH0gfSkpLm9rKCkpLnRvQmUodHJ1ZSlcblx0XHRhd2FpdCBhcGkuZGlzcG9zZSgpXG5cdFx0Ly8gV2l0aG91dCB0aGUgZ2xpZGUgYSBjbGljayBsYW5kcyBvbiB0aGUgd2F2ZSB3aGVyZSBpdCB3aWxsIHJlc3Rcblx0XHRhd2FpdCBwYWdlLmVtdWxhdGVNZWRpYSh7IHJlZHVjZWRNb3Rpb246ICdyZWR1Y2UnIH0pXG5cdFx0YXdhaXQgcGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL3ZlcnNpb25zLyR7dmVyc2lvbklkfWApXG5cdFx0Y29uc3QgY2FudmFzID0gcGFnZS5sb2NhdG9yKCcuZGVsaXZlci13YXZlIGNhbnZhcycpXG5cdFx0YXdhaXQgZXhwZWN0KGNhbnZhcykudG9CZVZpc2libGUoKVxuXHRcdGNvbnN0IGF1ZGlvID0gcGFnZS5sb2NhdG9yKCd2aWRlby5kZWxpdmVyLXBsYXllcl9fdmlkZW8nKVxuXHRcdGF3YWl0IGV4cGVjdChhdWRpbykudG9IYXZlSlNQcm9wZXJ0eSgncmVhZHlTdGF0ZScsIDQpXG5cdFx0Y29uc3QgYm94ID0gYXdhaXQgY2FudmFzLmJvdW5kaW5nQm94KClcblx0XHRjb25zdCBzdHJpcCA9IGJveC5oZWlnaHQgLSAyMFxuXHRcdGNvbnN0IHRpbWUgPSAoKSA9PiBhdWRpby5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5jdXJyZW50VGltZSlcblx0XHRjb25zdCBnb1RvID0gYXN5bmMgKHNlY29uZHMpID0+IHtcblx0XHRcdGF3YWl0IGF1ZGlvLmV2YWx1YXRlKChlbGVtZW50LCBhdCkgPT4ge1xuXHRcdFx0XHRlbGVtZW50LmN1cnJlbnRUaW1lID0gYXRcblx0XHRcdH0sIHNlY29uZHMpXG5cdFx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiBjYW52YXMuZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQuZHJhd25BdCkpLnRvQmVDbG9zZVRvKHNlY29uZHMgKyAwLjAwMDUsIDIpXG5cdFx0fVxuXHRcdC8vIE9mIHRoZSAxNiBweCBhYm92ZSB0aGUgbG91ZGVzdCBiYXIgYXQgdGhpcyBwbGFjZSwgaG93IG1hbnkgYXJlIGRyYXduIG9uOiA4IG9mIGEgZGFzaGVkIGxpbmVcblx0XHRjb25zdCBsaW5lID0gKHgpID0+IGNhbnZhcy5ldmFsdWF0ZSgoZWxlbWVudCwgYXQpID0+IHtcblx0XHRcdGNvbnN0IHJhdGlvID0gZWxlbWVudC53aWR0aCAvIGVsZW1lbnQuY2xpZW50V2lkdGhcblx0XHRcdGNvbnN0IGRhdGEgPSBlbGVtZW50LmdldENvbnRleHQoJzJkJykuZ2V0SW1hZ2VEYXRhKE1hdGgucm91bmQoYXQgKiByYXRpbyksIE1hdGgucm91bmQoMzYgKiByYXRpbyksIDEsIE1hdGgucm91bmQoMTYgKiByYXRpbykpLmRhdGFcblx0XHRcdHJldHVybiBkYXRhLmZpbHRlcigodmFsdWUsIGluZGV4KSA9PiBpbmRleCAlIDQgPT09IDMgJiYgdmFsdWUgPiAwKS5sZW5ndGggLyByYXRpb1xuXHRcdH0sIHgpXG5cdFx0Y29uc3QgY3Vyc29yID0gKCkgPT4gcGFnZS5sb2NhdG9yKCcuZGVsaXZlci13YXZlJykuZXZhbHVhdGUoKGVsZW1lbnQpID0+IGdldENvbXB1dGVkU3R5bGUoZWxlbWVudCkuY3Vyc29yKVxuXHRcdGNvbnN0IGhvdmVyID0gKHgsIHkpID0+IHBhZ2UubW91c2UubW92ZShib3gueCArIHgsIGJveC55ICsgeSlcblx0XHRjb25zdCBjYXJkID0gcGFnZS5nZXRCeVJvbGUoJ2RpYWxvZycsIHsgbmFtZTogL15Db21tZW50ICMvIH0pXG5cblx0XHRmb3IgKGNvbnN0IHpvb20gb2YgWycxIG1pbicsICdXaG9sZSddKSB7XG5cdFx0XHRjb25zdCB3aG9sZSA9IHpvb20gPT09ICdXaG9sZSdcblx0XHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6IHpvb20sIGV4YWN0OiB0cnVlIH0pLmNsaWNrKClcblx0XHRcdGF3YWl0IGdvVG8oMjApXG5cdFx0XHRjb25zdCBzdGFydCA9IGF3YWl0IHRpbWUoKVxuXHRcdFx0Ly8gT24gdGhlIHdhdmUgYSBjbGljayBnb2VzIG5vd2hlcmU7IGEgZG91YmxlIGNsaWNrIHNraXBzIHRlbiBzZWNvbmRzIG9uIHRoZSB0aGlyZHMsIG5vdGhpbmcgaW4gdGhlIG1pZGRsZVxuXHRcdFx0YXdhaXQgY2FudmFzLmNsaWNrKHsgcG9zaXRpb246IHsgeDogYm94LndpZHRoICogMC44NSwgeTogYm94LmhlaWdodCAvIDIgfSB9KVxuXHRcdFx0YXdhaXQgcGFnZS53YWl0Rm9yVGltZW91dCg0MDApXG5cdFx0XHRleHBlY3QoYXdhaXQgdGltZSgpKS50b0JlKHN0YXJ0KVxuXHRcdFx0YXdhaXQgY2FudmFzLmRibGNsaWNrKHsgcG9zaXRpb246IHsgeDogYm94LndpZHRoICogMC40NSwgeTogYm94LmhlaWdodCAvIDIgfSB9KVxuXHRcdFx0YXdhaXQgcGFnZS53YWl0Rm9yVGltZW91dCg0MDApXG5cdFx0XHRleHBlY3QoYXdhaXQgdGltZSgpKS50b0JlKHN0YXJ0KVxuXHRcdFx0YXdhaXQgY2FudmFzLmRibGNsaWNrKHsgcG9zaXRpb246IHsgeDogYm94LndpZHRoICogMC44NSwgeTogYm94LmhlaWdodCAvIDIgfSB9KVxuXHRcdFx0YXdhaXQgZXhwZWN0LnBvbGwodGltZSkudG9CZUNsb3NlVG8oc3RhcnQgKyAxMCwgMSlcblx0XHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fZmxhc2gnKSkudG9Db250YWluVGV4dCgnKzEwJylcblx0XHRcdGF3YWl0IGNhbnZhcy5kYmxjbGljayh7IHBvc2l0aW9uOiB7IHg6IGJveC53aWR0aCAqIDAuMSwgeTogYm94LmhlaWdodCAvIDIgfSB9KVxuXHRcdFx0YXdhaXQgZXhwZWN0LnBvbGwodGltZSkudG9CZUNsb3NlVG8oc3RhcnQsIDEpXG5cblx0XHRcdC8vIEhvdmVyaW5nIHRoZSBzdHJpcCBzaG93cyB3aGVyZSBhIGNsaWNrIGdvZXM7IG9mZiBpdCB0aGVyZSBpcyBubyBsaW5lXG5cdFx0XHRjb25zdCB4ID0gTWF0aC5yb3VuZChib3gud2lkdGggKiAwLjc1KVxuXHRcdFx0YXdhaXQgaG92ZXIoeCwgYm94LmhlaWdodCAvIDIpXG5cdFx0XHRleHBlY3QoYXdhaXQgbGluZSh4KSkudG9CZSgwKVxuXHRcdFx0YXdhaXQgaG92ZXIoeCwgc3RyaXApXG5cdFx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiBsaW5lKHgpKS50b0JlKDgpXG5cdFx0XHRleHBlY3QoYXdhaXQgY3Vyc29yKCkpLnRvQmUoJ3BvaW50ZXInKVxuXHRcdFx0YXdhaXQgaG92ZXIoeCArIDMwLCBzdHJpcClcblx0XHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IGxpbmUoeCArIDMwKSkudG9CZSg4KVxuXHRcdFx0ZXhwZWN0KGF3YWl0IGxpbmUoeCkpLnRvQmUoMClcblx0XHRcdGF3YWl0IGhvdmVyKHgsIGJveC5oZWlnaHQgLyAyKVxuXHRcdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gbGluZSh4ICsgMzApKS50b0JlKDApXG5cdFx0XHRleHBlY3QoYXdhaXQgY3Vyc29yKCkpLnRvQmUoJ2dyYWInKVxuXHRcdFx0YXdhaXQgaG92ZXIoeCwgc3RyaXApXG5cdFx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiBsaW5lKHgpKS50b0JlKDgpXG5cdFx0XHRhd2FpdCBob3Zlcih4LCBib3guaGVpZ2h0ICsgNjApXG5cdFx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiBsaW5lKHgpKS50b0JlKDApXG5cblx0XHRcdC8vIEEgY2xpY2sgdGhlcmUgc2Vla3MsIGFuZCB0d28gcXVpY2sgb25lcyBzZWVrIHR3aWNlXG5cdFx0XHRhd2FpdCBjYW52YXMuZGJsY2xpY2soeyBwb3NpdGlvbjogeyB4LCB5OiBzdHJpcCB9IH0pXG5cdFx0XHRhd2FpdCBleHBlY3QucG9sbCh0aW1lKS50b0JlQ2xvc2VUbyh3aG9sZSA/IDI3MCA6IHN0YXJ0ICsgMzAsIDApXG5cdFx0XHRhd2FpdCBnb1RvKDIwKVxuXG5cdFx0XHQvLyBBIGRyYWcgdGhhdCBiZWdpbnMgdGhlcmUgZHJhZ3MsIHdpdGhvdXQgdGhlIGxpbmVcblx0XHRcdGF3YWl0IGhvdmVyKHgsIHN0cmlwKVxuXHRcdFx0YXdhaXQgcGFnZS5tb3VzZS5kb3duKClcblx0XHRcdGF3YWl0IHBhZ2UubW91c2UubW92ZShib3gueCArIHggLSA0MCwgYm94LnkgKyBzdHJpcClcblx0XHRcdGF3YWl0IHBhZ2UubW91c2UubW92ZShib3gueCArIGJveC53aWR0aCAvIDIsIGJveC55ICsgc3RyaXApXG5cdFx0XHRhd2FpdCBwYWdlLndhaXRGb3JUaW1lb3V0KDEwMClcblx0XHRcdGZvciAoY29uc3QgYXQgb2YgW3gsIHggLSA0MCwgTWF0aC5yb3VuZChib3gud2lkdGggLyAyKSArIDVdKSB7XG5cdFx0XHRcdGV4cGVjdChhd2FpdCBsaW5lKGF0KSkudG9CZSgwKVxuXHRcdFx0fVxuXHRcdFx0ZXhwZWN0KGF3YWl0IHRpbWUoKSkudG9CZUNsb3NlVG8od2hvbGUgPyAxODAgOiAzNSwgMClcblx0XHRcdGF3YWl0IHBhZ2UubW91c2UudXAoKVxuXG5cdFx0XHQvLyBPdmVyIGEgY2lyY2xlIHRoZXJlIGlzIG5vIGxpbmUsIGJ1dCBhIGNsaWNrIG9wZW5zIGl0XG5cdFx0XHRhd2FpdCBnb1RvKDMzMClcblx0XHRcdGNvbnN0IGNpcmNsZSA9IHdob2xlID8gTWF0aC5yb3VuZChib3gud2lkdGggKiAzMzAgLyAzNjApIDogTWF0aC5yb3VuZChib3gud2lkdGggLyAyKVxuXHRcdFx0YXdhaXQgaG92ZXIoY2lyY2xlICsgOCwgc3RyaXApXG5cdFx0XHRhd2FpdCBwYWdlLndhaXRGb3JUaW1lb3V0KDEwMClcblx0XHRcdGV4cGVjdChhd2FpdCBsaW5lKGNpcmNsZSArIDgpKS50b0JlKDApXG5cdFx0XHRleHBlY3QoYXdhaXQgY3Vyc29yKCkpLnRvQmUoJ3BvaW50ZXInKVxuXHRcdFx0YXdhaXQgaG92ZXIoY2lyY2xlICsgNDAsIHN0cmlwKVxuXHRcdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gbGluZShjaXJjbGUgKyA0MCkpLnRvQmUoOClcblx0XHRcdGF3YWl0IHBhZ2UubW91c2UuY2xpY2soYm94LnggKyBjaXJjbGUgKyA0LCBib3gueSArIHN0cmlwKVxuXHRcdFx0YXdhaXQgZXhwZWN0KGNhcmQpLnRvQ29udGFpblRleHQoJ2luIHRoZSBzdHJpcCcpXG5cdFx0XHRleHBlY3QoYXdhaXQgdGltZSgpKS50b0JlQ2xvc2VUbygzMzAsIDEpXG5cdFx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdFc2NhcGUnKVxuXHRcdFx0YXdhaXQgZXhwZWN0KGNhcmQpLnRvSGF2ZUNvdW50KDApXG5cdFx0fVxuXG5cdFx0Ly8gV2l0aCB0aGUgY2FyZCBvcGVuIGEgY2xpY2sgaW4gdGhlIHN0cmlwIGJlc2lkZSB0aGUgY2lyY2xlcyBnb2VzIHdoZXJlIHRoZSBsaW5lIHNheXMsIGFuZCBjbG9zZXMgaXQ7IG9uIHRoZSB3YXZlIGl0IG9ubHkgY2xvc2VzXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJzEgbWluJyB9KS5jbGljaygpXG5cdFx0Zm9yIChjb25zdCBpblN0cmlwIG9mIFt0cnVlLCBmYWxzZV0pIHtcblx0XHRcdGF3YWl0IGdvVG8oMzMwKVxuXHRcdFx0YXdhaXQgcGFnZS5tb3VzZS5jbGljayhib3gueCArIGJveC53aWR0aCAvIDIgKyA0LCBib3gueSArIHN0cmlwKVxuXHRcdFx0YXdhaXQgZXhwZWN0KGNhcmQpLnRvQ29udGFpblRleHQoJ2luIHRoZSBzdHJpcCcpXG5cdFx0XHRjb25zdCB4ID0gTWF0aC5yb3VuZChib3gud2lkdGggKiAwLjYpXG5cdFx0XHRhd2FpdCBob3Zlcih4LCBpblN0cmlwID8gc3RyaXAgOiA2MClcblx0XHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IGxpbmUoeCkpLnRvQmUoaW5TdHJpcCA/IDggOiAwKVxuXHRcdFx0YXdhaXQgcGFnZS5tb3VzZS5jbGljayhib3gueCArIHgsIGJveC55ICsgKGluU3RyaXAgPyBzdHJpcCA6IDYwKSlcblx0XHRcdGF3YWl0IGV4cGVjdChjYXJkKS50b0hhdmVDb3VudCgwKVxuXHRcdFx0YXdhaXQgZXhwZWN0LnBvbGwodGltZSkudG9CZUNsb3NlVG8oaW5TdHJpcCA/IDMzNiA6IDMzMCwgMClcblx0XHR9XG5cdFx0Ly8gUHJlc3NlZCBvbiB0aGUgd2F2ZSBhbmQgbGlmdGVkIGluIHRoZSBzdHJpcCB0aGUgbW91c2UgZ29lcyBub3doZXJlLCBzbyB0aGVyZSBpcyBubyBsaW5lXG5cdFx0YXdhaXQgZ29UbygyMClcblx0XHRhd2FpdCBob3Zlcig2MDAsIDEwMClcblx0XHRhd2FpdCBwYWdlLm1vdXNlLmRvd24oKVxuXHRcdGF3YWl0IGhvdmVyKDYwMCwgc3RyaXApXG5cdFx0YXdhaXQgcGFnZS53YWl0Rm9yVGltZW91dCgxMDApXG5cdFx0ZXhwZWN0KGF3YWl0IGxpbmUoNjAwKSkudG9CZSgwKVxuXHRcdGF3YWl0IHBhZ2UubW91c2UudXAoKVxuXHRcdGV4cGVjdChhd2FpdCB0aW1lKCkpLnRvQmVDbG9zZVRvKDIwLCAxKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IGxpbmUoNjAwKSkudG9CZSg4KVxuXHRcdC8vIEEgc3RhZ2UgcmVzaXplZCB1bmRlciB0aGUgcmVzdGluZyBtb3VzZSwgbm93IG9uIHRoZSB3YXZlLCBrZWVwcyBubyBsaW5lXG5cdFx0YXdhaXQgcGFnZS5zZXRWaWV3cG9ydFNpemUoeyB3aWR0aDogMTI4MCwgaGVpZ2h0OiA5MDAgfSlcblx0XHRhd2FpdCBwYWdlLndhaXRGb3JUaW1lb3V0KDMwMClcblx0XHRleHBlY3QoYXdhaXQgbGluZSg2MDApKS50b0JlKDApXG5cdFx0YXdhaXQgcGFnZS5zZXRWaWV3cG9ydFNpemUoeyB3aWR0aDogMTI4MCwgaGVpZ2h0OiA3MjAgfSlcblx0XHRhd2FpdCBleHBlY3QucG9sbChhc3luYyAoKSA9PiAoYXdhaXQgY2FudmFzLmJvdW5kaW5nQm94KCkpLmhlaWdodCkudG9CZShib3guaGVpZ2h0KVxuXG5cdFx0Ly8gQmVmb3JlIHRoZSBzdGFydCBvZiB0aGUgcGllY2UgYSBjbGljayBnb2VzIHRvIHRoZSBzdGFydCwgYW5kIHRoZSBsaW5lIHNob3dzIGl0IHRoZXJlXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJzEgbWluJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgZ29UbygyMClcblx0XHRjb25zdCBmaXJzdCA9IE1hdGgucm91bmQoYm94LndpZHRoIC8gMiAtIDIwICogYm94LndpZHRoIC8gNjApXG5cdFx0YXdhaXQgaG92ZXIoZmlyc3QgLSA0MCwgc3RyaXApXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gbGluZShmaXJzdCkpLnRvQmUoOClcblx0XHRleHBlY3QoYXdhaXQgbGluZShmaXJzdCAtIDQwKSkudG9CZSgwKVxuXHRcdC8vIFdoaWxlIGl0IHBsYXlzIG9uIHVuZGVyIGl0LCB0aGUgbGluZSBzdGF5cyBhdCB0aGUgbW91c2Vcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnUGxheSAoU3BhY2UpJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgaG92ZXIoMjAwLCBzdHJpcClcblx0XHRhd2FpdCBleHBlY3QucG9sbCh0aW1lKS50b0JlR3JlYXRlclRoYW4oMjIpXG5cdFx0ZXhwZWN0KGF3YWl0IGxpbmUoMjAwKSkudG9CZSg4KVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdQYXVzZSAoU3BhY2UpJyB9KS5jbGljaygpXG5cdFx0Ly8gU3RhbmRpbmcsIHRoZSBtb3VzZSBvdmVyIHRoZSB3YXZlIG9yIHN0aWxsIGluIHRoZSBzdHJpcCBkcmF3cyBub3RoaW5nIGFnYWluXG5cdFx0YXdhaXQgcGFnZS53YWl0Rm9yVGltZW91dCgzMDApXG5cdFx0Y29uc3QgZHJhd3MgPSBhd2FpdCBjYW52YXMuZXZhbHVhdGUoYXN5bmMgKGVsZW1lbnQpID0+IHtcblx0XHRcdGNvbnN0IGNsZWFyID0gQ2FudmFzUmVuZGVyaW5nQ29udGV4dDJELnByb3RvdHlwZS5jbGVhclJlY3Rcblx0XHRcdGxldCBjb3VudCA9IDBcblx0XHRcdENhbnZhc1JlbmRlcmluZ0NvbnRleHQyRC5wcm90b3R5cGUuY2xlYXJSZWN0ID0gZnVuY3Rpb24oLi4uYXJncykge1xuXHRcdFx0XHRjb3VudCsrXG5cdFx0XHRcdHJldHVybiBjbGVhci5hcHBseSh0aGlzLCBhcmdzKVxuXHRcdFx0fVxuXHRcdFx0Y29uc3QgYm94ID0gZWxlbWVudC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKVxuXHRcdFx0Y29uc3QgY291bnRzID0gW11cblx0XHRcdGZvciAoY29uc3QgW3gsIHldIG9mIFtbMTAwLCAxMDBdLCBbMTIwLCAxMDBdLCBbMjAwLCBib3guaGVpZ2h0IC0gMjBdLCBbMjAwLCBib3guaGVpZ2h0IC0gMTBdLCBbMjAwLCAxMDBdXSkge1xuXHRcdFx0XHRlbGVtZW50LmRpc3BhdGNoRXZlbnQobmV3IFBvaW50ZXJFdmVudCgncG9pbnRlcm1vdmUnLCB7IGNsaWVudFg6IGJveC5sZWZ0ICsgeCwgY2xpZW50WTogYm94LnRvcCArIHksIHBvaW50ZXJJZDogNywgcG9pbnRlclR5cGU6ICdtb3VzZScsIGJ1YmJsZXM6IHRydWUgfSkpXG5cdFx0XHRcdGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiByZXF1ZXN0QW5pbWF0aW9uRnJhbWUoKCkgPT4gcmVxdWVzdEFuaW1hdGlvbkZyYW1lKHJlc29sdmUpKSlcblx0XHRcdFx0Y291bnRzLnB1c2goY291bnQpXG5cdFx0XHR9XG5cdFx0XHRDYW52YXNSZW5kZXJpbmdDb250ZXh0MkQucHJvdG90eXBlLmNsZWFyUmVjdCA9IGNsZWFyXG5cdFx0XHRyZXR1cm4gY291bnRzXG5cdFx0fSlcblx0XHQvLyBObyBsaW5lLCBubyBsaW5lLCBhIGxpbmUsIHRoZSBzYW1lIGxpbmUsIG5vIGxpbmVcblx0XHRleHBlY3QoZHJhd3MpLnRvRXF1YWwoWzAsIDAsIDEsIDEsIDJdKVxuXHRcdGF3YWl0IHBhZ2UuZW11bGF0ZU1lZGlhKHsgcmVkdWNlZE1vdGlvbjogbnVsbCB9KVxuXHR9KVxuXG5cdHRlc3QoJ29uIGEgcGhvbmUgaGVsZCBzaWRld2F5cyB3aXRoIHRoZSBsaXN0IGNsb3NlZCwgdGhlIGZpZWxkIG9wZW5zIGFzIGEgc2hlZXQgYW5kIHNlbmRzIGZyb20gdGhlcmUnLCBhc3luYyAoKSA9PiB7XG5cdFx0Y29uc3QgcGhvbmUgPSBhd2FpdCBicm93c2VyLm5ld0NvbnRleHQoeyBiYXNlVVJMOiBCUk9XU0VSX1VSTCwgLi4uUEhPTkUsIHZpZXdwb3J0OiB7IHdpZHRoOiA4NDQsIGhlaWdodDogMzkwIH0gfSlcblx0XHRjb25zdCBtZW1iZXIgPSBhd2FpdCBwaG9uZS5uZXdQYWdlKClcblx0XHRhd2FpdCBsb2dpbihtZW1iZXIpXG5cdFx0YXdhaXQgbWVtYmVyLmdvdG8oYC9hcHBzL2RlbGl2ZXIvdmVyc2lvbnMvJHt2ZXJzaW9uSWR9YClcblx0XHRjb25zdCBjYW52YXMgPSBtZW1iZXIubG9jYXRvcignLmRlbGl2ZXItd2F2ZSBjYW52YXMnKVxuXHRcdGF3YWl0IGV4cGVjdChjYW52YXMpLnRvQmVWaXNpYmxlKClcblx0XHRhd2FpdCBleHBlY3QobWVtYmVyLmxvY2F0b3IoJ3ZpZGVvLmRlbGl2ZXItcGxheWVyX192aWRlbycpKS50b0hhdmVKU1Byb3BlcnR5KCdyZWFkeVN0YXRlJywgNClcblx0XHRhd2FpdCBleHBlY3QobWVtYmVyLmxvY2F0b3IoJy5kZWxpdmVyLWxheW91dF9fcGFuZWwnKSkudG9CZUhpZGRlbigpXG5cdFx0Y29uc3QgYm94ID0gYXdhaXQgY2FudmFzLmJvdW5kaW5nQm94KClcblx0XHRjb25zdCB0b3VjaCA9IGF3YWl0IHBob25lLm5ld0NEUFNlc3Npb24obWVtYmVyKVxuXHRcdGF3YWl0IHRvdWNoLnNlbmQoJ0lucHV0LmRpc3BhdGNoVG91Y2hFdmVudCcsIHsgdHlwZTogJ3RvdWNoU3RhcnQnLCB0b3VjaFBvaW50czogW3sgeDogYm94LnggKyBib3gud2lkdGggKiAwLjc1LCB5OiBib3gueSArIGJveC5oZWlnaHQgLyAyIH1dIH0pXG5cdFx0YXdhaXQgbWVtYmVyLndhaXRGb3JUaW1lb3V0KDcwMClcblx0XHRhd2FpdCB0b3VjaC5zZW5kKCdJbnB1dC5kaXNwYXRjaFRvdWNoRXZlbnQnLCB7IHR5cGU6ICd0b3VjaEVuZCcsIHRvdWNoUG9pbnRzOiBbXSB9KVxuXHRcdGNvbnN0IHNoZWV0ID0gbWVtYmVyLmdldEJ5Um9sZSgnZGlhbG9nJywgeyBuYW1lOiAnTmV3IENvbW1lbnQnIH0pXG5cdFx0YXdhaXQgZXhwZWN0KHNoZWV0KS50b0JlVmlzaWJsZSgpXG5cdFx0Ly8gRnJvbSBiZWxvdywgYWNyb3NzIHRoZSB3aWR0aFxuXHRcdGNvbnN0IGF0ID0gYXdhaXQgc2hlZXQuYm91bmRpbmdCb3goKVxuXHRcdGV4cGVjdChNYXRoLnJvdW5kKGF0LnkgKyBhdC5oZWlnaHQpKS50b0JlKDM5MClcblx0XHRleHBlY3QoTWF0aC5yb3VuZChhdC53aWR0aCkpLnRvQmUoODQ0KVxuXHRcdGF3YWl0IG1lbWJlci5sb2NhdG9yKCcjZGVsaXZlci1jb21tZW50LWJvZHktaW5saW5lJykuZmlsbCgnZnJvbSB0aGUgc2hlZXQnKVxuXHRcdGF3YWl0IHNoZWV0LmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnU2VuZCAoRW50ZXIpJyB9KS50YXAoKVxuXHRcdGF3YWl0IGV4cGVjdChzaGVldCkudG9IYXZlQ291bnQoMClcblx0XHRhd2FpdCBleHBlY3QobWVtYmVyLmxvY2F0b3IoJy5kZWxpdmVyLWxheW91dF9fcGFuZWwnKSkudG9CZUhpZGRlbigpXG5cdFx0YXdhaXQgcGhvbmUuY2xvc2UoKVxuXHR9KVxuXG5cdHRlc3QoJ292ZXIgdGhlIHdob2xlIHBpZWNlIHRoZSBDb21tZW50cyBhcmUgb24gdGhlIHdhdmUgb25seSwgem9vbWVkIGluIG9uIHRoZSBiYXIgdG9vLCB3aGVyZSBhIHByZXNzIG9wZW5zIHRoZSB3YXZlXFwncyBjYXJkLCBieSBtb3VzZSwga2V5Ym9hcmQgYW5kIGZpbmdlcicsIGFzeW5jICh7IHBsYXl3cmlnaHQgfSkgPT4ge1xuXHRcdGNvbnN0IGFwaSA9IGF3YWl0IHBsYXl3cmlnaHQucmVxdWVzdC5uZXdDb250ZXh0KHsgYmFzZVVSTDogVVJMLCBodHRwQ3JlZGVudGlhbHM6IGF1dGgsIGV4dHJhSFRUUEhlYWRlcnM6IG9jc0hlYWRlcnMgfSlcblx0XHRjb25zdCBpZHMgPSBbXVxuXHRcdGNvbnN0IG9wZW4gPSBhc3luYyAodGFyZ2V0LCB6b29tKSA9PiB7XG5cdFx0XHRhd2FpdCB0YXJnZXQuZ290byhgL2FwcHMvZGVsaXZlci92ZXJzaW9ucy8ke3ZlcnNpb25JZH1gKVxuXHRcdFx0YXdhaXQgZXhwZWN0KHRhcmdldC5sb2NhdG9yKCcuZGVsaXZlci13YXZlIGNhbnZhcycpKS50b0JlVmlzaWJsZSgpXG5cdFx0XHRhd2FpdCBleHBlY3QodGFyZ2V0LmxvY2F0b3IoJ3ZpZGVvLmRlbGl2ZXItcGxheWVyX192aWRlbycpKS50b0hhdmVKU1Byb3BlcnR5KCdyZWFkeVN0YXRlJywgNClcblx0XHRcdGF3YWl0IHRhcmdldC5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogem9vbSwgZXhhY3Q6IHRydWUgfSkuY2xpY2soKVxuXHRcdH1cblx0XHRjb25zdCB0aW1lT2YgPSAodGFyZ2V0KSA9PiB0YXJnZXQubG9jYXRvcigndmlkZW8uZGVsaXZlci1wbGF5ZXJfX3ZpZGVvJykuZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQuY3VycmVudFRpbWUpXG5cdFx0Y29uc3QgbWFya2VyT2YgPSAodGFyZ2V0KSA9PiB0YXJnZXQubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX19tYXJrZXJbYXJpYS1sYWJlbCo9XCJvbiB0aGUgYmFyXCJdJylcblx0XHRjb25zdCBjYXJkID0gKHRhcmdldCkgPT4gdGFyZ2V0LmdldEJ5Um9sZSgnZGlhbG9nJywgeyBuYW1lOiAvXkNvbW1lbnQgIy8gfSlcblx0XHRjb25zdCBwZWVrID0gcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX3BlZWsnKVxuXHRcdGNvbnN0IGNhbnZhcyA9IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItd2F2ZSBjYW52YXMnKVxuXHRcdGNvbnN0IGJhciA9IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX190aW1lbGluZScpXG5cdFx0Ly8gVGhlIHdhdmUgaXMgYXMgaGlnaCB3aXRoIENvbW1lbnRzIGFzIHdpdGhvdXQsIGF0IGV2ZXJ5IHpvb21cblx0XHRhd2FpdCBwYWdlLnJvdXRlKCcqKi92ZXJzaW9ucy8qL2NvbW1lbnRzKicsIChyb3V0ZSkgPT4gcm91dGUuZnVsZmlsbCh7IGpzb246IHsgb2NzOiB7IG1ldGE6IHsgc3RhdHVzOiAnb2snLCBzdGF0dXNjb2RlOiAyMDAgfSwgZGF0YTogeyBjb21tZW50czogW10sIG1hbmFnZXM6IHRydWUsIG92ZXJ3cml0dGVuQXQ6IG51bGwsIGNhbkNvbW1lbnQ6IHRydWUsIGNhbkFwcHJvdmU6IGZhbHNlIH0gfSB9IH0pKVxuXHRcdGF3YWl0IG9wZW4ocGFnZSwgJ1dob2xlJylcblx0XHRjb25zdCBoZWlnaHRzID0gWyhhd2FpdCBjYW52YXMuYm91bmRpbmdCb3goKSkuaGVpZ2h0XVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICcxIG1pbicsIGV4YWN0OiB0cnVlIH0pLmNsaWNrKClcblx0XHRoZWlnaHRzLnB1c2goKGF3YWl0IGNhbnZhcy5ib3VuZGluZ0JveCgpKS5oZWlnaHQpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX19tYXJrZXInKSkudG9IYXZlQ291bnQoMClcblx0XHRhd2FpdCBwYWdlLnVucm91dGUoJyoqL3ZlcnNpb25zLyovY29tbWVudHMqJylcblx0XHRmb3IgKGNvbnN0IFtpbkZyYW1lLCBib2R5XSBvZiBbWzkwMDAwLCAnb24gdGhlIGJhciddLCBbOTAxMDAsICdjbG9zZSBieSddXSkge1xuXHRcdFx0Y29uc3QgbWFkZSA9IGF3YWl0IGFwaS5wb3N0KGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3ZlcnNpb25zLyR7dmVyc2lvbklkfS9jb21tZW50cz9mb3JtYXQ9anNvbmAsIHsgZGF0YTogeyBpbkZyYW1lLCBib2R5IH0gfSlcblx0XHRcdGlkcy5wdXNoKChhd2FpdCBtYWRlLmpzb24oKSkub2NzLmRhdGEuaWQpXG5cdFx0fVxuXHRcdGF3YWl0IG9wZW4ocGFnZSwgJ1dob2xlJylcblx0XHRjb25zdCBtYXJrZXIgPSBtYXJrZXJPZihwYWdlKVxuXHRcdGF3YWl0IGV4cGVjdChtYXJrZXIpLnRvSGF2ZVRleHQoJzInKVxuXHRcdGNvbnN0IHN0YWdlID0gYXdhaXQgY2FudmFzLmJvdW5kaW5nQm94KClcblx0XHRjb25zdCB1bmRlciA9IGF3YWl0IGJhci5ib3VuZGluZ0JveCgpXG5cdFx0ZXhwZWN0KFtzdGFnZS5oZWlnaHQsIHN0YWdlLmhlaWdodF0pLnRvRXF1YWwoaGVpZ2h0cylcblx0XHRleHBlY3QodW5kZXIueSkudG9CZUNsb3NlVG8oc3RhZ2UueSArIHN0YWdlLmhlaWdodCwgMClcblxuXHRcdC8vIE92ZXIgdGhlIHdob2xlIHRoZSBjaXJjbGUgaXMgb24gdGhlIHdhdmUncyBsYW5lLCBhbmQgdGhlIGJhciBhdCBpdHMgcGxhY2Ugb25seSBzZWVrc1xuXHRcdGV4cGVjdChhd2FpdCBjYW52YXMuZXZhbHVhdGUoKGVsZW1lbnQpID0+IHtcblx0XHRcdGNvbnN0IHJhdGlvID0gZWxlbWVudC53aWR0aCAvIGVsZW1lbnQuY2xpZW50V2lkdGhcblx0XHRcdGNvbnN0IGRhdGEgPSBlbGVtZW50LmdldENvbnRleHQoJzJkJykuZ2V0SW1hZ2VEYXRhKE1hdGgucm91bmQoKGVsZW1lbnQuY2xpZW50V2lkdGggLyA0ICsgOCkgKiByYXRpbyksIGVsZW1lbnQuaGVpZ2h0IC0gTWF0aC5yb3VuZCgyMCAqIHJhdGlvKSwgMSwgMSkuZGF0YVxuXHRcdFx0cmV0dXJuIGRhdGFbM11cblx0XHR9KSkudG9CZSgyNTUpXG5cdFx0YXdhaXQgcGFnZS5tb3VzZS5jbGljayh1bmRlci54ICsgdW5kZXIud2lkdGggLyA0LCB1bmRlci55ICsgdW5kZXIuaGVpZ2h0IC8gMilcblx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiB0aW1lT2YocGFnZSkpLnRvQmVDbG9zZVRvKDkwLCAwKVxuXHRcdGF3YWl0IGV4cGVjdChwZWVrKS50b0hhdmVDb3VudCgwKVxuXHRcdGF3YWl0IGV4cGVjdChjYXJkKHBhZ2UpKS50b0hhdmVDb3VudCgwKVxuXHRcdC8vIFRoZSBrZXlib2FyZCBzdGlsbCByZWFjaGVzIGl0IHRoZXJlLCBhbmQgaXQgc2hvd3Mgd2hpbGUgaXQgaGFzIHRoZSBmb2N1c1xuXHRcdGF3YWl0IGV4cGVjdChtYXJrZXIpLnRvSGF2ZUNTUygnY2xpcC1wYXRoJywgJ2luc2V0KDUwJSknKVxuXHRcdGF3YWl0IG1hcmtlci5mb2N1cygpXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnU2hpZnQrVGFiJylcblx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdUYWInKVxuXHRcdGF3YWl0IGV4cGVjdChtYXJrZXIpLnRvQmVGb2N1c2VkKClcblx0XHRhd2FpdCBleHBlY3QobWFya2VyKS50b0hhdmVDU1MoJ2NsaXAtcGF0aCcsICdub25lJylcblx0XHRhd2FpdCBleHBlY3QocGVlaykudG9Db250YWluVGV4dCgnMSBvZiAyJylcblx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdFbnRlcicpXG5cdFx0YXdhaXQgZXhwZWN0KGNhcmQocGFnZSkpLnRvQ29udGFpblRleHQoJ29uIHRoZSBiYXInKVxuXHRcdC8vIEVzY2FwZSBoYW5kcyB0aGUgZm9jdXMgYmFjaywgd2l0aG91dCB0aGUgc21hbGwgY2FyZFxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ0VzY2FwZScpXG5cdFx0YXdhaXQgZXhwZWN0KGNhcmQocGFnZSkpLnRvSGF2ZUNvdW50KDApXG5cdFx0YXdhaXQgZXhwZWN0KG1hcmtlcikudG9CZUZvY3VzZWQoKVxuXHRcdGF3YWl0IHBhZ2Uud2FpdEZvclRpbWVvdXQoMjAwKVxuXHRcdGF3YWl0IGV4cGVjdChwZWVrKS50b0hhdmVDb3VudCgwKVxuXG5cdFx0Ly8gWm9vbWVkIGluIHRoZSBiYXIgaGFzIGl0IHRvb1xuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICcxIG1pbicsIGV4YWN0OiB0cnVlIH0pLmNsaWNrKClcblx0XHRleHBlY3QoKGF3YWl0IGNhbnZhcy5ib3VuZGluZ0JveCgpKS5oZWlnaHQpLnRvQmUoc3RhZ2UuaGVpZ2h0KVxuXHRcdC8vIFRyYW5zbHVjZW50LCB1bnRpbCB0aGUgbW91c2UgaXMgb3ZlciBpdFxuXHRcdGNvbnN0IGJhY2sgPSAoKSA9PiBtYXJrZXIuZXZhbHVhdGUoKGVsZW1lbnQpID0+IGdldENvbXB1dGVkU3R5bGUoZWxlbWVudCkuYmFja2dyb3VuZENvbG9yKVxuXHRcdGF3YWl0IG9wZW4ocGFnZSwgJzEgbWluJylcblx0XHRhd2FpdCBwYWdlLm1vdXNlLm1vdmUoMCwgMClcblx0XHRhd2FpdCBleHBlY3QucG9sbChiYWNrKS50b01hdGNoKC9yZ2JhXFwoMCwgMCwgMCwgMFxcLlxcZCtcXCkvKVxuXHRcdGF3YWl0IG1hcmtlci5ob3Zlcih7IGZvcmNlOiB0cnVlIH0pXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoYmFjaykudG9CZSgncmdiKDAsIDAsIDApJylcblx0XHRhd2FpdCBleHBlY3QocGVlaykudG9Db250YWluVGV4dCgnMSBvZiAyJylcblx0XHQvLyBJbiBwbGFjZSBvZiB0aGUgRnJhbWUncyB0aW1lLCB3aGljaCBpcyBiZXNpZGUgaXRcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX2hvdmVyJykpLnRvQmVIaWRkZW4oKVxuXHRcdGF3YWl0IHBhZ2UubW91c2UubW92ZSh1bmRlci54ICsgdW5kZXIud2lkdGggLyA0ICsgMTQsIHVuZGVyLnkgKyB1bmRlci5oZWlnaHQgLyAyKVxuXHRcdGF3YWl0IGV4cGVjdChwZWVrKS50b0hhdmVDb3VudCgwKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9faG92ZXInKSkudG9CZVZpc2libGUoKVxuXHRcdGF3YWl0IG1hcmtlci5jbGljayh7IGZvcmNlOiB0cnVlIH0pXG5cdFx0YXdhaXQgZXhwZWN0KGNhcmQocGFnZSkpLnRvQ29udGFpblRleHQoJ29uIHRoZSBiYXInKVxuXHRcdGF3YWl0IGV4cGVjdChjYXJkKHBhZ2UpLmdldEJ5UGxhY2Vob2xkZXIoJ1dyaXRlIGEgUmVwbHknKSkudG9CZVZpc2libGUoKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IHRpbWVPZihwYWdlKSkudG9CZUNsb3NlVG8oOTAsIDEpXG5cdFx0Ly8gVGhlIG1vdXNlJ3Mgc21hbGwgY2FyZCBpcyBnb25lLCB0aGUgbGlzdCBzZWxlY3RlZCwgYW5kIHRoZSBjaXJjbGUgcmluZ2VkXG5cdFx0YXdhaXQgZXhwZWN0KHBlZWspLnRvSGF2ZUNvdW50KDApXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tbWVudC0tc2VsZWN0ZWQnKSkudG9Db250YWluVGV4dCgnb24gdGhlIGJhcicpXG5cdFx0YXdhaXQgZXhwZWN0KG1hcmtlcikudG9IYXZlQXR0cmlidXRlKCdzdHlsZScsIC8tLWRlbGl2ZXItbWFya2VyLWxpbmU6ICNmZmYvKVxuXHRcdGF3YWl0IGV4cGVjdChtYXJrZXIpLnRvSGF2ZUNsYXNzKC8tLW9wYXF1ZS8pXG5cdFx0Ly8gVGhlIGNhcmQgc3RlcHMgdGhyb3VnaCB0aGUgY291bnQsIGFuZCBhIGRvdWJsZSBjbGljayBnb2VzIHRvIHRoZSBvbmUgaXQgc2hvd3Ncblx0XHRhd2FpdCBjYXJkKHBhZ2UpLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnTmV4dCBDb21tZW50JyB9KS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KGNhcmQocGFnZSkpLnRvQ29udGFpblRleHQoJ2Nsb3NlIGJ5Jylcblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fbWFya2VyW2FyaWEtbGFiZWxePVwiMiBvZiAyXCJdJykuZGJsY2xpY2soeyBmb3JjZTogdHJ1ZSB9KVxuXHRcdGF3YWl0IGV4cGVjdChjYXJkKHBhZ2UpKS50b0NvbnRhaW5UZXh0KCdjbG9zZSBieScpXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gdGltZU9mKHBhZ2UpKS50b0JlQ2xvc2VUbyg5MC4xLCAyKVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ0VzY2FwZScpXG5cdFx0YXdhaXQgZXhwZWN0KGNhcmQocGFnZSkpLnRvSGF2ZUNvdW50KDApXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX21hcmtlclthcmlhLWxhYmVsXj1cIjIgb2YgMlwiXScpLmZvY3VzKClcblx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdFbnRlcicpXG5cdFx0YXdhaXQgZXhwZWN0KGNhcmQocGFnZSkpLnRvQ29udGFpblRleHQoJ2Nsb3NlIGJ5Jylcblx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdFc2NhcGUnKVxuXHRcdC8vIEEgZHJhZyBmcm9tIGl0IG1vdmVzIHRoZSB3YXZlIGFuZCBvcGVucyBub3RoaW5nXG5cdFx0YXdhaXQgcGFnZS5tb3VzZS5tb3ZlKHVuZGVyLnggKyB1bmRlci53aWR0aCAvIDQsIHVuZGVyLnkgKyB1bmRlci5oZWlnaHQgLyAyKVxuXHRcdGF3YWl0IHBhZ2UubW91c2UuZG93bigpXG5cdFx0YXdhaXQgcGFnZS5tb3VzZS5tb3ZlKHVuZGVyLnggKyB1bmRlci53aWR0aCAvIDIsIHVuZGVyLnkgKyB1bmRlci5oZWlnaHQgLyAyLCB7IHN0ZXBzOiA0IH0pXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gdGltZU9mKHBhZ2UpKS50b0JlQ2xvc2VUbygxODAsIDApXG5cdFx0YXdhaXQgcGFnZS5tb3VzZS51cCgpXG5cdFx0YXdhaXQgcGFnZS53YWl0Rm9yVGltZW91dCg0MDApXG5cdFx0YXdhaXQgZXhwZWN0KGNhcmQocGFnZSkpLnRvSGF2ZUNvdW50KDApXG5cdFx0ZXhwZWN0KGF3YWl0IHRpbWVPZihwYWdlKSkudG9CZUNsb3NlVG8oMTgwLCAwKVxuXG5cdFx0Y29uc3QgcGhvbmUgPSBhd2FpdCBicm93c2VyLm5ld0NvbnRleHQoeyBiYXNlVVJMOiBCUk9XU0VSX1VSTCwgLi4uUEhPTkUsIHZpZXdwb3J0OiB7IHdpZHRoOiA4NTIsIGhlaWdodDogMzkzIH0gfSlcblx0XHRjb25zdCBtZW1iZXIgPSBhd2FpdCBwaG9uZS5uZXdQYWdlKClcblx0XHRhd2FpdCBsb2dpbihtZW1iZXIpXG5cdFx0YXdhaXQgb3BlbihtZW1iZXIsICdXaG9sZScpXG5cdFx0YXdhaXQgZXhwZWN0KG1hcmtlck9mKG1lbWJlcikpLnRvSGF2ZVRleHQoJzInKVxuXHRcdGNvbnN0IHJvdyA9IGF3YWl0IG1lbWJlci5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX3RpbWVsaW5lJykuYm91bmRpbmdCb3goKVxuXHRcdGF3YWl0IG1lbWJlci50b3VjaHNjcmVlbi50YXAocm93LnggKyByb3cud2lkdGggLyA0LCByb3cueSArIHJvdy5oZWlnaHQgLyAyKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IHRpbWVPZihtZW1iZXIpKS50b0JlQ2xvc2VUbyg5MCwgMClcblx0XHRhd2FpdCBtZW1iZXIud2FpdEZvclRpbWVvdXQoNDAwKVxuXHRcdGF3YWl0IGV4cGVjdChjYXJkKG1lbWJlcikpLnRvSGF2ZUNvdW50KDApXG5cdFx0YXdhaXQgb3BlbihtZW1iZXIsICcxIG1pbicpXG5cdFx0YXdhaXQgZXhwZWN0KG1hcmtlck9mKG1lbWJlcikpLnRvSGF2ZVRleHQoJzInKVxuXHRcdC8vIEEgdGFwIHJlYWRzIGFuZCBhbnN3ZXJzIHdpdGhvdXQgc2Vla2luZzsgYSBkb3VibGUgdGFwIGdvZXMgdGhlcmUsIHRob3VnaCB0aGUgc2hlZXQgd291bGQgY292ZXIgdGhlIGJhclxuXHRcdGNvbnN0IGF0ID0gYXdhaXQgbWFya2VyT2YobWVtYmVyKS5ib3VuZGluZ0JveCgpXG5cdFx0Y29uc3QgdGFwID0gKCkgPT4gbWVtYmVyLnRvdWNoc2NyZWVuLnRhcChhdC54ICsgYXQud2lkdGggLyAyLCBhdC55ICsgYXQuaGVpZ2h0IC8gMilcblx0XHRhd2FpdCB0YXAoKVxuXHRcdGF3YWl0IGV4cGVjdChjYXJkKG1lbWJlcikpLnRvQ29udGFpblRleHQoJ29uIHRoZSBiYXInKVxuXHRcdGV4cGVjdChhd2FpdCB0aW1lT2YobWVtYmVyKSkudG9CZSgwKVxuXHRcdGF3YWl0IGNhcmQobWVtYmVyKS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ0Nsb3NlJyB9KS50YXAoKVxuXHRcdGF3YWl0IHRhcCgpXG5cdFx0YXdhaXQgdGFwKClcblx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiB0aW1lT2YobWVtYmVyKSkudG9CZUNsb3NlVG8oOTAsIDEpXG5cdFx0YXdhaXQgbWVtYmVyLndhaXRGb3JUaW1lb3V0KDQwMClcblx0XHRhd2FpdCBleHBlY3QoY2FyZChtZW1iZXIpKS50b0hhdmVDb3VudCgwKVxuXHRcdC8vIEEgZmluZ2VyIGRyYWdnaW5nIGZyb20gaXQgbW92ZXMgdGhlIHdhdmVcblx0XHRjb25zdCB0b3VjaCA9IGF3YWl0IHBob25lLm5ld0NEUFNlc3Npb24obWVtYmVyKVxuXHRcdGNvbnN0IHkgPSBhdC55ICsgYXQuaGVpZ2h0IC8gMlxuXHRcdGF3YWl0IHRvdWNoLnNlbmQoJ0lucHV0LmRpc3BhdGNoVG91Y2hFdmVudCcsIHsgdHlwZTogJ3RvdWNoU3RhcnQnLCB0b3VjaFBvaW50czogW3sgeDogYXQueCArIGF0LndpZHRoIC8gMiwgeSB9XSB9KVxuXHRcdGZvciAoY29uc3QgeCBvZiBbYXQueCArIDYwLCBhdC54ICsgMTYwLCBhdC54ICsgMjYwXSkge1xuXHRcdFx0YXdhaXQgdG91Y2guc2VuZCgnSW5wdXQuZGlzcGF0Y2hUb3VjaEV2ZW50JywgeyB0eXBlOiAndG91Y2hNb3ZlJywgdG91Y2hQb2ludHM6IFt7IHgsIHkgfV0gfSlcblx0XHR9XG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gdGltZU9mKG1lbWJlcikpLnRvQmVHcmVhdGVyVGhhbigxNTApXG5cdFx0YXdhaXQgdG91Y2guc2VuZCgnSW5wdXQuZGlzcGF0Y2hUb3VjaEV2ZW50JywgeyB0eXBlOiAndG91Y2hFbmQnLCB0b3VjaFBvaW50czogW10gfSlcblx0XHRhd2FpdCBtZW1iZXIud2FpdEZvclRpbWVvdXQoNTAwKVxuXHRcdGF3YWl0IGV4cGVjdChjYXJkKG1lbWJlcikpLnRvSGF2ZUNvdW50KDApXG5cdFx0YXdhaXQgcGhvbmUuY2xvc2UoKVxuXHRcdGZvciAoY29uc3QgaWQgb2YgaWRzKSB7XG5cdFx0XHRleHBlY3QoKGF3YWl0IGFwaS5kZWxldGUoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvY29tbWVudHMvJHtpZH0/Zm9ybWF0PWpzb25gKSkub2soKSkudG9CZSh0cnVlKVxuXHRcdH1cblx0XHRhd2FpdCBhcGkuZGlzcG9zZSgpXG5cdH0pXG5cblx0dGVzdCgnb24gYSBwaG9uZSBhIHBpbmNoIG9ubHkgem9vbXMsIGEgbG9uZyBwcmVzcyBjb21tZW50cywgYW5kIHRoZSBjYXJkIGhhbmRzIHRoZSBmb2N1cyBiYWNrOyBhIFJldmlld2VyIHdobyBtYXkgbm90IGNvbW1lbnQgcmVhZHMgdGhlIGNhcmRzIGFuZCB3cml0ZXMgbm90aGluZycsIGFzeW5jICh7IHBsYXl3cmlnaHQgfSkgPT4ge1xuXHRcdGNvbnN0IGFwaSA9IGF3YWl0IHBsYXl3cmlnaHQucmVxdWVzdC5uZXdDb250ZXh0KHsgYmFzZVVSTDogVVJMLCBodHRwQ3JlZGVudGlhbHM6IGF1dGgsIGV4dHJhSFRUUEhlYWRlcnM6IG9jc0hlYWRlcnMgfSlcblx0XHRjb25zdCBjb21tZW50cyA9IGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3ZlcnNpb25zLyR7dmVyc2lvbklkfS9jb21tZW50cz9mb3JtYXQ9anNvbmBcblx0XHRjb25zdCBwYXJlbnQgPSAoYXdhaXQgKGF3YWl0IGFwaS5wb3N0KGNvbW1lbnRzLCB7IGRhdGE6IHsgaW5GcmFtZTogNzUwMCwgYm9keTogJ2ZvciB0aGUgcGhvbmUnIH0gfSkpLmpzb24oKSkub2NzLmRhdGFcblx0XHRleHBlY3QoKGF3YWl0IGFwaS5wb3N0KGNvbW1lbnRzLCB7IGRhdGE6IHsgaW5GcmFtZTogNzUwMCwgYm9keTogJ2FuZCBhIHJlcGx5JywgcGFyZW50SWQ6IHBhcmVudC5pZCB9IH0pKS5vaygpKS50b0JlKHRydWUpXG5cblx0XHRjb25zdCBwaG9uZSA9IGF3YWl0IGJyb3dzZXIubmV3Q29udGV4dCh7IGJhc2VVUkw6IEJST1dTRVJfVVJMLCAuLi5QSE9ORSB9KVxuXHRcdGNvbnN0IG1lbWJlciA9IGF3YWl0IHBob25lLm5ld1BhZ2UoKVxuXHRcdGF3YWl0IGxvZ2luKG1lbWJlcilcblx0XHRhd2FpdCBtZW1iZXIuZ290byhgL2FwcHMvZGVsaXZlci92ZXJzaW9ucy8ke3ZlcnNpb25JZH1gKVxuXHRcdGNvbnN0IGNhbnZhcyA9IG1lbWJlci5sb2NhdG9yKCcuZGVsaXZlci13YXZlIGNhbnZhcycpXG5cdFx0YXdhaXQgZXhwZWN0KGNhbnZhcykudG9CZVZpc2libGUoKVxuXHRcdGF3YWl0IGV4cGVjdChtZW1iZXIubG9jYXRvcigndmlkZW8uZGVsaXZlci1wbGF5ZXJfX3ZpZGVvJykpLnRvSGF2ZUpTUHJvcGVydHkoJ3JlYWR5U3RhdGUnLCA0KVxuXHRcdGNvbnN0IGZpZWxkID0gbWVtYmVyLmxvY2F0b3IoJyNkZWxpdmVyLWNvbW1lbnQtYm9keScpXG5cdFx0Y29uc3QgYW5jaG9yID0gbWVtYmVyLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRzX19hbmNob3InKVxuXHRcdGNvbnN0IGJveCA9IGF3YWl0IGNhbnZhcy5ib3VuZGluZ0JveCgpXG5cdFx0Y29uc3QgeSA9IGJveC55ICsgYm94LmhlaWdodCAvIDJcblx0XHRjb25zdCB0b3VjaCA9IGF3YWl0IHBob25lLm5ld0NEUFNlc3Npb24obWVtYmVyKVxuXHRcdGNvbnN0IGZpbmdlcnMgPSAodHlwZSwgcG9pbnRzKSA9PiB0b3VjaC5zZW5kKCdJbnB1dC5kaXNwYXRjaFRvdWNoRXZlbnQnLCB7IHR5cGUsIHRvdWNoUG9pbnRzOiBwb2ludHMubWFwKChbeCwgYXRdLCBpZCkgPT4gKHsgeCwgeTogYXQsIGlkIH0pKSB9KVxuXHRcdGNvbnN0IHNob3duID0gKCkgPT4gbWVtYmVyLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fd2luZG93JykuZXZhbHVhdGUoKGVsZW1lbnQpID0+IHBhcnNlRmxvYXQoZWxlbWVudC5zdHlsZS53aWR0aC5tYXRjaCgvW1xcZC5dKyUvKVswXSkpXG5cblx0XHQvLyBUd28gZmluZ2VycyBtb3ZpbmcgYXBhcnQgZm9yIG1vc3Qgb2YgYSBzZWNvbmQgem9vbSBpbiBhbmQgb3BlbiBubyBmaWVsZFxuXHRcdGNvbnN0IGJlZm9yZSA9IGF3YWl0IHNob3duKClcblx0XHRhd2FpdCBmaW5nZXJzKCd0b3VjaFN0YXJ0JywgW1tib3gueCArIDE1MCwgeV0sIFtib3gueCArIDI0MCwgeV1dKVxuXHRcdGZvciAobGV0IHN0ZXAgPSAxOyBzdGVwIDw9IDg7IHN0ZXArKykge1xuXHRcdFx0YXdhaXQgbWVtYmVyLndhaXRGb3JUaW1lb3V0KDEwMClcblx0XHRcdGF3YWl0IGZpbmdlcnMoJ3RvdWNoTW92ZScsIFtbYm94LnggKyAxNTAgLSBzdGVwICogMTAsIHldLCBbYm94LnggKyAyNDAgKyBzdGVwICogMTAsIHldXSlcblx0XHR9XG5cdFx0YXdhaXQgZmluZ2VycygndG91Y2hFbmQnLCBbXSlcblx0XHRhd2FpdCBtZW1iZXIud2FpdEZvclRpbWVvdXQoMzAwKVxuXHRcdGV4cGVjdChhd2FpdCBzaG93bigpKS50b0JlTGVzc1RoYW4oYmVmb3JlKVxuXHRcdGF3YWl0IGV4cGVjdChmaWVsZCkubm90LnRvQmVGb2N1c2VkKClcblx0XHRhd2FpdCBleHBlY3QoYW5jaG9yKS50b0hhdmVUZXh0KCcwOjAwLjAwMCcpXG5cblx0XHQvLyBBIGZpbmdlciByZXN0aW5nIGEgcXVhcnRlciBvZiB0aGUgc3RhZ2UgdG8gdGhlIHJpZ2h0LCAxNSBzZWNvbmRzIG9uLCBvcGVucyB0aGUgZmllbGQgdGhlcmU7IGl0IG5laXRoZXIgc2Vla3Mgbm9yIGdvZXMgZnVsbHNjcmVlblxuXHRcdGF3YWl0IG1lbWJlci5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJzEgbWluJyB9KS50YXAoKVxuXHRcdGF3YWl0IGZpbmdlcnMoJ3RvdWNoU3RhcnQnLCBbW2JveC54ICsgYm94LndpZHRoICogMC43NSwgeV1dKVxuXHRcdGF3YWl0IG1lbWJlci53YWl0Rm9yVGltZW91dCg3MDApXG5cdFx0YXdhaXQgZmluZ2VycygndG91Y2hFbmQnLCBbXSlcblx0XHRhd2FpdCBleHBlY3QoZmllbGQpLnRvQmVGb2N1c2VkKClcblx0XHRhd2FpdCBleHBlY3QoYW5jaG9yKS50b0hhdmVUZXh0KCcwOjE1LjAwMCcpXG5cdFx0Ly8gVGhlIHBsYWNlIHdhaXRzIG9uIHRoZSB3YXZlIGFzIGEgbGluZSBpbiB0aGUgcHJpbWFyeSBjb2xvdXIsIG92ZXIgdGhlIHdhdmUgbm90IHlldCBwbGF5ZWRcblx0XHRjb25zdCBtYXJrID0gYXdhaXQgY2FudmFzLmV2YWx1YXRlKChlbGVtZW50KSA9PiB7XG5cdFx0XHRjb25zdCBwcm9iZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NwYW4nKVxuXHRcdFx0cHJvYmUuc3R5bGUuY29sb3IgPSAndmFyKC0tY29sb3ItcHJpbWFyeS1lbGVtZW50KSdcblx0XHRcdGVsZW1lbnQucGFyZW50RWxlbWVudC5hcHBlbmQocHJvYmUpXG5cdFx0XHRjb25zdCBwcmltYXJ5ID0gZ2V0Q29tcHV0ZWRTdHlsZShwcm9iZSkuY29sb3IubWF0Y2goL1xcZCsvZykubWFwKE51bWJlcilcblx0XHRcdHByb2JlLnJlbW92ZSgpXG5cdFx0XHRjb25zdCByYXRpbyA9IGVsZW1lbnQud2lkdGggLyBlbGVtZW50LmNsaWVudFdpZHRoXG5cdFx0XHRjb25zdCBwaXhlbCA9IGVsZW1lbnQuZ2V0Q29udGV4dCgnMmQnKS5nZXRJbWFnZURhdGEoTWF0aC5yb3VuZChlbGVtZW50LndpZHRoICogMC43NSksIE1hdGgucm91bmQoNDIgKiByYXRpbyksIDEsIDEpLmRhdGFcblx0XHRcdHJldHVybiBNYXRoLm1heCguLi5wcmltYXJ5LnNsaWNlKDAsIDMpLm1hcCgodmFsdWUsIGF0KSA9PiBNYXRoLmFicyh2YWx1ZSAtIHBpeGVsW2F0XSkpKVxuXHRcdH0pXG5cdFx0ZXhwZWN0KG1hcmspLnRvQmVMZXNzVGhhbig4KVxuXHRcdGV4cGVjdChhd2FpdCBtZW1iZXIubG9jYXRvcigndmlkZW8uZGVsaXZlci1wbGF5ZXJfX3ZpZGVvJykuZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQuY3VycmVudFRpbWUpKS50b0JlTGVzc1RoYW4oMSlcblx0XHRhd2FpdCBleHBlY3QobWVtYmVyLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllci0tZnVsbHNjcmVlbicpKS50b0hhdmVDb3VudCgwKVxuXHRcdC8vIEEgdGFwIG9uIGEgY2lyY2xlLCA3LjUgc2Vjb25kcyBvbiwgb3BlbnMgaXRzIGNhcmQ7IGNsb3NpbmcgaXQgaGFuZHMgdGhlIGZvY3VzIGJhY2sgdG8gdGhlIGZpZWxkXG5cdFx0Y29uc3QgbGFuZSA9IGF3YWl0IGNhbnZhcy5ib3VuZGluZ0JveCgpXG5cdFx0YXdhaXQgZmluZ2VycygndG91Y2hTdGFydCcsIFtbbGFuZS54ICsgbGFuZS53aWR0aCAqIDAuNjI1LCBsYW5lLnkgKyBsYW5lLmhlaWdodCAtIDIwXV0pXG5cdFx0YXdhaXQgZmluZ2VycygndG91Y2hFbmQnLCBbXSlcblx0XHRjb25zdCBzaGVldCA9IG1lbWJlci5nZXRCeVJvbGUoJ2RpYWxvZycsIHsgbmFtZTogL15Db21tZW50ICMvIH0pXG5cdFx0YXdhaXQgZXhwZWN0KHNoZWV0KS50b0NvbnRhaW5UZXh0KCdmb3IgdGhlIHBob25lJylcblx0XHRhd2FpdCBleHBlY3Qoc2hlZXQpLnRvQmVGb2N1c2VkKClcblx0XHRhd2FpdCBzaGVldC5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ0Nsb3NlJyB9KS50YXAoKVxuXHRcdGF3YWl0IGV4cGVjdChzaGVldCkudG9IYXZlQ291bnQoMClcblx0XHRhd2FpdCBleHBlY3QoZmllbGQpLnRvQmVGb2N1c2VkKClcblx0XHQvLyBBIHNpbmdsZSB0YXAgb24gdGhlIHdhdmUgc2Vla3Mgbm93aGVyZTsgYSBkb3VibGUgdGFwIG9uIGl0cyByaWdodCB0aGlyZCBza2lwcyB0ZW4gc2Vjb25kcywgaW4gdGhlIG1pZGRsZSBub3RoaW5nXG5cdFx0Y29uc3QgdGltZSA9ICgpID0+IG1lbWJlci5sb2NhdG9yKCd2aWRlby5kZWxpdmVyLXBsYXllcl9fdmlkZW8nKS5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5jdXJyZW50VGltZSlcblx0XHRjb25zdCB0YXBBdCA9IGFzeW5jIChhdCkgPT4ge1xuXHRcdFx0YXdhaXQgZmluZ2VycygndG91Y2hTdGFydCcsIFtbYXQsIHldXSlcblx0XHRcdGF3YWl0IGZpbmdlcnMoJ3RvdWNoRW5kJywgW10pXG5cdFx0fVxuXHRcdGNvbnN0IHN0YXJ0ID0gYXdhaXQgdGltZSgpXG5cdFx0Ly8gQSBmaXJzdCB0YXAgdGhhdCBsZXRzIGdvIG9mIHRoZSBlbXB0eSBmaWVsZCBza2lwcyBub3RoaW5nIGVpdGhlclxuXHRcdGF3YWl0IGZpbmdlcnMoJ3RvdWNoU3RhcnQnLCBbW2JveC54ICsgYm94LndpZHRoICogMC43NSwgeV1dKVxuXHRcdGF3YWl0IG1lbWJlci53YWl0Rm9yVGltZW91dCg3MDApXG5cdFx0YXdhaXQgZmluZ2VycygndG91Y2hFbmQnLCBbXSlcblx0XHRhd2FpdCBleHBlY3QoYW5jaG9yKS50b0hhdmVUZXh0KCcwOjE1LjAwMCcpXG5cdFx0YXdhaXQgdGFwQXQoYm94LnggKyBib3gud2lkdGggKiAwLjg1KVxuXHRcdGF3YWl0IHRhcEF0KGJveC54ICsgYm94LndpZHRoICogMC44NSlcblx0XHRhd2FpdCBtZW1iZXIud2FpdEZvclRpbWVvdXQoNTAwKVxuXHRcdGF3YWl0IGV4cGVjdChhbmNob3IpLnRvSGF2ZVRleHQoJzA6MDAuMDAwJylcblx0XHRleHBlY3QoYXdhaXQgdGltZSgpKS50b0JlKHN0YXJ0KVxuXHRcdGF3YWl0IHRhcEF0KGJveC54ICsgYm94LndpZHRoICogMC44NSlcblx0XHRhd2FpdCBtZW1iZXIud2FpdEZvclRpbWVvdXQoNTAwKVxuXHRcdGV4cGVjdChhd2FpdCB0aW1lKCkpLnRvQmUoc3RhcnQpXG5cdFx0YXdhaXQgdGFwQXQoYm94LnggKyBib3gud2lkdGggKiAwLjUpXG5cdFx0YXdhaXQgdGFwQXQoYm94LnggKyBib3gud2lkdGggKiAwLjUpXG5cdFx0YXdhaXQgbWVtYmVyLndhaXRGb3JUaW1lb3V0KDUwMClcblx0XHRleHBlY3QoYXdhaXQgdGltZSgpKS50b0JlKHN0YXJ0KVxuXHRcdGF3YWl0IHRhcEF0KGJveC54ICsgYm94LndpZHRoICogMC44NSlcblx0XHRhd2FpdCB0YXBBdChib3gueCArIGJveC53aWR0aCAqIDAuODUpXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwodGltZSkudG9CZUNsb3NlVG8oc3RhcnQgKyAxMCwgMClcblx0XHRhd2FpdCBleHBlY3QobWVtYmVyLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fZmxhc2gnKSkudG9Db250YWluVGV4dCgnKzEwJylcblx0XHRhd2FpdCB0YXBBdChib3gueCArIGJveC53aWR0aCAqIDAuMSlcblx0XHRhd2FpdCB0YXBBdChib3gueCArIGJveC53aWR0aCAqIDAuMSlcblx0XHRhd2FpdCBleHBlY3QucG9sbCh0aW1lKS50b0JlQ2xvc2VUbyhzdGFydCwgMClcblx0XHQvLyBBIGxvbmcgcHJlc3Mgb24gcGxheWluZyBhdWRpbyBzdG9wcyBpdFxuXHRcdGF3YWl0IG1lbWJlci5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1BsYXknLCBleGFjdDogdHJ1ZSB9KS50YXAoKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IG1lbWJlci5sb2NhdG9yKCd2aWRlby5kZWxpdmVyLXBsYXllcl9fdmlkZW8nKS5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5wYXVzZWQpKS50b0JlKGZhbHNlKVxuXHRcdGF3YWl0IGZpbmdlcnMoJ3RvdWNoU3RhcnQnLCBbW2JveC54ICsgYm94LndpZHRoICogMC43NSwgeV1dKVxuXHRcdGF3YWl0IG1lbWJlci53YWl0Rm9yVGltZW91dCg3MDApXG5cdFx0YXdhaXQgZmluZ2VycygndG91Y2hFbmQnLCBbXSlcblx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiBtZW1iZXIubG9jYXRvcigndmlkZW8uZGVsaXZlci1wbGF5ZXJfX3ZpZGVvJykuZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQucGF1c2VkKSkudG9CZSh0cnVlKVxuXHRcdGF3YWl0IHBob25lLmNsb3NlKClcblxuXHRcdGNvbnN0IGxpbmsgPSAoYXdhaXQgKGF3YWl0IGFwaS5wb3N0KGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3Byb2plY3RzLyR7cHJvamVjdElkfS9saW5rcz9mb3JtYXQ9anNvbmApKS5qc29uKCkpLm9jcy5kYXRhXG5cdFx0ZXhwZWN0KChhd2FpdCBhcGkucHV0KGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL2xpbmtzLyR7bGluay5pZH0/Zm9ybWF0PWpzb25gLCB7IGRhdGE6IHsgY2FuQ29tbWVudDogZmFsc2UgfSB9KSkub2soKSkudG9CZSh0cnVlKVxuXHRcdGF3YWl0IGFwaS5kaXNwb3NlKClcblx0XHRjb25zdCB2aXNpdG9yID0gYXdhaXQgYnJvd3Nlci5uZXdDb250ZXh0KHsgYmFzZVVSTDogQlJPV1NFUl9VUkwgfSlcblx0XHRjb25zdCByZXZpZXdlciA9IGF3YWl0IHZpc2l0b3IubmV3UGFnZSgpXG5cdFx0YXdhaXQgcmV2aWV3ZXIuZ290byhgL2FwcHMvZGVsaXZlci9zLyR7bGluay50b2tlbn0vdmVyc2lvbnMvJHt2ZXJzaW9uSWR9YClcblx0XHRjb25zdCB3YXZlID0gcmV2aWV3ZXIubG9jYXRvcignLmRlbGl2ZXItd2F2ZSBjYW52YXMnKVxuXHRcdGF3YWl0IGV4cGVjdCh3YXZlKS50b0JlVmlzaWJsZSgpXG5cdFx0YXdhaXQgcmV2aWV3ZXIuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICcxNSBzJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgcmV2aWV3ZXIubG9jYXRvcignLmRlbGl2ZXItY29tbWVudCcpLmZpbHRlcih7IGhhc1RleHQ6ICdmb3IgdGhlIHBob25lJyB9KS5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50X19hbmNob3InKS5jbGljaygpXG5cdFx0Y29uc3Qgc3RhZ2UgPSBhd2FpdCB3YXZlLmJvdW5kaW5nQm94KClcblx0XHRhd2FpdCB3YXZlLmNsaWNrKHsgcG9zaXRpb246IHsgeDogc3RhZ2Uud2lkdGggLyAyLCB5OiBzdGFnZS5oZWlnaHQgLSAyMCB9IH0pXG5cdFx0Y29uc3QgY2FyZCA9IHJldmlld2VyLmdldEJ5Um9sZSgnZGlhbG9nJywgeyBuYW1lOiAvXkNvbW1lbnQgIy8gfSlcblx0XHRhd2FpdCBleHBlY3QoY2FyZCkudG9Db250YWluVGV4dCgnYW5kIGEgcmVwbHknKVxuXHRcdGF3YWl0IGV4cGVjdChjYXJkLmxvY2F0b3IoJ3RleHRhcmVhJykpLnRvSGF2ZUNvdW50KDApXG5cdFx0YXdhaXQgZXhwZWN0KGNhcmQuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdHbyB0bycgfSkpLnRvQmVWaXNpYmxlKClcblx0XHQvLyBBIGNsaWNrIGVsc2V3aGVyZSBpbiB0aGUgc3RyaXAgc2Vla3MgYnV0IG9wZW5zIG5vIGZpZWxkXG5cdFx0YXdhaXQgY2FyZC5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ0Nsb3NlJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgd2F2ZS5jbGljayh7IHBvc2l0aW9uOiB7IHg6IHN0YWdlLndpZHRoICogMC43NSwgeTogc3RhZ2UuaGVpZ2h0IC0gMjAgfSB9KVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IHJldmlld2VyLmxvY2F0b3IoJ3ZpZGVvLmRlbGl2ZXItcGxheWVyX192aWRlbycpLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LmN1cnJlbnRUaW1lKSkudG9CZUNsb3NlVG8oMTEuMjUsIDApXG5cdFx0YXdhaXQgZXhwZWN0KHJldmlld2VyLmxvY2F0b3IoJyNkZWxpdmVyLWNvbW1lbnQtYm9keScpKS50b0hhdmVDb3VudCgwKVxuXHRcdGF3YWl0IHZpc2l0b3IuY2xvc2UoKVxuXHR9KVxufSlcblxuLyoqXG4gKiBAcGFyYW0ge2ltcG9ydCgnQHBsYXl3cmlnaHQvdGVzdCcpLkxvY2F0b3J9IHZpZGVvcyAtIENvbXBhcmUncyB0d28gbWVkaWEgZWxlbWVudHNcbiAqIEByZXR1cm4ge1Byb21pc2U8Ym9vbGVhbltdPn0gd2hldGhlciBlYWNoIHNpZGUgaXMgaGVhcmQ6IGJ5IGl0cyBnYWluIHdoZXJlIGJvdGggcGxheSBpbnRvIHRoZSBBdWRpb0NvbnRleHQgKEE3KSwgYnkgbXV0aW5nIHVudGlsIHRoZW5cbiAqL1xuY29uc3QgaGVhcmQgPSAodmlkZW9zKSA9PiB2aWRlb3MuZXZhbHVhdGVBbGwoKGFsbCkgPT4gYWxsLm1hcCgodmlkZW8pID0+IHZpZGVvLmRlbGl2ZXJHYWluICYmICF2aWRlby5tdXRlZCA/IHZpZGVvLmRlbGl2ZXJHYWluLmdhaW4udmFsdWUgPiAwLjUgOiAhdmlkZW8ubXV0ZWQpKVxuXG50ZXN0LmRlc2NyaWJlKCdDb21wYXJpbmcgc291bmQnLCAoKSA9PiB7XG5cdGxldCBicm93c2VyXG5cdGxldCBjb250ZXh0XG5cdGxldCBwYWdlXG5cdGxldCBmb2xkZXJcblx0bGV0IHByb2plY3RJZFxuXHQvKiogRWFjaCBBc3NldCdzIFZlcnNpb25zLCBuZXdlc3QgZmlyc3QgKi9cblx0bGV0IG1peFxuXHRsZXQgY3V0XG5cblx0dGVzdC5iZWZvcmVBbGwoYXN5bmMgKHsgcGxheXdyaWdodCB9KSA9PiB7XG5cdFx0YXdhaXQgdGVzdFVzZXIocGxheXdyaWdodClcblx0XHRjb25zdCBhcGkgPSBhd2FpdCBwbGF5d3JpZ2h0LnJlcXVlc3QubmV3Q29udGV4dCh7IGJhc2VVUkw6IFVSTCwgaHR0cENyZWRlbnRpYWxzOiBhdXRoLCBleHRyYUhUVFBIZWFkZXJzOiBvY3NIZWFkZXJzIH0pXG5cdFx0Zm9sZGVyID0gJ2RlbGl2ZXItZTJlLScgKyByYW5kb21CeXRlcyg0KS50b1N0cmluZygnaGV4Jylcblx0XHRjb25zdCBkYXYgPSBgL3JlbW90ZS5waHAvZGF2L2ZpbGVzLyR7VVNFUn0vJHtmb2xkZXJ9YFxuXHRcdGV4cGVjdCgoYXdhaXQgYXBpLmZldGNoKGRhdiwgeyBtZXRob2Q6ICdNS0NPTCcgfSkpLnN0YXR1cygpKS50b0JlKDIwMSlcblx0XHRjb25zdCBjcmVhdGVkID0gYXdhaXQgYXBpLnBvc3QoJy9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHM/Zm9ybWF0PWpzb24nLCB7IGRhdGE6IHsgZm9sZGVySWQ6IGF3YWl0IGZpbGVJZChhcGksIGRhdiksIGF1dG9JbnRha2U6IHRydWUgfSB9KVxuXHRcdHByb2plY3RJZCA9IChhd2FpdCBjcmVhdGVkLmpzb24oKSkub2NzLmRhdGEuaWRcblx0XHQvLyBPbmUgYWZ0ZXIgdGhlIG90aGVyLCBzbyB0aGUgc2Vjb25kIG9mIGVhY2ggc3RhY2tzIG9uIHRoZSBmaXJzdCBhcyBpdHMgVjJcblx0XHRmb3IgKGNvbnN0IFtuYW1lLCBmaWxlXSBvZiBbWydtaXgud2VibScsIE1JWF9BXSwgWydtaXhfdjIud2VibScsIE1JWF9CXSwgWydjdXQud2VibScsIENVVF9BXSwgWydjdXRfdjIud2VibScsIENVVF9CXV0pIHtcblx0XHRcdGV4cGVjdCgoYXdhaXQgYXBpLmZldGNoKGAke2Rhdn0vJHtuYW1lfWAsIHsgbWV0aG9kOiAnUFVUJywgZGF0YTogcmVhZEZpbGVTeW5jKGZpbGUpIH0pKS5zdGF0dXMoKSkudG9CZSgyMDEpXG5cdFx0fVxuXHRcdGNvbnN0IGFzc2V0cyA9IGFzeW5jICgpID0+IChhd2FpdCAoYXdhaXQgYXBpLmdldChgL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS9wcm9qZWN0cy8ke3Byb2plY3RJZH0/Zm9ybWF0PWpzb25gKSkuanNvbigpKS5vY3MuZGF0YS5hc3NldHNcblx0XHRhd2FpdCBleHBlY3QucG9sbChhc3luYyAoKSA9PiAoYXdhaXQgYXNzZXRzKCkpLm1hcCgoYXNzZXQpID0+IGFzc2V0LnZlcnNpb25zLmxlbmd0aCkuam9pbigpKS50b0JlKCcyLDInKVxuXHRcdGNvbnN0IGFsbCA9IGF3YWl0IGFzc2V0cygpXG5cdFx0bWl4ID0gYWxsLmZpbmQoKGFzc2V0KSA9PiBhc3NldC5uYW1lID09PSAnbWl4JykudmVyc2lvbnNcblx0XHRjdXQgPSBhbGwuZmluZCgoYXNzZXQpID0+IGFzc2V0Lm5hbWUgPT09ICdjdXQnKS52ZXJzaW9uc1xuXHRcdC8vIGZmbXBlZyBtYWtlcyB0aGUgV2F2ZWZvcm1zXG5cdFx0Y29uc3QgcmVhZHkgPSBhc3luYyAodmVyc2lvbikgPT4gKGF3YWl0IChhd2FpdCBhcGkuZ2V0KGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3ZlcnNpb25zLyR7dmVyc2lvbi5pZH0/Zm9ybWF0PWpzb25gKSkuanNvbigpKS5vY3MuZGF0YS52ZXJzaW9uc1xuXHRcdFx0LmV2ZXJ5KChlYWNoKSA9PiBlYWNoLmRlcml2ZWQud2F2ZWZvcm0uc3RhdGUgPT09ICdyZWFkeScpXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoYXN5bmMgKCkgPT4ge1xuXHRcdFx0ZXhlY0ZpbGVTeW5jKCdkb2NrZXInLCBbJ2NvbXBvc2UnLCAnZXhlYycsICctVCcsICctdScsICd3d3ctZGF0YScsICduZXh0Y2xvdWQnLCAncGhwJywgJ29jYycsICdkZWxpdmVyOndvcmtlcicsICctLW9uY2UnXSwgeyBzdGRpbzogJ2luaGVyaXQnIH0pXG5cdFx0XHRyZXR1cm4gYXdhaXQgcmVhZHkobWl4WzBdKSAmJiBhd2FpdCByZWFkeShjdXRbMF0pXG5cdFx0fSwgeyB0aW1lb3V0OiA2MF8wMDAgfSkudG9CZSh0cnVlKVxuXHRcdGF3YWl0IGFwaS5kaXNwb3NlKClcblx0XHRicm93c2VyID0gYXdhaXQgY2hyb21pdW0uY29ubmVjdE92ZXJDRFAoQ0RQKVxuXHRcdGNvbnRleHQgPSBhd2FpdCBicm93c2VyLm5ld0NvbnRleHQoeyBiYXNlVVJMOiBCUk9XU0VSX1VSTCB9KVxuXHRcdHBhZ2UgPSBhd2FpdCBjb250ZXh0Lm5ld1BhZ2UoKVxuXHRcdGF3YWl0IGxvZ2luKHBhZ2UpXG5cdH0pXG5cblx0dGVzdC5hZnRlckFsbChhc3luYyAoeyBwbGF5d3JpZ2h0IH0pID0+IHtcblx0XHRhd2FpdCBjb250ZXh0Py5jbG9zZSgpXG5cdFx0YXdhaXQgYnJvd3Nlcj8uY2xvc2UoKVxuXHRcdGNvbnN0IGFwaSA9IGF3YWl0IHBsYXl3cmlnaHQucmVxdWVzdC5uZXdDb250ZXh0KHsgYmFzZVVSTDogVVJMLCBodHRwQ3JlZGVudGlhbHM6IGF1dGgsIGV4dHJhSFRUUEhlYWRlcnM6IG9jc0hlYWRlcnMgfSlcblx0XHRhd2FpdCBhcGkuZGVsZXRlKGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3Byb2plY3RzLyR7cHJvamVjdElkfT9mb3JtYXQ9anNvbmApXG5cdFx0YXdhaXQgYXBpLmZldGNoKGAvcmVtb3RlLnBocC9kYXYvZmlsZXMvJHtVU0VSfS8ke2ZvbGRlcn1gLCB7IG1ldGhvZDogJ0RFTEVURScgfSlcblx0XHRhd2FpdCBhcGkuZGlzcG9zZSgpXG5cdH0pXG5cblx0dGVzdCgndHdvIGF1ZGlvIFZlcnNpb25zIGNvbXBhcmUgb24gdHdvIGxhbmVzIHVuZGVyIG9uZSBwbGF5aGVhZCwgYW5kIDEsIDIsIFRhYiBhbmQgdGhlIGxhbmVzXFwnIG5hbWVzIHN3aXRjaCB0aGUgc291bmQgd2hpbGUgYm90aCBwbGF5IG9uJywgYXN5bmMgKCkgPT4ge1xuXHRcdGF3YWl0IHBhZ2UuZ290byhgL2FwcHMvZGVsaXZlci9jb21wYXJlLyR7bWl4WzFdLmlkfS8ke21peFswXS5pZH1gKVxuXHRcdGNvbnN0IHZpZGVvcyA9IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tcGFyZSB2aWRlbycpXG5cdFx0YXdhaXQgZXhwZWN0KHZpZGVvcykudG9IYXZlQ291bnQoMilcblx0XHRhd2FpdCBleHBlY3QodmlkZW9zLmZpcnN0KCkpLnRvSGF2ZUpTUHJvcGVydHkoJ3JlYWR5U3RhdGUnLCA0KVxuXHRcdC8vIE5vIHBpY3R1cmUgYXJlYSBhbmQgbm90aGluZyB0byBsYXkgb3V0OiB0aGUgbGFuZXMgYXJlIHRoZSB2aWV3XG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tcGFyZV9fc3RhZ2UnKSkudG9CZUhpZGRlbigpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKCdyYWRpbycsIHsgbmFtZTogJ1dpcGUnIH0pKS50b0hhdmVDb3VudCgwKVxuXHRcdGNvbnN0IGNhbnZhcyA9IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tcGFyZV9fbGFuZXMgY2FudmFzJylcblx0XHRhd2FpdCBleHBlY3QoY2FudmFzKS50b0JlVmlzaWJsZSgpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItd2F2ZV9fbGFuZScpKS50b0hhdmVUZXh0KFsnVjEnLCAnVjInXSlcblx0XHRjb25zdCBzaWRlID0gcGFnZS5nZXRCeVJvbGUoJ3JhZGlvJywgeyBuYW1lOiAvXlYyLyB9KVxuXHRcdGV4cGVjdChhd2FpdCBoZWFyZCh2aWRlb3MpKS50b0VxdWFsKFt0cnVlLCBmYWxzZV0pXG5cblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnUGxheSAoU3BhY2UpJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gdmlkZW9zLmZpcnN0KCkuZXZhbHVhdGUoKHZpZGVvKSA9PiB2aWRlby5jdXJyZW50VGltZSkpLnRvQmVHcmVhdGVyVGhhbigwLjUpXG5cdFx0Ly8gQm90aCBwbGF5IHVubXV0ZWQgaW50byBvbmUgQXVkaW9Db250ZXh0LCB0aGUgZ2FpbnMgZGVjaWRlXG5cdFx0ZXhwZWN0KGF3YWl0IHZpZGVvcy5ldmFsdWF0ZUFsbCgoYWxsKSA9PiBhbGwubWFwKCh2aWRlbykgPT4gIXZpZGVvLm11dGVkICYmICEhdmlkZW8uZGVsaXZlckdhaW4pKSkudG9FcXVhbChbdHJ1ZSwgdHJ1ZV0pXG5cdFx0Ly8gVGhlIGhlYXJkIHNpZGUncyBzb3VuZCBjb21lcyB0aHJvdWdoIHRoZSBncmFwaDogYSBtZWRpYSBlbGVtZW50IGZyb20gYW5vdGhlciBvcmlnaW4gd291bGQgZ2l2ZSBzaWxlbmNlXG5cdFx0Y29uc3QgbGV2ZWwgPSBhd2FpdCB2aWRlb3MuZmlyc3QoKS5ldmFsdWF0ZSgodmlkZW8pID0+IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG5cdFx0XHRjb25zdCBhbmFseXNlciA9IHZpZGVvLmRlbGl2ZXJHYWluLmNvbnRleHQuY3JlYXRlQW5hbHlzZXIoKVxuXHRcdFx0dmlkZW8uZGVsaXZlckdhaW4uY29ubmVjdChhbmFseXNlcilcblx0XHRcdHNldFRpbWVvdXQoKCkgPT4ge1xuXHRcdFx0XHRjb25zdCBkYXRhID0gbmV3IEZsb2F0MzJBcnJheShhbmFseXNlci5mZnRTaXplKVxuXHRcdFx0XHRhbmFseXNlci5nZXRGbG9hdFRpbWVEb21haW5EYXRhKGRhdGEpXG5cdFx0XHRcdHJlc29sdmUoTWF0aC5tYXgoLi4uZGF0YS5tYXAoTWF0aC5hYnMpKSlcblx0XHRcdH0sIDMwMClcblx0XHR9KSlcblx0XHRleHBlY3QobGV2ZWwpLnRvQmVHcmVhdGVyVGhhbigwLjA1KVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJzInKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IGhlYXJkKHZpZGVvcykpLnRvRXF1YWwoW2ZhbHNlLCB0cnVlXSlcblx0XHRhd2FpdCBleHBlY3Qoc2lkZSkudG9IYXZlQXR0cmlidXRlKCdhcmlhLWNoZWNrZWQnLCAndHJ1ZScpXG5cdFx0ZXhwZWN0KGF3YWl0IHZpZGVvcy5ldmFsdWF0ZUFsbCgoYWxsKSA9PiBhbGwubWFwKCh2aWRlbykgPT4gdmlkZW8ucGF1c2VkKSkpLnRvRXF1YWwoW2ZhbHNlLCBmYWxzZV0pXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnMScpXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gaGVhcmQodmlkZW9zKSkudG9FcXVhbChbdHJ1ZSwgZmFsc2VdKVxuXG5cdFx0Ly8gQSBjbGljayBvbiBhIHdhdmUgc2Vla3MgYW5kIGtlZXBzIHBsYXlpbmc7IHRoZSBwbGF5ZXIgdGhlbiBoYXMgdGhlIGZvY3VzLCBhbmQgVGFiIHN3aXRjaGVzXG5cdFx0Y29uc3QgYm94ID0gYXdhaXQgY2FudmFzLmJvdW5kaW5nQm94KClcblx0XHRjb25zdCBzb3VnaHQgPSB2aWRlb3MuZmlyc3QoKS5ldmFsdWF0ZSgodmlkZW8pID0+IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB2aWRlby5hZGRFdmVudExpc3RlbmVyKCdzZWVraW5nJywgKCkgPT4gcmVzb2x2ZSh0cnVlKSwgeyBvbmNlOiB0cnVlIH0pKSlcblx0XHRhd2FpdCBjYW52YXMuY2xpY2soeyBwb3NpdGlvbjogeyB4OiBib3gud2lkdGggKiAwLjYsIHk6IGJveC5oZWlnaHQgKiAwLjYgfSB9KVxuXHRcdGV4cGVjdChhd2FpdCBzb3VnaHQpLnRvQmUodHJ1ZSlcblx0XHQvLyBMYW5lcyBoYXZlIG5vIHN0cmlwOiBhdCB0aGVpciBmb290IHRoZSBtb3VzZSBzaG93cyBubyBwbGFjZSB0byBnbyB0b1xuXHRcdGF3YWl0IGNhbnZhcy5ob3Zlcih7IHBvc2l0aW9uOiB7IHg6IGJveC53aWR0aCAqIDAuNiwgeTogYm94LmhlaWdodCAtIDUgfSB9KVxuXHRcdGV4cGVjdChhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXdhdmUnKS5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5zdHlsZS5jdXJzb3IpKS50b0JlKCcnKVxuXHRcdGV4cGVjdChhd2FpdCB2aWRlb3MuZmlyc3QoKS5ldmFsdWF0ZSgodmlkZW8pID0+IHZpZGVvLnBhdXNlZCkpLnRvQmUoZmFsc2UpXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnVGFiJylcblx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiBoZWFyZCh2aWRlb3MpKS50b0VxdWFsKFtmYWxzZSwgdHJ1ZV0pXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnVGFiJylcblx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiBoZWFyZCh2aWRlb3MpKS50b0VxdWFsKFt0cnVlLCBmYWxzZV0pXG5cdFx0Ly8gTW92aW5nIHRocm91Z2ggdGhlIHBhZ2UgYnkga2V5Ym9hcmQsIFRhYiBtb3ZlcyB0aGUgZm9jdXMgYW5kIGxlYXZlcyB0aGUgc291bmQgYWxvbmVcblx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdTaGlmdCtUYWInKVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ1RhYicpXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnVGFiJylcblx0XHRleHBlY3QoYXdhaXQgaGVhcmQodmlkZW9zKSkudG9FcXVhbChbdHJ1ZSwgZmFsc2VdKVxuXHRcdGV4cGVjdChhd2FpdCBwYWdlLmV2YWx1YXRlKCgpID0+IGRvY3VtZW50LmFjdGl2ZUVsZW1lbnQuY2xhc3NMaXN0LmNvbnRhaW5zKCdkZWxpdmVyLWNvbXBhcmUnKSkpLnRvQmUoZmFsc2UpXG5cblx0XHQvLyBBIGxhbmUncyBuYW1lIHBsYXlzIGl0cyBzaWRlXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci13YXZlX19sYW5lJykubnRoKDEpLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiBoZWFyZCh2aWRlb3MpKS50b0VxdWFsKFtmYWxzZSwgdHJ1ZV0pXG5cdFx0YXdhaXQgZXhwZWN0KHNpZGUpLnRvSGF2ZUF0dHJpYnV0ZSgnYXJpYS1jaGVja2VkJywgJ3RydWUnKVxuXHRcdGV4cGVjdChhd2FpdCB2aWRlb3MuZXZhbHVhdGVBbGwoKGFsbCkgPT4gYWxsLm1hcCgodmlkZW8pID0+IHZpZGVvLnBhdXNlZCkpKS50b0VxdWFsKFtmYWxzZSwgZmFsc2VdKVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdQYXVzZSAoU3BhY2UpJyB9KS5jbGljaygpXG5cdH0pXG5cblx0dGVzdCgnc3dpdGNoaW5nIHRlbiB0aW1lcyB3aGlsZSBib3RoIHBsYXkgc2Vla3MgbmVpdGhlciBzaWRlLCB0aGUgaGVhcmQgc291bmQgcnVucyBvbiBpbiByZWFsIHRpbWUsIGFuZCB0aGUgc2lkZXMgc3RheSB3aXRoaW4gbWlsbGlzZWNvbmRzJywgYXN5bmMgKCkgPT4ge1xuXHRcdGF3YWl0IHBhZ2UuZ290byhgL2FwcHMvZGVsaXZlci9jb21wYXJlLyR7bWl4WzFdLmlkfS8ke21peFswXS5pZH1gKVxuXHRcdGNvbnN0IHZpZGVvcyA9IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tcGFyZSB2aWRlbycpXG5cdFx0YXdhaXQgZXhwZWN0KHZpZGVvcy5maXJzdCgpKS50b0hhdmVKU1Byb3BlcnR5KCdyZWFkeVN0YXRlJywgNClcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnUGxheSAoU3BhY2UpJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgcGFnZS53YWl0Rm9yVGltZW91dCgxNTAwKVxuXHRcdC8vIE9uIGV2ZXJ5IGFuaW1hdGlvbiBmcmFtZTogYm90aCB0aW1lcywgd2hvc2Ugc291bmQgaXMgaGVhcmQsIGFuZCBldmVyeSBzZWVrOyBhIHN3aXRjaCBldmVyeSA0MDAgbXNcblx0XHRjb25zdCBydW4gPSBhd2FpdCBwYWdlLmV2YWx1YXRlKCgpID0+IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG5cdFx0XHRjb25zdCBbYSwgYl0gPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCcuZGVsaXZlci1jb21wYXJlIHZpZGVvJylcblx0XHRcdGNvbnN0IGhhbHZlcyA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJy5kZWxpdmVyLWNvbXBhcmVfX3NvdW5kJylcblx0XHRcdGxldCBzZWVrcyA9IDBcblx0XHRcdGEuYWRkRXZlbnRMaXN0ZW5lcignc2Vla2luZycsICgpID0+IHNlZWtzKyspXG5cdFx0XHRiLmFkZEV2ZW50TGlzdGVuZXIoJ3NlZWtpbmcnLCAoKSA9PiBzZWVrcysrKVxuXHRcdFx0Y29uc3Qgc2FtcGxlcyA9IFtdXG5cdFx0XHRjb25zdCBzdGFydCA9IHBlcmZvcm1hbmNlLm5vdygpXG5cdFx0XHRsZXQgc3dpdGNoZXMgPSAwXG5cdFx0XHRjb25zdCB0aWNrID0gKCkgPT4ge1xuXHRcdFx0XHRjb25zdCBub3cgPSBwZXJmb3JtYW5jZS5ub3coKVxuXHRcdFx0XHRjb25zdCBzaWRlID0gaGFsdmVzWzBdLmdldEF0dHJpYnV0ZSgnYXJpYS1jaGVja2VkJykgPT09ICd0cnVlJyA/ICdhJyA6ICdiJ1xuXHRcdFx0XHRzYW1wbGVzLnB1c2goeyBub3csIGE6IGEuY3VycmVudFRpbWUsIGI6IGIuY3VycmVudFRpbWUsIHNpZGUgfSlcblx0XHRcdFx0aWYgKG5vdyAtIHN0YXJ0ID4gKHN3aXRjaGVzICsgMSkgKiA0MDAgJiYgc3dpdGNoZXMgPCAxMCkge1xuXHRcdFx0XHRcdHN3aXRjaGVzKytcblx0XHRcdFx0XHRoYWx2ZXNbc3dpdGNoZXMgJSAyXS5jbGljaygpXG5cdFx0XHRcdH1cblx0XHRcdFx0aWYgKG5vdyAtIHN0YXJ0IDwgNDYwMCkge1xuXHRcdFx0XHRcdHJlcXVlc3RBbmltYXRpb25GcmFtZSh0aWNrKVxuXHRcdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRcdHJlc29sdmUoeyBzZWVrcywgc2FtcGxlcywgcGxheWluZzogIWEucGF1c2VkICYmICFiLnBhdXNlZCB9KVxuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0XHRyZXF1ZXN0QW5pbWF0aW9uRnJhbWUodGljaylcblx0XHR9KSlcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnUGF1c2UgKFNwYWNlKScgfSkuY2xpY2soKVxuXHRcdGV4cGVjdChydW4ucGxheWluZykudG9CZSh0cnVlKVxuXHRcdGV4cGVjdChydW4uc2Vla3MpLnRvQmUoMClcblx0XHRleHBlY3QobmV3IFNldChydW4uc2FtcGxlcy5tYXAoKHNhbXBsZSkgPT4gc2FtcGxlLnNpZGUpKS5zaXplKS50b0JlKDIpXG5cdFx0Y29uc3QgcG9zaXRpb24gPSAoc2FtcGxlKSA9PiBzYW1wbGUuc2lkZSA9PT0gJ2EnID8gc2FtcGxlLmEgOiBzYW1wbGUuYlxuXHRcdGZvciAoY29uc3QgW2F0LCBzYW1wbGVdIG9mIHJ1bi5zYW1wbGVzLmVudHJpZXMoKSkge1xuXHRcdFx0Ly8gV2l0aG91dCBhbiBvZmZzZXQgdGhlIHNpZGVzIHN0YW5kIG9uIHRoZSBzYW1lIHNlY29uZFxuXHRcdFx0ZXhwZWN0KE1hdGguYWJzKHNhbXBsZS5iIC0gc2FtcGxlLmEpKS50b0JlTGVzc1RoYW4oMC4wMSlcblx0XHRcdGlmIChhdCA+IDApIHtcblx0XHRcdFx0Y29uc3QgYmVmb3JlID0gcnVuLnNhbXBsZXNbYXQgLSAxXVxuXHRcdFx0XHQvLyBUaGUgaGVhcmQgc291bmQgZ29lcyBvbiB3aXRoIHRoZSBjbG9jayBhY3Jvc3MgZXZlcnkgc3dpdGNoOyBhIHJlYWRpbmcgb2YgYSBtZWRpYSBlbGVtZW50J3MgdGltZSBpcyBvZmYgYnkgYSBmZXcgbXNcblx0XHRcdFx0ZXhwZWN0KE1hdGguYWJzKChwb3NpdGlvbihzYW1wbGUpIC0gcG9zaXRpb24oYmVmb3JlKSkgLSAoc2FtcGxlLm5vdyAtIGJlZm9yZS5ub3cpIC8gMTAwMCkpLnRvQmVMZXNzVGhhbigwLjAxNSlcblx0XHRcdH1cblx0XHR9XG5cdH0pXG5cblx0dGVzdCgnb24gYSBwYWdlXFwncyBmaXJzdCBQbGF5IHRoZSBzaWRlcyBhcmUgaW4gc3RlcCBmcm9tIHRoZSBmaXJzdCBzZWNvbmQgb24sIHZpZGVvIGFuZCBhdWRpbyBhbGlrZScsIGFzeW5jICgpID0+IHtcblx0XHRmb3IgKGNvbnN0IHBhaXIgb2YgW2N1dCwgbWl4XSkge1xuXHRcdFx0Ly8gQSBwYWdlIG9mIGl0cyBvd246IHRoZSBBdWRpb0NvbnRleHQgaXMgbWFkZSBieSB0aGlzIFBsYXlcblx0XHRcdGNvbnN0IGZyZXNoID0gYXdhaXQgY29udGV4dC5uZXdQYWdlKClcblx0XHRcdGF3YWl0IGZyZXNoLmdvdG8oYC9hcHBzL2RlbGl2ZXIvY29tcGFyZS8ke3BhaXJbMV0uaWR9LyR7cGFpclswXS5pZH1gKVxuXHRcdFx0Y29uc3QgdmlkZW9zID0gZnJlc2gubG9jYXRvcignLmRlbGl2ZXItY29tcGFyZSB2aWRlbycpXG5cdFx0XHRhd2FpdCBleHBlY3QodmlkZW9zLmZpcnN0KCkpLnRvSGF2ZUpTUHJvcGVydHkoJ3JlYWR5U3RhdGUnLCA0KVxuXHRcdFx0Ly8gRWFjaCBzaWRlIGlzIHNvdWdodCBvbmNlLCBieSB0aGUgc3RhcnQgaXRzZWxmOiB0aGUgaGVhcmQgc2lkZSBpcyBuZXZlciBzb3VnaHQgYWdhaW5cblx0XHRcdGF3YWl0IGZyZXNoLmV2YWx1YXRlKCgpID0+IHtcblx0XHRcdFx0d2luZG93LnNlZWtzID0gWzAsIDBdXG5cdFx0XHRcdGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJy5kZWxpdmVyLWNvbXBhcmUgdmlkZW8nKS5mb3JFYWNoKCh2aWRlbywgc2lkZSkgPT4gdmlkZW8uYWRkRXZlbnRMaXN0ZW5lcignc2Vla2luZycsICgpID0+IHdpbmRvdy5zZWVrc1tzaWRlXSsrKSlcblx0XHRcdH0pXG5cdFx0XHRhd2FpdCBmcmVzaC5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1BsYXkgKFNwYWNlKScgfSkuY2xpY2soKVxuXHRcdFx0YXdhaXQgZnJlc2gud2FpdEZvclRpbWVvdXQoMTAwMClcblx0XHRcdGV4cGVjdChhd2FpdCBmcmVzaC5ldmFsdWF0ZSgoKSA9PiB3aW5kb3cuc2Vla3MpKS50b0VxdWFsKFsxLCAxXSlcblx0XHRcdGNvbnN0IGFwYXJ0ID0gYXdhaXQgZnJlc2guZXZhbHVhdGUoKCkgPT4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcblx0XHRcdFx0Y29uc3QgW2EsIGJdID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnLmRlbGl2ZXItY29tcGFyZSB2aWRlbycpXG5cdFx0XHRcdGNvbnN0IGZvdW5kID0gW11cblx0XHRcdFx0Y29uc3Qgc3RhcnQgPSBwZXJmb3JtYW5jZS5ub3coKVxuXHRcdFx0XHRjb25zdCB0aWNrID0gKCkgPT4ge1xuXHRcdFx0XHRcdGZvdW5kLnB1c2goTWF0aC5hYnMoYi5jdXJyZW50VGltZSAtIGEuY3VycmVudFRpbWUpKVxuXHRcdFx0XHRcdGlmIChwZXJmb3JtYW5jZS5ub3coKSAtIHN0YXJ0IDwgMTUwMCkge1xuXHRcdFx0XHRcdFx0cmVxdWVzdEFuaW1hdGlvbkZyYW1lKHRpY2spXG5cdFx0XHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0XHRcdHJlc29sdmUoTWF0aC5tYXgoLi4uZm91bmQpKVxuXHRcdFx0XHRcdH1cblx0XHRcdFx0fVxuXHRcdFx0XHRyZXF1ZXN0QW5pbWF0aW9uRnJhbWUodGljaylcblx0XHRcdH0pKVxuXHRcdFx0ZXhwZWN0KGFwYXJ0KS50b0JlTGVzc1RoYW4oMC4wMDUpXG5cdFx0XHRleHBlY3QoYXdhaXQgZnJlc2guZXZhbHVhdGUoKCkgPT4gd2luZG93LnNlZWtzKSkudG9FcXVhbChbMSwgMV0pXG5cdFx0XHRhd2FpdCBmcmVzaC5jbG9zZSgpXG5cdFx0fVxuXHR9KVxuXG5cdHRlc3QoJ3doaWxlIHRoZSBBdWRpb0NvbnRleHQgaXMgc2xvdyB0byBzdGFydCwgb25lIHN0YXJ0IHdhaXRzIGF0IGEgdGltZSBhbmQgYSBzd2l0Y2ggbWFkZSBtZWFud2hpbGUgaXMgdGhlIHNpZGUgaGVhcmQnLCBhc3luYyAoKSA9PiB7XG5cdFx0Ly8gQSBjb250ZXh0IHRoYXQgdGFrZXMgMzAwIG1zIHRvIHJ1biwgYXMgYSBzbG93IG91dHB1dCBtYXlcblx0XHRjb25zdCBzbG93ID0gYXdhaXQgYnJvd3Nlci5uZXdDb250ZXh0KHsgYmFzZVVSTDogQlJPV1NFUl9VUkwgfSlcblx0XHRhd2FpdCBzbG93LmFkZEluaXRTY3JpcHQoKCkgPT4ge1xuXHRcdFx0Y29uc3QgcmVzdW1lID0gQXVkaW9Db250ZXh0LnByb3RvdHlwZS5yZXN1bWVcblx0XHRcdEF1ZGlvQ29udGV4dC5wcm90b3R5cGUucmVzdW1lID0gZnVuY3Rpb24oKSB7XG5cdFx0XHRcdHJldHVybiBuZXcgUHJvbWlzZSgoZG9uZSkgPT4gc2V0VGltZW91dChkb25lLCAzMDApKS50aGVuKCgpID0+IHJlc3VtZS5jYWxsKHRoaXMpKVxuXHRcdFx0fVxuXHRcdH0pXG5cdFx0Y29uc3QgcGFnZSA9IGF3YWl0IHNsb3cubmV3UGFnZSgpXG5cdFx0YXdhaXQgbG9naW4ocGFnZSlcblx0XHRjb25zdCBvcGVuID0gYXN5bmMgKCkgPT4ge1xuXHRcdFx0YXdhaXQgcGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL2NvbXBhcmUvJHttaXhbMV0uaWR9LyR7bWl4WzBdLmlkfWApXG5cdFx0XHRjb25zdCB2aWRlb3MgPSBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbXBhcmUgdmlkZW8nKVxuXHRcdFx0YXdhaXQgZXhwZWN0KHZpZGVvcy5maXJzdCgpKS50b0hhdmVKU1Byb3BlcnR5KCdyZWFkeVN0YXRlJywgNClcblx0XHRcdGF3YWl0IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItbGF5b3V0X19iYXIgaDInKS5jbGljaygpXG5cdFx0XHRyZXR1cm4gdmlkZW9zXG5cdFx0fVxuXG5cdFx0Ly8gUGxheSwgUGF1c2UgYW5kIFBsYXkgd2l0aGluIHRoZSB3YWl0OiBlYWNoIHNpZGUgaXMgc291Z2h0IGJ5IHRoZSBQYXVzZSBhbmQgYnkgdGhlIG9uZSBzdGFydCwgbmV2ZXIgYWdhaW4gd2hpbGUgaXQgcGxheXNcblx0XHRsZXQgdmlkZW9zID0gYXdhaXQgb3BlbigpXG5cdFx0YXdhaXQgdmlkZW9zLmV2YWx1YXRlQWxsKChhbGwpID0+IHtcblx0XHRcdHdpbmRvdy5zZWVrcyA9IFswLCAwXVxuXHRcdFx0YWxsLmZvckVhY2goKHZpZGVvLCBzaWRlKSA9PiB2aWRlby5hZGRFdmVudExpc3RlbmVyKCdzZWVraW5nJywgKCkgPT4gd2luZG93LnNlZWtzW3NpZGVdKyspKVxuXHRcdH0pXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnU3BhY2UnKVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ1NwYWNlJylcblx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdTcGFjZScpXG5cdFx0YXdhaXQgcGFnZS53YWl0Rm9yVGltZW91dCgxNTAwKVxuXHRcdGV4cGVjdChhd2FpdCBwYWdlLmV2YWx1YXRlKCgpID0+IHdpbmRvdy5zZWVrcykpLnRvRXF1YWwoWzIsIDJdKVxuXHRcdGNvbnN0IHN0YXRlID0gYXdhaXQgdmlkZW9zLmV2YWx1YXRlQWxsKChhbGwpID0+IGFsbC5tYXAoKHZpZGVvKSA9PiAoeyBwYXVzZWQ6IHZpZGVvLnBhdXNlZCwgdGltZTogdmlkZW8uY3VycmVudFRpbWUgfSkpKVxuXHRcdGV4cGVjdChzdGF0ZS5tYXAoKGVhY2gpID0+IGVhY2gucGF1c2VkKSkudG9FcXVhbChbZmFsc2UsIGZhbHNlXSlcblx0XHRleHBlY3QoTWF0aC5hYnMoc3RhdGVbMV0udGltZSAtIHN0YXRlWzBdLnRpbWUpKS50b0JlTGVzc1RoYW4oMC4wMDUpXG5cblx0XHQvLyBBIHN3aXRjaCBtYWRlIHdoaWxlIHRoZSBjb250ZXh0IHN0YXJ0cyBpcyB0aGUgc2lkZSBoZWFyZCBvbmNlIGl0IHJ1bnNcblx0XHR2aWRlb3MgPSBhd2FpdCBvcGVuKClcblx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdTcGFjZScpXG5cdFx0YXdhaXQgcGFnZS53YWl0Rm9yVGltZW91dCgxMDApXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnMicpXG5cdFx0YXdhaXQgcGFnZS53YWl0Rm9yVGltZW91dCg2MDApXG5cdFx0ZXhwZWN0KGF3YWl0IHZpZGVvcy5ldmFsdWF0ZUFsbCgoYWxsKSA9PiBhbGwubWFwKCh2aWRlbykgPT4gISF2aWRlby5kZWxpdmVyR2FpbiAmJiAhdmlkZW8ubXV0ZWQpKSkudG9FcXVhbChbdHJ1ZSwgdHJ1ZV0pXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gaGVhcmQodmlkZW9zKSkudG9FcXVhbChbZmFsc2UsIHRydWVdKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5Um9sZSgncmFkaW8nLCB7IG5hbWU6IC9eVjIvIH0pKS50b0hhdmVBdHRyaWJ1dGUoJ2FyaWEtY2hlY2tlZCcsICd0cnVlJylcblx0XHRhd2FpdCBzbG93LmNsb3NlKClcblx0fSlcblxuXHR0ZXN0KCdhIGxvb3BlZCBSYW5nZSBhbHRlcm5hdGluZyBBIGFuZCBCIHBsYXlzIEEsIHRoZW4gQiwgdGhlbiBBLCBzd2l0Y2hpbmcgYXQgZWFjaCB3cmFwJywgYXN5bmMgKCkgPT4ge1xuXHRcdGF3YWl0IHBhZ2UuZ290byhgL2FwcHMvZGVsaXZlci9jb21wYXJlLyR7bWl4WzFdLmlkfS8ke21peFswXS5pZH1gKVxuXHRcdGNvbnN0IHZpZGVvcyA9IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tcGFyZSB2aWRlbycpXG5cdFx0YXdhaXQgZXhwZWN0KHZpZGVvcy5maXJzdCgpKS50b0hhdmVKU1Byb3BlcnR5KCdyZWFkeVN0YXRlJywgNClcblx0XHQvLyBUaGUgUmFuZ2UgZnJvbSA1IHMgdG8gNiBzIG9mIHRoZSAyMCwgYnkgdGhlIGJhciBhbmQgSSBhbmQgTywgYW5kIGJhY2sgdG8gaXRzIHN0YXJ0XG5cdFx0Y29uc3QgYmFyID0gYXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21wYXJlX190aW1lbGluZScpLmJvdW5kaW5nQm94KClcblx0XHRjb25zdCBhdCA9IChzaGFyZSkgPT4gcGFnZS5tb3VzZS5jbGljayhiYXIueCArIGJhci53aWR0aCAqIHNoYXJlLCBiYXIueSArIGJhci5oZWlnaHQgLyAyKVxuXHRcdGF3YWl0IGF0KDAuMjUpXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnaScpXG5cdFx0YXdhaXQgYXQoMC4zKVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ28nKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbXBhcmVfX2NoaXAnKSkudG9Db250YWluVGV4dCgvMDowNVxcLjBcXGRcXGQg4oCTIDA6MDZcXC4wXFxkXFxkLylcblx0XHRhd2FpdCBhdCgwLjI1KVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdBbHRlcm5hdGUgQS9CJyB9KS5jbGljaygpXG5cdFx0Ly8gQWx0ZXJuYXRpbmcgbG9vcHNcblx0XHRhd2FpdCBleHBlY3QocGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ0xvb3AgdGhlIFJhbmdlJyB9KSkudG9IYXZlQXR0cmlidXRlKCdhcmlhLXByZXNzZWQnLCAndHJ1ZScpXG5cblx0XHQvLyBXaG9zZSBzb3VuZCBwbGF5cyBvbiBldmVyeSBhbmltYXRpb24gZnJhbWUsIGN1dCBpbnRvIHBhc3NlcyB3aGVyZSB0aGUgdGltZSBqdW1wcyBiYWNrXG5cdFx0Y29uc3QgcGFzc2VzID0gYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuXHRcdFx0Y29uc3QgW2EsIGJdID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnLmRlbGl2ZXItY29tcGFyZSB2aWRlbycpXG5cdFx0XHRjb25zdCBmb3VuZCA9IFtdXG5cdFx0XHRsZXQgbGFzdCA9IEluZmluaXR5XG5cdFx0XHRjb25zdCB0aWNrID0gKCkgPT4ge1xuXHRcdFx0XHRjb25zdCB0aW1lID0gYS5jdXJyZW50VGltZVxuXHRcdFx0XHRjb25zdCBnYWluID0gKHZpZGVvKSA9PiB2aWRlby5kZWxpdmVyR2FpbiAmJiAhdmlkZW8ubXV0ZWQgPyB2aWRlby5kZWxpdmVyR2Fpbi5nYWluLnZhbHVlID4gMC41IDogIXZpZGVvLm11dGVkXG5cdFx0XHRcdGNvbnN0IGhlYXJkID0gZ2FpbihhKSA/IChnYWluKGIpID8gJ2JvdGgnIDogJ2EnKSA6IChnYWluKGIpID8gJ2InIDogJ25vbmUnKVxuXHRcdFx0XHRpZiAodGltZSA8IGxhc3QgLSAwLjMpIHtcblx0XHRcdFx0XHRmb3VuZC5wdXNoKHsgZnJvbTogdGltZSwgdG86IHRpbWUsIGhlYXJkOiBuZXcgU2V0KCkgfSlcblx0XHRcdFx0fVxuXHRcdFx0XHRsYXN0ID0gdGltZVxuXHRcdFx0XHRjb25zdCBwYXNzID0gZm91bmQuYXQoLTEpXG5cdFx0XHRcdGlmIChwYXNzICYmICFhLnBhdXNlZCkge1xuXHRcdFx0XHRcdHBhc3MudG8gPSB0aW1lXG5cdFx0XHRcdFx0cGFzcy5oZWFyZC5hZGQoaGVhcmQpXG5cdFx0XHRcdH1cblx0XHRcdFx0aWYgKGZvdW5kLmxlbmd0aCA+IDMpIHtcblx0XHRcdFx0XHRyZXNvbHZlKGZvdW5kLnNsaWNlKDAsIDMpLm1hcCgoZWFjaCkgPT4gKHsgLi4uZWFjaCwgaGVhcmQ6IFsuLi5lYWNoLmhlYXJkXSB9KSkpXG5cdFx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdFx0cmVxdWVzdEFuaW1hdGlvbkZyYW1lKHRpY2spXG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHRcdHJlcXVlc3RBbmltYXRpb25GcmFtZSh0aWNrKVxuXHRcdFx0ZG9jdW1lbnQucXVlcnlTZWxlY3RvcignLmRlbGl2ZXItY29tcGFyZV9fY29udHJvbHMgYnV0dG9uW2FyaWEtbGFiZWw9XCJQbGF5IChTcGFjZSlcIl0nKS5jbGljaygpXG5cdFx0fSkpXG5cdFx0ZXhwZWN0KHBhc3Nlcy5tYXAoKHBhc3MpID0+IHBhc3MuaGVhcmQpKS50b0VxdWFsKFtbJ2EnXSwgWydiJ10sIFsnYSddXSlcblx0XHRmb3IgKGNvbnN0IHBhc3Mgb2YgcGFzc2VzKSB7XG5cdFx0XHRleHBlY3QocGFzcy5mcm9tKS50b0JlQ2xvc2VUbyg1LCAxKVxuXHRcdFx0ZXhwZWN0KHBhc3MudG8pLnRvQmVHcmVhdGVyVGhhbig1LjkpXG5cdFx0XHRleHBlY3QocGFzcy50bykudG9CZUxlc3NUaGFuKDYuMSlcblx0XHR9XG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1BhdXNlIChTcGFjZSknIH0pLmNsaWNrKClcblx0XHQvLyBUaGUgc3dpdGNoIHRlbGxzIHdob3NlIHBhc3MgaXQgaXNcblx0XHRjb25zdCBub3cgPSAoYXdhaXQgaGVhcmQodmlkZW9zKSlbMF0gPyAvXlYxLyA6IC9eVjIvXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKCdyYWRpbycsIHsgbmFtZTogbm93IH0pKS50b0hhdmVBdHRyaWJ1dGUoJ2FyaWEtY2hlY2tlZCcsICd0cnVlJylcblx0fSlcblxuXHR0ZXN0KCdhIHZpZGVvIENvbXBhcmUgc2hvd3MgYm90aCBXYXZlZm9ybXMgdW5kZXIgdGhlIHBpY3R1cmVzIHdoZW4gYXNrZWQsIGFuZCB0aGUgcGljdHVyZXMgc3RheScsIGFzeW5jICgpID0+IHtcblx0XHRhd2FpdCBwYWdlLmdvdG8oYC9hcHBzL2RlbGl2ZXIvY29tcGFyZS8ke2N1dFsxXS5pZH0vJHtjdXRbMF0uaWR9YClcblx0XHRjb25zdCB2aWRlb3MgPSBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbXBhcmUgdmlkZW8nKVxuXHRcdGF3YWl0IGV4cGVjdCh2aWRlb3MuZmlyc3QoKSkudG9IYXZlSlNQcm9wZXJ0eSgncmVhZHlTdGF0ZScsIDQpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tcGFyZV9fbGFuZXMnKSkudG9IYXZlQ291bnQoMClcblx0XHQvLyBUaGUgQS9CIHN3aXRjaCByZXBsYWNlcyB0aGUgc21hbGwgc291bmQgYnV0dG9uIG9mIHRoZSBiYXJcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgncmFkaW8nLCB7IG5hbWU6IC9eVjIvIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiBoZWFyZCh2aWRlb3MpKS50b0VxdWFsKFtmYWxzZSwgdHJ1ZV0pXG5cblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnV2F2ZWZvcm1zJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tcGFyZV9fbGFuZXMgY2FudmFzJykpLnRvQmVWaXNpYmxlKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21wYXJlX19zdGFnZScpKS50b0JlVmlzaWJsZSgpXG5cdFx0Zm9yIChjb25zdCB2aWRlbyBvZiBhd2FpdCB2aWRlb3MuYWxsKCkpIHtcblx0XHRcdGV4cGVjdCgoYXdhaXQgdmlkZW8uYm91bmRpbmdCb3goKSkuaGVpZ2h0KS50b0JlR3JlYXRlclRoYW4oMTAwKVxuXHRcdH1cblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgncmFkaW8nLCB7IG5hbWU6ICdXaXBlJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tcGFyZV9faGFuZGxlJykpLnRvQmVWaXNpYmxlKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21wYXJlX19sYW5lcyBjYW52YXMnKSkudG9CZVZpc2libGUoKVxuXHR9KVxuXG5cdHRlc3QoJ29uIGEgcGhvbmUgaGVsZCBzaWRld2F5cywgcGljdHVyZXMsIGJvdGggbGFuZXMgYW5kIHRoZSB0cmFuc3BvcnQgZml0IHdpdGhvdXQgc2Nyb2xsaW5nJywgYXN5bmMgKCkgPT4ge1xuXHRcdGNvbnN0IHBob25lID0gYXdhaXQgYnJvd3Nlci5uZXdDb250ZXh0KHsgYmFzZVVSTDogQlJPV1NFUl9VUkwsIC4uLlBIT05FLCB2aWV3cG9ydDogeyB3aWR0aDogODQ0LCBoZWlnaHQ6IDM5MCB9IH0pXG5cdFx0Y29uc3Qgc2lkZXdheXMgPSBhd2FpdCBwaG9uZS5uZXdQYWdlKClcblx0XHRhd2FpdCBsb2dpbihzaWRld2F5cylcblx0XHRhd2FpdCBzaWRld2F5cy5nb3RvKGAvYXBwcy9kZWxpdmVyL2NvbXBhcmUvJHtjdXRbMV0uaWR9LyR7Y3V0WzBdLmlkfWApXG5cdFx0YXdhaXQgZXhwZWN0KHNpZGV3YXlzLmxvY2F0b3IoJy5kZWxpdmVyLWNvbXBhcmUgdmlkZW8nKS5maXJzdCgpKS50b0hhdmVKU1Byb3BlcnR5KCdyZWFkeVN0YXRlJywgNClcblx0XHRhd2FpdCBzaWRld2F5cy5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1BsYXliYWNrIHNldHRpbmdzJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgc2lkZXdheXMuZ2V0QnlSb2xlKCdtZW51aXRlbWNoZWNrYm94JywgeyBuYW1lOiAnV2F2ZWZvcm1zJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgc2lkZXdheXMua2V5Ym9hcmQucHJlc3MoJ0VzY2FwZScpXG5cdFx0YXdhaXQgZXhwZWN0KHNpZGV3YXlzLmxvY2F0b3IoJy5kZWxpdmVyLWNvbXBhcmVfX2xhbmVzIGNhbnZhcycpKS50b0JlVmlzaWJsZSgpXG5cdFx0Y29uc3Qgc3RhZ2UgPSBhd2FpdCBzaWRld2F5cy5sb2NhdG9yKCcuZGVsaXZlci1jb21wYXJlX19zdGFnZScpLmJvdW5kaW5nQm94KClcblx0XHRjb25zdCBjb250cm9scyA9IGF3YWl0IHNpZGV3YXlzLmxvY2F0b3IoJy5kZWxpdmVyLWNvbXBhcmVfX2NvbnRyb2xzJykuYm91bmRpbmdCb3goKVxuXHRcdGV4cGVjdChzdGFnZS5oZWlnaHQpLnRvQmVHcmVhdGVyVGhhbig4MClcblx0XHRleHBlY3QoY29udHJvbHMueSArIGNvbnRyb2xzLmhlaWdodCkudG9CZUxlc3NUaGFuT3JFcXVhbCgzOTApXG5cdFx0Y29uc3Qgc291bmQgPSBhd2FpdCBzaWRld2F5cy5nZXRCeVJvbGUoJ3JhZGlvJywgeyBuYW1lOiAvXlYxLyB9KS5ib3VuZGluZ0JveCgpXG5cdFx0ZXhwZWN0KHNvdW5kLmhlaWdodCkudG9CZUdyZWF0ZXJUaGFuT3JFcXVhbCg0NClcblx0XHRhd2FpdCBwaG9uZS5jbG9zZSgpXG5cdH0pXG59KVxuXG50ZXN0LmRlc2NyaWJlKCdTa2lwcGluZyB0ZW4gc2Vjb25kcycsICgpID0+IHtcblx0bGV0IGJyb3dzZXJcblx0bGV0IGNvbnRleHRcblx0bGV0IHBhZ2Vcblx0bGV0IGZvbGRlclxuXHRsZXQgcHJvamVjdElkXG5cdGxldCB2ZXJzaW9uSWRcblxuXHR0ZXN0LmJlZm9yZUFsbChhc3luYyAoeyBwbGF5d3JpZ2h0IH0pID0+IHtcblx0XHRhd2FpdCB0ZXN0VXNlcihwbGF5d3JpZ2h0KVxuXHRcdGNvbnN0IGFwaSA9IGF3YWl0IHBsYXl3cmlnaHQucmVxdWVzdC5uZXdDb250ZXh0KHsgYmFzZVVSTDogVVJMLCBodHRwQ3JlZGVudGlhbHM6IGF1dGgsIGV4dHJhSFRUUEhlYWRlcnM6IG9jc0hlYWRlcnMgfSlcblx0XHRmb2xkZXIgPSAnZGVsaXZlci1lMmUtJyArIHJhbmRvbUJ5dGVzKDQpLnRvU3RyaW5nKCdoZXgnKVxuXHRcdGNvbnN0IGRhdiA9IGAvcmVtb3RlLnBocC9kYXYvZmlsZXMvJHtVU0VSfS8ke2ZvbGRlcn1gXG5cdFx0ZXhwZWN0KChhd2FpdCBhcGkuZmV0Y2goZGF2LCB7IG1ldGhvZDogJ01LQ09MJyB9KSkuc3RhdHVzKCkpLnRvQmUoMjAxKVxuXHRcdGV4cGVjdCgoYXdhaXQgYXBpLmZldGNoKGAke2Rhdn0vbG9uZy53ZWJtYCwgeyBtZXRob2Q6ICdQVVQnLCBkYXRhOiByZWFkRmlsZVN5bmMoTE9ORykgfSkpLnN0YXR1cygpKS50b0JlKDIwMSlcblx0XHRjb25zdCBjcmVhdGVkID0gYXdhaXQgYXBpLnBvc3QoJy9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHM/Zm9ybWF0PWpzb24nLCB7IGRhdGE6IHsgZm9sZGVySWQ6IGF3YWl0IGZpbGVJZChhcGksIGRhdiksIGF1dG9JbnRha2U6IHRydWUgfSB9KVxuXHRcdHByb2plY3RJZCA9IChhd2FpdCBjcmVhdGVkLmpzb24oKSkub2NzLmRhdGEuaWRcblx0XHRjb25zdCBwcm9qZWN0ID0gYXdhaXQgYXBpLmdldChgL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS9wcm9qZWN0cy8ke3Byb2plY3RJZH0/Zm9ybWF0PWpzb25gKVxuXHRcdHZlcnNpb25JZCA9IChhd2FpdCBwcm9qZWN0Lmpzb24oKSkub2NzLmRhdGEuYXNzZXRzWzBdLnZlcnNpb25zWzBdLmlkXG5cdFx0YXdhaXQgYXBpLmRpc3Bvc2UoKVxuXHRcdGJyb3dzZXIgPSBhd2FpdCBjaHJvbWl1bS5jb25uZWN0T3ZlckNEUChDRFApXG5cdFx0Y29udGV4dCA9IGF3YWl0IGJyb3dzZXIubmV3Q29udGV4dCh7IGJhc2VVUkw6IEJST1dTRVJfVVJMIH0pXG5cdFx0cGFnZSA9IGF3YWl0IGNvbnRleHQubmV3UGFnZSgpXG5cdFx0YXdhaXQgbG9naW4ocGFnZSlcblx0fSlcblxuXHR0ZXN0LmFmdGVyQWxsKGFzeW5jICh7IHBsYXl3cmlnaHQgfSkgPT4ge1xuXHRcdGF3YWl0IGNvbnRleHQ/LmNsb3NlKClcblx0XHRhd2FpdCBicm93c2VyPy5jbG9zZSgpXG5cdFx0Y29uc3QgYXBpID0gYXdhaXQgcGxheXdyaWdodC5yZXF1ZXN0Lm5ld0NvbnRleHQoeyBiYXNlVVJMOiBVUkwsIGh0dHBDcmVkZW50aWFsczogYXV0aCwgZXh0cmFIVFRQSGVhZGVyczogb2NzSGVhZGVycyB9KVxuXHRcdGF3YWl0IGFwaS5kZWxldGUoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHMvJHtwcm9qZWN0SWR9P2Zvcm1hdD1qc29uYClcblx0XHRhd2FpdCBhcGkuZmV0Y2goYC9yZW1vdGUucGhwL2Rhdi9maWxlcy8ke1VTRVJ9LyR7Zm9sZGVyfWAsIHsgbWV0aG9kOiAnREVMRVRFJyB9KVxuXHRcdGF3YWl0IGFwaS5kaXNwb3NlKClcblx0fSlcblxuXHR0ZXN0KCd0aGUgYnV0dG9ucyBhbmQgU2hpZnQrYXJyb3dzIGp1bXAgdGVuIHNlY29uZHMgYW5kIGtlZXAgdGhlIHBsYXliYWNrIHN0YXRlJywgYXN5bmMgKCkgPT4ge1xuXHRcdGF3YWl0IHBhZ2UuZ290byhgL2FwcHMvZGVsaXZlci92ZXJzaW9ucy8ke3ZlcnNpb25JZH1gKVxuXHRcdGNvbnN0IHZpZGVvID0gcGFnZS5sb2NhdG9yKCd2aWRlby5kZWxpdmVyLXBsYXllcl9fdmlkZW8nKVxuXHRcdGF3YWl0IGV4cGVjdCh2aWRlbykudG9IYXZlSlNQcm9wZXJ0eSgncmVhZHlTdGF0ZScsIDQpXG5cdFx0Y29uc3QgdGltZSA9ICgpID0+IHZpZGVvLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LmN1cnJlbnRUaW1lKVxuXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogL15Gb3J3YXJkIDEwIHNlY29uZHMvIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QucG9sbCh0aW1lKS50b0JlQ2xvc2VUbygxMCwgMClcblx0XHRleHBlY3QoYXdhaXQgdmlkZW8uZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQucGF1c2VkKSkudG9CZSh0cnVlKVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6IC9eQmFjayAxMCBzZWNvbmRzLyB9KS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwodGltZSkudG9CZUNsb3NlVG8oMCwgMClcblxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6IC9eUGxheSBcXCgvIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QucG9sbCh0aW1lKS50b0JlR3JlYXRlclRoYW4oMC4xKVxuXHRcdGF3YWl0IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcmV2aWV3X190aXRsZScpLmNsaWNrKClcblx0XHRjb25zdCBiZWZvcmVGb3J3YXJkID0gYXdhaXQgdGltZSgpXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnU2hpZnQrQXJyb3dSaWdodCcpXG5cdFx0YXdhaXQgcGFnZS53YWl0Rm9yVGltZW91dCgzMDApXG5cdFx0ZXhwZWN0KGF3YWl0IHRpbWUoKSkudG9CZUdyZWF0ZXJUaGFuKGJlZm9yZUZvcndhcmQgKyA5LjUpXG5cdFx0ZXhwZWN0KGF3YWl0IHZpZGVvLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LnBhdXNlZCkpLnRvQmUoZmFsc2UpXG5cdFx0Y29uc3QgYmVmb3JlQmFjayA9IGF3YWl0IHRpbWUoKVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ1NoaWZ0K0Fycm93TGVmdCcpXG5cdFx0YXdhaXQgcGFnZS53YWl0Rm9yVGltZW91dCgzMDApXG5cdFx0ZXhwZWN0KGF3YWl0IHRpbWUoKSkudG9CZUxlc3NUaGFuKGJlZm9yZUJhY2sgLSA5KVxuXHRcdGV4cGVjdChhd2FpdCB2aWRlby5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5wYXVzZWQpKS50b0JlKGZhbHNlKVxuXHR9KVxufSlcblxudGVzdC5kZXNjcmliZSgnVXBsb2FkcyB3aXRob3V0IGZmbXBlZycsICgpID0+IHtcblx0bGV0IGFkbWluXG5cdGxldCBwcm9qZWN0SWRcblxuXHR0ZXN0LmJlZm9yZUFsbChhc3luYyAoeyBwbGF5d3JpZ2h0IH0pID0+IHtcblx0XHRhd2FpdCB0ZXN0VXNlcihwbGF5d3JpZ2h0KVxuXHRcdGFkbWluID0gYXdhaXQgcGxheXdyaWdodC5yZXF1ZXN0Lm5ld0NvbnRleHQoeyBiYXNlVVJMOiBVUkwsIGh0dHBDcmVkZW50aWFsczogeyB1c2VybmFtZTogQURNSU4sIHBhc3N3b3JkOiBBRE1JTl9QQVNTV09SRCwgc2VuZDogJ2Fsd2F5cycgfSwgZXh0cmFIVFRQSGVhZGVyczogb2NzSGVhZGVycyB9KVxuXHRcdGV4cGVjdCgoYXdhaXQgYWRtaW4ucHV0KCcvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL2FkbWluL3NldHRpbmdzP2Zvcm1hdD1qc29uJywgeyBkYXRhOiB7IGZmbXBlZ1BhdGg6ICcvbm9uZXhpc3RlbnQvZmZtcGVnJywgZmZwcm9iZVBhdGg6ICcvbm9uZXhpc3RlbnQvZmZwcm9iZScgfSB9KSkub2soKSkudG9CZSh0cnVlKVxuXHRcdGNvbnN0IGFwaSA9IGF3YWl0IHBsYXl3cmlnaHQucmVxdWVzdC5uZXdDb250ZXh0KHsgYmFzZVVSTDogVVJMLCBodHRwQ3JlZGVudGlhbHM6IGF1dGgsIGV4dHJhSFRUUEhlYWRlcnM6IG9jc0hlYWRlcnMgfSlcblx0XHRjb25zdCBkYXYgPSBgL3JlbW90ZS5waHAvZGF2L2ZpbGVzLyR7VVNFUn0vZGVsaXZlci1lMmUtJHtyYW5kb21CeXRlcyg0KS50b1N0cmluZygnaGV4Jyl9YFxuXHRcdGV4cGVjdCgoYXdhaXQgYXBpLmZldGNoKGRhdiwgeyBtZXRob2Q6ICdNS0NPTCcgfSkpLnN0YXR1cygpKS50b0JlKDIwMSlcblx0XHRjb25zdCBjcmVhdGVkID0gYXdhaXQgYXBpLnBvc3QoJy9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHM/Zm9ybWF0PWpzb24nLCB7IGRhdGE6IHsgZm9sZGVySWQ6IGF3YWl0IGZpbGVJZChhcGksIGRhdikgfSB9KVxuXHRcdHByb2plY3RJZCA9IChhd2FpdCBjcmVhdGVkLmpzb24oKSkub2NzLmRhdGEuaWRcblx0XHRhd2FpdCBhcGkuZGlzcG9zZSgpXG5cdH0pXG5cblx0dGVzdC5hZnRlckFsbChhc3luYyAoKSA9PiB7XG5cdFx0YXdhaXQgYWRtaW4ucHV0KCcvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL2FkbWluL3NldHRpbmdzP2Zvcm1hdD1qc29uJywgeyBkYXRhOiB7IGZmbXBlZ1BhdGg6ICcnLCBmZnByb2JlUGF0aDogJycgfSB9KVxuXHRcdGF3YWl0IGFkbWluLmRpc3Bvc2UoKVxuXHR9KVxuXG5cdHRlc3QoJ3JlZnVzZXMgd2hhdCB0aGlzIGJyb3dzZXIgY2FuIG5laXRoZXIgcGxheSBub3IgY29udmVydCwgYmVmb3JlIGl0IGdvZXMgdXAsIGFuZCB0YWtlcyB3aGF0IHBsYXlzJywgYXN5bmMgKCkgPT4ge1xuXHRcdGNvbnN0IGJyb3dzZXIgPSBhd2FpdCBjaHJvbWl1bS5jb25uZWN0T3ZlckNEUChDRFApXG5cdFx0Y29uc3QgY29udGV4dCA9IGF3YWl0IGJyb3dzZXIubmV3Q29udGV4dCh7IGJhc2VVUkw6IEJST1dTRVJfVVJMIH0pXG5cdFx0Y29uc3QgcGFnZSA9IGF3YWl0IGNvbnRleHQubmV3UGFnZSgpXG5cdFx0dHJ5IHtcblx0XHRcdGF3YWl0IGxvZ2luKHBhZ2UpXG5cdFx0XHRhd2FpdCBwYWdlLmdvdG8oYC9hcHBzL2RlbGl2ZXIvcHJvamVjdHMvJHtwcm9qZWN0SWR9YClcblx0XHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdVcGxvYWQnLCBleGFjdDogdHJ1ZSB9KS5jbGljaygpXG5cdFx0XHRjb25zdCB1cGxvYWRzID0gcGFnZS5nZXRCeVJvbGUoJ2RpYWxvZycsIHsgbmFtZTogJ1VwbG9hZHMnIH0pXG5cdFx0XHRhd2FpdCB1cGxvYWRzLmxvY2F0b3IoJ2lucHV0W3R5cGU9ZmlsZV1bbXVsdGlwbGVdJykuc2V0SW5wdXRGaWxlcyh7IG5hbWU6ICdtYXN0ZXIubW92JywgbWltZVR5cGU6ICd2aWRlby9xdWlja3RpbWUnLCBidWZmZXI6IHJlYWRGaWxlU3luYyhETlhIUikgfSlcblx0XHRcdGF3YWl0IGV4cGVjdCh1cGxvYWRzLmxvY2F0b3IoJy5kZWxpdmVyLXVwbG9hZHNfX3N0YXR1cy0tZXJyb3InKSkudG9Db250YWluVGV4dCgnVGhpcyBmb3JtYXQgbmVlZHMgZmZtcGVnLCB3aGljaCB0aGlzIE5leHRjbG91ZCBsYWNrcy4nKVxuXHRcdFx0YXdhaXQgZXhwZWN0KHVwbG9hZHMuZ2V0QnlUZXh0KCdPcGVuJywgeyBleGFjdDogdHJ1ZSB9KSkudG9IYXZlQ291bnQoMClcblxuXHRcdFx0Ly8gV2hhdCBwbGF5cyBhcyBpdCBpcyBnb2VzIHVwIGFzIGV2ZXJcblx0XHRcdGF3YWl0IHVwbG9hZHMubG9jYXRvcignaW5wdXRbdHlwZT1maWxlXVttdWx0aXBsZV0nKS5zZXRJbnB1dEZpbGVzKHsgbmFtZTogJ21peC53YXYnLCBtaW1lVHlwZTogJ2F1ZGlvL3dhdicsIGJ1ZmZlcjogcmVhZEZpbGVTeW5jKE1JWCkgfSlcblx0XHRcdGF3YWl0IGV4cGVjdCh1cGxvYWRzLmdldEJ5VGV4dCgnT3BlbicsIHsgZXhhY3Q6IHRydWUgfSkpLnRvSGF2ZUNvdW50KDEpXG5cdFx0XHRhd2FpdCBleHBlY3QodXBsb2Fkcy5sb2NhdG9yKCcuZGVsaXZlci11cGxvYWRzX19zdGF0dXMtLWVycm9yJykpLnRvSGF2ZUNvdW50KDEpXG5cdFx0fSBmaW5hbGx5IHtcblx0XHRcdGF3YWl0IGNvbnRleHQuY2xvc2UoKVxuXHRcdH1cblx0fSlcblxuXHR0ZXN0KCdhIGNhbmNlbCB3aGlsZSB0aGUgZmlsZSBpcyBjaGVja2VkIGxlYXZlcyBub3RoaW5nIGJlaGluZCcsIGFzeW5jICh7IHBsYXl3cmlnaHQgfSkgPT4ge1xuXHRcdGNvbnN0IGJyb3dzZXIgPSBhd2FpdCBjaHJvbWl1bS5jb25uZWN0T3ZlckNEUChDRFApXG5cdFx0Y29uc3QgY29udGV4dCA9IGF3YWl0IGJyb3dzZXIubmV3Q29udGV4dCh7IGJhc2VVUkw6IEJST1dTRVJfVVJMIH0pXG5cdFx0Y29uc3QgcGFnZSA9IGF3YWl0IGNvbnRleHQubmV3UGFnZSgpXG5cdFx0Y29uc3QgYXBpID0gYXdhaXQgcGxheXdyaWdodC5yZXF1ZXN0Lm5ld0NvbnRleHQoeyBiYXNlVVJMOiBVUkwsIGh0dHBDcmVkZW50aWFsczogYXV0aCwgZXh0cmFIVFRQSGVhZGVyczogb2NzSGVhZGVycyB9KVxuXHRcdHRyeSB7XG5cdFx0XHRhd2FpdCBsb2dpbihwYWdlKVxuXHRcdFx0YXdhaXQgcGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL3Byb2plY3RzLyR7cHJvamVjdElkfWApXG5cdFx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnVXBsb2FkJywgZXhhY3Q6IHRydWUgfSkuY2xpY2soKVxuXHRcdFx0Y29uc3QgdXBsb2FkcyA9IHBhZ2UuZ2V0QnlSb2xlKCdkaWFsb2cnLCB7IG5hbWU6ICdVcGxvYWRzJyB9KVxuXHRcdFx0Ly8gTWVkaWFidW5ueSBsb2FkcyBsYXppbHkgd2hlbiB0aGUgY2hlY2sgc3RhcnRzOyBob2xkIGl0cyBjaHVua3MgYmFjayBzbyB0aGUgY2FuY2VsIGNvbWVzIGZpcnN0XG5cdFx0XHRsZXQgcmVsZWFzZVxuXHRcdFx0Y29uc3QgaGVsZCA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG5cdFx0XHRcdHJlbGVhc2UgPSByZXNvbHZlXG5cdFx0XHR9KVxuXHRcdFx0YXdhaXQgcGFnZS5yb3V0ZSgnKiovKi5jaHVuay5tanMqJywgYXN5bmMgKHJvdXRlKSA9PiB7XG5cdFx0XHRcdGF3YWl0IGhlbGRcblx0XHRcdFx0YXdhaXQgcm91dGUuY29udGludWUoKVxuXHRcdFx0fSlcblx0XHRcdGF3YWl0IHVwbG9hZHMubG9jYXRvcignaW5wdXRbdHlwZT1maWxlXVttdWx0aXBsZV0nKS5zZXRJbnB1dEZpbGVzKHsgbmFtZTogJ2NhbmNlbGxlZC53YXYnLCBtaW1lVHlwZTogJ2F1ZGlvL3dhdicsIGJ1ZmZlcjogcmVhZEZpbGVTeW5jKE1JWCkgfSlcblx0XHRcdGF3YWl0IHVwbG9hZHMuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdDYW5jZWwgdGhlIHVwbG9hZCBvZiBjYW5jZWxsZWQud2F2JyB9KS5jbGljaygpXG5cdFx0XHRhd2FpdCBleHBlY3QodXBsb2Fkcy5nZXRCeVRleHQoJ2NhbmNlbGxlZC53YXYnKSkudG9IYXZlQ291bnQoMClcblx0XHRcdHJlbGVhc2UoKVxuXHRcdFx0Ly8gVGhlIG5leHQgdXBsb2FkIG9ubHkgc3RhcnRzIG9uY2UgdGhlIGNhbmNlbGxlZCBvbmUgaGFzIGxldCBnbywgc28gd2hlbiBpdCBpcyBkb25lLCBhIHN0cmF5IG9uZSB3b3VsZCBiZSB0b29cblx0XHRcdGF3YWl0IHVwbG9hZHMubG9jYXRvcignaW5wdXRbdHlwZT1maWxlXVttdWx0aXBsZV0nKS5zZXRJbnB1dEZpbGVzKHsgbmFtZTogJ2FmdGVyLWNhbmNlbC53YXYnLCBtaW1lVHlwZTogJ2F1ZGlvL3dhdicsIGJ1ZmZlcjogcmVhZEZpbGVTeW5jKE1JWCkgfSlcblx0XHRcdGF3YWl0IGV4cGVjdCh1cGxvYWRzLmdldEJ5VGV4dCgnT3BlbicsIHsgZXhhY3Q6IHRydWUgfSkpLnRvSGF2ZUNvdW50KDEpXG5cdFx0XHRjb25zdCBwcm9qZWN0ID0gYXdhaXQgKGF3YWl0IGFwaS5nZXQoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHMvJHtwcm9qZWN0SWR9P2Zvcm1hdD1qc29uYCkpLmpzb24oKVxuXHRcdFx0Y29uc3QgbmFtZXMgPSBwcm9qZWN0Lm9jcy5kYXRhLmFzc2V0cy5tYXAoKGFzc2V0KSA9PiBhc3NldC52ZXJzaW9uc1swXS5uYW1lKVxuXHRcdFx0ZXhwZWN0KG5hbWVzKS50b0NvbnRhaW4oJ2FmdGVyLWNhbmNlbC53YXYnKVxuXHRcdFx0ZXhwZWN0KG5hbWVzKS5ub3QudG9Db250YWluKCdjYW5jZWxsZWQud2F2Jylcblx0XHRcdGF3YWl0IGV4cGVjdCh1cGxvYWRzLmdldEJ5VGV4dCgnY2FuY2VsbGVkLndhdicpKS50b0hhdmVDb3VudCgwKVxuXHRcdH0gZmluYWxseSB7XG5cdFx0XHRhd2FpdCBhcGkuZGlzcG9zZSgpXG5cdFx0XHRhd2FpdCBjb250ZXh0LmNsb3NlKClcblx0XHR9XG5cdH0pXG5cblx0dGVzdCgnYSBNZW1iZXIgdXBsb2FkcyBhIFByb3h5IG9mIHRoZWlyIG93biBmcm9tIHRoZSBBc3NldCBjYXJkIGFuZCByZW1vdmVzIGl0IChBRFIgMDAyMCknLCBhc3luYyAoeyBwbGF5d3JpZ2h0IH0pID0+IHtcblx0XHRjb25zdCBhcGkgPSBhd2FpdCBwbGF5d3JpZ2h0LnJlcXVlc3QubmV3Q29udGV4dCh7IGJhc2VVUkw6IFVSTCwgaHR0cENyZWRlbnRpYWxzOiBhdXRoLCBleHRyYUhUVFBIZWFkZXJzOiBvY3NIZWFkZXJzIH0pXG5cdFx0Y29uc3QgZGF2ID0gYC9yZW1vdGUucGhwL2Rhdi9maWxlcy8ke1VTRVJ9L2RlbGl2ZXItZTJlLSR7cmFuZG9tQnl0ZXMoNCkudG9TdHJpbmcoJ2hleCcpfWBcblx0XHRleHBlY3QoKGF3YWl0IGFwaS5mZXRjaChkYXYsIHsgbWV0aG9kOiAnTUtDT0wnIH0pKS5zdGF0dXMoKSkudG9CZSgyMDEpXG5cdFx0Y29uc3QgY3JlYXRlZCA9IGF3YWl0IGFwaS5wb3N0KCcvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3Byb2plY3RzP2Zvcm1hdD1qc29uJywgeyBkYXRhOiB7IGZvbGRlcklkOiBhd2FpdCBmaWxlSWQoYXBpLCBkYXYpLCBhdXRvSW50YWtlOiB0cnVlIH0gfSlcblx0XHRjb25zdCBpZCA9IChhd2FpdCBjcmVhdGVkLmpzb24oKSkub2NzLmRhdGEuaWRcblx0XHRleHBlY3QoKGF3YWl0IGFwaS5mZXRjaChgJHtkYXZ9L21hc3Rlci5tb3ZgLCB7IG1ldGhvZDogJ1BVVCcsIGRhdGE6IHJlYWRGaWxlU3luYyhETlhIUikgfSkpLnN0YXR1cygpKS50b0JlKDIwMSlcblx0XHQvLyBUaGUgcHJvYmUsIHNvIHRoZSBjYXJkIGtub3dzIHRoZSBWZXJzaW9uIGdldHMgYSBQcm94eVxuXHRcdGV4ZWNGaWxlU3luYygnZG9ja2VyJywgWydjb21wb3NlJywgJ2V4ZWMnLCAnLVQnLCAnLXUnLCAnd3d3LWRhdGEnLCAnbmV4dGNsb3VkJywgJ3BocCcsICdvY2MnLCAnZGVsaXZlcjp3b3JrZXInLCAnLS1vbmNlJ10sIHsgc3RkaW86ICdpbmhlcml0JyB9KVxuXHRcdGNvbnN0IG5ld2VzdCA9IGFzeW5jICgpID0+IChhd2FpdCAoYXdhaXQgYXBpLmdldChgL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS9wcm9qZWN0cy8ke2lkfT9mb3JtYXQ9anNvbmApKS5qc29uKCkpLm9jcy5kYXRhLmFzc2V0c1swXS52ZXJzaW9uc1swXVxuXHRcdGNvbnN0IGJyb3dzZXIgPSBhd2FpdCBjaHJvbWl1bS5jb25uZWN0T3ZlckNEUChDRFApXG5cdFx0Y29uc3QgY29udGV4dCA9IGF3YWl0IGJyb3dzZXIubmV3Q29udGV4dCh7IGJhc2VVUkw6IEJST1dTRVJfVVJMIH0pXG5cdFx0Y29uc3QgcGFnZSA9IGF3YWl0IGNvbnRleHQubmV3UGFnZSgpXG5cdFx0dHJ5IHtcblx0XHRcdGF3YWl0IGxvZ2luKHBhZ2UpXG5cdFx0XHRhd2FpdCBwYWdlLmdvdG8oYC9hcHBzL2RlbGl2ZXIvcHJvamVjdHMvJHtpZH1gKVxuXHRcdFx0YXdhaXQgY2FyZChwYWdlLCAnbWFzdGVyJykuY2xpY2soeyBidXR0b246ICdyaWdodCcgfSlcblx0XHRcdGNvbnN0IGNob29zZXIgPSBwYWdlLndhaXRGb3JFdmVudCgnZmlsZWNob29zZXInKVxuXHRcdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ21lbnVpdGVtJywgeyBuYW1lOiAnVXBsb2FkIFByb3h54oCmJyB9KS5jbGljaygpXG5cdFx0XHRhd2FpdCAoYXdhaXQgY2hvb3Nlcikuc2V0RmlsZXMoeyBuYW1lOiAnbWFzdGVyLnByb3h5Lm1wNCcsIG1pbWVUeXBlOiAndmlkZW8vbXA0JywgYnVmZmVyOiByZWFkRmlsZVN5bmMoSEFORF9QUk9YWSkgfSlcblx0XHRcdGF3YWl0IGV4cGVjdC5wb2xsKGFzeW5jICgpID0+IChhd2FpdCBuZXdlc3QoKSkucHJveHlIYW5kZWRJbikudG9CZSh0cnVlKVxuXHRcdFx0Ly8gVGhlIGNhcmQgc2hvd3MgdGhlIHVwbG9hZCB1bnRpbCB0aGUgc2VydmVyJ3MgYW5zd2VyIGlzIGluLCBhbmQgaXRzIG1lbnUgZm9sbG93cyBvbmNlIHRoZSBQcm9qZWN0IGlzIHJlYWQgYWdhaW5cblx0XHRcdGF3YWl0IGV4cGVjdChhc3luYyAoKSA9PiB7XG5cdFx0XHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ0VzY2FwZScpXG5cdFx0XHRcdGF3YWl0IGNhcmQocGFnZSwgJ21hc3RlcicpLmNsaWNrKHsgYnV0dG9uOiAncmlnaHQnIH0pXG5cdFx0XHRcdGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5Um9sZSgnbWVudWl0ZW0nLCB7IG5hbWU6ICdSZW1vdmUgUHJveHknIH0pKS50b0JlVmlzaWJsZSh7IHRpbWVvdXQ6IDEwMDAgfSlcblx0XHRcdH0pLnRvUGFzcygpXG5cdFx0XHQvLyBUaGUgYnJvd3NlcidzIHBhc3MgZnJvbSB0aGUgaGFuZCBQcm94eSBpcyBvdmVyIGJ5IHRoZW46IHdoZXJlIGl0IGRlY29kZXMgSC4yNjQgaXQgbWFkZSB0aGUgc3RyaXAgZnJvbSBpdCxcblx0XHRcdC8vIHdoZXJlIGl0IGRvZXMgbm90IChDSSdzIENocm9taXVtKSB0aGF0IGlzIG5vIGVycm9yLCBhcyB0aGUgUHJveHkgaXMgaW4gKCMxNjgpXG5cdFx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcubm90ZWNhcmQtLWVycm9yJykpLnRvSGF2ZUNvdW50KDApXG5cdFx0XHRpZiAoYXdhaXQgcGFnZS5ldmFsdWF0ZShhc3luYyAoKSA9PiAoYXdhaXQgVmlkZW9EZWNvZGVyLmlzQ29uZmlnU3VwcG9ydGVkKHsgY29kZWM6ICdhdmMxLjQyMDAxZScgfSkpLnN1cHBvcnRlZCkpIHtcblx0XHRcdFx0Y29uc3Qgc2hvd24gPSBhd2FpdCAoYXdhaXQgYXBpLmdldChgL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS92ZXJzaW9ucy8keyhhd2FpdCBuZXdlc3QoKSkuaWR9P2Zvcm1hdD1qc29uYCkpLmpzb24oKVxuXHRcdFx0XHRleHBlY3Qoc2hvd24ub2NzLmRhdGEudmVyc2lvbnNbMF0uZGVyaXZlZC50aHVtYnMuc3RhdGUpLnRvQmUoJ3JlYWR5Jylcblx0XHRcdH1cblx0XHRcdC8vIEFub3RoZXIgb25lIG9mIHRoZWlyIG93biB3b3VsZCByZXBsYWNlIGl0XG5cdFx0XHRhd2FpdCBleHBlY3QocGFnZS5nZXRCeVJvbGUoJ21lbnVpdGVtJywgeyBuYW1lOiAnVXBsb2FkIFByb3h54oCmJyB9KSkudG9CZVZpc2libGUoKVxuXHRcdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ21lbnVpdGVtJywgeyBuYW1lOiAnUmVtb3ZlIFByb3h5JyB9KS5jbGljaygpXG5cdFx0XHRhd2FpdCBleHBlY3QucG9sbChhc3luYyAoKSA9PiAoYXdhaXQgbmV3ZXN0KCkpLnByb3h5SGFuZGVkSW4pLnRvQmUoZmFsc2UpXG5cdFx0XHRhd2FpdCBjYXJkKHBhZ2UsICdtYXN0ZXInKS5jbGljayh7IGJ1dHRvbjogJ3JpZ2h0JyB9KVxuXHRcdFx0YXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKCdtZW51aXRlbScsIHsgbmFtZTogJ1VwbG9hZCBQcm94eeKApicgfSkpLnRvQmVWaXNpYmxlKClcblx0XHRcdGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5Um9sZSgnbWVudWl0ZW0nLCB7IG5hbWU6ICdSZW1vdmUgUHJveHknIH0pKS50b0hhdmVDb3VudCgwKVxuXHRcdFx0Ly8gT25seSB0aGUgbWFzdGVyIGJlY2FtZSBhbiBBc3NldDogdGhlIHVwbG9hZCB3YXMgaGlkZGVuIGFuZCBpcyBnb25lXG5cdFx0XHRleHBlY3QoKGF3YWl0IChhd2FpdCBhcGkuZ2V0KGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3Byb2plY3RzLyR7aWR9P2Zvcm1hdD1qc29uYCkpLmpzb24oKSkub2NzLmRhdGEuYXNzZXRzKS50b0hhdmVMZW5ndGgoMSlcblx0XHR9IGZpbmFsbHkge1xuXHRcdFx0YXdhaXQgY29udGV4dC5jbG9zZSgpXG5cdFx0XHRhd2FpdCBhcGkuZGVsZXRlKGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3Byb2plY3RzLyR7aWR9P2Zvcm1hdD1qc29uYClcblx0XHRcdGF3YWl0IGFwaS5mZXRjaChkYXYsIHsgbWV0aG9kOiAnREVMRVRFJyB9KVxuXHRcdFx0YXdhaXQgYXBpLmRpc3Bvc2UoKVxuXHRcdH1cblx0fSlcblx0dGVzdCgnYSB2aWRlbyB0aGF0IG5lZWRzIG5vIFByb3h5LCB1cGxvYWRlZCBpbiB0aGUgRmlsZXMgYXBwIHdoZXJlIEF1dG8gSW50YWtlIHRha2VzIGl0LCBnZXRzIGl0cyBzdHJpcCBmcm9tIHRoaXMgYnJvd3NlciAoIzE2OCknLCBhc3luYyAoeyBwbGF5d3JpZ2h0IH0pID0+IHtcblx0XHRjb25zdCBhcGkgPSBhd2FpdCBwbGF5d3JpZ2h0LnJlcXVlc3QubmV3Q29udGV4dCh7IGJhc2VVUkw6IFVSTCwgaHR0cENyZWRlbnRpYWxzOiBhdXRoLCBleHRyYUhUVFBIZWFkZXJzOiBvY3NIZWFkZXJzIH0pXG5cdFx0Y29uc3QgZm9sZGVyID0gYGRlbGl2ZXItZTJlLSR7cmFuZG9tQnl0ZXMoNCkudG9TdHJpbmcoJ2hleCcpfWBcblx0XHRjb25zdCBkYXYgPSBgL3JlbW90ZS5waHAvZGF2L2ZpbGVzLyR7VVNFUn0vJHtmb2xkZXJ9YFxuXHRcdGV4cGVjdCgoYXdhaXQgYXBpLmZldGNoKGRhdiwgeyBtZXRob2Q6ICdNS0NPTCcgfSkpLnN0YXR1cygpKS50b0JlKDIwMSlcblx0XHRjb25zdCBjcmVhdGVkID0gYXdhaXQgYXBpLnBvc3QoJy9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHM/Zm9ybWF0PWpzb24nLCB7IGRhdGE6IHsgZm9sZGVySWQ6IGF3YWl0IGZpbGVJZChhcGksIGRhdiksIGF1dG9JbnRha2U6IHRydWUgfSB9KVxuXHRcdGNvbnN0IGlkID0gKGF3YWl0IGNyZWF0ZWQuanNvbigpKS5vY3MuZGF0YS5pZFxuXHRcdGNvbnN0IGJyb3dzZXIgPSBhd2FpdCBjaHJvbWl1bS5jb25uZWN0T3ZlckNEUChDRFApXG5cdFx0Y29uc3QgY29udGV4dCA9IGF3YWl0IGJyb3dzZXIubmV3Q29udGV4dCh7IGJhc2VVUkw6IEJST1dTRVJfVVJMIH0pXG5cdFx0Y29uc3QgcGFnZSA9IGF3YWl0IGNvbnRleHQubmV3UGFnZSgpXG5cdFx0Y29uc3QgZGVyaXZlZCA9IGFzeW5jICgpID0+IHtcblx0XHRcdGNvbnN0IHZlcnNpb25JZCA9IChhd2FpdCAoYXdhaXQgYXBpLmdldChgL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS9wcm9qZWN0cy8ke2lkfT9mb3JtYXQ9anNvbmApKS5qc29uKCkpLm9jcy5kYXRhLmFzc2V0c1swXT8udmVyc2lvbnNbMF0uaWRcblx0XHRcdHJldHVybiB2ZXJzaW9uSWQgJiYgKGF3YWl0IChhd2FpdCBhcGkuZ2V0KGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3ZlcnNpb25zLyR7dmVyc2lvbklkfT9mb3JtYXQ9anNvbmApKS5qc29uKCkpLm9jcy5kYXRhLnZlcnNpb25zWzBdLmRlcml2ZWRcblx0XHR9XG5cdFx0dHJ5IHtcblx0XHRcdGF3YWl0IGxvZ2luKHBhZ2UpXG5cdFx0XHRhd2FpdCBwYWdlLmdvdG8oYC9hcHBzL2ZpbGVzL2ZpbGVzP2Rpcj0vJHtmb2xkZXJ9YClcblx0XHRcdGF3YWl0IHBhZ2UubG9jYXRvcignaW5wdXRbdHlwZT1maWxlXScpLmZpcnN0KCkuc2V0SW5wdXRGaWxlcyh7IG5hbWU6ICdjbGlwLndlYm0nLCBtaW1lVHlwZTogJ3ZpZGVvL3dlYm0nLCBidWZmZXI6IHJlYWRGaWxlU3luYyhDTElQKSB9KVxuXHRcdFx0Ly8gVlA5IHBsYXlzIGFzIGl0IGlzLCBzbyBubyBQcm94eTsgdGhlIHBhc3MgZGVjb2RlcyBpdCBhbGwgdGhlIHNhbWUsIGFsc28gd2l0aG91dCBhbiBILjI2NCBlbmNvZGVyIGZvciB0aGUgU2NydWIgUHJveHlcblx0XHRcdGF3YWl0IGV4cGVjdC5wb2xsKGFzeW5jICgpID0+IChhd2FpdCBkZXJpdmVkKCkpPy50aHVtYnMuc3RhdGUsIHsgdGltZW91dDogNjBfMDAwIH0pLnRvQmUoJ3JlYWR5Jylcblx0XHRcdGV4cGVjdCgoYXdhaXQgZGVyaXZlZCgpKS5wcm94eS5zdGF0ZSkudG9CZSgnbm9uZScpXG5cdFx0fSBmaW5hbGx5IHtcblx0XHRcdGF3YWl0IGNvbnRleHQuY2xvc2UoKVxuXHRcdFx0YXdhaXQgYXBpLmRlbGV0ZShgL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS9wcm9qZWN0cy8ke2lkfT9mb3JtYXQ9anNvbmApXG5cdFx0XHRhd2FpdCBhcGkuZmV0Y2goZGF2LCB7IG1ldGhvZDogJ0RFTEVURScgfSlcblx0XHRcdGF3YWl0IGFwaS5kaXNwb3NlKClcblx0XHR9XG5cdH0pXG5cblx0dGVzdCgndGhlIEFzc2V0IGNhcmQgb2ZmZXJzIHRvIG1ha2UgbWlzc2luZyBkZXJpdmVkIG1lZGlhIGluIHRoaXMgYnJvd3NlciBvbmx5IHdoaWxlIHNvbWV0aGluZyBpcyBtaXNzaW5nLCBhbmQgbmV2ZXIgd2l0aCBmZm1wZWcgKCMxNjgpJywgYXN5bmMgKHsgcGxheXdyaWdodCB9KSA9PiB7XG5cdFx0Y29uc3QgYXBpID0gYXdhaXQgcGxheXdyaWdodC5yZXF1ZXN0Lm5ld0NvbnRleHQoeyBiYXNlVVJMOiBVUkwsIGh0dHBDcmVkZW50aWFsczogYXV0aCwgZXh0cmFIVFRQSGVhZGVyczogb2NzSGVhZGVycyB9KVxuXHRcdGNvbnN0IGRhdiA9IGAvcmVtb3RlLnBocC9kYXYvZmlsZXMvJHtVU0VSfS9kZWxpdmVyLWUyZS0ke3JhbmRvbUJ5dGVzKDQpLnRvU3RyaW5nKCdoZXgnKX1gXG5cdFx0ZXhwZWN0KChhd2FpdCBhcGkuZmV0Y2goZGF2LCB7IG1ldGhvZDogJ01LQ09MJyB9KSkuc3RhdHVzKCkpLnRvQmUoMjAxKVxuXHRcdGNvbnN0IGNyZWF0ZWQgPSBhd2FpdCBhcGkucG9zdCgnL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS9wcm9qZWN0cz9mb3JtYXQ9anNvbicsIHsgZGF0YTogeyBmb2xkZXJJZDogYXdhaXQgZmlsZUlkKGFwaSwgZGF2KSwgYXV0b0ludGFrZTogdHJ1ZSB9IH0pXG5cdFx0Y29uc3QgaWQgPSAoYXdhaXQgY3JlYXRlZC5qc29uKCkpLm9jcy5kYXRhLmlkXG5cdFx0Ly8gRnJvbSBhIHN5bmMgY2xpZW50OiBubyBicm93c2VyIG1hZGUgYW55dGhpbmcgb2YgaXRcblx0XHRleHBlY3QoKGF3YWl0IGFwaS5mZXRjaChgJHtkYXZ9L2NsaXAud2VibWAsIHsgbWV0aG9kOiAnUFVUJywgZGF0YTogcmVhZEZpbGVTeW5jKENMSVApIH0pKS5zdGF0dXMoKSkudG9CZSgyMDEpXG5cdFx0ZXhlY0ZpbGVTeW5jKCdkb2NrZXInLCBbJ2NvbXBvc2UnLCAnZXhlYycsICctVCcsICctdScsICd3d3ctZGF0YScsICduZXh0Y2xvdWQnLCAncGhwJywgJ29jYycsICdkZWxpdmVyOndvcmtlcicsICctLW9uY2UnXSwgeyBzdGRpbzogJ2luaGVyaXQnIH0pXG5cdFx0Y29uc3QgbmV3ZXN0ID0gYXN5bmMgKCkgPT4gKGF3YWl0IChhd2FpdCBhcGkuZ2V0KGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3Byb2plY3RzLyR7aWR9P2Zvcm1hdD1qc29uYCkpLmpzb24oKSkub2NzLmRhdGEuYXNzZXRzWzBdLnZlcnNpb25zWzBdXG5cdFx0Y29uc3QgeyBpZDogdmVyc2lvbklkIH0gPSBhd2FpdCBuZXdlc3QoKVxuXHRcdGNvbnN0IGJyb3dzZXIgPSBhd2FpdCBjaHJvbWl1bS5jb25uZWN0T3ZlckNEUChDRFApXG5cdFx0Y29uc3QgY29udGV4dCA9IGF3YWl0IGJyb3dzZXIubmV3Q29udGV4dCh7IGJhc2VVUkw6IEJST1dTRVJfVVJMIH0pXG5cdFx0Y29uc3QgcGFnZSA9IGF3YWl0IGNvbnRleHQubmV3UGFnZSgpXG5cdFx0Y29uc3QgYWN0aW9uID0gcGFnZS5nZXRCeVJvbGUoJ21lbnVpdGVtJywgeyBuYW1lOiAnTWFrZSBtaXNzaW5nIGRlcml2ZWQgbWVkaWEgaW4gdGhpcyBicm93c2VyJyB9KVxuXHRcdGNvbnN0IG1lbnUgPSBhc3luYyAoKSA9PiB7XG5cdFx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdFc2NhcGUnKVxuXHRcdFx0YXdhaXQgY2FyZChwYWdlLCAnY2xpcCcpLmNsaWNrKHsgYnV0dG9uOiAncmlnaHQnIH0pXG5cdFx0fVxuXHRcdHRyeSB7XG5cdFx0XHRhd2FpdCBsb2dpbihwYWdlKVxuXHRcdFx0YXdhaXQgcGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL3Byb2plY3RzLyR7aWR9YClcblx0XHRcdC8vIE9mZmVyZWQgb25jZSB0aGlzIGJyb3dzZXIgaGFzIHJlYWQgdGhlIGhlYWRlcnM6IGl0IGRlY29kZXMgVlA5LCBldmVuIHdoZXJlIGl0IGVuY29kZXMgbm8gSC4yNjQgZm9yIGEgU2NydWIgUHJveHlcblx0XHRcdGF3YWl0IGV4cGVjdChhc3luYyAoKSA9PiB7XG5cdFx0XHRcdGF3YWl0IG1lbnUoKVxuXHRcdFx0XHRhd2FpdCBleHBlY3QoYWN0aW9uKS50b0JlVmlzaWJsZSh7IHRpbWVvdXQ6IDEwMDAgfSlcblx0XHRcdH0pLnRvUGFzcygpXG5cdFx0XHRhd2FpdCBhY3Rpb24uY2xpY2soKVxuXHRcdFx0YXdhaXQgZXhwZWN0LnBvbGwoYXN5bmMgKCkgPT4gKGF3YWl0IG5ld2VzdCgpKS5kZXJpdmVkRnJvbUJyb3dzZXIsIHsgdGltZW91dDogMzBfMDAwIH0pLm5vdC50b0NvbnRhaW4oJ3RodW1icycpXG5cdFx0XHRjb25zdCBzaG93biA9IGF3YWl0IChhd2FpdCBhcGkuZ2V0KGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3ZlcnNpb25zLyR7dmVyc2lvbklkfT9mb3JtYXQ9anNvbmApKS5qc29uKClcblx0XHRcdGV4cGVjdChzaG93bi5vY3MuZGF0YS52ZXJzaW9uc1swXS5kZXJpdmVkLnRodW1icy5zdGF0ZSkudG9CZSgncmVhZHknKVxuXG5cdFx0XHQvLyBBIFNjcnViIFByb3h5IGZyb20gZWxzZXdoZXJlLCB3aGVyZSB0aGlzIGJyb3dzZXIgY291bGQgbm90IG1ha2Ugb25lOiBub3RoaW5nIGlzIG1pc3NpbmcgYW55IG1vcmVcblx0XHRcdGNvbnN0IHVwbG9hZCA9IGAke2Rhdn0vLnNjcnViLXVwbG9hZGBcblx0XHRcdGV4cGVjdCgoYXdhaXQgYXBpLmZldGNoKHVwbG9hZCwgeyBtZXRob2Q6ICdQVVQnLCBkYXRhOiByZWFkRmlsZVN5bmMoQ0xJUF9TQ1JVQikgfSkpLnN0YXR1cygpKS50b0JlKDIwMSlcblx0XHRcdGNvbnN0IGdpdmVuID0gYXdhaXQgYXBpLnBvc3QoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvdmVyc2lvbnMvJHt2ZXJzaW9uSWR9L3NjcnViP2Zvcm1hdD1qc29uYCwgeyBkYXRhOiB7IGZpbGVJZDogYXdhaXQgZmlsZUlkKGFwaSwgdXBsb2FkKSB9IH0pXG5cdFx0XHRleHBlY3QoWzIwMCwgNDA5XSkudG9Db250YWluKGdpdmVuLnN0YXR1cygpKVxuXHRcdFx0YXdhaXQgZXhwZWN0LnBvbGwoYXN5bmMgKCkgPT4gKGF3YWl0IG5ld2VzdCgpKS5kZXJpdmVkRnJvbUJyb3dzZXIpLnRvRXF1YWwoW10pXG5cdFx0XHRhd2FpdCBwYWdlLnJlbG9hZCgpXG5cdFx0XHRhd2FpdCBtZW51KClcblx0XHRcdGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5Um9sZSgnbWVudWl0ZW0nLCB7IG5hbWU6ICdPcGVuJyB9KSkudG9CZVZpc2libGUoKVxuXHRcdFx0YXdhaXQgZXhwZWN0KGFjdGlvbikudG9IYXZlQ291bnQoMClcblxuXHRcdFx0Ly8gV2l0aCBmZm1wZWcgdGhlIHNlcnZlciBtYWtlcyBpdCBhbGxcblx0XHRcdGV4cGVjdCgoYXdhaXQgYXBpLnBvc3QoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvdmVyc2lvbnMvJHt2ZXJzaW9uSWR9L3JlZ2VuZXJhdGU/Zm9ybWF0PWpzb25gKSkub2soKSkudG9CZSh0cnVlKVxuXHRcdFx0ZXhwZWN0KChhd2FpdCBhZG1pbi5wdXQoJy9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvYWRtaW4vc2V0dGluZ3M/Zm9ybWF0PWpzb24nLCB7IGRhdGE6IHsgZmZtcGVnUGF0aDogJycsIGZmcHJvYmVQYXRoOiAnJyB9IH0pKS5vaygpKS50b0JlKHRydWUpXG5cdFx0XHRhd2FpdCBwYWdlLnJlbG9hZCgpXG5cdFx0XHRhd2FpdCBtZW51KClcblx0XHRcdGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5Um9sZSgnbWVudWl0ZW0nLCB7IG5hbWU6ICdPcGVuJyB9KSkudG9CZVZpc2libGUoKVxuXHRcdFx0YXdhaXQgZXhwZWN0KGFjdGlvbikudG9IYXZlQ291bnQoMClcblx0XHR9IGZpbmFsbHkge1xuXHRcdFx0YXdhaXQgYWRtaW4ucHV0KCcvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL2FkbWluL3NldHRpbmdzP2Zvcm1hdD1qc29uJywgeyBkYXRhOiB7IGZmbXBlZ1BhdGg6ICcvbm9uZXhpc3RlbnQvZmZtcGVnJywgZmZwcm9iZVBhdGg6ICcvbm9uZXhpc3RlbnQvZmZwcm9iZScgfSB9KVxuXHRcdFx0YXdhaXQgY29udGV4dC5jbG9zZSgpXG5cdFx0XHRhd2FpdCBhcGkuZGVsZXRlKGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3Byb2plY3RzLyR7aWR9P2Zvcm1hdD1qc29uYClcblx0XHRcdGF3YWl0IGFwaS5mZXRjaChkYXYsIHsgbWV0aG9kOiAnREVMRVRFJyB9KVxuXHRcdFx0YXdhaXQgYXBpLmRpc3Bvc2UoKVxuXHRcdH1cblx0fSlcbn0pXG5cbi8qKlxuICogQ3JlYXRlcyB0aGUgdGVzdCB1c2VyLCBvciBzZXRzIGEgZnJlc2ggcGFzc3dvcmQgb24gaXQsIGFuZCBrZWVwcyBpdCBpbiBFbmdsaXNoXG4gKlxuICogQHBhcmFtIHtpbXBvcnQoJ0BwbGF5d3JpZ2h0L3Rlc3QnKS5QbGF5d3JpZ2h0V29ya2VyQXJnc1sncGxheXdyaWdodCddfSBwbGF5d3JpZ2h0IC0gdG8gdGFsayB0byB0aGUgQVBJIGFzIGFkbWluXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHRlc3RVc2VyKHBsYXl3cmlnaHQpIHtcblx0Y29uc3QgYWRtaW4gPSBhd2FpdCBwbGF5d3JpZ2h0LnJlcXVlc3QubmV3Q29udGV4dCh7XG5cdFx0YmFzZVVSTDogVVJMLFxuXHRcdGh0dHBDcmVkZW50aWFsczogeyB1c2VybmFtZTogQURNSU4sIHBhc3N3b3JkOiBBRE1JTl9QQVNTV09SRCwgc2VuZDogJ2Fsd2F5cycgfSxcblx0XHRleHRyYUhUVFBIZWFkZXJzOiBvY3NIZWFkZXJzLFxuXHR9KVxuXHRjb25zdCB1c2VycyA9ICcvb2NzL3YyLnBocC9jbG91ZC91c2Vycydcblx0Y29uc3QgY3JlYXRlZCA9IGF3YWl0IGFkbWluLnBvc3QoYCR7dXNlcnN9P2Zvcm1hdD1qc29uYCwgeyBmb3JtOiB7IHVzZXJpZDogVVNFUiwgcGFzc3dvcmQ6IFBBU1NXT1JEIH0gfSlcblx0aWYgKCFjcmVhdGVkLm9rKCkpIHtcblx0XHRleHBlY3QoKGF3YWl0IGFkbWluLnB1dChgJHt1c2Vyc30vJHtVU0VSfT9mb3JtYXQ9anNvbmAsIHsgZm9ybTogeyBrZXk6ICdwYXNzd29yZCcsIHZhbHVlOiBQQVNTV09SRCB9IH0pKS5vaygpKS50b0JlKHRydWUpXG5cdH1cblx0ZXhwZWN0KChhd2FpdCBhZG1pbi5wdXQoYCR7dXNlcnN9LyR7VVNFUn0/Zm9ybWF0PWpzb25gLCB7IGZvcm06IHsga2V5OiAnbGFuZ3VhZ2UnLCB2YWx1ZTogJ2VuJyB9IH0pKS5vaygpKS50b0JlKHRydWUpXG5cdC8vIFRoZSBtYXRlIG5ldmVyIGxvZ3MgaW4gdG8gdGhlIGJyb3dzZXIsIGJ1dCBtYWtlcyBhIGxpbmsgdGhyb3VnaCB0aGUgQVBJXG5cdGNvbnN0IG1hdGUgPSBhd2FpdCBhZG1pbi5wb3N0KGAke3VzZXJzfT9mb3JtYXQ9anNvbmAsIHsgZm9ybTogeyB1c2VyaWQ6IE1BVEUsIHBhc3N3b3JkOiBNQVRFX1BBU1NXT1JELCBkaXNwbGF5TmFtZTogJ01hcmEgTWF0ZScgfSB9KVxuXHRpZiAoIW1hdGUub2soKSkge1xuXHRcdGV4cGVjdCgoYXdhaXQgYWRtaW4ucHV0KGAke3VzZXJzfS8ke01BVEV9P2Zvcm1hdD1qc29uYCwgeyBmb3JtOiB7IGtleTogJ3Bhc3N3b3JkJywgdmFsdWU6IE1BVEVfUEFTU1dPUkQgfSB9KSkub2soKSkudG9CZSh0cnVlKVxuXHR9XG5cdGF3YWl0IGFkbWluLmRpc3Bvc2UoKVxufVxuXG4vKipcbiAqIEBwYXJhbSB7aW1wb3J0KCdAcGxheXdyaWdodC90ZXN0JykuUGFnZX0gcGFnZSAtIHRoZSBQcm9qZWN0IHZpZXdcbiAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gYW4gQXNzZXQncyBuYW1lOyBcIjggc2Vjb25kcyBhZ29cIiBiZWxvdyBpdCB3b3VsZCBtYXRjaCBcInNlY29uZFwiIGJ5IHRleHQgYWxvbmVcbiAqIEByZXR1cm4ge2ltcG9ydCgnQHBsYXl3cmlnaHQvdGVzdCcpLkxvY2F0b3J9IGl0cyBjYXJkXG4gKi9cbmZ1bmN0aW9uIGNhcmQocGFnZSwgbmFtZSkge1xuXHRyZXR1cm4gcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jYXJkJykuZmlsdGVyKHsgaGFzOiBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNhcmRfX25hbWUnLCB7IGhhc1RleHQ6IG5ldyBSZWdFeHAoYF5cXFxccyoke25hbWV9XFxcXHMqJGApIH0pIH0pXG59XG5cbi8qKlxuICogQHBhcmFtIHtpbXBvcnQoJ0BwbGF5d3JpZ2h0L3Rlc3QnKS5BUElSZXF1ZXN0Q29udGV4dH0gYXBpIC0gcmVxdWVzdCBjb250ZXh0XG4gKiBAcGFyYW0ge3N0cmluZ30gZGF2IC0gV2ViREFWIHBhdGggb2YgdGhlIGZvbGRlclxuICogQHJldHVybiB7UHJvbWlzZTxudW1iZXI+fSB0aGUgTmV4dGNsb3VkIGZpbGUgaWRcbiAqL1xuYXN5bmMgZnVuY3Rpb24gZmlsZUlkKGFwaSwgZGF2KSB7XG5cdGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgYXBpLmZldGNoKGRhdiwge1xuXHRcdG1ldGhvZDogJ1BST1BGSU5EJyxcblx0XHRoZWFkZXJzOiB7IERlcHRoOiAnMCcsICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24veG1sJyB9LFxuXHRcdGRhdGE6ICc8P3htbCB2ZXJzaW9uPVwiMS4wXCI/PjxkOnByb3BmaW5kIHhtbG5zOmQ9XCJEQVY6XCIgeG1sbnM6b2M9XCJodHRwOi8vb3duY2xvdWQub3JnL25zXCI+PGQ6cHJvcD48b2M6ZmlsZWlkLz48L2Q6cHJvcD48L2Q6cHJvcGZpbmQ+Jyxcblx0fSlcblx0cmV0dXJuIE51bWJlcigvPG9jOmZpbGVpZD4oXFxkKyk8XFwvb2M6ZmlsZWlkPi8uZXhlYyhhd2FpdCByZXNwb25zZS50ZXh0KCkpWzFdKVxufVxuXG4vKipcbiAqIEBwYXJhbSB7aW1wb3J0KCdAcGxheXdyaWdodC90ZXN0JykuUGFnZX0gcGFnZSAtIHRoZSBwYWdlIHRvIGxvZyBpblxuICovXG5hc3luYyBmdW5jdGlvbiBsb2dpbihwYWdlKSB7XG5cdGF3YWl0IHBhZ2UuZ290bygnL2luZGV4LnBocC9sb2dpbicpXG5cdGF3YWl0IHBhZ2UubG9jYXRvcignI3VzZXInKS5maWxsKFVTRVIpXG5cdGF3YWl0IHBhZ2UubG9jYXRvcignI3Bhc3N3b3JkJykuZmlsbChQQVNTV09SRClcblx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ0xvZyBpbicsIGV4YWN0OiB0cnVlIH0pLmNsaWNrKClcblx0YXdhaXQgcGFnZS53YWl0Rm9yVVJMKC9hcHBzfGRhc2hib2FyZC8pXG59XG5cbi8qKlxuICogQSBjbGljayBpbiB0aGUgc3RyaXAgYSBxdWFydGVyIG9mIHRoZSBzdGFnZSBvbiBzZWVrcyB0aGVyZSwgYW5kIEMgY29tbWVudHMgd2hlcmUgaXQgd2VudFxuICogb25jZSB0aGUgd2F2ZSBoYXMgZ2xpZGVkOiBhIGNsaWNrIGxhbmRzIG9uIHdoYXQgaXMgZHJhd25cbiAqXG4gKiBAcGFyYW0ge2ltcG9ydCgnQHBsYXl3cmlnaHQvdGVzdCcpLlBhZ2V9IHBhZ2UgLSB0aGUgUmV2aWV3IHZpZXdcbiAqIEBwYXJhbSB7aW1wb3J0KCdAcGxheXdyaWdodC90ZXN0JykuTG9jYXRvcn0gY2FudmFzIC0gdGhlIFdhdmVmb3JtJ3MgY2FudmFzXG4gKiBAcGFyYW0ge3twb3NpdGlvbjoge3g6IG51bWJlciwgeTogbnVtYmVyfX19IHF1YXJ0ZXJPbiAtIHdoZXJlIHRvIGNsaWNrXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGNvbW1lbnRPblF1YXJ0ZXIocGFnZSwgY2FudmFzLCBxdWFydGVyT24pIHtcblx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gY2FudmFzLmV2YWx1YXRlKChlbGVtZW50KSA9PiBNYXRoLmFicyhlbGVtZW50LmRyYXduQXQgLSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKCd2aWRlby5kZWxpdmVyLXBsYXllcl9fdmlkZW8nKS5jdXJyZW50VGltZSkpKS50b0JlTGVzc1RoYW4oMC4wMSlcblx0YXdhaXQgY2FudmFzLmNsaWNrKHF1YXJ0ZXJPbilcblx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnYycpXG59XG4iXSwibWFwcGluZ3MiOiJBQUFBLFNBQVNBLFFBQVEsRUFBRUMsTUFBTSxFQUFFQyxJQUFJLFFBQVEsa0JBQWtCO0FBQ3pELFNBQVNDLFlBQVksUUFBUSxvQkFBb0I7QUFDakQsU0FBU0MsV0FBVyxRQUFRLGFBQWE7QUFDekMsU0FBU0MsWUFBWSxRQUFRLFNBQVM7QUFD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QUFNekgsR0FBRyxDQUFDTyxLQUFLLENBQUNELEdBQUcsRUFBRTtJQUNyQ0UsTUFBTSxFQUFFLFVBQVU7SUFDbEJtSCxPQUFPLEVBQUU7TUFBRW1ZLEtBQUssRUFBRSxHQUFHO01BQUUsY0FBYyxFQUFFO0lBQWtCLENBQUM7SUFDMURuZixJQUFJLEVBQUU7RUFDUCxDQUFDLENBQUM7RUFDRixPQUFPNlMsTUFBTSxDQUFDLCtCQUErQixDQUFDdU0sSUFBSSxDQUFDLE1BQU10WSxRQUFRLENBQUNLLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUM5RTs7QUFFQTtBQUNBO0FBQ0E7QUFDQSxlQUFlNUYsS0FBS0EsQ0FBQ3pDLElBQUksRUFBRTtFQUMxQixNQUFNQSxJQUFJLENBQUM2QyxJQUFJLENBQUMsa0JBQWtCLENBQUM7RUFDbkMsTUFBTTdDLElBQUksQ0FBQytDLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQ2EsSUFBSSxDQUFDdEYsSUFBSSxDQUFDO0VBQ3RDLE1BQU0wQixJQUFJLENBQUMrQyxPQUFPLENBQUMsV0FBVyxDQUFDLENBQUNhLElBQUksQ0FBQ3JGLFFBQVEsQ0FBQztFQUM5QyxNQUFNeUIsSUFBSSxDQUFDeUQsU0FBUyxDQUFDLFFBQVEsRUFBRTtJQUFFQyxJQUFJLEVBQUUsUUFBUTtJQUFFQyxLQUFLLEVBQUU7RUFBSyxDQUFDLENBQUMsQ0FBQ1QsS0FBSyxDQUFDLENBQUM7RUFDdkUsTUFBTWxELElBQUksQ0FBQ3VnQixVQUFVLENBQUMsZ0JBQWdCLENBQUM7QUFDeEM7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLGVBQWVsSSxnQkFBZ0JBLENBQUNyWSxJQUFJLEVBQUU2UyxNQUFNLEVBQUUrQyxTQUFTLEVBQUU7RUFDeEQsTUFBTTlZLE1BQU0sQ0FBQ29QLElBQUksQ0FBQyxNQUFNMkcsTUFBTSxDQUFDaE8sUUFBUSxDQUFFeUssT0FBTyxJQUFLSyxJQUFJLENBQUMwRSxHQUFHLENBQUMvRSxPQUFPLENBQUNnRyxPQUFPLEdBQUcvUCxRQUFRLENBQUNDLGFBQWEsQ0FBQyw2QkFBNkIsQ0FBQyxDQUFDd0UsV0FBVyxDQUFDLENBQUMsQ0FBQyxDQUFDMEYsWUFBWSxDQUFDLElBQUksQ0FBQztFQUN2SyxNQUFNbUQsTUFBTSxDQUFDM1AsS0FBSyxDQUFDMFMsU0FBUyxDQUFDO0VBQzdCLE1BQU01VixJQUFJLENBQUNtRSxRQUFRLENBQUNDLEtBQUssQ0FBQyxHQUFHLENBQUM7QUFDL0IiLCJpZ25vcmVMaXN0IjpbXX0=