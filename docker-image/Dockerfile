# The stock Nextcloud image carries no ffmpeg, and without it there are no
# Proxies, Thumbnail Strips or Waveforms (ADR 0003) and no video previews.
# va-driver-all brings the VAAPI drivers, so the host's iGPU can do the
# encoding when /dev/dri is passed in.
FROM nextcloud:34

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		ffmpeg \
		va-driver-all \
		vainfo \
	&& rm -rf /var/lib/apt/lists/*

# /dev/dri/renderD128 belongs to the host's render group. `group_add` in
# compose only reaches the container's first process; Apache drops to
# www-data and loses it, so www-data joins a group with the host's id here.
ARG RENDER_GID=992
RUN getent group "$RENDER_GID" >/dev/null || groupadd --gid "$RENDER_GID" hostrender \
	&& usermod --append --groups "$(getent group "$RENDER_GID" | cut -d: -f1)" www-data
