# Developing Deliver

The vocabulary is in [CONTEXT.md](../CONTEXT.md), the decisions in [adr/](adr/), the spec in [spec-v2.md](spec-v2.md), the agent handover in [AGENTS.md](../AGENTS.md).

## Dev instance

Everything runs in Docker; no local PHP is needed. Node 22 builds the frontend.

The dev image is `deploy/Dockerfile` built for Nextcloud 34: ffmpeg, the Team folders app (groupfolders, release 22.x, downloaded from GitHub at build time, so `make up` needs no app store; the image ships it disabled and `make up` enables it) and the VAAPI drivers, with `/dev/dri` passed in, so the hardware encoder of ADR 0003 can be tried on real hardware (`vainfo --display drm --device /dev/dri/renderD128`). A machine without `/dev/dri` (macOS, or Linux without an iGPU) fails `make up` with `error gathering device information`; drop the device in the gitignored `docker-compose.override.yml`, as CI does:

```yaml
services:
  nextcloud:
    devices: !reset []
```

The deploy example builds the same Dockerfile without `GROUPFOLDERS_VERSION` (its default is empty and nothing is downloaded), so it carries no groupfolders; only `docker-compose.yml` passes the version for the dev image. Raise `GROUPFOLDERS_VERSION` there together with `NEXTCLOUD_VERSION` (the release for a major is named in the app's `info.xml`, `min-version`). A dev instance installed before this keeps the store copy in `custom_apps`; `make up` enables it all the same.

```sh
make up               # Nextcloud 34 + ffmpeg + Postgres + Team folders on http://localhost:8080 (admin / adminadmin123), enables the app
make build            # npm ci && vite build → js/
npm run watch         # rebuild on change
make test-integration # PHPUnit over the HTTP API, run inside the Nextcloud container
npm run test:unit     # vitest, pure client logic only
npm run test:e2e      # playwright against the dev instance
npm run lint          # eslint
make lint-php         # PHP coding standard and Psalm; make fix-php applies the standard
make occ ARGS="deliver:worker --once"  # any occ command inside the dev container
make down
```

CI (`.github/workflows/ci.yml`) runs the same checks on every pull request, then starts the dev instance with `.github/compose.ci.yml` (no GPU, bound to localhost only) for the integration and browser tests.

`docker/` holds the instance data and is gitignored. Every mail the instance sends lands in a Mailpit container instead of going out; its inbox is on port 8025, bound like Nextcloud. `dev/opcache.ini` makes the container pick up PHP edits immediately.

The instance carries a known admin password and Nextcloud's trusted-domain check falls to a forged `Host` header, so the port is bound to `127.0.0.1` instead of being published to the whole network. Another address (a LAN or VPN address of the machine, say) goes into a gitignored `docker-compose.override.yml`, which Compose merges on its own — and then it is reachable by whoever can route there:

```yaml
services:
  nextcloud:
    ports: ["192.0.2.10:8080:80"]
  mail:
    ports: ["192.0.2.10:8025:8025"]
```

Links in mails and from background jobs use `DELIVER_URL` (default `http://localhost:8080`); set it in `.env` to the address people open, e.g. `DELIVER_URL=http://dev.example.test:8080`, and `docker compose up -d`.

To reach the dev instance under another host name or address, put it into a gitignored `.env` next to `docker-compose.yml` before the first `make up` (space-separated, e.g. `DELIVER_EXTRA_TRUSTED_DOMAINS=192.168.1.20 dev.example.test`). Nextcloud reads trusted domains only at install time; on an existing instance use `make occ ARGS="config:system:set trusted_domains 2 --value=192.168.1.20"` instead.

## Tests

`tests/Integration` is PHPUnit talking to the running dev instance over WebDAV and the OCS API, as a person or client would. `make test-integration` installs PHPUnit into `vendor/` through the Composer Docker image and runs it inside the Nextcloud container, where the instance is reachable as `http://localhost`. Override the target with the `DELIVER_TEST_URL`, `DELIVER_TEST_USER` and `DELIVER_TEST_PASSWORD` environment variables in `phpunit.xml`.

`tests/e2e` drives a real browser through the same instance with Playwright. Without a Chrome on the machine, run one in Docker and let the tests attach to it over CDP:

```sh
docker run -d --name deliver-chrome --shm-size=1g -p 127.0.0.1:9222:9222 chromedp/headless-shell
DELIVER_BROWSER_URL=http://<address the container can reach>:8080 npm run test:e2e
```

`DELIVER_CDP` points at the browser (default `http://127.0.0.1:9222`), `DELIVER_BROWSER_URL` at Nextcloud **as the browser sees it** — inside a container that is not `localhost`. The tests' own API calls go to `DELIVER_TEST_URL` (default `http://localhost:8080`), so an instance on another port needs that one too. The media fixtures are generated on first run by the ffmpeg of the dev container into the gitignored `tests/e2e/media/`; they are WebM because open-source Chromium builds carry no H.264 decoder.

`npm run test:unit` is vitest on pure client logic only (timecode math, the keyboard map, the polling merge, the filename convention). Component rendering is covered by the browser tests instead; `vitest.config.js` keeps it to `src/`.

PHPUnit has two tiers: `tests/Unit` for pure PHP (filename convention, timecode, export writers, pipeline arithmetic) and `tests/Integration` for everything that needs a running Nextcloud. `make test-integration` runs both; `--testsuite Unit` runs the fast one alone. `make test-integration SHARD=2/3` runs one of three shards of the integration tests (`dev/shard.php`); CI runs the three side by side, each against its own instance, and the browser tests in a fourth job, so that it takes about a third as long.

## Packaging and releases

`make package` builds the frontend and writes `build/deliver.tar.gz`: one folder named after the app id, carrying `appinfo`, `lib`, `templates`, `img`, `js`, `l10n`, the licence, the changelogs and the README — and nothing of the workshop around it. Source maps are dropped. `make appinfo` validates `appinfo/info.xml` against the App Store schema (`dev/info.xsd`).

The built `js/` is gitignored, so a release is always `make package`, never `git archive`.

A release:

1. Set the version in `appinfo/info.xml` and `package.json`, and turn the `## Unreleased` section of `CHANGELOG.md` (`## Unveröffentlicht` in `CHANGELOG.de.md`) into `## 1.2.3 – 2026-10-01`. The store shows that section (the German one on German instances) and matches it to the version in `info.xml`. Merge.
2. Tag the merge on `main` and push the tag:

   ```bash
   git tag v1.2.3 && git push origin v1.2.3
   ```

`.github/workflows/release.yml` takes it from there: it refuses a tag that disagrees with `info.xml` or the changelogs, runs `make package`, signs the code with `occ integrity:sign-app` from an unpacked Nextcloud 33 (no installed instance needed), creates the GitHub release with `deliver-1.2.3.tar.gz` and the changelog section as text, and posts the download URL and the tarball's signature to the store. It needs the repository secrets `APP_PRIVATE_KEY` (the app's signing key) and `APPSTORE_TOKEN`; the certificate is the public `deliver.crt` from nextcloud/app-certificate-requests. The build runs in a job of its own, without secrets and without the npm dependencies' install scripts (`make build` leaves them out everywhere), and hands the built app to the job that signs and publishes it, so no dependency ever runs next to the key. Actions in both workflows are pinned to commits; bump them with the release named in the comment.

The code signature (`appinfo/signature.json`) covers every file, so nothing in the tarball may change after signing. The store requires signed apps, and a signed app has to stay signed.

A version with a pre-release part (`1.0.0-beta.1`) becomes a pre-release on GitHub and lands in the store's beta channel. Nextcloud offers such versions only to instances whose update channel is beta, daily or git (`AppFetcher` in the server), so a managed Nextcloud on the stable channel never sees them. Pre-releases therefore ship as plain 0.x versions (from 0.8.0 on), marked as pre-release in the description and the changelog.

Once any instance has installed a store release, the database schema only moves forward through new migrations; the shipped migration is never rewritten again.

`node dev/screenshots.mjs` takes the App Store screenshots in `docs/screenshots/` again after UI changes; its header says what it needs.

