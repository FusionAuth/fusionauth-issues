# Sandbox where model-written commands run. It has NO GitHub credentials, and by default
# no internet route either (see the `internal` network in docker-compose.yml), so everything
# it needs is baked in here: curl/jq, Python + Node FusionAuth client libraries, and headless Chromium.
FROM node:22-bookworm-slim

ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
    NODE_PATH=/opt/tools/node_modules

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl jq python3 python3-pip ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# TODO: pin @fusionauth/typescript-client and the pip packages to exact versions per your supply-chain policy.
RUN mkdir -p /opt/tools /work \
 && cd /opt/tools && npm init -y >/dev/null \
 && npm install playwright@1.49.1 @fusionauth/typescript-client \
 && npx playwright install --with-deps chromium \
 && pip3 install --break-system-packages fusionauth-client requests \
 && chmod -R a+rX /opt/tools /opt/pw-browsers \
 && chown node:node /work \
 && rm -rf /var/lib/apt/lists/*

USER node
WORKDIR /work
