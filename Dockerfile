# Single-container deployment: facilitator (:4022) + proxy/rail (:4021).
FROM node:22-alpine

WORKDIR /app
RUN apk add --no-cache dumb-init wget

COPY package.json package-lock.json* ./
RUN npm install --omit=dev || npm install

COPY tsconfig.json ./
COPY src ./src
COPY web ./web

RUN mkdir -p data
EXPOSE 4021

ENV NODE_ENV=production
ENTRYPOINT ["dumb-init", "--"]

# Start the facilitator, wait until it answers, then start the proxy — the
# proxy resolves token metadata against the facilitator's network at boot.
CMD ["sh", "-c", "npx tsx src/facilitator/index.ts 2>&1 & i=0; until wget -qO- http://127.0.0.1:4022/health >/dev/null 2>&1; do i=$((i+1)); [ $i -ge 60 ] && echo 'facilitator never came up' && exit 1; sleep 1; done; npx tsx src/proxy/index.ts"]
