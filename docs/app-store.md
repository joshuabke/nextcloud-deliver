# App Store

How Deliver gets onto apps.nextcloud.com. Source: the [App Store developer docs](https://nextcloudappstore.readthedocs.io/en/latest/developer.html) and [code signing](https://docs.nextcloud.com/server/latest/developer_manual/app_publishing_maintenance/code_signing.html).

The store does not review code. The one human check is the certificate request (steps 1–2), which only ties the app id `deliver` to a key; it does not depend on the state of the app and can run while work goes on. After registration (step 3) every release is self-service.

The private key never enters the repo, an issue or a chat. Whoever holds it can publish Deliver. Keep a copy in a password manager: a lost key means a new certificate request, and the old certificate has to be revoked.

## 1. Key and certificate signing request

Once, on your own machine:

```bash
mkdir -p ~/.nextcloud/certificates
cd ~/.nextcloud/certificates
openssl req -nodes -newkey rsa:4096 -keyout deliver.key -out deliver.csr -subj "/CN=deliver"
chmod 600 deliver.key
```

The CN must be the app id.

## 2. Certificate request

1. Make an email address public on your GitHub profile (Settings → Public profile → Public email); the store team asks for it.
2. Fork [nextcloud/app-certificate-requests](https://github.com/nextcloud/app-certificate-requests) and add `deliver/deliver.csr` (the `.csr`, not the `.key`).
3. Open a PR titled `Add certificate request for app deliver`, for example with this body:

   > App: **Deliver** (id `deliver`) — frame-accurate video review inside Nextcloud Files.
   >
   > Source: https://github.com/joshuabke/nextcloud-deliver
   >
   > The CSR is generated with a 4096-bit RSA key, CN=deliver.

4. Wait. Recent requests took three to four days. The team commits `deliver/deliver.crt` to that repo and links the commit in the PR.
5. Save it as `~/.nextcloud/certificates/deliver.crt`, without trailing whitespace.

## 3. Register the app

Log in at apps.nextcloud.com (GitHub login works), open *Register app* and paste:

- **Certificate**: the contents of `deliver.crt`
- **Signature**: the output of

  ```bash
  echo -n "deliver" | openssl dgst -sha512 -sign ~/.nextcloud/certificates/deliver.key | openssl base64
  ```

The store then lists you as the owner of `deliver`. Nothing is public until the first release.

## 4. Secrets for the release workflow

Once, after registration, from the machine that holds the key:

```bash
gh secret set APP_PRIVATE_KEY -R joshuabke/nextcloud-deliver < ~/.nextcloud/certificates/deliver.key
gh secret set APPSTORE_TOKEN -R joshuabke/nextcloud-deliver   # paste the token from apps.nextcloud.com → Account → API token
```

The certificate needs no secret: the workflow fetches the public `deliver.crt` from nextcloud/app-certificate-requests.

## 5. A release

1. Set the version in `appinfo/info.xml` and `package.json`, and give it a section `## 1.2.3 – 2026-10-01` in `CHANGELOG.md` and `CHANGELOG.de.md`. The store shows that section (the German one on German instances) and matches it to the version in `info.xml`. Merge.
2. Tag the merge on `main` and push the tag:

   ```bash
   git tag v1.2.3 && git push origin v1.2.3
   ```

`.github/workflows/release.yml` takes it from there: it refuses a tag that disagrees with `info.xml` or the changelogs, runs `make package`, signs the code with `occ integrity:sign-app` from an unpacked Nextcloud 33 (no installed instance needed), creates the GitHub release with `deliver-1.2.3.tar.gz` and the changelog section as text, and posts the download URL and the tarball's signature to the store.

The code signature (`appinfo/signature.json`) covers every file, so nothing in the tarball may change after signing. The store requires signed apps, and a signed app has to stay signed.

A version with a pre-release part (`1.0.0-beta.1`) becomes a pre-release on GitHub and lands in the store's beta channel. Nextcloud offers such versions only to instances whose update channel is beta, daily or git (`AppFetcher` in the server), so a managed Nextcloud on the stable channel never sees them. The beta therefore ships as plain 0.9.x versions, marked as beta in the description and the changelog.

Once any instance has installed a store release, the database schema only moves forward through new migrations; the shipped migration is never rewritten again.
