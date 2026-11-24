docker rm -f deliver-b253-chrome >/dev/null 2>&1
docker run -d --name deliver-b253-chrome --network container:deliver-b253-nextcloud-1 --cpuset-cpus 0-3 --memory=3g --shm-size=1g chromedp/headless-shell@sha256:381353d3530ab9d579d2fe8b9c0f4519c995617f5a71daf6bb649e2d12005bd9 >/dev/null
docker exec -d deliver-b253-chrome socat TCP4-LISTEN:8353,fork TCP4:127.0.0.1:80
sleep 4
