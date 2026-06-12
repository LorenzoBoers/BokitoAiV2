# Multi-stage build: compile the dashboard (and webchat widget) static bundles,
# then serve them with Caddy which also reverse-proxies /api to the FastAPI API.
# Build context MUST be the repo root (npm workspaces): the compose web service
# sets `context: .` and `dockerfile: apps/dashboard/Dockerfile`.

FROM node:20-alpine AS build
WORKDIR /app

# Install the whole workspace from the lockfile (mirrors CI).
COPY package.json package-lock.json ./
COPY . .
RUN npm ci

# Build the webchat widget first so Caddy can serve /chat-widget/*.
RUN npm run build -w bokito-chat-widget

# Build the dashboard SPA. VITE_* values are baked in at build time.
ARG VITE_APP_VERSION=mvp
ENV VITE_APP_VERSION=$VITE_APP_VERSION
RUN npm run build:static -w bokito-dashboard

FROM caddy:2-alpine
COPY --from=build /app/apps/dashboard/dist /srv
COPY --from=build /app/apps/chat-widget/dist /srv/chat-widget
COPY Caddyfile /etc/caddy/Caddyfile
