# Build context is the repo root (see docker-compose.yml) — the web app
# imports the agent code from ../src via Next's externalDir, so both
# package trees must be present in the image.
FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci

COPY tsconfig.json ./
COPY src ./src
COPY web ./web

ENV NEXT_TELEMETRY_DISABLED=1
RUN cd web && npm run build

# Root devDependencies stay in the image on purpose: @ai-sdk/anthropic is a
# devDependency but is resolved at runtime by the dynamic provider import.
ENV NODE_ENV=production
EXPOSE 3000
WORKDIR /app/web
CMD ["npm", "start"]
