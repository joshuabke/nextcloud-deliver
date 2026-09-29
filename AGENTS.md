# Deliver — agent handover

Deliver is a Nextcloud app for frame-accurate video review (a Frame.io / Clapshot replacement). The repo is mid-**rewrite**: everything on `main` up to tag `legacy-0.1.6` is the 0.1.x prototype and is reference only, never a base to extend.

## Read first, in this order

1. `CONTEXT.md` — the glossary. Use its terms verbatim in code, UI strings, commits and issues.
2. `docs/adr/` — the decisions with lasting consequences (Files as source of truth, derived-media pipeline, review on Nextcloud Share Links; 0001 is superseded by 0004). Code that contradicts an accepted one is a bug.
3. `docs/spec-v2.md` — the full spec for milestone 0.2.0, also published as GitHub issue #2 (label `spec`). The issue is the tracked copy; the file is the canonical text. Keep them identical when either changes.

## Rewrite mechanics (settled, do not re-open)

- `main` carries v2 since it replaced the legacy code; work on short branches off `main` in a worktree, one small PR each.
- Stack: PHP 8.2+ Nextcloud app framework, minimum Nextcloud 33 (the web-component sidebar tab API of `@nextcloud/files` 4 needs it), Vue 3 + @nextcloud/vue 9 + Pinia + Vite via @nextcloud/vite-config. Pinned versions live in `package.json`; verify against the Nextcloud developer docs and the server's own `package.json` before bumping.
- Legacy code is gone on `main`; the old EDL writer is `git show legacy-0.1.6:lib/Service/EdlService.php`, for ideas only.
- Nothing is released yet: the version in `appinfo/info.xml` and `package.json` stays below 1.0.0 until the first release. App id stays `deliver`. Author Joshua Böke, repo `git@github.com:joshuabke/nextcloud-deliver.git`.
- No attribution lines of any kind in commits, PRs, issues or files.

## Dev environment

- Commands and the test setup are in `README.md` and the `Makefile` (`make up`, `make build`, `make test-integration`). The dev image is `deploy/Dockerfile` built for Nextcloud 34 (ffmpeg and the VAAPI drivers); change it there, never in the running container. `docker/` is the bind-mounted instance and gitignored.
- `dev/opcache.ini` is mounted into the container so PHP edits apply immediately. Built bundles are cached by the browser under Nextcloud's `?v=` parameter: hard-reload after `npm run build`.
- Nothing is released yet, so the code carries no backwards compatibility of any kind: no second input shape, no fallback for older data, no migration chain. The schema is one migration, changed in place until the first release. To apply a change on the dev instance, alter its tables by hand to match (or reset it: `make down`, delete `docker/`, `make up`); a fresh instance, as in CI, runs the migration as it stands.
- Routes are cached per PHP process: after editing `appinfo/routes.php`, `docker compose restart nextcloud`, otherwise new verbs answer 405 and new paths 404.
- File actions in `@nextcloud/files` 4 take **one context object** (`{ nodes, view, folder }`) in both `enabled` and `exec`; a `(nodes)` signature silently never shows the action. There is no `FileAction` class any more, `registerFileAction()` takes a plain object.
- Scripts for the public share page go through `Util::addInitScript`, not `addScript`: the file list reads the action registry while it renders.
- `make up` switches off the bruteforce protection, because the Share Link tests knock on invalid tokens on purpose; an instance that was throttled before keeps its records (`occ security:bruteforce:reset <ip>` while the protection is still on, or clear `oc_bruteforce_attempts`).
- The trash fires `MoveToTrashEvent` **and** `NodeDeletedEvent` for the same delete, and permanent deletion from the trash fires only a legacy `\OC_Hook`. So: the trash event marks the file id, the delete event skips what it marked, and a Missing Version whose file id no longer resolves is purged on the next read of its Project or by the hourly `ScanProjects` job.
- Nextcloud `Entity` setters skip values equal to the property default, so a non-null default never reaches the INSERT; keep entity defaults `null` for columns the code sets explicitly.
- The Files sidebar tab is a web component registered through `@nextcloud/files` (`src/sidebar.js`); the pre-33 `OCA.Files.Sidebar.Tab` API no longer exists.
- `group_add` in compose does not reach Apache's `www-data`, so the dev image adds `www-data` to the render group itself (`RENDER_GID`); a VAAPI test that passes under `occ` can still fail from the web server otherwise.
- A `DataResponse` from a plain (non-OCS) controller is rebuilt as JSON on the way out and loses its cookies; answer with a `JSONResponse` when a cookie has to reach the browser.
- `AuthPublicShareController::showShare()` must return a `TemplateResponse`, so a redirect from there is a `TemplateResponse` with status 303 and a `Location` header.
- Nextcloud's layouts style bare `header`, `footer`, `main` and `aside` elements (the guest page pins `footer` to the bottom of the window), and its global `button` style gives every button a minimum height and padding. Use `div`s with classes for layout, and reset `min-height`, `padding` and `margin` on small custom buttons such as timeline markers.
- Test seams are fixed by the spec: PHPUnit integration tests through the HTTP API inside the real Nextcloud container, plus Playwright against the same container. Vitest only for pure client logic, so keep that logic out of `.vue` files and out of the Pinia store (importing `src/api.js` pulls in `window`); `src/lib/` is where it belongs.
- No Chrome in this container: browser work attaches over CDP to `docker run -d --name deliver-chrome --shm-size=1g -p 127.0.0.1:9222:9222 chromedp/headless-shell` (without `--shm-size` pages die with `ERR_INSUFFICIENT_RESOURCES`). That browser reaches Nextcloud under the tailnet address, not `localhost` — hence `DELIVER_BROWSER_URL`. It has no H.264 decoder, so test media is WebM.
- Nextcloud's `?v=` cache buster does not change when you rebuild the bundle, so a browser that already loaded the app keeps the old one: restart the headless browser (or hard-reload) after `npm run build`.

## Working agreements

- Files is the source of truth: never copy, move or write media outside the Project folder except derived media in app data.
- Frames are the anchor; seconds are derived. Any code path that stores seconds is wrong.
- Every UI string goes through `t()`; German translation ships. Add the German to `l10n/de.json` (du) and `l10n/de_DE.json` (Sie) with the terms in `CONTEXT.md`, then `npm run l10n` writes the `.js` files; Vitest fails on any untranslated or stale string.
- Spec changes go to `docs/spec-v2.md` and issue #2 together; glossary changes go to `CONTEXT.md` in the same commit as the code that introduces the term.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
