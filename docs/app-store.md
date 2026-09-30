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

## 4. A release

The planned release workflow does this; by hand it is:

1. `make package` builds `build/deliver/` and `build/deliver.tar.gz`.
2. Sign the code before packing: run `occ integrity:sign-app --privateKey=… --certificate=… --path=…/build/deliver` against `build/deliver`, then pack the tarball again. The signature (`appinfo/signature.json`) covers every file, so nothing may change after signing. The store requires signed apps, and a signed app has to stay signed.
3. Attach the tarball to a GitHub release (the download URL must be HTTPS).
4. Sign the tarball:

   ```bash
   openssl dgst -sha512 -sign ~/.nextcloud/certificates/deliver.key build/deliver.tar.gz | openssl base64
   ```

5. Enter the download URL and the signature under *Upload app release* in the store, or `POST` them to the store API with the token from your store account.

The version comes from `appinfo/info.xml`. Versions with a pre-release part (`1.0.0-beta.1`) land in the beta channel, which only instances set to beta see.

Once any instance has installed a store release, the database schema only moves forward through new migrations; the shipped migration is never rewritten again.
