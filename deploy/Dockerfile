# Nextcloud with what Deliver's derived media needs: ffmpeg for Proxies,
# Thumbnail Strips and Waveforms, and the VAAPI drivers for an Intel or AMD
# GPU. Without ffmpeg Deliver still works; it just makes no derived media.
ARG NEXTCLOUD_VERSION=33
FROM nextcloud:${NEXTCLOUD_VERSION}-apache

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ffmpeg va-driver-all vainfo \
	&& rm -rf /var/lib/apt/lists/*

# Team folders (groupfolders) for the tests of a Project in a group folder. It
# goes into /usr/src/nextcloud/apps, which the entrypoint copies into the
# instance on install, so no app store is needed; it ships disabled
# (`occ app:enable groupfolders`). A release fits one Nextcloud major only:
# 21.x for 33, 22.x for 34 (the dev compose passes it along with the version).
ARG GROUPFOLDERS_VERSION=21.0.15
RUN curl -fsSL "https://github.com/nextcloud-releases/groupfolders/releases/download/v${GROUPFOLDERS_VERSION}/groupfolders-v${GROUPFOLDERS_VERSION}.tar.gz" \
	| tar -xz -C /usr/src/nextcloud/apps

# The group that owns /dev/dri/renderD128 on the host (`stat -c %g /dev/dri/renderD128`).
# Apache and cron drop to www-data, which loses groups added by compose,
# so www-data joins a group with the host's id here.
ARG RENDER_GID=992
RUN getent group "$RENDER_GID" >/dev/null || groupadd --gid "$RENDER_GID" hostrender \
	&& usermod --append --groups "$(getent group "$RENDER_GID" | cut -d: -f1)" www-data
