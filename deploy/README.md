# Deploying Nextcloud with Deliver

A Compose example for a server of your own: Nextcloud with ffmpeg and the
VAAPI drivers, Postgres, Redis, a cron container for background jobs and an
optional worker for derived media. It is a starting point, not a hardened
setup: TLS, backups and updates are yours.

## Start

```sh
cp .env.example .env        # fill in domain and passwords
mkdir -p data && sudo chown 33:33 data   # www-data in the image
docker compose up -d --build
```

Nextcloud listens on `127.0.0.1:8080`; point your reverse proxy there.
When the instance runs, let cron do the background jobs:

```sh
docker compose exec -u www-data app php occ background:cron
```

## Install Deliver

From a release archive (`make package` in the repository builds one):

```sh
tar -xzf deliver.tar.gz
docker compose cp deliver app:/var/www/html/custom_apps/
docker compose exec app chown -R www-data:www-data /var/www/html/custom_apps/deliver
docker compose exec -u www-data app php occ app:enable deliver
```

Then check *Administration → Deliver*: it shows the ffmpeg it found and the
queue.

## Derived media

Deliver makes Proxies, Thumbnail Strips and Waveforms in Nextcloud's
background jobs, so ffmpeg runs in the **cron** container, not only in the web
server. That is why every Nextcloud container here gets `/dev/dri`.

- **Hardware encoding:** set `RENDER_GID` in `.env` to the group of
  `/dev/dri/renderD128` on the host, rebuild, and pick VAAPI under
  *Administration → Deliver*. Saving runs a test encode; if it fails, Proxies
  are encoded in software. On a host without a GPU, delete the `devices`
  lines in `compose.yml`.
- **Throughput:** cron takes jobs every five minutes. For a queue that moves as
  soon as a file arrives, start the worker as well:
  `docker compose --profile worker up -d`. The admin setting for concurrent
  jobs caps cron and worker together.
