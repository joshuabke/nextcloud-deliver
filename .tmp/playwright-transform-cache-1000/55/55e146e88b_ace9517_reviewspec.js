// 03ce8a5589d9779280fd40ab0f0550513192cefc
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
    for (const [x, y, frame] of [[-18, 16, 85 - 18 / bar.width * 100], [0, 2, 85], [0, bar.height - 2, 85]]) {
      await tapAt(x, bar.y + y);
      await expect.poll(() => frameOf(touchVideo)).toBeGreaterThan(frame - 2);
      expect(await frameOf(touchVideo)).toBeLessThan(frame + 2);
      await expect(card).toHaveCount(0);
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjaHJvbWl1bSIsImV4cGVjdCIsInRlc3QiLCJleGVjRmlsZVN5bmMiLCJyYW5kb21CeXRlcyIsInJlYWRGaWxlU3luYyIsIkNMSVAiLCJDTElQX1NDUlVCIiwiQ1VUX0EiLCJDVVRfQiIsIkROWEhSIiwiSEFORF9QUk9YWSIsIkxPTkciLCJMT05HX01JWCIsIk1JWCIsIk1JWF9BIiwiTUlYX0IiLCJVUkwiLCJwcm9jZXNzIiwiZW52IiwiREVMSVZFUl9URVNUX1VSTCIsIkFETUlOIiwiREVMSVZFUl9URVNUX1VTRVIiLCJBRE1JTl9QQVNTV09SRCIsIkRFTElWRVJfVEVTVF9QQVNTV09SRCIsIlVTRVIiLCJQQVNTV09SRCIsInRvU3RyaW5nIiwiTUFURSIsIk1BVEVfUEFTU1dPUkQiLCJDRFAiLCJERUxJVkVSX0NEUCIsIkJST1dTRVJfVVJMIiwiREVMSVZFUl9CUk9XU0VSX1VSTCIsImF1dGgiLCJ1c2VybmFtZSIsInBhc3N3b3JkIiwic2VuZCIsIlBIT05FIiwidmlld3BvcnQiLCJ3aWR0aCIsImhlaWdodCIsImRldmljZVNjYWxlRmFjdG9yIiwiaXNNb2JpbGUiLCJoYXNUb3VjaCIsInVzZXJBZ2VudCIsIm9jc0hlYWRlcnMiLCJBY2NlcHQiLCJkZXNjcmliZSIsImJyb3dzZXIiLCJjb250ZXh0IiwicGFnZSIsImZvbGRlciIsInZlcnNpb25JZCIsInByb2plY3RJZCIsImJlZm9yZUFsbCIsInBsYXl3cmlnaHQiLCJ0ZXN0VXNlciIsImFwaSIsInJlcXVlc3QiLCJuZXdDb250ZXh0IiwiYmFzZVVSTCIsImh0dHBDcmVkZW50aWFscyIsImV4dHJhSFRUUEhlYWRlcnMiLCJkYXYiLCJmZXRjaCIsIm1ldGhvZCIsInN0YXR1cyIsInRvQmUiLCJkYXRhIiwic2hhcmVkIiwicG9zdCIsImZvcm0iLCJwYXRoIiwic2hhcmVUeXBlIiwic2hhcmVXaXRoIiwicGVybWlzc2lvbnMiLCJvayIsImNyZWF0ZWQiLCJmb2xkZXJJZCIsImZpbGVJZCIsImF1dG9JbnRha2UiLCJqc29uIiwib2NzIiwiaWQiLCJwcm9qZWN0IiwiZ2V0IiwiYXNzZXRzIiwidmVyc2lvbnMiLCJkaXNwb3NlIiwiY29ubmVjdE92ZXJDRFAiLCJuZXdQYWdlIiwibG9naW4iLCJhZnRlckFsbCIsImNsb3NlIiwiZGVsZXRlIiwiZ290byIsInRpbGUiLCJsb2NhdG9yIiwiaGFzVGV4dCIsInRvQ29udGFpblRleHQiLCJjbGljayIsInRvSGF2ZVVSTCIsIlJlZ0V4cCIsImxpbmsiLCJmaXJzdCIsInRvSGF2ZUNsYXNzIiwiZGJsY2xpY2siLCJnZXRCeVJvbGUiLCJuYW1lIiwiZXhhY3QiLCJmaWxsIiwidG9IYXZlQ291bnQiLCJidXR0b24iLCJub3QiLCJyZWxvYWQiLCJ0b0hhdmVBdHRyaWJ1dGUiLCJ0b0JlVmlzaWJsZSIsImtleWJvYXJkIiwicHJlc3MiLCJ1cGxvYWRzIiwic2V0SW5wdXRGaWxlcyIsIm1pbWVUeXBlIiwiYnVmZmVyIiwiZ2V0QnlUZXh0Iiwic2Vjb25kIiwiY2FyZCIsInRvSGF2ZVRleHQiLCJldmFsdWF0ZSIsImJ5dGVzIiwiZmlsZXMiLCJEYXRhVHJhbnNmZXIiLCJpdGVtcyIsImFkZCIsIkZpbGUiLCJVaW50OEFycmF5IiwidHlwZSIsInZpZXciLCJkb2N1bWVudCIsInF1ZXJ5U2VsZWN0b3IiLCJkaXNwYXRjaEV2ZW50IiwiRHJhZ0V2ZW50IiwiZGF0YVRyYW5zZmVyIiwiYnViYmxlcyIsImNhbmNlbGFibGUiLCJkdWUiLCJnZXRCeUxhYmVsIiwidGhpcmQiLCJjaGVjayIsInRvQmVDaGVja2VkIiwiY2FyZHMiLCJsYXN0IiwibW9kaWZpZXJzIiwiY291bnQiLCJ1bmNoZWNrIiwicmVuYW1lIiwidG9CZURpc2FibGVkIiwicmVuYW1lZCIsInN0YWNraW5nIiwidG9IYXZlSlNQcm9wZXJ0eSIsImJvdW5kaW5nQm94IiwiaSIsInRvQmVGb2N1c2VkIiwidG9CZUVtcHR5IiwibWFya2VyIiwidW5kZXIiLCJhYm92ZSIsImJ1dHRvbnMiLCJQcm9taXNlIiwiYWxsIiwibWFwIiwiZWFjaCIsInkiLCJ0b0JlQ2xvc2VUbyIsIngiLCJ0b0JlR3JlYXRlclRoYW5PckVxdWFsIiwidG9CZUxlc3NUaGFuT3JFcXVhbCIsInRhcmdldCIsImZpbHRlciIsInJlc3BvbnNlIiwiZ2V0QXR0cmlidXRlIiwiaGVhZGVycyIsInRvTWF0Y2giLCJlZGwiLCJ0ZXh0IiwibWF0Y2giLCJ0b0hhdmVMZW5ndGgiLCJ0b0NvbnRhaW4iLCJ0aW1lbGluZSIsImJveCIsInBvc2l0aW9uIiwicmVhY3RlZCIsIm1vdXNlIiwibW92ZSIsInRvQmVIaWRkZW4iLCJob3ZlciIsInByZXNzU2VxdWVudGlhbGx5IiwidG9IYXZlVmFsdWUiLCJwaXhlbCIsIkJ1ZmZlciIsImZyb20iLCJwaWN0dXJlIiwic3RhZ2UiLCJkb3duIiwic3RlcHMiLCJ1cCIsInN0YWNrIiwidmlkZW9zIiwidGltZXMiLCJldmFsdWF0ZUFsbCIsInZpZGVvIiwiY3VycmVudFRpbWUiLCJwaG9uZSIsImNsaXAiLCJ0YXAiLCJwYW5lbCIsImdyYWJiZXIiLCJsZXZlbCIsIndhaXRGb3JUaW1lb3V0IiwicmlnaHQiLCJ0b3VjaHNjcmVlbiIsInNldFZpZXdwb3J0U2l6ZSIsIm5ld2VzdCIsImZpbmQiLCJhc3NldCIsInNvbWUiLCJ2ZXJzaW9uIiwiZ3Vlc3QiLCJyZXZpZXdlciIsInRva2VuIiwib3B0aW9ucyIsImZvcmNlIiwidmlzaXRvciIsIm1hdGUiLCJvd25lciIsIm1lbWJlcnMiLCJwdXQiLCJwcmluY2lwYWwiLCJzaGFyZSIsImFwcHJvdmUiLCJtYWRlIiwibGFiZWwiLCJ0aGVpcnMiLCJsaXN0ZWQiLCJkaWFsb2ciLCJwb2xsIiwic3RvcmVkIiwidG9FcXVhbCIsInNlbGVjdE9wdGlvbiIsIm1lIiwidG9CZU51bGwiLCJuZXdjb21lcnMiLCJ0b01hdGNoT2JqZWN0IiwiY2F0Y2giLCJydW4iLCJ6b2VOYW1lIiwidWlkIiwidmNhcmQiLCJ6b2VJZCIsInJldmlld2VycyIsImxpbmtzIiwicmV2aWV3ZXJJZHMiLCJpbmNsdWRlcyIsImFzc2V0SWRzIiwiY2FuRG93bmxvYWQiLCJ6b2UiLCJwZXJzb24iLCJyaWdodHMiLCJub3ciLCJjYW5Db21tZW50IiwibmVzdGVkIiwiem9lTGlua3MiLCJhZ2FpbiIsImxlbmd0aCIsIm90aGVyIiwibGlua0l0ZW0iLCJoYXMiLCJzZXR0aW5ncyIsImNsZWFudXAiLCJsb2NrIiwibG9ja0ZpbGVzIiwibWluZSIsImNvbW1lbnRlZCIsImluRnJhbWUiLCJib2R5IiwiZm9jdXMiLCJzaG93biIsInRleHRUcmFja3MiLCJ0cmFjayIsIm1vZGUiLCJsYW5ndWFnZSIsInN0ZGlvIiwiaDI2NCIsImNyZWF0ZUVsZW1lbnQiLCJjYW5QbGF5VHlwZSIsImJhciIsImNsaWNrQXQiLCJlbGVtZW50IiwicGF1c2VkIiwidG9CZUdyZWF0ZXJUaGFuIiwidGltZSIsInRvQmVMZXNzVGhhbiIsIk1hdGgiLCJtYXgiLCJpZHMiLCJwdXNoIiwiZnJhbWVPZiIsImZsb29yIiwiZnJhbWUiLCJ0b3VjaFBhZ2UiLCJ0b3VjaFZpZGVvIiwiYmVzaWRlIiwidGFwQXQiLCJ0b0hhdmVDU1MiLCJrbm9iIiwiY2RwIiwibmV3Q0RQU2Vzc2lvbiIsImZpbmdlciIsInRvdWNoUG9pbnRzIiwiZHgiLCJwb2ludGVyIiwiYXQiLCJweCIsInBlZWsiLCJ3YWl0Rm9yIiwidG91Y2giLCJudGgiLCJlbmRlZCIsInRpbWVvdXQiLCJzZXQiLCJPYmplY3QiLCJnZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IiLCJIVE1MTWVkaWFFbGVtZW50IiwicHJvdG90eXBlIiwid2luZG93IiwiYXNzaWduZWQiLCJzZXR0bGVkIiwiYWRkRXZlbnRMaXN0ZW5lciIsImRlZmluZVByb3BlcnR5IiwiY2FsbCIsInZhbHVlIiwic3RlcCIsImRyYWciLCJiZWZvcmUiLCJtYWtlIiwib25lIiwicGljayIsImNsaXBWZXJzaW9uSWQiLCJjYW52YXMiLCJhdWRpbyIsImNlbnRyZSIsImdldENvbnRleHQiLCJnZXRJbWFnZURhdGEiLCJyb3VuZCIsImNsaWVudFdpZHRoIiwicGFyc2VGbG9hdCIsInN0eWxlIiwic3RpbGwiLCJ0b0RhdGFVUkwiLCJwbGF5ZWRBZnRlciIsInByb2JlIiwiY29sb3IiLCJwYXJlbnRFbGVtZW50IiwiYXBwZW5kIiwicHJpbWFyeSIsImdldENvbXB1dGVkU3R5bGUiLCJOdW1iZXIiLCJyZW1vdmUiLCJyYXRpbyIsInJvdyIsImNsaWVudEhlaWdodCIsImNoYW5uZWwiLCJhYnMiLCJjb2x1bW5zIiwic2Vjb25kcyIsInJlc29sdmUiLCJvbmNlIiwic2V0VGltZW91dCIsInJlcXVlc3RBbmltYXRpb25GcmFtZSIsInRvcCIsImJvdHRvbSIsIkFycmF5IiwiXyIsInN1bSIsImFmdGVyIiwiYmVzdCIsInNoaWZ0IiwiZGlmZmVyZW5jZSIsIkluZmluaXR5IiwiZHJhd25BdCIsInJlY29yZCIsInNhbXBsZXMiLCJzdGFydCIsInBlcmZvcm1hbmNlIiwiZHJhd24iLCJxdWFydGVyT24iLCJyZWNvcmRpbmciLCJtb3ZlZCIsImFycml2ZWQiLCJlbXVsYXRlTWVkaWEiLCJyZWR1Y2VkTW90aW9uIiwiZXZlcnkiLCJnb1RvIiwic3dpcGUiLCJnYXBzIiwiV2hlZWxFdmVudCIsImRlbHRhWCIsImVuZCIsIndhdGNoaW5nIiwic291bmQiLCJyZXBlYXQiLCJoZWxkIiwic291bmRBdCIsInJldmVyc2UiLCJsYW5kZWQiLCJnZXRCb3VuZGluZ0NsaWVudFJlY3QiLCJjbGllbnRYIiwibGVmdCIsImNsaWVudFkiLCJwb2ludGVySWQiLCJwb2ludGVyVHlwZSIsIlBvaW50ZXJFdmVudCIsIndhdmUiLCJldmVudCIsInN0b3BQcm9wYWdhdGlvbiIsImNsZWFyIiwiQ2FudmFzUmVuZGVyaW5nQ29udGV4dDJEIiwiY2xlYXJSZWN0IiwiZHJhd3MiLCJhcmdzIiwiYXBwbHkiLCJzdGF0ZSIsIm5vdGNoIiwid2hlZWwiLCJmaWVsZCIsImFuY2hvciIsImNvbW1lbnRPblF1YXJ0ZXIiLCJzdG9wcGVkIiwiY2xvY2tPZiIsIm1zIiwiU3RyaW5nIiwicGFkU3RhcnQiLCJvcGVuRmlyc3QiLCJnZXRCeVBsYWNlaG9sZGVyIiwiY2xvc2luZyIsImxpc3QiLCJwb3B1cCIsImlzVmlzaWJsZSIsImNob29zZXIiLCJ3YWl0Rm9yRXZlbnQiLCJzZXRGaWxlcyIsInBpY2tpbmciLCJwcmV2ZW50RGVmYXVsdCIsImFjdGl2ZUVsZW1lbnQiLCJibHVyIiwibmV4dCIsImlzRW5hYmxlZCIsInN0cmlwIiwibGluZSIsImluZGV4IiwiY3Vyc29yIiwiem9vbSIsIndob2xlIiwiY2lyY2xlIiwiaW5TdHJpcCIsImNvdW50cyIsIm1lbWJlciIsInNoZWV0Iiwib3BlbiIsInRpbWVPZiIsIm1hcmtlck9mIiwicm91dGUiLCJmdWxmaWxsIiwibWV0YSIsInN0YXR1c2NvZGUiLCJjb21tZW50cyIsIm1hbmFnZXMiLCJvdmVyd3JpdHRlbkF0IiwiY2FuQXBwcm92ZSIsImhlaWdodHMiLCJ1bnJvdXRlIiwiYmFjayIsImJhY2tncm91bmRDb2xvciIsInBhcmVudCIsInBhcmVudElkIiwiZmluZ2VycyIsInBvaW50cyIsIm1hcmsiLCJzbGljZSIsImxhbmUiLCJoZWFyZCIsImRlbGl2ZXJHYWluIiwibXV0ZWQiLCJnYWluIiwibWl4IiwiY3V0IiwiZmlsZSIsImpvaW4iLCJyZWFkeSIsImRlcml2ZWQiLCJ3YXZlZm9ybSIsInNpZGUiLCJhbmFseXNlciIsImNyZWF0ZUFuYWx5c2VyIiwiY29ubmVjdCIsIkZsb2F0MzJBcnJheSIsImZmdFNpemUiLCJnZXRGbG9hdFRpbWVEb21haW5EYXRhIiwic291Z2h0IiwiY2xhc3NMaXN0IiwiY29udGFpbnMiLCJhIiwiYiIsInF1ZXJ5U2VsZWN0b3JBbGwiLCJoYWx2ZXMiLCJzZWVrcyIsInN3aXRjaGVzIiwidGljayIsInBsYXlpbmciLCJTZXQiLCJzYW1wbGUiLCJzaXplIiwiZW50cmllcyIsInBhaXIiLCJmcmVzaCIsImZvckVhY2giLCJhcGFydCIsImZvdW5kIiwic2xvdyIsImFkZEluaXRTY3JpcHQiLCJyZXN1bWUiLCJBdWRpb0NvbnRleHQiLCJkb25lIiwidGhlbiIsInBhc3NlcyIsInRvIiwicGFzcyIsInNpZGV3YXlzIiwiY29udHJvbHMiLCJiZWZvcmVGb3J3YXJkIiwiYmVmb3JlQmFjayIsImFkbWluIiwiZmZtcGVnUGF0aCIsImZmcHJvYmVQYXRoIiwicmVsZWFzZSIsImNvbnRpbnVlIiwibmFtZXMiLCJwcm94eUhhbmRlZEluIiwidG9QYXNzIiwiVmlkZW9EZWNvZGVyIiwiaXNDb25maWdTdXBwb3J0ZWQiLCJjb2RlYyIsInN1cHBvcnRlZCIsInRodW1icyIsInByb3h5IiwiYWN0aW9uIiwibWVudSIsImRlcml2ZWRGcm9tQnJvd3NlciIsInVwbG9hZCIsImdpdmVuIiwidXNlcnMiLCJ1c2VyaWQiLCJrZXkiLCJkaXNwbGF5TmFtZSIsIkRlcHRoIiwiZXhlYyIsIndhaXRGb3JVUkwiXSwic291cmNlcyI6WyJyZXZpZXcuc3BlYy5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBjaHJvbWl1bSwgZXhwZWN0LCB0ZXN0IH0gZnJvbSAnQHBsYXl3cmlnaHQvdGVzdCdcbmltcG9ydCB7IGV4ZWNGaWxlU3luYyB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2VzcydcbmltcG9ydCB7IHJhbmRvbUJ5dGVzIH0gZnJvbSAnbm9kZTpjcnlwdG8nXG5pbXBvcnQgeyByZWFkRmlsZVN5bmMgfSBmcm9tICdub2RlOmZzJ1xuaW1wb3J0IHsgQ0xJUCwgQ0xJUF9TQ1JVQiwgQ1VUX0EsIENVVF9CLCBETlhIUiwgSEFORF9QUk9YWSwgTE9ORywgTE9OR19NSVgsIE1JWCwgTUlYX0EsIE1JWF9CIH0gZnJvbSAnLi9maXh0dXJlcy5qcydcblxuY29uc3QgVVJMID0gcHJvY2Vzcy5lbnYuREVMSVZFUl9URVNUX1VSTCA/PyAnaHR0cDovL2xvY2FsaG9zdDo4MDgwJ1xuY29uc3QgQURNSU4gPSBwcm9jZXNzLmVudi5ERUxJVkVSX1RFU1RfVVNFUiA/PyAnYWRtaW4nXG5jb25zdCBBRE1JTl9QQVNTV09SRCA9IHByb2Nlc3MuZW52LkRFTElWRVJfVEVTVF9QQVNTV09SRCA/PyAnYWRtaW5hZG1pbjEyMydcbi8qKiBBIHVzZXIgb2YgaXRzIG93biwgaW4gRW5nbGlzaDogdGhlIHRlc3RzIGZpbmQgYnV0dG9ucyBieSB0aGVpciBuYW1lcywgd2hhdGV2ZXIgbGFuZ3VhZ2UgdGhlIGFkbWluIHNwZWFrcyAqL1xuY29uc3QgVVNFUiA9ICdkZWxpdmVyLWUyZSdcbmNvbnN0IFBBU1NXT1JEID0gJ2RlbGl2ZXItZTJlLScgKyByYW5kb21CeXRlcygxMikudG9TdHJpbmcoJ2hleCcpXG4vKiogQSBzZWNvbmQgTWVtYmVyLCBzb21lb25lIHRvIG1lbnRpb24gKi9cbmNvbnN0IE1BVEUgPSAnZGVsaXZlci1lMmUtbWF0ZSdcbmNvbnN0IE1BVEVfUEFTU1dPUkQgPSAnbWF0ZS0nICsgcmFuZG9tQnl0ZXMoMTIpLnRvU3RyaW5nKCdoZXgnKVxuY29uc3QgQ0RQID0gcHJvY2Vzcy5lbnYuREVMSVZFUl9DRFAgPz8gJ2h0dHA6Ly8xMjcuMC4wLjE6OTIyMidcbi8qKiBUaGUgYnJvd3NlciBtYXkgc2l0IGluIGl0cyBvd24gY29udGFpbmVyLCB3aGVyZSBsb2NhbGhvc3QgaXMgbm90IE5leHRjbG91ZCAqL1xuY29uc3QgQlJPV1NFUl9VUkwgPSBwcm9jZXNzLmVudi5ERUxJVkVSX0JST1dTRVJfVVJMID8/IFVSTFxuXG5jb25zdCBhdXRoID0geyB1c2VybmFtZTogVVNFUiwgcGFzc3dvcmQ6IFBBU1NXT1JELCBzZW5kOiAnYWx3YXlzJyB9XG4vKiogQW4gaVBob25lIGFzIE5leHRjbG91ZCBhY2NlcHRzIGl0OiBhIGN1cnJlbnQgU2FmYXJpLCB0b3VjaCwgYW5kIGl0cyBzaXplICovXG5jb25zdCBQSE9ORSA9IHtcblx0dmlld3BvcnQ6IHsgd2lkdGg6IDM5MCwgaGVpZ2h0OiA4NDQgfSxcblx0ZGV2aWNlU2NhbGVGYWN0b3I6IDMsXG5cdGlzTW9iaWxlOiB0cnVlLFxuXHRoYXNUb3VjaDogdHJ1ZSxcblx0dXNlckFnZW50OiAnTW96aWxsYS81LjAgKGlQaG9uZTsgQ1BVIGlQaG9uZSBPUyAyNl8xIGxpa2UgTWFjIE9TIFgpIEFwcGxlV2ViS2l0LzYwNS4xLjE1IChLSFRNTCwgbGlrZSBHZWNrbykgVmVyc2lvbi8yNi4xIE1vYmlsZS8xNUUxNDggU2FmYXJpLzYwNC4xJyxcbn1cbmNvbnN0IG9jc0hlYWRlcnMgPSB7ICdPQ1MtQVBJUkVRVUVTVCc6ICd0cnVlJywgQWNjZXB0OiAnYXBwbGljYXRpb24vanNvbicgfVxuXG50ZXN0LmRlc2NyaWJlKCdSZXZpZXcgdmlldycsICgpID0+IHtcblx0bGV0IGJyb3dzZXJcblx0bGV0IGNvbnRleHRcblx0bGV0IHBhZ2Vcblx0bGV0IGZvbGRlclxuXHRsZXQgdmVyc2lvbklkXG5cdGxldCBwcm9qZWN0SWRcblxuXHR0ZXN0LmJlZm9yZUFsbChhc3luYyAoeyBwbGF5d3JpZ2h0IH0pID0+IHtcblx0XHRhd2FpdCB0ZXN0VXNlcihwbGF5d3JpZ2h0KVxuXHRcdGNvbnN0IGFwaSA9IGF3YWl0IHBsYXl3cmlnaHQucmVxdWVzdC5uZXdDb250ZXh0KHsgYmFzZVVSTDogVVJMLCBodHRwQ3JlZGVudGlhbHM6IGF1dGgsIGV4dHJhSFRUUEhlYWRlcnM6IG9jc0hlYWRlcnMgfSlcblx0XHRmb2xkZXIgPSAnZGVsaXZlci1lMmUtJyArIHJhbmRvbUJ5dGVzKDQpLnRvU3RyaW5nKCdoZXgnKVxuXHRcdGNvbnN0IGRhdiA9IGAvcmVtb3RlLnBocC9kYXYvZmlsZXMvJHtVU0VSfS8ke2ZvbGRlcn1gXG5cdFx0ZXhwZWN0KChhd2FpdCBhcGkuZmV0Y2goZGF2LCB7IG1ldGhvZDogJ01LQ09MJyB9KSkuc3RhdHVzKCkpLnRvQmUoMjAxKVxuXHRcdGV4cGVjdCgoYXdhaXQgYXBpLmZldGNoKGAke2Rhdn0vY2xpcC53ZWJtYCwgeyBtZXRob2Q6ICdQVVQnLCBkYXRhOiByZWFkRmlsZVN5bmMoQ0xJUCkgfSkpLnN0YXR1cygpKS50b0JlKDIwMSlcblx0XHRjb25zdCBzaGFyZWQgPSBhd2FpdCBhcGkucG9zdCgnL29jcy92Mi5waHAvYXBwcy9maWxlc19zaGFyaW5nL2FwaS92MS9zaGFyZXM/Zm9ybWF0PWpzb24nLCB7XG5cdFx0XHRmb3JtOiB7IHBhdGg6IGAvJHtmb2xkZXJ9YCwgc2hhcmVUeXBlOiAwLCBzaGFyZVdpdGg6IE1BVEUsIHBlcm1pc3Npb25zOiAxNyB9LFxuXHRcdH0pXG5cdFx0ZXhwZWN0KHNoYXJlZC5vaygpKS50b0JlKHRydWUpXG5cblx0XHRjb25zdCBjcmVhdGVkID0gYXdhaXQgYXBpLnBvc3QoJy9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHM/Zm9ybWF0PWpzb24nLCB7XG5cdFx0XHRkYXRhOiB7IGZvbGRlcklkOiBhd2FpdCBmaWxlSWQoYXBpLCBkYXYpLCBhdXRvSW50YWtlOiB0cnVlIH0sXG5cdFx0fSlcblx0XHRwcm9qZWN0SWQgPSAoYXdhaXQgY3JlYXRlZC5qc29uKCkpLm9jcy5kYXRhLmlkXG5cdFx0Y29uc3QgcHJvamVjdCA9IGF3YWl0IGFwaS5nZXQoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHMvJHtwcm9qZWN0SWR9P2Zvcm1hdD1qc29uYClcblx0XHR2ZXJzaW9uSWQgPSAoYXdhaXQgcHJvamVjdC5qc29uKCkpLm9jcy5kYXRhLmFzc2V0c1swXS52ZXJzaW9uc1swXS5pZFxuXHRcdGF3YWl0IGFwaS5kaXNwb3NlKClcblxuXHRcdGJyb3dzZXIgPSBhd2FpdCBjaHJvbWl1bS5jb25uZWN0T3ZlckNEUChDRFApXG5cdFx0Y29udGV4dCA9IGF3YWl0IGJyb3dzZXIubmV3Q29udGV4dCh7IGJhc2VVUkw6IEJST1dTRVJfVVJMIH0pXG5cdFx0cGFnZSA9IGF3YWl0IGNvbnRleHQubmV3UGFnZSgpXG5cdFx0YXdhaXQgbG9naW4ocGFnZSlcblx0fSlcblxuXHR0ZXN0LmFmdGVyQWxsKGFzeW5jICh7IHBsYXl3cmlnaHQgfSkgPT4ge1xuXHRcdGF3YWl0IGNvbnRleHQ/LmNsb3NlKClcblx0XHRhd2FpdCBicm93c2VyPy5jbG9zZSgpXG5cdFx0Y29uc3QgYXBpID0gYXdhaXQgcGxheXdyaWdodC5yZXF1ZXN0Lm5ld0NvbnRleHQoeyBiYXNlVVJMOiBVUkwsIGh0dHBDcmVkZW50aWFsczogYXV0aCwgZXh0cmFIVFRQSGVhZGVyczogb2NzSGVhZGVycyB9KVxuXHRcdGF3YWl0IGFwaS5kZWxldGUoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHMvJHtwcm9qZWN0SWR9P2Zvcm1hdD1qc29uYClcblx0XHRhd2FpdCBhcGkuZmV0Y2goYC9yZW1vdGUucGhwL2Rhdi9maWxlcy8ke1VTRVJ9LyR7Zm9sZGVyfWAsIHsgbWV0aG9kOiAnREVMRVRFJyB9KVxuXHRcdGF3YWl0IGFwaS5kaXNwb3NlKClcblx0fSlcblxuXHR0ZXN0KCd0aGUgUHJvamVjdCBsaXN0IGxlYWRzIGludG8gYSBSZXZpZXcgYW5kIGJhY2snLCBhc3luYyAoKSA9PiB7XG5cdFx0YXdhaXQgcGFnZS5nb3RvKCcvYXBwcy9kZWxpdmVyLycpXG5cdFx0Y29uc3QgdGlsZSA9IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcHJvamVjdC1jYXJkJywgeyBoYXNUZXh0OiBmb2xkZXIgfSlcblx0XHRhd2FpdCBleHBlY3QodGlsZSkudG9Db250YWluVGV4dCgnMSBBc3NldCcpXG5cdFx0YXdhaXQgdGlsZS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTChuZXcgUmVnRXhwKGAvcHJvamVjdHMvJHtwcm9qZWN0SWR9JGApKVxuXHRcdC8vIEEgY2xpY2sgdGlja3MgdGhlIGNhcmQsIGEgZG91YmxlIGNsaWNrIG9wZW5zIGl0IChzdG9yeSAxNDEpXG5cdFx0Y29uc3QgbGluayA9IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY2FyZF9fbGluaycpLmZpcnN0KClcblx0XHRhd2FpdCBsaW5rLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jYXJkJykuZmlyc3QoKSkudG9IYXZlQ2xhc3MoL2RlbGl2ZXItY2FyZC0tc2VsZWN0ZWQvKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwobmV3IFJlZ0V4cChgL3Byb2plY3RzLyR7cHJvamVjdElkfSRgKSlcblx0XHRhd2FpdCBsaW5rLmRibGNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKG5ldyBSZWdFeHAoYC92ZXJzaW9ucy8ke3ZlcnNpb25JZH0kYCkpXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2xpbmsnLCB7IG5hbWU6IGZvbGRlciwgZXhhY3Q6IHRydWUgfSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwobmV3IFJlZ0V4cChgL3Byb2plY3RzLyR7cHJvamVjdElkfSRgKSlcblxuXHRcdC8vIFRoZSBQcm9qZWN0IGxpc3QgZmluZHMgYSBQcm9qZWN0IGJ5IG5hbWUsIGFuZCBhIHJpZ2h0IGNsaWNrIG9wZW5zIGl0IHRvb1xuXHRcdGF3YWl0IHBhZ2UuZ290bygnL2FwcHMvZGVsaXZlci8nKVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdzZWFyY2hib3gnLCB7IG5hbWU6ICdGaW5kIGEgUHJvamVjdCcgfSkuZmlsbChmb2xkZXIpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcHJvamVjdC1jYXJkJykpLnRvSGF2ZUNvdW50KDEpXG5cdFx0YXdhaXQgdGlsZS5jbGljayh7IGJ1dHRvbjogJ3JpZ2h0JyB9KVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdtZW51aXRlbScsIHsgbmFtZTogJ09wZW4nLCBleGFjdDogdHJ1ZSB9KS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTChuZXcgUmVnRXhwKGAvcHJvamVjdHMvJHtwcm9qZWN0SWR9JGApKVxuXHR9KVxuXG5cdHRlc3QoJ3RoZSBsaXN0IGlzIHJlbWVtYmVyZWQgZm9yIHRoZSBQcm9qZWN0LCBhbmQgYSBjYXJkIGtlZXBzIGl0cyBhY3Rpb25zIGFzIGEgcm93JywgYXN5bmMgKCkgPT4ge1xuXHRcdGF3YWl0IHBhZ2UuZ290byhgL2FwcHMvZGVsaXZlci9wcm9qZWN0cy8ke3Byb2plY3RJZH1gKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNhcmQnKSkubm90LnRvSGF2ZUNsYXNzKC9kZWxpdmVyLWNhcmQtLXJvdy8pXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1Nob3cgdGhlIEFzc2V0cyBhcyBhIGxpc3QnIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jYXJkJykuZmlyc3QoKSkudG9IYXZlQ2xhc3MoL2RlbGl2ZXItY2FyZC0tcm93Lylcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jYXJkX19mYWN0cycpLmZpcnN0KCkpLnRvQ29udGFpblRleHQoJ1YxJylcblx0XHRhd2FpdCBwYWdlLnJlbG9hZCgpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY2FyZCcpLmZpcnN0KCkpLnRvSGF2ZUNsYXNzKC9kZWxpdmVyLWNhcmQtLXJvdy8pXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdTaG93IHRoZSBBc3NldHMgYXMgYSBsaXN0JyB9KSkudG9IYXZlQXR0cmlidXRlKCdhcmlhLXByZXNzZWQnLCAndHJ1ZScpXG5cdFx0Ly8gVGhlIG1lbnUgaXMgc3RpbGwgdGhlcmUsIGFzIGEgcm93XG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogL15BY3Rpb25zIGZvciAvIH0pLmZpcnN0KCkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5Um9sZSgnbWVudWl0ZW0nLCB7IG5hbWU6ICdSZW5hbWXigKYnIH0pKS50b0JlVmlzaWJsZSgpXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnRXNjYXBlJylcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnU2hvdyB0aGUgQXNzZXRzIGFzIGEgbGlzdCcgfSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNhcmQnKS5maXJzdCgpKS5ub3QudG9IYXZlQ2xhc3MoL2RlbGl2ZXItY2FyZC0tcm93Lylcblx0fSlcblxuXHR0ZXN0KCd1cGxvYWRzIGludG8gdGhlIFByb2plY3QsIHRoZW4gZmlsdGVycyBhbmQgZmluZHMgaXRzIEFzc2V0cycsIGFzeW5jICgpID0+IHtcblx0XHRhd2FpdCBwYWdlLmdvdG8oYC9hcHBzL2RlbGl2ZXIvcHJvamVjdHMvJHtwcm9qZWN0SWR9YClcblx0XHQvLyBUaGUgdXBsb2FkIGJ1dHRvbiBvcGVucyB0aGUgVXBsb2FkcyBkaWFsb2cgKHN0b3J5IDEzMylcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnVXBsb2FkJywgZXhhY3Q6IHRydWUgfSkuY2xpY2soKVxuXHRcdGNvbnN0IHVwbG9hZHMgPSBwYWdlLmdldEJ5Um9sZSgnZGlhbG9nJywgeyBuYW1lOiAnVXBsb2FkcycgfSlcblx0XHRhd2FpdCB1cGxvYWRzLmxvY2F0b3IoJ2lucHV0W3R5cGU9ZmlsZV1bbXVsdGlwbGVdJykuc2V0SW5wdXRGaWxlcyh7IG5hbWU6ICdzZWNvbmQud2VibScsIG1pbWVUeXBlOiAndmlkZW8vd2VibScsIGJ1ZmZlcjogcmVhZEZpbGVTeW5jKENMSVApIH0pXG5cdFx0Ly8gQXV0byBJbnRha2Ugd291bGQgdGFrZSB0aGUgZmlsZSBhbnl3YXk7IHRoZSB1cGxvYWQgaXRzZWxmIG11c3Qgbm90IGZhaWxcblx0XHRhd2FpdCBleHBlY3QodXBsb2Fkcy5nZXRCeVRleHQoJ09wZW4nLCB7IGV4YWN0OiB0cnVlIH0pKS50b0JlVmlzaWJsZSgpXG5cdFx0YXdhaXQgZXhwZWN0KHVwbG9hZHMubG9jYXRvcignLmRlbGl2ZXItdXBsb2Fkc19fc3RhdHVzLS1lcnJvcicpKS50b0hhdmVDb3VudCgwKVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ0VzY2FwZScpXG5cdFx0Y29uc3Qgc2Vjb25kID0gY2FyZChwYWdlLCAnc2Vjb25kJylcblx0XHRhd2FpdCBleHBlY3Qoc2Vjb25kKS50b0JlVmlzaWJsZSgpXG5cblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAvXkNoYW5nZXMgcmVxdWVzdGVkLyB9KS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTCgvZmlsdGVyPWNoYW5nZXMvKVxuXHRcdGF3YWl0IGV4cGVjdChzZWNvbmQpLnRvSGF2ZUNvdW50KDApXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogL15BbGwvIH0pLmNsaWNrKClcblxuXHRcdC8vIFdob2V2ZXIgdXBsb2FkcyBkZWxpdmVyczogdGhlIGNhcmQgbmFtZXMgdGhlbSwgYW5kIHRoZSBmaWx0ZXIgZmluZHMgd2hhdCB0aGV5IGRlbGl2ZXJlZFxuXHRcdGF3YWl0IGV4cGVjdChzZWNvbmQubG9jYXRvcignLmRlbGl2ZXItY2FyZF9fbWV0YScpKS50b0NvbnRhaW5UZXh0KC9eZGVsaXZlci1lMmUgwrcgLylcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAvXkRlbGl2ZXJlZCBieSBtZS8gfSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoL2ZpbHRlcj1taW5lLylcblx0XHRhd2FpdCBleHBlY3Qoc2Vjb25kKS50b0JlVmlzaWJsZSgpXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogL15BbGwvIH0pLmNsaWNrKClcblxuXHRcdC8vIFRoZSBsYXRlc3QgYWN0aXZpdHkgY29tZXMgZmlyc3QsIHVudGlsIHRoZSBvcmRlciBpcyBieSBuYW1lXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY2FyZF9fbmFtZScpLmZpcnN0KCkpLnRvSGF2ZVRleHQoJ3NlY29uZCcpXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ0xhdGVzdCBhY3Rpdml0eScgfSkuY2xpY2soKVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdtZW51aXRlbXJhZGlvJywgeyBuYW1lOiAnTmFtZScgfSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoL3NvcnQ9bmFtZS8pXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY2FyZF9fbmFtZScpLmZpcnN0KCkpLnRvSGF2ZVRleHQoJ2NsaXAnKVxuXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ3NlYXJjaGJveCcsIHsgbmFtZTogJ0ZpbmQgYW4gQXNzZXQnIH0pLmZpbGwoJ1NFQ09ORCcpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY2FyZCcpKS50b0hhdmVDb3VudCgxKVxuXG5cdFx0Ly8gRHJvcHBlZCBmaWxlcyBnbyB0aGUgc2FtZSB3YXk7IGFueXRoaW5nIGJ1dCBtZWRpYSBzdGF5cyBvdXRcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnc2VhcmNoYm94JywgeyBuYW1lOiAnRmluZCBhbiBBc3NldCcgfSkuZmlsbCgnJylcblx0XHRhd2FpdCBwYWdlLmV2YWx1YXRlKChieXRlcykgPT4ge1xuXHRcdFx0Y29uc3QgZmlsZXMgPSBuZXcgRGF0YVRyYW5zZmVyKClcblx0XHRcdGZpbGVzLml0ZW1zLmFkZChuZXcgRmlsZShbbmV3IFVpbnQ4QXJyYXkoYnl0ZXMpXSwgJ3RoaXJkLndlYm0nLCB7IHR5cGU6ICd2aWRlby93ZWJtJyB9KSlcblx0XHRcdGZpbGVzLml0ZW1zLmFkZChuZXcgRmlsZShbJ25vdGVzJ10sICdub3Rlcy50eHQnLCB7IHR5cGU6ICd0ZXh0L3BsYWluJyB9KSlcblx0XHRcdGNvbnN0IHZpZXcgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKCcuZGVsaXZlci1wcm9qZWN0Jylcblx0XHRcdGZvciAoY29uc3QgdHlwZSBvZiBbJ2RyYWdlbnRlcicsICdkcmFnb3ZlcicsICdkcm9wJ10pIHtcblx0XHRcdFx0dmlldy5kaXNwYXRjaEV2ZW50KG5ldyBEcmFnRXZlbnQodHlwZSwgeyBkYXRhVHJhbnNmZXI6IGZpbGVzLCBidWJibGVzOiB0cnVlLCBjYW5jZWxhYmxlOiB0cnVlIH0pKVxuXHRcdFx0fVxuXHRcdH0sIFsuLi5yZWFkRmlsZVN5bmMoQ0xJUCldKVxuXHRcdGF3YWl0IGV4cGVjdChjYXJkKHBhZ2UsICd0aGlyZCcpKS50b0JlVmlzaWJsZSgpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY2FyZCcsIHsgaGFzVGV4dDogJ25vdGVzJyB9KSkudG9IYXZlQ291bnQoMClcblx0XHQvLyBUaGV5IGdvIHdpdGggdGhlIGNhcmQgaW4gdGhlIGNvcm5lciwgd2hpY2ggb3BlbnMgdGhlIGRpYWxvZyBhZ2FpbiAoc3RvcnkgMTM0KVxuXHRcdGF3YWl0IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItdXBsb2Fkcy1jYXJkX19vcGVuJykuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdCh1cGxvYWRzKS50b0NvbnRhaW5UZXh0KCdPbmx5IHZpZGVvLCBhdWRpbyBhbmQgaW1hZ2UgZmlsZXMnKVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ0VzY2FwZScpXG5cblx0XHQvLyBBIFZlcnNpb24gU3RhY2sgaXMgbWFuYWdlZCBmcm9tIGl0cyBjYXJkLCBub3QgaW4gdGhlIFJldmlldyB2aWV3XG5cdFx0YXdhaXQgc2Vjb25kLmNsaWNrKHsgYnV0dG9uOiAncmlnaHQnIH0pXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ21lbnVpdGVtJywgeyBuYW1lOiAnTWFuYWdlIFZlcnNpb25zJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKCdkaWFsb2cnLCB7IG5hbWU6ICdWZXJzaW9ucyBvZiBzZWNvbmQnIH0pKS50b0NvbnRhaW5UZXh0KCdWZXJzaW9uIDEnKVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ0VzY2FwZScpXG5cblx0XHQvLyBTbyBpcyBpdHMgRHVlIERhdGUsIHRocm91Z2ggYSB2aXNpYmxlIGZpZWxkOiBTYWZhcmkgb3BlbnMgbm8gcGlja2VyIGZvciBhIGhpZGRlbiBvbmVcblx0XHRhd2FpdCBzZWNvbmQuY2xpY2soeyBidXR0b246ICdyaWdodCcgfSlcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnbWVudWl0ZW0nLCB7IG5hbWU6ICdTZXQgYSBEdWUgRGF0ZScgfSkuY2xpY2soKVxuXHRcdGNvbnN0IGR1ZSA9IHBhZ2UuZ2V0QnlSb2xlKCdkaWFsb2cnLCB7IG5hbWU6ICdEdWUgRGF0ZScgfSlcblx0XHRhd2FpdCBkdWUuZ2V0QnlMYWJlbCgnRHVlIERhdGUnKS5maWxsKCcyMDMwLTAxLTE1Jylcblx0XHRhd2FpdCBkdWUuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdTYXZlJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KHNlY29uZC5sb2NhdG9yKCcuZGVsaXZlci1jYXJkX19kdWUnKSkudG9Db250YWluVGV4dCgnMTUnKVxuXHRcdGF3YWl0IHNlY29uZC5jbGljayh7IGJ1dHRvbjogJ3JpZ2h0JyB9KVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5Um9sZSgnbWVudWl0ZW0nLCB7IG5hbWU6ICdDaGFuZ2UgdGhlIER1ZSBEYXRlJyB9KSkudG9CZVZpc2libGUoKVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ0VzY2FwZScpXG5cblx0XHQvLyBUaWNrZWQsIHR3byBjYXJkcyBzaGFyZSBvbmUgbWVudSB3aXRoIHdoYXQgYXBwbGllcyB0byBib3RoIChzdG9yeSAxNDEpXG5cdFx0Y29uc3QgdGhpcmQgPSBjYXJkKHBhZ2UsICd0aGlyZCcpXG5cdFx0YXdhaXQgc2Vjb25kLmdldEJ5Um9sZSgnY2hlY2tib3gnLCB7IG5hbWU6ICdTZWxlY3Qgc2Vjb25kJyB9KS5jaGVjaygpXG5cdFx0YXdhaXQgdGhpcmQuZ2V0QnlSb2xlKCdjaGVja2JveCcsIHsgbmFtZTogJ1NlbGVjdCB0aGlyZCcgfSkuY2hlY2soKVxuXHRcdGF3YWl0IHRoaXJkLmNsaWNrKHsgYnV0dG9uOiAncmlnaHQnIH0pXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKCdtZW51JywgeyBuYW1lOiAnMiBBc3NldHMgc2VsZWN0ZWQnIH0pKS50b0JlVmlzaWJsZSgpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKCdtZW51aXRlbScsIHsgbmFtZTogJ0RlbGV0ZScgfSkpLnRvQmVWaXNpYmxlKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5nZXRCeVJvbGUoJ21lbnVpdGVtJywgeyBuYW1lOiAnT3BlbicgfSkpLnRvSGF2ZUNvdW50KDApXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ21lbnVpdGVtJywgeyBuYW1lOiAnQ2xlYXIgdGhlIHNlbGVjdGlvbicgfSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdChzZWNvbmQuZ2V0QnlSb2xlKCdjaGVja2JveCcsIHsgbmFtZTogJ1NlbGVjdCBzZWNvbmQnIH0pKS5ub3QudG9CZUNoZWNrZWQoKVxuXHRcdC8vIEEgc2hpZnQtY2xpY2sgdGlja3MgZXZlcnkgY2FyZCBmcm9tIHRoZSBvbmUgY2xpY2tlZCBsYXN0XG5cdFx0Y29uc3QgY2FyZHMgPSBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNhcmRfX3NlbGVjdCcpXG5cdFx0YXdhaXQgY2FyZHMuZmlyc3QoKS5jaGVjaygpXG5cdFx0YXdhaXQgY2FyZHMubGFzdCgpLmNsaWNrKHsgbW9kaWZpZXJzOiBbJ1NoaWZ0J10gfSlcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jYXJkX19zZWxlY3Q6Y2hlY2tlZCcpKS50b0hhdmVDb3VudChhd2FpdCBjYXJkcy5jb3VudCgpKVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdjaGVja2JveCcsIHsgbmFtZTogJ0NsZWFyIHRoZSBzZWxlY3Rpb24nIH0pLnVuY2hlY2soKVxuXG5cdFx0Ly8gVGhlIGNoZWNrYm94IGF0IHRoZSBzdGFydCBvZiB0aGUgZmlsdGVyIHJvdyB0aWNrcyBldmVyeSBjYXJkLCBhbmQgY2xlYXJzIHRoZW0gYWdhaW5cblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnY2hlY2tib3gnLCB7IG5hbWU6ICdTZWxlY3QgYWxsJyB9KS5jaGVjaygpXG5cdFx0YXdhaXQgZXhwZWN0KHRoaXJkLmdldEJ5Um9sZSgnY2hlY2tib3gnLCB7IG5hbWU6ICdTZWxlY3QgdGhpcmQnIH0pKS50b0JlQ2hlY2tlZCgpXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2NoZWNrYm94JywgeyBuYW1lOiAnQ2xlYXIgdGhlIHNlbGVjdGlvbicgfSkudW5jaGVjaygpXG5cdFx0YXdhaXQgZXhwZWN0KHRoaXJkLmdldEJ5Um9sZSgnY2hlY2tib3gnLCB7IG5hbWU6ICdTZWxlY3QgdGhpcmQnIH0pKS5ub3QudG9CZUNoZWNrZWQoKVxuXHR9KVxuXG5cdHRlc3QoJ3JlbmFtZXMsIHJlbW92ZXMgYW5kIHN0YWNrcyBmcm9tIHRoZSBtZW51cyBvZiB0aGUgY2FyZHMnLCBhc3luYyAoKSA9PiB7XG5cdFx0YXdhaXQgcGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL3Byb2plY3RzLyR7cHJvamVjdElkfWApXG5cdFx0Ly8gVGhlIG1lbnUgaGFzIGEgYnV0dG9uIG9uIGV2ZXJ5IHNjcmVlbiwgYmVzaWRlIHRoZSBuYW1lXG5cdFx0Y29uc3Qgc2Vjb25kID0gY2FyZChwYWdlLCAnc2Vjb25kJylcblx0XHRhd2FpdCBzZWNvbmQuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdBY3Rpb25zIGZvciBzZWNvbmQnIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5nZXRCeVJvbGUoJ21lbnVpdGVtJywgeyBuYW1lOiAnRG93bmxvYWQnIH0pKS50b0hhdmVBdHRyaWJ1dGUoJ2hyZWYnLCAvXFwvc2Vjb25kXFwud2VibSQvKVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdtZW51aXRlbScsIHsgbmFtZTogJ1JlbmFtZeKApicgfSkuY2xpY2soKVxuXHRcdGNvbnN0IHJlbmFtZSA9IHBhZ2UuZ2V0QnlSb2xlKCdkaWFsb2cnLCB7IG5hbWU6ICdSZW5hbWUgZmlsZScgfSlcblx0XHRhd2FpdCBleHBlY3QocmVuYW1lKS50b0NvbnRhaW5UZXh0KCdhY3RpdmVseSBiZWluZyB3b3JrZWQgb24nKVxuXHRcdC8vIE5leHRjbG91ZCByZWFkcyB0aGUgdHlwZSBmcm9tIHRoZSBleHRlbnNpb24sIHNvIGl0IHN0YXlzXG5cdFx0YXdhaXQgcmVuYW1lLmdldEJ5TGFiZWwoJ05hbWUnKS5maWxsKCdyZW5hbWVkLm1vdicpXG5cdFx0YXdhaXQgZXhwZWN0KHJlbmFtZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1JlbmFtZScgfSkpLnRvQmVEaXNhYmxlZCgpXG5cdFx0Ly8gQSBuYW1lIHdpdGggJiBhbmQgJyBzaG93cyBhcyBpdCBpcywgaW4gbGFiZWxzIHRvbyAoIzkzKVxuXHRcdGF3YWl0IHJlbmFtZS5nZXRCeUxhYmVsKCdOYW1lJykuZmlsbCgnU21pdGggJiBPXFwnTmVpbC53ZWJtJylcblx0XHRhd2FpdCByZW5hbWUuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdSZW5hbWUnIH0pLmNsaWNrKClcblx0XHRjb25zdCByZW5hbWVkID0gY2FyZChwYWdlLCAnU21pdGggJiBPXFwnTmVpbCcpXG5cdFx0YXdhaXQgZXhwZWN0KHJlbmFtZWQuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdBY3Rpb25zIGZvciBTbWl0aCAmIE9cXCdOZWlsJywgZXhhY3Q6IHRydWUgfSkpLnRvQmVWaXNpYmxlKClcblxuXHRcdC8vIFJlbW92ZWQgZnJvbSBhIEZvbGRlciBQcm9qZWN0IHdpdGggQXV0byBJbnRha2UsIGEgZmlsZSB3YWl0cyBhcyBub3QgdXAgZm9yIHJldmlldyAoIzQ1KVxuXHRcdGF3YWl0IGNhcmQocGFnZSwgJ3RoaXJkJykuY2xpY2soeyBidXR0b246ICdyaWdodCcgfSlcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnbWVudWl0ZW0nLCB7IG5hbWU6ICdSZW1vdmUgZnJvbSBQcm9qZWN0JyB9KS5jbGljaygpXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2RpYWxvZycpLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnUmVtb3ZlJyB9KS5jbGljaygpXG5cdFx0Y29uc3QgdGhpcmQgPSBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLW5vdC11cCcsIHsgaGFzVGV4dDogJ3RoaXJkLndlYm0nIH0pXG5cdFx0YXdhaXQgZXhwZWN0KHRoaXJkKS50b0JlVmlzaWJsZSgpXG5cdFx0YXdhaXQgcGFnZS5yZWxvYWQoKVxuXHRcdGF3YWl0IGV4cGVjdCh0aGlyZCkudG9CZVZpc2libGUoKVxuXG5cdFx0Ly8gYW5kIGpvaW5zIGFuIEFzc2V0IGZyb20gaXRzIG93biBtZW51XG5cdFx0YXdhaXQgdGhpcmQuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdBY3Rpb25zIGZvciB0aGlyZC53ZWJtJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ21lbnVpdGVtJywgeyBuYW1lOiAnQWRkIGFzIGEgbmV3IFZlcnNpb24gb2bigKYnIH0pLmNsaWNrKClcblx0XHRjb25zdCBzdGFja2luZyA9IHBhZ2UuZ2V0QnlSb2xlKCdkaWFsb2cnLCB7IG5hbWU6ICdBZGQgdGhpcmQud2VibSBhcyBhIG5ldyBWZXJzaW9uJyB9KVxuXHRcdGF3YWl0IHN0YWNraW5nLmxvY2F0b3IoJy52LXNlbGVjdCcpLmNsaWNrKClcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnb3B0aW9uJywgeyBuYW1lOiAnU21pdGggJiBPXFwnTmVpbCcgfSkuY2xpY2soKVxuXHRcdGF3YWl0IHN0YWNraW5nLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnQWRkJywgZXhhY3Q6IHRydWUgfSkuY2xpY2soKVxuXHRcdC8vIFRoZSBBc3NldCBpcyBuYW1lZCBhZnRlciBpdHMgbmV3ZXN0IFZlcnNpb24ncyBmaWxlXG5cdFx0YXdhaXQgZXhwZWN0KGNhcmQocGFnZSwgJ3RoaXJkJykubG9jYXRvcignLmRlbGl2ZXItY2FyZF9fdmVyc2lvbicpKS50b0hhdmVUZXh0KCdWMicpXG5cdFx0YXdhaXQgZXhwZWN0KHJlbmFtZWQpLnRvSGF2ZUNvdW50KDApXG5cdFx0YXdhaXQgZXhwZWN0KHRoaXJkKS50b0hhdmVDb3VudCgwKVxuXHR9KVxuXG5cdHRlc3QoJ2NvbW1lbnRzIG9uIGEgRnJhbWUgYW5kIG9uIGEgUmFuZ2UsIHJlc29sdmVzIGFuZCByZXBsaWVzJywgYXN5bmMgKCkgPT4ge1xuXHRcdGF3YWl0IHBhZ2UuZ290byhgL2FwcHMvZGVsaXZlci92ZXJzaW9ucy8ke3ZlcnNpb25JZH1gKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJ3ZpZGVvLmRlbGl2ZXItcGxheWVyX192aWRlbycpKS50b0hhdmVKU1Byb3BlcnR5KCdyZWFkeVN0YXRlJywgNClcblxuXHRcdC8vIEZyYW1lIHN0ZXBwaW5nIGlzIGV4YWN0OiBmaXZlIHN0ZXBzIGF0IDI1IGZwcyBsYW5kIG9uIDAwOjAwOjAwOjA1OyBDIGJyaW5ncyBoaWRkZW4gQ29tbWVudHMgYmFja1xuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdIaWRlIENvbW1lbnRzJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX19tYXJrZXInKSkudG9IYXZlQ291bnQoMClcblx0XHRjb25zdCBoZWlnaHQgPSAoYXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX3N0YWdlJykuYm91bmRpbmdCb3goKSkuaGVpZ2h0XG5cdFx0Ly8gRm9jdXMgdGhlIHBhZ2Ugd2l0aG91dCB0b3VjaGluZyB0aGUgcGxheWVyXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1yZXZpZXdfX3RpdGxlJykuY2xpY2soKVxuXHRcdGZvciAobGV0IGkgPSAwOyBpIDwgNTsgaSsrKSB7XG5cdFx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdBcnJvd1JpZ2h0Jylcblx0XHR9XG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX190aW1lY29kZScpKS50b0NvbnRhaW5UZXh0KCcwMDowMDowMDowNScpXG5cblx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdjJylcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcjZGVsaXZlci1jb21tZW50LWJvZHknKSkudG9CZUZvY3VzZWQoKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRzX19hbmNob3InKSkudG9IYXZlVGV4dCgvMDA6MDA6MDA6MDUvKVxuXHRcdGF3YWl0IHBhZ2UubG9jYXRvcignI2RlbGl2ZXItY29tbWVudC1ib2R5JykuZmlsbCgnc291bmQgc3RhcnRzIHRvbyBlYXJseScpXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50c19fZm9ybSBidXR0b25bdGl0bGU9XCJTZW5kIChFbnRlcilcIl0nKS5jbGljaygpXG5cblx0XHRjb25zdCBmaXJzdCA9IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tbWVudCcpLmZpcnN0KClcblx0XHRhd2FpdCBleHBlY3QoZmlyc3QpLnRvQ29udGFpblRleHQoJ3NvdW5kIHN0YXJ0cyB0b28gZWFybHknKVxuXHRcdC8vIE5vIHJvdyBvZiBpdHMgb3duOiB0aGUgQ29tbWVudCB0YWtlcyBub3RoaW5nIGZyb20gdGhlIHBpY3R1cmVcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX21hcmtlcicpKS50b0JlVmlzaWJsZSgpXG5cdFx0ZXhwZWN0KChhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fc3RhZ2UnKS5ib3VuZGluZ0JveCgpKS5oZWlnaHQpLnRvQmUoaGVpZ2h0KVxuXHRcdGF3YWl0IGV4cGVjdChmaXJzdC5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50X190aW1lJykpLm5vdC50b0JlRW1wdHkoKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRfX2FuY2hvcicpLmZpcnN0KCkpLnRvSGF2ZVRleHQoJzAwOjAwOjAwOjA1Jylcblx0XHQvLyBJdHMgYXV0aG9yJ3MgaW5pdGlhbHMsIG9uIHRoZSBiYXIsIHdoaWNoIGxpZXMgYmV0d2VlbiB0aGUgcGljdHVyZSBhbmQgdGhlIGJ1dHRvbnMgd2l0aCBub3RoaW5nIGJlc2lkZSBpdFxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fbWFya2VyJykpLnRvSGF2ZVRleHQoJ0QnKVxuXHRcdGNvbnN0IFttYXJrZXIsIHVuZGVyLCBhYm92ZSwgYnV0dG9uc10gPSBhd2FpdCBQcm9taXNlLmFsbChbJ21hcmtlcicsICd0aW1lbGluZScsICdzdGFnZScsICdjb250cm9scyddLm1hcCgoZWFjaCkgPT4gcGFnZS5sb2NhdG9yKGAuZGVsaXZlci1wbGF5ZXJfXyR7ZWFjaH1gKS5ib3VuZGluZ0JveCgpKSlcblx0XHRleHBlY3QobWFya2VyLnkgKyBtYXJrZXIuaGVpZ2h0IC8gMikudG9CZUNsb3NlVG8odW5kZXIueSArIHVuZGVyLmhlaWdodCAvIDIsIDApXG5cdFx0ZXhwZWN0KG1hcmtlci54ICsgbWFya2VyLndpZHRoIC8gMikudG9CZUNsb3NlVG8odW5kZXIueCArIHVuZGVyLndpZHRoICogNSAvIDEwMCwgMClcblx0XHRleHBlY3QodW5kZXIueSkudG9CZUNsb3NlVG8oYWJvdmUueSArIGFib3ZlLmhlaWdodCwgMClcblx0XHRleHBlY3QoYnV0dG9ucy55KS50b0JlQ2xvc2VUbyh1bmRlci55ICsgdW5kZXIuaGVpZ2h0LCAwKVxuXHRcdGV4cGVjdChtYXJrZXIueSkudG9CZUdyZWF0ZXJUaGFuT3JFcXVhbChhYm92ZS55ICsgYWJvdmUuaGVpZ2h0IC0gMilcblx0XHRleHBlY3QobWFya2VyLnkgKyBtYXJrZXIuaGVpZ2h0KS50b0JlTGVzc1RoYW5PckVxdWFsKChhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnUGxheSAoU3BhY2UpJyB9KS5ib3VuZGluZ0JveCgpKS55KVxuXG5cdFx0Ly8gQSBSYW5nZSwgc2V0IHdpdGggSSBhbmQgT1xuXHRcdC8vIEZvY3VzIHRoZSBwYWdlIHdpdGhvdXQgdG91Y2hpbmcgdGhlIHBsYXllclxuXHRcdGF3YWl0IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcmV2aWV3X190aXRsZScpLmNsaWNrKClcblx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdpJylcblx0XHRmb3IgKGxldCBpID0gMDsgaSA8IDIwOyBpKyspIHtcblx0XHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ0Fycm93UmlnaHQnKVxuXHRcdH1cblx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdvJylcblx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdjJylcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50c19fYW5jaG9yJykpLnRvSGF2ZVRleHQoL+KAky8pXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcjZGVsaXZlci1jb21tZW50LWJvZHknKS5maWxsKCdzaG9ydGVuIHRoaXMgcGFzc2FnZScpXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50c19fZm9ybSBidXR0b25bdGl0bGU9XCJTZW5kIChFbnRlcilcIl0nKS5jbGljaygpXG5cdFx0Ly8gQm90aCBzdGFydCBvbiB0aGUgc2FtZSBGcmFtZTogb25lIGNpcmNsZSB3aXRoIHRoZWlyIGNvdW50XG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX19tYXJrZXInKSkudG9IYXZlVGV4dCgnMicpXG5cblx0XHQvLyBSZXNvbHZpbmcgaGlkZXMgaXQgZnJvbSB0aGUgdW5yZXNvbHZlZCBmaWx0ZXIsIGEgUmVwbHkgc3RheXMgd2l0aCBpdHMgcGFyZW50XG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50JykuZmlyc3QoKS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ01hcmsgYXMgcmVzb2x2ZWQnIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50JykuZmlyc3QoKSkudG9IYXZlQ2xhc3MoL2RlbGl2ZXItY29tbWVudC0tcmVzb2x2ZWQvKVxuXHRcdGF3YWl0IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tbWVudHNfX3Nob3cgYnV0dG9uJykuY2xpY2soKVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdtZW51aXRlbXJhZGlvJywgeyBuYW1lOiAnVW5yZXNvbHZlZCcgfSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRzX19saXN0ID4gLmRlbGl2ZXItY29tbWVudCcpKS50b0hhdmVDb3VudCgxKVxuXHRcdGF3YWl0IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tbWVudHNfX3Nob3cgYnV0dG9uJykuY2xpY2soKVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdtZW51aXRlbXJhZGlvJywgeyBuYW1lOiAnQWxsIENvbW1lbnRzJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tbWVudHNfX2xpc3QgPiAuZGVsaXZlci1jb21tZW50JykpLnRvSGF2ZUNvdW50KDIpXG5cblx0XHRjb25zdCB0YXJnZXQgPSBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnQnKS5maWx0ZXIoeyBoYXNUZXh0OiAnc291bmQgc3RhcnRzIHRvbyBlYXJseScgfSkuZmlyc3QoKVxuXHRcdGF3YWl0IHRhcmdldC5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1JlcGx5JywgZXhhY3Q6IHRydWUgfSkuY2xpY2soKVxuXHRcdGF3YWl0IHRhcmdldC5sb2NhdG9yKCd0ZXh0YXJlYScpLmZpbGwoJ2FncmVlZCwgZnJvbSBmcmFtZSA1Jylcblx0XHRhd2FpdCB0YXJnZXQubG9jYXRvcignLmRlbGl2ZXItY29tbWVudF9fcmVwbHktZm9ybScpLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnUmVwbHknIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50LS1yZXBseScpKS50b0NvbnRhaW5UZXh0KCdhZ3JlZWQsIGZyb20gZnJhbWUgNScpXG5cblx0XHQvLyBUaGUgZXhwb3J0IGNhcnJpZXMgYm90aCBDb21tZW50cyBhcyBtYXJrZXJzLCB0aGUgUmVwbHkgZm9sZGVkIGludG8gaXRzIHBhcmVudCdzIG5vdGUuXG5cdFx0Ly8gVGhlIGJyb3dzZXIgbWF5IHJ1biBpbiBhbm90aGVyIGNvbnRhaW5lciB3aGVyZSBpdHMgZG93bmxvYWRzIGFyZSBvdXQgb2YgcmVhY2gsXG5cdFx0Ly8gc28gdGhlIHRlc3QgZmV0Y2hlcyB0aGUgbGluayB0aGUgbWVudSBvZmZlcnMgd2l0aCB0aGUgcGFnZSdzIG93biBzZXNzaW9uLlxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdFeHBvcnQnIH0pLmNsaWNrKClcblx0XHRjb25zdCBsaW5rID0gcGFnZS5nZXRCeVJvbGUoJ21lbnVpdGVtJywgeyBuYW1lOiAnRURMIGZvciBEYVZpbmNpIFJlc29sdmUnIH0pXG5cdFx0Y29uc3QgcmVzcG9uc2UgPSBhd2FpdCBwYWdlLnJlcXVlc3QuZ2V0KGF3YWl0IGxpbmsuZ2V0QXR0cmlidXRlKCdocmVmJykpXG5cdFx0ZXhwZWN0KHJlc3BvbnNlLmhlYWRlcnMoKVsnY29udGVudC1kaXNwb3NpdGlvbiddKS50b01hdGNoKC9cXC5lZGxcIi8pXG5cdFx0Y29uc3QgZWRsID0gYXdhaXQgcmVzcG9uc2UudGV4dCgpXG5cdFx0ZXhwZWN0KGVkbC5tYXRjaCgvXFx8TTovZykpLnRvSGF2ZUxlbmd0aCgyKVxuXHRcdGV4cGVjdChlZGwpLnRvQ29udGFpbihgc291bmQgc3RhcnRzIHRvbyBlYXJseSAvICR7VVNFUn06IGFncmVlZCwgZnJvbSBmcmFtZSA1YClcblxuXHRcdC8vIFR5cGluZyBmaXhlcyB0aGUgRnJhbWU6IG1vdmluZyB0aGUgcGxheWVyIGFmdGVyd2FyZHMgZG9lcyBub3QgbW92ZSB0aGUgQ29tbWVudFxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ0VzY2FwZScpXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50c19fbGlzdCcpLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnMDA6MDA6MDA6MDUnLCBleGFjdDogdHJ1ZSB9KS5jbGljaygpXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcjZGVsaXZlci1jb21tZW50LWJvZHknKS5maWxsKCd0Jylcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50c19fYW5jaG9yJykpLnRvSGF2ZVRleHQoLzAwOjAwOjAwOjA1Lylcblx0XHRjb25zdCB0aW1lbGluZSA9IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX190aW1lbGluZScpXG5cdFx0Y29uc3QgYm94ID0gYXdhaXQgdGltZWxpbmUuYm91bmRpbmdCb3goKVxuXHRcdGF3YWl0IHRpbWVsaW5lLmNsaWNrKHsgcG9zaXRpb246IHsgeDogYm94LndpZHRoICogMC44LCB5OiBib3guaGVpZ2h0IC8gMiB9IH0pXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX190aW1lY29kZScpKS5ub3QudG9Db250YWluVGV4dCgnMDA6MDA6MDA6MDUnKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRzX19hbmNob3InKSkudG9IYXZlVGV4dCgvMDA6MDA6MDA6MDUvKVxuXHRcdGF3YWl0IHBhZ2UubG9jYXRvcignI2RlbGl2ZXItY29tbWVudC1ib2R5JykuZmlsbCgndHlwZWQgd2hpbGUgdGhlIHBsYXllciBtb3ZlZCBvbicpXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50c19fZm9ybSBidXR0b25bdGl0bGU9XCJTZW5kIChFbnRlcilcIl0nKS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tbWVudCcpLmZpbHRlcih7IGhhc1RleHQ6ICd0eXBlZCB3aGlsZSB0aGUgcGxheWVyIG1vdmVkIG9uJyB9KS5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50X19hbmNob3InKSkudG9IYXZlVGV4dCgnMDA6MDA6MDA6MDUnKVxuXG5cdFx0Ly8gQSByZWFjdGlvbiBzaG93cyBhcyBhIHBpbGwgd2l0aCBpdHMgY291bnQsIG1pbmUgaGlnaGxpZ2h0ZWQgKHN0b3J5IDkxKVxuXHRcdGNvbnN0IHJlYWN0ZWQgPSBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnQnKS5maWx0ZXIoeyBoYXNUZXh0OiAnc2hvcnRlbiB0aGlzIHBhc3NhZ2UnIH0pLmZpcnN0KClcblx0XHQvLyBSZWFjdCB3YWl0cyBmb3IgdGhlIHBvaW50ZXIsIGFzIG9uIEZyYW1lLmlvXG5cdFx0YXdhaXQgcGFnZS5tb3VzZS5tb3ZlKDAsIDApXG5cdFx0YXdhaXQgZXhwZWN0KHJlYWN0ZWQubG9jYXRvcignLmRlbGl2ZXItY29tbWVudF9fcmVhY3QtYXQnKS5maXJzdCgpKS50b0JlSGlkZGVuKClcblx0XHRhd2FpdCByZWFjdGVkLmhvdmVyKClcblx0XHRhd2FpdCByZWFjdGVkLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnUmVhY3QnIH0pLmZpcnN0KCkuY2xpY2soKVxuXHRcdGF3YWl0IHBhZ2UubG9jYXRvcignLmVtb2ppLW1hcnQgaW5wdXQnKS5maWxsKCd0b290aCcpXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZW1vamktbWFydCAuZW1vamktbWFydC1zY3JvbGwgLmVtb2ppLW1hcnQtZW1vamknKS5maXJzdCgpLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QocmVhY3RlZC5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50X19yZWFjdGlvbi0tbWluZScpKS50b0hhdmVUZXh0KCfwn6a3IDEnKVxuXG5cdFx0Ly8gVHlwaW5nIEAgb2ZmZXJzIHRoZSBNZW1iZXJzOyB0aGUgQ29tbWVudCBzaG93cyB0aGUgbmFtZSAoc3RvcnkgOTApXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcjZGVsaXZlci1jb21tZW50LWJvZHknKS5maWxsKCcnKVxuXHRcdGF3YWl0IHBhZ2UubG9jYXRvcignI2RlbGl2ZXItY29tbWVudC1ib2R5JykucHJlc3NTZXF1ZW50aWFsbHkoJ2xvb2sgQE1hJylcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnb3B0aW9uJywgeyBuYW1lOiAnTWFyYSBNYXRlJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignI2RlbGl2ZXItY29tbWVudC1ib2R5JykpLnRvSGF2ZVZhbHVlKGBsb29rIEAke01BVEV9IGApXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcjZGVsaXZlci1jb21tZW50LWJvZHknKS5wcmVzc1NlcXVlbnRpYWxseSgnaGVyZScpXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50c19fZm9ybSBidXR0b25bdGl0bGU9XCJTZW5kIChFbnRlcilcIl0nKS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tbWVudF9fbWVudGlvbicpLmZpcnN0KCkpLnRvSGF2ZVRleHQoJ0BNYXJhIE1hdGUnKVxuXG5cdFx0Ly8gQW4gYXR0YWNoZWQgcGljdHVyZSBzaG93cyB1bmRlciBpdHMgQ29tbWVudCAoc3RvcnkgOTIpXG5cdFx0Y29uc3QgcGl4ZWwgPSBCdWZmZXIuZnJvbSgnaVZCT1J3MEtHZ29BQUFBTlNVaEVVZ0FBQUFFQUFBQUJDQVFBQUFDMUhBd0NBQUFBQzBsRVFWUjQybU5rK0E4QUFRVUJBU2NZNDJZQUFBQUFTVVZPUks1Q1lJST0nLCAnYmFzZTY0Jylcblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRzX19mb3JtIGlucHV0W3R5cGU9ZmlsZV0nKS5zZXRJbnB1dEZpbGVzKHsgbmFtZTogJ3JlZmVyZW5jZS5wbmcnLCBtaW1lVHlwZTogJ2ltYWdlL3BuZycsIGJ1ZmZlcjogcGl4ZWwgfSlcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50c19fZmlsZXMgbGknKSkudG9IYXZlVGV4dCgncmVmZXJlbmNlLnBuZycpXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcjZGVsaXZlci1jb21tZW50LWJvZHknKS5maWxsKCdsaWtlIHRoaXMnKVxuXHRcdGF3YWl0IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tbWVudHNfX2Zvcm0gYnV0dG9uW3RpdGxlPVwiU2VuZCAoRW50ZXIpXCJdJykuY2xpY2soKVxuXHRcdGNvbnN0IHBpY3R1cmUgPSBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnQnKS5maWx0ZXIoeyBoYXNUZXh0OiAnbGlrZSB0aGlzJyB9KS5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50X19hdHRhY2htZW50cyBpbWcnKVxuXHRcdGF3YWl0IGV4cGVjdChwaWN0dXJlKS50b0hhdmVKU1Byb3BlcnR5KCduYXR1cmFsV2lkdGgnLCAxKVxuXG5cdFx0Ly8gQSBkcmF3aW5nIGdvZXMgd2l0aCB0aGUgQ29tbWVudCBhbmQgc2hvd3Mgd2hpbGUgdGhlIHBsYXllciBzdGFuZHMgb24gaXQgKHN0b3J5IDg5KVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdEcmF3IG9uIHRoZSBwaWN0dXJlJyB9KS5jbGljaygpXG5cdFx0Y29uc3Qgc3RhZ2UgPSBhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fc3RhZ2UnKS5ib3VuZGluZ0JveCgpXG5cdFx0YXdhaXQgcGFnZS5tb3VzZS5tb3ZlKHN0YWdlLnggKyBzdGFnZS53aWR0aCAqIDAuMywgc3RhZ2UueSArIHN0YWdlLmhlaWdodCAqIDAuMylcblx0XHRhd2FpdCBwYWdlLm1vdXNlLmRvd24oKVxuXHRcdGF3YWl0IHBhZ2UubW91c2UubW92ZShzdGFnZS54ICsgc3RhZ2Uud2lkdGggKiAwLjYsIHN0YWdlLnkgKyBzdGFnZS5oZWlnaHQgKiAwLjUsIHsgc3RlcHM6IDggfSlcblx0XHRhd2FpdCBwYWdlLm1vdXNlLnVwKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50c19fZHJhd24nKSkudG9IYXZlVGV4dCgnMSBzaGFwZSBkcmF3bicpXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcjZGVsaXZlci1jb21tZW50LWJvZHknKS5maWxsKCd0aGlzIGNvcm5lcicpXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50c19fZm9ybSBidXR0b25bdGl0bGU9XCJTZW5kIChFbnRlcilcIl0nKS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tbWVudCcpLmZpbHRlcih7IGhhc1RleHQ6ICd0aGlzIGNvcm5lcicgfSkpLnRvQmVWaXNpYmxlKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1kcmF3aW5nIHBhdGgnKSkudG9IYXZlQ291bnQoMSlcblxuXHRcdC8vIEEgRHVlIERhdGUgc2V0IGluIHRoZSBoZWFkZXIgc2hvd3MgdGhlcmUgKHN0b3J5IDkzKVxuXHRcdGF3YWl0IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItZHVlX19idXR0b24nKS5jbGljaygpXG5cdFx0Y29uc3QgZHVlID0gcGFnZS5nZXRCeVJvbGUoJ2RpYWxvZycsIHsgbmFtZTogJ0R1ZSBEYXRlJyB9KVxuXHRcdGF3YWl0IGR1ZS5nZXRCeUxhYmVsKCdEdWUgRGF0ZScpLmZpbGwoJzIwMzAtMDEtMzEnKVxuXHRcdGF3YWl0IGR1ZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1NhdmUnIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1kdWUnKSkudG9Db250YWluVGV4dCgnRHVlJylcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1kdWVfX2NsZWFyJykpLnRvQmVWaXNpYmxlKClcblxuXHRcdC8vIEFwcHJvdmluZyBzaG93cyB0aGUgZGVjaXNpb24gbmV4dCB0byB0aGUgbWVudSAoc3RvcnkgODgpXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1hcHByb3ZhbF9fbWVudSBidXR0b24nKS5jbGljaygpXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ21lbnVpdGVtcmFkaW8nLCB7IG5hbWU6ICdBcHByb3ZlIHRoaXMgVmVyc2lvbicgfSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWFwcHJvdmFsX19wZW9wbGUgbGknKSkudG9IYXZlQ291bnQoMSlcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1hcHByb3ZhbF9fbWVudSBidXR0b24nKSkudG9Db250YWluVGV4dCgnQXBwcm92ZWQnKVxuXHR9KVxuXG5cdHRlc3QoJ2NvbXBhcmVzIHR3byBWZXJzaW9ucyBpbiBzdGVwJywgYXN5bmMgKHsgcGxheXdyaWdodCB9KSA9PiB7XG5cdFx0Y29uc3QgYXBpID0gYXdhaXQgcGxheXdyaWdodC5yZXF1ZXN0Lm5ld0NvbnRleHQoeyBiYXNlVVJMOiBVUkwsIGh0dHBDcmVkZW50aWFsczogYXV0aCwgZXh0cmFIVFRQSGVhZGVyczogb2NzSGVhZGVycyB9KVxuXHRcdGV4cGVjdCgoYXdhaXQgYXBpLmZldGNoKGAvcmVtb3RlLnBocC9kYXYvZmlsZXMvJHtVU0VSfS8ke2ZvbGRlcn0vY2xpcF92Mi53ZWJtYCwgeyBtZXRob2Q6ICdQVVQnLCBkYXRhOiByZWFkRmlsZVN5bmMoQ0xJUCkgfSkpLnN0YXR1cygpKS50b0JlKDIwMSlcblx0XHRjb25zdCBwcm9qZWN0ID0gYXdhaXQgKGF3YWl0IGFwaS5nZXQoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHMvJHtwcm9qZWN0SWR9P2Zvcm1hdD1qc29uYCkpLmpzb24oKVxuXHRcdGF3YWl0IGFwaS5kaXNwb3NlKClcblx0XHRjb25zdCBzdGFjayA9IHByb2plY3Qub2NzLmRhdGEuYXNzZXRzWzBdLnZlcnNpb25zXG5cdFx0ZXhwZWN0KHN0YWNrKS50b0hhdmVMZW5ndGgoMilcblxuXHRcdGF3YWl0IHBhZ2UuZ290byhgL2FwcHMvZGVsaXZlci9jb21wYXJlLyR7c3RhY2tbMV0uaWR9LyR7c3RhY2tbMF0uaWR9YClcblx0XHRjb25zdCB2aWRlb3MgPSBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbXBhcmUgdmlkZW8nKVxuXHRcdGF3YWl0IGV4cGVjdCh2aWRlb3MpLnRvSGF2ZUNvdW50KDIpXG5cdFx0YXdhaXQgZXhwZWN0KHZpZGVvcy5maXJzdCgpKS50b0hhdmVKU1Byb3BlcnR5KCdyZWFkeVN0YXRlJywgNClcblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWxheW91dF9fYmFyIGgyJykuY2xpY2soKVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ0Fycm93UmlnaHQnKVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ0Fycm93UmlnaHQnKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbXBhcmVfX3RpbWVjb2RlJykpLnRvQ29udGFpblRleHQoJzAwOjAwOjAwOjAyJylcblx0XHQvLyBCIGZvbGxvd3MgQSB0byB0aGUgc2FtZSBGcmFtZVxuXHRcdGNvbnN0IHRpbWVzID0gYXdhaXQgdmlkZW9zLmV2YWx1YXRlQWxsKChhbGwpID0+IGFsbC5tYXAoKHZpZGVvKSA9PiB2aWRlby5jdXJyZW50VGltZSkpXG5cdFx0ZXhwZWN0KHRpbWVzWzFdKS50b0JlQ2xvc2VUbyh0aW1lc1swXSwgMylcblxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdyYWRpbycsIHsgbmFtZTogJ1dpcGUnIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21wYXJlX19oYW5kbGUnKSkudG9CZVZpc2libGUoKVxuXHR9KVxuXG5cdHRlc3QoJ29uIGEgcGhvbmU6IHN0YWNrZWQsIGJ5IHRvdWNoLCBhbmQgYSBSZXZpZXdlciBjb21tZW50cyBvbiBhIFJhbmdlJywgYXN5bmMgKHsgcGxheXdyaWdodCB9KSA9PiB7XG5cdFx0Y29uc3QgcGhvbmUgPSBhd2FpdCBicm93c2VyLm5ld0NvbnRleHQoeyBiYXNlVVJMOiBCUk9XU0VSX1VSTCwgLi4uUEhPTkUgfSlcblx0XHRjb25zdCBwYWdlID0gYXdhaXQgcGhvbmUubmV3UGFnZSgpXG5cdFx0YXdhaXQgbG9naW4ocGFnZSlcblx0XHRhd2FpdCBwYWdlLmdvdG8oYC9hcHBzL2RlbGl2ZXIvcHJvamVjdHMvJHtwcm9qZWN0SWR9YClcblx0XHQvLyBBIGNhcmQncyBtZW51IGhhcyBhIGJ1dHRvbiBvZiBpdHMgb3duIG9uIGEgcGhvbmUsIHdpdGggdGhlIER1ZSBEYXRlIGluIGl0XG5cdFx0Y29uc3QgY2xpcCA9IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY2FyZCcsIHsgaGFzVGV4dDogJ2NsaXAnIH0pXG5cdFx0YXdhaXQgY2xpcC5sb2NhdG9yKCcuZGVsaXZlci1jYXJkX19tb3JlJykudGFwKClcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnbWVudWl0ZW0nLCB7IG5hbWU6IC9EdWUgRGF0ZS8gfSkudGFwKClcblx0XHRjb25zdCBkdWUgPSBwYWdlLmdldEJ5Um9sZSgnZGlhbG9nJywgeyBuYW1lOiAnRHVlIERhdGUnIH0pXG5cdFx0YXdhaXQgZHVlLmdldEJ5TGFiZWwoJ0R1ZSBEYXRlJykuZmlsbCgnMjAzMC0wMi0yMCcpXG5cdFx0YXdhaXQgZHVlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnU2F2ZScgfSkudGFwKClcblx0XHRhd2FpdCBleHBlY3QoY2xpcC5sb2NhdG9yKCcuZGVsaXZlci1jYXJkX19kdWUnKSkudG9Db250YWluVGV4dCgnMjAnKVxuXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jYXJkX19tb3JlJykuZmlyc3QoKS50YXAoKVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdtZW51aXRlbScsIHsgbmFtZTogJ09wZW4nLCBleGFjdDogdHJ1ZSB9KS50YXAoKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoL1xcL3ZlcnNpb25zXFwvXFxkKyQvKVxuXHRcdGNvbnN0IHZpZGVvID0gcGFnZS5sb2NhdG9yKCd2aWRlby5kZWxpdmVyLXBsYXllcl9fdmlkZW8nKVxuXHRcdGF3YWl0IGV4cGVjdCh2aWRlbykudG9IYXZlSlNQcm9wZXJ0eSgncmVhZHlTdGF0ZScsIDQpXG5cblx0XHQvLyBVcHJpZ2h0LCBvbmx5IHRoZSBmaWVsZCBzaXRzIHVuZGVyIHRoZSBwaWN0dXJlLCB3aXRob3V0IE5leHRjbG91ZCdzIGhlYWRlcjsgdGhlIGxpc3QgcHVsbHMgdXAgaW4gaXRzIHBsYWNlXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignI2hlYWRlcicpKS50b0JlSGlkZGVuKClcblx0XHRjb25zdCBzdGFnZSA9IGF3YWl0IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX19zdGFnZScpLmJvdW5kaW5nQm94KClcblx0XHRjb25zdCBwYW5lbCA9IGF3YWl0IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItbGF5b3V0X19wYW5lbCcpLmJvdW5kaW5nQm94KClcblx0XHRleHBlY3QocGFuZWwueSkudG9CZUdyZWF0ZXJUaGFuT3JFcXVhbChzdGFnZS55ICsgc3RhZ2UuaGVpZ2h0KVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRzX19oZWFkJykpLnRvQmVIaWRkZW4oKVxuXHRcdC8vIEhhbGZ3YXkgYSAxNjo5IHBpY3R1cmUgZml0cyBhYm92ZSB0aGUgbGlzdCwgdGhlbiB0aGUgbGlzdCB0YWtlcyBpdHMgcGxhY2Vcblx0XHRjb25zdCBncmFiYmVyID0gcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1sYXlvdXRfX2dyYWJiZXInKVxuXHRcdGF3YWl0IGdyYWJiZXIudGFwKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1sYXlvdXQtLW1pZGRsZScpKS50b0hhdmVDb3VudCgxKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRzX19oZWFkJykpLnRvQmVWaXNpYmxlKClcblx0XHRleHBlY3QoKGF3YWl0IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX19zdGFnZScpLmJvdW5kaW5nQm94KCkpLmhlaWdodCkudG9CZUNsb3NlVG8oMzkwICogOSAvIDE2LCAwKVxuXHRcdGF3YWl0IGdyYWJiZXIudGFwKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1sYXlvdXQtLXVwJykpLnRvSGF2ZUNvdW50KDEpXG5cdFx0Ly8gQSBzdHJva2UgZG93biBnb2VzIGJhY2sgYSBsZXZlbCBhdCBhIHRpbWVcblx0XHRmb3IgKGNvbnN0IGxldmVsIG9mIFsnbWlkZGxlJywgJ2Rvd24nXSkge1xuXHRcdFx0Y29uc3QgYm94ID0gYXdhaXQgZ3JhYmJlci5ib3VuZGluZ0JveCgpXG5cdFx0XHRhd2FpdCBwYWdlLm1vdXNlLm1vdmUoYm94LnggKyBib3gud2lkdGggLyAyLCBib3gueSArIGJveC5oZWlnaHQgLyAyKVxuXHRcdFx0YXdhaXQgcGFnZS5tb3VzZS5kb3duKClcblx0XHRcdGF3YWl0IHBhZ2UubW91c2UubW92ZShib3gueCArIGJveC53aWR0aCAvIDIsIGJveC55ICsgYm94LmhlaWdodCAvIDIgKyA4MClcblx0XHRcdGF3YWl0IHBhZ2UubW91c2UudXAoKVxuXHRcdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihgLmRlbGl2ZXItbGF5b3V0LS0ke2xldmVsfWApKS50b0hhdmVDb3VudCgxKVxuXHRcdH1cblxuXHRcdC8vIEEgdGFwIG9uIHRoZSB0aW1lbGluZSBzZWVrcyBhbmQgbGVhdmVzIG5vIHRodW1ibmFpbCBiZWhpbmRcblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fdGltZWxpbmUnKS50YXAoKVxuXHRcdGF3YWl0IHBhZ2Uud2FpdEZvclRpbWVvdXQoMzAwKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9faG92ZXInKSkudG9CZUhpZGRlbigpXG5cblx0XHQvLyBBIGRvdWJsZSB0YXAgb24gdGhlIHJpZ2h0IGp1bXBzIGFoZWFkLCBhIHRhcCBnb2VzIGZ1bGxzY3JlZW5cblx0XHRjb25zdCByaWdodCA9IHsgeDogc3RhZ2UueCArIHN0YWdlLndpZHRoICogMC44NSwgeTogc3RhZ2UueSArIHN0YWdlLmhlaWdodCAvIDIgfVxuXHRcdGF3YWl0IHBhZ2UudG91Y2hzY3JlZW4udGFwKHJpZ2h0LngsIHJpZ2h0LnkpXG5cdFx0YXdhaXQgcGFnZS50b3VjaHNjcmVlbi50YXAocmlnaHQueCwgcmlnaHQueSlcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX2ZsYXNoJykpLnRvQ29udGFpblRleHQoJysxMCcpXG5cdFx0YXdhaXQgcGFnZS53YWl0Rm9yVGltZW91dCg3MDApXG5cdFx0YXdhaXQgcGFnZS50b3VjaHNjcmVlbi50YXAoc3RhZ2UueCArIHN0YWdlLndpZHRoIC8gMiwgcmlnaHQueSlcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXItLWZ1bGxzY3JlZW4nKSkudG9IYXZlQ291bnQoMSlcblx0XHRhd2FpdCBwYWdlLndhaXRGb3JUaW1lb3V0KDcwMClcblx0XHRhd2FpdCBwYWdlLnRvdWNoc2NyZWVuLnRhcChzdGFnZS54ICsgc3RhZ2Uud2lkdGggLyAyLCByaWdodC55KVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllci0tZnVsbHNjcmVlbicpKS50b0hhdmVDb3VudCgwKVxuXG5cdFx0Ly8gU2lkZXdheXMsIHRoZSBwaWN0dXJlIGZpbGxzIHRoZSB3aW5kb3cgYW5kIHRoZSBsaXN0IG9wZW5zIGJlc2lkZSBpdFxuXHRcdGF3YWl0IHBhZ2Uuc2V0Vmlld3BvcnRTaXplKHsgd2lkdGg6IFBIT05FLnZpZXdwb3J0LmhlaWdodCwgaGVpZ2h0OiBQSE9ORS52aWV3cG9ydC53aWR0aCB9KVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWxheW91dF9fYmFyJykpLnRvSGF2ZUNvdW50KDApXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItbGF5b3V0X19wYW5lbCcpKS50b0JlSGlkZGVuKClcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnU2hvdyBDb21tZW50cycgfSkudGFwKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50c19faGVhZCcpKS50b0JlVmlzaWJsZSgpXG5cdFx0YXdhaXQgcGhvbmUuY2xvc2UoKVxuXG5cdFx0Ly8gQSBSZXZpZXdlciBvbiBhIHBob25lOiBuYW1lIGZpcnN0LCB0aGVuIGEgUmFuZ2UgYnkgaXRzIGJ1dHRvblxuXHRcdGNvbnN0IGFwaSA9IGF3YWl0IHBsYXl3cmlnaHQucmVxdWVzdC5uZXdDb250ZXh0KHsgYmFzZVVSTDogVVJMLCBodHRwQ3JlZGVudGlhbHM6IGF1dGgsIGV4dHJhSFRUUEhlYWRlcnM6IG9jc0hlYWRlcnMgfSlcblx0XHRjb25zdCBsaW5rID0gKGF3YWl0IChhd2FpdCBhcGkucG9zdChgL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS9wcm9qZWN0cy8ke3Byb2plY3RJZH0vbGlua3M/Zm9ybWF0PWpzb25gKSkuanNvbigpKS5vY3MuZGF0YVxuXHRcdC8vIE9ubHkgdGhlIG5ld2VzdCBWZXJzaW9uIHRha2VzIENvbW1lbnRzIG9uIHRoaXMgbGlua1xuXHRcdGNvbnN0IHByb2plY3QgPSBhd2FpdCAoYXdhaXQgYXBpLmdldChgL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS9wcm9qZWN0cy8ke3Byb2plY3RJZH0/Zm9ybWF0PWpzb25gKSkuanNvbigpXG5cdFx0Y29uc3QgbmV3ZXN0ID0gcHJvamVjdC5vY3MuZGF0YS5hc3NldHMuZmluZCgoYXNzZXQpID0+IGFzc2V0LnZlcnNpb25zLnNvbWUoKHZlcnNpb24pID0+IHZlcnNpb24uaWQgPT09IHZlcnNpb25JZCkpLnZlcnNpb25zWzBdLmlkXG5cdFx0YXdhaXQgYXBpLmRpc3Bvc2UoKVxuXHRcdGNvbnN0IGd1ZXN0ID0gYXdhaXQgYnJvd3Nlci5uZXdDb250ZXh0KHsgYmFzZVVSTDogQlJPV1NFUl9VUkwsIC4uLlBIT05FIH0pXG5cdFx0Y29uc3QgcmV2aWV3ZXIgPSBhd2FpdCBndWVzdC5uZXdQYWdlKClcblx0XHRhd2FpdCByZXZpZXdlci5nb3RvKGAvYXBwcy9kZWxpdmVyL3MvJHtsaW5rLnRva2VufS92ZXJzaW9ucy8ke25ld2VzdH1gKVxuXHRcdGF3YWl0IHJldmlld2VyLmxvY2F0b3IoJyNkZWxpdmVyLXJldmlld2VyLW5hbWUnKS5maWxsKCdQaWEnKVxuXHRcdGF3YWl0IHJldmlld2VyLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnU3RhcnQgcmV2aWV3aW5nJyB9KS50YXAoKVxuXHRcdGF3YWl0IGV4cGVjdChyZXZpZXdlci5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50c19fZ2F0ZScpKS50b0hhdmVDb3VudCgwKVxuXHRcdC8vIFRoZSBjb21wb3NlcidzIHRvb2xzIHNpdCBpbiBpdHMgbWVudVxuXHRcdGNvbnN0IG9wdGlvbnMgPSByZXZpZXdlci5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ0NvbW1lbnQgb3B0aW9ucycgfSlcblx0XHRhd2FpdCBvcHRpb25zLnRhcCgpXG5cdFx0YXdhaXQgcmV2aWV3ZXIuZ2V0QnlSb2xlKCdtZW51aXRlbScsIHsgbmFtZTogJ1N0YXJ0IGEgUmFuZ2UgaGVyZScgfSkudGFwKClcblx0XHRmb3IgKGxldCBpID0gMDsgaSA8IDM7IGkrKykge1xuXHRcdFx0YXdhaXQgcmV2aWV3ZXIuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdPbmUgRnJhbWUgZm9yd2FyZCcgfSkudGFwKClcblx0XHR9XG5cdFx0YXdhaXQgb3B0aW9ucy50YXAoKVxuXHRcdGF3YWl0IHJldmlld2VyLmdldEJ5Um9sZSgnbWVudWl0ZW0nLCB7IG5hbWU6ICdFbmQgdGhlIFJhbmdlIGhlcmUnIH0pLnRhcCgpXG5cdFx0YXdhaXQgZXhwZWN0KHJldmlld2VyLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRzX19hbmNob3InKSkudG9Db250YWluVGV4dCgn4oCTJylcblx0XHRhd2FpdCByZXZpZXdlci5sb2NhdG9yKCcjZGVsaXZlci1jb21tZW50LWJvZHknKS5maWxsKCdvbiB0aGUgcGhvbmUnKVxuXHRcdGF3YWl0IHJldmlld2VyLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnU2VuZCAoRW50ZXIpJyB9KS50YXAoKVxuXHRcdGF3YWl0IGV4cGVjdChyZXZpZXdlci5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50JykuZmlsdGVyKHsgaGFzVGV4dDogJ29uIHRoZSBwaG9uZScgfSkpLnRvQ29udGFpblRleHQoJ1BpYScpXG5cdFx0Ly8gQSB0YXAgb24gaXRzIG1hcmtlciBvcGVucyB0aGUgQ29tbWVudCBvbiB0aGUgcGljdHVyZVxuXHRcdGF3YWl0IHJldmlld2VyLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fbWFya2VyW2FyaWEtbGFiZWxePVwiUGlhXCJdJykudGFwKHsgZm9yY2U6IHRydWUgfSlcblx0XHRhd2FpdCBleHBlY3QocmV2aWV3ZXIubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX19wZWVrLS10YXBwZWQnKSkudG9Db250YWluVGV4dCgnb24gdGhlIHBob25lJylcblx0XHQvLyBBIHRhcCBvbiB0aGUgcGljdHVyZSB0aGVuIG9ubHkgY2xvc2VzIGl0XG5cdFx0YXdhaXQgcmV2aWV3ZXIud2FpdEZvclRpbWVvdXQoNzAwKVxuXHRcdGF3YWl0IHJldmlld2VyLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fc3RhZ2UnKS50YXAoeyBwb3NpdGlvbjogeyB4OiA0MCwgeTogNDAgfSB9KVxuXHRcdGF3YWl0IGV4cGVjdChyZXZpZXdlci5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX3BlZWsnKSkudG9IYXZlQ291bnQoMClcblx0XHRhd2FpdCByZXZpZXdlci53YWl0Rm9yVGltZW91dCg3MDApXG5cdFx0YXdhaXQgZXhwZWN0KHJldmlld2VyLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllci0tZnVsbHNjcmVlbicpKS50b0hhdmVDb3VudCgwKVxuXHRcdGF3YWl0IGd1ZXN0LmNsb3NlKClcblx0fSlcblxuXHR0ZXN0KCdhIFJldmlld2VyIG5hbWVzIHRoZW1zZWx2ZXMgYW5kIGNvbW1lbnRzIHRocm91Z2ggYSBSZXZpZXcgTGluaycsIGFzeW5jICh7IHBsYXl3cmlnaHQgfSkgPT4ge1xuXHRcdGNvbnN0IGFwaSA9IGF3YWl0IHBsYXl3cmlnaHQucmVxdWVzdC5uZXdDb250ZXh0KHsgYmFzZVVSTDogVVJMLCBodHRwQ3JlZGVudGlhbHM6IGF1dGgsIGV4dHJhSFRUUEhlYWRlcnM6IG9jc0hlYWRlcnMgfSlcblx0XHRjb25zdCBsaW5rID0gKGF3YWl0IChhd2FpdCBhcGkucG9zdChgL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS9wcm9qZWN0cy8ke3Byb2plY3RJZH0vbGlua3M/Zm9ybWF0PWpzb25gKSkuanNvbigpKS5vY3MuZGF0YVxuXHRcdC8vIE9ubHkgdGhlIG5ld2VzdCBWZXJzaW9uIHRha2VzIENvbW1lbnRzIG9uIHRoaXMgbGlua1xuXHRcdGNvbnN0IHByb2plY3QgPSBhd2FpdCAoYXdhaXQgYXBpLmdldChgL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS9wcm9qZWN0cy8ke3Byb2plY3RJZH0/Zm9ybWF0PWpzb25gKSkuanNvbigpXG5cdFx0Y29uc3QgbmV3ZXN0ID0gcHJvamVjdC5vY3MuZGF0YS5hc3NldHNbMF0udmVyc2lvbnNbMF0uaWRcblx0XHRhd2FpdCBhcGkuZGlzcG9zZSgpXG5cblx0XHQvLyBBIGJyb3dzZXIgdGhhdCBoYXMgbmV2ZXIgYmVlbiBoZXJlXG5cdFx0Y29uc3QgdmlzaXRvciA9IGF3YWl0IGJyb3dzZXIubmV3Q29udGV4dCh7IGJhc2VVUkw6IEJST1dTRVJfVVJMIH0pXG5cdFx0Y29uc3QgcmV2aWV3ZXIgPSBhd2FpdCB2aXNpdG9yLm5ld1BhZ2UoKVxuXHRcdGF3YWl0IHJldmlld2VyLmdvdG8oYC9hcHBzL2RlbGl2ZXIvcy8ke2xpbmsudG9rZW59L3ZlcnNpb25zLyR7bmV3ZXN0fWApXG5cdFx0Ly8gVGhlIG5hbWUgY29tZXMgZmlyc3QsIG92ZXIgdGhlIENvbW1lbnRzOyB3aXRoIGFuIGFkZHJlc3MgY29tZSB0aGUgbWFpbCB3aXNoZXNcblx0XHRhd2FpdCBleHBlY3QocmV2aWV3ZXIubG9jYXRvcignLmRlbGl2ZXItY29tbWVudHNfX2dhdGUnKSkudG9CZVZpc2libGUoKVxuXHRcdGF3YWl0IHJldmlld2VyLmxvY2F0b3IoJyNkZWxpdmVyLXJldmlld2VyLW5hbWUnKS5maWxsKCdNYXJhJylcblx0XHRhd2FpdCByZXZpZXdlci5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50c19fY2xhaW0gaW5wdXRbdHlwZT1lbWFpbF0nKS5maWxsKCdtYXJhQGV4YW1wbGUudGVzdCcpXG5cdFx0YXdhaXQgcmV2aWV3ZXIuZ2V0QnlUZXh0KCdOZXcgVmVyc2lvbnMnKS5jbGljaygpXG5cdFx0YXdhaXQgcmV2aWV3ZXIuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdTdGFydCByZXZpZXdpbmcnIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QocmV2aWV3ZXIubG9jYXRvcignLmRlbGl2ZXItY29tbWVudHNfX2dhdGUnKSkudG9IYXZlQ291bnQoMClcblx0XHRhd2FpdCByZXZpZXdlci5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1Jldmlld2luZyBhcyBNYXJhJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KHJldmlld2VyLmdldEJ5Um9sZSgnY2hlY2tib3gnLCB7IG5hbWU6ICdOZXcgVmVyc2lvbnMnIH0pKS50b0JlQ2hlY2tlZCgpXG5cdFx0Ly8gVGhlaXIgUGVyc29uYWwgTGluaywgdG8gYmUgTWFyYSBvbiBhbm90aGVyIGRldmljZSAoc3RvcnkgMTI4KVxuXHRcdGF3YWl0IHJldmlld2VyLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnQ29weSBQZXJzb25hbCBMaW5rJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KHJldmlld2VyLmdldEJ5VGV4dCgnUGVyc29uYWwgTGluayBjb3BpZWQnLCB7IGV4YWN0OiB0cnVlIH0pKS50b0JlVmlzaWJsZSgpXG5cdFx0YXdhaXQgcmV2aWV3ZXIua2V5Ym9hcmQucHJlc3MoJ0VzY2FwZScpXG5cdFx0YXdhaXQgcmV2aWV3ZXIubG9jYXRvcignI2RlbGl2ZXItY29tbWVudC1ib2R5JykuZmlsbCgnZnJvbSB0aGUgY2xpZW50Jylcblx0XHRhd2FpdCByZXZpZXdlci5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50c19fZm9ybSBidXR0b25bdGl0bGU9XCJTZW5kIChFbnRlcilcIl0nKS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KHJldmlld2VyLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnQnKS5maWx0ZXIoeyBoYXNUZXh0OiAnZnJvbSB0aGUgY2xpZW50JyB9KSkudG9Db250YWluVGV4dCgnTWFyYScpXG5cdFx0YXdhaXQgdmlzaXRvci5jbG9zZSgpXG5cdH0pXG5cblx0dGVzdCgndGhlIG5hdmlnYXRpb24gbGlzdHMgYSBjb2xsZWFndWVcXCdzIGxpbmsgYW5kIHNheXMgd2hvIG1hZGUgaXQnLCBhc3luYyAoeyBwbGF5d3JpZ2h0IH0pID0+IHtcblx0XHRjb25zdCBtYXRlID0gYXdhaXQgcGxheXdyaWdodC5yZXF1ZXN0Lm5ld0NvbnRleHQoeyBiYXNlVVJMOiBVUkwsIGh0dHBDcmVkZW50aWFsczogeyB1c2VybmFtZTogTUFURSwgcGFzc3dvcmQ6IE1BVEVfUEFTU1dPUkQsIHNlbmQ6ICdhbHdheXMnIH0sIGV4dHJhSFRUUEhlYWRlcnM6IG9jc0hlYWRlcnMgfSlcblx0XHQvLyBSZWFkaW5nIGFuZCByZXNoYXJpbmcgaW4gRmlsZXMgaXMgbm90IFNoYXJlIGluIERlbGl2ZXI6IHRoZSBvd25lciBzd2l0Y2hlcyBpdCBvblxuXHRcdGNvbnN0IG93bmVyID0gYXdhaXQgcGxheXdyaWdodC5yZXF1ZXN0Lm5ld0NvbnRleHQoeyBiYXNlVVJMOiBVUkwsIGh0dHBDcmVkZW50aWFsczogYXV0aCwgZXh0cmFIVFRQSGVhZGVyczogb2NzSGVhZGVycyB9KVxuXHRcdGNvbnN0IG1lbWJlcnMgPSBgL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS9wcm9qZWN0cy8ke3Byb2plY3RJZH0vbWVtYmVycz9mb3JtYXQ9anNvbmBcblx0XHRleHBlY3QoKGF3YWl0IG1hdGUucG9zdChgL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS9wcm9qZWN0cy8ke3Byb2plY3RJZH0vbGlua3M/Zm9ybWF0PWpzb25gKSkuc3RhdHVzKCkpLnRvQmUoNDAzKVxuXHRcdGV4cGVjdCgoYXdhaXQgb3duZXIucHV0KG1lbWJlcnMsIHsgZGF0YTogeyB0eXBlOiAndXNlcicsIHByaW5jaXBhbDogTUFURSwgbGV2ZWw6ICdjb21tZW50Jywgc2hhcmU6IHRydWUsIGFwcHJvdmU6IGZhbHNlIH0gfSkpLnN0YXR1cygpKS50b0JlKDIwMClcblx0XHRjb25zdCBtYWRlID0gYXdhaXQgbWF0ZS5wb3N0KGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3Byb2plY3RzLyR7cHJvamVjdElkfS9saW5rcz9mb3JtYXQ9anNvbmAsIHsgZGF0YTogeyBsYWJlbDogJ0NvbGxlYWd1ZSBsaW5rJyB9IH0pXG5cdFx0ZXhwZWN0KG1hZGUuc3RhdHVzKCkpLnRvQmUoMjAxKVxuXHRcdGNvbnN0IGxpbmsgPSAoYXdhaXQgbWFkZS5qc29uKCkpLm9jcy5kYXRhXG5cdFx0YXdhaXQgbWF0ZS5wdXQoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvbGlua3MvJHtsaW5rLmlkfT9mb3JtYXQ9anNvbmAsIHsgZGF0YTogeyBsYWJlbDogJ01hcmFcXCdzIGxpbmsnIH0gfSlcblx0XHR0cnkge1xuXHRcdFx0YXdhaXQgcGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL3Byb2plY3RzLyR7cHJvamVjdElkfWApXG5cdFx0XHRjb25zdCB0aGVpcnMgPSBwYWdlLmxvY2F0b3IoJy5hcHAtbmF2aWdhdGlvbiBsaScpLmZpbHRlcih7IGhhc1RleHQ6ICdNYXJhXFwncyBsaW5rJyB9KS5maXJzdCgpXG5cdFx0XHRhd2FpdCBleHBlY3QodGhlaXJzKS50b0NvbnRhaW5UZXh0KCdNYWRlIGJ5IE1hcmEgTWF0ZScpXG5cdFx0XHQvLyBUaGVpciBsaW5rLCB0aG91Z2gsIGlzIG5vdCBtYXJrZWQgYXMgbWFkZSBieSBzb21lb25lIGVsc2Vcblx0XHRcdGF3YWl0IHBhZ2UubG9jYXRvcignLmFwcC1uYXZpZ2F0aW9uJykuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdDcmVhdGUgUmV2aWV3IExpbmsnIH0pLmNsaWNrKClcblx0XHRcdGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5Um9sZSgnZGlhbG9nJykpLnRvQmVWaXNpYmxlKClcblx0XHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ0VzY2FwZScpXG5cdFx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuYXBwLW5hdmlnYXRpb24nKS5nZXRCeVRleHQoJ01hZGUgYnkgZGVsaXZlci1lMmUnLCB7IGV4YWN0OiB0cnVlIH0pKS50b0hhdmVDb3VudCgwKVxuXHRcdH0gZmluYWxseSB7XG5cdFx0XHRhd2FpdCBtYXRlLmRlbGV0ZShgL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS9saW5rcy8ke2xpbmsuaWR9P2Zvcm1hdD1qc29uYClcblx0XHRcdGF3YWl0IG93bmVyLmRlbGV0ZShtZW1iZXJzICsgYCZ0eXBlPXVzZXImcHJpbmNpcGFsPSR7TUFURX1gKVxuXHRcdFx0YXdhaXQgbWF0ZS5kaXNwb3NlKClcblx0XHRcdGF3YWl0IG93bmVyLmRpc3Bvc2UoKVxuXHRcdH1cblx0fSlcblxuXHR0ZXN0KCd0aGUgUHJvamVjdCBzZXR0aW5ncyBsaXN0IHRoZSBNZW1iZXJzIGFuZCBzZXQgd2hhdCBlYWNoIG1heSBkbycsIGFzeW5jICh7IHBsYXl3cmlnaHQgfSkgPT4ge1xuXHRcdGNvbnN0IG93bmVyID0gYXdhaXQgcGxheXdyaWdodC5yZXF1ZXN0Lm5ld0NvbnRleHQoeyBiYXNlVVJMOiBVUkwsIGh0dHBDcmVkZW50aWFsczogYXV0aCwgZXh0cmFIVFRQSGVhZGVyczogb2NzSGVhZGVycyB9KVxuXHRcdGNvbnN0IGFwaSA9IGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3Byb2plY3RzLyR7cHJvamVjdElkfWBcblx0XHRjb25zdCBsaXN0ZWQgPSBhc3luYyAoKSA9PiAoYXdhaXQgKGF3YWl0IG93bmVyLmdldChgJHthcGl9L21lbWJlcnM/Zm9ybWF0PWpzb25gKSkuanNvbigpKS5vY3MuZGF0YS5maW5kKChlYWNoKSA9PiBlYWNoLmlkID09PSBNQVRFKVxuXHRcdHRyeSB7XG5cdFx0XHRhd2FpdCBwYWdlLmdvdG8oYC9hcHBzL2RlbGl2ZXIvcHJvamVjdHMvJHtwcm9qZWN0SWR9YClcblx0XHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdQcm9qZWN0IHNldHRpbmdzJyB9KS5jbGljaygpXG5cdFx0XHRjb25zdCBkaWFsb2cgPSBwYWdlLmdldEJ5Um9sZSgnZGlhbG9nJylcblx0XHRcdGNvbnN0IG1hdGUgPSBkaWFsb2cubG9jYXRvcignLmRlbGl2ZXItbWVtYmVyc19fcm93JywgeyBoYXNUZXh0OiAnTWFyYSBNYXRlJyB9KVxuXHRcdFx0Y29uc3QgbGV2ZWwgPSBtYXRlLmdldEJ5TGFiZWwoJ0FjY2VzcyBsZXZlbCBvZiBNYXJhIE1hdGUnKVxuXHRcdFx0Ly8gUmVhZCBhY2Nlc3MgaW4gRmlsZXMgZ2l2ZXMgQ29tbWVudCwgYW5kIG5vIEFwcHJvdmVcblx0XHRcdGF3YWl0IGV4cGVjdChsZXZlbCkudG9IYXZlVmFsdWUoJ2NvbW1lbnQnKVxuXHRcdFx0YXdhaXQgZXhwZWN0KG1hdGUuZ2V0QnlSb2xlKCdjaGVja2JveCcsIHsgbmFtZTogJ0FwcHJvdmUnIH0pKS5ub3QudG9CZUNoZWNrZWQoKVxuXG5cdFx0XHRhd2FpdCBtYXRlLmdldEJ5VGV4dCgnQXBwcm92ZScsIHsgZXhhY3Q6IHRydWUgfSkuY2xpY2soKVxuXHRcdFx0YXdhaXQgZXhwZWN0LnBvbGwoYXN5bmMgKCkgPT4gKGF3YWl0IGxpc3RlZCgpKS5zdG9yZWQpLnRvRXF1YWwoeyBsZXZlbDogJ2NvbW1lbnQnLCBzaGFyZTogZmFsc2UsIGFwcHJvdmU6IHRydWUgfSlcblx0XHRcdGF3YWl0IGxldmVsLnNlbGVjdE9wdGlvbigndmlldycpXG5cdFx0XHQvLyBBIFZpZXcgY2Fubm90IGFwcHJvdmUsIHNvIHRoZSBzd2l0Y2ggZ29lcyBvZmYgYW5kIGlzIGZpeGVkXG5cdFx0XHRhd2FpdCBleHBlY3QucG9sbChhc3luYyAoKSA9PiAoYXdhaXQgbGlzdGVkKCkpLnN0b3JlZCkudG9FcXVhbCh7IGxldmVsOiAndmlldycsIHNoYXJlOiBmYWxzZSwgYXBwcm92ZTogZmFsc2UgfSlcblx0XHRcdGF3YWl0IGV4cGVjdChtYXRlLmdldEJ5Um9sZSgnY2hlY2tib3gnLCB7IG5hbWU6ICdBcHByb3ZlJyB9KSkudG9CZURpc2FibGVkKClcblxuXHRcdFx0Ly8gVGhlIG93bmVyIGlzIG1hcmtlZCBhbmQgY2Fubm90IGJlIGxvd2VyZWRcblx0XHRcdGNvbnN0IG1lID0gZGlhbG9nLmxvY2F0b3IoJy5kZWxpdmVyLW1lbWJlcnNfX3JvdycsIHsgaGFzVGV4dDogVVNFUiB9KVxuXHRcdFx0YXdhaXQgZXhwZWN0KG1lKS50b0NvbnRhaW5UZXh0KCdPd25lcicpXG5cdFx0XHRhd2FpdCBleHBlY3QobWUuZ2V0QnlMYWJlbChgQWNjZXNzIGxldmVsIG9mICR7VVNFUn1gKSkudG9CZURpc2FibGVkKClcblxuXHRcdFx0Ly8gQmFjayB0byB3aGF0IEZpbGVzIGdpdmVzXG5cdFx0XHRhd2FpdCBtYXRlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnUmVzZXQnIH0pLmNsaWNrKClcblx0XHRcdGF3YWl0IGV4cGVjdChsZXZlbCkudG9IYXZlVmFsdWUoJ2NvbW1lbnQnKVxuXHRcdFx0ZXhwZWN0KChhd2FpdCBsaXN0ZWQoKSkuc3RvcmVkKS50b0JlTnVsbCgpXG5cblx0XHRcdC8vIFdoYXQgc29tZW9uZSBuZXdseSBnaXZlbiBhY2Nlc3MgaW4gRmlsZXMgc3RhcnRzIHdpdGhcblx0XHRcdGF3YWl0IGRpYWxvZy5nZXRCeUxhYmVsKCdTb21lb25lIG5ld2x5IGdpdmVuIGFjY2VzcyBpbiBGaWxlcyBzdGFydHMgd2l0aCcpLnNlbGVjdE9wdGlvbigndmlldycpXG5cdFx0XHRhd2FpdCBleHBlY3QucG9sbChhc3luYyAoKSA9PiAoYXdhaXQgKGF3YWl0IG93bmVyLmdldChgJHthcGl9P2Zvcm1hdD1qc29uYCkpLmpzb24oKSkub2NzLmRhdGEubmV3Y29tZXJzKS50b0JlKCd2aWV3Jylcblx0XHRcdC8vIEV2ZXJ5b25lIHdobyB3YXMgYSBNZW1iZXIga2VlcHMgd2hhdCBGaWxlcyBnaXZlcywgd2l0aCBubyBlbnRyeSBtYWRlIGZvciB0aGVtXG5cdFx0XHRleHBlY3QoYXdhaXQgbGlzdGVkKCkpLnRvTWF0Y2hPYmplY3QoeyBsZXZlbDogJ2NvbW1lbnQnLCBzdG9yZWQ6IG51bGwgfSlcblx0XHR9IGZpbmFsbHkge1xuXHRcdFx0YXdhaXQgb3duZXIucHV0KGAke2FwaX0/Zm9ybWF0PWpzb25gLCB7IGRhdGE6IHsgbmV3Y29tZXJzOiAnZmlsZXMnIH0gfSlcblx0XHRcdGF3YWl0IG93bmVyLmRlbGV0ZShgJHthcGl9L21lbWJlcnM/Zm9ybWF0PWpzb24mdHlwZT11c2VyJnByaW5jaXBhbD0ke01BVEV9YClcblx0XHRcdGF3YWl0IG93bmVyLmRpc3Bvc2UoKVxuXHRcdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnRXNjYXBlJykuY2F0Y2goKCkgPT4ge30pXG5cdFx0fVxuXHR9KVxuXG5cdHRlc3QoJ2EgTWVtYmVyIGludml0ZXMgc29tZW9uZSBmcm9tIHRoZWlyIGNvbnRhY3RzIG9uIGEgbGluayBvZiB0aGVpciBvd24nLCBhc3luYyAoeyBwbGF5d3JpZ2h0IH0pID0+IHtcblx0XHRjb25zdCBhcGkgPSBhd2FpdCBwbGF5d3JpZ2h0LnJlcXVlc3QubmV3Q29udGV4dCh7IGJhc2VVUkw6IFVSTCwgaHR0cENyZWRlbnRpYWxzOiBhdXRoLCBleHRyYUhUVFBIZWFkZXJzOiBvY3NIZWFkZXJzIH0pXG5cdFx0Ly8gVGhlIHRlc3QgdXNlciBrZWVwcyB0aGVpciBhZGRyZXNzIGJvb2sgYmV0d2VlbiBydW5zOiBhIG5hbWUgb2YgdGhpcyBydW4ncyBvd25cblx0XHRjb25zdCBydW4gPSByYW5kb21CeXRlcygzKS50b1N0cmluZygnaGV4Jylcblx0XHRjb25zdCB6b2VOYW1lID0gYFpvZSBRdWlsbCAke3J1bn1gXG5cdFx0Y29uc3QgdWlkID0gYGRlbGl2ZXItZTJlLSR7cnVufWBcblx0XHRjb25zdCBjYXJkID0gYC9yZW1vdGUucGhwL2Rhdi9hZGRyZXNzYm9va3MvdXNlcnMvJHtVU0VSfS9jb250YWN0cy8ke3VpZH0udmNmYFxuXHRcdGNvbnN0IHZjYXJkID0gYEJFR0lOOlZDQVJEXFxyXFxuVkVSU0lPTjozLjBcXHJcXG5VSUQ6JHt1aWR9XFxyXFxuRk46JHt6b2VOYW1lfVxcclxcbmBcblx0XHRcdCsgJ0VNQUlMO1RZUEU9V09SSzp6b2VAc3R1ZGlvLnRlc3RcXHJcXG5FTUFJTDtUWVBFPUhPTUU6em9lQGhvbWUudGVzdFxcclxcbkVORDpWQ0FSRFxcclxcbidcblx0XHRleHBlY3QoKGF3YWl0IGFwaS5mZXRjaChjYXJkLCB7IG1ldGhvZDogJ1BVVCcsIGRhdGE6IHZjYXJkLCBoZWFkZXJzOiB7ICdDb250ZW50LVR5cGUnOiAndGV4dC92Y2FyZCcgfSB9KSkuc3RhdHVzKCkpLnRvQmUoMjAxKVxuXHRcdC8vIEEgbGluayBvZiB0aGUgUHJvamVjdCB0byBwdXQgWm9lIG9uIGxhdGVyXG5cdFx0YXdhaXQgYXBpLnBvc3QoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHMvJHtwcm9qZWN0SWR9L2xpbmtzP2Zvcm1hdD1qc29uYClcblxuXHRcdHRyeSB7XG5cdFx0XHRhd2FpdCBwYWdlLmdvdG8oYC9hcHBzL2RlbGl2ZXIvcHJvamVjdHMvJHtwcm9qZWN0SWR9YClcblx0XHRcdGF3YWl0IHBhZ2UubG9jYXRvcignLmFwcC1uYXZpZ2F0aW9uJykuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdJbnZpdGUgYSBSZXZpZXdlcicgfSkuY2xpY2soKVxuXHRcdFx0Y29uc3QgZGlhbG9nID0gcGFnZS5nZXRCeVJvbGUoJ2RpYWxvZycsIHsgbmFtZTogJ0ludml0ZSBhIFJldmlld2VyJyB9KVxuXHRcdFx0Y29uc3QgbmFtZSA9IGRpYWxvZy5nZXRCeVJvbGUoJ2NvbWJvYm94JywgeyBuYW1lOiAnTmFtZScgfSlcblx0XHRcdGF3YWl0IG5hbWUucHJlc3NTZXF1ZW50aWFsbHkocnVuKVxuXHRcdFx0Ly8gT25lIHJvdyBwZXIgYWRkcmVzczsgdGhlIGFycm93IGtleXMgbW92ZSwgRW50ZXIgcGlja3Ncblx0XHRcdGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5Um9sZSgnb3B0aW9uJykpLnRvSGF2ZUNvdW50KDIpXG5cdFx0XHRhd2FpdCBuYW1lLnByZXNzKCdBcnJvd0Rvd24nKVxuXHRcdFx0YXdhaXQgbmFtZS5wcmVzcygnRW50ZXInKVxuXHRcdFx0YXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKCdsaXN0Ym94JykpLnRvSGF2ZUNvdW50KDApXG5cdFx0XHRhd2FpdCBleHBlY3QobmFtZSkudG9IYXZlVmFsdWUoem9lTmFtZSlcblx0XHRcdGF3YWl0IGV4cGVjdChkaWFsb2cuZ2V0QnlMYWJlbCgnRW1haWwgKG9wdGlvbmFsKScpKS50b0hhdmVWYWx1ZSgnem9lQGhvbWUudGVzdCcpXG5cdFx0XHRhd2FpdCBkaWFsb2cuZ2V0QnlUZXh0KCdSZXZpZXdlcnMgbWF5IGRvd25sb2FkIHRoZSBvcmlnaW5hbCcpLmNsaWNrKClcblx0XHRcdGF3YWl0IGRpYWxvZy5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ0ludml0ZScsIGV4YWN0OiB0cnVlIH0pLmNsaWNrKClcblx0XHRcdGF3YWl0IGV4cGVjdChkaWFsb2cpLnRvSGF2ZUNvdW50KDApXG5cblx0XHRcdC8vIEEgbGluayBvZiB0aGVpciBvd24sIHRpdGxlZCBieSB3aGF0IGl0IHNob3dzLCB3aXRoIHRoZW0gdW5kZXIgaXRcblx0XHRcdGNvbnN0IGxpc3RlZCA9IGF3YWl0IChhd2FpdCBhcGkuZ2V0KGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3Byb2plY3RzLyR7cHJvamVjdElkfS9saW5rcz9mb3JtYXQ9anNvbmApKS5qc29uKClcblx0XHRcdGNvbnN0IHpvZUlkID0gbGlzdGVkLm9jcy5kYXRhLnJldmlld2Vycy5maW5kKChlYWNoKSA9PiBlYWNoLm5hbWUgPT09IHpvZU5hbWUpLmlkXG5cdFx0XHRjb25zdCB0aGVpcnMgPSBsaXN0ZWQub2NzLmRhdGEubGlua3MuZmluZCgobGluaykgPT4gbGluay5yZXZpZXdlcklkcy5pbmNsdWRlcyh6b2VJZCkpXG5cdFx0XHRleHBlY3QoW3RoZWlycy5yZXZpZXdlcklkcywgdGhlaXJzLmFzc2V0SWRzLCB0aGVpcnMuY2FuRG93bmxvYWRdKS50b0VxdWFsKFtbem9lSWRdLCBudWxsLCBmYWxzZV0pXG5cblx0XHRcdC8vIEFscmVhZHkgYSBjb250YWN0OiBub3RoaW5nIHRvIHNhdmVcblx0XHRcdGNvbnN0IHpvZSA9IHBhZ2UubG9jYXRvcignLmFwcC1uYXZpZ2F0aW9uIGxpJykuZmlsdGVyKHsgaGFzVGV4dDogem9lTmFtZSB9KS5sYXN0KClcblx0XHRcdGF3YWl0IHpvZS5ob3ZlcigpXG5cdFx0XHRhd2FpdCB6b2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdBY3Rpb25zJyB9KS5jbGljaygpXG5cdFx0XHRhd2FpdCBleHBlY3QocGFnZS5nZXRCeVJvbGUoJ21lbnVpdGVtJywgeyBuYW1lOiAnSW4geW91ciBjb250YWN0cycgfSkpLnRvQmVEaXNhYmxlZCgpXG5cdFx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdFc2NhcGUnKVxuXG5cdFx0XHQvLyBSaWdodHMgb2YgdGhlaXIgb3duIG9uIHRoYXQgbGluaywgZnJvbSB0aGUgZ2VhciBhdCBpdCBpbiB0aGVpciBkaWFsb2cgKEFEUiAwMDE0KVxuXHRcdFx0YXdhaXQgem9lLmdldEJ5VGV4dCh6b2VOYW1lKS5jbGljaygpXG5cdFx0XHRjb25zdCBwZXJzb24gPSBwYWdlLmdldEJ5Um9sZSgnZGlhbG9nJywgeyBuYW1lOiB6b2VOYW1lIH0pXG5cdFx0XHRhd2FpdCBwZXJzb24uZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6IGBSaWdodHMgb2YgJHt6b2VOYW1lfSBvbiB0aGlzIGxpbmtgIH0pLmNsaWNrKClcblx0XHRcdGNvbnN0IHJpZ2h0cyA9IHBhZ2UuZ2V0QnlSb2xlKCdkaWFsb2cnLCB7IG5hbWU6IGAke3pvZU5hbWV9IG9uIOKAnFdob2xlIFByb2plY3TigJ1gIH0pXG5cdFx0XHRhd2FpdCByaWdodHMuZ2V0QnlSb2xlKCdyYWRpb2dyb3VwJywgeyBuYW1lOiAnQ29tbWVudCcsIGV4YWN0OiB0cnVlIH0pLmdldEJ5VGV4dCgnTm8nLCB7IGV4YWN0OiB0cnVlIH0pLmNsaWNrKClcblx0XHRcdGF3YWl0IGV4cGVjdC5wb2xsKGFzeW5jICgpID0+IHtcblx0XHRcdFx0Y29uc3Qgbm93ID0gYXdhaXQgKGF3YWl0IGFwaS5nZXQoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHMvJHtwcm9qZWN0SWR9L2xpbmtzP2Zvcm1hdD1qc29uYCkpLmpzb24oKVxuXHRcdFx0XHRyZXR1cm4gbm93Lm9jcy5kYXRhLnJldmlld2Vycy5maW5kKChlYWNoKSA9PiBlYWNoLmlkID09PSB6b2VJZCkubGlua3MuZmluZCgoZWFjaCkgPT4gZWFjaC50b2tlbiA9PT0gdGhlaXJzLnRva2VuKS5yaWdodHMuY2FuQ29tbWVudFxuXHRcdFx0fSkudG9CZShmYWxzZSlcblx0XHRcdC8vIE9uZSBkaWFsb2cgYXQgYSB0aW1lLCBieSBpdHMgb3duIGNsb3NlIGJ1dHRvblxuXHRcdFx0YXdhaXQgcmlnaHRzLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnQ2xvc2UnIH0pLmNsaWNrKClcblx0XHRcdGF3YWl0IGV4cGVjdChyaWdodHMpLnRvSGF2ZUNvdW50KDApXG5cdFx0XHRhd2FpdCBwZXJzb24uZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdDbG9zZScgfSkuY2xpY2soKVxuXHRcdFx0YXdhaXQgZXhwZWN0KHBlcnNvbikudG9IYXZlQ291bnQoMClcblxuXHRcdFx0Ly8gVW5kZXIgdGhlIGxpbmssIGEgY2xpY2sgb3BlbnMgdGhlaXIgcmlnaHRzIG9uIHRoYXQgdmVyeSBsaW5rXG5cdFx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJy5hcHAtbmF2aWdhdGlvbicpLmdldEJ5VGV4dCh6b2VOYW1lKS5maXJzdCgpLmNsaWNrKClcblx0XHRcdGNvbnN0IG5lc3RlZCA9IHBhZ2UuZ2V0QnlSb2xlKCdkaWFsb2cnLCB7IG5hbWU6IGAke3pvZU5hbWV9IG9uIOKAnFdob2xlIFByb2plY3TigJ1gIH0pXG5cdFx0XHRhd2FpdCBleHBlY3QobmVzdGVkKS50b0JlVmlzaWJsZSgpXG5cdFx0XHRhd2FpdCBuZXN0ZWQuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdDbG9zZScgfSkuY2xpY2soKVxuXHRcdFx0YXdhaXQgZXhwZWN0KG5lc3RlZCkudG9IYXZlQ291bnQoMClcblxuXHRcdFx0Ly8gUHV0IG9uIGFub3RoZXIgbGluayBvZiB0aGUgUHJvamVjdCBmcm9tIHRoZWlyIGRpYWxvZywgd2l0aCBhIFBlcnNvbmFsIExpbmsgb2YgaXRzIG93biAoc3RvcnkgNTUpXG5cdFx0XHRjb25zdCB6b2VMaW5rcyA9IGFzeW5jICgpID0+IHtcblx0XHRcdFx0Y29uc3Qgbm93ID0gYXdhaXQgKGF3YWl0IGFwaS5nZXQoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHMvJHtwcm9qZWN0SWR9L2xpbmtzP2Zvcm1hdD1qc29uYCkpLmpzb24oKVxuXHRcdFx0XHRyZXR1cm4gbm93Lm9jcy5kYXRhLnJldmlld2Vycy5maW5kKChlYWNoKSA9PiBlYWNoLmlkID09PSB6b2VJZCkubGlua3MubWFwKChlYWNoKSA9PiBlYWNoLnRva2VuKVxuXHRcdFx0fVxuXHRcdFx0YXdhaXQgem9lLmdldEJ5VGV4dCh6b2VOYW1lKS5jbGljaygpXG5cdFx0XHRjb25zdCBhZ2FpbiA9IHBhZ2UuZ2V0QnlSb2xlKCdkaWFsb2cnLCB7IG5hbWU6IHpvZU5hbWUgfSlcblx0XHRcdGF3YWl0IGV4cGVjdChhZ2Fpbi5nZXRCeUxhYmVsKCdOYW1lJywgeyBleGFjdDogdHJ1ZSB9KSkudG9CZUZvY3VzZWQoKVxuXHRcdFx0YXdhaXQgYWdhaW4uZ2V0QnlSb2xlKCdjb21ib2JveCcsIHsgbmFtZTogJ1B1dCBvbiBhbm90aGVyIFJldmlldyBMaW5rJyB9KS5jbGljaygpXG5cdFx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnb3B0aW9uJykuZmlyc3QoKS5jbGljaygpXG5cdFx0XHRhd2FpdCBleHBlY3QucG9sbChhc3luYyAoKSA9PiAoYXdhaXQgem9lTGlua3MoKSkubGVuZ3RoKS50b0JlKDIpXG5cdFx0XHRhd2FpdCBhZ2Fpbi5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ0Nsb3NlJyB9KS5jbGljaygpXG5cdFx0XHRhd2FpdCBleHBlY3QoYWdhaW4pLnRvSGF2ZUNvdW50KDApXG5cblx0XHRcdC8vIEFuZCB0YWtlbiBvZmYgdGhhdCBvbmUgaW4gaXRzIHNldHRpbmdzOyB0aGUgbGluayBvZiB0aGVpciBvd24gc3RheXNcblx0XHRcdGNvbnN0IG90aGVyID0gKGF3YWl0IHpvZUxpbmtzKCkpLmZpbmQoKHRva2VuKSA9PiB0b2tlbiAhPT0gdGhlaXJzLnRva2VuKVxuXHRcdFx0Y29uc3QgbGlua0l0ZW0gPSBwYWdlLmxvY2F0b3IoJy5hcHAtbmF2aWdhdGlvbiBsaScpLmZpbHRlcih7IGhhczogcGFnZS5sb2NhdG9yKCd1bCBsaScsIHsgaGFzVGV4dDogem9lTmFtZSB9KSB9KS5maXJzdCgpXG5cdFx0XHRhd2FpdCBsaW5rSXRlbS5sb2NhdG9yKCcuYXBwLW5hdmlnYXRpb24tZW50cnlfX25hbWUnKS5maXJzdCgpLmNsaWNrKClcblx0XHRcdGNvbnN0IHNldHRpbmdzID0gcGFnZS5nZXRCeVJvbGUoJ2RpYWxvZycpLmZpcnN0KClcblx0XHRcdGF3YWl0IHNldHRpbmdzLmxvY2F0b3IoJy5kZWxpdmVyLWxpbmtfX3Jldmlld2VyJykuZmlsdGVyKHsgaGFzVGV4dDogem9lTmFtZSB9KS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogYFRha2UgJHt6b2VOYW1lfSBvZmYgdGhpcyBsaW5rYCB9KS5jbGljaygpXG5cdFx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnVGFrZSBvZmYnIH0pLmNsaWNrKClcblx0XHRcdGF3YWl0IGV4cGVjdC5wb2xsKHpvZUxpbmtzKS50b0VxdWFsKFt0aGVpcnMudG9rZW5dKVxuXHRcdFx0ZXhwZWN0KG90aGVyKS5ub3QudG9CZSh0aGVpcnMudG9rZW4pXG5cdFx0fSBmaW5hbGx5IHtcblx0XHRcdGNvbnN0IGNsZWFudXAgPSBhd2FpdCBwbGF5d3JpZ2h0LnJlcXVlc3QubmV3Q29udGV4dCh7IGJhc2VVUkw6IFVSTCwgaHR0cENyZWRlbnRpYWxzOiBhdXRoIH0pXG5cdFx0XHRhd2FpdCBjbGVhbnVwLmZldGNoKGNhcmQsIHsgbWV0aG9kOiAnREVMRVRFJyB9KVxuXHRcdFx0YXdhaXQgY2xlYW51cC5kaXNwb3NlKClcblx0XHRcdGF3YWl0IGFwaS5kaXNwb3NlKClcblx0XHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ0VzY2FwZScpLmNhdGNoKCgpID0+IHt9KVxuXHRcdH1cblx0fSlcblxuXHR0ZXN0KCdhIGZpbGUgd2l0aCBDb21tZW50cyBpcyBsb2NrZWQsIGFuZCBhbiBvdmVyd3JpdGUgd2l0aG91dCB0aGUgbG9jayBtYXJrcyB0aGVtJywgYXN5bmMgKHsgcGxheXdyaWdodCB9KSA9PiB7XG5cdFx0Y29uc3QgYXBpID0gYXdhaXQgcGxheXdyaWdodC5yZXF1ZXN0Lm5ld0NvbnRleHQoeyBiYXNlVVJMOiBVUkwsIGh0dHBDcmVkZW50aWFsczogYXV0aCwgZXh0cmFIVFRQSGVhZGVyczogb2NzSGVhZGVycyB9KVxuXHRcdGNvbnN0IGxvY2sgPSAobG9ja0ZpbGVzKSA9PiBhcGkucHV0KGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3Byb2plY3RzLyR7cHJvamVjdElkfT9mb3JtYXQ9anNvbmAsIHsgZGF0YTogeyBsb2NrRmlsZXMgfSB9KVxuXHRcdGNvbnN0IGNsaXAgPSBgL3JlbW90ZS5waHAvZGF2L2ZpbGVzLyR7VVNFUn0vJHtmb2xkZXJ9L292ZXJ3cml0ZS53ZWJtYFxuXHRcdHRyeSB7XG5cdFx0XHQvLyBBIGZpbGUgb2YgaXRzIG93biwgYXMgdGhlIFZlcnNpb25zIG9mIHRoZSB0ZXN0cyBiZWZvcmUgYXJlIG5vIGxvbmdlciB0aGUgbmV3ZXN0XG5cdFx0XHRleHBlY3QoKGF3YWl0IGFwaS5mZXRjaChjbGlwLCB7IG1ldGhvZDogJ1BVVCcsIGRhdGE6IHJlYWRGaWxlU3luYyhDTElQKSB9KSkuc3RhdHVzKCkpLnRvQmUoMjAxKVxuXHRcdFx0Y29uc3QgcHJvamVjdCA9IGF3YWl0IGFwaS5nZXQoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHMvJHtwcm9qZWN0SWR9P2Zvcm1hdD1qc29uYClcblx0XHRcdGNvbnN0IG1pbmUgPSAoYXdhaXQgcHJvamVjdC5qc29uKCkpLm9jcy5kYXRhLmFzc2V0cy5maW5kKChhc3NldCkgPT4gYXNzZXQudmVyc2lvbnNbMF0ubmFtZSA9PT0gJ292ZXJ3cml0ZS53ZWJtJykudmVyc2lvbnNbMF0uaWRcblxuXHRcdFx0Ly8gQSBDb21tZW50IGxvY2tzIHRoZSBmaWxlIGFnYWluc3QgYSBzeW5jIGNsaWVudFxuXHRcdFx0Y29uc3QgY29tbWVudGVkID0gYXdhaXQgYXBpLnBvc3QoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvdmVyc2lvbnMvJHttaW5lfS9jb21tZW50cz9mb3JtYXQ9anNvbmAsIHsgZGF0YTogeyBpbkZyYW1lOiAxLCBib2R5OiAnbG9jayBtZScgfSB9KVxuXHRcdFx0ZXhwZWN0KGNvbW1lbnRlZC5zdGF0dXMoKSwgYXdhaXQgY29tbWVudGVkLnRleHQoKSkudG9CZSgyMDEpXG5cdFx0XHRleHBlY3QoKGF3YWl0IGFwaS5mZXRjaChjbGlwLCB7IG1ldGhvZDogJ1BVVCcsIGRhdGE6IHJlYWRGaWxlU3luYyhDTElQKSB9KSkuc3RhdHVzKCkpLnRvQmUoNDIzKVxuXG5cdFx0XHQvLyBUaGUgc3dpdGNoIGlzIGluIHRoZSBQcm9qZWN0IHNldHRpbmdzLCBhbmQgb2ZmIGZyZWVzIHRoZSBmaWxlXG5cdFx0XHRhd2FpdCBwYWdlLmdvdG8oYC9hcHBzL2RlbGl2ZXIvcHJvamVjdHMvJHtwcm9qZWN0SWR9YClcblx0XHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdQcm9qZWN0IHNldHRpbmdzJyB9KS5jbGljaygpXG5cdFx0XHRjb25zdCBzZXR0aW5ncyA9IHBhZ2UuZ2V0QnlSb2xlKCdkaWFsb2cnLCB7IG5hbWU6IC9eU2V0dGluZ3Mgb2YvIH0pXG5cdFx0XHRhd2FpdCBzZXR0aW5ncy5nZXRCeVRleHQoJ1Byb3RlY3QgZmlsZXMgd2l0aCBDb21tZW50cyBhZ2FpbnN0IGRlbGV0aW5nIGFuZCByZW5hbWluZycpLmNsaWNrKClcblx0XHRcdGF3YWl0IGV4cGVjdC5wb2xsKGFzeW5jICgpID0+IChhd2FpdCBhcGkuZmV0Y2goY2xpcCwgeyBtZXRob2Q6ICdQVVQnLCBkYXRhOiByZWFkRmlsZVN5bmMoQ0xJUCkgfSkpLnN0YXR1cygpKS50b0JlKDIwNClcblx0XHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ0VzY2FwZScpXG5cblx0XHRcdGF3YWl0IHBhZ2UuZ290byhgL2FwcHMvZGVsaXZlci92ZXJzaW9ucy8ke21pbmV9YClcblx0XHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRfX292ZXJ3cml0dGVuJykuZmlyc3QoKSkudG9Db250YWluVGV4dCgnYmVmb3JlIHRoZSBvdmVyd3JpdGUgb24nKVxuXHRcdH0gZmluYWxseSB7XG5cdFx0XHRhd2FpdCBsb2NrKHRydWUpXG5cdFx0XHRhd2FpdCBhcGkuZGlzcG9zZSgpXG5cdFx0fVxuXHR9KVxuXG5cdHRlc3QoJ0NhcHRpb25zIGFyZSBhZGRlZCBvbiB0aGUgQXNzZXQgY2FyZCBhbmQgdHVybmVkIG9uIHVuZGVyIHRoZSBDQyBidXR0b24nLCBhc3luYyAoeyBwbGF5d3JpZ2h0IH0pID0+IHtcblx0XHRjb25zdCBhcGkgPSBhd2FpdCBwbGF5d3JpZ2h0LnJlcXVlc3QubmV3Q29udGV4dCh7IGJhc2VVUkw6IFVSTCwgaHR0cENyZWRlbnRpYWxzOiBhdXRoLCBleHRyYUhUVFBIZWFkZXJzOiBvY3NIZWFkZXJzIH0pXG5cdFx0ZXhwZWN0KChhd2FpdCBhcGkuZmV0Y2goYC9yZW1vdGUucGhwL2Rhdi9maWxlcy8ke1VTRVJ9LyR7Zm9sZGVyfS9jYXB0aW9uZWQud2VibWAsIHsgbWV0aG9kOiAnUFVUJywgZGF0YTogcmVhZEZpbGVTeW5jKENMSVApIH0pKS5zdGF0dXMoKSkudG9CZSgyMDEpXG5cdFx0YXdhaXQgYXBpLmRpc3Bvc2UoKVxuXG5cdFx0YXdhaXQgcGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL3Byb2plY3RzLyR7cHJvamVjdElkfWApXG5cdFx0YXdhaXQgY2FyZChwYWdlLCAnY2FwdGlvbmVkJykuY2xpY2soeyBidXR0b246ICdyaWdodCcgfSlcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnbWVudWl0ZW0nLCB7IG5hbWU6ICdBZGQgQ2FwdGlvbnPigKYnIH0pLmNsaWNrKClcblx0XHRjb25zdCBkaWFsb2cgPSBwYWdlLmdldEJ5Um9sZSgnZGlhbG9nJywgeyBuYW1lOiAnQ2FwdGlvbnMnIH0pXG5cdFx0Ly8gVGhlIGxhbmd1YWdlIGNvbWVzIGZyb20gdGhlIGZpbGUgbmFtZVxuXHRcdGF3YWl0IGRpYWxvZy5sb2NhdG9yKCdpbnB1dFt0eXBlPWZpbGVdJykuc2V0SW5wdXRGaWxlcyh7IG5hbWU6ICdjYXB0aW9uZWQuZGUuc3J0JywgbWltZVR5cGU6ICdhcHBsaWNhdGlvbi94LXN1YnJpcCcsIGJ1ZmZlcjogQnVmZmVyLmZyb20oJzFcXG4wMDowMDowMCwwMDAgLS0+IDAwOjAwOjAzLDAwMFxcbkhhbGxvXFxuJykgfSlcblx0XHRhd2FpdCBleHBlY3QoZGlhbG9nLmxvY2F0b3IoJy52c19fc2VsZWN0ZWQnKSkudG9IYXZlVGV4dCgnR2VybWFuJylcblx0XHQvLyBGb2N1cyBzdGF5cyBpbiB0aGUgZmlsZSBmaWVsZCwgYXMgd2hlcmUgYSBjbGljayBkb2VzIG5vdCBmb2N1cyB0aGUgYnV0dG9uIChTYWZhcmkpOyBFc2NhcGUgaW4gYSBmaWVsZCBsZWF2ZXMgYSBkaWFsb2cgb3BlblxuXHRcdGF3YWl0IGRpYWxvZy5sb2NhdG9yKCdpbnB1dFt0eXBlPWZpbGVdJykuZm9jdXMoKVxuXHRcdGF3YWl0IGRpYWxvZy5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ0FkZCBDYXB0aW9ucycgfSkuZGlzcGF0Y2hFdmVudCgnY2xpY2snKVxuXHRcdGF3YWl0IGV4cGVjdChkaWFsb2cubG9jYXRvcignLmRlbGl2ZXItY2FwdGlvbnNfX2xpc3QnKSkudG9IYXZlVGV4dCgnR2VybWFuJylcblx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdFc2NhcGUnKVxuXHRcdGF3YWl0IGV4cGVjdChkaWFsb2cpLnRvQmVIaWRkZW4oKVxuXG5cdFx0YXdhaXQgY2FyZChwYWdlLCAnY2FwdGlvbmVkJykubG9jYXRvcignLmRlbGl2ZXItY2FyZF9fbGluaycpLmRibGNsaWNrKClcblx0XHRjb25zdCBzaG93biA9ICgpID0+IHBhZ2UuZXZhbHVhdGUoKCkgPT4gWy4uLmRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJy5kZWxpdmVyLXBsYXllcl9fdmlkZW8nKS50ZXh0VHJhY2tzXS5maWx0ZXIoKHRyYWNrKSA9PiB0cmFjay5tb2RlID09PSAnc2hvd2luZycpLm1hcCgodHJhY2spID0+IHRyYWNrLmxhbmd1YWdlKSlcblx0XHQvLyBPZmYgdW50aWwgc29tZW9uZSB0dXJucyB0aGVtIG9uXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdDYXB0aW9ucycgfSkpLnRvQmVWaXNpYmxlKClcblx0XHRleHBlY3QoYXdhaXQgc2hvd24oKSkudG9FcXVhbChbXSlcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnQ2FwdGlvbnMnIH0pLmNsaWNrKClcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnbWVudWl0ZW1yYWRpbycsIHsgbmFtZTogJ0dlcm1hbicgfSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKHNob3duKS50b0VxdWFsKFsnZGUnXSlcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnQ2FwdGlvbnMnIH0pLmNsaWNrKClcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnbWVudWl0ZW1yYWRpbycsIHsgbmFtZTogJ09mZicgfSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKHNob3duKS50b0VxdWFsKFtdKVxuXHR9KVxuXG5cdHRlc3QoJ3RoZSB0aW1lbGluZSBob3ZlciBzY3J1YnMgdGhyb3VnaCB3aGF0IHBsYXlzIHdoZXJlIHRoaXMgYnJvd3NlciBjYW5ub3QgcGxheSB0aGUgU2NydWIgUHJveHknLCBhc3luYyAoKSA9PiB7XG5cdFx0Ly8gZmZtcGVnIG1ha2VzIHRoZSBjbGlwJ3MgU2NydWIgUHJveHksIGFuIEguMjY0IE1QNCwgd2hpY2ggb3Blbi1zb3VyY2UgQ2hyb21pdW0gZG9lcyBub3QgZGVjb2RlXG5cdFx0ZXhlY0ZpbGVTeW5jKCdkb2NrZXInLCBbJ2NvbXBvc2UnLCAnZXhlYycsICctVCcsICctdScsICd3d3ctZGF0YScsICduZXh0Y2xvdWQnLCAncGhwJywgJ29jYycsICdkZWxpdmVyOndvcmtlcicsICctLW9uY2UnXSwgeyBzdGRpbzogJ2luaGVyaXQnIH0pXG5cdFx0YXdhaXQgcGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL3ZlcnNpb25zLyR7dmVyc2lvbklkfWApXG5cdFx0Y29uc3QgaDI2NCA9IGF3YWl0IHBhZ2UuZXZhbHVhdGUoKCkgPT4gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndmlkZW8nKS5jYW5QbGF5VHlwZSgndmlkZW8vbXA0OyBjb2RlY3M9XCJhdmMxLjQyRTAxRVwiJykgIT09ICcnKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fc2NydWItdmlkZW8nKSkudG9IYXZlQXR0cmlidXRlKCdzcmMnLCBoMjY0ID8gL1xcL21lZGlhXFwvc2NydWIkLyA6IC9jbGlwXFwud2VibSQvKVxuXHRcdGNvbnN0IGJhciA9IGF3YWl0IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX190aW1lbGluZScpLmJvdW5kaW5nQm94KClcblx0XHRhd2FpdCBwYWdlLm1vdXNlLm1vdmUoYmFyLnggKyBiYXIud2lkdGggLyAyLCBiYXIueSArIGJhci5oZWlnaHQgLyAyKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9faG92ZXIgY2FudmFzJykpLnRvQmVWaXNpYmxlKClcblx0fSlcblxuXHR0ZXN0KCdhIGNsaWNrIG9uIHRoZSB0aW1lbGluZSBrZWVwcyBwbGF5aW5nIGlmIGl0IHBsYXllZCwgYW5kIHN0YXlzIHBhdXNlZCBpZiBpdCBkaWQgbm90JywgYXN5bmMgKCkgPT4ge1xuXHRcdGF3YWl0IHBhZ2UuZ290byhgL2FwcHMvZGVsaXZlci92ZXJzaW9ucy8ke3ZlcnNpb25JZH1gKVxuXHRcdGNvbnN0IHZpZGVvID0gcGFnZS5sb2NhdG9yKCd2aWRlby5kZWxpdmVyLXBsYXllcl9fdmlkZW8nKVxuXHRcdGF3YWl0IGV4cGVjdCh2aWRlbykudG9IYXZlSlNQcm9wZXJ0eSgncmVhZHlTdGF0ZScsIDQpXG5cdFx0Y29uc3QgYmFyID0gYXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX3RpbWVsaW5lJykuYm91bmRpbmdCb3goKVxuXHRcdGNvbnN0IGNsaWNrQXQgPSAoc2hhcmUpID0+IHBhZ2UubW91c2UuY2xpY2soYmFyLnggKyBiYXIud2lkdGggKiBzaGFyZSwgYmFyLnkgKyBiYXIuaGVpZ2h0IC8gMilcblxuXHRcdGF3YWl0IGNsaWNrQXQoMC4xKVxuXHRcdGF3YWl0IHBhZ2Uud2FpdEZvclRpbWVvdXQoMzAwKVxuXHRcdGV4cGVjdChhd2FpdCB2aWRlby5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5wYXVzZWQpKS50b0JlKHRydWUpXG5cblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAvXlBsYXkgXFwoLyB9KS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gdmlkZW8uZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQuY3VycmVudFRpbWUpKS50b0JlR3JlYXRlclRoYW4oMC4xKVxuXHRcdGF3YWl0IGNsaWNrQXQoMC41KVxuXHRcdGF3YWl0IHBhZ2Uud2FpdEZvclRpbWVvdXQoMzAwKVxuXHRcdGV4cGVjdChhd2FpdCB2aWRlby5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5wYXVzZWQpKS50b0JlKGZhbHNlKVxuXHRcdGV4cGVjdChhd2FpdCB2aWRlby5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5jdXJyZW50VGltZSkpLnRvQmVHcmVhdGVyVGhhbigxLjkpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6IC9eUGF1c2UgXFwoLyB9KSkudG9CZVZpc2libGUoKVxuXHR9KVxuXG5cdHRlc3QoJ2RyYWdnaW5nIHRoZSBwbGF5aGVhZCB3aXRoIHRoZSBtb3VzZSBzZWVrcyBiZWZvcmUgcmVsZWFzZSwgaG9sZHMgcGxheWJhY2sgYW5kIGdvZXMgb24gaWYgaXQgcGxheWVkJywgYXN5bmMgKCkgPT4ge1xuXHRcdGF3YWl0IHBhZ2UuZ290byhgL2FwcHMvZGVsaXZlci92ZXJzaW9ucy8ke3ZlcnNpb25JZH1gKVxuXHRcdGNvbnN0IHZpZGVvID0gcGFnZS5sb2NhdG9yKCd2aWRlby5kZWxpdmVyLXBsYXllcl9fdmlkZW8nKVxuXHRcdGF3YWl0IGV4cGVjdCh2aWRlbykudG9IYXZlSlNQcm9wZXJ0eSgncmVhZHlTdGF0ZScsIDQpXG5cdFx0Y29uc3QgYmFyID0gYXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX3RpbWVsaW5lJykuYm91bmRpbmdCb3goKVxuXHRcdGNvbnN0IHkgPSBiYXIueSArIGJhci5oZWlnaHQgLyAyXG5cdFx0Y29uc3QgdGltZSA9ICgpID0+IHZpZGVvLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LmN1cnJlbnRUaW1lKVxuXHRcdGNvbnN0IHBhdXNlZCA9ICgpID0+IHZpZGVvLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LnBhdXNlZClcblxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6IC9eUGxheSBcXCgvIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QucG9sbChwYXVzZWQpLnRvQmUoZmFsc2UpXG5cdFx0YXdhaXQgcGFnZS5tb3VzZS5tb3ZlKGJhci54ICsgYmFyLndpZHRoICogMC4yLCB5KVxuXHRcdGF3YWl0IHBhZ2UubW91c2UuZG93bigpXG5cdFx0YXdhaXQgcGFnZS5tb3VzZS5tb3ZlKGJhci54ICsgYmFyLndpZHRoICogMC41LCB5LCB7IHN0ZXBzOiA1IH0pXG5cdFx0Ly8gU3RpbGwgcHJlc3NlZDogdGhlIHBpY3R1cmUgaXMgYWxyZWFkeSB0aGVyZSBhbmQgcGxheWJhY2sgaXMgaGVsZFxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKHRpbWUpLnRvQmVHcmVhdGVyVGhhbigxLjgpXG5cdFx0ZXhwZWN0KGF3YWl0IHRpbWUoKSkudG9CZUxlc3NUaGFuKDIuMylcblx0XHRleHBlY3QoYXdhaXQgcGF1c2VkKCkpLnRvQmUodHJ1ZSlcblx0XHRhd2FpdCBwYWdlLm1vdXNlLm1vdmUoYmFyLnggKyBiYXIud2lkdGggKiAwLjc1LCB5LCB7IHN0ZXBzOiA1IH0pXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwodGltZSkudG9CZUdyZWF0ZXJUaGFuKDIuOClcblx0XHRhd2FpdCBwYWdlLm1vdXNlLnVwKClcblx0XHRhd2FpdCBleHBlY3QucG9sbChwYXVzZWQpLnRvQmUoZmFsc2UpXG5cblx0XHQvLyBQYXVzZWQgc3RheXMgcGF1c2VkXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogL15QYXVzZSBcXCgvIH0pLmNsaWNrKClcblx0XHRhd2FpdCBwYWdlLm1vdXNlLm1vdmUoYmFyLnggKyBiYXIud2lkdGggKiAwLjgsIHkpXG5cdFx0YXdhaXQgcGFnZS5tb3VzZS5kb3duKClcblx0XHRhd2FpdCBwYWdlLm1vdXNlLm1vdmUoYmFyLnggKyBiYXIud2lkdGggKiAwLjEsIHksIHsgc3RlcHM6IDUgfSlcblx0XHRhd2FpdCBleHBlY3QucG9sbCh0aW1lKS50b0JlTGVzc1RoYW4oMC43KVxuXHRcdGF3YWl0IHBhZ2UubW91c2UudXAoKVxuXHRcdGF3YWl0IHBhZ2Uud2FpdEZvclRpbWVvdXQoMzAwKVxuXHRcdGV4cGVjdChhd2FpdCBwYXVzZWQoKSkudG9CZSh0cnVlKVxuXHR9KVxuXG5cdHRlc3QoJ2EgY2xpY2sgb24gdGhlIGJhciBrZWVwcyBhIGJhY2t3YXJkcyBzaHV0dGxlIGdvaW5nLCBmcm9tIHdoZXJlIGl0IHdhcyBjbGlja2VkJywgYXN5bmMgKCkgPT4ge1xuXHRcdGF3YWl0IHBhZ2UuZ290byhgL2FwcHMvZGVsaXZlci92ZXJzaW9ucy8ke3ZlcnNpb25JZH1gKVxuXHRcdGNvbnN0IHZpZGVvID0gcGFnZS5sb2NhdG9yKCd2aWRlby5kZWxpdmVyLXBsYXllcl9fdmlkZW8nKVxuXHRcdGF3YWl0IGV4cGVjdCh2aWRlbykudG9IYXZlSlNQcm9wZXJ0eSgncmVhZHlTdGF0ZScsIDQpXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1sYXlvdXRfX2JhciBoMicpLmNsaWNrKClcblx0XHRjb25zdCBiYXIgPSBhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fdGltZWxpbmUnKS5ib3VuZGluZ0JveCgpXG5cdFx0Y29uc3QgeSA9IGJhci55ICsgYmFyLmhlaWdodCAvIDJcblx0XHRhd2FpdCBwYWdlLm1vdXNlLmNsaWNrKGJhci54ICsgYmFyLndpZHRoICogMC45LCB5KVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ2onKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAvXlBhdXNlIFxcKC8gfSkpLnRvQmVWaXNpYmxlKClcblx0XHQvLyBBIGNsaWNrIGlzIG9ubHkgYSBzZWVrOiB0aGUgc2h1dHRsZSBnb2VzIG9uIGJhY2t3YXJkcyBmcm9tIHRoZXJlIChob2xkaW5nIHBsYXliYWNrIHdvdWxkIGRyb3AgaXQsXG5cdFx0Ly8gYW5kIGxldHRpbmcgZ28gd291bGQgcGxheSBmb3J3YXJkcyBmcm9tIDIuMCBzKVxuXHRcdGF3YWl0IHBhZ2UubW91c2UuY2xpY2soYmFyLnggKyBiYXIud2lkdGggKiAwLjUsIHkpXG5cdFx0YXdhaXQgcGFnZS53YWl0Rm9yVGltZW91dCgzMDApXG5cdFx0ZXhwZWN0KGF3YWl0IHZpZGVvLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LmN1cnJlbnRUaW1lKSkudG9CZUxlc3NUaGFuKDIpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6IC9eUGF1c2UgXFwoLyB9KSkudG9CZVZpc2libGUoKVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ2snKVxuXHR9KVxuXG5cdHRlc3QoJ2EgY2xpY2sgb24gYSBDb21tZW50XFwncyBtYXJrZXIgcGF1c2VzJywgYXN5bmMgKHsgcGxheXdyaWdodCB9KSA9PiB7XG5cdFx0Y29uc3QgYXBpID0gYXdhaXQgcGxheXdyaWdodC5yZXF1ZXN0Lm5ld0NvbnRleHQoeyBiYXNlVVJMOiBVUkwsIGh0dHBDcmVkZW50aWFsczogYXV0aCwgZXh0cmFIVFRQSGVhZGVyczogb2NzSGVhZGVycyB9KVxuXHRcdC8vIFRoZSBDb21wYXJlIHRlc3Qgc3RhY2tlZCBhIG5ld2VyIFZlcnNpb24gb24gdGhlIEFzc2V0OyBvbmx5IHRoZSBuZXdlc3QgdGFrZXMgQ29tbWVudHNcblx0XHRjb25zdCBwcm9qZWN0ID0gYXdhaXQgKGF3YWl0IGFwaS5nZXQoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHMvJHtwcm9qZWN0SWR9P2Zvcm1hdD1qc29uYCkpLmpzb24oKVxuXHRcdGNvbnN0IG5ld2VzdCA9IE1hdGgubWF4KC4uLnByb2plY3Qub2NzLmRhdGEuYXNzZXRzWzBdLnZlcnNpb25zLm1hcCgoZWFjaCkgPT4gZWFjaC5pZCkpXG5cdFx0Y29uc3QgY29tbWVudGVkID0gYXdhaXQgYXBpLnBvc3QoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvdmVyc2lvbnMvJHtuZXdlc3R9L2NvbW1lbnRzP2Zvcm1hdD1qc29uYCwgeyBkYXRhOiB7IGluRnJhbWU6IDUwLCBib2R5OiAnc3RvcCBoZXJlJyB9IH0pXG5cdFx0ZXhwZWN0KGNvbW1lbnRlZC5vaygpKS50b0JlKHRydWUpXG5cdFx0YXdhaXQgYXBpLmRpc3Bvc2UoKVxuXHRcdGF3YWl0IHBhZ2UuZ290byhgL2FwcHMvZGVsaXZlci92ZXJzaW9ucy8ke25ld2VzdH1gKVxuXHRcdGNvbnN0IHZpZGVvID0gcGFnZS5sb2NhdG9yKCd2aWRlby5kZWxpdmVyLXBsYXllcl9fdmlkZW8nKVxuXHRcdGF3YWl0IGV4cGVjdCh2aWRlbykudG9IYXZlSlNQcm9wZXJ0eSgncmVhZHlTdGF0ZScsIDQpXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogL15QbGF5IFxcKC8gfSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IHZpZGVvLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LnBhdXNlZCkpLnRvQmUoZmFsc2UpXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX21hcmtlcicpLmZpcnN0KCkuY2xpY2soeyBmb3JjZTogdHJ1ZSB9KVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IHZpZGVvLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LnBhdXNlZCkpLnRvQmUodHJ1ZSlcblx0XHRleHBlY3QoYXdhaXQgdmlkZW8uZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQuY3VycmVudFRpbWUpKS50b0JlQ2xvc2VUbygyLCAxKVxuXHR9KVxuXG5cdHRlc3QoJ2Nsb3NlIENvbW1lbnRzIHNoYXJlIGEgbWFya2VyIHdpdGggdGhlaXIgY291bnQ6IGVhY2ggcHJlc3MgdGFrZXMgdGhlIG5leHQsIGEgZG91YmxlIHRhcCBvciBjbGljayBnb2VzIHRvIHRoZSBvbmUgdGhhdCBzaG93ZWQnLCBhc3luYyAoeyBwbGF5d3JpZ2h0IH0pID0+IHtcblx0XHRjb25zdCBhcGkgPSBhd2FpdCBwbGF5d3JpZ2h0LnJlcXVlc3QubmV3Q29udGV4dCh7IGJhc2VVUkw6IFVSTCwgaHR0cENyZWRlbnRpYWxzOiBhdXRoLCBleHRyYUhUVFBIZWFkZXJzOiBvY3NIZWFkZXJzIH0pXG5cdFx0Y29uc3QgcHJvamVjdCA9IGF3YWl0IChhd2FpdCBhcGkuZ2V0KGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3Byb2plY3RzLyR7cHJvamVjdElkfT9mb3JtYXQ9anNvbmApKS5qc29uKClcblx0XHRjb25zdCBuZXdlc3QgPSBNYXRoLm1heCguLi5wcm9qZWN0Lm9jcy5kYXRhLmFzc2V0c1swXS52ZXJzaW9ucy5tYXAoKGVhY2gpID0+IGVhY2guaWQpKVxuXHRcdGNvbnN0IGlkcyA9IFtdXG5cdFx0Zm9yIChjb25zdCBpbkZyYW1lIG9mIFs4NSwgODYsIDg3XSkge1xuXHRcdFx0Y29uc3QgbWFkZSA9IGF3YWl0IGFwaS5wb3N0KGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3ZlcnNpb25zLyR7bmV3ZXN0fS9jb21tZW50cz9mb3JtYXQ9anNvbmAsIHsgZGF0YTogeyBpbkZyYW1lLCBib2R5OiBgYXQgJHtpbkZyYW1lfWAgfSB9KVxuXHRcdFx0aWRzLnB1c2goKGF3YWl0IG1hZGUuanNvbigpKS5vY3MuZGF0YS5pZClcblx0XHR9XG5cdFx0YXdhaXQgcGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL3ZlcnNpb25zLyR7bmV3ZXN0fWApXG5cdFx0Y29uc3QgdmlkZW8gPSBwYWdlLmxvY2F0b3IoJ3ZpZGVvLmRlbGl2ZXItcGxheWVyX192aWRlbycpXG5cdFx0YXdhaXQgZXhwZWN0KHZpZGVvKS50b0hhdmVKU1Byb3BlcnR5KCdyZWFkeVN0YXRlJywgNClcblx0XHRjb25zdCBmcmFtZU9mID0gKHRhcmdldCkgPT4gdGFyZ2V0LmV2YWx1YXRlKChlbGVtZW50KSA9PiBNYXRoLmZsb29yKGVsZW1lbnQuY3VycmVudFRpbWUgKiAyNSArIDAuMDAxKSlcblx0XHRjb25zdCBtYXJrZXIgPSBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fbWFya2VyW2FyaWEtbGFiZWwqPVwiOiBhdCA4XCJdJylcblx0XHRhd2FpdCBleHBlY3QobWFya2VyKS50b0hhdmVBdHRyaWJ1dGUoJ2FyaWEtbGFiZWwnLCAvXjEgb2YgMywgLio6IGF0IDg1JC8pXG5cdFx0Ly8gVGhlIG1vdXNlIHNob3dzIHRoZSBmaXJzdCBhbmQgc3RlcHMgb24gd2l0aCBldmVyeSBjbGljazsgdGhlIHdyYXAgY29tZXMgYmFjayB0byBpdCAoZm9yY2VkOiB0aGUgYmFyIHRha2VzIHRoZSBwb2ludGVyIGZvciBpdHMgY2lyY2xlcylcblx0XHRhd2FpdCBtYXJrZXIuaG92ZXIoeyBmb3JjZTogdHJ1ZSB9KVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fcGVlaycpKS50b0NvbnRhaW5UZXh0KCcxIG9mIDMnKVxuXHRcdGZvciAoY29uc3QgZnJhbWUgb2YgWzg1LCA4NiwgODcsIDg1LCA4Nl0pIHtcblx0XHRcdGF3YWl0IG1hcmtlci5jbGljayh7IGZvcmNlOiB0cnVlIH0pXG5cdFx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiBmcmFtZU9mKHZpZGVvKSkudG9CZShmcmFtZSlcblx0XHRcdGF3YWl0IHBhZ2Uud2FpdEZvclRpbWVvdXQoNDAwKVxuXHRcdH1cblx0XHQvLyBBIGRvdWJsZSBjbGljayBkb2VzIG5vdCBzdGVwIG9uOiB0aGUgc2Vjb25kIHByZXNzIHRha2VzIHRoZSBvbmUgdGhhdCBzaG93ZWQgYmVmb3JlIHRoZSBmaXJzdFxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fcGVlaycpKS50b0NvbnRhaW5UZXh0KCcyIG9mIDMnKVxuXHRcdGF3YWl0IG1hcmtlci5kYmxjbGljayh7IGZvcmNlOiB0cnVlIH0pXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX19wZWVrJykpLnRvQ29udGFpblRleHQoJzIgb2YgMycpXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gZnJhbWVPZih2aWRlbykpLnRvQmUoODYpXG5cdFx0YXdhaXQgcGFnZS5tb3VzZS5tb3ZlKDAsIDApXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX19wZWVrJykpLnRvSGF2ZUNvdW50KDApXG5cdFx0Ly8gVGhlIGtleWJvYXJkIHRvbzogdGhlIFRhYiBrZXkgc2hvd3MgdGhlIGZpcnN0LCBFbnRlciBnb2VzIHRoZXJlIGFuZCB0aGVuIG9uXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1sYXlvdXRfX2JhciBoMicpLmNsaWNrKClcblx0XHRhd2FpdCBtYXJrZXIuZm9jdXMoKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fcGVlaycpKS50b0hhdmVDb3VudCgwKVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ1NoaWZ0K1RhYicpXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnVGFiJylcblx0XHRhd2FpdCBleHBlY3QobWFya2VyKS50b0JlRm9jdXNlZCgpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX19wZWVrJykpLnRvQ29udGFpblRleHQoJzEgb2YgMycpXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnRW50ZXInKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IGZyYW1lT2YodmlkZW8pKS50b0JlKDg1KVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ0VudGVyJylcblx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiBmcmFtZU9mKHZpZGVvKSkudG9CZSg4Nilcblx0XHRhd2FpdCBleHBlY3QobWFya2VyKS50b0hhdmVBdHRyaWJ1dGUoJ2FyaWEtbGFiZWwnLCAvXjIgb2YgMywgLio6IGF0IDg2JC8pXG5cblx0XHRjb25zdCBwaG9uZSA9IGF3YWl0IGJyb3dzZXIubmV3Q29udGV4dCh7IGJhc2VVUkw6IEJST1dTRVJfVVJMLCAuLi5QSE9ORSB9KVxuXHRcdGNvbnN0IHRvdWNoUGFnZSA9IGF3YWl0IHBob25lLm5ld1BhZ2UoKVxuXHRcdGF3YWl0IGxvZ2luKHRvdWNoUGFnZSlcblx0XHRhd2FpdCB0b3VjaFBhZ2UuZ290byhgL2FwcHMvZGVsaXZlci92ZXJzaW9ucy8ke25ld2VzdH1gKVxuXHRcdGNvbnN0IHRvdWNoVmlkZW8gPSB0b3VjaFBhZ2UubG9jYXRvcigndmlkZW8uZGVsaXZlci1wbGF5ZXJfX3ZpZGVvJylcblx0XHRhd2FpdCBleHBlY3QodG91Y2hWaWRlbykudG9IYXZlSlNQcm9wZXJ0eSgncmVhZHlTdGF0ZScsIDQpXG5cdFx0Y29uc3QgY2FyZCA9IHRvdWNoUGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX3BlZWstLXRhcHBlZCcpXG5cdFx0Ly8gQSBmaW5nZXIgb24gdGhlIGNpcmNsZSBvcGVucyB0aGUgY2FyZCB3aXRob3V0IHNlZWtpbmdcblx0XHRjb25zdCBib3ggPSBhd2FpdCB0b3VjaFBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX19tYXJrZXJbYXJpYS1sYWJlbCo9XCI6IGF0IDhcIl0nKS5ib3VuZGluZ0JveCgpXG5cdFx0Y29uc3QgdGFwID0gKGJlc2lkZSA9IDApID0+IHRvdWNoUGFnZS50b3VjaHNjcmVlbi50YXAoYm94LnggKyBib3gud2lkdGggLyAyIC0gYmVzaWRlLCBib3gueSArIGJveC5oZWlnaHQgLyAyKVxuXHRcdGF3YWl0IHRhcCg2KVxuXHRcdGF3YWl0IGV4cGVjdChjYXJkKS50b0NvbnRhaW5UZXh0KCdhdCA4NScpXG5cdFx0ZXhwZWN0KGF3YWl0IHRvdWNoVmlkZW8uZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQuY3VycmVudFRpbWUpKS50b0JlKDApXG5cdFx0YXdhaXQgdG91Y2hQYWdlLndhaXRGb3JUaW1lb3V0KDcwMClcblx0XHRhd2FpdCB0YXAoKVxuXHRcdGF3YWl0IGV4cGVjdChjYXJkKS50b0NvbnRhaW5UZXh0KCcyIG9mIDMnKVxuXHRcdGF3YWl0IHRvdWNoUGFnZS53YWl0Rm9yVGltZW91dCg3MDApXG5cdFx0YXdhaXQgdGFwKClcblx0XHRhd2FpdCB0YXAoKVxuXHRcdGF3YWl0IGV4cGVjdChjYXJkKS50b0NvbnRhaW5UZXh0KCcyIG9mIDMnKVxuXHRcdGF3YWl0IGV4cGVjdChjYXJkKS50b0NvbnRhaW5UZXh0KCdhdCA4NicpXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gZnJhbWVPZih0b3VjaFZpZGVvKSkudG9CZSg4Nilcblx0XHQvLyBJdCByZWFjaGVzIG5vIGZ1cnRoZXIgdGhhbiBpdCBpcyBkcmF3bjogYmVzaWRlLCBhYm92ZSBhbmQgYmVsb3cgaXQgdGhlIGJhciBzZWVrc1xuXHRcdGNvbnN0IGJhciA9IGF3YWl0IHRvdWNoUGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX3RpbWVsaW5lJykuYm91bmRpbmdCb3goKVxuXHRcdGNvbnN0IHRhcEF0ID0gYXN5bmMgKHgsIHkpID0+IHtcblx0XHRcdGF3YWl0IHRvdWNoUGFnZS5yZWxvYWQoKVxuXHRcdFx0YXdhaXQgZXhwZWN0KHRvdWNoVmlkZW8pLnRvSGF2ZUpTUHJvcGVydHkoJ3JlYWR5U3RhdGUnLCA0KVxuXHRcdFx0YXdhaXQgZXhwZWN0KHRvdWNoUGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX21hcmtlclthcmlhLWxhYmVsKj1cIjogYXQgOFwiXScpKS50b0JlVmlzaWJsZSgpXG5cdFx0XHRhd2FpdCB0b3VjaFBhZ2UudG91Y2hzY3JlZW4udGFwKGJveC54ICsgYm94LndpZHRoIC8gMiArIHgsIHkpXG5cdFx0fVxuXHRcdGZvciAoY29uc3QgW3gsIHksIGZyYW1lXSBvZiBbWy0xOCwgMTYsIDg1IC0gMTggLyBiYXIud2lkdGggKiAxMDBdLCBbMCwgMiwgODVdLCBbMCwgYmFyLmhlaWdodCAtIDIsIDg1XV0pIHtcblx0XHRcdGF3YWl0IHRhcEF0KHgsIGJhci55ICsgeSlcblx0XHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IGZyYW1lT2YodG91Y2hWaWRlbykpLnRvQmVHcmVhdGVyVGhhbihmcmFtZSAtIDIpXG5cdFx0XHRleHBlY3QoYXdhaXQgZnJhbWVPZih0b3VjaFZpZGVvKSkudG9CZUxlc3NUaGFuKGZyYW1lICsgMilcblx0XHRcdGF3YWl0IGV4cGVjdChjYXJkKS50b0hhdmVDb3VudCgwKVxuXHRcdH1cblx0XHQvLyBUaGUgYmFyIGdyb3dzIHVuZGVyIGEgbW91c2UsIG9uIGEgbmFycm93IHdpbmRvdyB0b28sIG5vdCB1bmRlciBhIGZpbmdlclxuXHRcdGF3YWl0IHBhZ2Uuc2V0Vmlld3BvcnRTaXplKHsgd2lkdGg6IDkwMCwgaGVpZ2h0OiA4MDAgfSlcblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fdGltZWxpbmUnKS5ob3ZlcigpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX190cmFjaycpKS50b0hhdmVDU1MoJ2hlaWdodCcsICcxMnB4Jylcblx0XHRjb25zdCBba25vYiwgdHJhY2tdID0gYXdhaXQgUHJvbWlzZS5hbGwoWycuZGVsaXZlci1wbGF5ZXJfX3RpbWVsaW5lJywgJy5kZWxpdmVyLXBsYXllcl9fdHJhY2snXS5tYXAoKGVhY2gpID0+IHBhZ2UubG9jYXRvcihlYWNoKS5ib3VuZGluZ0JveCgpKSlcblx0XHRleHBlY3QodHJhY2sueSArIHRyYWNrLmhlaWdodCAvIDIpLnRvQmVDbG9zZVRvKGtub2IueSArIGtub2IuaGVpZ2h0IC8gMiwgMClcblx0XHRhd2FpdCBwYWdlLnNldFZpZXdwb3J0U2l6ZSh7IHdpZHRoOiAxMjgwLCBoZWlnaHQ6IDcyMCB9KVxuXHRcdGF3YWl0IGV4cGVjdCh0b3VjaFBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX190cmFjaycpKS50b0hhdmVDU1MoJ2hlaWdodCcsICc2cHgnKVxuXHRcdGF3YWl0IHRhcEF0KDAsIGJhci55IC0gNClcblx0XHRhd2FpdCBleHBlY3QodG91Y2hQYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllci0tZnVsbHNjcmVlbiwgLmRlbGl2ZXItcGxheWVyLS1maWxsaW5nJykpLnRvSGF2ZUNvdW50KDEpXG5cdFx0YXdhaXQgZXhwZWN0KGNhcmQpLnRvSGF2ZUNvdW50KDApXG5cdFx0YXdhaXQgcGhvbmUuY2xvc2UoKVxuXHRcdGZvciAoY29uc3QgaWQgb2YgaWRzKSB7XG5cdFx0XHRleHBlY3QoKGF3YWl0IGFwaS5kZWxldGUoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvY29tbWVudHMvJHtpZH0/Zm9ybWF0PWpzb25gKSkub2soKSkudG9CZSh0cnVlKVxuXHRcdH1cblx0XHRhd2FpdCBhcGkuZGlzcG9zZSgpXG5cdH0pXG5cblx0dGVzdCgnYSBwcmVzcyBvbiBhIENvbW1lbnRcXCdzIGNpcmNsZSB0aGF0IGRvZXMgbm90IG1vdmUgb3BlbnMgaXQsIG9uZSB0aGF0IG1vdmVzIGRyYWdzIHRoZSBwbGF5aGVhZCwgYnkgbW91c2UgYW5kIGJ5IGZpbmdlcicsIGFzeW5jICh7IHBsYXl3cmlnaHQgfSkgPT4ge1xuXHRcdGNvbnN0IGFwaSA9IGF3YWl0IHBsYXl3cmlnaHQucmVxdWVzdC5uZXdDb250ZXh0KHsgYmFzZVVSTDogVVJMLCBodHRwQ3JlZGVudGlhbHM6IGF1dGgsIGV4dHJhSFRUUEhlYWRlcnM6IG9jc0hlYWRlcnMgfSlcblx0XHRjb25zdCBwcm9qZWN0ID0gYXdhaXQgKGF3YWl0IGFwaS5nZXQoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHMvJHtwcm9qZWN0SWR9P2Zvcm1hdD1qc29uYCkpLmpzb24oKVxuXHRcdGNvbnN0IG5ld2VzdCA9IE1hdGgubWF4KC4uLnByb2plY3Qub2NzLmRhdGEuYXNzZXRzWzBdLnZlcnNpb25zLm1hcCgoZWFjaCkgPT4gZWFjaC5pZCkpXG5cdFx0Y29uc3QgbWFkZSA9IGF3YWl0IGFwaS5wb3N0KGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3ZlcnNpb25zLyR7bmV3ZXN0fS9jb21tZW50cz9mb3JtYXQ9anNvbmAsIHsgZGF0YTogeyBpbkZyYW1lOiAzMCwgYm9keTogJ2RyYWcgbWUnIH0gfSlcblx0XHRjb25zdCBpZCA9IChhd2FpdCBtYWRlLmpzb24oKSkub2NzLmRhdGEuaWRcblx0XHRjb25zdCBwaG9uZSA9IGF3YWl0IGJyb3dzZXIubmV3Q29udGV4dCh7IGJhc2VVUkw6IEJST1dTRVJfVVJMLCAuLi5QSE9ORSB9KVxuXHRcdGNvbnN0IHRvdWNoUGFnZSA9IGF3YWl0IHBob25lLm5ld1BhZ2UoKVxuXHRcdGF3YWl0IGxvZ2luKHRvdWNoUGFnZSlcblx0XHRjb25zdCBjZHAgPSBhd2FpdCBwaG9uZS5uZXdDRFBTZXNzaW9uKHRvdWNoUGFnZSlcblx0XHRjb25zdCBmaW5nZXIgPSAoeCwgeSkgPT4gKHtcblx0XHRcdGRvd246ICgpID0+IGNkcC5zZW5kKCdJbnB1dC5kaXNwYXRjaFRvdWNoRXZlbnQnLCB7IHR5cGU6ICd0b3VjaFN0YXJ0JywgdG91Y2hQb2ludHM6IFt7IHgsIHkgfV0gfSksXG5cdFx0XHRtb3ZlOiAoZHgpID0+IGNkcC5zZW5kKCdJbnB1dC5kaXNwYXRjaFRvdWNoRXZlbnQnLCB7IHR5cGU6ICd0b3VjaE1vdmUnLCB0b3VjaFBvaW50czogW3sgeDogeCArIGR4LCB5IH1dIH0pLFxuXHRcdFx0dXA6ICgpID0+IGNkcC5zZW5kKCdJbnB1dC5kaXNwYXRjaFRvdWNoRXZlbnQnLCB7IHR5cGU6ICd0b3VjaEVuZCcsIHRvdWNoUG9pbnRzOiBbXSB9KSxcblx0XHR9KVxuXHRcdGNvbnN0IG1vdXNlID0gKHgsIHkpID0+ICh7XG5cdFx0XHRkb3duOiBhc3luYyAoKSA9PiB7XG5cdFx0XHRcdGF3YWl0IHBhZ2UubW91c2UubW92ZSh4LCB5KVxuXHRcdFx0XHRhd2FpdCBwYWdlLm1vdXNlLmRvd24oKVxuXHRcdFx0fSxcblx0XHRcdG1vdmU6IChkeCkgPT4gcGFnZS5tb3VzZS5tb3ZlKHggKyBkeCwgeSksXG5cdFx0XHR1cDogKCkgPT4gcGFnZS5tb3VzZS51cCgpLFxuXHRcdH0pXG5cblx0XHRmb3IgKGNvbnN0IFt0YXJnZXQsIHBvaW50ZXJdIG9mIFtbcGFnZSwgbW91c2VdLCBbdG91Y2hQYWdlLCBmaW5nZXJdXSkge1xuXHRcdFx0YXdhaXQgdGFyZ2V0LmdvdG8oYC9hcHBzL2RlbGl2ZXIvdmVyc2lvbnMvJHtuZXdlc3R9YClcblx0XHRcdGNvbnN0IHZpZGVvID0gdGFyZ2V0LmxvY2F0b3IoJ3ZpZGVvLmRlbGl2ZXItcGxheWVyX192aWRlbycpXG5cdFx0XHRhd2FpdCBleHBlY3QodmlkZW8pLnRvSGF2ZUpTUHJvcGVydHkoJ3JlYWR5U3RhdGUnLCA0KVxuXHRcdFx0Y29uc3QgZnJhbWUgPSAoKSA9PiB2aWRlby5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gTWF0aC5mbG9vcihlbGVtZW50LmN1cnJlbnRUaW1lICogMjUgKyAwLjAwMSkpXG5cdFx0XHRjb25zdCBwYXVzZWQgPSAoKSA9PiB2aWRlby5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5wYXVzZWQpXG5cdFx0XHRjb25zdCBiYXIgPSBhd2FpdCB0YXJnZXQubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX190aW1lbGluZScpLmJvdW5kaW5nQm94KClcblx0XHRcdGNvbnN0IGJveCA9IGF3YWl0IHRhcmdldC5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX21hcmtlclthcmlhLWxhYmVsJD1cImRyYWcgbWVcIl0nKS5ib3VuZGluZ0JveCgpXG5cdFx0XHQvLyBBIGxpdHRsZSBvZmYgaXRzIG1pZGRsZSwgYSBGcmFtZSBvZiBpdHMgb3duXG5cdFx0XHRjb25zdCB4ID0gYm94LnggKyBib3gud2lkdGggLyAyIC0gNVxuXHRcdFx0Y29uc3QgeyBkb3duLCBtb3ZlLCB1cCB9ID0gcG9pbnRlcih4LCBib3gueSArIGJveC5oZWlnaHQgLyAyKVxuXHRcdFx0Y29uc3QgYXQgPSAocHgpID0+IE1hdGguZmxvb3IoKHB4IC0gYmFyLngpIC8gYmFyLndpZHRoICogMTAwKVxuXHRcdFx0Y29uc3QgcGVlayA9IHRhcmdldC5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX3BlZWsnKVxuXHRcdFx0Y29uc3Qgc2hvd24gPSB0YXJnZXQubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX19ob3ZlcicpXG5cblx0XHRcdC8vIFdpdGhpbiB0aGUgc2xvcCBpdCBkb2VzIG5vdCBzZWVrIGJ1dCBvcGVuc1xuXHRcdFx0YXdhaXQgZG93bigpXG5cdFx0XHRhd2FpdCBtb3ZlKDYpXG5cdFx0XHRhd2FpdCB0YXJnZXQud2FpdEZvclRpbWVvdXQoMTUwKVxuXHRcdFx0ZXhwZWN0KGF3YWl0IGZyYW1lKCkpLnRvQmUoMClcblx0XHRcdGF3YWl0IHVwKClcblx0XHRcdGF3YWl0IGV4cGVjdChwZWVrKS50b0NvbnRhaW5UZXh0KCdkcmFnIG1lJylcblx0XHRcdGF3YWl0IGV4cGVjdC5wb2xsKGZyYW1lKS50b0JlKHRhcmdldCA9PT0gcGFnZSA/IDMwIDogMClcblx0XHRcdGF3YWl0IHRhcmdldC5yZWxvYWQoKVxuXHRcdFx0YXdhaXQgZXhwZWN0KHZpZGVvKS50b0hhdmVKU1Byb3BlcnR5KCdyZWFkeVN0YXRlJywgNClcblx0XHRcdGF3YWl0IGV4cGVjdCh0YXJnZXQubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX19tYXJrZXJbYXJpYS1sYWJlbCQ9XCJkcmFnIG1lXCJdJykpLnRvQmVWaXNpYmxlKClcblxuXHRcdFx0Ly8gUGFzdCBpdCB0aGUgcGxheWhlYWQgZ29lcyBhbG9uZywgd2l0aCB0aGUgRnJhbWUgb3ZlciB0aGUgcG9pbnRlciBhbmQgbm8gY2FyZCwgYW5kIHBsYXliYWNrIGhlbGRcblx0XHRcdGF3YWl0IHRhcmdldC5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogL15QbGF5LyB9KS5maXJzdCgpLmNsaWNrKClcblx0XHRcdGF3YWl0IGV4cGVjdC5wb2xsKHBhdXNlZCkudG9CZShmYWxzZSlcblx0XHRcdGF3YWl0IGRvd24oKVxuXHRcdFx0YXdhaXQgbW92ZSg0MClcblx0XHRcdGF3YWl0IG1vdmUoMTIwKVxuXHRcdFx0YXdhaXQgZXhwZWN0LnBvbGwoZnJhbWUpLnRvQmUoYXQoeCArIDEyMCkpXG5cdFx0XHRleHBlY3QoYXdhaXQgcGF1c2VkKCkpLnRvQmUodHJ1ZSlcblx0XHRcdGF3YWl0IGV4cGVjdChzaG93bikudG9CZVZpc2libGUoKVxuXHRcdFx0YXdhaXQgZXhwZWN0KHBlZWspLnRvSGF2ZUNvdW50KDApXG5cdFx0XHQvLyBCYWNrIG9uIHRoZSBjaXJjbGUgYW5kIGxldCBnbywgaXQgaXMgd2hlcmUgdGhlIHBvaW50ZXIgaXMsIHN0aWxsIG5vIGNsaWNrXG5cdFx0XHRhd2FpdCBtb3ZlKDApXG5cdFx0XHRhd2FpdCB0YXJnZXQuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6IC9eUGF1c2V8XlBsYXkvIH0pLmZpcnN0KCkud2FpdEZvcigpXG5cdFx0XHRhd2FpdCBleHBlY3QucG9sbChmcmFtZSkudG9CZShhdCh4KSlcblx0XHRcdGF3YWl0IHVwKClcblx0XHRcdGF3YWl0IGV4cGVjdC5wb2xsKHBhdXNlZCkudG9CZShmYWxzZSlcblx0XHRcdGF3YWl0IGV4cGVjdCh0YXJnZXQubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX19wZWVrLS10YXBwZWQnKSkudG9IYXZlQ291bnQoMClcblx0XHRcdGF3YWl0IHRhcmdldC53YWl0Rm9yVGltZW91dCg0MDApXG5cdFx0XHRleHBlY3QoYXdhaXQgcGF1c2VkKCkpLnRvQmUoZmFsc2UpXG5cdFx0XHRleHBlY3QoYXdhaXQgZnJhbWUoKSkudG9CZUdyZWF0ZXJUaGFuT3JFcXVhbChhdCh4KSlcblx0XHR9XG5cdFx0Ly8gQSBjbGljayBjb3VudHMgYWdhaW4gYWZ0ZXIgYSBkcmFnXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX21hcmtlclthcmlhLWxhYmVsJD1cImRyYWcgbWVcIl0nKS5jbGljayh7IGZvcmNlOiB0cnVlIH0pXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gcGFnZS5sb2NhdG9yKCd2aWRlby5kZWxpdmVyLXBsYXllcl9fdmlkZW8nKS5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5jdXJyZW50VGltZSkpLnRvQmVDbG9zZVRvKDEuMiwgMSlcblx0XHRhd2FpdCBwaG9uZS5jbG9zZSgpXG5cdFx0ZXhwZWN0KChhd2FpdCBhcGkuZGVsZXRlKGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL2NvbW1lbnRzLyR7aWR9P2Zvcm1hdD1qc29uYCkpLm9rKCkpLnRvQmUodHJ1ZSlcblx0XHRhd2FpdCBhcGkuZGlzcG9zZSgpXG5cdH0pXG5cblx0dGVzdCgnYSBmaW5nZXIgb24gdGhlIHRpbWVsaW5lIGhvbGRzIHBsYXliYWNrIGFuZCByZXN1bWVzIG9uIGxpZnRpbmcgb25seSBpZiBpdCBwbGF5ZWQnLCBhc3luYyAoKSA9PiB7XG5cdFx0Y29uc3QgcGhvbmUgPSBhd2FpdCBicm93c2VyLm5ld0NvbnRleHQoeyBiYXNlVVJMOiBCUk9XU0VSX1VSTCwgLi4uUEhPTkUgfSlcblx0XHRjb25zdCB0b3VjaFBhZ2UgPSBhd2FpdCBwaG9uZS5uZXdQYWdlKClcblx0XHRhd2FpdCBsb2dpbih0b3VjaFBhZ2UpXG5cdFx0YXdhaXQgdG91Y2hQYWdlLmdvdG8oYC9hcHBzL2RlbGl2ZXIvdmVyc2lvbnMvJHt2ZXJzaW9uSWR9YClcblx0XHRjb25zdCB2aWRlbyA9IHRvdWNoUGFnZS5sb2NhdG9yKCd2aWRlby5kZWxpdmVyLXBsYXllcl9fdmlkZW8nKVxuXHRcdGF3YWl0IGV4cGVjdCh2aWRlbykudG9IYXZlSlNQcm9wZXJ0eSgncmVhZHlTdGF0ZScsIDQpXG5cdFx0Y29uc3QgY2RwID0gYXdhaXQgcGhvbmUubmV3Q0RQU2Vzc2lvbih0b3VjaFBhZ2UpXG5cdFx0Y29uc3QgYmFyID0gYXdhaXQgdG91Y2hQYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fdGltZWxpbmUnKS5ib3VuZGluZ0JveCgpXG5cdFx0Y29uc3QgeSA9IGJhci55ICsgYmFyLmhlaWdodCAvIDJcblx0XHRjb25zdCB0b3VjaCA9ICh0eXBlLCB4KSA9PiBjZHAuc2VuZCgnSW5wdXQuZGlzcGF0Y2hUb3VjaEV2ZW50JywgeyB0eXBlLCB0b3VjaFBvaW50czogdHlwZSA9PT0gJ3RvdWNoRW5kJyA/IFtdIDogW3sgeCwgeSB9XSB9KVxuXHRcdGNvbnN0IHBhdXNlZCA9ICgpID0+IHZpZGVvLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LnBhdXNlZClcblxuXHRcdC8vIFBsYXlpbmc6IGhlbGQgd2hpbGUgdGhlIGZpbmdlciBpcyBkb3duLCBnb2luZyBvbiBmcm9tIHdoZXJlIGl0IGxpZnRlZFxuXHRcdGF3YWl0IHRvdWNoUGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1BsYXknLCBleGFjdDogdHJ1ZSB9KS50YXAoKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKHBhdXNlZCkudG9CZShmYWxzZSlcblx0XHRhd2FpdCB0b3VjaCgndG91Y2hTdGFydCcsIGJhci54ICsgYmFyLndpZHRoICogMC4yKVxuXHRcdGF3YWl0IHRvdWNoKCd0b3VjaE1vdmUnLCBiYXIueCArIGJhci53aWR0aCAqIDAuNilcblx0XHRhd2FpdCBleHBlY3QucG9sbChwYXVzZWQpLnRvQmUodHJ1ZSlcblx0XHQvLyBUaGUgcGljdHVyZSBmb2xsb3dlZCB0aGUgZmluZ2VyIGJlZm9yZSBpdCBsaWZ0ZWRcblx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiB2aWRlby5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5jdXJyZW50VGltZSkpLnRvQmVHcmVhdGVyVGhhbigyKVxuXHRcdGF3YWl0IHRvdWNoKCd0b3VjaEVuZCcpXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwocGF1c2VkKS50b0JlKGZhbHNlKVxuXHRcdGV4cGVjdChhd2FpdCB2aWRlby5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5jdXJyZW50VGltZSkpLnRvQmVHcmVhdGVyVGhhbigyKVxuXG5cdFx0Ly8gQSBzZWNvbmQgZmluZ2VyIGxhbmRzIGR1cmluZyB0aGUgZHJhZzogYm90aCBsaWZ0LCBhbmQgaXQgc3RpbGwgZ29lcyBvblxuXHRcdGF3YWl0IHRvdWNoKCd0b3VjaFN0YXJ0JywgYmFyLnggKyBiYXIud2lkdGggKiAwLjIpXG5cdFx0YXdhaXQgdG91Y2goJ3RvdWNoTW92ZScsIGJhci54ICsgYmFyLndpZHRoICogMC40KVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKHBhdXNlZCkudG9CZSh0cnVlKVxuXHRcdGF3YWl0IGNkcC5zZW5kKCdJbnB1dC5kaXNwYXRjaFRvdWNoRXZlbnQnLCB7IHR5cGU6ICd0b3VjaFN0YXJ0JywgdG91Y2hQb2ludHM6IFt7IHg6IGJhci54ICsgYmFyLndpZHRoICogMC40LCB5LCBpZDogMCB9LCB7IHg6IGJhci54ICsgYmFyLndpZHRoICogMC43LCB5LCBpZDogMSB9XSB9KVxuXHRcdGF3YWl0IHRvdWNoKCd0b3VjaEVuZCcpXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwocGF1c2VkKS50b0JlKGZhbHNlKVxuXG5cdFx0Ly8gUGF1c2VkOiBzdGF5cyBwYXVzZWRcblx0XHRhd2FpdCB0b3VjaFBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdQYXVzZScsIGV4YWN0OiB0cnVlIH0pLnRhcCgpXG5cdFx0YXdhaXQgdG91Y2goJ3RvdWNoU3RhcnQnLCBiYXIueCArIGJhci53aWR0aCAqIDAuMilcblx0XHRhd2FpdCB0b3VjaCgndG91Y2hNb3ZlJywgYmFyLnggKyBiYXIud2lkdGggKiAwLjMpXG5cdFx0YXdhaXQgdG91Y2goJ3RvdWNoRW5kJylcblx0XHRhd2FpdCB0b3VjaFBhZ2Uud2FpdEZvclRpbWVvdXQoNDAwKVxuXHRcdGV4cGVjdChhd2FpdCBwYXVzZWQoKSkudG9CZSh0cnVlKVxuXHRcdGF3YWl0IHBob25lLmNsb3NlKClcblx0fSlcblxuXHR0ZXN0KCdhIGNsaWNrIG9uIHRoZSBDb21wYXJlIHRpbWVsaW5lIHN0YXJ0cyBhIHNpZGUgdGhhdCBoYWQgcnVuIG91dCBhZ2FpbicsIGFzeW5jICh7IHBsYXl3cmlnaHQgfSkgPT4ge1xuXHRcdC8vIFRoZSBDb21wYXJlIHRlc3QgbGVmdCBhIHNlY29uZCBWZXJzaW9uIG9uIHRoZSBBc3NldFxuXHRcdGNvbnN0IGFwaSA9IGF3YWl0IHBsYXl3cmlnaHQucmVxdWVzdC5uZXdDb250ZXh0KHsgYmFzZVVSTDogVVJMLCBodHRwQ3JlZGVudGlhbHM6IGF1dGgsIGV4dHJhSFRUUEhlYWRlcnM6IG9jc0hlYWRlcnMgfSlcblx0XHRjb25zdCBwcm9qZWN0ID0gYXdhaXQgKGF3YWl0IGFwaS5nZXQoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHMvJHtwcm9qZWN0SWR9P2Zvcm1hdD1qc29uYCkpLmpzb24oKVxuXHRcdGF3YWl0IGFwaS5kaXNwb3NlKClcblx0XHRjb25zdCBzdGFjayA9IHByb2plY3Qub2NzLmRhdGEuYXNzZXRzLmZpbmQoKGVhY2gpID0+IGVhY2gudmVyc2lvbnMubGVuZ3RoID49IDIpLnZlcnNpb25zXG5cdFx0YXdhaXQgcGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL2NvbXBhcmUvJHtzdGFja1sxXS5pZH0vJHtzdGFja1swXS5pZH1gKVxuXHRcdGNvbnN0IHZpZGVvcyA9IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tcGFyZSB2aWRlbycpXG5cdFx0YXdhaXQgZXhwZWN0KHZpZGVvcy5maXJzdCgpKS50b0hhdmVKU1Byb3BlcnR5KCdyZWFkeVN0YXRlJywgNClcblx0XHQvLyBCIHJ1bnMgNTAgRnJhbWVzICgyIHMpIGFoZWFkIG9mIEEsIHNvIGl0IGlzIG91dCBvZiBwaWN0dXJlIGJlZm9yZSBBIGlzXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21wYXJlX19vZmZzZXQnKS5maWxsKCc1MCcpXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogL15QbGF5IFxcKC8gfSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IHZpZGVvcy5udGgoMSkuZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQuZW5kZWQpLCB7IHRpbWVvdXQ6IDEwXzAwMCB9KS50b0JlKHRydWUpXG5cdFx0Y29uc3QgYmFyID0gYXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21wYXJlX190aW1lbGluZScpLmJvdW5kaW5nQm94KClcblx0XHRhd2FpdCBwYWdlLm1vdXNlLmNsaWNrKGJhci54ICsgYmFyLndpZHRoICogMC4xLCBiYXIueSArIGJhci5oZWlnaHQgLyAyKVxuXHRcdGF3YWl0IHBhZ2Uud2FpdEZvclRpbWVvdXQoMzAwKVxuXHRcdGV4cGVjdChhd2FpdCB2aWRlb3MuZmlyc3QoKS5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5wYXVzZWQpKS50b0JlKGZhbHNlKVxuXHRcdGV4cGVjdChhd2FpdCB2aWRlb3MubnRoKDEpLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LnBhdXNlZCkpLnRvQmUoZmFsc2UpXG5cdH0pXG5cblx0dGVzdCgnZHJhZ2dpbmcgdGhlIENvbXBhcmUgYmFyIHNlZWtzIGJvdGggc2lkZXMgbGl2ZSwgQiBvZmZzZXQgZnJvbSBBLCBob2xkcyBwbGF5YmFjayBhbmQgZ29lcyBvbiBhZnRlcicsIGFzeW5jICh7IHBsYXl3cmlnaHQgfSkgPT4ge1xuXHRcdGNvbnN0IGFwaSA9IGF3YWl0IHBsYXl3cmlnaHQucmVxdWVzdC5uZXdDb250ZXh0KHsgYmFzZVVSTDogVVJMLCBodHRwQ3JlZGVudGlhbHM6IGF1dGgsIGV4dHJhSFRUUEhlYWRlcnM6IG9jc0hlYWRlcnMgfSlcblx0XHRjb25zdCBwcm9qZWN0ID0gYXdhaXQgKGF3YWl0IGFwaS5nZXQoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHMvJHtwcm9qZWN0SWR9P2Zvcm1hdD1qc29uYCkpLmpzb24oKVxuXHRcdGF3YWl0IGFwaS5kaXNwb3NlKClcblx0XHRjb25zdCBzdGFjayA9IHByb2plY3Qub2NzLmRhdGEuYXNzZXRzLmZpbmQoKGVhY2gpID0+IGVhY2gudmVyc2lvbnMubGVuZ3RoID49IDIpLnZlcnNpb25zXG5cdFx0YXdhaXQgcGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL2NvbXBhcmUvJHtzdGFja1sxXS5pZH0vJHtzdGFja1swXS5pZH1gKVxuXHRcdGNvbnN0IHZpZGVvcyA9IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tcGFyZSB2aWRlbycpXG5cdFx0YXdhaXQgZXhwZWN0KHZpZGVvcy5maXJzdCgpKS50b0hhdmVKU1Byb3BlcnR5KCdyZWFkeVN0YXRlJywgNClcblx0XHQvLyBCIHN0YW5kcyAyNSBGcmFtZXMgKDEgcykgYWhlYWQgb2YgQVxuXHRcdGF3YWl0IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tcGFyZV9fb2Zmc2V0JykuZmlsbCgnMjUnKVxuXHRcdGNvbnN0IHRpbWVzID0gKCkgPT4gdmlkZW9zLmV2YWx1YXRlQWxsKChhbGwpID0+IGFsbC5tYXAoKHZpZGVvKSA9PiB2aWRlby5jdXJyZW50VGltZSkpXG5cdFx0Y29uc3QgcGF1c2VkID0gKCkgPT4gdmlkZW9zLmV2YWx1YXRlQWxsKChhbGwpID0+IGFsbC5tYXAoKHZpZGVvKSA9PiB2aWRlby5wYXVzZWQpKVxuXHRcdGNvbnN0IGJhciA9IGF3YWl0IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tcGFyZV9fdGltZWxpbmUnKS5ib3VuZGluZ0JveCgpXG5cdFx0Y29uc3QgeSA9IGJhci55ICsgYmFyLmhlaWdodCAvIDJcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAvXlBsYXkgXFwoLyB9KS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwocGF1c2VkKS50b0VxdWFsKFtmYWxzZSwgZmFsc2VdKVxuXHRcdGF3YWl0IHBhZ2UubW91c2UubW92ZShiYXIueCArIGJhci53aWR0aCAqIDAuMSwgeSlcblx0XHRhd2FpdCBwYWdlLm1vdXNlLmRvd24oKVxuXHRcdC8vIEEgc3RlYWR5IGRyYWc6IEEgaXMgc291Z2h0IG9uZSBzZWVrIGF0IGEgdGltZSwgdGhlIGxhdGVzdCBGcmFtZSBuZXh0LCBhbmQgbm90IG9uY2UgZm9yIGV2ZXJ5IG1vdmVcblx0XHQvLyAoYSBkcmFnIGhvbGRzIHBsYXliYWNrIG9uY2U7IHBhdXNpbmcgc2Vla3MgYWdhaW4sIHdoaWNoIHdvdWxkIGFib3J0IHRoZSBzZWVrIG9uIGl0cyB3YXkpXG5cdFx0YXdhaXQgdmlkZW9zLmZpcnN0KCkuZXZhbHVhdGUoKGVsZW1lbnQpID0+IHtcblx0XHRcdGNvbnN0IHsgZ2V0LCBzZXQgfSA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IoSFRNTE1lZGlhRWxlbWVudC5wcm90b3R5cGUsICdjdXJyZW50VGltZScpXG5cdFx0XHR3aW5kb3cuYXNzaWduZWQgPSAwXG5cdFx0XHR3aW5kb3cuc2V0dGxlZCA9IDBcblx0XHRcdGVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcignc2Vla2VkJywgKCkgPT4gd2luZG93LnNldHRsZWQrKylcblx0XHRcdE9iamVjdC5kZWZpbmVQcm9wZXJ0eShlbGVtZW50LCAnY3VycmVudFRpbWUnLCB7XG5cdFx0XHRcdGdldDogKCkgPT4gZ2V0LmNhbGwoZWxlbWVudCksXG5cdFx0XHRcdHNldDogKHZhbHVlKSA9PiB7XG5cdFx0XHRcdFx0d2luZG93LmFzc2lnbmVkKytcblx0XHRcdFx0XHRzZXQuY2FsbChlbGVtZW50LCB2YWx1ZSlcblx0XHRcdFx0fSxcblx0XHRcdH0pXG5cdFx0fSlcblx0XHRmb3IgKGxldCBzdGVwID0gMTsgc3RlcCA8PSA2MDsgc3RlcCsrKSB7XG5cdFx0XHRhd2FpdCBwYWdlLm1vdXNlLm1vdmUoYmFyLnggKyBiYXIud2lkdGggKiAoMC4xICsgc3RlcCAqIDAuMDA3NSksIHkpXG5cdFx0fVxuXHRcdGNvbnN0IGRyYWcgPSBhd2FpdCBwYWdlLmV2YWx1YXRlKCgpID0+ICh7IGFzc2lnbmVkOiB3aW5kb3cuYXNzaWduZWQsIHNldHRsZWQ6IHdpbmRvdy5zZXR0bGVkIH0pKVxuXHRcdGV4cGVjdChkcmFnLmFzc2lnbmVkKS50b0JlTGVzc1RoYW5PckVxdWFsKGRyYWcuc2V0dGxlZCArIDQpXG5cdFx0Ly8gU3RpbGwgcHJlc3NlZDogYm90aCBzaWRlcyBhcmUgdGhlcmUgYWxyZWFkeSwgQiBhIHNlY29uZCBvbiBmcm9tIEEsIGFuZCBuZWl0aGVyIHBsYXlzXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoYXN5bmMgKCkgPT4gKGF3YWl0IHRpbWVzKCkpWzBdKS50b0JlR3JlYXRlclRoYW4oMS44KVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKGFzeW5jICgpID0+IChhd2FpdCB0aW1lcygpKVsxXSAtIChhd2FpdCB0aW1lcygpKVswXSkudG9CZUNsb3NlVG8oMSwgMSlcblx0XHRleHBlY3QoYXdhaXQgcGF1c2VkKCkpLnRvRXF1YWwoW3RydWUsIHRydWVdKVxuXHRcdGF3YWl0IHBhZ2UubW91c2UudXAoKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKHBhdXNlZCkudG9FcXVhbChbZmFsc2UsIGZhbHNlXSlcblx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdrJylcblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbXBhcmVfX29mZnNldCcpLmZpbGwoJzAnKVxuXHR9KVxuXG5cdHRlc3QoJ1NoaWZ0K2Fycm93cyBza2lwIHRlbiBzZWNvbmRzIGluIENvbXBhcmUsIGJvdGggc2lkZXMgdG9nZXRoZXInLCBhc3luYyAoeyBwbGF5d3JpZ2h0IH0pID0+IHtcblx0XHRjb25zdCBhcGkgPSBhd2FpdCBwbGF5d3JpZ2h0LnJlcXVlc3QubmV3Q29udGV4dCh7IGJhc2VVUkw6IFVSTCwgaHR0cENyZWRlbnRpYWxzOiBhdXRoLCBleHRyYUhUVFBIZWFkZXJzOiBvY3NIZWFkZXJzIH0pXG5cdFx0Y29uc3QgcHJvamVjdCA9IGF3YWl0IChhd2FpdCBhcGkuZ2V0KGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3Byb2plY3RzLyR7cHJvamVjdElkfT9mb3JtYXQ9anNvbmApKS5qc29uKClcblx0XHRhd2FpdCBhcGkuZGlzcG9zZSgpXG5cdFx0Y29uc3Qgc3RhY2sgPSBwcm9qZWN0Lm9jcy5kYXRhLmFzc2V0cy5maW5kKChlYWNoKSA9PiBlYWNoLnZlcnNpb25zLmxlbmd0aCA+PSAyKS52ZXJzaW9uc1xuXHRcdGF3YWl0IHBhZ2UuZ290byhgL2FwcHMvZGVsaXZlci9jb21wYXJlLyR7c3RhY2tbMV0uaWR9LyR7c3RhY2tbMF0uaWR9YClcblx0XHRjb25zdCB2aWRlb3MgPSBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbXBhcmUgdmlkZW8nKVxuXHRcdGF3YWl0IGV4cGVjdCh2aWRlb3MuZmlyc3QoKSkudG9IYXZlSlNQcm9wZXJ0eSgncmVhZHlTdGF0ZScsIDQpXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21wYXJlX19vZmZzZXQnKS5maWxsKCcwJylcblx0XHRjb25zdCBiYXIgPSBhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbXBhcmVfX3RpbWVsaW5lJykuYm91bmRpbmdCb3goKVxuXHRcdGF3YWl0IHBhZ2UubW91c2UuY2xpY2soYmFyLnggKyBiYXIud2lkdGggKiAwLjUsIGJhci55ICsgYmFyLmhlaWdodCAvIDIpXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1sYXlvdXRfX2JhciBoMicpLmNsaWNrKClcblx0XHQvLyBUZW4gc2Vjb25kcyBhcmUgbW9yZSB0aGFuIHRoZSA0IHMgY2xpcDogdGhleSBsYW5kIG9uIGl0cyBsYXN0IEZyYW1lLCBhbmQgYmFjayBvbiB0aGUgZmlyc3Rcblx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdTaGlmdCtBcnJvd1JpZ2h0Jylcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21wYXJlX190aW1lY29kZScpKS50b0NvbnRhaW5UZXh0KCcwMDowMDowMzoyNCcpXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnU2hpZnQrQXJyb3dMZWZ0Jylcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21wYXJlX190aW1lY29kZScpKS50b0NvbnRhaW5UZXh0KCcwMDowMDowMDowMCcpXG5cdFx0Y29uc3QgdGltZXMgPSBhd2FpdCB2aWRlb3MuZXZhbHVhdGVBbGwoKGFsbCkgPT4gYWxsLm1hcCgodmlkZW8pID0+IHZpZGVvLmN1cnJlbnRUaW1lKSlcblx0XHRleHBlY3QodGltZXNbMV0pLnRvQmVDbG9zZVRvKHRpbWVzWzBdLCAzKVxuXHR9KVxuXG5cdHRlc3QoJ2EgUmV2aWV3IExpbmsgcmVtZW1iZXJzIHRoZSBsaXN0IGZvciBpdHNlbGYnLCBhc3luYyAoeyBwbGF5d3JpZ2h0IH0pID0+IHtcblx0XHRjb25zdCBhcGkgPSBhd2FpdCBwbGF5d3JpZ2h0LnJlcXVlc3QubmV3Q29udGV4dCh7IGJhc2VVUkw6IFVSTCwgaHR0cENyZWRlbnRpYWxzOiBhdXRoLCBleHRyYUhUVFBIZWFkZXJzOiBvY3NIZWFkZXJzIH0pXG5cdFx0Ly8gVGhlIGxhbmRpbmcgcGFnZSBvcGVucyBvbmx5IHdoZXJlIGEgbGluayBzaG93cyBzZXZlcmFsIEFzc2V0c1xuXHRcdGNvbnN0IGRhdiA9IGAvcmVtb3RlLnBocC9kYXYvZmlsZXMvJHtVU0VSfS8ke2ZvbGRlcn1gXG5cdFx0Y29uc3QgY291bnQgPSBhc3luYyAoKSA9PiAoYXdhaXQgKGF3YWl0IGFwaS5nZXQoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHMvJHtwcm9qZWN0SWR9P2Zvcm1hdD1qc29uYCkpLmpzb24oKSkub2NzLmRhdGEuYXNzZXRzLmxlbmd0aFxuXHRcdGNvbnN0IGJlZm9yZSA9IGF3YWl0IGNvdW50KClcblx0XHRleHBlY3QoKGF3YWl0IGFwaS5mZXRjaChgJHtkYXZ9L2xpbmtsaXN0LndlYm1gLCB7IG1ldGhvZDogJ1BVVCcsIGRhdGE6IHJlYWRGaWxlU3luYyhDTElQKSB9KSkuc3RhdHVzKCkpLnRvQmUoMjAxKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKGNvdW50KS50b0JlKGJlZm9yZSArIDEpXG5cdFx0Y29uc3QgbWFrZSA9IGFzeW5jICgpID0+IChhd2FpdCAoYXdhaXQgYXBpLnBvc3QoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHMvJHtwcm9qZWN0SWR9L2xpbmtzP2Zvcm1hdD1qc29uYCkpLmpzb24oKSkub2NzLmRhdGEudG9rZW5cblx0XHRjb25zdCBbb25lLCBvdGhlcl0gPSBbYXdhaXQgbWFrZSgpLCBhd2FpdCBtYWtlKCldXG5cdFx0YXdhaXQgYXBpLmRpc3Bvc2UoKVxuXG5cdFx0Y29uc3QgdmlzaXRvciA9IGF3YWl0IGJyb3dzZXIubmV3Q29udGV4dCh7IGJhc2VVUkw6IEJST1dTRVJfVVJMIH0pXG5cdFx0Y29uc3QgcmV2aWV3ZXIgPSBhd2FpdCB2aXNpdG9yLm5ld1BhZ2UoKVxuXHRcdGF3YWl0IHJldmlld2VyLmdvdG8oYC9hcHBzL2RlbGl2ZXIvcy8ke29uZX1gKVxuXHRcdGF3YWl0IGV4cGVjdChyZXZpZXdlci5sb2NhdG9yKCcuZGVsaXZlci1sYW5kaW5nX19jYXJkJykuZmlyc3QoKSkudG9CZVZpc2libGUoKVxuXHRcdGF3YWl0IGV4cGVjdChyZXZpZXdlci5sb2NhdG9yKCcuZGVsaXZlci1sYW5kaW5nX19ncmlkLS1saXN0JykpLnRvSGF2ZUNvdW50KDApXG5cdFx0Ly8gQW4gQXNzZXQgaXMgcGlja2VkIGZvciB0aGUgWklQIGluIGNhcmRzIGFuZCBpbiByb3dzXG5cdFx0Y29uc3QgcGljayA9IHJldmlld2VyLmxvY2F0b3IoJy5kZWxpdmVyLWxhbmRpbmdfX3BpY2s6bm90KDpkaXNhYmxlZCknKS5maXJzdCgpXG5cdFx0YXdhaXQgcGljay5jaGVjaygpXG5cdFx0YXdhaXQgZXhwZWN0KHJldmlld2VyLmdldEJ5Um9sZSgnbGluaycsIHsgbmFtZTogJ0Rvd25sb2FkIHNlbGVjdGlvbicgfSkpLnRvQmVWaXNpYmxlKClcblx0XHRhd2FpdCBwaWNrLnVuY2hlY2soKVxuXHRcdGF3YWl0IGV4cGVjdChyZXZpZXdlci5nZXRCeVJvbGUoJ2xpbmsnLCB7IG5hbWU6ICdEb3dubG9hZCBzZWxlY3Rpb24nIH0pKS50b0hhdmVDb3VudCgwKVxuXHRcdGF3YWl0IHJldmlld2VyLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnU2hvdyB0aGUgQXNzZXRzIGFzIGEgbGlzdCcgfSkuY2xpY2soKVxuXHRcdGF3YWl0IHBpY2suY2hlY2soKVxuXHRcdGF3YWl0IGV4cGVjdChyZXZpZXdlci5nZXRCeVJvbGUoJ2xpbmsnLCB7IG5hbWU6ICdEb3dubG9hZCBzZWxlY3Rpb24nIH0pKS50b0JlVmlzaWJsZSgpXG5cdFx0YXdhaXQgcGljay51bmNoZWNrKClcblx0XHRhd2FpdCBleHBlY3QocmV2aWV3ZXIubG9jYXRvcignLmRlbGl2ZXItbGFuZGluZ19fZ3JpZC0tbGlzdCcpKS50b0hhdmVDb3VudCgxKVxuXHRcdGF3YWl0IGV4cGVjdChyZXZpZXdlci5sb2NhdG9yKCcuZGVsaXZlci1sYW5kaW5nX19mYWN0cycpLmZpcnN0KCkpLnRvQ29udGFpblRleHQoJ1YxJylcblx0XHRhd2FpdCByZXZpZXdlci5yZWxvYWQoKVxuXHRcdGF3YWl0IGV4cGVjdChyZXZpZXdlci5sb2NhdG9yKCcuZGVsaXZlci1sYW5kaW5nX19ncmlkLS1saXN0JykpLnRvSGF2ZUNvdW50KDEpXG5cdFx0Ly8gQW5vdGhlciBsaW5rIG9mIHRoZSBzYW1lIFByb2plY3QgaXMgc3RpbGwgY2FyZHNcblx0XHRhd2FpdCByZXZpZXdlci5nb3RvKGAvYXBwcy9kZWxpdmVyL3MvJHtvdGhlcn1gKVxuXHRcdGF3YWl0IGV4cGVjdChyZXZpZXdlci5sb2NhdG9yKCcuZGVsaXZlci1sYW5kaW5nX19jYXJkJykuZmlyc3QoKSkudG9CZVZpc2libGUoKVxuXHRcdGF3YWl0IGV4cGVjdChyZXZpZXdlci5sb2NhdG9yKCcuZGVsaXZlci1sYW5kaW5nX19ncmlkLS1saXN0JykpLnRvSGF2ZUNvdW50KDApXG5cdFx0YXdhaXQgdmlzaXRvci5jbG9zZSgpXG5cdFx0Y29uc3QgY2xlYW51cCA9IGF3YWl0IHBsYXl3cmlnaHQucmVxdWVzdC5uZXdDb250ZXh0KHsgYmFzZVVSTDogVVJMLCBodHRwQ3JlZGVudGlhbHM6IGF1dGggfSlcblx0XHRhd2FpdCBjbGVhbnVwLmZldGNoKGAke2Rhdn0vbGlua2xpc3Qud2VibWAsIHsgbWV0aG9kOiAnREVMRVRFJyB9KVxuXHRcdGF3YWl0IGNsZWFudXAuZGlzcG9zZSgpXG5cdH0pXG59KVxuXG50ZXN0LmRlc2NyaWJlKCdBdWRpbyByZXZpZXcnLCAoKSA9PiB7XG5cdGxldCBicm93c2VyXG5cdGxldCBjb250ZXh0XG5cdGxldCBwYWdlXG5cdGxldCBmb2xkZXJcblx0bGV0IHZlcnNpb25JZFxuXHRsZXQgY2xpcFZlcnNpb25JZFxuXHRsZXQgcHJvamVjdElkXG5cblx0dGVzdC5iZWZvcmVBbGwoYXN5bmMgKHsgcGxheXdyaWdodCB9KSA9PiB7XG5cdFx0YXdhaXQgdGVzdFVzZXIocGxheXdyaWdodClcblx0XHRjb25zdCBhcGkgPSBhd2FpdCBwbGF5d3JpZ2h0LnJlcXVlc3QubmV3Q29udGV4dCh7IGJhc2VVUkw6IFVSTCwgaHR0cENyZWRlbnRpYWxzOiBhdXRoLCBleHRyYUhUVFBIZWFkZXJzOiBvY3NIZWFkZXJzIH0pXG5cdFx0Zm9sZGVyID0gJ2RlbGl2ZXItZTJlLScgKyByYW5kb21CeXRlcyg0KS50b1N0cmluZygnaGV4Jylcblx0XHRjb25zdCBkYXYgPSBgL3JlbW90ZS5waHAvZGF2L2ZpbGVzLyR7VVNFUn0vJHtmb2xkZXJ9YFxuXHRcdGV4cGVjdCgoYXdhaXQgYXBpLmZldGNoKGRhdiwgeyBtZXRob2Q6ICdNS0NPTCcgfSkpLnN0YXR1cygpKS50b0JlKDIwMSlcblx0XHRleHBlY3QoKGF3YWl0IGFwaS5mZXRjaChgJHtkYXZ9L2xvbmctbWl4LndlYm1gLCB7IG1ldGhvZDogJ1BVVCcsIGRhdGE6IHJlYWRGaWxlU3luYyhMT05HX01JWCkgfSkpLnN0YXR1cygpKS50b0JlKDIwMSlcblx0XHQvLyBBIHZpZGVvIGJlc2lkZSBpdCwgdG8gc3RlcCB0byBmcm9tIHRoZSBSZXZpZXcgdmlld1xuXHRcdGV4cGVjdCgoYXdhaXQgYXBpLmZldGNoKGAke2Rhdn0vY2xpcC53ZWJtYCwgeyBtZXRob2Q6ICdQVVQnLCBkYXRhOiByZWFkRmlsZVN5bmMoQ0xJUCkgfSkpLnN0YXR1cygpKS50b0JlKDIwMSlcblx0XHRjb25zdCBjcmVhdGVkID0gYXdhaXQgYXBpLnBvc3QoJy9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHM/Zm9ybWF0PWpzb24nLCB7XG5cdFx0XHRkYXRhOiB7IGZvbGRlcklkOiBhd2FpdCBmaWxlSWQoYXBpLCBkYXYpLCBhdXRvSW50YWtlOiB0cnVlIH0sXG5cdFx0fSlcblx0XHRwcm9qZWN0SWQgPSAoYXdhaXQgY3JlYXRlZC5qc29uKCkpLm9jcy5kYXRhLmlkXG5cdFx0Y29uc3QgcHJvamVjdCA9IGF3YWl0IGFwaS5nZXQoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHMvJHtwcm9qZWN0SWR9P2Zvcm1hdD1qc29uYClcblx0XHRjb25zdCBhc3NldHMgPSAoYXdhaXQgcHJvamVjdC5qc29uKCkpLm9jcy5kYXRhLmFzc2V0c1xuXHRcdHZlcnNpb25JZCA9IGFzc2V0cy5maW5kKChhc3NldCkgPT4gYXNzZXQubmFtZSA9PT0gJ2xvbmctbWl4JykudmVyc2lvbnNbMF0uaWRcblx0XHRjbGlwVmVyc2lvbklkID0gYXNzZXRzLmZpbmQoKGFzc2V0KSA9PiBhc3NldC5uYW1lID09PSAnY2xpcCcpLnZlcnNpb25zWzBdLmlkXG5cdFx0YXdhaXQgYXBpLmRpc3Bvc2UoKVxuXHRcdC8vIGZmbXBlZyByZWFkcyB0aGUgbWl4IGFuZCBtYWtlcyBpdHMgV2F2ZWZvcm1cblx0XHRleGVjRmlsZVN5bmMoJ2RvY2tlcicsIFsnY29tcG9zZScsICdleGVjJywgJy1UJywgJy11JywgJ3d3dy1kYXRhJywgJ25leHRjbG91ZCcsICdwaHAnLCAnb2NjJywgJ2RlbGl2ZXI6d29ya2VyJywgJy0tb25jZSddLCB7IHN0ZGlvOiAnaW5oZXJpdCcgfSlcblxuXHRcdGJyb3dzZXIgPSBhd2FpdCBjaHJvbWl1bS5jb25uZWN0T3ZlckNEUChDRFApXG5cdFx0Y29udGV4dCA9IGF3YWl0IGJyb3dzZXIubmV3Q29udGV4dCh7IGJhc2VVUkw6IEJST1dTRVJfVVJMIH0pXG5cdFx0cGFnZSA9IGF3YWl0IGNvbnRleHQubmV3UGFnZSgpXG5cdFx0YXdhaXQgbG9naW4ocGFnZSlcblx0fSlcblxuXHR0ZXN0LmFmdGVyQWxsKGFzeW5jICh7IHBsYXl3cmlnaHQgfSkgPT4ge1xuXHRcdGF3YWl0IGNvbnRleHQ/LmNsb3NlKClcblx0XHRhd2FpdCBicm93c2VyPy5jbG9zZSgpXG5cdFx0Y29uc3QgYXBpID0gYXdhaXQgcGxheXdyaWdodC5yZXF1ZXN0Lm5ld0NvbnRleHQoeyBiYXNlVVJMOiBVUkwsIGh0dHBDcmVkZW50aWFsczogYXV0aCwgZXh0cmFIVFRQSGVhZGVyczogb2NzSGVhZGVycyB9KVxuXHRcdGF3YWl0IGFwaS5kZWxldGUoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHMvJHtwcm9qZWN0SWR9P2Zvcm1hdD1qc29uYClcblx0XHRhd2FpdCBhcGkuZmV0Y2goYC9yZW1vdGUucGhwL2Rhdi9maWxlcy8ke1VTRVJ9LyR7Zm9sZGVyfWAsIHsgbWV0aG9kOiAnREVMRVRFJyB9KVxuXHRcdGF3YWl0IGFwaS5kaXNwb3NlKClcblx0fSlcblxuXHR0ZXN0KCdhIGxvbmcgYXVkaW8gVmVyc2lvbiBvcGVucyB6b29tZWQsIHNjcm9sbHMgdW5kZXIgaXRzIGNlbnRyZWQgcGxheWhlYWQgYW5kIHNlZWtzIHdpdGhvdXQgc3RvcHBpbmcnLCBhc3luYyAoKSA9PiB7XG5cdFx0YXdhaXQgcGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL3ZlcnNpb25zLyR7dmVyc2lvbklkfWApXG5cdFx0Y29uc3QgY2FudmFzID0gcGFnZS5sb2NhdG9yKCcuZGVsaXZlci13YXZlIGNhbnZhcycpXG5cdFx0YXdhaXQgZXhwZWN0KGNhbnZhcykudG9CZVZpc2libGUoKVxuXHRcdGNvbnN0IGF1ZGlvID0gcGFnZS5sb2NhdG9yKCd2aWRlby5kZWxpdmVyLXBsYXllcl9fdmlkZW8nKVxuXHRcdGF3YWl0IGV4cGVjdChhdWRpbykudG9IYXZlSlNQcm9wZXJ0eSgncmVhZHlTdGF0ZScsIDQpXG5cdFx0Y29uc3QgdGltZSA9ICgpID0+IGF1ZGlvLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LmN1cnJlbnRUaW1lKVxuXHRcdC8vIFRoZSBwbGF5aGVhZCBpcyB0aGUgd2hpdGUgbGluZSBkb3duIHRoZSBtaWRkbGUgb2YgdGhlIHN0YWdlXG5cdFx0Y29uc3QgY2VudHJlID0gKCkgPT4gY2FudmFzLmV2YWx1YXRlKChlbGVtZW50KSA9PiB7XG5cdFx0XHRjb25zdCBwaXhlbCA9IGVsZW1lbnQuZ2V0Q29udGV4dCgnMmQnKS5nZXRJbWFnZURhdGEoTWF0aC5yb3VuZChlbGVtZW50LndpZHRoIC8gMikgLSAxLCBlbGVtZW50LmhlaWdodCAtIE1hdGgucm91bmQoNDQgKiBlbGVtZW50LndpZHRoIC8gZWxlbWVudC5jbGllbnRXaWR0aCksIDEsIDEpLmRhdGFcblx0XHRcdHJldHVybiBwaXhlbFswXSArIHBpeGVsWzFdICsgcGl4ZWxbMl1cblx0XHR9KVxuXG5cdFx0Ly8gT25lIG1pbnV0ZSBvZiB0aGUgc2l4IG9uIHRoZSBzdGFnZTsgb24gdGhlIGJhciB1bmRlciBpdCB0aGUgaGFsZiBhZnRlciB0aGUgc3RhcnRcblx0XHRhd2FpdCBleHBlY3QocGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJzEgbWluJyB9KSkudG9IYXZlQXR0cmlidXRlKCdhcmlhLXByZXNzZWQnLCAndHJ1ZScpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICc1IG1pbicgfSkpLnRvQmVWaXNpYmxlKClcblx0XHRjb25zdCBzaG93biA9IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX193aW5kb3cnKVxuXHRcdGNvbnN0IHdpZHRoID0gYXN5bmMgKCkgPT4gcGFyc2VGbG9hdChhd2FpdCBzaG93bi5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5zdHlsZS53aWR0aC5tYXRjaCgvW1xcZC5dKyUvKVswXSkpXG5cdFx0ZXhwZWN0KGF3YWl0IHdpZHRoKCkpLnRvQmVDbG9zZVRvKDMwIC8gMzYwICogMTAwLCAwKVxuXHRcdGV4cGVjdChhd2FpdCBjZW50cmUoKSkudG9CZSg3NjUpXG5cblx0XHQvLyBQbGF5aW5nLCB0aGUgd2F2ZSBtb3ZlcyB1bmRlciB0aGUgcGxheWhlYWQsIHdoaWNoIHN0YXlzIGluIHRoZSBtaWRkbGVcblx0XHRjb25zdCBzdGlsbCA9IGF3YWl0IGNhbnZhcy5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC50b0RhdGFVUkwoKSlcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnUGxheSAoU3BhY2UpJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwodGltZSkudG9CZUdyZWF0ZXJUaGFuKDEpXG5cdFx0ZXhwZWN0KGF3YWl0IGNhbnZhcy5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC50b0RhdGFVUkwoKSkpLm5vdC50b0JlKHN0aWxsKVxuXHRcdGV4cGVjdChhd2FpdCBjZW50cmUoKSkudG9CZSg3NjUpXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwod2lkdGgpLnRvQmVHcmVhdGVyVGhhbigzMCAvIDM2MCAqIDEwMCArIDAuMSlcblxuXHRcdC8vIEEgY2xpY2sgaW4gdGhlIHN0cmlwLCBhIHF1YXJ0ZXIgb2YgdGhlIHN0YWdlIHRvIHRoZSByaWdodCwgZ29lcyAxNSBzZWNvbmRzIG9uIGFuZCBrZWVwcyBwbGF5aW5nXG5cdFx0Y29uc3QgYm94ID0gYXdhaXQgY2FudmFzLmJvdW5kaW5nQm94KClcblx0XHRjb25zdCBiZWZvcmUgPSBhd2FpdCB0aW1lKClcblx0XHRhd2FpdCBjYW52YXMuY2xpY2soeyBwb3NpdGlvbjogeyB4OiBib3gud2lkdGggKiAwLjc1LCB5OiBib3guaGVpZ2h0IC0gMjAgfSB9KVxuXHRcdGV4cGVjdChhd2FpdCB0aW1lKCkgLSBiZWZvcmUpLnRvQmVHcmVhdGVyVGhhbigxNClcblx0XHRleHBlY3QoYXdhaXQgdGltZSgpIC0gYmVmb3JlKS50b0JlTGVzc1RoYW4oMTcpXG5cdFx0ZXhwZWN0KGF3YWl0IGF1ZGlvLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LnBhdXNlZCkpLnRvQmUoZmFsc2UpXG5cblx0XHQvLyBBIHpvb20gc3RlcCBuYXJyb3dzIHRoZSB3aW5kb3csIGFuZCB0aGUgd2hvbGUgc2hvd3MgYWxsIG9mIGl0XG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJzE1IHMnIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJzE1IHMnIH0pKS50b0hhdmVBdHRyaWJ1dGUoJ2FyaWEtcHJlc3NlZCcsICd0cnVlJylcblx0XHRleHBlY3QoYXdhaXQgd2lkdGgoKSkudG9CZUNsb3NlVG8oMTUgLyAzNjAgKiAxMDAsIDApXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1dob2xlJywgZXhhY3Q6IHRydWUgfSkuY2xpY2soKVxuXHRcdGV4cGVjdChhd2FpdCB3aWR0aCgpKS50b0JlKDEwMClcblx0XHQvLyBPdmVyIHRoZSB3aG9sZSBwaWVjZSB0aGUgd2F2ZSBhZnRlciB0aGUgcGxheWhlYWQgaXMgbm90IGRyYXduIGFzIHBsYXllZFxuXHRcdGNvbnN0IHBsYXllZEFmdGVyID0gYXdhaXQgY2FudmFzLmV2YWx1YXRlKChlbGVtZW50KSA9PiB7XG5cdFx0XHRjb25zdCBwcm9iZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NwYW4nKVxuXHRcdFx0cHJvYmUuc3R5bGUuY29sb3IgPSAndmFyKC0tY29sb3ItcHJpbWFyeS1lbGVtZW50KSdcblx0XHRcdGVsZW1lbnQucGFyZW50RWxlbWVudC5hcHBlbmQocHJvYmUpXG5cdFx0XHRjb25zdCBwcmltYXJ5ID0gZ2V0Q29tcHV0ZWRTdHlsZShwcm9iZSkuY29sb3IubWF0Y2goL1xcZCsvZykubWFwKE51bWJlcilcblx0XHRcdHByb2JlLnJlbW92ZSgpXG5cdFx0XHRjb25zdCByYXRpbyA9IGVsZW1lbnQud2lkdGggLyBlbGVtZW50LmNsaWVudFdpZHRoXG5cdFx0XHRjb25zdCByb3cgPSBlbGVtZW50LmdldENvbnRleHQoJzJkJykuZ2V0SW1hZ2VEYXRhKE1hdGgucm91bmQoZWxlbWVudC53aWR0aCAvIDIpLCBNYXRoLnJvdW5kKCg0MCArIChlbGVtZW50LmNsaWVudEhlaWdodCAtIDgwKSAvIDIpICogcmF0aW8pLCBNYXRoLnJvdW5kKGVsZW1lbnQud2lkdGggLyAyKSwgMSkuZGF0YVxuXHRcdFx0bGV0IGNvdW50ID0gMFxuXHRcdFx0Zm9yIChsZXQgYXQgPSAwOyBhdCA8IHJvdy5sZW5ndGg7IGF0ICs9IDQpIHtcblx0XHRcdFx0Y291bnQgKz0gTWF0aC5tYXgoLi4uWzAsIDEsIDJdLm1hcCgoY2hhbm5lbCkgPT4gTWF0aC5hYnMocm93W2F0ICsgY2hhbm5lbF0gLSBwcmltYXJ5W2NoYW5uZWxdKSkpIDwgOCA/IDEgOiAwXG5cdFx0XHR9XG5cdFx0XHRyZXR1cm4gY291bnRcblx0XHR9KVxuXHRcdGV4cGVjdChwbGF5ZWRBZnRlcikudG9CZSgwKVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdQYXVzZSAoU3BhY2UpJyB9KS5jbGljaygpXG5cdH0pXG5cblx0dGVzdCgndGhlIGJhcnMga2VlcCB0aGVpciBoZWlnaHRzIGFuZCBtb3ZlIGJ5IHdob2xlIHBpeGVscyBmcm9tIG9uZSBtb21lbnQgdG8gYW5vdGhlciwgb24gYSBzdGFnZSBvZiBhbiBvZGQgd2lkdGggdG9vJywgYXN5bmMgKCkgPT4ge1xuXHRcdC8vIEFuIG9kZCBudW1iZXIgb2YgcGl4ZWxzIGFjcm9zcywgd2hlcmUgYSBwbGF5aGVhZCBhbmQgd2luZG93IHJvdW5kZWQgYXBhcnQgdHJlbWJsZWRcblx0XHRhd2FpdCBwYWdlLnNldFZpZXdwb3J0U2l6ZSh7IHdpZHRoOiAxMjgxLCBoZWlnaHQ6IDgwMCB9KVxuXHRcdGF3YWl0IHBhZ2UuZ290byhgL2FwcHMvZGVsaXZlci92ZXJzaW9ucy8ke3ZlcnNpb25JZH1gKVxuXHRcdGNvbnN0IGNhbnZhcyA9IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItd2F2ZSBjYW52YXMnKVxuXHRcdGF3YWl0IGV4cGVjdChjYW52YXMpLnRvQmVWaXNpYmxlKClcblx0XHRjb25zdCBhdWRpbyA9IHBhZ2UubG9jYXRvcigndmlkZW8uZGVsaXZlci1wbGF5ZXJfX3ZpZGVvJylcblx0XHRhd2FpdCBleHBlY3QoYXVkaW8pLnRvSGF2ZUpTUHJvcGVydHkoJ3JlYWR5U3RhdGUnLCA0KVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICcxIG1pbicgfSkuY2xpY2soKVxuXHRcdC8vIFRoZSBjb3ZlcmFnZSBvZiBlYWNoIGRldmljZS1waXhlbCBjb2x1bW4gcmlnaHQgb2YgdGhlIHBsYXloZWFkLCB3aGVyZSBldmVyeSBiYXIgaXMgZHJhd24gYWxpa2Vcblx0XHRjb25zdCBjb2x1bW5zID0gYXN5bmMgKHNlY29uZHMpID0+IHtcblx0XHRcdC8vIE9uY2UgdGhlIGF1ZGlvIHN0YW5kcyB0aGVyZSwgYW5kIHRoZSBzdGFnZSBoYXMgZ2xpZGVkIHRoZXJlIGFuZCBzdGFuZHMgc3RpbGxcblx0XHRcdGF3YWl0IGF1ZGlvLmV2YWx1YXRlKChlbGVtZW50LCBhdCkgPT4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcblx0XHRcdFx0ZWxlbWVudC5hZGRFdmVudExpc3RlbmVyKCdzZWVrZWQnLCByZXNvbHZlLCB7IG9uY2U6IHRydWUgfSlcblx0XHRcdFx0ZWxlbWVudC5jdXJyZW50VGltZSA9IGF0XG5cdFx0XHR9KSwgc2Vjb25kcylcblx0XHRcdGF3YWl0IGNhbnZhcy5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcblx0XHRcdFx0bGV0IGJlZm9yZSA9ICcnXG5cdFx0XHRcdGNvbnN0IGZyYW1lID0gKCkgPT4ge1xuXHRcdFx0XHRcdGNvbnN0IG5vdyA9IGVsZW1lbnQudG9EYXRhVVJMKClcblx0XHRcdFx0XHRpZiAobm93ID09PSBiZWZvcmUpIHtcblx0XHRcdFx0XHRcdHJlc29sdmUoKVxuXHRcdFx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdFx0XHRiZWZvcmUgPSBub3dcblx0XHRcdFx0XHRcdHNldFRpbWVvdXQoKCkgPT4gcmVxdWVzdEFuaW1hdGlvbkZyYW1lKGZyYW1lKSwgNTApXG5cdFx0XHRcdFx0fVxuXHRcdFx0XHR9XG5cdFx0XHRcdHJlcXVlc3RBbmltYXRpb25GcmFtZShmcmFtZSlcblx0XHRcdH0pKVxuXHRcdFx0cmV0dXJuIGNhbnZhcy5ldmFsdWF0ZSgoZWxlbWVudCkgPT4ge1xuXHRcdFx0XHRjb25zdCByYXRpbyA9IGVsZW1lbnQud2lkdGggLyBlbGVtZW50LmNsaWVudFdpZHRoXG5cdFx0XHRcdGNvbnN0IHRvcCA9IE1hdGgucm91bmQoNDAgKiByYXRpbylcblx0XHRcdFx0Y29uc3QgYm90dG9tID0gZWxlbWVudC5oZWlnaHQgLSBNYXRoLnJvdW5kKDQwICogcmF0aW8pXG5cdFx0XHRcdGNvbnN0IGRhdGEgPSBlbGVtZW50LmdldENvbnRleHQoJzJkJykuZ2V0SW1hZ2VEYXRhKDAsIHRvcCwgZWxlbWVudC53aWR0aCwgYm90dG9tIC0gdG9wKS5kYXRhXG5cdFx0XHRcdHJldHVybiBBcnJheS5mcm9tKHsgbGVuZ3RoOiBlbGVtZW50LndpZHRoIH0sIChfLCB4KSA9PiB7XG5cdFx0XHRcdFx0bGV0IHN1bSA9IDBcblx0XHRcdFx0XHRmb3IgKGxldCB5ID0gMDsgeSA8IGJvdHRvbSAtIHRvcDsgeSsrKSB7XG5cdFx0XHRcdFx0XHRzdW0gKz0gZGF0YVsoeSAqIGVsZW1lbnQud2lkdGggKyB4KSAqIDQgKyAzXVxuXHRcdFx0XHRcdH1cblx0XHRcdFx0XHRyZXR1cm4gc3VtXG5cdFx0XHRcdH0pXG5cdFx0XHR9KVxuXHRcdH1cblx0XHRjb25zdCBiZWZvcmUgPSBhd2FpdCBjb2x1bW5zKDEwMClcblx0XHRjb25zdCBhZnRlciA9IGF3YWl0IGNvbHVtbnMoMTAzLjMpXG5cdFx0Y29uc3Qgd2lkdGggPSBiZWZvcmUubGVuZ3RoXG5cdFx0Ly8gMy4zIHMgYXQgYSBtaW51dGUgYWNyb3NzIGlzIDUuNSAlIG9mIHRoZSBzdGFnZTsgdGhlIGJlc3Qgd2hvbGUgc2hpZnQgZXhwbGFpbnMgZXZlcnkgY29sdW1uIGV4YWN0bHlcblx0XHRsZXQgYmVzdCA9IHsgc2hpZnQ6IDAsIGRpZmZlcmVuY2U6IEluZmluaXR5IH1cblx0XHRmb3IgKGxldCBzaGlmdCA9IDA7IHNoaWZ0IDw9IHdpZHRoIC8gMTA7IHNoaWZ0KyspIHtcblx0XHRcdGxldCBkaWZmZXJlbmNlID0gMFxuXHRcdFx0Zm9yIChsZXQgeCA9IE1hdGgucm91bmQod2lkdGggKiAwLjYpICsgc2hpZnQ7IHggPCB3aWR0aCAtIDI7IHgrKykge1xuXHRcdFx0XHRkaWZmZXJlbmNlICs9IE1hdGguYWJzKGJlZm9yZVt4XSAtIGFmdGVyW3ggLSBzaGlmdF0pXG5cdFx0XHR9XG5cdFx0XHRpZiAoZGlmZmVyZW5jZSA8IGJlc3QuZGlmZmVyZW5jZSkge1xuXHRcdFx0XHRiZXN0ID0geyBzaGlmdCwgZGlmZmVyZW5jZSB9XG5cdFx0XHR9XG5cdFx0fVxuXHRcdGV4cGVjdChiZXN0LmRpZmZlcmVuY2UpLnRvQmUoMClcblx0XHRleHBlY3QoTWF0aC5hYnMoYmVzdC5zaGlmdCAtIHdpZHRoICogMy4zIC8gNjApKS50b0JlTGVzc1RoYW5PckVxdWFsKDEpXG5cdFx0YXdhaXQgcGFnZS5zZXRWaWV3cG9ydFNpemUoeyB3aWR0aDogMTI4MCwgaGVpZ2h0OiA3MjAgfSlcblx0fSlcblxuXHR0ZXN0KCdhZnRlciBhIGNsaWNrIGluIHRoZSBzdHJpcCB0aGUgd2F2ZSBnbGlkZXMgdG8gdGhlIG5ldyBwbGFjZSB3aXRoaW4gaGFsZiBhIHNlY29uZCwgYW5kIGp1bXBzIHVuZGVyIHJlZHVjZWQgbW90aW9uJywgYXN5bmMgKCkgPT4ge1xuXHRcdGF3YWl0IHBhZ2UuZ290byhgL2FwcHMvZGVsaXZlci92ZXJzaW9ucy8ke3ZlcnNpb25JZH1gKVxuXHRcdGNvbnN0IGNhbnZhcyA9IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItd2F2ZSBjYW52YXMnKVxuXHRcdGF3YWl0IGV4cGVjdChjYW52YXMpLnRvQmVWaXNpYmxlKClcblx0XHRjb25zdCBhdWRpbyA9IHBhZ2UubG9jYXRvcigndmlkZW8uZGVsaXZlci1wbGF5ZXJfX3ZpZGVvJylcblx0XHRhd2FpdCBleHBlY3QoYXVkaW8pLnRvSGF2ZUpTUHJvcGVydHkoJ3JlYWR5U3RhdGUnLCA0KVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICcxIG1pbicgfSkuY2xpY2soKVxuXHRcdGF3YWl0IGF1ZGlvLmV2YWx1YXRlKChlbGVtZW50KSA9PiB7XG5cdFx0XHRlbGVtZW50LmN1cnJlbnRUaW1lID0gMTAwXG5cdFx0fSlcblx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiBjYW52YXMuZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQuZHJhd25BdCkpLnRvQmVDbG9zZVRvKDEwMC4wMDA1LCAyKVxuXHRcdGNvbnN0IGJveCA9IGF3YWl0IGNhbnZhcy5ib3VuZGluZ0JveCgpXG5cdFx0Ly8gVGhlIHNlY29uZHMgZHJhd24sIG9uIGV2ZXJ5IGZyYW1lIGZvciAwLjcgczogY2hlYXAgdG8gcmVjb3JkLCBhbmFseXNlZCBhZnRlcndhcmRzXG5cdFx0Y29uc3QgcmVjb3JkID0gKCkgPT4gY2FudmFzLmV2YWx1YXRlKChlbGVtZW50KSA9PiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuXHRcdFx0Y29uc3Qgc2FtcGxlcyA9IFtdXG5cdFx0XHRjb25zdCBzdGFydCA9IHBlcmZvcm1hbmNlLm5vdygpXG5cdFx0XHRjb25zdCBmcmFtZSA9ICgpID0+IHtcblx0XHRcdFx0c2FtcGxlcy5wdXNoKHsgYXQ6IHBlcmZvcm1hbmNlLm5vdygpIC0gc3RhcnQsIGRyYXduOiBlbGVtZW50LmRyYXduQXQgfSlcblx0XHRcdFx0aWYgKHBlcmZvcm1hbmNlLm5vdygpIC0gc3RhcnQgPCA3MDApIHtcblx0XHRcdFx0XHRyZXF1ZXN0QW5pbWF0aW9uRnJhbWUoZnJhbWUpXG5cdFx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdFx0cmVzb2x2ZShzYW1wbGVzKVxuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0XHRyZXF1ZXN0QW5pbWF0aW9uRnJhbWUoZnJhbWUpXG5cdFx0fSkpXG5cdFx0Y29uc3QgcXVhcnRlck9uID0geyBwb3NpdGlvbjogeyB4OiBib3gud2lkdGggKiAwLjc1LCB5OiBib3guaGVpZ2h0IC0gMjAgfSB9XG5cblx0XHRsZXQgcmVjb3JkaW5nID0gcmVjb3JkKClcblx0XHRhd2FpdCBjYW52YXMuY2xpY2socXVhcnRlck9uKVxuXHRcdGxldCBzYW1wbGVzID0gYXdhaXQgcmVjb3JkaW5nXG5cdFx0Y29uc3QgdGFyZ2V0ID0gYXdhaXQgYXVkaW8uZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQuY3VycmVudFRpbWUpXG5cdFx0ZXhwZWN0KHRhcmdldCkudG9CZUNsb3NlVG8oMTE1LCAwKVxuXHRcdGV4cGVjdChzYW1wbGVzLmF0KC0xKS5kcmF3bikudG9CZUNsb3NlVG8odGFyZ2V0LCAyKVxuXHRcdC8vIE9uIHRoZSB3YXksIHNvbWV3aGVyZSBzdHJpY3RseSBiZXR3ZWVuLCBhbmQgdGhlcmUgd2l0aGluIGhhbGYgYSBzZWNvbmQgb2Ygc2V0dGluZyBvZmZcblx0XHRleHBlY3Qoc2FtcGxlcy5zb21lKChlYWNoKSA9PiBlYWNoLmRyYXduID4gMTAwLjUgJiYgZWFjaC5kcmF3biA8IHRhcmdldCAtIDAuNSkpLnRvQmUodHJ1ZSlcblx0XHRjb25zdCBtb3ZlZCA9IHNhbXBsZXMuZmluZCgoZWFjaCkgPT4gZWFjaC5kcmF3biA+IDEwMC4wMSlcblx0XHRjb25zdCBhcnJpdmVkID0gc2FtcGxlcy5maW5kKChlYWNoKSA9PiBNYXRoLmFicyhlYWNoLmRyYXduIC0gdGFyZ2V0KSA8IDAuMDEpXG5cdFx0ZXhwZWN0KGFycml2ZWQuYXQgLSBtb3ZlZC5hdCkudG9CZUxlc3NUaGFuKDUwMClcblxuXHRcdC8vIFdpdGggcmVkdWNlZCBtb3Rpb24gaXQgaXMgdGhlcmUgYXQgb25jZVxuXHRcdGF3YWl0IHBhZ2UuZW11bGF0ZU1lZGlhKHsgcmVkdWNlZE1vdGlvbjogJ3JlZHVjZScgfSlcblx0XHRyZWNvcmRpbmcgPSByZWNvcmQoKVxuXHRcdGF3YWl0IGNhbnZhcy5jbGljayhxdWFydGVyT24pXG5cdFx0c2FtcGxlcyA9IGF3YWl0IHJlY29yZGluZ1xuXHRcdGV4cGVjdChzYW1wbGVzLmV2ZXJ5KChlYWNoKSA9PiBNYXRoLmFicyhlYWNoLmRyYXduIC0gdGFyZ2V0KSA8IDAuMDEgfHwgTWF0aC5hYnMoZWFjaC5kcmF3biAtICh0YXJnZXQgKyAxNSkpIDwgMC4wMSkpLnRvQmUodHJ1ZSlcblx0XHRhd2FpdCBwYWdlLmVtdWxhdGVNZWRpYSh7IHJlZHVjZWRNb3Rpb246IG51bGwgfSlcblx0fSlcblxuXHR0ZXN0KCd0aGUgd2F2ZSBmb2xsb3dzIGEgc3dpcGUgYXQgb25jZSwgbmV2ZXIgZmFsbHMgYSBnbGlkZSBiZWhpbmQgYSBoZWxkIGtleSwgYW5kIGEgY2xpY2sgZHVyaW5nIGEgZ2xpZGUgbGFuZHMgd2hlcmUgdGhlIHBvaW50ZXIgaXMnLCBhc3luYyAoKSA9PiB7XG5cdFx0YXdhaXQgcGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL3ZlcnNpb25zLyR7dmVyc2lvbklkfWApXG5cdFx0Y29uc3QgY2FudmFzID0gcGFnZS5sb2NhdG9yKCcuZGVsaXZlci13YXZlIGNhbnZhcycpXG5cdFx0YXdhaXQgZXhwZWN0KGNhbnZhcykudG9CZVZpc2libGUoKVxuXHRcdGNvbnN0IGF1ZGlvID0gcGFnZS5sb2NhdG9yKCd2aWRlby5kZWxpdmVyLXBsYXllcl9fdmlkZW8nKVxuXHRcdGF3YWl0IGV4cGVjdChhdWRpbykudG9IYXZlSlNQcm9wZXJ0eSgncmVhZHlTdGF0ZScsIDQpXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJzEgbWluJyB9KS5jbGljaygpXG5cdFx0Y29uc3QgZ29UbyA9IGFzeW5jIChzZWNvbmRzKSA9PiB7XG5cdFx0XHRhd2FpdCBhdWRpby5ldmFsdWF0ZSgoZWxlbWVudCwgYXQpID0+IHtcblx0XHRcdFx0ZWxlbWVudC5jdXJyZW50VGltZSA9IGF0XG5cdFx0XHR9LCBzZWNvbmRzKVxuXHRcdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gY2FudmFzLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LmRyYXduQXQpKS50b0JlQ2xvc2VUbyhzZWNvbmRzICsgMC4wMDA1LCAyKVxuXHRcdH1cblxuXHRcdC8vIEEgdHJhY2twYWQncyBzaWRld2F5cyBzd2lwZSBzZW5kcyBhIHdoZWVsIGV2ZW50IG9uIGV2ZXJ5IGZyYW1lOiB0aGUgd2F2ZSBzdGF5cyB3aXRoIHRoZSBzb3VuZFxuXHRcdGF3YWl0IGdvVG8oMTAwKVxuXHRcdGNvbnN0IHN3aXBlID0gYXdhaXQgY2FudmFzLmV2YWx1YXRlKChlbGVtZW50KSA9PiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuXHRcdFx0Y29uc3QgYXVkaW8gPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKCd2aWRlby5kZWxpdmVyLXBsYXllcl9fdmlkZW8nKVxuXHRcdFx0Y29uc3QgZ2FwcyA9IFtdXG5cdFx0XHRsZXQgY291bnQgPSAwXG5cdFx0XHRjb25zdCBmcmFtZSA9ICgpID0+IHtcblx0XHRcdFx0Z2Fwcy5wdXNoKE1hdGguYWJzKGVsZW1lbnQuZHJhd25BdCAtIGF1ZGlvLmN1cnJlbnRUaW1lKSlcblx0XHRcdFx0aWYgKGNvdW50KysgPCA1MCkge1xuXHRcdFx0XHRcdGVsZW1lbnQuZGlzcGF0Y2hFdmVudChuZXcgV2hlZWxFdmVudCgnd2hlZWwnLCB7IGRlbHRhWDogNiwgYnViYmxlczogdHJ1ZSwgY2FuY2VsYWJsZTogdHJ1ZSB9KSlcblx0XHRcdFx0XHRyZXF1ZXN0QW5pbWF0aW9uRnJhbWUoZnJhbWUpXG5cdFx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdFx0cmVzb2x2ZSh7IGdhcHMsIGVuZDogYXVkaW8uY3VycmVudFRpbWUgfSlcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdFx0cmVxdWVzdEFuaW1hdGlvbkZyYW1lKGZyYW1lKVxuXHRcdH0pKVxuXHRcdGV4cGVjdChzd2lwZS5lbmQpLnRvQmVHcmVhdGVyVGhhbigxMTApXG5cdFx0Ly8gT25lIHdoZWVsIGV2ZW50IGlzIDYgcHggb2YgODQwOiBsZXNzIHRoYW4gaGFsZiBhIHNlY29uZFxuXHRcdGV4cGVjdChNYXRoLm1heCguLi5zd2lwZS5nYXBzKSkudG9CZUxlc3NUaGFuKDEpXG5cblx0XHQvLyBTaGlmdCvihpIgaGVsZDogdGhlIHdhdmUgaXMgbmV2ZXIgYmVoaW5kIHdoZXJlIHRoZSBzb3VuZCB3YXMgYSBnbGlkZSAoYW5kIGEgZnJhbWUpIGVhcmxpZXJcblx0XHRhd2FpdCBnb1RvKDEwMClcblx0XHRjb25zdCB3YXRjaGluZyA9IGNhbnZhcy5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcblx0XHRcdGNvbnN0IGF1ZGlvID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcigndmlkZW8uZGVsaXZlci1wbGF5ZXJfX3ZpZGVvJylcblx0XHRcdGNvbnN0IHNhbXBsZXMgPSBbXVxuXHRcdFx0Y29uc3Qgc3RhcnQgPSBwZXJmb3JtYW5jZS5ub3coKVxuXHRcdFx0Y29uc3QgZnJhbWUgPSAoKSA9PiB7XG5cdFx0XHRcdHNhbXBsZXMucHVzaCh7IGF0OiBwZXJmb3JtYW5jZS5ub3coKSAtIHN0YXJ0LCBkcmF3bjogZWxlbWVudC5kcmF3bkF0LCBzb3VuZDogYXVkaW8uY3VycmVudFRpbWUgfSlcblx0XHRcdFx0aWYgKHBlcmZvcm1hbmNlLm5vdygpIC0gc3RhcnQgPCAxMjAwKSB7XG5cdFx0XHRcdFx0cmVxdWVzdEFuaW1hdGlvbkZyYW1lKGZyYW1lKVxuXHRcdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRcdHJlc29sdmUoc2FtcGxlcylcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdFx0cmVxdWVzdEFuaW1hdGlvbkZyYW1lKGZyYW1lKVxuXHRcdH0pKVxuXHRcdGF3YWl0IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcmV2aWV3X190aXRsZScpLmNsaWNrKClcblx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLmRvd24oJ1NoaWZ0Jylcblx0XHRmb3IgKGxldCByZXBlYXQgPSAwOyByZXBlYXQgPCAxNTsgcmVwZWF0KyspIHtcblx0XHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ0Fycm93UmlnaHQnKVxuXHRcdFx0YXdhaXQgcGFnZS53YWl0Rm9yVGltZW91dCgzMylcblx0XHR9XG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC51cCgnU2hpZnQnKVxuXHRcdGNvbnN0IGhlbGQgPSBhd2FpdCB3YXRjaGluZ1xuXHRcdGNvbnN0IHNvdW5kQXQgPSAodGltZSkgPT4gWy4uLmhlbGRdLnJldmVyc2UoKS5maW5kKChlYWNoKSA9PiBlYWNoLmF0IDw9IHRpbWUpPy5zb3VuZCA/PyAxMDBcblx0XHRmb3IgKGNvbnN0IGVhY2ggb2YgaGVsZCkge1xuXHRcdFx0ZXhwZWN0KGVhY2guZHJhd24pLnRvQmVHcmVhdGVyVGhhbk9yRXF1YWwoc291bmRBdChlYWNoLmF0IC0gMjUwKSAtIDAuMDEpXG5cdFx0fVxuXHRcdGV4cGVjdChoZWxkLmF0KC0xKS5kcmF3bikudG9CZUNsb3NlVG8oaGVsZC5hdCgtMSkuc291bmQsIDIpXG5cblx0XHQvLyBBIGNsaWNrIGluIHRoZSBzdHJpcCA0MCBweCByaWdodCBvZiB0aGUgcGxheWhlYWQgd2hpbGUgYSBnbGlkZSBydW5zIGdvZXMgdG8gd2hhdCBpcyBkcmF3biB1bmRlciBpdCwgbm90IGJlc2lkZSBpdFxuXHRcdGF3YWl0IGdvVG8oMTAwKVxuXHRcdGNvbnN0IGJveCA9IGF3YWl0IGNhbnZhcy5ib3VuZGluZ0JveCgpXG5cdFx0Ly8gVHdvIGNsaWNrcyBpbiB0aGUgcGFnZSBpdHNlbGYsIHR3byBmcmFtZXMgYXBhcnQsIHNvIHRoZSBzZWNvbmQgc3VyZWx5IGNvbWVzIHdoaWxlIHRoZSBmaXJzdCBvbmUncyBnbGlkZSBydW5zXG5cdFx0Y29uc3QgeyBkcmF3biwgbGFuZGVkIH0gPSBhd2FpdCBjYW52YXMuZXZhbHVhdGUoKGVsZW1lbnQpID0+IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG5cdFx0XHRjb25zdCBhdWRpbyA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJ3ZpZGVvLmRlbGl2ZXItcGxheWVyX192aWRlbycpXG5cdFx0XHRjb25zdCBib3ggPSBlbGVtZW50LmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpXG5cdFx0XHRjb25zdCBjbGljayA9ICh4KSA9PiB7XG5cdFx0XHRcdGNvbnN0IGF0ID0geyBjbGllbnRYOiBib3gubGVmdCArIHgsIGNsaWVudFk6IGJveC5ib3R0b20gLSAyMCwgcG9pbnRlcklkOiA3LCBwb2ludGVyVHlwZTogJ21vdXNlJywgYnV0dG9uOiAwLCBidWJibGVzOiB0cnVlIH1cblx0XHRcdFx0ZWxlbWVudC5kaXNwYXRjaEV2ZW50KG5ldyBQb2ludGVyRXZlbnQoJ3BvaW50ZXJkb3duJywgYXQpKVxuXHRcdFx0XHRlbGVtZW50LmRpc3BhdGNoRXZlbnQobmV3IFBvaW50ZXJFdmVudCgncG9pbnRlcnVwJywgYXQpKVxuXHRcdFx0fVxuXHRcdFx0Y2xpY2soYm94LndpZHRoICogMC43NSlcblx0XHRcdHJlcXVlc3RBbmltYXRpb25GcmFtZSgoKSA9PiByZXF1ZXN0QW5pbWF0aW9uRnJhbWUoKCkgPT4ge1xuXHRcdFx0XHRjb25zdCBkcmF3biA9IGVsZW1lbnQuZHJhd25BdFxuXHRcdFx0XHRjbGljayhib3gud2lkdGggLyAyICsgNDApXG5cdFx0XHRcdHJlc29sdmUoeyBkcmF3biwgbGFuZGVkOiBhdWRpby5jdXJyZW50VGltZSB9KVxuXHRcdFx0fSkpXG5cdFx0fSkpXG5cdFx0ZXhwZWN0KGRyYXduKS50b0JlTGVzc1RoYW4oMTE0LjUpXG5cdFx0ZXhwZWN0KE1hdGguYWJzKGxhbmRlZCAtIChkcmF3biArIDQwIC8gYm94LndpZHRoICogNjApKSkudG9CZUxlc3NUaGFuKDAuNClcblx0fSlcblxuXHR0ZXN0KCdkcmFnZ2luZyB0aGUgYmFyIHVuZGVyIHRoZSBzdGFnZSBtb3ZlcyB0aGUgd2F2ZSBsaXZlIGFuZCBsZWF2ZXMgaXQgd2hlcmUgdGhlIHBsYXloZWFkIGlzLCB3aXRoIHJlZHVjZWQgbW90aW9uIHRvbycsIGFzeW5jICgpID0+IHtcblx0XHRhd2FpdCBwYWdlLmVtdWxhdGVNZWRpYSh7IHJlZHVjZWRNb3Rpb246ICdyZWR1Y2UnIH0pXG5cdFx0YXdhaXQgcGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL3ZlcnNpb25zLyR7dmVyc2lvbklkfWApXG5cdFx0Y29uc3QgY2FudmFzID0gcGFnZS5sb2NhdG9yKCcuZGVsaXZlci13YXZlIGNhbnZhcycpXG5cdFx0YXdhaXQgZXhwZWN0KGNhbnZhcykudG9CZVZpc2libGUoKVxuXHRcdGNvbnN0IGF1ZGlvID0gcGFnZS5sb2NhdG9yKCd2aWRlby5kZWxpdmVyLXBsYXllcl9fdmlkZW8nKVxuXHRcdGF3YWl0IGV4cGVjdChhdWRpbykudG9IYXZlSlNQcm9wZXJ0eSgncmVhZHlTdGF0ZScsIDQpXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJzEgbWluJyB9KS5jbGljaygpXG5cdFx0Y29uc3Qgd2F2ZSA9ICgpID0+IGNhbnZhcy5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC50b0RhdGFVUkwoKSlcblx0XHRjb25zdCBiYXIgPSBhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fdGltZWxpbmUnKS5ib3VuZGluZ0JveCgpXG5cdFx0Y29uc3QgeSA9IGJhci55ICsgYmFyLmhlaWdodCAvIDJcblx0XHRhd2FpdCBwYWdlLm1vdXNlLm1vdmUoYmFyLnggKyBiYXIud2lkdGggKiAwLjEsIHkpXG5cdFx0Y29uc3Qgc3RhcnQgPSBhd2FpdCB3YXZlKClcblx0XHRhd2FpdCBwYWdlLm1vdXNlLmRvd24oKVxuXHRcdGF3YWl0IHBhZ2UubW91c2UubW92ZShiYXIueCArIGJhci53aWR0aCAqIDAuNSwgeSwgeyBzdGVwczogOCB9KVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IGF1ZGlvLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LmN1cnJlbnRUaW1lKSkudG9CZUdyZWF0ZXJUaGFuKDE3MClcblx0XHQvLyBUaGUgd2F2ZSBtb3ZlZCB3aXRoIHRoZSBwb2ludGVyIGJlZm9yZSByZWxlYXNlXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwod2F2ZSkubm90LnRvQmUoc3RhcnQpXG5cdFx0YXdhaXQgcGFnZS5tb3VzZS5tb3ZlKGJhci54ICsgYmFyLndpZHRoICogMC45LCB5LCB7IHN0ZXBzOiAxMiB9KVxuXHRcdGF3YWl0IHBhZ2UubW91c2UudXAoKVxuXHRcdGF3YWl0IHBhZ2Uud2FpdEZvclRpbWVvdXQoNTAwKVxuXHRcdC8vIERyYXduIGZyb20gdGhlIHRpbWUgdGhlIGVsZW1lbnQgaXMgYXQ6IGEgZnJlc2ggZHJhdyBjaGFuZ2VzIG5vdGhpbmdcblx0XHRjb25zdCBzZXR0bGVkID0gYXdhaXQgd2F2ZSgpXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJzE1IHMnIH0pLmNsaWNrKClcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnMSBtaW4nIH0pLmNsaWNrKClcblx0XHRhd2FpdCBwYWdlLndhaXRGb3JUaW1lb3V0KDMwMClcblx0XHRleHBlY3QoYXdhaXQgd2F2ZSgpKS50b0JlKHNldHRsZWQpXG5cdFx0Ly8gQSBzZWVrIHRoYXQgY2hhbmdlcyBubyBwcm9wIG9mIHRoZSBzdGFnZSAodGhlIGxhc3Qgb2YgYSBkcmFnIGxhbmRzIHNvLCB3aGlsZSB0aGUgZHJhZyBob2xkcyB0aW1ldXBkYXRlXG5cdFx0Ly8gYmFjaykgc3RpbGwgZHJhd3MgdGhlIHdhdmUgYWdhaW46IGhlcmUgdGltZXVwZGF0ZSBpcyBzdG9wcGVkIG9uIGl0cyB3YXkgdG8gdGhlIHBsYXllci4gT25jZSBpdCBoYXNcblx0XHQvLyBzZXR0bGVkLCB3aGF0ZXZlciBlbHNlIHJlZHJhd3MgaXMgbGV0IGdvIG9mLCBhbmQgdGhlIHdhdmUgbXVzdCBkcmF3IHdpdGhpbiB0d28gYW5pbWF0aW9uIGZyYW1lc1xuXHRcdGNvbnN0IGRyYXduID0gYXdhaXQgYXVkaW8uZXZhbHVhdGUoKGVsZW1lbnQpID0+IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG5cdFx0XHR3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcigndGltZXVwZGF0ZScsIChldmVudCkgPT4gZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCksIHRydWUpXG5cdFx0XHRjb25zdCBjbGVhciA9IENhbnZhc1JlbmRlcmluZ0NvbnRleHQyRC5wcm90b3R5cGUuY2xlYXJSZWN0XG5cdFx0XHRsZXQgZHJhd3MgPSAwXG5cdFx0XHRDYW52YXNSZW5kZXJpbmdDb250ZXh0MkQucHJvdG90eXBlLmNsZWFyUmVjdCA9IGZ1bmN0aW9uKC4uLmFyZ3MpIHtcblx0XHRcdFx0ZHJhd3MrK1xuXHRcdFx0XHRyZXR1cm4gY2xlYXIuYXBwbHkodGhpcywgYXJncylcblx0XHRcdH1cblx0XHRcdGVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcignc2Vla2VkJywgKCkgPT4ge1xuXHRcdFx0XHRkcmF3cyA9IDBcblx0XHRcdFx0cmVxdWVzdEFuaW1hdGlvbkZyYW1lKCgpID0+IHJlcXVlc3RBbmltYXRpb25GcmFtZSgoKSA9PiByZXNvbHZlKGRyYXdzKSkpXG5cdFx0XHR9LCB7IG9uY2U6IHRydWUgfSlcblx0XHRcdGVsZW1lbnQuY3VycmVudFRpbWUgLT0gMjBcblx0XHR9KSlcblx0XHRleHBlY3QoZHJhd24pLnRvQmVHcmVhdGVyVGhhbigwKVxuXHRcdGF3YWl0IHBhZ2UuZW11bGF0ZU1lZGlhKHsgcmVkdWNlZE1vdGlvbjogJ25vLXByZWZlcmVuY2UnIH0pXG5cdH0pXG5cblx0dGVzdCgnYSBkcmFnIG9uIHRoZSB3YXZlIGhvbGRzIHBsYXliYWNrIGFuZCBsZXRzIGl0IGdvIG9uLCBidXQgbm90IHBhc3QgdGhlIGVuZDsgQ3RybCBhbmQgdGhlIHdoZWVsIHpvb20gd2l0aGluIHRoZSBzdGVwcywgcmVtZW1iZXJlZCcsIGFzeW5jICgpID0+IHtcblx0XHRhd2FpdCBwYWdlLmdvdG8oYC9hcHBzL2RlbGl2ZXIvdmVyc2lvbnMvJHt2ZXJzaW9uSWR9YClcblx0XHRjb25zdCBjYW52YXMgPSBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXdhdmUgY2FudmFzJylcblx0XHRhd2FpdCBleHBlY3QoY2FudmFzKS50b0JlVmlzaWJsZSgpXG5cdFx0Y29uc3QgYXVkaW8gPSBwYWdlLmxvY2F0b3IoJ3ZpZGVvLmRlbGl2ZXItcGxheWVyX192aWRlbycpXG5cdFx0YXdhaXQgZXhwZWN0KGF1ZGlvKS50b0hhdmVKU1Byb3BlcnR5KCdyZWFkeVN0YXRlJywgNClcblx0XHRjb25zdCBzdGF0ZSA9ICgpID0+IGF1ZGlvLmV2YWx1YXRlKChlbGVtZW50KSA9PiAoeyB0aW1lOiBlbGVtZW50LmN1cnJlbnRUaW1lLCBwYXVzZWQ6IGVsZW1lbnQucGF1c2VkIH0pKVxuXHRcdGNvbnN0IHNob3duID0gcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX3dpbmRvdycpXG5cdFx0Y29uc3Qgd2lkdGggPSBhc3luYyAoKSA9PiBwYXJzZUZsb2F0KGF3YWl0IHNob3duLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LnN0eWxlLndpZHRoLm1hdGNoKC9bXFxkLl0rJS8pWzBdKSlcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnMSBtaW4nIH0pLmNsaWNrKClcblxuXHRcdC8vIEEgcXVhcnRlciBvZiB0aGUgc3RhZ2UgZHJhZ2dlZCB0byB0aGUgbGVmdCBpcyAxNSBzZWNvbmRzIG9uOyBwbGF5YmFjayBob2xkcyBtZWFud2hpbGUgYW5kIGdvZXMgb25cblx0XHRjb25zdCBib3ggPSBhd2FpdCBjYW52YXMuYm91bmRpbmdCb3goKVxuXHRcdGNvbnN0IHkgPSBib3gueSArIGJveC5oZWlnaHQgLyAyXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1BsYXkgKFNwYWNlKScgfSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKGFzeW5jICgpID0+IChhd2FpdCBzdGF0ZSgpKS50aW1lKS50b0JlR3JlYXRlclRoYW4oMSlcblx0XHRjb25zdCBiZWZvcmUgPSAoYXdhaXQgc3RhdGUoKSkudGltZVxuXHRcdGF3YWl0IHBhZ2UubW91c2UubW92ZShib3gueCArIGJveC53aWR0aCAqIDAuNzUsIHkpXG5cdFx0YXdhaXQgcGFnZS5tb3VzZS5kb3duKClcblx0XHRmb3IgKGxldCBzdGVwID0gMTsgc3RlcCA8PSAxMDsgc3RlcCsrKSB7XG5cdFx0XHRhd2FpdCBwYWdlLm1vdXNlLm1vdmUoYm94LnggKyBib3gud2lkdGggKiAoMC43NSAtIHN0ZXAgKiAwLjAyNSksIHkpXG5cdFx0fVxuXHRcdGV4cGVjdCgoYXdhaXQgc3RhdGUoKSkucGF1c2VkKS50b0JlKHRydWUpXG5cdFx0YXdhaXQgcGFnZS5tb3VzZS51cCgpXG5cdFx0Y29uc3QgYWZ0ZXIgPSBhd2FpdCBzdGF0ZSgpXG5cdFx0ZXhwZWN0KGFmdGVyLnBhdXNlZCkudG9CZShmYWxzZSlcblx0XHRleHBlY3QoYWZ0ZXIudGltZSAtIGJlZm9yZSkudG9CZUdyZWF0ZXJUaGFuKDE0KVxuXHRcdGV4cGVjdChhZnRlci50aW1lIC0gYmVmb3JlKS50b0JlTGVzc1RoYW4oMTcpXG5cblx0XHQvLyBEcmFnZ2VkIHBhc3QgdGhlIGVuZCBpdCBzdGF5cyB0aGVyZSwgcGF1c2VkLCBhcyBhdCB0aGUgbmF0dXJhbCBlbmQsIGFuZCBkb2VzIG5vdCBzdGFydCBvdmVyXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1dob2xlJywgZXhhY3Q6IHRydWUgfSkuY2xpY2soKVxuXHRcdGF3YWl0IHBhZ2UubW91c2UubW92ZShib3gueCArIGJveC53aWR0aCAvIDIsIHkpXG5cdFx0YXdhaXQgcGFnZS5tb3VzZS5kb3duKClcblx0XHRhd2FpdCBwYWdlLm1vdXNlLm1vdmUoYm94LnggKyBib3gud2lkdGggKiAwLjgsIHkpXG5cdFx0YXdhaXQgcGFnZS5tb3VzZS5tb3ZlKGJveC54ICsgYm94LndpZHRoICsgNTAsIHkpXG5cdFx0YXdhaXQgcGFnZS5tb3VzZS51cCgpXG5cdFx0YXdhaXQgcGFnZS53YWl0Rm9yVGltZW91dCg1MDApXG5cdFx0Y29uc3QgZW5kID0gYXdhaXQgc3RhdGUoKVxuXHRcdGV4cGVjdChlbmQucGF1c2VkKS50b0JlKHRydWUpXG5cdFx0ZXhwZWN0KGVuZC50aW1lKS50b0JlR3JlYXRlclRoYW4oMzU5KVxuXG5cdFx0Ly8gQ3RybCBhbmQgdGhlIHdoZWVsIHpvb20gaW4gZG93biB0byAxNSBzZWNvbmRzIGFuZCBvdXQgdXAgdG8gdGhlIHdob2xlLCBhbmQgYSByZWxvYWQga2VlcHMgaXRcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnMSBtaW4nIH0pLmNsaWNrKClcblx0XHRhd2FpdCBhdWRpby5ldmFsdWF0ZSgoZWxlbWVudCkgPT4ge1xuXHRcdFx0ZWxlbWVudC5jdXJyZW50VGltZSA9IDE4MFxuXHRcdH0pXG5cdFx0YXdhaXQgcGFnZS5tb3VzZS5tb3ZlKGJveC54ICsgYm94LndpZHRoIC8gMiwgeSlcblx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLmRvd24oJ0NvbnRyb2wnKVxuXHRcdGZvciAobGV0IG5vdGNoID0gMDsgbm90Y2ggPCA1OyBub3RjaCsrKSB7XG5cdFx0XHRhd2FpdCBwYWdlLm1vdXNlLndoZWVsKDAsIC0xMDApXG5cdFx0fVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnMTUgcycgfSkpLnRvSGF2ZUF0dHJpYnV0ZSgnYXJpYS1wcmVzc2VkJywgJ3RydWUnKVxuXHRcdGV4cGVjdChhd2FpdCB3aWR0aCgpKS50b0JlQ2xvc2VUbygxNSAvIDM2MCAqIDEwMCwgMClcblx0XHRmb3IgKGxldCBub3RjaCA9IDA7IG5vdGNoIDwgMTI7IG5vdGNoKyspIHtcblx0XHRcdGF3YWl0IHBhZ2UubW91c2Uud2hlZWwoMCwgMTAwKVxuXHRcdH1cblx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnVwKCdDb250cm9sJylcblx0XHRhd2FpdCBleHBlY3QocGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1dob2xlJywgZXhhY3Q6IHRydWUgfSkpLnRvSGF2ZUF0dHJpYnV0ZSgnYXJpYS1wcmVzc2VkJywgJ3RydWUnKVxuXHRcdGF3YWl0IHBhZ2UucmVsb2FkKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1dob2xlJywgZXhhY3Q6IHRydWUgfSkpLnRvSGF2ZUF0dHJpYnV0ZSgnYXJpYS1wcmVzc2VkJywgJ3RydWUnKVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICcxIG1pbicgfSkuY2xpY2soKVxuXHR9KVxuXG5cdHRlc3QoJ0MgY29tbWVudHMgb24gdGhlIHdhdmUsIGFuIGVtcHR5IGZpZWxkIGxldHMgZ28gb2YgdGhlIHBsYWNlLCBhbmQgYSBjaXJjbGUgb3BlbnMgYSBjYXJkIHRoYXQgZm9sbG93cyB0aGUgbGlzdCBhbmQga2VlcHMgYSBSZXBseSBoYWxmIHdyaXR0ZW4nLCBhc3luYyAoKSA9PiB7XG5cdFx0YXdhaXQgcGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL3ZlcnNpb25zLyR7dmVyc2lvbklkfWApXG5cdFx0Y29uc3QgY2FudmFzID0gcGFnZS5sb2NhdG9yKCcuZGVsaXZlci13YXZlIGNhbnZhcycpXG5cdFx0YXdhaXQgZXhwZWN0KGNhbnZhcykudG9CZVZpc2libGUoKVxuXHRcdGNvbnN0IGF1ZGlvID0gcGFnZS5sb2NhdG9yKCd2aWRlby5kZWxpdmVyLXBsYXllcl9fdmlkZW8nKVxuXHRcdGF3YWl0IGV4cGVjdChhdWRpbykudG9IYXZlSlNQcm9wZXJ0eSgncmVhZHlTdGF0ZScsIDQpXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJzEgbWluJyB9KS5jbGljaygpXG5cdFx0Y29uc3QgYm94ID0gYXdhaXQgY2FudmFzLmJvdW5kaW5nQm94KClcblx0XHRjb25zdCBmaWVsZCA9IHBhZ2UubG9jYXRvcignI2RlbGl2ZXItY29tbWVudC1ib2R5Jylcblx0XHRjb25zdCBhbmNob3IgPSBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRzX19hbmNob3InKVxuXHRcdC8vIEEgc2VlaywgYW5kIHRoZSB3YXZlIGdsaWRlZCB0aGVyZTogY2xpY2tzIGxhbmQgb24gd2hhdCBpcyBkcmF3blxuXHRcdGNvbnN0IGdvVG8gPSBhc3luYyAoc2Vjb25kcykgPT4ge1xuXHRcdFx0YXdhaXQgYXVkaW8uZXZhbHVhdGUoKGVsZW1lbnQsIGF0KSA9PiB7XG5cdFx0XHRcdGVsZW1lbnQuY3VycmVudFRpbWUgPSBhdFxuXHRcdFx0fSwgc2Vjb25kcylcblx0XHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IGNhbnZhcy5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5kcmF3bkF0KSkudG9CZUNsb3NlVG8oc2Vjb25kcyArIDAuMDAwNSwgMilcblx0XHR9XG5cdFx0Y29uc3Qgc2VuZCA9ICgpID0+IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tbWVudHNfX2Zvcm0gYnV0dG9uW3RpdGxlPVwiU2VuZCAoRW50ZXIpXCJdJykuY2xpY2soKVxuXHRcdGNvbnN0IHF1YXJ0ZXJPbiA9IHsgcG9zaXRpb246IHsgeDogYm94LndpZHRoICogMC43NSwgeTogYm94LmhlaWdodCAtIDIwIH0gfVxuXG5cdFx0Ly8gQSBjbGljayBpbiB0aGUgc3RyaXAgYSBxdWFydGVyIG9mIHRoZSBzdGFnZSBvbiBzZWVrcyAxNSBzZWNvbmRzIG9uLCBhbmQgQyBjb21tZW50cyB0aGVyZVxuXHRcdGF3YWl0IGNvbW1lbnRPblF1YXJ0ZXIocGFnZSwgY2FudmFzLCBxdWFydGVyT24pXG5cdFx0YXdhaXQgZXhwZWN0KGZpZWxkKS50b0JlRm9jdXNlZCgpXG5cdFx0YXdhaXQgZXhwZWN0KGFuY2hvcikudG9IYXZlVGV4dCgnMDoxNS4wMDAnKVxuXHRcdC8vIEVzY2FwZSBpbiB0aGUgZW1wdHkgZmllbGQgbGV0cyBnbyBvZiBpdDogdGhlIG5leHQgQ29tbWVudCBmb2xsb3dzIHRoZSBwbGF5ZXIgYWdhaW5cblx0XHRhd2FpdCBmaWVsZC5wcmVzcygnRXNjYXBlJylcblx0XHRhd2FpdCBnb1RvKDQwKVxuXHRcdGF3YWl0IGV4cGVjdChhbmNob3IpLnRvSGF2ZVRleHQoJzA6NDAuMDAwJylcblx0XHQvLyBXaXRoIGEgd29yZCBpbiB0aGUgZmllbGQgdGhlIHBsYWNlIHN0YXlzLCB1bnRpbCB0aGUgZmllbGQgaXMgZW1wdGllZFxuXHRcdGF3YWl0IGNvbW1lbnRPblF1YXJ0ZXIocGFnZSwgY2FudmFzLCBxdWFydGVyT24pXG5cdFx0YXdhaXQgZXhwZWN0KGFuY2hvcikudG9IYXZlVGV4dCgnMDo1NS4wMDAnKVxuXHRcdGF3YWl0IGZpZWxkLmZpbGwoJ2tlcHQnKVxuXHRcdGF3YWl0IGZpZWxkLnByZXNzKCdFc2NhcGUnKVxuXHRcdGF3YWl0IGdvVG8oMTAwKVxuXHRcdGF3YWl0IGV4cGVjdChhbmNob3IpLnRvSGF2ZVRleHQoJzA6NTUuMDAwJylcblx0XHRhd2FpdCBmaWVsZC5maWxsKCcnKVxuXHRcdGF3YWl0IGV4cGVjdChhbmNob3IpLnRvSGF2ZVRleHQoJzE6NDAuMDAwJylcblx0XHQvLyBBIGNsaWNrIGluIHRoZSBzdHJpcCwgd2hpY2ggc2Vla3MsIGxldHMgZ28gdG9vXG5cdFx0YXdhaXQgY29tbWVudE9uUXVhcnRlcihwYWdlLCBjYW52YXMsIHF1YXJ0ZXJPbilcblx0XHRhd2FpdCBleHBlY3QoYW5jaG9yKS50b0hhdmVUZXh0KCcxOjU1LjAwMCcpXG5cdFx0Ly8gT25jZSB0aGUgd2F2ZSBoYXMgZ2xpZGVkIHRoZXJlOiBhIGNsaWNrIGxhbmRzIG9uIHdoYXQgaXMgZHJhd24gdW5kZXIgaXRcblx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiBjYW52YXMuZXZhbHVhdGUoKGVsZW1lbnQpID0+IE1hdGguYWJzKGVsZW1lbnQuZHJhd25BdCAtIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJ3ZpZGVvLmRlbGl2ZXItcGxheWVyX192aWRlbycpLmN1cnJlbnRUaW1lKSkpLnRvQmVMZXNzVGhhbigwLjAxKVxuXHRcdGF3YWl0IGNhbnZhcy5jbGljayh7IHBvc2l0aW9uOiB7IHg6IGJveC53aWR0aCAqIDAuMjUsIHk6IGJveC5oZWlnaHQgLSAyMCB9IH0pXG5cdFx0YXdhaXQgZXhwZWN0KGFuY2hvcikudG9IYXZlVGV4dCgnMTo0MC4wMDAnKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IGNhbnZhcy5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gTWF0aC5hYnMoZWxlbWVudC5kcmF3bkF0IC0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcigndmlkZW8uZGVsaXZlci1wbGF5ZXJfX3ZpZGVvJykuY3VycmVudFRpbWUpKSkudG9CZUxlc3NUaGFuKDAuMDEpXG5cblx0XHRhd2FpdCBjb21tZW50T25RdWFydGVyKHBhZ2UsIGNhbnZhcywgcXVhcnRlck9uKVxuXHRcdGF3YWl0IGV4cGVjdChhbmNob3IpLnRvSGF2ZVRleHQoJzE6NTUuMDAwJylcblx0XHRhd2FpdCBmaWVsZC5maWxsKCdjbGlja2VkIGhlcmUnKVxuXHRcdGF3YWl0IHNlbmQoKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnQnKS5maWx0ZXIoeyBoYXNUZXh0OiAnY2xpY2tlZCBoZXJlJyB9KSkudG9CZVZpc2libGUoKVxuXG5cdFx0Ly8gQyBvbiBhdWRpbyBzdG9wcyBpdCwgYXMgb24gdmlkZW8sIHRoZSBDb21tZW50IHdoZXJlIGl0IHdhcyBhdCB0aGUga2V5IHByZXNzXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1BsYXkgKFNwYWNlKScgfSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IGF1ZGlvLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LmN1cnJlbnRUaW1lKSkudG9CZUdyZWF0ZXJUaGFuKDExNylcblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXJldmlld19fdGl0bGUnKS5jbGljaygpXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnYycpXG5cdFx0YXdhaXQgZXhwZWN0KGZpZWxkKS50b0JlRm9jdXNlZCgpXG5cdFx0YXdhaXQgcGFnZS53YWl0Rm9yVGltZW91dCg1MDApXG5cdFx0ZXhwZWN0KGF3YWl0IGF1ZGlvLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LnBhdXNlZCkpLnRvQmUodHJ1ZSlcblx0XHQvLyBUaGUgRnJhbWUgb2YgdGhlIGtleSBwcmVzczogd2hlcmUgdGhlIGVsZW1lbnQgc3RvcHBlZCwgdG8gdGhlIG1pbGxpc2Vjb25kXG5cdFx0Y29uc3Qgc3RvcHBlZCA9IGF3YWl0IGF1ZGlvLmV2YWx1YXRlKChlbGVtZW50KSA9PiBNYXRoLnJvdW5kKGVsZW1lbnQuY3VycmVudFRpbWUgKiAxMDAwKSlcblx0XHRjb25zdCBjbG9ja09mID0gKG1zKSA9PiBgJHtNYXRoLmZsb29yKG1zIC8gNjAwMDApfToke1N0cmluZyhNYXRoLmZsb29yKG1zICUgNjAwMDAgLyAxMDAwKSkucGFkU3RhcnQoMiwgJzAnKX0uJHtTdHJpbmcobXMgJSAxMDAwKS5wYWRTdGFydCgzLCAnMCcpfWBcblx0XHQvLyBUaGUgRnJhbWUncyBvd24gdGltZSBtYXkgZGlmZmVyIGZyb20gdGhlIGVsZW1lbnQncyBieSB0aGUgbGFzdCBtaWxsaXNlY29uZFxuXHRcdGF3YWl0IGV4cGVjdChhbmNob3IpLnRvSGF2ZVRleHQobmV3IFJlZ0V4cChgXigke2Nsb2NrT2Yoc3RvcHBlZCAtIDEpfXwke2Nsb2NrT2Yoc3RvcHBlZCl9fCR7Y2xvY2tPZihzdG9wcGVkICsgMSl9KSRgKSlcblx0XHRhd2FpdCBmaWVsZC5maWxsKCd3aGlsZSBpdCBwbGF5ZWQnKVxuXHRcdGF3YWl0IHNlbmQoKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnQnKS5maWx0ZXIoeyBoYXNUZXh0OiAnd2hpbGUgaXQgcGxheWVkJyB9KSkudG9CZVZpc2libGUoKVxuXG5cdFx0Ly8gU3RhbmRpbmcgb24gdGhlIGZpcnN0IENvbW1lbnQsIGl0cyBjaXJjbGUgaXMgdW5kZXIgdGhlIHBsYXloZWFkOyBhIGNsaWNrIG9uIGl0IG9wZW5zIGl0cyBjYXJkIGFuZCBkb2VzIG5vdCBzZWVrXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJzE1IHMnIH0pLmNsaWNrKClcblx0XHRjb25zdCBmaXJzdCA9IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tbWVudHNfX2xpc3QgPiAuZGVsaXZlci1jb21tZW50JykuZmlsdGVyKHsgaGFzVGV4dDogJ2NsaWNrZWQgaGVyZScgfSlcblx0XHRjb25zdCBzZWNvbmQgPSBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRzX19saXN0ID4gLmRlbGl2ZXItY29tbWVudCcpLmZpbHRlcih7IGhhc1RleHQ6ICd3aGlsZSBpdCBwbGF5ZWQnIH0pXG5cdFx0Y29uc3Qgb3BlbkZpcnN0ID0gYXN5bmMgKCkgPT4ge1xuXHRcdFx0YXdhaXQgZmlyc3QubG9jYXRvcignLmRlbGl2ZXItY29tbWVudF9fYW5jaG9yJykuY2xpY2soKVxuXHRcdFx0Y29uc3QgYXQgPSBhd2FpdCBhdWRpby5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5jdXJyZW50VGltZSlcblx0XHRcdGF3YWl0IGNhbnZhcy5jbGljayh7IHBvc2l0aW9uOiB7IHg6IGJveC53aWR0aCAvIDIsIHk6IGJveC5oZWlnaHQgLSAyMCB9IH0pXG5cdFx0XHRleHBlY3QoYXdhaXQgYXVkaW8uZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQuY3VycmVudFRpbWUpKS50b0JlKGF0KVxuXHRcdH1cblx0XHRhd2FpdCBvcGVuRmlyc3QoKVxuXHRcdGNvbnN0IGNhcmQgPSBwYWdlLmdldEJ5Um9sZSgnZGlhbG9nJywgeyBuYW1lOiAvXkNvbW1lbnQgIy8gfSlcblx0XHRhd2FpdCBleHBlY3QoY2FyZCkudG9Db250YWluVGV4dCgnY2xpY2tlZCBoZXJlJylcblx0XHRhd2FpdCBleHBlY3QoZmlyc3QpLnRvSGF2ZUNsYXNzKC9kZWxpdmVyLWNvbW1lbnQtLXNlbGVjdGVkLylcblx0XHQvLyBJdCBmb2xsb3dzIHRoZSBsaXN0OiBhbm90aGVyIENvbW1lbnQgcGlja2VkIHRoZXJlIHNob3dzIGluIGl0XG5cdFx0YXdhaXQgc2Vjb25kLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRfX2JvZHknKS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KGNhcmQpLnRvQ29udGFpblRleHQoJ3doaWxlIGl0IHBsYXllZCcpXG5cdFx0YXdhaXQgZmlyc3QubG9jYXRvcignLmRlbGl2ZXItY29tbWVudF9fYm9keScpLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QoY2FyZCkudG9Db250YWluVGV4dCgnY2xpY2tlZCBoZXJlJylcblx0XHQvLyBFc2NhcGUgbGVhdmVzIGEgUmVwbHkgaGFsZiB3cml0dGVuIGFsb25lOyBhIGNsaWNrIG9uIHRoZSBiYXIgY2xvc2VzIHRoZSBjYXJkLCBhbmQgdGhlIFJlcGx5IHdhaXRzIGZvciBpdFxuXHRcdGF3YWl0IGNhcmQuZ2V0QnlQbGFjZWhvbGRlcignV3JpdGUgYSBSZXBseScpLmZpbGwoJ2hhbGYnKVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ0VzY2FwZScpXG5cdFx0YXdhaXQgZXhwZWN0KGNhcmQpLnRvQmVWaXNpYmxlKClcblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fdGltZWxpbmUnKS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KGNhcmQpLnRvSGF2ZUNvdW50KDApXG5cdFx0YXdhaXQgb3BlbkZpcnN0KClcblx0XHRhd2FpdCBleHBlY3QoY2FyZC5nZXRCeVBsYWNlaG9sZGVyKCdXcml0ZSBhIFJlcGx5JykpLnRvSGF2ZVZhbHVlKCdoYWxmJylcblx0XHRhd2FpdCBjYXJkLmdldEJ5UGxhY2Vob2xkZXIoJ1dyaXRlIGEgUmVwbHknKS5maWxsKCdhbnN3ZXJlZCBvbiB0aGUgd2F2ZScpXG5cdFx0YXdhaXQgY2FyZC5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1JlcGx5JywgZXhhY3Q6IHRydWUgfSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdChmaXJzdC5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50LS1yZXBseScpKS50b0NvbnRhaW5UZXh0KCdhbnN3ZXJlZCBvbiB0aGUgd2F2ZScpXG5cdFx0YXdhaXQgZXhwZWN0KGNhcmQubG9jYXRvcignLmRlbGl2ZXItY29tbWVudC0tcmVwbHknKSkudG9Db250YWluVGV4dCgnYW5zd2VyZWQgb24gdGhlIHdhdmUnKVxuXHRcdC8vIFdpdGggbm90aGluZyBoYWxmIHdyaXR0ZW4sIEVzY2FwZSBjbG9zZXMgaXQgd2hlcmV2ZXIgdGhlIGZvY3VzIGlzXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1yZXZpZXdfX3RpdGxlJykuY2xpY2soKVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ0VzY2FwZScpXG5cdFx0YXdhaXQgZXhwZWN0KGNhcmQpLnRvSGF2ZUNvdW50KDApXG5cdFx0Ly8gQSBkb3VibGUgY2xpY2sgb24gdGhlIHdhdmUgd2hvc2UgZmlyc3QgY2xpY2sgY2xvc2VkIHRoZSBjYXJkIHNraXBzIG5vdGhpbmdcblx0XHRhd2FpdCBvcGVuRmlyc3QoKVxuXHRcdGF3YWl0IGV4cGVjdChjYXJkKS50b0JlVmlzaWJsZSgpXG5cdFx0Y29uc3QgY2xvc2luZyA9IGF3YWl0IGF1ZGlvLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LmN1cnJlbnRUaW1lKVxuXHRcdGF3YWl0IGNhbnZhcy5kYmxjbGljayh7IHBvc2l0aW9uOiB7IHg6IGJveC53aWR0aCAqIDAuOTUsIHk6IGJveC5oZWlnaHQgLyA0IH0gfSlcblx0XHRhd2FpdCBleHBlY3QoY2FyZCkudG9IYXZlQ291bnQoMClcblx0XHRleHBlY3QoYXdhaXQgYXVkaW8uZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQuY3VycmVudFRpbWUpKS50b0JlKGNsb3NpbmcpXG5cdH0pXG5cblx0dGVzdCgnd2l0aCB0aGUgQ29tbWVudCBsaXN0IGhpZGRlbiwgYSBDb21tZW50IG9uIGF1ZGlvIGlzIHdyaXR0ZW4gYXQgdGhlIFdhdmVmb3JtIGFuZCB0aGUgbGlzdCBzdGF5cyBoaWRkZW4nLCBhc3luYyAoKSA9PiB7XG5cdFx0YXdhaXQgcGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL3ZlcnNpb25zLyR7dmVyc2lvbklkfWApXG5cdFx0Y29uc3QgY2FudmFzID0gcGFnZS5sb2NhdG9yKCcuZGVsaXZlci13YXZlIGNhbnZhcycpXG5cdFx0YXdhaXQgZXhwZWN0KGNhbnZhcykudG9CZVZpc2libGUoKVxuXHRcdGNvbnN0IGF1ZGlvID0gcGFnZS5sb2NhdG9yKCd2aWRlby5kZWxpdmVyLXBsYXllcl9fdmlkZW8nKVxuXHRcdGF3YWl0IGV4cGVjdChhdWRpbykudG9IYXZlSlNQcm9wZXJ0eSgncmVhZHlTdGF0ZScsIDQpXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJzEgbWluJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgYXVkaW8uZXZhbHVhdGUoKGVsZW1lbnQpID0+IHtcblx0XHRcdGVsZW1lbnQuY3VycmVudFRpbWUgPSAyMDBcblx0XHR9KVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdIaWRlIENvbW1lbnRzJyB9KS5jbGljaygpXG5cdFx0Y29uc3QgbGlzdCA9IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItbGF5b3V0X19wYW5lbCcpXG5cdFx0YXdhaXQgZXhwZWN0KGxpc3QpLnRvQmVIaWRkZW4oKVxuXHRcdGNvbnN0IGJveCA9IGF3YWl0IGNhbnZhcy5ib3VuZGluZ0JveCgpXG5cdFx0Y29uc3QgcXVhcnRlck9uID0geyBwb3NpdGlvbjogeyB4OiBib3gud2lkdGggKiAwLjc1LCB5OiBib3guaGVpZ2h0IC0gMjAgfSB9XG5cdFx0Y29uc3QgcG9wdXAgPSBwYWdlLmdldEJ5Um9sZSgnZGlhbG9nJywgeyBuYW1lOiAnTmV3IENvbW1lbnQnIH0pXG5cdFx0Y29uc3QgZmllbGQgPSBwb3B1cC5sb2NhdG9yKCcjZGVsaXZlci1jb21tZW50LWJvZHktaW5saW5lJylcblxuXHRcdC8vIEEgZG91YmxlIGNsaWNrIG9wZW5zIG5vIGZpZWxkXG5cdFx0YXdhaXQgY2FudmFzLmRibGNsaWNrKHsgcG9zaXRpb246IHsgeDogYm94LndpZHRoICogMC43NSwgeTogYm94LmhlaWdodCAvIDIgfSB9KVxuXHRcdGF3YWl0IGV4cGVjdChwb3B1cCkudG9IYXZlQ291bnQoMClcblx0XHRhd2FpdCBjYW52YXMuZGJsY2xpY2socXVhcnRlck9uKVxuXHRcdGF3YWl0IGV4cGVjdChwb3B1cCkudG9IYXZlQ291bnQoMClcblx0XHRhd2FpdCBhdWRpby5ldmFsdWF0ZSgoZWxlbWVudCkgPT4ge1xuXHRcdFx0ZWxlbWVudC5jdXJyZW50VGltZSA9IDIwMFxuXHRcdH0pXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gY2FudmFzLmV2YWx1YXRlKChlbGVtZW50KSA9PiBNYXRoLmFicyhlbGVtZW50LmRyYXduQXQgLSAyMDApKSkudG9CZUxlc3NUaGFuKDAuMDEpXG5cdFx0Ly8gQyBvcGVucyB0aGUgZmllbGQgYXQgdGhlIHdhdmUsIGF0IHRoYXQgRnJhbWUsIGluc3RlYWQgb2YgdGhlIGxpc3Rcblx0XHRhd2FpdCBjb21tZW50T25RdWFydGVyKHBhZ2UsIGNhbnZhcywgcXVhcnRlck9uKVxuXHRcdGF3YWl0IGV4cGVjdChwb3B1cCkudG9CZVZpc2libGUoKVxuXHRcdGF3YWl0IGV4cGVjdChmaWVsZCkudG9CZUZvY3VzZWQoKVxuXHRcdGF3YWl0IGV4cGVjdChwb3B1cC5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50c19fYW5jaG9yJykpLnRvSGF2ZVRleHQoJzM6MzUuMDAwJylcblx0XHRhd2FpdCBmaWVsZC5maWxsKCd3cml0dGVuIGF0IHRoZSB3YXZlJylcblx0XHRhd2FpdCBmaWVsZC5wcmVzcygnRW50ZXInKVxuXHRcdGF3YWl0IGV4cGVjdChwb3B1cCkudG9IYXZlQ291bnQoMClcblx0XHRhd2FpdCBleHBlY3QobGlzdCkudG9CZUhpZGRlbigpXG5cdFx0Ly8gSXRzIGNpcmNsZSBzdGFuZHMgdW5kZXIgdGhlIHBsYXloZWFkLCB3aGljaCBzdGFuZHMgb24gaXRzIEZyYW1lXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gY2FudmFzLmV2YWx1YXRlKChlbGVtZW50KSA9PiB7XG5cdFx0XHRjb25zdCByYXRpbyA9IGVsZW1lbnQud2lkdGggLyBlbGVtZW50LmNsaWVudFdpZHRoXG5cdFx0XHRjb25zdCBwaXhlbCA9IGVsZW1lbnQuZ2V0Q29udGV4dCgnMmQnKS5nZXRJbWFnZURhdGEoTWF0aC5yb3VuZChlbGVtZW50LndpZHRoIC8gMikgKyBNYXRoLnJvdW5kKDggKiByYXRpbyksIGVsZW1lbnQuaGVpZ2h0IC0gTWF0aC5yb3VuZCgyMCAqIHJhdGlvKSwgMSwgMSkuZGF0YVxuXHRcdFx0cmV0dXJuIHBpeGVsWzNdXG5cdFx0fSkpLnRvQmVHcmVhdGVyVGhhbigwKVxuXG5cdFx0Ly8gRXNjYXBlIG9uIHRoZSBlbXB0eSBmaWVsZCBjbG9zZXMgaXQgYW5kIGxldHMgZ28gb2YgdGhlIHBsYWNlXG5cdFx0YXdhaXQgY29tbWVudE9uUXVhcnRlcihwYWdlLCBjYW52YXMsIHF1YXJ0ZXJPbilcblx0XHRhd2FpdCBleHBlY3QoZmllbGQpLnRvQmVGb2N1c2VkKClcblx0XHRhd2FpdCBmaWVsZC5wcmVzcygnRXNjYXBlJylcblx0XHRhd2FpdCBleHBlY3QocG9wdXApLnRvSGF2ZUNvdW50KDApXG5cdFx0YXdhaXQgYXVkaW8uZXZhbHVhdGUoKGVsZW1lbnQpID0+IHtcblx0XHRcdGVsZW1lbnQuY3VycmVudFRpbWUgPSAyNTBcblx0XHR9KVxuXG5cdFx0Ly8gVGhlIGRyYWZ0IGlzIHRoZSBsaXN0J3M6IG9wZW5pbmcgdGhlIGxpc3QgbWlkLXNlbnRlbmNlIHRha2VzIGl0IHRoZXJlIGFuZCBjbG9zZXMgdGhlIGZpZWxkIGF0IHRoZSB3YXZlXG5cdFx0YXdhaXQgY29tbWVudE9uUXVhcnRlcihwYWdlLCBjYW52YXMsIHF1YXJ0ZXJPbilcblx0XHRhd2FpdCBmaWVsZC5maWxsKCdoYWxmIGEgdGhvdWdodCcpXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1Nob3cgQ29tbWVudHMnIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QocG9wdXApLnRvSGF2ZUNvdW50KDApXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignI2RlbGl2ZXItY29tbWVudC1ib2R5JykpLnRvSGF2ZVZhbHVlKCdoYWxmIGEgdGhvdWdodCcpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tbWVudHNfX2xpc3QnKSkudG9Db250YWluVGV4dCgnd3JpdHRlbiBhdCB0aGUgd2F2ZScpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tbWVudHNfX2FuY2hvcicpKS50b0hhdmVUZXh0KCc0OjI1LjAwMCcpXG5cdFx0Ly8gRW1wdGllZCwgdGhlIGZpZWxkIGZvbGxvd3MgdGhlIHBsYXllciBhZ2FpblxuXHRcdGF3YWl0IHBhZ2UubG9jYXRvcignI2RlbGl2ZXItY29tbWVudC1ib2R5JykuZmlsbCgnJylcblx0XHRhd2FpdCBhdWRpby5ldmFsdWF0ZSgoZWxlbWVudCkgPT4ge1xuXHRcdFx0ZWxlbWVudC5jdXJyZW50VGltZSA9IDMwMFxuXHRcdH0pXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tbWVudHNfX2FuY2hvcicpKS50b0hhdmVUZXh0KCc1OjAwLjAwMCcpXG5cdH0pXG5cblx0dGVzdCgndGhlIGZpZWxkIGF0IHRoZSBXYXZlZm9ybSBrZWVwcyBpdHMgcGxhY2Ugd2hpbGUgZW1wdHksIHRha2VzIGl0cyBvd24gYnV0dG9ucywga2VlcHMgdGV4dCBvbiBhbiBvdXRzaWRlIGNsaWNrLCBhbmQgbmV2ZXIgc2hvd3Mgd2l0aCBhIENvbW1lbnQgY2FyZCcsIGFzeW5jICgpID0+IHtcblx0XHRhd2FpdCBwYWdlLmdvdG8oYC9hcHBzL2RlbGl2ZXIvdmVyc2lvbnMvJHt2ZXJzaW9uSWR9YClcblx0XHRjb25zdCBjYW52YXMgPSBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXdhdmUgY2FudmFzJylcblx0XHRhd2FpdCBleHBlY3QoY2FudmFzKS50b0JlVmlzaWJsZSgpXG5cdFx0Y29uc3QgYXVkaW8gPSBwYWdlLmxvY2F0b3IoJ3ZpZGVvLmRlbGl2ZXItcGxheWVyX192aWRlbycpXG5cdFx0YXdhaXQgZXhwZWN0KGF1ZGlvKS50b0hhdmVKU1Byb3BlcnR5KCdyZWFkeVN0YXRlJywgNClcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnMSBtaW4nIH0pLmNsaWNrKClcblx0XHQvLyBTdGFuZGluZyBvbiB0aGUgQ29tbWVudCB3cml0dGVuIGF0IHRoZSB3YXZlIGJlZm9yZSwgMzozNVxuXHRcdGF3YWl0IGF1ZGlvLmV2YWx1YXRlKChlbGVtZW50KSA9PiB7XG5cdFx0XHRlbGVtZW50LmN1cnJlbnRUaW1lID0gMjE1XG5cdFx0fSlcblx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiBjYW52YXMuZXZhbHVhdGUoKGVsZW1lbnQpID0+IE1hdGguYWJzKGVsZW1lbnQuZHJhd25BdCAtIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJ3ZpZGVvLmRlbGl2ZXItcGxheWVyX192aWRlbycpLmN1cnJlbnRUaW1lKSkpLnRvQmVMZXNzVGhhbigwLjAxKVxuXHRcdGlmIChhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnSGlkZSBDb21tZW50cycgfSkuaXNWaXNpYmxlKCkpIHtcblx0XHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdIaWRlIENvbW1lbnRzJyB9KS5jbGljaygpXG5cdFx0fVxuXHRcdGNvbnN0IGJveCA9IGF3YWl0IGNhbnZhcy5ib3VuZGluZ0JveCgpXG5cdFx0Y29uc3QgcXVhcnRlck9uID0geyBwb3NpdGlvbjogeyB4OiBib3gud2lkdGggKiAwLjc1LCB5OiBib3guaGVpZ2h0IC0gMjAgfSB9XG5cdFx0Y29uc3QgcG9wdXAgPSBwYWdlLmdldEJ5Um9sZSgnZGlhbG9nJywgeyBuYW1lOiAnTmV3IENvbW1lbnQnIH0pXG5cdFx0Y29uc3QgZmllbGQgPSBwb3B1cC5sb2NhdG9yKCcjZGVsaXZlci1jb21tZW50LWJvZHktaW5saW5lJylcblx0XHRjb25zdCBhbmNob3IgPSBwb3B1cC5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50c19fYW5jaG9yJylcblxuXHRcdC8vIEVtcHRpZWQgYWdhaW4sIGl0IHN0YXlzIHdpdGggaXRzIHBsYWNlLCBhbmQga2V5cyBnbyBvbiBpbnRvIHRoZSBmaWVsZCwgbm90IHRvIHRoZSBwbGF5ZXJcblx0XHRhd2FpdCBjb21tZW50T25RdWFydGVyKHBhZ2UsIGNhbnZhcywgcXVhcnRlck9uKVxuXHRcdGF3YWl0IGV4cGVjdChhbmNob3IpLnRvSGF2ZVRleHQoJzM6NTAuMDAwJylcblx0XHRhd2FpdCBmaWVsZC5wcmVzc1NlcXVlbnRpYWxseSgnYWInKVxuXHRcdGF3YWl0IGZpZWxkLnByZXNzKCdCYWNrc3BhY2UnKVxuXHRcdGF3YWl0IGZpZWxkLnByZXNzKCdCYWNrc3BhY2UnKVxuXHRcdGF3YWl0IGV4cGVjdChwb3B1cCkudG9CZVZpc2libGUoKVxuXHRcdGF3YWl0IGV4cGVjdChmaWVsZCkudG9CZUZvY3VzZWQoKVxuXHRcdGF3YWl0IGZpZWxkLnByZXNzKCdrJylcblx0XHRhd2FpdCBleHBlY3QoZmllbGQpLnRvSGF2ZVZhbHVlKCdrJylcblx0XHRleHBlY3QoYXdhaXQgYXVkaW8uZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQucGF1c2VkKSkudG9CZSh0cnVlKVxuXHRcdGF3YWl0IGZpZWxkLmZpbGwoJycpXG5cblx0XHQvLyBJdHMgb3duIGJ1dHRvbnMgZG8gbm90IGxldCBnbyBvZiBhbiBlbXB0eSBmaWVsZDogdGhlIHBhcGVyY2xpcCBvcGVucyB0aGUgZmlsZSBkaWFsb2csIHRoZSBSYW5nZSBzdGFydHNcblx0XHRjb25zdCBjaG9vc2VyID0gcGFnZS53YWl0Rm9yRXZlbnQoJ2ZpbGVjaG9vc2VyJylcblx0XHRhd2FpdCBwb3B1cC5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ0F0dGFjaCBmaWxlcycgfSkuY2xpY2soKVxuXHRcdGF3YWl0IChhd2FpdCBjaG9vc2VyKS5zZXRGaWxlcyhbXSlcblx0XHRhd2FpdCBleHBlY3QocG9wdXApLnRvQmVWaXNpYmxlKClcblx0XHRhd2FpdCBwb3B1cC5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1N0YXJ0IGEgUmFuZ2UgaGVyZScgfSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdChwb3B1cCkudG9CZVZpc2libGUoKVxuXHRcdGF3YWl0IGV4cGVjdChwb3B1cC5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ0VuZCB0aGUgUmFuZ2UgaGVyZScgfSkpLnRvQmVWaXNpYmxlKClcblx0XHQvLyBFbmRpbmcgYW5kIGNsZWFyaW5nIHRoZSBSYW5nZSBrZWVwIHRoZSBjYXJkIGFuZCBhIHBsYWNlLCB3aXRoIGFuZCB3aXRob3V0IHRleHRcblx0XHRhd2FpdCBwb3B1cC5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ0VuZCB0aGUgUmFuZ2UgaGVyZScgfSkuY2xpY2soKVxuXHRcdGF3YWl0IHBvcHVwLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnQ2xlYXIgdGhlIFJhbmdlJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KHBvcHVwKS50b0JlVmlzaWJsZSgpXG5cdFx0YXdhaXQgZXhwZWN0KGZpZWxkKS50b0JlRm9jdXNlZCgpXG5cdFx0YXdhaXQgZmllbGQuZmlsbCgnYWJvdXQgdGhpcyBzdHJldGNoJylcblx0XHRhd2FpdCBwb3B1cC5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1N0YXJ0IGEgUmFuZ2UgaGVyZScgfSkuY2xpY2soKVxuXHRcdGF3YWl0IHBvcHVwLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnRW5kIHRoZSBSYW5nZSBoZXJlJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgcG9wdXAuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdDbGVhciB0aGUgUmFuZ2UnIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QocG9wdXApLnRvQmVWaXNpYmxlKClcblx0XHRhd2FpdCBleHBlY3QoZmllbGQpLnRvSGF2ZVZhbHVlKCdhYm91dCB0aGlzIHN0cmV0Y2gnKVxuXHRcdGF3YWl0IGZpZWxkLmZpbGwoJycpXG5cdFx0Ly8gQSBmaWxlJ3Mg4pyVIGdvZXMgYXdheSB3aGVuIGNsaWNrZWQ6IHRoZSBjYXJkIHN0YXlzLCB0aGUgZm9jdXMgZ29lcyBiYWNrIGludG8gdGhlIGZpZWxkXG5cdFx0Y29uc3QgcGlja2luZyA9IHBhZ2Uud2FpdEZvckV2ZW50KCdmaWxlY2hvb3NlcicpXG5cdFx0YXdhaXQgcG9wdXAuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdBdHRhY2ggZmlsZXMnIH0pLmNsaWNrKClcblx0XHRhd2FpdCAoYXdhaXQgcGlja2luZykuc2V0RmlsZXMoeyBuYW1lOiAnd3JvbmcudHh0JywgbWltZVR5cGU6ICd0ZXh0L3BsYWluJywgYnVmZmVyOiBCdWZmZXIuZnJvbSgneCcpIH0pXG5cdFx0YXdhaXQgcG9wdXAuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdSZW1vdmUgd3JvbmcudHh0JyB9KS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KHBvcHVwKS50b0JlVmlzaWJsZSgpXG5cdFx0YXdhaXQgZXhwZWN0KGZpZWxkKS50b0JlRm9jdXNlZCgpXG5cdFx0Ly8gQXMgaW4gU2FmYXJpLCB3aGVyZSBhIGNsaWNrZWQgYnV0dG9uIHRha2VzIG5vIGZvY3VzOiB0aGUgZmllbGQgaXMgbGVmdCBmb3IgdGhlIHBhZ2UsIGFuZCBzdGlsbCB0aGUgY2FyZCBzdGF5c1xuXHRcdGF3YWl0IHBvcHVwLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnU3RhcnQgYSBSYW5nZSBoZXJlJyB9KS5ldmFsdWF0ZSgoYnV0dG9uKSA9PiBidXR0b24uYWRkRXZlbnRMaXN0ZW5lcignbW91c2Vkb3duJywgKGV2ZW50KSA9PiB7XG5cdFx0XHRldmVudC5wcmV2ZW50RGVmYXVsdCgpXG5cdFx0XHRkb2N1bWVudC5hY3RpdmVFbGVtZW50LmJsdXIoKVxuXHRcdH0pKVxuXHRcdGF3YWl0IHBvcHVwLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnU3RhcnQgYSBSYW5nZSBoZXJlJyB9KS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KHBvcHVwKS50b0JlVmlzaWJsZSgpXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnRXNjYXBlJylcblx0XHRhd2FpdCBleHBlY3QocG9wdXApLnRvSGF2ZUNvdW50KDApXG5cblx0XHQvLyBXaXRoIHRleHQsIGEgY2xpY2sgb3V0c2lkZSBsZWF2ZXMgaXQgb3BlbjsgZW1wdGllZCwgdGhlIG5leHQgb25lIGNsb3NlcyBpdFxuXHRcdGF3YWl0IGNvbW1lbnRPblF1YXJ0ZXIocGFnZSwgY2FudmFzLCBxdWFydGVyT24pXG5cdFx0YXdhaXQgZmllbGQuZmlsbCgna2VwdCcpXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1yZXZpZXdfX3RpdGxlJykuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdChwb3B1cCkudG9CZVZpc2libGUoKVxuXHRcdGF3YWl0IGV4cGVjdChmaWVsZCkudG9IYXZlVmFsdWUoJ2tlcHQnKVxuXHRcdGF3YWl0IGZpZWxkLmZpbGwoJycpXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1yZXZpZXdfX3RpdGxlJykuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdChwb3B1cCkudG9IYXZlQ291bnQoMClcblxuXHRcdC8vIEEgQ29tbWVudCdzIGNhcmQgYW5kIHRoZSBmaWVsZCBuZXZlciBzaG93IGF0IG9uY2Vcblx0XHRhd2FpdCBhdWRpby5ldmFsdWF0ZSgoZWxlbWVudCkgPT4ge1xuXHRcdFx0ZWxlbWVudC5jdXJyZW50VGltZSA9IDIxNVxuXHRcdH0pXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gY2FudmFzLmV2YWx1YXRlKChlbGVtZW50KSA9PiBNYXRoLmFicyhlbGVtZW50LmRyYXduQXQgLSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKCd2aWRlby5kZWxpdmVyLXBsYXllcl9fdmlkZW8nKS5jdXJyZW50VGltZSkpKS50b0JlTGVzc1RoYW4oMC4wMSlcblx0XHRhd2FpdCBjb21tZW50T25RdWFydGVyKHBhZ2UsIGNhbnZhcywgcXVhcnRlck9uKVxuXHRcdGF3YWl0IGV4cGVjdChwb3B1cCkudG9CZVZpc2libGUoKVxuXHRcdC8vIDM6MzUgaXMgYSBxdWFydGVyIG9mIHRoZSBzdGFnZSBsZWZ0IG9mIHRoZSBwbGF5aGVhZCBub3cgc3RhbmRpbmcgYXQgMzo1MCwgb25jZSB0aGUgd2F2ZSBoYXMgZ2xpZGVkIHRoZXJlXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gY2FudmFzLmV2YWx1YXRlKChlbGVtZW50KSA9PiBNYXRoLmFicyhlbGVtZW50LmRyYXduQXQgLSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKCd2aWRlby5kZWxpdmVyLXBsYXllcl9fdmlkZW8nKS5jdXJyZW50VGltZSkpKS50b0JlTGVzc1RoYW4oMC4wMSlcblx0XHRhd2FpdCBjYW52YXMuY2xpY2soeyBwb3NpdGlvbjogeyB4OiBib3gud2lkdGggKiAwLjI1LCB5OiBib3guaGVpZ2h0IC0gMjAgfSB9KVxuXHRcdGNvbnN0IGNhcmQgPSBwYWdlLmdldEJ5Um9sZSgnZGlhbG9nJywgeyBuYW1lOiAvXkNvbW1lbnQgIy8gfSlcblx0XHRhd2FpdCBleHBlY3QoY2FyZCkudG9Db250YWluVGV4dCgnd3JpdHRlbiBhdCB0aGUgd2F2ZScpXG5cdFx0YXdhaXQgZXhwZWN0KHBvcHVwKS50b0hhdmVDb3VudCgwKVxuXHRcdGF3YWl0IGNvbW1lbnRPblF1YXJ0ZXIocGFnZSwgY2FudmFzLCBxdWFydGVyT24pXG5cdFx0YXdhaXQgZXhwZWN0KHBvcHVwKS50b0JlVmlzaWJsZSgpXG5cdFx0YXdhaXQgZXhwZWN0KGNhcmQpLnRvSGF2ZUNvdW50KDApXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnRXNjYXBlJylcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnU2hvdyBDb21tZW50cycgfSkuY2xpY2soKVxuXHR9KVxuXG5cdHRlc3QoJ3VuZGVyIHRoZSBsaXN0IGFuIGVtcHR5IHBpbm5lZCBmaWVsZCBsZXRzIGdvIG9uIGEgY2xpY2sgZWxzZXdoZXJlIGFuZCBvbiBhbm90aGVyIENvbW1lbnRcXCdzIFJlcGx5LCBidXQgbm90IG9uIGl0cyBvd24gYnV0dG9ucycsIGFzeW5jICgpID0+IHtcblx0XHRhd2FpdCBwYWdlLmdvdG8oYC9hcHBzL2RlbGl2ZXIvdmVyc2lvbnMvJHt2ZXJzaW9uSWR9YClcblx0XHRjb25zdCBjYW52YXMgPSBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXdhdmUgY2FudmFzJylcblx0XHRhd2FpdCBleHBlY3QoY2FudmFzKS50b0JlVmlzaWJsZSgpXG5cdFx0Y29uc3QgYXVkaW8gPSBwYWdlLmxvY2F0b3IoJ3ZpZGVvLmRlbGl2ZXItcGxheWVyX192aWRlbycpXG5cdFx0YXdhaXQgZXhwZWN0KGF1ZGlvKS50b0hhdmVKU1Byb3BlcnR5KCdyZWFkeVN0YXRlJywgNClcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnMSBtaW4nIH0pLmNsaWNrKClcblx0XHRpZiAoYXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1Nob3cgQ29tbWVudHMnIH0pLmlzVmlzaWJsZSgpKSB7XG5cdFx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnU2hvdyBDb21tZW50cycgfSkuY2xpY2soKVxuXHRcdH1cblx0XHRjb25zdCBhbmNob3IgPSBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRzX19hbmNob3InKVxuXHRcdGNvbnN0IGdvVG8gPSBhc3luYyAoc2Vjb25kcykgPT4ge1xuXHRcdFx0YXdhaXQgYXVkaW8uZXZhbHVhdGUoKGVsZW1lbnQsIGF0KSA9PiB7XG5cdFx0XHRcdGVsZW1lbnQuY3VycmVudFRpbWUgPSBhdFxuXHRcdFx0fSwgc2Vjb25kcylcblx0XHRcdGF3YWl0IGV4cGVjdChhbmNob3IpLnRvSGF2ZVRleHQobmV3IFJlZ0V4cChgXiR7TWF0aC5mbG9vcihzZWNvbmRzIC8gNjApfToke1N0cmluZyhzZWNvbmRzICUgNjApLnBhZFN0YXJ0KDIsICcwJyl9YCkpXG5cdFx0fVxuXHRcdGF3YWl0IGdvVG8oMjApXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnYycpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignI2RlbGl2ZXItY29tbWVudC1ib2R5JykpLnRvQmVGb2N1c2VkKClcblx0XHQvLyBJdHMgb3duIHBhcGVyY2xpcCBrZWVwcyB0aGUgcGxhY2Vcblx0XHRjb25zdCBwaWNraW5nID0gcGFnZS53YWl0Rm9yRXZlbnQoJ2ZpbGVjaG9vc2VyJylcblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRzX19mb3JtJykuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdBdHRhY2ggZmlsZXMnIH0pLmNsaWNrKClcblx0XHRhd2FpdCAoYXdhaXQgcGlja2luZykuc2V0RmlsZXMoW10pXG5cdFx0YXdhaXQgYXVkaW8uZXZhbHVhdGUoKGVsZW1lbnQpID0+IHtcblx0XHRcdGVsZW1lbnQuY3VycmVudFRpbWUgPSAzMFxuXHRcdH0pXG5cdFx0YXdhaXQgZXhwZWN0KGFuY2hvcikudG9IYXZlVGV4dCgvXjA6MjAvKVxuXHRcdC8vIEEgY2xpY2sgZWxzZXdoZXJlIGxldHMgZ29cblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXJldmlld19fdGl0bGUnKS5jbGljaygpXG5cdFx0YXdhaXQgZ29Ubyg0MClcblx0XHQvLyBTbyBkb2VzIGEgY2xpY2sgaW50byBhbm90aGVyIENvbW1lbnQncyBSZXBseVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ2MnKVxuXHRcdGF3YWl0IGV4cGVjdChhbmNob3IpLnRvSGF2ZVRleHQoL14wOjQwLylcblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRzX19saXN0ID4gLmRlbGl2ZXItY29tbWVudCcpLmZpcnN0KCkuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdSZXBseScsIGV4YWN0OiB0cnVlIH0pLmNsaWNrKClcblx0XHRhd2FpdCBnb1RvKDUwKVxuXHR9KVxuXG5cdHRlc3QoJ2EgQ29tbWVudCBoYWxmIHdyaXR0ZW4gc3RheXMgd2l0aCBpdHMgVmVyc2lvbjogb24gdGhlIG5leHQgQXNzZXQgdGhlIGZpZWxkIGlzIGVtcHR5IGFuZCBhIGtleXN0cm9rZSBzdG9wcyB0aGUgdmlkZW8nLCBhc3luYyAoKSA9PiB7XG5cdFx0YXdhaXQgcGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL3ZlcnNpb25zLyR7dmVyc2lvbklkfWApXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcigndmlkZW8uZGVsaXZlci1wbGF5ZXJfX3ZpZGVvJykpLnRvSGF2ZUpTUHJvcGVydHkoJ3JlYWR5U3RhdGUnLCA0KVxuXHRcdGF3YWl0IHBhZ2UubG9jYXRvcignI2RlbGl2ZXItY29tbWVudC1ib2R5JykuZmlsbCgnbGVmdCBiZWhpbmQnKVxuXHRcdGNvbnN0IG5leHQgPSBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnTmV4dCBBc3NldCcgfSlcblx0XHRhd2FpdCAoYXdhaXQgbmV4dC5pc0VuYWJsZWQoKSA/IG5leHQgOiBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnUHJldmlvdXMgQXNzZXQnIH0pKS5jbGljaygpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTChuZXcgUmVnRXhwKGAvdmVyc2lvbnMvJHtjbGlwVmVyc2lvbklkfSRgKSlcblx0XHRjb25zdCB2aWRlbyA9IHBhZ2UubG9jYXRvcigndmlkZW8uZGVsaXZlci1wbGF5ZXJfX3ZpZGVvJylcblx0XHRhd2FpdCBleHBlY3QodmlkZW8pLnRvSGF2ZUpTUHJvcGVydHkoJ3JlYWR5U3RhdGUnLCA0KVxuXHRcdGNvbnN0IGZpZWxkID0gcGFnZS5sb2NhdG9yKCcjZGVsaXZlci1jb21tZW50LWJvZHknKVxuXHRcdGF3YWl0IGV4cGVjdChmaWVsZCkudG9IYXZlVmFsdWUoJycpXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1BsYXkgKFNwYWNlKScgfSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IHZpZGVvLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LmN1cnJlbnRUaW1lKSkudG9CZUdyZWF0ZXJUaGFuKDAuMylcblx0XHRhd2FpdCBmaWVsZC5wcmVzc1NlcXVlbnRpYWxseSgneCcpXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gdmlkZW8uZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQucGF1c2VkKSkudG9CZSh0cnVlKVxuXHRcdGF3YWl0IGZpZWxkLmZpbGwoJycpXG5cdH0pXG5cblx0dGVzdCgnYnkgbW91c2UgYSBjbGljayBvbiB0aGUgd2F2ZSBkb2VzIG5vdCBzZWVrIGFuZCBhIGRvdWJsZSBjbGljayBza2lwcyB0ZW4gc2Vjb25kczsgdGhlIHN0cmlwIHVuZGVyIGl0IHNlZWtzIGFuZCBzaG93cyBhIGRhc2hlZCBsaW5lIGZpcnN0JywgYXN5bmMgKHsgcGxheXdyaWdodCB9KSA9PiB7XG5cdFx0Y29uc3QgYXBpID0gYXdhaXQgcGxheXdyaWdodC5yZXF1ZXN0Lm5ld0NvbnRleHQoeyBiYXNlVVJMOiBVUkwsIGh0dHBDcmVkZW50aWFsczogYXV0aCwgZXh0cmFIVFRQSGVhZGVyczogb2NzSGVhZGVycyB9KVxuXHRcdGV4cGVjdCgoYXdhaXQgYXBpLnBvc3QoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvdmVyc2lvbnMvJHt2ZXJzaW9uSWR9L2NvbW1lbnRzP2Zvcm1hdD1qc29uYCwgeyBkYXRhOiB7IGluRnJhbWU6IDMzMDAwMCwgYm9keTogJ2luIHRoZSBzdHJpcCcgfSB9KSkub2soKSkudG9CZSh0cnVlKVxuXHRcdGF3YWl0IGFwaS5kaXNwb3NlKClcblx0XHQvLyBXaXRob3V0IHRoZSBnbGlkZSBhIGNsaWNrIGxhbmRzIG9uIHRoZSB3YXZlIHdoZXJlIGl0IHdpbGwgcmVzdFxuXHRcdGF3YWl0IHBhZ2UuZW11bGF0ZU1lZGlhKHsgcmVkdWNlZE1vdGlvbjogJ3JlZHVjZScgfSlcblx0XHRhd2FpdCBwYWdlLmdvdG8oYC9hcHBzL2RlbGl2ZXIvdmVyc2lvbnMvJHt2ZXJzaW9uSWR9YClcblx0XHRjb25zdCBjYW52YXMgPSBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXdhdmUgY2FudmFzJylcblx0XHRhd2FpdCBleHBlY3QoY2FudmFzKS50b0JlVmlzaWJsZSgpXG5cdFx0Y29uc3QgYXVkaW8gPSBwYWdlLmxvY2F0b3IoJ3ZpZGVvLmRlbGl2ZXItcGxheWVyX192aWRlbycpXG5cdFx0YXdhaXQgZXhwZWN0KGF1ZGlvKS50b0hhdmVKU1Byb3BlcnR5KCdyZWFkeVN0YXRlJywgNClcblx0XHRjb25zdCBib3ggPSBhd2FpdCBjYW52YXMuYm91bmRpbmdCb3goKVxuXHRcdGNvbnN0IHN0cmlwID0gYm94LmhlaWdodCAtIDIwXG5cdFx0Y29uc3QgdGltZSA9ICgpID0+IGF1ZGlvLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LmN1cnJlbnRUaW1lKVxuXHRcdGNvbnN0IGdvVG8gPSBhc3luYyAoc2Vjb25kcykgPT4ge1xuXHRcdFx0YXdhaXQgYXVkaW8uZXZhbHVhdGUoKGVsZW1lbnQsIGF0KSA9PiB7XG5cdFx0XHRcdGVsZW1lbnQuY3VycmVudFRpbWUgPSBhdFxuXHRcdFx0fSwgc2Vjb25kcylcblx0XHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IGNhbnZhcy5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5kcmF3bkF0KSkudG9CZUNsb3NlVG8oc2Vjb25kcyArIDAuMDAwNSwgMilcblx0XHR9XG5cdFx0Ly8gT2YgdGhlIDE2IHB4IGFib3ZlIHRoZSBsb3VkZXN0IGJhciBhdCB0aGlzIHBsYWNlLCBob3cgbWFueSBhcmUgZHJhd24gb246IDggb2YgYSBkYXNoZWQgbGluZVxuXHRcdGNvbnN0IGxpbmUgPSAoeCkgPT4gY2FudmFzLmV2YWx1YXRlKChlbGVtZW50LCBhdCkgPT4ge1xuXHRcdFx0Y29uc3QgcmF0aW8gPSBlbGVtZW50LndpZHRoIC8gZWxlbWVudC5jbGllbnRXaWR0aFxuXHRcdFx0Y29uc3QgZGF0YSA9IGVsZW1lbnQuZ2V0Q29udGV4dCgnMmQnKS5nZXRJbWFnZURhdGEoTWF0aC5yb3VuZChhdCAqIHJhdGlvKSwgTWF0aC5yb3VuZCgzNiAqIHJhdGlvKSwgMSwgTWF0aC5yb3VuZCgxNiAqIHJhdGlvKSkuZGF0YVxuXHRcdFx0cmV0dXJuIGRhdGEuZmlsdGVyKCh2YWx1ZSwgaW5kZXgpID0+IGluZGV4ICUgNCA9PT0gMyAmJiB2YWx1ZSA+IDApLmxlbmd0aCAvIHJhdGlvXG5cdFx0fSwgeClcblx0XHRjb25zdCBjdXJzb3IgPSAoKSA9PiBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXdhdmUnKS5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZ2V0Q29tcHV0ZWRTdHlsZShlbGVtZW50KS5jdXJzb3IpXG5cdFx0Y29uc3QgaG92ZXIgPSAoeCwgeSkgPT4gcGFnZS5tb3VzZS5tb3ZlKGJveC54ICsgeCwgYm94LnkgKyB5KVxuXHRcdGNvbnN0IGNhcmQgPSBwYWdlLmdldEJ5Um9sZSgnZGlhbG9nJywgeyBuYW1lOiAvXkNvbW1lbnQgIy8gfSlcblxuXHRcdGZvciAoY29uc3Qgem9vbSBvZiBbJzEgbWluJywgJ1dob2xlJ10pIHtcblx0XHRcdGNvbnN0IHdob2xlID0gem9vbSA9PT0gJ1dob2xlJ1xuXHRcdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogem9vbSwgZXhhY3Q6IHRydWUgfSkuY2xpY2soKVxuXHRcdFx0YXdhaXQgZ29UbygyMClcblx0XHRcdGNvbnN0IHN0YXJ0ID0gYXdhaXQgdGltZSgpXG5cdFx0XHQvLyBPbiB0aGUgd2F2ZSBhIGNsaWNrIGdvZXMgbm93aGVyZTsgYSBkb3VibGUgY2xpY2sgc2tpcHMgdGVuIHNlY29uZHMgb24gdGhlIHRoaXJkcywgbm90aGluZyBpbiB0aGUgbWlkZGxlXG5cdFx0XHRhd2FpdCBjYW52YXMuY2xpY2soeyBwb3NpdGlvbjogeyB4OiBib3gud2lkdGggKiAwLjg1LCB5OiBib3guaGVpZ2h0IC8gMiB9IH0pXG5cdFx0XHRhd2FpdCBwYWdlLndhaXRGb3JUaW1lb3V0KDQwMClcblx0XHRcdGV4cGVjdChhd2FpdCB0aW1lKCkpLnRvQmUoc3RhcnQpXG5cdFx0XHRhd2FpdCBjYW52YXMuZGJsY2xpY2soeyBwb3NpdGlvbjogeyB4OiBib3gud2lkdGggKiAwLjQ1LCB5OiBib3guaGVpZ2h0IC8gMiB9IH0pXG5cdFx0XHRhd2FpdCBwYWdlLndhaXRGb3JUaW1lb3V0KDQwMClcblx0XHRcdGV4cGVjdChhd2FpdCB0aW1lKCkpLnRvQmUoc3RhcnQpXG5cdFx0XHRhd2FpdCBjYW52YXMuZGJsY2xpY2soeyBwb3NpdGlvbjogeyB4OiBib3gud2lkdGggKiAwLjg1LCB5OiBib3guaGVpZ2h0IC8gMiB9IH0pXG5cdFx0XHRhd2FpdCBleHBlY3QucG9sbCh0aW1lKS50b0JlQ2xvc2VUbyhzdGFydCArIDEwLCAxKVxuXHRcdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX19mbGFzaCcpKS50b0NvbnRhaW5UZXh0KCcrMTAnKVxuXHRcdFx0YXdhaXQgY2FudmFzLmRibGNsaWNrKHsgcG9zaXRpb246IHsgeDogYm94LndpZHRoICogMC4xLCB5OiBib3guaGVpZ2h0IC8gMiB9IH0pXG5cdFx0XHRhd2FpdCBleHBlY3QucG9sbCh0aW1lKS50b0JlQ2xvc2VUbyhzdGFydCwgMSlcblxuXHRcdFx0Ly8gSG92ZXJpbmcgdGhlIHN0cmlwIHNob3dzIHdoZXJlIGEgY2xpY2sgZ29lczsgb2ZmIGl0IHRoZXJlIGlzIG5vIGxpbmVcblx0XHRcdGNvbnN0IHggPSBNYXRoLnJvdW5kKGJveC53aWR0aCAqIDAuNzUpXG5cdFx0XHRhd2FpdCBob3Zlcih4LCBib3guaGVpZ2h0IC8gMilcblx0XHRcdGV4cGVjdChhd2FpdCBsaW5lKHgpKS50b0JlKDApXG5cdFx0XHRhd2FpdCBob3Zlcih4LCBzdHJpcClcblx0XHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IGxpbmUoeCkpLnRvQmUoOClcblx0XHRcdGV4cGVjdChhd2FpdCBjdXJzb3IoKSkudG9CZSgncG9pbnRlcicpXG5cdFx0XHRhd2FpdCBob3Zlcih4ICsgMzAsIHN0cmlwKVxuXHRcdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gbGluZSh4ICsgMzApKS50b0JlKDgpXG5cdFx0XHRleHBlY3QoYXdhaXQgbGluZSh4KSkudG9CZSgwKVxuXHRcdFx0YXdhaXQgaG92ZXIoeCwgYm94LmhlaWdodCAvIDIpXG5cdFx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiBsaW5lKHggKyAzMCkpLnRvQmUoMClcblx0XHRcdGV4cGVjdChhd2FpdCBjdXJzb3IoKSkudG9CZSgnZ3JhYicpXG5cdFx0XHRhd2FpdCBob3Zlcih4LCBzdHJpcClcblx0XHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IGxpbmUoeCkpLnRvQmUoOClcblx0XHRcdGF3YWl0IGhvdmVyKHgsIGJveC5oZWlnaHQgKyA2MClcblx0XHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IGxpbmUoeCkpLnRvQmUoMClcblxuXHRcdFx0Ly8gQSBjbGljayB0aGVyZSBzZWVrcywgYW5kIHR3byBxdWljayBvbmVzIHNlZWsgdHdpY2Vcblx0XHRcdGF3YWl0IGNhbnZhcy5kYmxjbGljayh7IHBvc2l0aW9uOiB7IHgsIHk6IHN0cmlwIH0gfSlcblx0XHRcdGF3YWl0IGV4cGVjdC5wb2xsKHRpbWUpLnRvQmVDbG9zZVRvKHdob2xlID8gMjcwIDogc3RhcnQgKyAzMCwgMClcblx0XHRcdGF3YWl0IGdvVG8oMjApXG5cblx0XHRcdC8vIEEgZHJhZyB0aGF0IGJlZ2lucyB0aGVyZSBkcmFncywgd2l0aG91dCB0aGUgbGluZVxuXHRcdFx0YXdhaXQgaG92ZXIoeCwgc3RyaXApXG5cdFx0XHRhd2FpdCBwYWdlLm1vdXNlLmRvd24oKVxuXHRcdFx0YXdhaXQgcGFnZS5tb3VzZS5tb3ZlKGJveC54ICsgeCAtIDQwLCBib3gueSArIHN0cmlwKVxuXHRcdFx0YXdhaXQgcGFnZS5tb3VzZS5tb3ZlKGJveC54ICsgYm94LndpZHRoIC8gMiwgYm94LnkgKyBzdHJpcClcblx0XHRcdGF3YWl0IHBhZ2Uud2FpdEZvclRpbWVvdXQoMTAwKVxuXHRcdFx0Zm9yIChjb25zdCBhdCBvZiBbeCwgeCAtIDQwLCBNYXRoLnJvdW5kKGJveC53aWR0aCAvIDIpICsgNV0pIHtcblx0XHRcdFx0ZXhwZWN0KGF3YWl0IGxpbmUoYXQpKS50b0JlKDApXG5cdFx0XHR9XG5cdFx0XHRleHBlY3QoYXdhaXQgdGltZSgpKS50b0JlQ2xvc2VUbyh3aG9sZSA/IDE4MCA6IDM1LCAwKVxuXHRcdFx0YXdhaXQgcGFnZS5tb3VzZS51cCgpXG5cblx0XHRcdC8vIE92ZXIgYSBjaXJjbGUgdGhlcmUgaXMgbm8gbGluZSwgYnV0IGEgY2xpY2sgb3BlbnMgaXRcblx0XHRcdGF3YWl0IGdvVG8oMzMwKVxuXHRcdFx0Y29uc3QgY2lyY2xlID0gd2hvbGUgPyBNYXRoLnJvdW5kKGJveC53aWR0aCAqIDMzMCAvIDM2MCkgOiBNYXRoLnJvdW5kKGJveC53aWR0aCAvIDIpXG5cdFx0XHRhd2FpdCBob3ZlcihjaXJjbGUgKyA4LCBzdHJpcClcblx0XHRcdGF3YWl0IHBhZ2Uud2FpdEZvclRpbWVvdXQoMTAwKVxuXHRcdFx0ZXhwZWN0KGF3YWl0IGxpbmUoY2lyY2xlICsgOCkpLnRvQmUoMClcblx0XHRcdGV4cGVjdChhd2FpdCBjdXJzb3IoKSkudG9CZSgncG9pbnRlcicpXG5cdFx0XHRhd2FpdCBob3ZlcihjaXJjbGUgKyA0MCwgc3RyaXApXG5cdFx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiBsaW5lKGNpcmNsZSArIDQwKSkudG9CZSg4KVxuXHRcdFx0YXdhaXQgcGFnZS5tb3VzZS5jbGljayhib3gueCArIGNpcmNsZSArIDQsIGJveC55ICsgc3RyaXApXG5cdFx0XHRhd2FpdCBleHBlY3QoY2FyZCkudG9Db250YWluVGV4dCgnaW4gdGhlIHN0cmlwJylcblx0XHRcdGV4cGVjdChhd2FpdCB0aW1lKCkpLnRvQmVDbG9zZVRvKDMzMCwgMSlcblx0XHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ0VzY2FwZScpXG5cdFx0XHRhd2FpdCBleHBlY3QoY2FyZCkudG9IYXZlQ291bnQoMClcblx0XHR9XG5cblx0XHQvLyBXaXRoIHRoZSBjYXJkIG9wZW4gYSBjbGljayBpbiB0aGUgc3RyaXAgYmVzaWRlIHRoZSBjaXJjbGVzIGdvZXMgd2hlcmUgdGhlIGxpbmUgc2F5cywgYW5kIGNsb3NlcyBpdDsgb24gdGhlIHdhdmUgaXQgb25seSBjbG9zZXNcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnMSBtaW4nIH0pLmNsaWNrKClcblx0XHRmb3IgKGNvbnN0IGluU3RyaXAgb2YgW3RydWUsIGZhbHNlXSkge1xuXHRcdFx0YXdhaXQgZ29UbygzMzApXG5cdFx0XHRhd2FpdCBwYWdlLm1vdXNlLmNsaWNrKGJveC54ICsgYm94LndpZHRoIC8gMiArIDQsIGJveC55ICsgc3RyaXApXG5cdFx0XHRhd2FpdCBleHBlY3QoY2FyZCkudG9Db250YWluVGV4dCgnaW4gdGhlIHN0cmlwJylcblx0XHRcdGNvbnN0IHggPSBNYXRoLnJvdW5kKGJveC53aWR0aCAqIDAuNilcblx0XHRcdGF3YWl0IGhvdmVyKHgsIGluU3RyaXAgPyBzdHJpcCA6IDYwKVxuXHRcdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gbGluZSh4KSkudG9CZShpblN0cmlwID8gOCA6IDApXG5cdFx0XHRhd2FpdCBwYWdlLm1vdXNlLmNsaWNrKGJveC54ICsgeCwgYm94LnkgKyAoaW5TdHJpcCA/IHN0cmlwIDogNjApKVxuXHRcdFx0YXdhaXQgZXhwZWN0KGNhcmQpLnRvSGF2ZUNvdW50KDApXG5cdFx0XHRhd2FpdCBleHBlY3QucG9sbCh0aW1lKS50b0JlQ2xvc2VUbyhpblN0cmlwID8gMzM2IDogMzMwLCAwKVxuXHRcdH1cblx0XHQvLyBQcmVzc2VkIG9uIHRoZSB3YXZlIGFuZCBsaWZ0ZWQgaW4gdGhlIHN0cmlwIHRoZSBtb3VzZSBnb2VzIG5vd2hlcmUsIHNvIHRoZXJlIGlzIG5vIGxpbmVcblx0XHRhd2FpdCBnb1RvKDIwKVxuXHRcdGF3YWl0IGhvdmVyKDYwMCwgMTAwKVxuXHRcdGF3YWl0IHBhZ2UubW91c2UuZG93bigpXG5cdFx0YXdhaXQgaG92ZXIoNjAwLCBzdHJpcClcblx0XHRhd2FpdCBwYWdlLndhaXRGb3JUaW1lb3V0KDEwMClcblx0XHRleHBlY3QoYXdhaXQgbGluZSg2MDApKS50b0JlKDApXG5cdFx0YXdhaXQgcGFnZS5tb3VzZS51cCgpXG5cdFx0ZXhwZWN0KGF3YWl0IHRpbWUoKSkudG9CZUNsb3NlVG8oMjAsIDEpXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gbGluZSg2MDApKS50b0JlKDgpXG5cdFx0Ly8gQSBzdGFnZSByZXNpemVkIHVuZGVyIHRoZSByZXN0aW5nIG1vdXNlLCBub3cgb24gdGhlIHdhdmUsIGtlZXBzIG5vIGxpbmVcblx0XHRhd2FpdCBwYWdlLnNldFZpZXdwb3J0U2l6ZSh7IHdpZHRoOiAxMjgwLCBoZWlnaHQ6IDkwMCB9KVxuXHRcdGF3YWl0IHBhZ2Uud2FpdEZvclRpbWVvdXQoMzAwKVxuXHRcdGV4cGVjdChhd2FpdCBsaW5lKDYwMCkpLnRvQmUoMClcblx0XHRhd2FpdCBwYWdlLnNldFZpZXdwb3J0U2l6ZSh7IHdpZHRoOiAxMjgwLCBoZWlnaHQ6IDcyMCB9KVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKGFzeW5jICgpID0+IChhd2FpdCBjYW52YXMuYm91bmRpbmdCb3goKSkuaGVpZ2h0KS50b0JlKGJveC5oZWlnaHQpXG5cblx0XHQvLyBCZWZvcmUgdGhlIHN0YXJ0IG9mIHRoZSBwaWVjZSBhIGNsaWNrIGdvZXMgdG8gdGhlIHN0YXJ0LCBhbmQgdGhlIGxpbmUgc2hvd3MgaXQgdGhlcmVcblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnMSBtaW4nIH0pLmNsaWNrKClcblx0XHRhd2FpdCBnb1RvKDIwKVxuXHRcdGNvbnN0IGZpcnN0ID0gTWF0aC5yb3VuZChib3gud2lkdGggLyAyIC0gMjAgKiBib3gud2lkdGggLyA2MClcblx0XHRhd2FpdCBob3ZlcihmaXJzdCAtIDQwLCBzdHJpcClcblx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiBsaW5lKGZpcnN0KSkudG9CZSg4KVxuXHRcdGV4cGVjdChhd2FpdCBsaW5lKGZpcnN0IC0gNDApKS50b0JlKDApXG5cdFx0Ly8gV2hpbGUgaXQgcGxheXMgb24gdW5kZXIgaXQsIHRoZSBsaW5lIHN0YXlzIGF0IHRoZSBtb3VzZVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdQbGF5IChTcGFjZSknIH0pLmNsaWNrKClcblx0XHRhd2FpdCBob3ZlcigyMDAsIHN0cmlwKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKHRpbWUpLnRvQmVHcmVhdGVyVGhhbigyMilcblx0XHRleHBlY3QoYXdhaXQgbGluZSgyMDApKS50b0JlKDgpXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1BhdXNlIChTcGFjZSknIH0pLmNsaWNrKClcblx0XHQvLyBTdGFuZGluZywgdGhlIG1vdXNlIG92ZXIgdGhlIHdhdmUgb3Igc3RpbGwgaW4gdGhlIHN0cmlwIGRyYXdzIG5vdGhpbmcgYWdhaW5cblx0XHRhd2FpdCBwYWdlLndhaXRGb3JUaW1lb3V0KDMwMClcblx0XHRjb25zdCBkcmF3cyA9IGF3YWl0IGNhbnZhcy5ldmFsdWF0ZShhc3luYyAoZWxlbWVudCkgPT4ge1xuXHRcdFx0Y29uc3QgY2xlYXIgPSBDYW52YXNSZW5kZXJpbmdDb250ZXh0MkQucHJvdG90eXBlLmNsZWFyUmVjdFxuXHRcdFx0bGV0IGNvdW50ID0gMFxuXHRcdFx0Q2FudmFzUmVuZGVyaW5nQ29udGV4dDJELnByb3RvdHlwZS5jbGVhclJlY3QgPSBmdW5jdGlvbiguLi5hcmdzKSB7XG5cdFx0XHRcdGNvdW50Kytcblx0XHRcdFx0cmV0dXJuIGNsZWFyLmFwcGx5KHRoaXMsIGFyZ3MpXG5cdFx0XHR9XG5cdFx0XHRjb25zdCBib3ggPSBlbGVtZW50LmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpXG5cdFx0XHRjb25zdCBjb3VudHMgPSBbXVxuXHRcdFx0Zm9yIChjb25zdCBbeCwgeV0gb2YgW1sxMDAsIDEwMF0sIFsxMjAsIDEwMF0sIFsyMDAsIGJveC5oZWlnaHQgLSAyMF0sIFsyMDAsIGJveC5oZWlnaHQgLSAxMF0sIFsyMDAsIDEwMF1dKSB7XG5cdFx0XHRcdGVsZW1lbnQuZGlzcGF0Y2hFdmVudChuZXcgUG9pbnRlckV2ZW50KCdwb2ludGVybW92ZScsIHsgY2xpZW50WDogYm94LmxlZnQgKyB4LCBjbGllbnRZOiBib3gudG9wICsgeSwgcG9pbnRlcklkOiA3LCBwb2ludGVyVHlwZTogJ21vdXNlJywgYnViYmxlczogdHJ1ZSB9KSlcblx0XHRcdFx0YXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHJlcXVlc3RBbmltYXRpb25GcmFtZSgoKSA9PiByZXF1ZXN0QW5pbWF0aW9uRnJhbWUocmVzb2x2ZSkpKVxuXHRcdFx0XHRjb3VudHMucHVzaChjb3VudClcblx0XHRcdH1cblx0XHRcdENhbnZhc1JlbmRlcmluZ0NvbnRleHQyRC5wcm90b3R5cGUuY2xlYXJSZWN0ID0gY2xlYXJcblx0XHRcdHJldHVybiBjb3VudHNcblx0XHR9KVxuXHRcdC8vIE5vIGxpbmUsIG5vIGxpbmUsIGEgbGluZSwgdGhlIHNhbWUgbGluZSwgbm8gbGluZVxuXHRcdGV4cGVjdChkcmF3cykudG9FcXVhbChbMCwgMCwgMSwgMSwgMl0pXG5cdFx0YXdhaXQgcGFnZS5lbXVsYXRlTWVkaWEoeyByZWR1Y2VkTW90aW9uOiBudWxsIH0pXG5cdH0pXG5cblx0dGVzdCgnb24gYSBwaG9uZSBoZWxkIHNpZGV3YXlzIHdpdGggdGhlIGxpc3QgY2xvc2VkLCB0aGUgZmllbGQgb3BlbnMgYXMgYSBzaGVldCBhbmQgc2VuZHMgZnJvbSB0aGVyZScsIGFzeW5jICgpID0+IHtcblx0XHRjb25zdCBwaG9uZSA9IGF3YWl0IGJyb3dzZXIubmV3Q29udGV4dCh7IGJhc2VVUkw6IEJST1dTRVJfVVJMLCAuLi5QSE9ORSwgdmlld3BvcnQ6IHsgd2lkdGg6IDg0NCwgaGVpZ2h0OiAzOTAgfSB9KVxuXHRcdGNvbnN0IG1lbWJlciA9IGF3YWl0IHBob25lLm5ld1BhZ2UoKVxuXHRcdGF3YWl0IGxvZ2luKG1lbWJlcilcblx0XHRhd2FpdCBtZW1iZXIuZ290byhgL2FwcHMvZGVsaXZlci92ZXJzaW9ucy8ke3ZlcnNpb25JZH1gKVxuXHRcdGNvbnN0IGNhbnZhcyA9IG1lbWJlci5sb2NhdG9yKCcuZGVsaXZlci13YXZlIGNhbnZhcycpXG5cdFx0YXdhaXQgZXhwZWN0KGNhbnZhcykudG9CZVZpc2libGUoKVxuXHRcdGF3YWl0IGV4cGVjdChtZW1iZXIubG9jYXRvcigndmlkZW8uZGVsaXZlci1wbGF5ZXJfX3ZpZGVvJykpLnRvSGF2ZUpTUHJvcGVydHkoJ3JlYWR5U3RhdGUnLCA0KVxuXHRcdGF3YWl0IGV4cGVjdChtZW1iZXIubG9jYXRvcignLmRlbGl2ZXItbGF5b3V0X19wYW5lbCcpKS50b0JlSGlkZGVuKClcblx0XHRjb25zdCBib3ggPSBhd2FpdCBjYW52YXMuYm91bmRpbmdCb3goKVxuXHRcdGNvbnN0IHRvdWNoID0gYXdhaXQgcGhvbmUubmV3Q0RQU2Vzc2lvbihtZW1iZXIpXG5cdFx0YXdhaXQgdG91Y2guc2VuZCgnSW5wdXQuZGlzcGF0Y2hUb3VjaEV2ZW50JywgeyB0eXBlOiAndG91Y2hTdGFydCcsIHRvdWNoUG9pbnRzOiBbeyB4OiBib3gueCArIGJveC53aWR0aCAqIDAuNzUsIHk6IGJveC55ICsgYm94LmhlaWdodCAvIDIgfV0gfSlcblx0XHRhd2FpdCBtZW1iZXIud2FpdEZvclRpbWVvdXQoNzAwKVxuXHRcdGF3YWl0IHRvdWNoLnNlbmQoJ0lucHV0LmRpc3BhdGNoVG91Y2hFdmVudCcsIHsgdHlwZTogJ3RvdWNoRW5kJywgdG91Y2hQb2ludHM6IFtdIH0pXG5cdFx0Y29uc3Qgc2hlZXQgPSBtZW1iZXIuZ2V0QnlSb2xlKCdkaWFsb2cnLCB7IG5hbWU6ICdOZXcgQ29tbWVudCcgfSlcblx0XHRhd2FpdCBleHBlY3Qoc2hlZXQpLnRvQmVWaXNpYmxlKClcblx0XHQvLyBGcm9tIGJlbG93LCBhY3Jvc3MgdGhlIHdpZHRoXG5cdFx0Y29uc3QgYXQgPSBhd2FpdCBzaGVldC5ib3VuZGluZ0JveCgpXG5cdFx0ZXhwZWN0KE1hdGgucm91bmQoYXQueSArIGF0LmhlaWdodCkpLnRvQmUoMzkwKVxuXHRcdGV4cGVjdChNYXRoLnJvdW5kKGF0LndpZHRoKSkudG9CZSg4NDQpXG5cdFx0YXdhaXQgbWVtYmVyLmxvY2F0b3IoJyNkZWxpdmVyLWNvbW1lbnQtYm9keS1pbmxpbmUnKS5maWxsKCdmcm9tIHRoZSBzaGVldCcpXG5cdFx0YXdhaXQgc2hlZXQuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdTZW5kIChFbnRlciknIH0pLnRhcCgpXG5cdFx0YXdhaXQgZXhwZWN0KHNoZWV0KS50b0hhdmVDb3VudCgwKVxuXHRcdGF3YWl0IGV4cGVjdChtZW1iZXIubG9jYXRvcignLmRlbGl2ZXItbGF5b3V0X19wYW5lbCcpKS50b0JlSGlkZGVuKClcblx0XHRhd2FpdCBwaG9uZS5jbG9zZSgpXG5cdH0pXG5cblx0dGVzdCgnb3ZlciB0aGUgd2hvbGUgcGllY2UgdGhlIENvbW1lbnRzIGFyZSBvbiB0aGUgd2F2ZSBvbmx5LCB6b29tZWQgaW4gb24gdGhlIGJhciB0b28sIHdoZXJlIGEgcHJlc3Mgb3BlbnMgdGhlIHdhdmVcXCdzIGNhcmQsIGJ5IG1vdXNlLCBrZXlib2FyZCBhbmQgZmluZ2VyJywgYXN5bmMgKHsgcGxheXdyaWdodCB9KSA9PiB7XG5cdFx0Y29uc3QgYXBpID0gYXdhaXQgcGxheXdyaWdodC5yZXF1ZXN0Lm5ld0NvbnRleHQoeyBiYXNlVVJMOiBVUkwsIGh0dHBDcmVkZW50aWFsczogYXV0aCwgZXh0cmFIVFRQSGVhZGVyczogb2NzSGVhZGVycyB9KVxuXHRcdGNvbnN0IGlkcyA9IFtdXG5cdFx0Y29uc3Qgb3BlbiA9IGFzeW5jICh0YXJnZXQsIHpvb20pID0+IHtcblx0XHRcdGF3YWl0IHRhcmdldC5nb3RvKGAvYXBwcy9kZWxpdmVyL3ZlcnNpb25zLyR7dmVyc2lvbklkfWApXG5cdFx0XHRhd2FpdCBleHBlY3QodGFyZ2V0LmxvY2F0b3IoJy5kZWxpdmVyLXdhdmUgY2FudmFzJykpLnRvQmVWaXNpYmxlKClcblx0XHRcdGF3YWl0IGV4cGVjdCh0YXJnZXQubG9jYXRvcigndmlkZW8uZGVsaXZlci1wbGF5ZXJfX3ZpZGVvJykpLnRvSGF2ZUpTUHJvcGVydHkoJ3JlYWR5U3RhdGUnLCA0KVxuXHRcdFx0YXdhaXQgdGFyZ2V0LmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiB6b29tLCBleGFjdDogdHJ1ZSB9KS5jbGljaygpXG5cdFx0fVxuXHRcdGNvbnN0IHRpbWVPZiA9ICh0YXJnZXQpID0+IHRhcmdldC5sb2NhdG9yKCd2aWRlby5kZWxpdmVyLXBsYXllcl9fdmlkZW8nKS5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5jdXJyZW50VGltZSlcblx0XHRjb25zdCBtYXJrZXJPZiA9ICh0YXJnZXQpID0+IHRhcmdldC5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX21hcmtlclthcmlhLWxhYmVsKj1cIm9uIHRoZSBiYXJcIl0nKVxuXHRcdGNvbnN0IGNhcmQgPSAodGFyZ2V0KSA9PiB0YXJnZXQuZ2V0QnlSb2xlKCdkaWFsb2cnLCB7IG5hbWU6IC9eQ29tbWVudCAjLyB9KVxuXHRcdGNvbnN0IHBlZWsgPSBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fcGVlaycpXG5cdFx0Y29uc3QgY2FudmFzID0gcGFnZS5sb2NhdG9yKCcuZGVsaXZlci13YXZlIGNhbnZhcycpXG5cdFx0Y29uc3QgYmFyID0gcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX3RpbWVsaW5lJylcblx0XHQvLyBUaGUgd2F2ZSBpcyBhcyBoaWdoIHdpdGggQ29tbWVudHMgYXMgd2l0aG91dCwgYXQgZXZlcnkgem9vbVxuXHRcdGF3YWl0IHBhZ2Uucm91dGUoJyoqL3ZlcnNpb25zLyovY29tbWVudHMqJywgKHJvdXRlKSA9PiByb3V0ZS5mdWxmaWxsKHsganNvbjogeyBvY3M6IHsgbWV0YTogeyBzdGF0dXM6ICdvaycsIHN0YXR1c2NvZGU6IDIwMCB9LCBkYXRhOiB7IGNvbW1lbnRzOiBbXSwgbWFuYWdlczogdHJ1ZSwgb3ZlcndyaXR0ZW5BdDogbnVsbCwgY2FuQ29tbWVudDogdHJ1ZSwgY2FuQXBwcm92ZTogZmFsc2UgfSB9IH0gfSkpXG5cdFx0YXdhaXQgb3BlbihwYWdlLCAnV2hvbGUnKVxuXHRcdGNvbnN0IGhlaWdodHMgPSBbKGF3YWl0IGNhbnZhcy5ib3VuZGluZ0JveCgpKS5oZWlnaHRdXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJzEgbWluJywgZXhhY3Q6IHRydWUgfSkuY2xpY2soKVxuXHRcdGhlaWdodHMucHVzaCgoYXdhaXQgY2FudmFzLmJvdW5kaW5nQm94KCkpLmhlaWdodClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1wbGF5ZXJfX21hcmtlcicpKS50b0hhdmVDb3VudCgwKVxuXHRcdGF3YWl0IHBhZ2UudW5yb3V0ZSgnKiovdmVyc2lvbnMvKi9jb21tZW50cyonKVxuXHRcdGZvciAoY29uc3QgW2luRnJhbWUsIGJvZHldIG9mIFtbOTAwMDAsICdvbiB0aGUgYmFyJ10sIFs5MDEwMCwgJ2Nsb3NlIGJ5J11dKSB7XG5cdFx0XHRjb25zdCBtYWRlID0gYXdhaXQgYXBpLnBvc3QoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvdmVyc2lvbnMvJHt2ZXJzaW9uSWR9L2NvbW1lbnRzP2Zvcm1hdD1qc29uYCwgeyBkYXRhOiB7IGluRnJhbWUsIGJvZHkgfSB9KVxuXHRcdFx0aWRzLnB1c2goKGF3YWl0IG1hZGUuanNvbigpKS5vY3MuZGF0YS5pZClcblx0XHR9XG5cdFx0YXdhaXQgb3BlbihwYWdlLCAnV2hvbGUnKVxuXHRcdGNvbnN0IG1hcmtlciA9IG1hcmtlck9mKHBhZ2UpXG5cdFx0YXdhaXQgZXhwZWN0KG1hcmtlcikudG9IYXZlVGV4dCgnMicpXG5cdFx0Y29uc3Qgc3RhZ2UgPSBhd2FpdCBjYW52YXMuYm91bmRpbmdCb3goKVxuXHRcdGNvbnN0IHVuZGVyID0gYXdhaXQgYmFyLmJvdW5kaW5nQm94KClcblx0XHRleHBlY3QoW3N0YWdlLmhlaWdodCwgc3RhZ2UuaGVpZ2h0XSkudG9FcXVhbChoZWlnaHRzKVxuXHRcdGV4cGVjdCh1bmRlci55KS50b0JlQ2xvc2VUbyhzdGFnZS55ICsgc3RhZ2UuaGVpZ2h0LCAwKVxuXG5cdFx0Ly8gT3ZlciB0aGUgd2hvbGUgdGhlIGNpcmNsZSBpcyBvbiB0aGUgd2F2ZSdzIGxhbmUsIGFuZCB0aGUgYmFyIGF0IGl0cyBwbGFjZSBvbmx5IHNlZWtzXG5cdFx0ZXhwZWN0KGF3YWl0IGNhbnZhcy5ldmFsdWF0ZSgoZWxlbWVudCkgPT4ge1xuXHRcdFx0Y29uc3QgcmF0aW8gPSBlbGVtZW50LndpZHRoIC8gZWxlbWVudC5jbGllbnRXaWR0aFxuXHRcdFx0Y29uc3QgZGF0YSA9IGVsZW1lbnQuZ2V0Q29udGV4dCgnMmQnKS5nZXRJbWFnZURhdGEoTWF0aC5yb3VuZCgoZWxlbWVudC5jbGllbnRXaWR0aCAvIDQgKyA4KSAqIHJhdGlvKSwgZWxlbWVudC5oZWlnaHQgLSBNYXRoLnJvdW5kKDIwICogcmF0aW8pLCAxLCAxKS5kYXRhXG5cdFx0XHRyZXR1cm4gZGF0YVszXVxuXHRcdH0pKS50b0JlKDI1NSlcblx0XHRhd2FpdCBwYWdlLm1vdXNlLmNsaWNrKHVuZGVyLnggKyB1bmRlci53aWR0aCAvIDQsIHVuZGVyLnkgKyB1bmRlci5oZWlnaHQgLyAyKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IHRpbWVPZihwYWdlKSkudG9CZUNsb3NlVG8oOTAsIDApXG5cdFx0YXdhaXQgZXhwZWN0KHBlZWspLnRvSGF2ZUNvdW50KDApXG5cdFx0YXdhaXQgZXhwZWN0KGNhcmQocGFnZSkpLnRvSGF2ZUNvdW50KDApXG5cdFx0Ly8gVGhlIGtleWJvYXJkIHN0aWxsIHJlYWNoZXMgaXQgdGhlcmUsIGFuZCBpdCBzaG93cyB3aGlsZSBpdCBoYXMgdGhlIGZvY3VzXG5cdFx0YXdhaXQgZXhwZWN0KG1hcmtlcikudG9IYXZlQ1NTKCdjbGlwLXBhdGgnLCAnaW5zZXQoNTAlKScpXG5cdFx0YXdhaXQgbWFya2VyLmZvY3VzKClcblx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdTaGlmdCtUYWInKVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ1RhYicpXG5cdFx0YXdhaXQgZXhwZWN0KG1hcmtlcikudG9CZUZvY3VzZWQoKVxuXHRcdGF3YWl0IGV4cGVjdChtYXJrZXIpLnRvSGF2ZUNTUygnY2xpcC1wYXRoJywgJ25vbmUnKVxuXHRcdGF3YWl0IGV4cGVjdChwZWVrKS50b0NvbnRhaW5UZXh0KCcxIG9mIDInKVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ0VudGVyJylcblx0XHRhd2FpdCBleHBlY3QoY2FyZChwYWdlKSkudG9Db250YWluVGV4dCgnb24gdGhlIGJhcicpXG5cdFx0Ly8gRXNjYXBlIGhhbmRzIHRoZSBmb2N1cyBiYWNrLCB3aXRob3V0IHRoZSBzbWFsbCBjYXJkXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnRXNjYXBlJylcblx0XHRhd2FpdCBleHBlY3QoY2FyZChwYWdlKSkudG9IYXZlQ291bnQoMClcblx0XHRhd2FpdCBleHBlY3QobWFya2VyKS50b0JlRm9jdXNlZCgpXG5cdFx0YXdhaXQgcGFnZS53YWl0Rm9yVGltZW91dCgyMDApXG5cdFx0YXdhaXQgZXhwZWN0KHBlZWspLnRvSGF2ZUNvdW50KDApXG5cblx0XHQvLyBab29tZWQgaW4gdGhlIGJhciBoYXMgaXQgdG9vXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJzEgbWluJywgZXhhY3Q6IHRydWUgfSkuY2xpY2soKVxuXHRcdGV4cGVjdCgoYXdhaXQgY2FudmFzLmJvdW5kaW5nQm94KCkpLmhlaWdodCkudG9CZShzdGFnZS5oZWlnaHQpXG5cdFx0Ly8gVHJhbnNsdWNlbnQsIHVudGlsIHRoZSBtb3VzZSBpcyBvdmVyIGl0XG5cdFx0Y29uc3QgYmFjayA9ICgpID0+IG1hcmtlci5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZ2V0Q29tcHV0ZWRTdHlsZShlbGVtZW50KS5iYWNrZ3JvdW5kQ29sb3IpXG5cdFx0YXdhaXQgb3BlbihwYWdlLCAnMSBtaW4nKVxuXHRcdGF3YWl0IHBhZ2UubW91c2UubW92ZSgwLCAwKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKGJhY2spLnRvTWF0Y2goL3JnYmFcXCgwLCAwLCAwLCAwXFwuXFxkK1xcKS8pXG5cdFx0YXdhaXQgbWFya2VyLmhvdmVyKHsgZm9yY2U6IHRydWUgfSlcblx0XHRhd2FpdCBleHBlY3QucG9sbChiYWNrKS50b0JlKCdyZ2IoMCwgMCwgMCknKVxuXHRcdGF3YWl0IGV4cGVjdChwZWVrKS50b0NvbnRhaW5UZXh0KCcxIG9mIDInKVxuXHRcdC8vIEluIHBsYWNlIG9mIHRoZSBGcmFtZSdzIHRpbWUsIHdoaWNoIGlzIGJlc2lkZSBpdFxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9faG92ZXInKSkudG9CZUhpZGRlbigpXG5cdFx0YXdhaXQgcGFnZS5tb3VzZS5tb3ZlKHVuZGVyLnggKyB1bmRlci53aWR0aCAvIDQgKyAxNCwgdW5kZXIueSArIHVuZGVyLmhlaWdodCAvIDIpXG5cdFx0YXdhaXQgZXhwZWN0KHBlZWspLnRvSGF2ZUNvdW50KDApXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX19ob3ZlcicpKS50b0JlVmlzaWJsZSgpXG5cdFx0YXdhaXQgbWFya2VyLmNsaWNrKHsgZm9yY2U6IHRydWUgfSlcblx0XHRhd2FpdCBleHBlY3QoY2FyZChwYWdlKSkudG9Db250YWluVGV4dCgnb24gdGhlIGJhcicpXG5cdFx0YXdhaXQgZXhwZWN0KGNhcmQocGFnZSkuZ2V0QnlQbGFjZWhvbGRlcignV3JpdGUgYSBSZXBseScpKS50b0JlVmlzaWJsZSgpXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gdGltZU9mKHBhZ2UpKS50b0JlQ2xvc2VUbyg5MCwgMSlcblx0XHQvLyBUaGUgbW91c2UncyBzbWFsbCBjYXJkIGlzIGdvbmUsIHRoZSBsaXN0IHNlbGVjdGVkLCBhbmQgdGhlIGNpcmNsZSByaW5nZWRcblx0XHRhd2FpdCBleHBlY3QocGVlaykudG9IYXZlQ291bnQoMClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50LS1zZWxlY3RlZCcpKS50b0NvbnRhaW5UZXh0KCdvbiB0aGUgYmFyJylcblx0XHRhd2FpdCBleHBlY3QobWFya2VyKS50b0hhdmVBdHRyaWJ1dGUoJ3N0eWxlJywgLy0tZGVsaXZlci1tYXJrZXItbGluZTogI2ZmZi8pXG5cdFx0YXdhaXQgZXhwZWN0KG1hcmtlcikudG9IYXZlQ2xhc3MoLy0tb3BhcXVlLylcblx0XHQvLyBUaGUgY2FyZCBzdGVwcyB0aHJvdWdoIHRoZSBjb3VudCwgYW5kIGEgZG91YmxlIGNsaWNrIGdvZXMgdG8gdGhlIG9uZSBpdCBzaG93c1xuXHRcdGF3YWl0IGNhcmQocGFnZSkuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdOZXh0IENvbW1lbnQnIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QoY2FyZChwYWdlKSkudG9Db250YWluVGV4dCgnY2xvc2UgYnknKVxuXHRcdGF3YWl0IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX19tYXJrZXJbYXJpYS1sYWJlbF49XCIyIG9mIDJcIl0nKS5kYmxjbGljayh7IGZvcmNlOiB0cnVlIH0pXG5cdFx0YXdhaXQgZXhwZWN0KGNhcmQocGFnZSkpLnRvQ29udGFpblRleHQoJ2Nsb3NlIGJ5Jylcblx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiB0aW1lT2YocGFnZSkpLnRvQmVDbG9zZVRvKDkwLjEsIDIpXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnRXNjYXBlJylcblx0XHRhd2FpdCBleHBlY3QoY2FyZChwYWdlKSkudG9IYXZlQ291bnQoMClcblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fbWFya2VyW2FyaWEtbGFiZWxePVwiMiBvZiAyXCJdJykuZm9jdXMoKVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ0VudGVyJylcblx0XHRhd2FpdCBleHBlY3QoY2FyZChwYWdlKSkudG9Db250YWluVGV4dCgnY2xvc2UgYnknKVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ0VzY2FwZScpXG5cdFx0Ly8gQSBkcmFnIGZyb20gaXQgbW92ZXMgdGhlIHdhdmUgYW5kIG9wZW5zIG5vdGhpbmdcblx0XHRhd2FpdCBwYWdlLm1vdXNlLm1vdmUodW5kZXIueCArIHVuZGVyLndpZHRoIC8gNCwgdW5kZXIueSArIHVuZGVyLmhlaWdodCAvIDIpXG5cdFx0YXdhaXQgcGFnZS5tb3VzZS5kb3duKClcblx0XHRhd2FpdCBwYWdlLm1vdXNlLm1vdmUodW5kZXIueCArIHVuZGVyLndpZHRoIC8gMiwgdW5kZXIueSArIHVuZGVyLmhlaWdodCAvIDIsIHsgc3RlcHM6IDQgfSlcblx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiB0aW1lT2YocGFnZSkpLnRvQmVDbG9zZVRvKDE4MCwgMClcblx0XHRhd2FpdCBwYWdlLm1vdXNlLnVwKClcblx0XHRhd2FpdCBwYWdlLndhaXRGb3JUaW1lb3V0KDQwMClcblx0XHRhd2FpdCBleHBlY3QoY2FyZChwYWdlKSkudG9IYXZlQ291bnQoMClcblx0XHRleHBlY3QoYXdhaXQgdGltZU9mKHBhZ2UpKS50b0JlQ2xvc2VUbygxODAsIDApXG5cblx0XHRjb25zdCBwaG9uZSA9IGF3YWl0IGJyb3dzZXIubmV3Q29udGV4dCh7IGJhc2VVUkw6IEJST1dTRVJfVVJMLCAuLi5QSE9ORSwgdmlld3BvcnQ6IHsgd2lkdGg6IDg1MiwgaGVpZ2h0OiAzOTMgfSB9KVxuXHRcdGNvbnN0IG1lbWJlciA9IGF3YWl0IHBob25lLm5ld1BhZ2UoKVxuXHRcdGF3YWl0IGxvZ2luKG1lbWJlcilcblx0XHRhd2FpdCBvcGVuKG1lbWJlciwgJ1dob2xlJylcblx0XHRhd2FpdCBleHBlY3QobWFya2VyT2YobWVtYmVyKSkudG9IYXZlVGV4dCgnMicpXG5cdFx0Y29uc3Qgcm93ID0gYXdhaXQgbWVtYmVyLmxvY2F0b3IoJy5kZWxpdmVyLXBsYXllcl9fdGltZWxpbmUnKS5ib3VuZGluZ0JveCgpXG5cdFx0YXdhaXQgbWVtYmVyLnRvdWNoc2NyZWVuLnRhcChyb3cueCArIHJvdy53aWR0aCAvIDQsIHJvdy55ICsgcm93LmhlaWdodCAvIDIpXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gdGltZU9mKG1lbWJlcikpLnRvQmVDbG9zZVRvKDkwLCAwKVxuXHRcdGF3YWl0IG1lbWJlci53YWl0Rm9yVGltZW91dCg0MDApXG5cdFx0YXdhaXQgZXhwZWN0KGNhcmQobWVtYmVyKSkudG9IYXZlQ291bnQoMClcblx0XHRhd2FpdCBvcGVuKG1lbWJlciwgJzEgbWluJylcblx0XHRhd2FpdCBleHBlY3QobWFya2VyT2YobWVtYmVyKSkudG9IYXZlVGV4dCgnMicpXG5cdFx0Ly8gQSB0YXAgcmVhZHMgYW5kIGFuc3dlcnMgd2l0aG91dCBzZWVraW5nOyBhIGRvdWJsZSB0YXAgZ29lcyB0aGVyZSwgdGhvdWdoIHRoZSBzaGVldCB3b3VsZCBjb3ZlciB0aGUgYmFyXG5cdFx0Y29uc3QgYXQgPSBhd2FpdCBtYXJrZXJPZihtZW1iZXIpLmJvdW5kaW5nQm94KClcblx0XHRjb25zdCB0YXAgPSAoKSA9PiBtZW1iZXIudG91Y2hzY3JlZW4udGFwKGF0LnggKyBhdC53aWR0aCAvIDIsIGF0LnkgKyBhdC5oZWlnaHQgLyAyKVxuXHRcdGF3YWl0IHRhcCgpXG5cdFx0YXdhaXQgZXhwZWN0KGNhcmQobWVtYmVyKSkudG9Db250YWluVGV4dCgnb24gdGhlIGJhcicpXG5cdFx0ZXhwZWN0KGF3YWl0IHRpbWVPZihtZW1iZXIpKS50b0JlKDApXG5cdFx0YXdhaXQgY2FyZChtZW1iZXIpLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnQ2xvc2UnIH0pLnRhcCgpXG5cdFx0YXdhaXQgdGFwKClcblx0XHRhd2FpdCB0YXAoKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IHRpbWVPZihtZW1iZXIpKS50b0JlQ2xvc2VUbyg5MCwgMSlcblx0XHRhd2FpdCBtZW1iZXIud2FpdEZvclRpbWVvdXQoNDAwKVxuXHRcdGF3YWl0IGV4cGVjdChjYXJkKG1lbWJlcikpLnRvSGF2ZUNvdW50KDApXG5cdFx0Ly8gQSBmaW5nZXIgZHJhZ2dpbmcgZnJvbSBpdCBtb3ZlcyB0aGUgd2F2ZVxuXHRcdGNvbnN0IHRvdWNoID0gYXdhaXQgcGhvbmUubmV3Q0RQU2Vzc2lvbihtZW1iZXIpXG5cdFx0Y29uc3QgeSA9IGF0LnkgKyBhdC5oZWlnaHQgLyAyXG5cdFx0YXdhaXQgdG91Y2guc2VuZCgnSW5wdXQuZGlzcGF0Y2hUb3VjaEV2ZW50JywgeyB0eXBlOiAndG91Y2hTdGFydCcsIHRvdWNoUG9pbnRzOiBbeyB4OiBhdC54ICsgYXQud2lkdGggLyAyLCB5IH1dIH0pXG5cdFx0Zm9yIChjb25zdCB4IG9mIFthdC54ICsgNjAsIGF0LnggKyAxNjAsIGF0LnggKyAyNjBdKSB7XG5cdFx0XHRhd2FpdCB0b3VjaC5zZW5kKCdJbnB1dC5kaXNwYXRjaFRvdWNoRXZlbnQnLCB7IHR5cGU6ICd0b3VjaE1vdmUnLCB0b3VjaFBvaW50czogW3sgeCwgeSB9XSB9KVxuXHRcdH1cblx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiB0aW1lT2YobWVtYmVyKSkudG9CZUdyZWF0ZXJUaGFuKDE1MClcblx0XHRhd2FpdCB0b3VjaC5zZW5kKCdJbnB1dC5kaXNwYXRjaFRvdWNoRXZlbnQnLCB7IHR5cGU6ICd0b3VjaEVuZCcsIHRvdWNoUG9pbnRzOiBbXSB9KVxuXHRcdGF3YWl0IG1lbWJlci53YWl0Rm9yVGltZW91dCg1MDApXG5cdFx0YXdhaXQgZXhwZWN0KGNhcmQobWVtYmVyKSkudG9IYXZlQ291bnQoMClcblx0XHRhd2FpdCBwaG9uZS5jbG9zZSgpXG5cdFx0Zm9yIChjb25zdCBpZCBvZiBpZHMpIHtcblx0XHRcdGV4cGVjdCgoYXdhaXQgYXBpLmRlbGV0ZShgL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS9jb21tZW50cy8ke2lkfT9mb3JtYXQ9anNvbmApKS5vaygpKS50b0JlKHRydWUpXG5cdFx0fVxuXHRcdGF3YWl0IGFwaS5kaXNwb3NlKClcblx0fSlcblxuXHR0ZXN0KCdvbiBhIHBob25lIGEgcGluY2ggb25seSB6b29tcywgYSBsb25nIHByZXNzIGNvbW1lbnRzLCBhbmQgdGhlIGNhcmQgaGFuZHMgdGhlIGZvY3VzIGJhY2s7IGEgUmV2aWV3ZXIgd2hvIG1heSBub3QgY29tbWVudCByZWFkcyB0aGUgY2FyZHMgYW5kIHdyaXRlcyBub3RoaW5nJywgYXN5bmMgKHsgcGxheXdyaWdodCB9KSA9PiB7XG5cdFx0Y29uc3QgYXBpID0gYXdhaXQgcGxheXdyaWdodC5yZXF1ZXN0Lm5ld0NvbnRleHQoeyBiYXNlVVJMOiBVUkwsIGh0dHBDcmVkZW50aWFsczogYXV0aCwgZXh0cmFIVFRQSGVhZGVyczogb2NzSGVhZGVycyB9KVxuXHRcdGNvbnN0IGNvbW1lbnRzID0gYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvdmVyc2lvbnMvJHt2ZXJzaW9uSWR9L2NvbW1lbnRzP2Zvcm1hdD1qc29uYFxuXHRcdGNvbnN0IHBhcmVudCA9IChhd2FpdCAoYXdhaXQgYXBpLnBvc3QoY29tbWVudHMsIHsgZGF0YTogeyBpbkZyYW1lOiA3NTAwLCBib2R5OiAnZm9yIHRoZSBwaG9uZScgfSB9KSkuanNvbigpKS5vY3MuZGF0YVxuXHRcdGV4cGVjdCgoYXdhaXQgYXBpLnBvc3QoY29tbWVudHMsIHsgZGF0YTogeyBpbkZyYW1lOiA3NTAwLCBib2R5OiAnYW5kIGEgcmVwbHknLCBwYXJlbnRJZDogcGFyZW50LmlkIH0gfSkpLm9rKCkpLnRvQmUodHJ1ZSlcblxuXHRcdGNvbnN0IHBob25lID0gYXdhaXQgYnJvd3Nlci5uZXdDb250ZXh0KHsgYmFzZVVSTDogQlJPV1NFUl9VUkwsIC4uLlBIT05FIH0pXG5cdFx0Y29uc3QgbWVtYmVyID0gYXdhaXQgcGhvbmUubmV3UGFnZSgpXG5cdFx0YXdhaXQgbG9naW4obWVtYmVyKVxuXHRcdGF3YWl0IG1lbWJlci5nb3RvKGAvYXBwcy9kZWxpdmVyL3ZlcnNpb25zLyR7dmVyc2lvbklkfWApXG5cdFx0Y29uc3QgY2FudmFzID0gbWVtYmVyLmxvY2F0b3IoJy5kZWxpdmVyLXdhdmUgY2FudmFzJylcblx0XHRhd2FpdCBleHBlY3QoY2FudmFzKS50b0JlVmlzaWJsZSgpXG5cdFx0YXdhaXQgZXhwZWN0KG1lbWJlci5sb2NhdG9yKCd2aWRlby5kZWxpdmVyLXBsYXllcl9fdmlkZW8nKSkudG9IYXZlSlNQcm9wZXJ0eSgncmVhZHlTdGF0ZScsIDQpXG5cdFx0Y29uc3QgZmllbGQgPSBtZW1iZXIubG9jYXRvcignI2RlbGl2ZXItY29tbWVudC1ib2R5Jylcblx0XHRjb25zdCBhbmNob3IgPSBtZW1iZXIubG9jYXRvcignLmRlbGl2ZXItY29tbWVudHNfX2FuY2hvcicpXG5cdFx0Y29uc3QgYm94ID0gYXdhaXQgY2FudmFzLmJvdW5kaW5nQm94KClcblx0XHRjb25zdCB5ID0gYm94LnkgKyBib3guaGVpZ2h0IC8gMlxuXHRcdGNvbnN0IHRvdWNoID0gYXdhaXQgcGhvbmUubmV3Q0RQU2Vzc2lvbihtZW1iZXIpXG5cdFx0Y29uc3QgZmluZ2VycyA9ICh0eXBlLCBwb2ludHMpID0+IHRvdWNoLnNlbmQoJ0lucHV0LmRpc3BhdGNoVG91Y2hFdmVudCcsIHsgdHlwZSwgdG91Y2hQb2ludHM6IHBvaW50cy5tYXAoKFt4LCBhdF0sIGlkKSA9PiAoeyB4LCB5OiBhdCwgaWQgfSkpIH0pXG5cdFx0Y29uc3Qgc2hvd24gPSAoKSA9PiBtZW1iZXIubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX193aW5kb3cnKS5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gcGFyc2VGbG9hdChlbGVtZW50LnN0eWxlLndpZHRoLm1hdGNoKC9bXFxkLl0rJS8pWzBdKSlcblxuXHRcdC8vIFR3byBmaW5nZXJzIG1vdmluZyBhcGFydCBmb3IgbW9zdCBvZiBhIHNlY29uZCB6b29tIGluIGFuZCBvcGVuIG5vIGZpZWxkXG5cdFx0Y29uc3QgYmVmb3JlID0gYXdhaXQgc2hvd24oKVxuXHRcdGF3YWl0IGZpbmdlcnMoJ3RvdWNoU3RhcnQnLCBbW2JveC54ICsgMTUwLCB5XSwgW2JveC54ICsgMjQwLCB5XV0pXG5cdFx0Zm9yIChsZXQgc3RlcCA9IDE7IHN0ZXAgPD0gODsgc3RlcCsrKSB7XG5cdFx0XHRhd2FpdCBtZW1iZXIud2FpdEZvclRpbWVvdXQoMTAwKVxuXHRcdFx0YXdhaXQgZmluZ2VycygndG91Y2hNb3ZlJywgW1tib3gueCArIDE1MCAtIHN0ZXAgKiAxMCwgeV0sIFtib3gueCArIDI0MCArIHN0ZXAgKiAxMCwgeV1dKVxuXHRcdH1cblx0XHRhd2FpdCBmaW5nZXJzKCd0b3VjaEVuZCcsIFtdKVxuXHRcdGF3YWl0IG1lbWJlci53YWl0Rm9yVGltZW91dCgzMDApXG5cdFx0ZXhwZWN0KGF3YWl0IHNob3duKCkpLnRvQmVMZXNzVGhhbihiZWZvcmUpXG5cdFx0YXdhaXQgZXhwZWN0KGZpZWxkKS5ub3QudG9CZUZvY3VzZWQoKVxuXHRcdGF3YWl0IGV4cGVjdChhbmNob3IpLnRvSGF2ZVRleHQoJzA6MDAuMDAwJylcblxuXHRcdC8vIEEgZmluZ2VyIHJlc3RpbmcgYSBxdWFydGVyIG9mIHRoZSBzdGFnZSB0byB0aGUgcmlnaHQsIDE1IHNlY29uZHMgb24sIG9wZW5zIHRoZSBmaWVsZCB0aGVyZTsgaXQgbmVpdGhlciBzZWVrcyBub3IgZ29lcyBmdWxsc2NyZWVuXG5cdFx0YXdhaXQgbWVtYmVyLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnMSBtaW4nIH0pLnRhcCgpXG5cdFx0YXdhaXQgZmluZ2VycygndG91Y2hTdGFydCcsIFtbYm94LnggKyBib3gud2lkdGggKiAwLjc1LCB5XV0pXG5cdFx0YXdhaXQgbWVtYmVyLndhaXRGb3JUaW1lb3V0KDcwMClcblx0XHRhd2FpdCBmaW5nZXJzKCd0b3VjaEVuZCcsIFtdKVxuXHRcdGF3YWl0IGV4cGVjdChmaWVsZCkudG9CZUZvY3VzZWQoKVxuXHRcdGF3YWl0IGV4cGVjdChhbmNob3IpLnRvSGF2ZVRleHQoJzA6MTUuMDAwJylcblx0XHQvLyBUaGUgcGxhY2Ugd2FpdHMgb24gdGhlIHdhdmUgYXMgYSBsaW5lIGluIHRoZSBwcmltYXJ5IGNvbG91ciwgb3ZlciB0aGUgd2F2ZSBub3QgeWV0IHBsYXllZFxuXHRcdGNvbnN0IG1hcmsgPSBhd2FpdCBjYW52YXMuZXZhbHVhdGUoKGVsZW1lbnQpID0+IHtcblx0XHRcdGNvbnN0IHByb2JlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc3BhbicpXG5cdFx0XHRwcm9iZS5zdHlsZS5jb2xvciA9ICd2YXIoLS1jb2xvci1wcmltYXJ5LWVsZW1lbnQpJ1xuXHRcdFx0ZWxlbWVudC5wYXJlbnRFbGVtZW50LmFwcGVuZChwcm9iZSlcblx0XHRcdGNvbnN0IHByaW1hcnkgPSBnZXRDb21wdXRlZFN0eWxlKHByb2JlKS5jb2xvci5tYXRjaCgvXFxkKy9nKS5tYXAoTnVtYmVyKVxuXHRcdFx0cHJvYmUucmVtb3ZlKClcblx0XHRcdGNvbnN0IHJhdGlvID0gZWxlbWVudC53aWR0aCAvIGVsZW1lbnQuY2xpZW50V2lkdGhcblx0XHRcdGNvbnN0IHBpeGVsID0gZWxlbWVudC5nZXRDb250ZXh0KCcyZCcpLmdldEltYWdlRGF0YShNYXRoLnJvdW5kKGVsZW1lbnQud2lkdGggKiAwLjc1KSwgTWF0aC5yb3VuZCg0MiAqIHJhdGlvKSwgMSwgMSkuZGF0YVxuXHRcdFx0cmV0dXJuIE1hdGgubWF4KC4uLnByaW1hcnkuc2xpY2UoMCwgMykubWFwKCh2YWx1ZSwgYXQpID0+IE1hdGguYWJzKHZhbHVlIC0gcGl4ZWxbYXRdKSkpXG5cdFx0fSlcblx0XHRleHBlY3QobWFyaykudG9CZUxlc3NUaGFuKDgpXG5cdFx0ZXhwZWN0KGF3YWl0IG1lbWJlci5sb2NhdG9yKCd2aWRlby5kZWxpdmVyLXBsYXllcl9fdmlkZW8nKS5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5jdXJyZW50VGltZSkpLnRvQmVMZXNzVGhhbigxKVxuXHRcdGF3YWl0IGV4cGVjdChtZW1iZXIubG9jYXRvcignLmRlbGl2ZXItcGxheWVyLS1mdWxsc2NyZWVuJykpLnRvSGF2ZUNvdW50KDApXG5cdFx0Ly8gQSB0YXAgb24gYSBjaXJjbGUsIDcuNSBzZWNvbmRzIG9uLCBvcGVucyBpdHMgY2FyZDsgY2xvc2luZyBpdCBoYW5kcyB0aGUgZm9jdXMgYmFjayB0byB0aGUgZmllbGRcblx0XHRjb25zdCBsYW5lID0gYXdhaXQgY2FudmFzLmJvdW5kaW5nQm94KClcblx0XHRhd2FpdCBmaW5nZXJzKCd0b3VjaFN0YXJ0JywgW1tsYW5lLnggKyBsYW5lLndpZHRoICogMC42MjUsIGxhbmUueSArIGxhbmUuaGVpZ2h0IC0gMjBdXSlcblx0XHRhd2FpdCBmaW5nZXJzKCd0b3VjaEVuZCcsIFtdKVxuXHRcdGNvbnN0IHNoZWV0ID0gbWVtYmVyLmdldEJ5Um9sZSgnZGlhbG9nJywgeyBuYW1lOiAvXkNvbW1lbnQgIy8gfSlcblx0XHRhd2FpdCBleHBlY3Qoc2hlZXQpLnRvQ29udGFpblRleHQoJ2ZvciB0aGUgcGhvbmUnKVxuXHRcdGF3YWl0IGV4cGVjdChzaGVldCkudG9CZUZvY3VzZWQoKVxuXHRcdGF3YWl0IHNoZWV0LmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnQ2xvc2UnIH0pLnRhcCgpXG5cdFx0YXdhaXQgZXhwZWN0KHNoZWV0KS50b0hhdmVDb3VudCgwKVxuXHRcdGF3YWl0IGV4cGVjdChmaWVsZCkudG9CZUZvY3VzZWQoKVxuXHRcdC8vIEEgc2luZ2xlIHRhcCBvbiB0aGUgd2F2ZSBzZWVrcyBub3doZXJlOyBhIGRvdWJsZSB0YXAgb24gaXRzIHJpZ2h0IHRoaXJkIHNraXBzIHRlbiBzZWNvbmRzLCBpbiB0aGUgbWlkZGxlIG5vdGhpbmdcblx0XHRjb25zdCB0aW1lID0gKCkgPT4gbWVtYmVyLmxvY2F0b3IoJ3ZpZGVvLmRlbGl2ZXItcGxheWVyX192aWRlbycpLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LmN1cnJlbnRUaW1lKVxuXHRcdGNvbnN0IHRhcEF0ID0gYXN5bmMgKGF0KSA9PiB7XG5cdFx0XHRhd2FpdCBmaW5nZXJzKCd0b3VjaFN0YXJ0JywgW1thdCwgeV1dKVxuXHRcdFx0YXdhaXQgZmluZ2VycygndG91Y2hFbmQnLCBbXSlcblx0XHR9XG5cdFx0Y29uc3Qgc3RhcnQgPSBhd2FpdCB0aW1lKClcblx0XHQvLyBBIGZpcnN0IHRhcCB0aGF0IGxldHMgZ28gb2YgdGhlIGVtcHR5IGZpZWxkIHNraXBzIG5vdGhpbmcgZWl0aGVyXG5cdFx0YXdhaXQgZmluZ2VycygndG91Y2hTdGFydCcsIFtbYm94LnggKyBib3gud2lkdGggKiAwLjc1LCB5XV0pXG5cdFx0YXdhaXQgbWVtYmVyLndhaXRGb3JUaW1lb3V0KDcwMClcblx0XHRhd2FpdCBmaW5nZXJzKCd0b3VjaEVuZCcsIFtdKVxuXHRcdGF3YWl0IGV4cGVjdChhbmNob3IpLnRvSGF2ZVRleHQoJzA6MTUuMDAwJylcblx0XHRhd2FpdCB0YXBBdChib3gueCArIGJveC53aWR0aCAqIDAuODUpXG5cdFx0YXdhaXQgdGFwQXQoYm94LnggKyBib3gud2lkdGggKiAwLjg1KVxuXHRcdGF3YWl0IG1lbWJlci53YWl0Rm9yVGltZW91dCg1MDApXG5cdFx0YXdhaXQgZXhwZWN0KGFuY2hvcikudG9IYXZlVGV4dCgnMDowMC4wMDAnKVxuXHRcdGV4cGVjdChhd2FpdCB0aW1lKCkpLnRvQmUoc3RhcnQpXG5cdFx0YXdhaXQgdGFwQXQoYm94LnggKyBib3gud2lkdGggKiAwLjg1KVxuXHRcdGF3YWl0IG1lbWJlci53YWl0Rm9yVGltZW91dCg1MDApXG5cdFx0ZXhwZWN0KGF3YWl0IHRpbWUoKSkudG9CZShzdGFydClcblx0XHRhd2FpdCB0YXBBdChib3gueCArIGJveC53aWR0aCAqIDAuNSlcblx0XHRhd2FpdCB0YXBBdChib3gueCArIGJveC53aWR0aCAqIDAuNSlcblx0XHRhd2FpdCBtZW1iZXIud2FpdEZvclRpbWVvdXQoNTAwKVxuXHRcdGV4cGVjdChhd2FpdCB0aW1lKCkpLnRvQmUoc3RhcnQpXG5cdFx0YXdhaXQgdGFwQXQoYm94LnggKyBib3gud2lkdGggKiAwLjg1KVxuXHRcdGF3YWl0IHRhcEF0KGJveC54ICsgYm94LndpZHRoICogMC44NSlcblx0XHRhd2FpdCBleHBlY3QucG9sbCh0aW1lKS50b0JlQ2xvc2VUbyhzdGFydCArIDEwLCAwKVxuXHRcdGF3YWl0IGV4cGVjdChtZW1iZXIubG9jYXRvcignLmRlbGl2ZXItcGxheWVyX19mbGFzaCcpKS50b0NvbnRhaW5UZXh0KCcrMTAnKVxuXHRcdGF3YWl0IHRhcEF0KGJveC54ICsgYm94LndpZHRoICogMC4xKVxuXHRcdGF3YWl0IHRhcEF0KGJveC54ICsgYm94LndpZHRoICogMC4xKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKHRpbWUpLnRvQmVDbG9zZVRvKHN0YXJ0LCAwKVxuXHRcdC8vIEEgbG9uZyBwcmVzcyBvbiBwbGF5aW5nIGF1ZGlvIHN0b3BzIGl0XG5cdFx0YXdhaXQgbWVtYmVyLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnUGxheScsIGV4YWN0OiB0cnVlIH0pLnRhcCgpXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gbWVtYmVyLmxvY2F0b3IoJ3ZpZGVvLmRlbGl2ZXItcGxheWVyX192aWRlbycpLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LnBhdXNlZCkpLnRvQmUoZmFsc2UpXG5cdFx0YXdhaXQgZmluZ2VycygndG91Y2hTdGFydCcsIFtbYm94LnggKyBib3gud2lkdGggKiAwLjc1LCB5XV0pXG5cdFx0YXdhaXQgbWVtYmVyLndhaXRGb3JUaW1lb3V0KDcwMClcblx0XHRhd2FpdCBmaW5nZXJzKCd0b3VjaEVuZCcsIFtdKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IG1lbWJlci5sb2NhdG9yKCd2aWRlby5kZWxpdmVyLXBsYXllcl9fdmlkZW8nKS5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5wYXVzZWQpKS50b0JlKHRydWUpXG5cdFx0YXdhaXQgcGhvbmUuY2xvc2UoKVxuXG5cdFx0Y29uc3QgbGluayA9IChhd2FpdCAoYXdhaXQgYXBpLnBvc3QoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHMvJHtwcm9qZWN0SWR9L2xpbmtzP2Zvcm1hdD1qc29uYCkpLmpzb24oKSkub2NzLmRhdGFcblx0XHRleHBlY3QoKGF3YWl0IGFwaS5wdXQoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvbGlua3MvJHtsaW5rLmlkfT9mb3JtYXQ9anNvbmAsIHsgZGF0YTogeyBjYW5Db21tZW50OiBmYWxzZSB9IH0pKS5vaygpKS50b0JlKHRydWUpXG5cdFx0YXdhaXQgYXBpLmRpc3Bvc2UoKVxuXHRcdGNvbnN0IHZpc2l0b3IgPSBhd2FpdCBicm93c2VyLm5ld0NvbnRleHQoeyBiYXNlVVJMOiBCUk9XU0VSX1VSTCB9KVxuXHRcdGNvbnN0IHJldmlld2VyID0gYXdhaXQgdmlzaXRvci5uZXdQYWdlKClcblx0XHRhd2FpdCByZXZpZXdlci5nb3RvKGAvYXBwcy9kZWxpdmVyL3MvJHtsaW5rLnRva2VufS92ZXJzaW9ucy8ke3ZlcnNpb25JZH1gKVxuXHRcdGNvbnN0IHdhdmUgPSByZXZpZXdlci5sb2NhdG9yKCcuZGVsaXZlci13YXZlIGNhbnZhcycpXG5cdFx0YXdhaXQgZXhwZWN0KHdhdmUpLnRvQmVWaXNpYmxlKClcblx0XHRhd2FpdCByZXZpZXdlci5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJzE1IHMnIH0pLmNsaWNrKClcblx0XHRhd2FpdCByZXZpZXdlci5sb2NhdG9yKCcuZGVsaXZlci1jb21tZW50JykuZmlsdGVyKHsgaGFzVGV4dDogJ2ZvciB0aGUgcGhvbmUnIH0pLmxvY2F0b3IoJy5kZWxpdmVyLWNvbW1lbnRfX2FuY2hvcicpLmNsaWNrKClcblx0XHRjb25zdCBzdGFnZSA9IGF3YWl0IHdhdmUuYm91bmRpbmdCb3goKVxuXHRcdGF3YWl0IHdhdmUuY2xpY2soeyBwb3NpdGlvbjogeyB4OiBzdGFnZS53aWR0aCAvIDIsIHk6IHN0YWdlLmhlaWdodCAtIDIwIH0gfSlcblx0XHRjb25zdCBjYXJkID0gcmV2aWV3ZXIuZ2V0QnlSb2xlKCdkaWFsb2cnLCB7IG5hbWU6IC9eQ29tbWVudCAjLyB9KVxuXHRcdGF3YWl0IGV4cGVjdChjYXJkKS50b0NvbnRhaW5UZXh0KCdhbmQgYSByZXBseScpXG5cdFx0YXdhaXQgZXhwZWN0KGNhcmQubG9jYXRvcigndGV4dGFyZWEnKSkudG9IYXZlQ291bnQoMClcblx0XHRhd2FpdCBleHBlY3QoY2FyZC5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ0dvIHRvJyB9KSkudG9CZVZpc2libGUoKVxuXHRcdC8vIEEgY2xpY2sgZWxzZXdoZXJlIGluIHRoZSBzdHJpcCBzZWVrcyBidXQgb3BlbnMgbm8gZmllbGRcblx0XHRhd2FpdCBjYXJkLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnQ2xvc2UnIH0pLmNsaWNrKClcblx0XHRhd2FpdCB3YXZlLmNsaWNrKHsgcG9zaXRpb246IHsgeDogc3RhZ2Uud2lkdGggKiAwLjc1LCB5OiBzdGFnZS5oZWlnaHQgLSAyMCB9IH0pXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gcmV2aWV3ZXIubG9jYXRvcigndmlkZW8uZGVsaXZlci1wbGF5ZXJfX3ZpZGVvJykuZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQuY3VycmVudFRpbWUpKS50b0JlQ2xvc2VUbygxMS4yNSwgMClcblx0XHRhd2FpdCBleHBlY3QocmV2aWV3ZXIubG9jYXRvcignI2RlbGl2ZXItY29tbWVudC1ib2R5JykpLnRvSGF2ZUNvdW50KDApXG5cdFx0YXdhaXQgdmlzaXRvci5jbG9zZSgpXG5cdH0pXG59KVxuXG4vKipcbiAqIEBwYXJhbSB7aW1wb3J0KCdAcGxheXdyaWdodC90ZXN0JykuTG9jYXRvcn0gdmlkZW9zIC0gQ29tcGFyZSdzIHR3byBtZWRpYSBlbGVtZW50c1xuICogQHJldHVybiB7UHJvbWlzZTxib29sZWFuW10+fSB3aGV0aGVyIGVhY2ggc2lkZSBpcyBoZWFyZDogYnkgaXRzIGdhaW4gd2hlcmUgYm90aCBwbGF5IGludG8gdGhlIEF1ZGlvQ29udGV4dCAoQTcpLCBieSBtdXRpbmcgdW50aWwgdGhlblxuICovXG5jb25zdCBoZWFyZCA9ICh2aWRlb3MpID0+IHZpZGVvcy5ldmFsdWF0ZUFsbCgoYWxsKSA9PiBhbGwubWFwKCh2aWRlbykgPT4gdmlkZW8uZGVsaXZlckdhaW4gJiYgIXZpZGVvLm11dGVkID8gdmlkZW8uZGVsaXZlckdhaW4uZ2Fpbi52YWx1ZSA+IDAuNSA6ICF2aWRlby5tdXRlZCkpXG5cbnRlc3QuZGVzY3JpYmUoJ0NvbXBhcmluZyBzb3VuZCcsICgpID0+IHtcblx0bGV0IGJyb3dzZXJcblx0bGV0IGNvbnRleHRcblx0bGV0IHBhZ2Vcblx0bGV0IGZvbGRlclxuXHRsZXQgcHJvamVjdElkXG5cdC8qKiBFYWNoIEFzc2V0J3MgVmVyc2lvbnMsIG5ld2VzdCBmaXJzdCAqL1xuXHRsZXQgbWl4XG5cdGxldCBjdXRcblxuXHR0ZXN0LmJlZm9yZUFsbChhc3luYyAoeyBwbGF5d3JpZ2h0IH0pID0+IHtcblx0XHRhd2FpdCB0ZXN0VXNlcihwbGF5d3JpZ2h0KVxuXHRcdGNvbnN0IGFwaSA9IGF3YWl0IHBsYXl3cmlnaHQucmVxdWVzdC5uZXdDb250ZXh0KHsgYmFzZVVSTDogVVJMLCBodHRwQ3JlZGVudGlhbHM6IGF1dGgsIGV4dHJhSFRUUEhlYWRlcnM6IG9jc0hlYWRlcnMgfSlcblx0XHRmb2xkZXIgPSAnZGVsaXZlci1lMmUtJyArIHJhbmRvbUJ5dGVzKDQpLnRvU3RyaW5nKCdoZXgnKVxuXHRcdGNvbnN0IGRhdiA9IGAvcmVtb3RlLnBocC9kYXYvZmlsZXMvJHtVU0VSfS8ke2ZvbGRlcn1gXG5cdFx0ZXhwZWN0KChhd2FpdCBhcGkuZmV0Y2goZGF2LCB7IG1ldGhvZDogJ01LQ09MJyB9KSkuc3RhdHVzKCkpLnRvQmUoMjAxKVxuXHRcdGNvbnN0IGNyZWF0ZWQgPSBhd2FpdCBhcGkucG9zdCgnL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS9wcm9qZWN0cz9mb3JtYXQ9anNvbicsIHsgZGF0YTogeyBmb2xkZXJJZDogYXdhaXQgZmlsZUlkKGFwaSwgZGF2KSwgYXV0b0ludGFrZTogdHJ1ZSB9IH0pXG5cdFx0cHJvamVjdElkID0gKGF3YWl0IGNyZWF0ZWQuanNvbigpKS5vY3MuZGF0YS5pZFxuXHRcdC8vIE9uZSBhZnRlciB0aGUgb3RoZXIsIHNvIHRoZSBzZWNvbmQgb2YgZWFjaCBzdGFja3Mgb24gdGhlIGZpcnN0IGFzIGl0cyBWMlxuXHRcdGZvciAoY29uc3QgW25hbWUsIGZpbGVdIG9mIFtbJ21peC53ZWJtJywgTUlYX0FdLCBbJ21peF92Mi53ZWJtJywgTUlYX0JdLCBbJ2N1dC53ZWJtJywgQ1VUX0FdLCBbJ2N1dF92Mi53ZWJtJywgQ1VUX0JdXSkge1xuXHRcdFx0ZXhwZWN0KChhd2FpdCBhcGkuZmV0Y2goYCR7ZGF2fS8ke25hbWV9YCwgeyBtZXRob2Q6ICdQVVQnLCBkYXRhOiByZWFkRmlsZVN5bmMoZmlsZSkgfSkpLnN0YXR1cygpKS50b0JlKDIwMSlcblx0XHR9XG5cdFx0Y29uc3QgYXNzZXRzID0gYXN5bmMgKCkgPT4gKGF3YWl0IChhd2FpdCBhcGkuZ2V0KGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3Byb2plY3RzLyR7cHJvamVjdElkfT9mb3JtYXQ9anNvbmApKS5qc29uKCkpLm9jcy5kYXRhLmFzc2V0c1xuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKGFzeW5jICgpID0+IChhd2FpdCBhc3NldHMoKSkubWFwKChhc3NldCkgPT4gYXNzZXQudmVyc2lvbnMubGVuZ3RoKS5qb2luKCkpLnRvQmUoJzIsMicpXG5cdFx0Y29uc3QgYWxsID0gYXdhaXQgYXNzZXRzKClcblx0XHRtaXggPSBhbGwuZmluZCgoYXNzZXQpID0+IGFzc2V0Lm5hbWUgPT09ICdtaXgnKS52ZXJzaW9uc1xuXHRcdGN1dCA9IGFsbC5maW5kKChhc3NldCkgPT4gYXNzZXQubmFtZSA9PT0gJ2N1dCcpLnZlcnNpb25zXG5cdFx0Ly8gZmZtcGVnIG1ha2VzIHRoZSBXYXZlZm9ybXNcblx0XHRjb25zdCByZWFkeSA9IGFzeW5jICh2ZXJzaW9uKSA9PiAoYXdhaXQgKGF3YWl0IGFwaS5nZXQoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvdmVyc2lvbnMvJHt2ZXJzaW9uLmlkfT9mb3JtYXQ9anNvbmApKS5qc29uKCkpLm9jcy5kYXRhLnZlcnNpb25zXG5cdFx0XHQuZXZlcnkoKGVhY2gpID0+IGVhY2guZGVyaXZlZC53YXZlZm9ybS5zdGF0ZSA9PT0gJ3JlYWR5Jylcblx0XHRhd2FpdCBleHBlY3QucG9sbChhc3luYyAoKSA9PiB7XG5cdFx0XHRleGVjRmlsZVN5bmMoJ2RvY2tlcicsIFsnY29tcG9zZScsICdleGVjJywgJy1UJywgJy11JywgJ3d3dy1kYXRhJywgJ25leHRjbG91ZCcsICdwaHAnLCAnb2NjJywgJ2RlbGl2ZXI6d29ya2VyJywgJy0tb25jZSddLCB7IHN0ZGlvOiAnaW5oZXJpdCcgfSlcblx0XHRcdHJldHVybiBhd2FpdCByZWFkeShtaXhbMF0pICYmIGF3YWl0IHJlYWR5KGN1dFswXSlcblx0XHR9LCB7IHRpbWVvdXQ6IDYwXzAwMCB9KS50b0JlKHRydWUpXG5cdFx0YXdhaXQgYXBpLmRpc3Bvc2UoKVxuXHRcdGJyb3dzZXIgPSBhd2FpdCBjaHJvbWl1bS5jb25uZWN0T3ZlckNEUChDRFApXG5cdFx0Y29udGV4dCA9IGF3YWl0IGJyb3dzZXIubmV3Q29udGV4dCh7IGJhc2VVUkw6IEJST1dTRVJfVVJMIH0pXG5cdFx0cGFnZSA9IGF3YWl0IGNvbnRleHQubmV3UGFnZSgpXG5cdFx0YXdhaXQgbG9naW4ocGFnZSlcblx0fSlcblxuXHR0ZXN0LmFmdGVyQWxsKGFzeW5jICh7IHBsYXl3cmlnaHQgfSkgPT4ge1xuXHRcdGF3YWl0IGNvbnRleHQ/LmNsb3NlKClcblx0XHRhd2FpdCBicm93c2VyPy5jbG9zZSgpXG5cdFx0Y29uc3QgYXBpID0gYXdhaXQgcGxheXdyaWdodC5yZXF1ZXN0Lm5ld0NvbnRleHQoeyBiYXNlVVJMOiBVUkwsIGh0dHBDcmVkZW50aWFsczogYXV0aCwgZXh0cmFIVFRQSGVhZGVyczogb2NzSGVhZGVycyB9KVxuXHRcdGF3YWl0IGFwaS5kZWxldGUoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHMvJHtwcm9qZWN0SWR9P2Zvcm1hdD1qc29uYClcblx0XHRhd2FpdCBhcGkuZmV0Y2goYC9yZW1vdGUucGhwL2Rhdi9maWxlcy8ke1VTRVJ9LyR7Zm9sZGVyfWAsIHsgbWV0aG9kOiAnREVMRVRFJyB9KVxuXHRcdGF3YWl0IGFwaS5kaXNwb3NlKClcblx0fSlcblxuXHR0ZXN0KCd0d28gYXVkaW8gVmVyc2lvbnMgY29tcGFyZSBvbiB0d28gbGFuZXMgdW5kZXIgb25lIHBsYXloZWFkLCBhbmQgMSwgMiwgVGFiIGFuZCB0aGUgbGFuZXNcXCcgbmFtZXMgc3dpdGNoIHRoZSBzb3VuZCB3aGlsZSBib3RoIHBsYXkgb24nLCBhc3luYyAoKSA9PiB7XG5cdFx0YXdhaXQgcGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL2NvbXBhcmUvJHttaXhbMV0uaWR9LyR7bWl4WzBdLmlkfWApXG5cdFx0Y29uc3QgdmlkZW9zID0gcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21wYXJlIHZpZGVvJylcblx0XHRhd2FpdCBleHBlY3QodmlkZW9zKS50b0hhdmVDb3VudCgyKVxuXHRcdGF3YWl0IGV4cGVjdCh2aWRlb3MuZmlyc3QoKSkudG9IYXZlSlNQcm9wZXJ0eSgncmVhZHlTdGF0ZScsIDQpXG5cdFx0Ly8gTm8gcGljdHVyZSBhcmVhIGFuZCBub3RoaW5nIHRvIGxheSBvdXQ6IHRoZSBsYW5lcyBhcmUgdGhlIHZpZXdcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21wYXJlX19zdGFnZScpKS50b0JlSGlkZGVuKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5nZXRCeVJvbGUoJ3JhZGlvJywgeyBuYW1lOiAnV2lwZScgfSkpLnRvSGF2ZUNvdW50KDApXG5cdFx0Y29uc3QgY2FudmFzID0gcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21wYXJlX19sYW5lcyBjYW52YXMnKVxuXHRcdGF3YWl0IGV4cGVjdChjYW52YXMpLnRvQmVWaXNpYmxlKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci13YXZlX19sYW5lJykpLnRvSGF2ZVRleHQoWydWMScsICdWMiddKVxuXHRcdGNvbnN0IHNpZGUgPSBwYWdlLmdldEJ5Um9sZSgncmFkaW8nLCB7IG5hbWU6IC9eVjIvIH0pXG5cdFx0ZXhwZWN0KGF3YWl0IGhlYXJkKHZpZGVvcykpLnRvRXF1YWwoW3RydWUsIGZhbHNlXSlcblxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdQbGF5IChTcGFjZSknIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiB2aWRlb3MuZmlyc3QoKS5ldmFsdWF0ZSgodmlkZW8pID0+IHZpZGVvLmN1cnJlbnRUaW1lKSkudG9CZUdyZWF0ZXJUaGFuKDAuNSlcblx0XHQvLyBCb3RoIHBsYXkgdW5tdXRlZCBpbnRvIG9uZSBBdWRpb0NvbnRleHQsIHRoZSBnYWlucyBkZWNpZGVcblx0XHRleHBlY3QoYXdhaXQgdmlkZW9zLmV2YWx1YXRlQWxsKChhbGwpID0+IGFsbC5tYXAoKHZpZGVvKSA9PiAhdmlkZW8ubXV0ZWQgJiYgISF2aWRlby5kZWxpdmVyR2FpbikpKS50b0VxdWFsKFt0cnVlLCB0cnVlXSlcblx0XHQvLyBUaGUgaGVhcmQgc2lkZSdzIHNvdW5kIGNvbWVzIHRocm91Z2ggdGhlIGdyYXBoOiBhIG1lZGlhIGVsZW1lbnQgZnJvbSBhbm90aGVyIG9yaWdpbiB3b3VsZCBnaXZlIHNpbGVuY2Vcblx0XHRjb25zdCBsZXZlbCA9IGF3YWl0IHZpZGVvcy5maXJzdCgpLmV2YWx1YXRlKCh2aWRlbykgPT4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcblx0XHRcdGNvbnN0IGFuYWx5c2VyID0gdmlkZW8uZGVsaXZlckdhaW4uY29udGV4dC5jcmVhdGVBbmFseXNlcigpXG5cdFx0XHR2aWRlby5kZWxpdmVyR2Fpbi5jb25uZWN0KGFuYWx5c2VyKVxuXHRcdFx0c2V0VGltZW91dCgoKSA9PiB7XG5cdFx0XHRcdGNvbnN0IGRhdGEgPSBuZXcgRmxvYXQzMkFycmF5KGFuYWx5c2VyLmZmdFNpemUpXG5cdFx0XHRcdGFuYWx5c2VyLmdldEZsb2F0VGltZURvbWFpbkRhdGEoZGF0YSlcblx0XHRcdFx0cmVzb2x2ZShNYXRoLm1heCguLi5kYXRhLm1hcChNYXRoLmFicykpKVxuXHRcdFx0fSwgMzAwKVxuXHRcdH0pKVxuXHRcdGV4cGVjdChsZXZlbCkudG9CZUdyZWF0ZXJUaGFuKDAuMDUpXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnMicpXG5cdFx0YXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gaGVhcmQodmlkZW9zKSkudG9FcXVhbChbZmFsc2UsIHRydWVdKVxuXHRcdGF3YWl0IGV4cGVjdChzaWRlKS50b0hhdmVBdHRyaWJ1dGUoJ2FyaWEtY2hlY2tlZCcsICd0cnVlJylcblx0XHRleHBlY3QoYXdhaXQgdmlkZW9zLmV2YWx1YXRlQWxsKChhbGwpID0+IGFsbC5tYXAoKHZpZGVvKSA9PiB2aWRlby5wYXVzZWQpKSkudG9FcXVhbChbZmFsc2UsIGZhbHNlXSlcblx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCcxJylcblx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiBoZWFyZCh2aWRlb3MpKS50b0VxdWFsKFt0cnVlLCBmYWxzZV0pXG5cblx0XHQvLyBBIGNsaWNrIG9uIGEgd2F2ZSBzZWVrcyBhbmQga2VlcHMgcGxheWluZzsgdGhlIHBsYXllciB0aGVuIGhhcyB0aGUgZm9jdXMsIGFuZCBUYWIgc3dpdGNoZXNcblx0XHRjb25zdCBib3ggPSBhd2FpdCBjYW52YXMuYm91bmRpbmdCb3goKVxuXHRcdGNvbnN0IHNvdWdodCA9IHZpZGVvcy5maXJzdCgpLmV2YWx1YXRlKCh2aWRlbykgPT4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHZpZGVvLmFkZEV2ZW50TGlzdGVuZXIoJ3NlZWtpbmcnLCAoKSA9PiByZXNvbHZlKHRydWUpLCB7IG9uY2U6IHRydWUgfSkpKVxuXHRcdGF3YWl0IGNhbnZhcy5jbGljayh7IHBvc2l0aW9uOiB7IHg6IGJveC53aWR0aCAqIDAuNiwgeTogYm94LmhlaWdodCAqIDAuNiB9IH0pXG5cdFx0ZXhwZWN0KGF3YWl0IHNvdWdodCkudG9CZSh0cnVlKVxuXHRcdC8vIExhbmVzIGhhdmUgbm8gc3RyaXA6IGF0IHRoZWlyIGZvb3QgdGhlIG1vdXNlIHNob3dzIG5vIHBsYWNlIHRvIGdvIHRvXG5cdFx0YXdhaXQgY2FudmFzLmhvdmVyKHsgcG9zaXRpb246IHsgeDogYm94LndpZHRoICogMC42LCB5OiBib3guaGVpZ2h0IC0gNSB9IH0pXG5cdFx0ZXhwZWN0KGF3YWl0IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItd2F2ZScpLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LnN0eWxlLmN1cnNvcikpLnRvQmUoJycpXG5cdFx0ZXhwZWN0KGF3YWl0IHZpZGVvcy5maXJzdCgpLmV2YWx1YXRlKCh2aWRlbykgPT4gdmlkZW8ucGF1c2VkKSkudG9CZShmYWxzZSlcblx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdUYWInKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IGhlYXJkKHZpZGVvcykpLnRvRXF1YWwoW2ZhbHNlLCB0cnVlXSlcblx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdUYWInKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IGhlYXJkKHZpZGVvcykpLnRvRXF1YWwoW3RydWUsIGZhbHNlXSlcblx0XHQvLyBNb3ZpbmcgdGhyb3VnaCB0aGUgcGFnZSBieSBrZXlib2FyZCwgVGFiIG1vdmVzIHRoZSBmb2N1cyBhbmQgbGVhdmVzIHRoZSBzb3VuZCBhbG9uZVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ1NoaWZ0K1RhYicpXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnVGFiJylcblx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdUYWInKVxuXHRcdGV4cGVjdChhd2FpdCBoZWFyZCh2aWRlb3MpKS50b0VxdWFsKFt0cnVlLCBmYWxzZV0pXG5cdFx0ZXhwZWN0KGF3YWl0IHBhZ2UuZXZhbHVhdGUoKCkgPT4gZG9jdW1lbnQuYWN0aXZlRWxlbWVudC5jbGFzc0xpc3QuY29udGFpbnMoJ2RlbGl2ZXItY29tcGFyZScpKSkudG9CZShmYWxzZSlcblxuXHRcdC8vIEEgbGFuZSdzIG5hbWUgcGxheXMgaXRzIHNpZGVcblx0XHRhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLXdhdmVfX2xhbmUnKS5udGgoMSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IGhlYXJkKHZpZGVvcykpLnRvRXF1YWwoW2ZhbHNlLCB0cnVlXSlcblx0XHRhd2FpdCBleHBlY3Qoc2lkZSkudG9IYXZlQXR0cmlidXRlKCdhcmlhLWNoZWNrZWQnLCAndHJ1ZScpXG5cdFx0ZXhwZWN0KGF3YWl0IHZpZGVvcy5ldmFsdWF0ZUFsbCgoYWxsKSA9PiBhbGwubWFwKCh2aWRlbykgPT4gdmlkZW8ucGF1c2VkKSkpLnRvRXF1YWwoW2ZhbHNlLCBmYWxzZV0pXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1BhdXNlIChTcGFjZSknIH0pLmNsaWNrKClcblx0fSlcblxuXHR0ZXN0KCdzd2l0Y2hpbmcgdGVuIHRpbWVzIHdoaWxlIGJvdGggcGxheSBzZWVrcyBuZWl0aGVyIHNpZGUsIHRoZSBoZWFyZCBzb3VuZCBydW5zIG9uIGluIHJlYWwgdGltZSwgYW5kIHRoZSBzaWRlcyBzdGF5IHdpdGhpbiBtaWxsaXNlY29uZHMnLCBhc3luYyAoKSA9PiB7XG5cdFx0YXdhaXQgcGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL2NvbXBhcmUvJHttaXhbMV0uaWR9LyR7bWl4WzBdLmlkfWApXG5cdFx0Y29uc3QgdmlkZW9zID0gcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21wYXJlIHZpZGVvJylcblx0XHRhd2FpdCBleHBlY3QodmlkZW9zLmZpcnN0KCkpLnRvSGF2ZUpTUHJvcGVydHkoJ3JlYWR5U3RhdGUnLCA0KVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdQbGF5IChTcGFjZSknIH0pLmNsaWNrKClcblx0XHRhd2FpdCBwYWdlLndhaXRGb3JUaW1lb3V0KDE1MDApXG5cdFx0Ly8gT24gZXZlcnkgYW5pbWF0aW9uIGZyYW1lOiBib3RoIHRpbWVzLCB3aG9zZSBzb3VuZCBpcyBoZWFyZCwgYW5kIGV2ZXJ5IHNlZWs7IGEgc3dpdGNoIGV2ZXJ5IDQwMCBtc1xuXHRcdGNvbnN0IHJ1biA9IGF3YWl0IHBhZ2UuZXZhbHVhdGUoKCkgPT4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcblx0XHRcdGNvbnN0IFthLCBiXSA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJy5kZWxpdmVyLWNvbXBhcmUgdmlkZW8nKVxuXHRcdFx0Y29uc3QgaGFsdmVzID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnLmRlbGl2ZXItY29tcGFyZV9fc291bmQnKVxuXHRcdFx0bGV0IHNlZWtzID0gMFxuXHRcdFx0YS5hZGRFdmVudExpc3RlbmVyKCdzZWVraW5nJywgKCkgPT4gc2Vla3MrKylcblx0XHRcdGIuYWRkRXZlbnRMaXN0ZW5lcignc2Vla2luZycsICgpID0+IHNlZWtzKyspXG5cdFx0XHRjb25zdCBzYW1wbGVzID0gW11cblx0XHRcdGNvbnN0IHN0YXJ0ID0gcGVyZm9ybWFuY2Uubm93KClcblx0XHRcdGxldCBzd2l0Y2hlcyA9IDBcblx0XHRcdGNvbnN0IHRpY2sgPSAoKSA9PiB7XG5cdFx0XHRcdGNvbnN0IG5vdyA9IHBlcmZvcm1hbmNlLm5vdygpXG5cdFx0XHRcdGNvbnN0IHNpZGUgPSBoYWx2ZXNbMF0uZ2V0QXR0cmlidXRlKCdhcmlhLWNoZWNrZWQnKSA9PT0gJ3RydWUnID8gJ2EnIDogJ2InXG5cdFx0XHRcdHNhbXBsZXMucHVzaCh7IG5vdywgYTogYS5jdXJyZW50VGltZSwgYjogYi5jdXJyZW50VGltZSwgc2lkZSB9KVxuXHRcdFx0XHRpZiAobm93IC0gc3RhcnQgPiAoc3dpdGNoZXMgKyAxKSAqIDQwMCAmJiBzd2l0Y2hlcyA8IDEwKSB7XG5cdFx0XHRcdFx0c3dpdGNoZXMrK1xuXHRcdFx0XHRcdGhhbHZlc1tzd2l0Y2hlcyAlIDJdLmNsaWNrKClcblx0XHRcdFx0fVxuXHRcdFx0XHRpZiAobm93IC0gc3RhcnQgPCA0NjAwKSB7XG5cdFx0XHRcdFx0cmVxdWVzdEFuaW1hdGlvbkZyYW1lKHRpY2spXG5cdFx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdFx0cmVzb2x2ZSh7IHNlZWtzLCBzYW1wbGVzLCBwbGF5aW5nOiAhYS5wYXVzZWQgJiYgIWIucGF1c2VkIH0pXG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHRcdHJlcXVlc3RBbmltYXRpb25GcmFtZSh0aWNrKVxuXHRcdH0pKVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdQYXVzZSAoU3BhY2UpJyB9KS5jbGljaygpXG5cdFx0ZXhwZWN0KHJ1bi5wbGF5aW5nKS50b0JlKHRydWUpXG5cdFx0ZXhwZWN0KHJ1bi5zZWVrcykudG9CZSgwKVxuXHRcdGV4cGVjdChuZXcgU2V0KHJ1bi5zYW1wbGVzLm1hcCgoc2FtcGxlKSA9PiBzYW1wbGUuc2lkZSkpLnNpemUpLnRvQmUoMilcblx0XHRjb25zdCBwb3NpdGlvbiA9IChzYW1wbGUpID0+IHNhbXBsZS5zaWRlID09PSAnYScgPyBzYW1wbGUuYSA6IHNhbXBsZS5iXG5cdFx0Zm9yIChjb25zdCBbYXQsIHNhbXBsZV0gb2YgcnVuLnNhbXBsZXMuZW50cmllcygpKSB7XG5cdFx0XHQvLyBXaXRob3V0IGFuIG9mZnNldCB0aGUgc2lkZXMgc3RhbmQgb24gdGhlIHNhbWUgc2Vjb25kXG5cdFx0XHRleHBlY3QoTWF0aC5hYnMoc2FtcGxlLmIgLSBzYW1wbGUuYSkpLnRvQmVMZXNzVGhhbigwLjAxKVxuXHRcdFx0aWYgKGF0ID4gMCkge1xuXHRcdFx0XHRjb25zdCBiZWZvcmUgPSBydW4uc2FtcGxlc1thdCAtIDFdXG5cdFx0XHRcdC8vIFRoZSBoZWFyZCBzb3VuZCBnb2VzIG9uIHdpdGggdGhlIGNsb2NrIGFjcm9zcyBldmVyeSBzd2l0Y2g7IGEgcmVhZGluZyBvZiBhIG1lZGlhIGVsZW1lbnQncyB0aW1lIGlzIG9mZiBieSBhIGZldyBtc1xuXHRcdFx0XHRleHBlY3QoTWF0aC5hYnMoKHBvc2l0aW9uKHNhbXBsZSkgLSBwb3NpdGlvbihiZWZvcmUpKSAtIChzYW1wbGUubm93IC0gYmVmb3JlLm5vdykgLyAxMDAwKSkudG9CZUxlc3NUaGFuKDAuMDE1KVxuXHRcdFx0fVxuXHRcdH1cblx0fSlcblxuXHR0ZXN0KCdvbiBhIHBhZ2VcXCdzIGZpcnN0IFBsYXkgdGhlIHNpZGVzIGFyZSBpbiBzdGVwIGZyb20gdGhlIGZpcnN0IHNlY29uZCBvbiwgdmlkZW8gYW5kIGF1ZGlvIGFsaWtlJywgYXN5bmMgKCkgPT4ge1xuXHRcdGZvciAoY29uc3QgcGFpciBvZiBbY3V0LCBtaXhdKSB7XG5cdFx0XHQvLyBBIHBhZ2Ugb2YgaXRzIG93bjogdGhlIEF1ZGlvQ29udGV4dCBpcyBtYWRlIGJ5IHRoaXMgUGxheVxuXHRcdFx0Y29uc3QgZnJlc2ggPSBhd2FpdCBjb250ZXh0Lm5ld1BhZ2UoKVxuXHRcdFx0YXdhaXQgZnJlc2guZ290byhgL2FwcHMvZGVsaXZlci9jb21wYXJlLyR7cGFpclsxXS5pZH0vJHtwYWlyWzBdLmlkfWApXG5cdFx0XHRjb25zdCB2aWRlb3MgPSBmcmVzaC5sb2NhdG9yKCcuZGVsaXZlci1jb21wYXJlIHZpZGVvJylcblx0XHRcdGF3YWl0IGV4cGVjdCh2aWRlb3MuZmlyc3QoKSkudG9IYXZlSlNQcm9wZXJ0eSgncmVhZHlTdGF0ZScsIDQpXG5cdFx0XHQvLyBFYWNoIHNpZGUgaXMgc291Z2h0IG9uY2UsIGJ5IHRoZSBzdGFydCBpdHNlbGY6IHRoZSBoZWFyZCBzaWRlIGlzIG5ldmVyIHNvdWdodCBhZ2FpblxuXHRcdFx0YXdhaXQgZnJlc2guZXZhbHVhdGUoKCkgPT4ge1xuXHRcdFx0XHR3aW5kb3cuc2Vla3MgPSBbMCwgMF1cblx0XHRcdFx0ZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnLmRlbGl2ZXItY29tcGFyZSB2aWRlbycpLmZvckVhY2goKHZpZGVvLCBzaWRlKSA9PiB2aWRlby5hZGRFdmVudExpc3RlbmVyKCdzZWVraW5nJywgKCkgPT4gd2luZG93LnNlZWtzW3NpZGVdKyspKVxuXHRcdFx0fSlcblx0XHRcdGF3YWl0IGZyZXNoLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnUGxheSAoU3BhY2UpJyB9KS5jbGljaygpXG5cdFx0XHRhd2FpdCBmcmVzaC53YWl0Rm9yVGltZW91dCgxMDAwKVxuXHRcdFx0ZXhwZWN0KGF3YWl0IGZyZXNoLmV2YWx1YXRlKCgpID0+IHdpbmRvdy5zZWVrcykpLnRvRXF1YWwoWzEsIDFdKVxuXHRcdFx0Y29uc3QgYXBhcnQgPSBhd2FpdCBmcmVzaC5ldmFsdWF0ZSgoKSA9PiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuXHRcdFx0XHRjb25zdCBbYSwgYl0gPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCcuZGVsaXZlci1jb21wYXJlIHZpZGVvJylcblx0XHRcdFx0Y29uc3QgZm91bmQgPSBbXVxuXHRcdFx0XHRjb25zdCBzdGFydCA9IHBlcmZvcm1hbmNlLm5vdygpXG5cdFx0XHRcdGNvbnN0IHRpY2sgPSAoKSA9PiB7XG5cdFx0XHRcdFx0Zm91bmQucHVzaChNYXRoLmFicyhiLmN1cnJlbnRUaW1lIC0gYS5jdXJyZW50VGltZSkpXG5cdFx0XHRcdFx0aWYgKHBlcmZvcm1hbmNlLm5vdygpIC0gc3RhcnQgPCAxNTAwKSB7XG5cdFx0XHRcdFx0XHRyZXF1ZXN0QW5pbWF0aW9uRnJhbWUodGljaylcblx0XHRcdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRcdFx0cmVzb2x2ZShNYXRoLm1heCguLi5mb3VuZCkpXG5cdFx0XHRcdFx0fVxuXHRcdFx0XHR9XG5cdFx0XHRcdHJlcXVlc3RBbmltYXRpb25GcmFtZSh0aWNrKVxuXHRcdFx0fSkpXG5cdFx0XHRleHBlY3QoYXBhcnQpLnRvQmVMZXNzVGhhbigwLjAwNSlcblx0XHRcdGV4cGVjdChhd2FpdCBmcmVzaC5ldmFsdWF0ZSgoKSA9PiB3aW5kb3cuc2Vla3MpKS50b0VxdWFsKFsxLCAxXSlcblx0XHRcdGF3YWl0IGZyZXNoLmNsb3NlKClcblx0XHR9XG5cdH0pXG5cblx0dGVzdCgnd2hpbGUgdGhlIEF1ZGlvQ29udGV4dCBpcyBzbG93IHRvIHN0YXJ0LCBvbmUgc3RhcnQgd2FpdHMgYXQgYSB0aW1lIGFuZCBhIHN3aXRjaCBtYWRlIG1lYW53aGlsZSBpcyB0aGUgc2lkZSBoZWFyZCcsIGFzeW5jICgpID0+IHtcblx0XHQvLyBBIGNvbnRleHQgdGhhdCB0YWtlcyAzMDAgbXMgdG8gcnVuLCBhcyBhIHNsb3cgb3V0cHV0IG1heVxuXHRcdGNvbnN0IHNsb3cgPSBhd2FpdCBicm93c2VyLm5ld0NvbnRleHQoeyBiYXNlVVJMOiBCUk9XU0VSX1VSTCB9KVxuXHRcdGF3YWl0IHNsb3cuYWRkSW5pdFNjcmlwdCgoKSA9PiB7XG5cdFx0XHRjb25zdCByZXN1bWUgPSBBdWRpb0NvbnRleHQucHJvdG90eXBlLnJlc3VtZVxuXHRcdFx0QXVkaW9Db250ZXh0LnByb3RvdHlwZS5yZXN1bWUgPSBmdW5jdGlvbigpIHtcblx0XHRcdFx0cmV0dXJuIG5ldyBQcm9taXNlKChkb25lKSA9PiBzZXRUaW1lb3V0KGRvbmUsIDMwMCkpLnRoZW4oKCkgPT4gcmVzdW1lLmNhbGwodGhpcykpXG5cdFx0XHR9XG5cdFx0fSlcblx0XHRjb25zdCBwYWdlID0gYXdhaXQgc2xvdy5uZXdQYWdlKClcblx0XHRhd2FpdCBsb2dpbihwYWdlKVxuXHRcdGNvbnN0IG9wZW4gPSBhc3luYyAoKSA9PiB7XG5cdFx0XHRhd2FpdCBwYWdlLmdvdG8oYC9hcHBzL2RlbGl2ZXIvY29tcGFyZS8ke21peFsxXS5pZH0vJHttaXhbMF0uaWR9YClcblx0XHRcdGNvbnN0IHZpZGVvcyA9IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tcGFyZSB2aWRlbycpXG5cdFx0XHRhd2FpdCBleHBlY3QodmlkZW9zLmZpcnN0KCkpLnRvSGF2ZUpTUHJvcGVydHkoJ3JlYWR5U3RhdGUnLCA0KVxuXHRcdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1sYXlvdXRfX2JhciBoMicpLmNsaWNrKClcblx0XHRcdHJldHVybiB2aWRlb3Ncblx0XHR9XG5cblx0XHQvLyBQbGF5LCBQYXVzZSBhbmQgUGxheSB3aXRoaW4gdGhlIHdhaXQ6IGVhY2ggc2lkZSBpcyBzb3VnaHQgYnkgdGhlIFBhdXNlIGFuZCBieSB0aGUgb25lIHN0YXJ0LCBuZXZlciBhZ2FpbiB3aGlsZSBpdCBwbGF5c1xuXHRcdGxldCB2aWRlb3MgPSBhd2FpdCBvcGVuKClcblx0XHRhd2FpdCB2aWRlb3MuZXZhbHVhdGVBbGwoKGFsbCkgPT4ge1xuXHRcdFx0d2luZG93LnNlZWtzID0gWzAsIDBdXG5cdFx0XHRhbGwuZm9yRWFjaCgodmlkZW8sIHNpZGUpID0+IHZpZGVvLmFkZEV2ZW50TGlzdGVuZXIoJ3NlZWtpbmcnLCAoKSA9PiB3aW5kb3cuc2Vla3Nbc2lkZV0rKykpXG5cdFx0fSlcblx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdTcGFjZScpXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnU3BhY2UnKVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ1NwYWNlJylcblx0XHRhd2FpdCBwYWdlLndhaXRGb3JUaW1lb3V0KDE1MDApXG5cdFx0ZXhwZWN0KGF3YWl0IHBhZ2UuZXZhbHVhdGUoKCkgPT4gd2luZG93LnNlZWtzKSkudG9FcXVhbChbMiwgMl0pXG5cdFx0Y29uc3Qgc3RhdGUgPSBhd2FpdCB2aWRlb3MuZXZhbHVhdGVBbGwoKGFsbCkgPT4gYWxsLm1hcCgodmlkZW8pID0+ICh7IHBhdXNlZDogdmlkZW8ucGF1c2VkLCB0aW1lOiB2aWRlby5jdXJyZW50VGltZSB9KSkpXG5cdFx0ZXhwZWN0KHN0YXRlLm1hcCgoZWFjaCkgPT4gZWFjaC5wYXVzZWQpKS50b0VxdWFsKFtmYWxzZSwgZmFsc2VdKVxuXHRcdGV4cGVjdChNYXRoLmFicyhzdGF0ZVsxXS50aW1lIC0gc3RhdGVbMF0udGltZSkpLnRvQmVMZXNzVGhhbigwLjAwNSlcblxuXHRcdC8vIEEgc3dpdGNoIG1hZGUgd2hpbGUgdGhlIGNvbnRleHQgc3RhcnRzIGlzIHRoZSBzaWRlIGhlYXJkIG9uY2UgaXQgcnVuc1xuXHRcdHZpZGVvcyA9IGF3YWl0IG9wZW4oKVxuXHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ1NwYWNlJylcblx0XHRhd2FpdCBwYWdlLndhaXRGb3JUaW1lb3V0KDEwMClcblx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCcyJylcblx0XHRhd2FpdCBwYWdlLndhaXRGb3JUaW1lb3V0KDYwMClcblx0XHRleHBlY3QoYXdhaXQgdmlkZW9zLmV2YWx1YXRlQWxsKChhbGwpID0+IGFsbC5tYXAoKHZpZGVvKSA9PiAhIXZpZGVvLmRlbGl2ZXJHYWluICYmICF2aWRlby5tdXRlZCkpKS50b0VxdWFsKFt0cnVlLCB0cnVlXSlcblx0XHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiBoZWFyZCh2aWRlb3MpKS50b0VxdWFsKFtmYWxzZSwgdHJ1ZV0pXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKCdyYWRpbycsIHsgbmFtZTogL15WMi8gfSkpLnRvSGF2ZUF0dHJpYnV0ZSgnYXJpYS1jaGVja2VkJywgJ3RydWUnKVxuXHRcdGF3YWl0IHNsb3cuY2xvc2UoKVxuXHR9KVxuXG5cdHRlc3QoJ2EgbG9vcGVkIFJhbmdlIGFsdGVybmF0aW5nIEEgYW5kIEIgcGxheXMgQSwgdGhlbiBCLCB0aGVuIEEsIHN3aXRjaGluZyBhdCBlYWNoIHdyYXAnLCBhc3luYyAoKSA9PiB7XG5cdFx0YXdhaXQgcGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL2NvbXBhcmUvJHttaXhbMV0uaWR9LyR7bWl4WzBdLmlkfWApXG5cdFx0Y29uc3QgdmlkZW9zID0gcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21wYXJlIHZpZGVvJylcblx0XHRhd2FpdCBleHBlY3QodmlkZW9zLmZpcnN0KCkpLnRvSGF2ZUpTUHJvcGVydHkoJ3JlYWR5U3RhdGUnLCA0KVxuXHRcdC8vIFRoZSBSYW5nZSBmcm9tIDUgcyB0byA2IHMgb2YgdGhlIDIwLCBieSB0aGUgYmFyIGFuZCBJIGFuZCBPLCBhbmQgYmFjayB0byBpdHMgc3RhcnRcblx0XHRjb25zdCBiYXIgPSBhd2FpdCBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbXBhcmVfX3RpbWVsaW5lJykuYm91bmRpbmdCb3goKVxuXHRcdGNvbnN0IGF0ID0gKHNoYXJlKSA9PiBwYWdlLm1vdXNlLmNsaWNrKGJhci54ICsgYmFyLndpZHRoICogc2hhcmUsIGJhci55ICsgYmFyLmhlaWdodCAvIDIpXG5cdFx0YXdhaXQgYXQoMC4yNSlcblx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdpJylcblx0XHRhd2FpdCBhdCgwLjMpXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnbycpXG5cdFx0YXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tcGFyZV9fY2hpcCcpKS50b0NvbnRhaW5UZXh0KC8wOjA1XFwuMFxcZFxcZCDigJMgMDowNlxcLjBcXGRcXGQvKVxuXHRcdGF3YWl0IGF0KDAuMjUpXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ0FsdGVybmF0ZSBBL0InIH0pLmNsaWNrKClcblx0XHQvLyBBbHRlcm5hdGluZyBsb29wc1xuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnTG9vcCB0aGUgUmFuZ2UnIH0pKS50b0hhdmVBdHRyaWJ1dGUoJ2FyaWEtcHJlc3NlZCcsICd0cnVlJylcblxuXHRcdC8vIFdob3NlIHNvdW5kIHBsYXlzIG9uIGV2ZXJ5IGFuaW1hdGlvbiBmcmFtZSwgY3V0IGludG8gcGFzc2VzIHdoZXJlIHRoZSB0aW1lIGp1bXBzIGJhY2tcblx0XHRjb25zdCBwYXNzZXMgPSBhd2FpdCBwYWdlLmV2YWx1YXRlKCgpID0+IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG5cdFx0XHRjb25zdCBbYSwgYl0gPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCcuZGVsaXZlci1jb21wYXJlIHZpZGVvJylcblx0XHRcdGNvbnN0IGZvdW5kID0gW11cblx0XHRcdGxldCBsYXN0ID0gSW5maW5pdHlcblx0XHRcdGNvbnN0IHRpY2sgPSAoKSA9PiB7XG5cdFx0XHRcdGNvbnN0IHRpbWUgPSBhLmN1cnJlbnRUaW1lXG5cdFx0XHRcdGNvbnN0IGdhaW4gPSAodmlkZW8pID0+IHZpZGVvLmRlbGl2ZXJHYWluICYmICF2aWRlby5tdXRlZCA/IHZpZGVvLmRlbGl2ZXJHYWluLmdhaW4udmFsdWUgPiAwLjUgOiAhdmlkZW8ubXV0ZWRcblx0XHRcdFx0Y29uc3QgaGVhcmQgPSBnYWluKGEpID8gKGdhaW4oYikgPyAnYm90aCcgOiAnYScpIDogKGdhaW4oYikgPyAnYicgOiAnbm9uZScpXG5cdFx0XHRcdGlmICh0aW1lIDwgbGFzdCAtIDAuMykge1xuXHRcdFx0XHRcdGZvdW5kLnB1c2goeyBmcm9tOiB0aW1lLCB0bzogdGltZSwgaGVhcmQ6IG5ldyBTZXQoKSB9KVxuXHRcdFx0XHR9XG5cdFx0XHRcdGxhc3QgPSB0aW1lXG5cdFx0XHRcdGNvbnN0IHBhc3MgPSBmb3VuZC5hdCgtMSlcblx0XHRcdFx0aWYgKHBhc3MgJiYgIWEucGF1c2VkKSB7XG5cdFx0XHRcdFx0cGFzcy50byA9IHRpbWVcblx0XHRcdFx0XHRwYXNzLmhlYXJkLmFkZChoZWFyZClcblx0XHRcdFx0fVxuXHRcdFx0XHRpZiAoZm91bmQubGVuZ3RoID4gMykge1xuXHRcdFx0XHRcdHJlc29sdmUoZm91bmQuc2xpY2UoMCwgMykubWFwKChlYWNoKSA9PiAoeyAuLi5lYWNoLCBoZWFyZDogWy4uLmVhY2guaGVhcmRdIH0pKSlcblx0XHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0XHRyZXF1ZXN0QW5pbWF0aW9uRnJhbWUodGljaylcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdFx0cmVxdWVzdEFuaW1hdGlvbkZyYW1lKHRpY2spXG5cdFx0XHRkb2N1bWVudC5xdWVyeVNlbGVjdG9yKCcuZGVsaXZlci1jb21wYXJlX19jb250cm9scyBidXR0b25bYXJpYS1sYWJlbD1cIlBsYXkgKFNwYWNlKVwiXScpLmNsaWNrKClcblx0XHR9KSlcblx0XHRleHBlY3QocGFzc2VzLm1hcCgocGFzcykgPT4gcGFzcy5oZWFyZCkpLnRvRXF1YWwoW1snYSddLCBbJ2InXSwgWydhJ11dKVxuXHRcdGZvciAoY29uc3QgcGFzcyBvZiBwYXNzZXMpIHtcblx0XHRcdGV4cGVjdChwYXNzLmZyb20pLnRvQmVDbG9zZVRvKDUsIDEpXG5cdFx0XHRleHBlY3QocGFzcy50bykudG9CZUdyZWF0ZXJUaGFuKDUuOSlcblx0XHRcdGV4cGVjdChwYXNzLnRvKS50b0JlTGVzc1RoYW4oNi4xKVxuXHRcdH1cblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnUGF1c2UgKFNwYWNlKScgfSkuY2xpY2soKVxuXHRcdC8vIFRoZSBzd2l0Y2ggdGVsbHMgd2hvc2UgcGFzcyBpdCBpc1xuXHRcdGNvbnN0IG5vdyA9IChhd2FpdCBoZWFyZCh2aWRlb3MpKVswXSA/IC9eVjEvIDogL15WMi9cblx0XHRhd2FpdCBleHBlY3QocGFnZS5nZXRCeVJvbGUoJ3JhZGlvJywgeyBuYW1lOiBub3cgfSkpLnRvSGF2ZUF0dHJpYnV0ZSgnYXJpYS1jaGVja2VkJywgJ3RydWUnKVxuXHR9KVxuXG5cdHRlc3QoJ2EgdmlkZW8gQ29tcGFyZSBzaG93cyBib3RoIFdhdmVmb3JtcyB1bmRlciB0aGUgcGljdHVyZXMgd2hlbiBhc2tlZCwgYW5kIHRoZSBwaWN0dXJlcyBzdGF5JywgYXN5bmMgKCkgPT4ge1xuXHRcdGF3YWl0IHBhZ2UuZ290byhgL2FwcHMvZGVsaXZlci9jb21wYXJlLyR7Y3V0WzFdLmlkfS8ke2N1dFswXS5pZH1gKVxuXHRcdGNvbnN0IHZpZGVvcyA9IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY29tcGFyZSB2aWRlbycpXG5cdFx0YXdhaXQgZXhwZWN0KHZpZGVvcy5maXJzdCgpKS50b0hhdmVKU1Byb3BlcnR5KCdyZWFkeVN0YXRlJywgNClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21wYXJlX19sYW5lcycpKS50b0hhdmVDb3VudCgwKVxuXHRcdC8vIFRoZSBBL0Igc3dpdGNoIHJlcGxhY2VzIHRoZSBzbWFsbCBzb3VuZCBidXR0b24gb2YgdGhlIGJhclxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdyYWRpbycsIHsgbmFtZTogL15WMi8gfSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IGhlYXJkKHZpZGVvcykpLnRvRXF1YWwoW2ZhbHNlLCB0cnVlXSlcblxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdXYXZlZm9ybXMnIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21wYXJlX19sYW5lcyBjYW52YXMnKSkudG9CZVZpc2libGUoKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbXBhcmVfX3N0YWdlJykpLnRvQmVWaXNpYmxlKClcblx0XHRmb3IgKGNvbnN0IHZpZGVvIG9mIGF3YWl0IHZpZGVvcy5hbGwoKSkge1xuXHRcdFx0ZXhwZWN0KChhd2FpdCB2aWRlby5ib3VuZGluZ0JveCgpKS5oZWlnaHQpLnRvQmVHcmVhdGVyVGhhbigxMDApXG5cdFx0fVxuXHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdyYWRpbycsIHsgbmFtZTogJ1dpcGUnIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKCcuZGVsaXZlci1jb21wYXJlX19oYW5kbGUnKSkudG9CZVZpc2libGUoKVxuXHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNvbXBhcmVfX2xhbmVzIGNhbnZhcycpKS50b0JlVmlzaWJsZSgpXG5cdH0pXG5cblx0dGVzdCgnb24gYSBwaG9uZSBoZWxkIHNpZGV3YXlzLCBwaWN0dXJlcywgYm90aCBsYW5lcyBhbmQgdGhlIHRyYW5zcG9ydCBmaXQgd2l0aG91dCBzY3JvbGxpbmcnLCBhc3luYyAoKSA9PiB7XG5cdFx0Y29uc3QgcGhvbmUgPSBhd2FpdCBicm93c2VyLm5ld0NvbnRleHQoeyBiYXNlVVJMOiBCUk9XU0VSX1VSTCwgLi4uUEhPTkUsIHZpZXdwb3J0OiB7IHdpZHRoOiA4NDQsIGhlaWdodDogMzkwIH0gfSlcblx0XHRjb25zdCBzaWRld2F5cyA9IGF3YWl0IHBob25lLm5ld1BhZ2UoKVxuXHRcdGF3YWl0IGxvZ2luKHNpZGV3YXlzKVxuXHRcdGF3YWl0IHNpZGV3YXlzLmdvdG8oYC9hcHBzL2RlbGl2ZXIvY29tcGFyZS8ke2N1dFsxXS5pZH0vJHtjdXRbMF0uaWR9YClcblx0XHRhd2FpdCBleHBlY3Qoc2lkZXdheXMubG9jYXRvcignLmRlbGl2ZXItY29tcGFyZSB2aWRlbycpLmZpcnN0KCkpLnRvSGF2ZUpTUHJvcGVydHkoJ3JlYWR5U3RhdGUnLCA0KVxuXHRcdGF3YWl0IHNpZGV3YXlzLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnUGxheWJhY2sgc2V0dGluZ3MnIH0pLmNsaWNrKClcblx0XHRhd2FpdCBzaWRld2F5cy5nZXRCeVJvbGUoJ21lbnVpdGVtY2hlY2tib3gnLCB7IG5hbWU6ICdXYXZlZm9ybXMnIH0pLmNsaWNrKClcblx0XHRhd2FpdCBzaWRld2F5cy5rZXlib2FyZC5wcmVzcygnRXNjYXBlJylcblx0XHRhd2FpdCBleHBlY3Qoc2lkZXdheXMubG9jYXRvcignLmRlbGl2ZXItY29tcGFyZV9fbGFuZXMgY2FudmFzJykpLnRvQmVWaXNpYmxlKClcblx0XHRjb25zdCBzdGFnZSA9IGF3YWl0IHNpZGV3YXlzLmxvY2F0b3IoJy5kZWxpdmVyLWNvbXBhcmVfX3N0YWdlJykuYm91bmRpbmdCb3goKVxuXHRcdGNvbnN0IGNvbnRyb2xzID0gYXdhaXQgc2lkZXdheXMubG9jYXRvcignLmRlbGl2ZXItY29tcGFyZV9fY29udHJvbHMnKS5ib3VuZGluZ0JveCgpXG5cdFx0ZXhwZWN0KHN0YWdlLmhlaWdodCkudG9CZUdyZWF0ZXJUaGFuKDgwKVxuXHRcdGV4cGVjdChjb250cm9scy55ICsgY29udHJvbHMuaGVpZ2h0KS50b0JlTGVzc1RoYW5PckVxdWFsKDM5MClcblx0XHRjb25zdCBzb3VuZCA9IGF3YWl0IHNpZGV3YXlzLmdldEJ5Um9sZSgncmFkaW8nLCB7IG5hbWU6IC9eVjEvIH0pLmJvdW5kaW5nQm94KClcblx0XHRleHBlY3Qoc291bmQuaGVpZ2h0KS50b0JlR3JlYXRlclRoYW5PckVxdWFsKDQ0KVxuXHRcdGF3YWl0IHBob25lLmNsb3NlKClcblx0fSlcbn0pXG5cbnRlc3QuZGVzY3JpYmUoJ1NraXBwaW5nIHRlbiBzZWNvbmRzJywgKCkgPT4ge1xuXHRsZXQgYnJvd3NlclxuXHRsZXQgY29udGV4dFxuXHRsZXQgcGFnZVxuXHRsZXQgZm9sZGVyXG5cdGxldCBwcm9qZWN0SWRcblx0bGV0IHZlcnNpb25JZFxuXG5cdHRlc3QuYmVmb3JlQWxsKGFzeW5jICh7IHBsYXl3cmlnaHQgfSkgPT4ge1xuXHRcdGF3YWl0IHRlc3RVc2VyKHBsYXl3cmlnaHQpXG5cdFx0Y29uc3QgYXBpID0gYXdhaXQgcGxheXdyaWdodC5yZXF1ZXN0Lm5ld0NvbnRleHQoeyBiYXNlVVJMOiBVUkwsIGh0dHBDcmVkZW50aWFsczogYXV0aCwgZXh0cmFIVFRQSGVhZGVyczogb2NzSGVhZGVycyB9KVxuXHRcdGZvbGRlciA9ICdkZWxpdmVyLWUyZS0nICsgcmFuZG9tQnl0ZXMoNCkudG9TdHJpbmcoJ2hleCcpXG5cdFx0Y29uc3QgZGF2ID0gYC9yZW1vdGUucGhwL2Rhdi9maWxlcy8ke1VTRVJ9LyR7Zm9sZGVyfWBcblx0XHRleHBlY3QoKGF3YWl0IGFwaS5mZXRjaChkYXYsIHsgbWV0aG9kOiAnTUtDT0wnIH0pKS5zdGF0dXMoKSkudG9CZSgyMDEpXG5cdFx0ZXhwZWN0KChhd2FpdCBhcGkuZmV0Y2goYCR7ZGF2fS9sb25nLndlYm1gLCB7IG1ldGhvZDogJ1BVVCcsIGRhdGE6IHJlYWRGaWxlU3luYyhMT05HKSB9KSkuc3RhdHVzKCkpLnRvQmUoMjAxKVxuXHRcdGNvbnN0IGNyZWF0ZWQgPSBhd2FpdCBhcGkucG9zdCgnL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS9wcm9qZWN0cz9mb3JtYXQ9anNvbicsIHsgZGF0YTogeyBmb2xkZXJJZDogYXdhaXQgZmlsZUlkKGFwaSwgZGF2KSwgYXV0b0ludGFrZTogdHJ1ZSB9IH0pXG5cdFx0cHJvamVjdElkID0gKGF3YWl0IGNyZWF0ZWQuanNvbigpKS5vY3MuZGF0YS5pZFxuXHRcdGNvbnN0IHByb2plY3QgPSBhd2FpdCBhcGkuZ2V0KGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3Byb2plY3RzLyR7cHJvamVjdElkfT9mb3JtYXQ9anNvbmApXG5cdFx0dmVyc2lvbklkID0gKGF3YWl0IHByb2plY3QuanNvbigpKS5vY3MuZGF0YS5hc3NldHNbMF0udmVyc2lvbnNbMF0uaWRcblx0XHRhd2FpdCBhcGkuZGlzcG9zZSgpXG5cdFx0YnJvd3NlciA9IGF3YWl0IGNocm9taXVtLmNvbm5lY3RPdmVyQ0RQKENEUClcblx0XHRjb250ZXh0ID0gYXdhaXQgYnJvd3Nlci5uZXdDb250ZXh0KHsgYmFzZVVSTDogQlJPV1NFUl9VUkwgfSlcblx0XHRwYWdlID0gYXdhaXQgY29udGV4dC5uZXdQYWdlKClcblx0XHRhd2FpdCBsb2dpbihwYWdlKVxuXHR9KVxuXG5cdHRlc3QuYWZ0ZXJBbGwoYXN5bmMgKHsgcGxheXdyaWdodCB9KSA9PiB7XG5cdFx0YXdhaXQgY29udGV4dD8uY2xvc2UoKVxuXHRcdGF3YWl0IGJyb3dzZXI/LmNsb3NlKClcblx0XHRjb25zdCBhcGkgPSBhd2FpdCBwbGF5d3JpZ2h0LnJlcXVlc3QubmV3Q29udGV4dCh7IGJhc2VVUkw6IFVSTCwgaHR0cENyZWRlbnRpYWxzOiBhdXRoLCBleHRyYUhUVFBIZWFkZXJzOiBvY3NIZWFkZXJzIH0pXG5cdFx0YXdhaXQgYXBpLmRlbGV0ZShgL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS9wcm9qZWN0cy8ke3Byb2plY3RJZH0/Zm9ybWF0PWpzb25gKVxuXHRcdGF3YWl0IGFwaS5mZXRjaChgL3JlbW90ZS5waHAvZGF2L2ZpbGVzLyR7VVNFUn0vJHtmb2xkZXJ9YCwgeyBtZXRob2Q6ICdERUxFVEUnIH0pXG5cdFx0YXdhaXQgYXBpLmRpc3Bvc2UoKVxuXHR9KVxuXG5cdHRlc3QoJ3RoZSBidXR0b25zIGFuZCBTaGlmdCthcnJvd3MganVtcCB0ZW4gc2Vjb25kcyBhbmQga2VlcCB0aGUgcGxheWJhY2sgc3RhdGUnLCBhc3luYyAoKSA9PiB7XG5cdFx0YXdhaXQgcGFnZS5nb3RvKGAvYXBwcy9kZWxpdmVyL3ZlcnNpb25zLyR7dmVyc2lvbklkfWApXG5cdFx0Y29uc3QgdmlkZW8gPSBwYWdlLmxvY2F0b3IoJ3ZpZGVvLmRlbGl2ZXItcGxheWVyX192aWRlbycpXG5cdFx0YXdhaXQgZXhwZWN0KHZpZGVvKS50b0hhdmVKU1Byb3BlcnR5KCdyZWFkeVN0YXRlJywgNClcblx0XHRjb25zdCB0aW1lID0gKCkgPT4gdmlkZW8uZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQuY3VycmVudFRpbWUpXG5cblx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAvXkZvcndhcmQgMTAgc2Vjb25kcy8gfSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKHRpbWUpLnRvQmVDbG9zZVRvKDEwLCAwKVxuXHRcdGV4cGVjdChhd2FpdCB2aWRlby5ldmFsdWF0ZSgoZWxlbWVudCkgPT4gZWxlbWVudC5wYXVzZWQpKS50b0JlKHRydWUpXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogL15CYWNrIDEwIHNlY29uZHMvIH0pLmNsaWNrKClcblx0XHRhd2FpdCBleHBlY3QucG9sbCh0aW1lKS50b0JlQ2xvc2VUbygwLCAwKVxuXG5cdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogL15QbGF5IFxcKC8gfSkuY2xpY2soKVxuXHRcdGF3YWl0IGV4cGVjdC5wb2xsKHRpbWUpLnRvQmVHcmVhdGVyVGhhbigwLjEpXG5cdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCcuZGVsaXZlci1yZXZpZXdfX3RpdGxlJykuY2xpY2soKVxuXHRcdGNvbnN0IGJlZm9yZUZvcndhcmQgPSBhd2FpdCB0aW1lKClcblx0XHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdTaGlmdCtBcnJvd1JpZ2h0Jylcblx0XHRhd2FpdCBwYWdlLndhaXRGb3JUaW1lb3V0KDMwMClcblx0XHRleHBlY3QoYXdhaXQgdGltZSgpKS50b0JlR3JlYXRlclRoYW4oYmVmb3JlRm9yd2FyZCArIDkuNSlcblx0XHRleHBlY3QoYXdhaXQgdmlkZW8uZXZhbHVhdGUoKGVsZW1lbnQpID0+IGVsZW1lbnQucGF1c2VkKSkudG9CZShmYWxzZSlcblx0XHRjb25zdCBiZWZvcmVCYWNrID0gYXdhaXQgdGltZSgpXG5cdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnU2hpZnQrQXJyb3dMZWZ0Jylcblx0XHRhd2FpdCBwYWdlLndhaXRGb3JUaW1lb3V0KDMwMClcblx0XHRleHBlY3QoYXdhaXQgdGltZSgpKS50b0JlTGVzc1RoYW4oYmVmb3JlQmFjayAtIDkpXG5cdFx0ZXhwZWN0KGF3YWl0IHZpZGVvLmV2YWx1YXRlKChlbGVtZW50KSA9PiBlbGVtZW50LnBhdXNlZCkpLnRvQmUoZmFsc2UpXG5cdH0pXG59KVxuXG50ZXN0LmRlc2NyaWJlKCdVcGxvYWRzIHdpdGhvdXQgZmZtcGVnJywgKCkgPT4ge1xuXHRsZXQgYWRtaW5cblx0bGV0IHByb2plY3RJZFxuXG5cdHRlc3QuYmVmb3JlQWxsKGFzeW5jICh7IHBsYXl3cmlnaHQgfSkgPT4ge1xuXHRcdGF3YWl0IHRlc3RVc2VyKHBsYXl3cmlnaHQpXG5cdFx0YWRtaW4gPSBhd2FpdCBwbGF5d3JpZ2h0LnJlcXVlc3QubmV3Q29udGV4dCh7IGJhc2VVUkw6IFVSTCwgaHR0cENyZWRlbnRpYWxzOiB7IHVzZXJuYW1lOiBBRE1JTiwgcGFzc3dvcmQ6IEFETUlOX1BBU1NXT1JELCBzZW5kOiAnYWx3YXlzJyB9LCBleHRyYUhUVFBIZWFkZXJzOiBvY3NIZWFkZXJzIH0pXG5cdFx0ZXhwZWN0KChhd2FpdCBhZG1pbi5wdXQoJy9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvYWRtaW4vc2V0dGluZ3M/Zm9ybWF0PWpzb24nLCB7IGRhdGE6IHsgZmZtcGVnUGF0aDogJy9ub25leGlzdGVudC9mZm1wZWcnLCBmZnByb2JlUGF0aDogJy9ub25leGlzdGVudC9mZnByb2JlJyB9IH0pKS5vaygpKS50b0JlKHRydWUpXG5cdFx0Y29uc3QgYXBpID0gYXdhaXQgcGxheXdyaWdodC5yZXF1ZXN0Lm5ld0NvbnRleHQoeyBiYXNlVVJMOiBVUkwsIGh0dHBDcmVkZW50aWFsczogYXV0aCwgZXh0cmFIVFRQSGVhZGVyczogb2NzSGVhZGVycyB9KVxuXHRcdGNvbnN0IGRhdiA9IGAvcmVtb3RlLnBocC9kYXYvZmlsZXMvJHtVU0VSfS9kZWxpdmVyLWUyZS0ke3JhbmRvbUJ5dGVzKDQpLnRvU3RyaW5nKCdoZXgnKX1gXG5cdFx0ZXhwZWN0KChhd2FpdCBhcGkuZmV0Y2goZGF2LCB7IG1ldGhvZDogJ01LQ09MJyB9KSkuc3RhdHVzKCkpLnRvQmUoMjAxKVxuXHRcdGNvbnN0IGNyZWF0ZWQgPSBhd2FpdCBhcGkucG9zdCgnL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS9wcm9qZWN0cz9mb3JtYXQ9anNvbicsIHsgZGF0YTogeyBmb2xkZXJJZDogYXdhaXQgZmlsZUlkKGFwaSwgZGF2KSB9IH0pXG5cdFx0cHJvamVjdElkID0gKGF3YWl0IGNyZWF0ZWQuanNvbigpKS5vY3MuZGF0YS5pZFxuXHRcdGF3YWl0IGFwaS5kaXNwb3NlKClcblx0fSlcblxuXHR0ZXN0LmFmdGVyQWxsKGFzeW5jICgpID0+IHtcblx0XHRhd2FpdCBhZG1pbi5wdXQoJy9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvYWRtaW4vc2V0dGluZ3M/Zm9ybWF0PWpzb24nLCB7IGRhdGE6IHsgZmZtcGVnUGF0aDogJycsIGZmcHJvYmVQYXRoOiAnJyB9IH0pXG5cdFx0YXdhaXQgYWRtaW4uZGlzcG9zZSgpXG5cdH0pXG5cblx0dGVzdCgncmVmdXNlcyB3aGF0IHRoaXMgYnJvd3NlciBjYW4gbmVpdGhlciBwbGF5IG5vciBjb252ZXJ0LCBiZWZvcmUgaXQgZ29lcyB1cCwgYW5kIHRha2VzIHdoYXQgcGxheXMnLCBhc3luYyAoKSA9PiB7XG5cdFx0Y29uc3QgYnJvd3NlciA9IGF3YWl0IGNocm9taXVtLmNvbm5lY3RPdmVyQ0RQKENEUClcblx0XHRjb25zdCBjb250ZXh0ID0gYXdhaXQgYnJvd3Nlci5uZXdDb250ZXh0KHsgYmFzZVVSTDogQlJPV1NFUl9VUkwgfSlcblx0XHRjb25zdCBwYWdlID0gYXdhaXQgY29udGV4dC5uZXdQYWdlKClcblx0XHR0cnkge1xuXHRcdFx0YXdhaXQgbG9naW4ocGFnZSlcblx0XHRcdGF3YWl0IHBhZ2UuZ290byhgL2FwcHMvZGVsaXZlci9wcm9qZWN0cy8ke3Byb2plY3RJZH1gKVxuXHRcdFx0YXdhaXQgcGFnZS5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ1VwbG9hZCcsIGV4YWN0OiB0cnVlIH0pLmNsaWNrKClcblx0XHRcdGNvbnN0IHVwbG9hZHMgPSBwYWdlLmdldEJ5Um9sZSgnZGlhbG9nJywgeyBuYW1lOiAnVXBsb2FkcycgfSlcblx0XHRcdGF3YWl0IHVwbG9hZHMubG9jYXRvcignaW5wdXRbdHlwZT1maWxlXVttdWx0aXBsZV0nKS5zZXRJbnB1dEZpbGVzKHsgbmFtZTogJ21hc3Rlci5tb3YnLCBtaW1lVHlwZTogJ3ZpZGVvL3F1aWNrdGltZScsIGJ1ZmZlcjogcmVhZEZpbGVTeW5jKEROWEhSKSB9KVxuXHRcdFx0YXdhaXQgZXhwZWN0KHVwbG9hZHMubG9jYXRvcignLmRlbGl2ZXItdXBsb2Fkc19fc3RhdHVzLS1lcnJvcicpKS50b0NvbnRhaW5UZXh0KCdUaGlzIGZvcm1hdCBuZWVkcyBmZm1wZWcsIHdoaWNoIHRoaXMgTmV4dGNsb3VkIGxhY2tzLicpXG5cdFx0XHRhd2FpdCBleHBlY3QodXBsb2Fkcy5nZXRCeVRleHQoJ09wZW4nLCB7IGV4YWN0OiB0cnVlIH0pKS50b0hhdmVDb3VudCgwKVxuXG5cdFx0XHQvLyBXaGF0IHBsYXlzIGFzIGl0IGlzIGdvZXMgdXAgYXMgZXZlclxuXHRcdFx0YXdhaXQgdXBsb2Fkcy5sb2NhdG9yKCdpbnB1dFt0eXBlPWZpbGVdW211bHRpcGxlXScpLnNldElucHV0RmlsZXMoeyBuYW1lOiAnbWl4LndhdicsIG1pbWVUeXBlOiAnYXVkaW8vd2F2JywgYnVmZmVyOiByZWFkRmlsZVN5bmMoTUlYKSB9KVxuXHRcdFx0YXdhaXQgZXhwZWN0KHVwbG9hZHMuZ2V0QnlUZXh0KCdPcGVuJywgeyBleGFjdDogdHJ1ZSB9KSkudG9IYXZlQ291bnQoMSlcblx0XHRcdGF3YWl0IGV4cGVjdCh1cGxvYWRzLmxvY2F0b3IoJy5kZWxpdmVyLXVwbG9hZHNfX3N0YXR1cy0tZXJyb3InKSkudG9IYXZlQ291bnQoMSlcblx0XHR9IGZpbmFsbHkge1xuXHRcdFx0YXdhaXQgY29udGV4dC5jbG9zZSgpXG5cdFx0fVxuXHR9KVxuXG5cdHRlc3QoJ2EgY2FuY2VsIHdoaWxlIHRoZSBmaWxlIGlzIGNoZWNrZWQgbGVhdmVzIG5vdGhpbmcgYmVoaW5kJywgYXN5bmMgKHsgcGxheXdyaWdodCB9KSA9PiB7XG5cdFx0Y29uc3QgYnJvd3NlciA9IGF3YWl0IGNocm9taXVtLmNvbm5lY3RPdmVyQ0RQKENEUClcblx0XHRjb25zdCBjb250ZXh0ID0gYXdhaXQgYnJvd3Nlci5uZXdDb250ZXh0KHsgYmFzZVVSTDogQlJPV1NFUl9VUkwgfSlcblx0XHRjb25zdCBwYWdlID0gYXdhaXQgY29udGV4dC5uZXdQYWdlKClcblx0XHRjb25zdCBhcGkgPSBhd2FpdCBwbGF5d3JpZ2h0LnJlcXVlc3QubmV3Q29udGV4dCh7IGJhc2VVUkw6IFVSTCwgaHR0cENyZWRlbnRpYWxzOiBhdXRoLCBleHRyYUhUVFBIZWFkZXJzOiBvY3NIZWFkZXJzIH0pXG5cdFx0dHJ5IHtcblx0XHRcdGF3YWl0IGxvZ2luKHBhZ2UpXG5cdFx0XHRhd2FpdCBwYWdlLmdvdG8oYC9hcHBzL2RlbGl2ZXIvcHJvamVjdHMvJHtwcm9qZWN0SWR9YClcblx0XHRcdGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKCdidXR0b24nLCB7IG5hbWU6ICdVcGxvYWQnLCBleGFjdDogdHJ1ZSB9KS5jbGljaygpXG5cdFx0XHRjb25zdCB1cGxvYWRzID0gcGFnZS5nZXRCeVJvbGUoJ2RpYWxvZycsIHsgbmFtZTogJ1VwbG9hZHMnIH0pXG5cdFx0XHQvLyBNZWRpYWJ1bm55IGxvYWRzIGxhemlseSB3aGVuIHRoZSBjaGVjayBzdGFydHM7IGhvbGQgaXRzIGNodW5rcyBiYWNrIHNvIHRoZSBjYW5jZWwgY29tZXMgZmlyc3Rcblx0XHRcdGxldCByZWxlYXNlXG5cdFx0XHRjb25zdCBoZWxkID0gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcblx0XHRcdFx0cmVsZWFzZSA9IHJlc29sdmVcblx0XHRcdH0pXG5cdFx0XHRhd2FpdCBwYWdlLnJvdXRlKCcqKi8qLmNodW5rLm1qcyonLCBhc3luYyAocm91dGUpID0+IHtcblx0XHRcdFx0YXdhaXQgaGVsZFxuXHRcdFx0XHRhd2FpdCByb3V0ZS5jb250aW51ZSgpXG5cdFx0XHR9KVxuXHRcdFx0YXdhaXQgdXBsb2Fkcy5sb2NhdG9yKCdpbnB1dFt0eXBlPWZpbGVdW211bHRpcGxlXScpLnNldElucHV0RmlsZXMoeyBuYW1lOiAnY2FuY2VsbGVkLndhdicsIG1pbWVUeXBlOiAnYXVkaW8vd2F2JywgYnVmZmVyOiByZWFkRmlsZVN5bmMoTUlYKSB9KVxuXHRcdFx0YXdhaXQgdXBsb2Fkcy5nZXRCeVJvbGUoJ2J1dHRvbicsIHsgbmFtZTogJ0NhbmNlbCB0aGUgdXBsb2FkIG9mIGNhbmNlbGxlZC53YXYnIH0pLmNsaWNrKClcblx0XHRcdGF3YWl0IGV4cGVjdCh1cGxvYWRzLmdldEJ5VGV4dCgnY2FuY2VsbGVkLndhdicpKS50b0hhdmVDb3VudCgwKVxuXHRcdFx0cmVsZWFzZSgpXG5cdFx0XHQvLyBUaGUgbmV4dCB1cGxvYWQgb25seSBzdGFydHMgb25jZSB0aGUgY2FuY2VsbGVkIG9uZSBoYXMgbGV0IGdvLCBzbyB3aGVuIGl0IGlzIGRvbmUsIGEgc3RyYXkgb25lIHdvdWxkIGJlIHRvb1xuXHRcdFx0YXdhaXQgdXBsb2Fkcy5sb2NhdG9yKCdpbnB1dFt0eXBlPWZpbGVdW211bHRpcGxlXScpLnNldElucHV0RmlsZXMoeyBuYW1lOiAnYWZ0ZXItY2FuY2VsLndhdicsIG1pbWVUeXBlOiAnYXVkaW8vd2F2JywgYnVmZmVyOiByZWFkRmlsZVN5bmMoTUlYKSB9KVxuXHRcdFx0YXdhaXQgZXhwZWN0KHVwbG9hZHMuZ2V0QnlUZXh0KCdPcGVuJywgeyBleGFjdDogdHJ1ZSB9KSkudG9IYXZlQ291bnQoMSlcblx0XHRcdGNvbnN0IHByb2plY3QgPSBhd2FpdCAoYXdhaXQgYXBpLmdldChgL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS9wcm9qZWN0cy8ke3Byb2plY3RJZH0/Zm9ybWF0PWpzb25gKSkuanNvbigpXG5cdFx0XHRjb25zdCBuYW1lcyA9IHByb2plY3Qub2NzLmRhdGEuYXNzZXRzLm1hcCgoYXNzZXQpID0+IGFzc2V0LnZlcnNpb25zWzBdLm5hbWUpXG5cdFx0XHRleHBlY3QobmFtZXMpLnRvQ29udGFpbignYWZ0ZXItY2FuY2VsLndhdicpXG5cdFx0XHRleHBlY3QobmFtZXMpLm5vdC50b0NvbnRhaW4oJ2NhbmNlbGxlZC53YXYnKVxuXHRcdFx0YXdhaXQgZXhwZWN0KHVwbG9hZHMuZ2V0QnlUZXh0KCdjYW5jZWxsZWQud2F2JykpLnRvSGF2ZUNvdW50KDApXG5cdFx0fSBmaW5hbGx5IHtcblx0XHRcdGF3YWl0IGFwaS5kaXNwb3NlKClcblx0XHRcdGF3YWl0IGNvbnRleHQuY2xvc2UoKVxuXHRcdH1cblx0fSlcblxuXHR0ZXN0KCdhIE1lbWJlciB1cGxvYWRzIGEgUHJveHkgb2YgdGhlaXIgb3duIGZyb20gdGhlIEFzc2V0IGNhcmQgYW5kIHJlbW92ZXMgaXQgKEFEUiAwMDIwKScsIGFzeW5jICh7IHBsYXl3cmlnaHQgfSkgPT4ge1xuXHRcdGNvbnN0IGFwaSA9IGF3YWl0IHBsYXl3cmlnaHQucmVxdWVzdC5uZXdDb250ZXh0KHsgYmFzZVVSTDogVVJMLCBodHRwQ3JlZGVudGlhbHM6IGF1dGgsIGV4dHJhSFRUUEhlYWRlcnM6IG9jc0hlYWRlcnMgfSlcblx0XHRjb25zdCBkYXYgPSBgL3JlbW90ZS5waHAvZGF2L2ZpbGVzLyR7VVNFUn0vZGVsaXZlci1lMmUtJHtyYW5kb21CeXRlcyg0KS50b1N0cmluZygnaGV4Jyl9YFxuXHRcdGV4cGVjdCgoYXdhaXQgYXBpLmZldGNoKGRhdiwgeyBtZXRob2Q6ICdNS0NPTCcgfSkpLnN0YXR1cygpKS50b0JlKDIwMSlcblx0XHRjb25zdCBjcmVhdGVkID0gYXdhaXQgYXBpLnBvc3QoJy9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHM/Zm9ybWF0PWpzb24nLCB7IGRhdGE6IHsgZm9sZGVySWQ6IGF3YWl0IGZpbGVJZChhcGksIGRhdiksIGF1dG9JbnRha2U6IHRydWUgfSB9KVxuXHRcdGNvbnN0IGlkID0gKGF3YWl0IGNyZWF0ZWQuanNvbigpKS5vY3MuZGF0YS5pZFxuXHRcdGV4cGVjdCgoYXdhaXQgYXBpLmZldGNoKGAke2Rhdn0vbWFzdGVyLm1vdmAsIHsgbWV0aG9kOiAnUFVUJywgZGF0YTogcmVhZEZpbGVTeW5jKEROWEhSKSB9KSkuc3RhdHVzKCkpLnRvQmUoMjAxKVxuXHRcdC8vIFRoZSBwcm9iZSwgc28gdGhlIGNhcmQga25vd3MgdGhlIFZlcnNpb24gZ2V0cyBhIFByb3h5XG5cdFx0ZXhlY0ZpbGVTeW5jKCdkb2NrZXInLCBbJ2NvbXBvc2UnLCAnZXhlYycsICctVCcsICctdScsICd3d3ctZGF0YScsICduZXh0Y2xvdWQnLCAncGhwJywgJ29jYycsICdkZWxpdmVyOndvcmtlcicsICctLW9uY2UnXSwgeyBzdGRpbzogJ2luaGVyaXQnIH0pXG5cdFx0Y29uc3QgbmV3ZXN0ID0gYXN5bmMgKCkgPT4gKGF3YWl0IChhd2FpdCBhcGkuZ2V0KGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3Byb2plY3RzLyR7aWR9P2Zvcm1hdD1qc29uYCkpLmpzb24oKSkub2NzLmRhdGEuYXNzZXRzWzBdLnZlcnNpb25zWzBdXG5cdFx0Y29uc3QgYnJvd3NlciA9IGF3YWl0IGNocm9taXVtLmNvbm5lY3RPdmVyQ0RQKENEUClcblx0XHRjb25zdCBjb250ZXh0ID0gYXdhaXQgYnJvd3Nlci5uZXdDb250ZXh0KHsgYmFzZVVSTDogQlJPV1NFUl9VUkwgfSlcblx0XHRjb25zdCBwYWdlID0gYXdhaXQgY29udGV4dC5uZXdQYWdlKClcblx0XHR0cnkge1xuXHRcdFx0YXdhaXQgbG9naW4ocGFnZSlcblx0XHRcdGF3YWl0IHBhZ2UuZ290byhgL2FwcHMvZGVsaXZlci9wcm9qZWN0cy8ke2lkfWApXG5cdFx0XHRhd2FpdCBjYXJkKHBhZ2UsICdtYXN0ZXInKS5jbGljayh7IGJ1dHRvbjogJ3JpZ2h0JyB9KVxuXHRcdFx0Y29uc3QgY2hvb3NlciA9IHBhZ2Uud2FpdEZvckV2ZW50KCdmaWxlY2hvb3NlcicpXG5cdFx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnbWVudWl0ZW0nLCB7IG5hbWU6ICdVcGxvYWQgUHJveHnigKYnIH0pLmNsaWNrKClcblx0XHRcdGF3YWl0IChhd2FpdCBjaG9vc2VyKS5zZXRGaWxlcyh7IG5hbWU6ICdtYXN0ZXIucHJveHkubXA0JywgbWltZVR5cGU6ICd2aWRlby9tcDQnLCBidWZmZXI6IHJlYWRGaWxlU3luYyhIQU5EX1BST1hZKSB9KVxuXHRcdFx0YXdhaXQgZXhwZWN0LnBvbGwoYXN5bmMgKCkgPT4gKGF3YWl0IG5ld2VzdCgpKS5wcm94eUhhbmRlZEluKS50b0JlKHRydWUpXG5cdFx0XHQvLyBUaGUgY2FyZCBzaG93cyB0aGUgdXBsb2FkIHVudGlsIHRoZSBzZXJ2ZXIncyBhbnN3ZXIgaXMgaW4sIGFuZCBpdHMgbWVudSBmb2xsb3dzIG9uY2UgdGhlIFByb2plY3QgaXMgcmVhZCBhZ2FpblxuXHRcdFx0YXdhaXQgZXhwZWN0KGFzeW5jICgpID0+IHtcblx0XHRcdFx0YXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnRXNjYXBlJylcblx0XHRcdFx0YXdhaXQgY2FyZChwYWdlLCAnbWFzdGVyJykuY2xpY2soeyBidXR0b246ICdyaWdodCcgfSlcblx0XHRcdFx0YXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKCdtZW51aXRlbScsIHsgbmFtZTogJ1JlbW92ZSBQcm94eScgfSkpLnRvQmVWaXNpYmxlKHsgdGltZW91dDogMTAwMCB9KVxuXHRcdFx0fSkudG9QYXNzKClcblx0XHRcdC8vIFRoZSBicm93c2VyJ3MgcGFzcyBmcm9tIHRoZSBoYW5kIFByb3h5IGlzIG92ZXIgYnkgdGhlbjogd2hlcmUgaXQgZGVjb2RlcyBILjI2NCBpdCBtYWRlIHRoZSBzdHJpcCBmcm9tIGl0LFxuXHRcdFx0Ly8gd2hlcmUgaXQgZG9lcyBub3QgKENJJ3MgQ2hyb21pdW0pIHRoYXQgaXMgbm8gZXJyb3IsIGFzIHRoZSBQcm94eSBpcyBpbiAoIzE2OClcblx0XHRcdGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoJy5ub3RlY2FyZC0tZXJyb3InKSkudG9IYXZlQ291bnQoMClcblx0XHRcdGlmIChhd2FpdCBwYWdlLmV2YWx1YXRlKGFzeW5jICgpID0+IChhd2FpdCBWaWRlb0RlY29kZXIuaXNDb25maWdTdXBwb3J0ZWQoeyBjb2RlYzogJ2F2YzEuNDIwMDFlJyB9KSkuc3VwcG9ydGVkKSkge1xuXHRcdFx0XHRjb25zdCBzaG93biA9IGF3YWl0IChhd2FpdCBhcGkuZ2V0KGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3ZlcnNpb25zLyR7KGF3YWl0IG5ld2VzdCgpKS5pZH0/Zm9ybWF0PWpzb25gKSkuanNvbigpXG5cdFx0XHRcdGV4cGVjdChzaG93bi5vY3MuZGF0YS52ZXJzaW9uc1swXS5kZXJpdmVkLnRodW1icy5zdGF0ZSkudG9CZSgncmVhZHknKVxuXHRcdFx0fVxuXHRcdFx0Ly8gQW5vdGhlciBvbmUgb2YgdGhlaXIgb3duIHdvdWxkIHJlcGxhY2UgaXRcblx0XHRcdGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5Um9sZSgnbWVudWl0ZW0nLCB7IG5hbWU6ICdVcGxvYWQgUHJveHnigKYnIH0pKS50b0JlVmlzaWJsZSgpXG5cdFx0XHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnbWVudWl0ZW0nLCB7IG5hbWU6ICdSZW1vdmUgUHJveHknIH0pLmNsaWNrKClcblx0XHRcdGF3YWl0IGV4cGVjdC5wb2xsKGFzeW5jICgpID0+IChhd2FpdCBuZXdlc3QoKSkucHJveHlIYW5kZWRJbikudG9CZShmYWxzZSlcblx0XHRcdGF3YWl0IGNhcmQocGFnZSwgJ21hc3RlcicpLmNsaWNrKHsgYnV0dG9uOiAncmlnaHQnIH0pXG5cdFx0XHRhd2FpdCBleHBlY3QocGFnZS5nZXRCeVJvbGUoJ21lbnVpdGVtJywgeyBuYW1lOiAnVXBsb2FkIFByb3h54oCmJyB9KSkudG9CZVZpc2libGUoKVxuXHRcdFx0YXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKCdtZW51aXRlbScsIHsgbmFtZTogJ1JlbW92ZSBQcm94eScgfSkpLnRvSGF2ZUNvdW50KDApXG5cdFx0XHQvLyBPbmx5IHRoZSBtYXN0ZXIgYmVjYW1lIGFuIEFzc2V0OiB0aGUgdXBsb2FkIHdhcyBoaWRkZW4gYW5kIGlzIGdvbmVcblx0XHRcdGV4cGVjdCgoYXdhaXQgKGF3YWl0IGFwaS5nZXQoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHMvJHtpZH0/Zm9ybWF0PWpzb25gKSkuanNvbigpKS5vY3MuZGF0YS5hc3NldHMpLnRvSGF2ZUxlbmd0aCgxKVxuXHRcdH0gZmluYWxseSB7XG5cdFx0XHRhd2FpdCBjb250ZXh0LmNsb3NlKClcblx0XHRcdGF3YWl0IGFwaS5kZWxldGUoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHMvJHtpZH0/Zm9ybWF0PWpzb25gKVxuXHRcdFx0YXdhaXQgYXBpLmZldGNoKGRhdiwgeyBtZXRob2Q6ICdERUxFVEUnIH0pXG5cdFx0XHRhd2FpdCBhcGkuZGlzcG9zZSgpXG5cdFx0fVxuXHR9KVxuXHR0ZXN0KCdhIHZpZGVvIHRoYXQgbmVlZHMgbm8gUHJveHksIHVwbG9hZGVkIGluIHRoZSBGaWxlcyBhcHAgd2hlcmUgQXV0byBJbnRha2UgdGFrZXMgaXQsIGdldHMgaXRzIHN0cmlwIGZyb20gdGhpcyBicm93c2VyICgjMTY4KScsIGFzeW5jICh7IHBsYXl3cmlnaHQgfSkgPT4ge1xuXHRcdGNvbnN0IGFwaSA9IGF3YWl0IHBsYXl3cmlnaHQucmVxdWVzdC5uZXdDb250ZXh0KHsgYmFzZVVSTDogVVJMLCBodHRwQ3JlZGVudGlhbHM6IGF1dGgsIGV4dHJhSFRUUEhlYWRlcnM6IG9jc0hlYWRlcnMgfSlcblx0XHRjb25zdCBmb2xkZXIgPSBgZGVsaXZlci1lMmUtJHtyYW5kb21CeXRlcyg0KS50b1N0cmluZygnaGV4Jyl9YFxuXHRcdGNvbnN0IGRhdiA9IGAvcmVtb3RlLnBocC9kYXYvZmlsZXMvJHtVU0VSfS8ke2ZvbGRlcn1gXG5cdFx0ZXhwZWN0KChhd2FpdCBhcGkuZmV0Y2goZGF2LCB7IG1ldGhvZDogJ01LQ09MJyB9KSkuc3RhdHVzKCkpLnRvQmUoMjAxKVxuXHRcdGNvbnN0IGNyZWF0ZWQgPSBhd2FpdCBhcGkucG9zdCgnL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS9wcm9qZWN0cz9mb3JtYXQ9anNvbicsIHsgZGF0YTogeyBmb2xkZXJJZDogYXdhaXQgZmlsZUlkKGFwaSwgZGF2KSwgYXV0b0ludGFrZTogdHJ1ZSB9IH0pXG5cdFx0Y29uc3QgaWQgPSAoYXdhaXQgY3JlYXRlZC5qc29uKCkpLm9jcy5kYXRhLmlkXG5cdFx0Y29uc3QgYnJvd3NlciA9IGF3YWl0IGNocm9taXVtLmNvbm5lY3RPdmVyQ0RQKENEUClcblx0XHRjb25zdCBjb250ZXh0ID0gYXdhaXQgYnJvd3Nlci5uZXdDb250ZXh0KHsgYmFzZVVSTDogQlJPV1NFUl9VUkwgfSlcblx0XHRjb25zdCBwYWdlID0gYXdhaXQgY29udGV4dC5uZXdQYWdlKClcblx0XHRjb25zdCBkZXJpdmVkID0gYXN5bmMgKCkgPT4ge1xuXHRcdFx0Y29uc3QgdmVyc2lvbklkID0gKGF3YWl0IChhd2FpdCBhcGkuZ2V0KGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3Byb2plY3RzLyR7aWR9P2Zvcm1hdD1qc29uYCkpLmpzb24oKSkub2NzLmRhdGEuYXNzZXRzWzBdPy52ZXJzaW9uc1swXS5pZFxuXHRcdFx0cmV0dXJuIHZlcnNpb25JZCAmJiAoYXdhaXQgKGF3YWl0IGFwaS5nZXQoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvdmVyc2lvbnMvJHt2ZXJzaW9uSWR9P2Zvcm1hdD1qc29uYCkpLmpzb24oKSkub2NzLmRhdGEudmVyc2lvbnNbMF0uZGVyaXZlZFxuXHRcdH1cblx0XHR0cnkge1xuXHRcdFx0YXdhaXQgbG9naW4ocGFnZSlcblx0XHRcdGF3YWl0IHBhZ2UuZ290byhgL2FwcHMvZmlsZXMvZmlsZXM/ZGlyPS8ke2ZvbGRlcn1gKVxuXHRcdFx0YXdhaXQgcGFnZS5sb2NhdG9yKCdpbnB1dFt0eXBlPWZpbGVdJykuZmlyc3QoKS5zZXRJbnB1dEZpbGVzKHsgbmFtZTogJ2NsaXAud2VibScsIG1pbWVUeXBlOiAndmlkZW8vd2VibScsIGJ1ZmZlcjogcmVhZEZpbGVTeW5jKENMSVApIH0pXG5cdFx0XHQvLyBWUDkgcGxheXMgYXMgaXQgaXMsIHNvIG5vIFByb3h5OyB0aGUgcGFzcyBkZWNvZGVzIGl0IGFsbCB0aGUgc2FtZSwgYWxzbyB3aXRob3V0IGFuIEguMjY0IGVuY29kZXIgZm9yIHRoZSBTY3J1YiBQcm94eVxuXHRcdFx0YXdhaXQgZXhwZWN0LnBvbGwoYXN5bmMgKCkgPT4gKGF3YWl0IGRlcml2ZWQoKSk/LnRodW1icy5zdGF0ZSwgeyB0aW1lb3V0OiA2MF8wMDAgfSkudG9CZSgncmVhZHknKVxuXHRcdFx0ZXhwZWN0KChhd2FpdCBkZXJpdmVkKCkpLnByb3h5LnN0YXRlKS50b0JlKCdub25lJylcblx0XHR9IGZpbmFsbHkge1xuXHRcdFx0YXdhaXQgY29udGV4dC5jbG9zZSgpXG5cdFx0XHRhd2FpdCBhcGkuZGVsZXRlKGAvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3Byb2plY3RzLyR7aWR9P2Zvcm1hdD1qc29uYClcblx0XHRcdGF3YWl0IGFwaS5mZXRjaChkYXYsIHsgbWV0aG9kOiAnREVMRVRFJyB9KVxuXHRcdFx0YXdhaXQgYXBpLmRpc3Bvc2UoKVxuXHRcdH1cblx0fSlcblxuXHR0ZXN0KCd0aGUgQXNzZXQgY2FyZCBvZmZlcnMgdG8gbWFrZSBtaXNzaW5nIGRlcml2ZWQgbWVkaWEgaW4gdGhpcyBicm93c2VyIG9ubHkgd2hpbGUgc29tZXRoaW5nIGlzIG1pc3NpbmcsIGFuZCBuZXZlciB3aXRoIGZmbXBlZyAoIzE2OCknLCBhc3luYyAoeyBwbGF5d3JpZ2h0IH0pID0+IHtcblx0XHRjb25zdCBhcGkgPSBhd2FpdCBwbGF5d3JpZ2h0LnJlcXVlc3QubmV3Q29udGV4dCh7IGJhc2VVUkw6IFVSTCwgaHR0cENyZWRlbnRpYWxzOiBhdXRoLCBleHRyYUhUVFBIZWFkZXJzOiBvY3NIZWFkZXJzIH0pXG5cdFx0Y29uc3QgZGF2ID0gYC9yZW1vdGUucGhwL2Rhdi9maWxlcy8ke1VTRVJ9L2RlbGl2ZXItZTJlLSR7cmFuZG9tQnl0ZXMoNCkudG9TdHJpbmcoJ2hleCcpfWBcblx0XHRleHBlY3QoKGF3YWl0IGFwaS5mZXRjaChkYXYsIHsgbWV0aG9kOiAnTUtDT0wnIH0pKS5zdGF0dXMoKSkudG9CZSgyMDEpXG5cdFx0Y29uc3QgY3JlYXRlZCA9IGF3YWl0IGFwaS5wb3N0KCcvb2NzL3YyLnBocC9hcHBzL2RlbGl2ZXIvYXBpL3YxL3Byb2plY3RzP2Zvcm1hdD1qc29uJywgeyBkYXRhOiB7IGZvbGRlcklkOiBhd2FpdCBmaWxlSWQoYXBpLCBkYXYpLCBhdXRvSW50YWtlOiB0cnVlIH0gfSlcblx0XHRjb25zdCBpZCA9IChhd2FpdCBjcmVhdGVkLmpzb24oKSkub2NzLmRhdGEuaWRcblx0XHQvLyBGcm9tIGEgc3luYyBjbGllbnQ6IG5vIGJyb3dzZXIgbWFkZSBhbnl0aGluZyBvZiBpdFxuXHRcdGV4cGVjdCgoYXdhaXQgYXBpLmZldGNoKGAke2Rhdn0vY2xpcC53ZWJtYCwgeyBtZXRob2Q6ICdQVVQnLCBkYXRhOiByZWFkRmlsZVN5bmMoQ0xJUCkgfSkpLnN0YXR1cygpKS50b0JlKDIwMSlcblx0XHRleGVjRmlsZVN5bmMoJ2RvY2tlcicsIFsnY29tcG9zZScsICdleGVjJywgJy1UJywgJy11JywgJ3d3dy1kYXRhJywgJ25leHRjbG91ZCcsICdwaHAnLCAnb2NjJywgJ2RlbGl2ZXI6d29ya2VyJywgJy0tb25jZSddLCB7IHN0ZGlvOiAnaW5oZXJpdCcgfSlcblx0XHRjb25zdCBuZXdlc3QgPSBhc3luYyAoKSA9PiAoYXdhaXQgKGF3YWl0IGFwaS5nZXQoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHMvJHtpZH0/Zm9ybWF0PWpzb25gKSkuanNvbigpKS5vY3MuZGF0YS5hc3NldHNbMF0udmVyc2lvbnNbMF1cblx0XHRjb25zdCB7IGlkOiB2ZXJzaW9uSWQgfSA9IGF3YWl0IG5ld2VzdCgpXG5cdFx0Y29uc3QgYnJvd3NlciA9IGF3YWl0IGNocm9taXVtLmNvbm5lY3RPdmVyQ0RQKENEUClcblx0XHRjb25zdCBjb250ZXh0ID0gYXdhaXQgYnJvd3Nlci5uZXdDb250ZXh0KHsgYmFzZVVSTDogQlJPV1NFUl9VUkwgfSlcblx0XHRjb25zdCBwYWdlID0gYXdhaXQgY29udGV4dC5uZXdQYWdlKClcblx0XHRjb25zdCBhY3Rpb24gPSBwYWdlLmdldEJ5Um9sZSgnbWVudWl0ZW0nLCB7IG5hbWU6ICdNYWtlIG1pc3NpbmcgZGVyaXZlZCBtZWRpYSBpbiB0aGlzIGJyb3dzZXInIH0pXG5cdFx0Y29uc3QgbWVudSA9IGFzeW5jICgpID0+IHtcblx0XHRcdGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ0VzY2FwZScpXG5cdFx0XHRhd2FpdCBjYXJkKHBhZ2UsICdjbGlwJykuY2xpY2soeyBidXR0b246ICdyaWdodCcgfSlcblx0XHR9XG5cdFx0dHJ5IHtcblx0XHRcdGF3YWl0IGxvZ2luKHBhZ2UpXG5cdFx0XHRhd2FpdCBwYWdlLmdvdG8oYC9hcHBzL2RlbGl2ZXIvcHJvamVjdHMvJHtpZH1gKVxuXHRcdFx0Ly8gT2ZmZXJlZCBvbmNlIHRoaXMgYnJvd3NlciBoYXMgcmVhZCB0aGUgaGVhZGVyczogaXQgZGVjb2RlcyBWUDksIGV2ZW4gd2hlcmUgaXQgZW5jb2RlcyBubyBILjI2NCBmb3IgYSBTY3J1YiBQcm94eVxuXHRcdFx0YXdhaXQgZXhwZWN0KGFzeW5jICgpID0+IHtcblx0XHRcdFx0YXdhaXQgbWVudSgpXG5cdFx0XHRcdGF3YWl0IGV4cGVjdChhY3Rpb24pLnRvQmVWaXNpYmxlKHsgdGltZW91dDogMTAwMCB9KVxuXHRcdFx0fSkudG9QYXNzKClcblx0XHRcdGF3YWl0IGFjdGlvbi5jbGljaygpXG5cdFx0XHRhd2FpdCBleHBlY3QucG9sbChhc3luYyAoKSA9PiAoYXdhaXQgbmV3ZXN0KCkpLmRlcml2ZWRGcm9tQnJvd3NlciwgeyB0aW1lb3V0OiAzMF8wMDAgfSkubm90LnRvQ29udGFpbigndGh1bWJzJylcblx0XHRcdGNvbnN0IHNob3duID0gYXdhaXQgKGF3YWl0IGFwaS5nZXQoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvdmVyc2lvbnMvJHt2ZXJzaW9uSWR9P2Zvcm1hdD1qc29uYCkpLmpzb24oKVxuXHRcdFx0ZXhwZWN0KHNob3duLm9jcy5kYXRhLnZlcnNpb25zWzBdLmRlcml2ZWQudGh1bWJzLnN0YXRlKS50b0JlKCdyZWFkeScpXG5cblx0XHRcdC8vIEEgU2NydWIgUHJveHkgZnJvbSBlbHNld2hlcmUsIHdoZXJlIHRoaXMgYnJvd3NlciBjb3VsZCBub3QgbWFrZSBvbmU6IG5vdGhpbmcgaXMgbWlzc2luZyBhbnkgbW9yZVxuXHRcdFx0Y29uc3QgdXBsb2FkID0gYCR7ZGF2fS8uc2NydWItdXBsb2FkYFxuXHRcdFx0ZXhwZWN0KChhd2FpdCBhcGkuZmV0Y2godXBsb2FkLCB7IG1ldGhvZDogJ1BVVCcsIGRhdGE6IHJlYWRGaWxlU3luYyhDTElQX1NDUlVCKSB9KSkuc3RhdHVzKCkpLnRvQmUoMjAxKVxuXHRcdFx0Y29uc3QgZ2l2ZW4gPSBhd2FpdCBhcGkucG9zdChgL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS92ZXJzaW9ucy8ke3ZlcnNpb25JZH0vc2NydWI/Zm9ybWF0PWpzb25gLCB7IGRhdGE6IHsgZmlsZUlkOiBhd2FpdCBmaWxlSWQoYXBpLCB1cGxvYWQpIH0gfSlcblx0XHRcdGV4cGVjdChbMjAwLCA0MDldKS50b0NvbnRhaW4oZ2l2ZW4uc3RhdHVzKCkpXG5cdFx0XHRhd2FpdCBleHBlY3QucG9sbChhc3luYyAoKSA9PiAoYXdhaXQgbmV3ZXN0KCkpLmRlcml2ZWRGcm9tQnJvd3NlcikudG9FcXVhbChbXSlcblx0XHRcdGF3YWl0IHBhZ2UucmVsb2FkKClcblx0XHRcdGF3YWl0IG1lbnUoKVxuXHRcdFx0YXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKCdtZW51aXRlbScsIHsgbmFtZTogJ09wZW4nIH0pKS50b0JlVmlzaWJsZSgpXG5cdFx0XHRhd2FpdCBleHBlY3QoYWN0aW9uKS50b0hhdmVDb3VudCgwKVxuXG5cdFx0XHQvLyBXaXRoIGZmbXBlZyB0aGUgc2VydmVyIG1ha2VzIGl0IGFsbFxuXHRcdFx0ZXhwZWN0KChhd2FpdCBhcGkucG9zdChgL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS92ZXJzaW9ucy8ke3ZlcnNpb25JZH0vcmVnZW5lcmF0ZT9mb3JtYXQ9anNvbmApKS5vaygpKS50b0JlKHRydWUpXG5cdFx0XHRleHBlY3QoKGF3YWl0IGFkbWluLnB1dCgnL29jcy92Mi5waHAvYXBwcy9kZWxpdmVyL2FwaS92MS9hZG1pbi9zZXR0aW5ncz9mb3JtYXQ9anNvbicsIHsgZGF0YTogeyBmZm1wZWdQYXRoOiAnJywgZmZwcm9iZVBhdGg6ICcnIH0gfSkpLm9rKCkpLnRvQmUodHJ1ZSlcblx0XHRcdGF3YWl0IHBhZ2UucmVsb2FkKClcblx0XHRcdGF3YWl0IG1lbnUoKVxuXHRcdFx0YXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKCdtZW51aXRlbScsIHsgbmFtZTogJ09wZW4nIH0pKS50b0JlVmlzaWJsZSgpXG5cdFx0XHRhd2FpdCBleHBlY3QoYWN0aW9uKS50b0hhdmVDb3VudCgwKVxuXHRcdH0gZmluYWxseSB7XG5cdFx0XHRhd2FpdCBhZG1pbi5wdXQoJy9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvYWRtaW4vc2V0dGluZ3M/Zm9ybWF0PWpzb24nLCB7IGRhdGE6IHsgZmZtcGVnUGF0aDogJy9ub25leGlzdGVudC9mZm1wZWcnLCBmZnByb2JlUGF0aDogJy9ub25leGlzdGVudC9mZnByb2JlJyB9IH0pXG5cdFx0XHRhd2FpdCBjb250ZXh0LmNsb3NlKClcblx0XHRcdGF3YWl0IGFwaS5kZWxldGUoYC9vY3MvdjIucGhwL2FwcHMvZGVsaXZlci9hcGkvdjEvcHJvamVjdHMvJHtpZH0/Zm9ybWF0PWpzb25gKVxuXHRcdFx0YXdhaXQgYXBpLmZldGNoKGRhdiwgeyBtZXRob2Q6ICdERUxFVEUnIH0pXG5cdFx0XHRhd2FpdCBhcGkuZGlzcG9zZSgpXG5cdFx0fVxuXHR9KVxufSlcblxuLyoqXG4gKiBDcmVhdGVzIHRoZSB0ZXN0IHVzZXIsIG9yIHNldHMgYSBmcmVzaCBwYXNzd29yZCBvbiBpdCwgYW5kIGtlZXBzIGl0IGluIEVuZ2xpc2hcbiAqXG4gKiBAcGFyYW0ge2ltcG9ydCgnQHBsYXl3cmlnaHQvdGVzdCcpLlBsYXl3cmlnaHRXb3JrZXJBcmdzWydwbGF5d3JpZ2h0J119IHBsYXl3cmlnaHQgLSB0byB0YWxrIHRvIHRoZSBBUEkgYXMgYWRtaW5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gdGVzdFVzZXIocGxheXdyaWdodCkge1xuXHRjb25zdCBhZG1pbiA9IGF3YWl0IHBsYXl3cmlnaHQucmVxdWVzdC5uZXdDb250ZXh0KHtcblx0XHRiYXNlVVJMOiBVUkwsXG5cdFx0aHR0cENyZWRlbnRpYWxzOiB7IHVzZXJuYW1lOiBBRE1JTiwgcGFzc3dvcmQ6IEFETUlOX1BBU1NXT1JELCBzZW5kOiAnYWx3YXlzJyB9LFxuXHRcdGV4dHJhSFRUUEhlYWRlcnM6IG9jc0hlYWRlcnMsXG5cdH0pXG5cdGNvbnN0IHVzZXJzID0gJy9vY3MvdjIucGhwL2Nsb3VkL3VzZXJzJ1xuXHRjb25zdCBjcmVhdGVkID0gYXdhaXQgYWRtaW4ucG9zdChgJHt1c2Vyc30/Zm9ybWF0PWpzb25gLCB7IGZvcm06IHsgdXNlcmlkOiBVU0VSLCBwYXNzd29yZDogUEFTU1dPUkQgfSB9KVxuXHRpZiAoIWNyZWF0ZWQub2soKSkge1xuXHRcdGV4cGVjdCgoYXdhaXQgYWRtaW4ucHV0KGAke3VzZXJzfS8ke1VTRVJ9P2Zvcm1hdD1qc29uYCwgeyBmb3JtOiB7IGtleTogJ3Bhc3N3b3JkJywgdmFsdWU6IFBBU1NXT1JEIH0gfSkpLm9rKCkpLnRvQmUodHJ1ZSlcblx0fVxuXHRleHBlY3QoKGF3YWl0IGFkbWluLnB1dChgJHt1c2Vyc30vJHtVU0VSfT9mb3JtYXQ9anNvbmAsIHsgZm9ybTogeyBrZXk6ICdsYW5ndWFnZScsIHZhbHVlOiAnZW4nIH0gfSkpLm9rKCkpLnRvQmUodHJ1ZSlcblx0Ly8gVGhlIG1hdGUgbmV2ZXIgbG9ncyBpbiB0byB0aGUgYnJvd3NlciwgYnV0IG1ha2VzIGEgbGluayB0aHJvdWdoIHRoZSBBUElcblx0Y29uc3QgbWF0ZSA9IGF3YWl0IGFkbWluLnBvc3QoYCR7dXNlcnN9P2Zvcm1hdD1qc29uYCwgeyBmb3JtOiB7IHVzZXJpZDogTUFURSwgcGFzc3dvcmQ6IE1BVEVfUEFTU1dPUkQsIGRpc3BsYXlOYW1lOiAnTWFyYSBNYXRlJyB9IH0pXG5cdGlmICghbWF0ZS5vaygpKSB7XG5cdFx0ZXhwZWN0KChhd2FpdCBhZG1pbi5wdXQoYCR7dXNlcnN9LyR7TUFURX0/Zm9ybWF0PWpzb25gLCB7IGZvcm06IHsga2V5OiAncGFzc3dvcmQnLCB2YWx1ZTogTUFURV9QQVNTV09SRCB9IH0pKS5vaygpKS50b0JlKHRydWUpXG5cdH1cblx0YXdhaXQgYWRtaW4uZGlzcG9zZSgpXG59XG5cbi8qKlxuICogQHBhcmFtIHtpbXBvcnQoJ0BwbGF5d3JpZ2h0L3Rlc3QnKS5QYWdlfSBwYWdlIC0gdGhlIFByb2plY3Qgdmlld1xuICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBhbiBBc3NldCdzIG5hbWU7IFwiOCBzZWNvbmRzIGFnb1wiIGJlbG93IGl0IHdvdWxkIG1hdGNoIFwic2Vjb25kXCIgYnkgdGV4dCBhbG9uZVxuICogQHJldHVybiB7aW1wb3J0KCdAcGxheXdyaWdodC90ZXN0JykuTG9jYXRvcn0gaXRzIGNhcmRcbiAqL1xuZnVuY3Rpb24gY2FyZChwYWdlLCBuYW1lKSB7XG5cdHJldHVybiBwYWdlLmxvY2F0b3IoJy5kZWxpdmVyLWNhcmQnKS5maWx0ZXIoeyBoYXM6IHBhZ2UubG9jYXRvcignLmRlbGl2ZXItY2FyZF9fbmFtZScsIHsgaGFzVGV4dDogbmV3IFJlZ0V4cChgXlxcXFxzKiR7bmFtZX1cXFxccyokYCkgfSkgfSlcbn1cblxuLyoqXG4gKiBAcGFyYW0ge2ltcG9ydCgnQHBsYXl3cmlnaHQvdGVzdCcpLkFQSVJlcXVlc3RDb250ZXh0fSBhcGkgLSByZXF1ZXN0IGNvbnRleHRcbiAqIEBwYXJhbSB7c3RyaW5nfSBkYXYgLSBXZWJEQVYgcGF0aCBvZiB0aGUgZm9sZGVyXG4gKiBAcmV0dXJuIHtQcm9taXNlPG51bWJlcj59IHRoZSBOZXh0Y2xvdWQgZmlsZSBpZFxuICovXG5hc3luYyBmdW5jdGlvbiBmaWxlSWQoYXBpLCBkYXYpIHtcblx0Y29uc3QgcmVzcG9uc2UgPSBhd2FpdCBhcGkuZmV0Y2goZGF2LCB7XG5cdFx0bWV0aG9kOiAnUFJPUEZJTkQnLFxuXHRcdGhlYWRlcnM6IHsgRGVwdGg6ICcwJywgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi94bWwnIH0sXG5cdFx0ZGF0YTogJzw/eG1sIHZlcnNpb249XCIxLjBcIj8+PGQ6cHJvcGZpbmQgeG1sbnM6ZD1cIkRBVjpcIiB4bWxuczpvYz1cImh0dHA6Ly9vd25jbG91ZC5vcmcvbnNcIj48ZDpwcm9wPjxvYzpmaWxlaWQvPjwvZDpwcm9wPjwvZDpwcm9wZmluZD4nLFxuXHR9KVxuXHRyZXR1cm4gTnVtYmVyKC88b2M6ZmlsZWlkPihcXGQrKTxcXC9vYzpmaWxlaWQ+Ly5leGVjKGF3YWl0IHJlc3BvbnNlLnRleHQoKSlbMV0pXG59XG5cbi8qKlxuICogQHBhcmFtIHtpbXBvcnQoJ0BwbGF5d3JpZ2h0L3Rlc3QnKS5QYWdlfSBwYWdlIC0gdGhlIHBhZ2UgdG8gbG9nIGluXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGxvZ2luKHBhZ2UpIHtcblx0YXdhaXQgcGFnZS5nb3RvKCcvaW5kZXgucGhwL2xvZ2luJylcblx0YXdhaXQgcGFnZS5sb2NhdG9yKCcjdXNlcicpLmZpbGwoVVNFUilcblx0YXdhaXQgcGFnZS5sb2NhdG9yKCcjcGFzc3dvcmQnKS5maWxsKFBBU1NXT1JEKVxuXHRhd2FpdCBwYWdlLmdldEJ5Um9sZSgnYnV0dG9uJywgeyBuYW1lOiAnTG9nIGluJywgZXhhY3Q6IHRydWUgfSkuY2xpY2soKVxuXHRhd2FpdCBwYWdlLndhaXRGb3JVUkwoL2FwcHN8ZGFzaGJvYXJkLylcbn1cblxuLyoqXG4gKiBBIGNsaWNrIGluIHRoZSBzdHJpcCBhIHF1YXJ0ZXIgb2YgdGhlIHN0YWdlIG9uIHNlZWtzIHRoZXJlLCBhbmQgQyBjb21tZW50cyB3aGVyZSBpdCB3ZW50XG4gKiBvbmNlIHRoZSB3YXZlIGhhcyBnbGlkZWQ6IGEgY2xpY2sgbGFuZHMgb24gd2hhdCBpcyBkcmF3blxuICpcbiAqIEBwYXJhbSB7aW1wb3J0KCdAcGxheXdyaWdodC90ZXN0JykuUGFnZX0gcGFnZSAtIHRoZSBSZXZpZXcgdmlld1xuICogQHBhcmFtIHtpbXBvcnQoJ0BwbGF5d3JpZ2h0L3Rlc3QnKS5Mb2NhdG9yfSBjYW52YXMgLSB0aGUgV2F2ZWZvcm0ncyBjYW52YXNcbiAqIEBwYXJhbSB7e3Bvc2l0aW9uOiB7eDogbnVtYmVyLCB5OiBudW1iZXJ9fX0gcXVhcnRlck9uIC0gd2hlcmUgdG8gY2xpY2tcbiAqL1xuYXN5bmMgZnVuY3Rpb24gY29tbWVudE9uUXVhcnRlcihwYWdlLCBjYW52YXMsIHF1YXJ0ZXJPbikge1xuXHRhd2FpdCBleHBlY3QucG9sbCgoKSA9PiBjYW52YXMuZXZhbHVhdGUoKGVsZW1lbnQpID0+IE1hdGguYWJzKGVsZW1lbnQuZHJhd25BdCAtIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJ3ZpZGVvLmRlbGl2ZXItcGxheWVyX192aWRlbycpLmN1cnJlbnRUaW1lKSkpLnRvQmVMZXNzVGhhbigwLjAxKVxuXHRhd2FpdCBjYW52YXMuY2xpY2socXVhcnRlck9uKVxuXHRhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdjJylcbn1cbiJdLCJtYXBwaW5ncyI6IkFBQUEsU0FBU0EsUUFBUSxFQUFFQyxNQUFNLEVBQUVDLElBQUksUUFBUSxrQkFBa0I7QUFDekQsU0FBU0MsWUFBWSxRQUFRLG9CQUFvQjtBQUNqRCxTQUFTQyxXQUFXLFFBQVEsYUFBYTtBQUN6QyxTQUFTQyxZQUFZLFFBQVEsU0FBUztBQUN0QyxTQUFTQyxJQUFJLEVBQUVDLFVBQVUsRUFBRUMsS0FBSyxFQUFFQyxLQUFLLEVBQUVDLEtBQUssRUFBRUMsVUFBVSxFQUFFQyxJQUFJLEVBQUVDLFFBQVEsRUFBRUMsR0FBRyxFQUFFQyxLQUFLLEVBQUVDLEtBQUssUUFBUSxlQUFlO0FBRXBILE1BQU1DLEdBQUcsR0FBR0MsT0FBTyxDQUFDQyxHQUFHLENBQUNDLGdCQUFnQixJQUFJLHVCQUF1QjtBQUNuRSxNQUFNQyxLQUFLLEdBQUdILE9BQU8sQ0FBQ0MsR0FBRyxDQUFDRyxpQkFBaUIsSUFBSSxPQUFPO0FBQ3RELE1BQU1DLGNBQWMsR0FBR0wsT0FBTyxDQUFDQyxHQUFHLENBQUNLLHFCQUFxQixJQUFJLGVBQWU7QUFDM0U7QUFDQSxNQUFNQyxJQUFJLEdBQUcsYUFBYTtBQUMxQixNQUFNQyxRQUFRLEdBQUcsY0FBYyxHQUFHdEIsV0FBVyxDQUFDLEVBQUUsQ0FBQyxDQUFDdUIsUUFBUSxDQUFDLEtBQUssQ0FBQztBQUNqRTtBQUNBLE1BQU1DLElBQUksR0FBRyxrQkFBa0I7QUFD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