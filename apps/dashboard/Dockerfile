# Multi-stage build: compile the dashboard (and webchat widget) static bundles,
# then serve them with Caddy which also reverse-proxies /api to the FastAPI API.
# Build context MUST be the repo root (npm workspaces): the compose web service
# sets `context: .` and `dockerfile: apps/dashboard/Dockerfile`.

FROM node:20-alpine AS build
WORKDIR /app

# Install workspace deps with a cache-friendly layer (package manifests only).
COPY package.json package-lock.json ./
COPY apps/dashboard/package.json apps/dashboard/
COPY apps/chat-widget/package.json apps/chat-widget/
COPY apps/mobile/package.json apps/mobile/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY . .

# Build the webchat widget first so Caddy can serve /chat-widget/*.
RUN npm run build -w bokito-chat-widget

# Build the dashboard SPA. VITE_* values are baked in at build time.
ARG VITE_APP_VERSION=mvp
ARG VITE_APP_CONTROL_PLANE_HOST=app.bokito.ai
ARG VITE_TENANT_ROOT_DOMAIN=.bokito.ai
ARG VITE_APP_CONTROL_PLANE_URL=
ARG VITE_PLATFORM_DEFAULT_LANGUAGE=nl
ENV VITE_APP_VERSION=$VITE_APP_VERSION
ENV VITE_APP_CONTROL_PLANE_HOST=$VITE_APP_CONTROL_PLANE_HOST
ENV VITE_TENANT_ROOT_DOMAIN=$VITE_TENANT_ROOT_DOMAIN
ENV VITE_APP_CONTROL_PLANE_URL=$VITE_APP_CONTROL_PLANE_URL
ENV VITE_PLATFORM_DEFAULT_LANGUAGE=$VITE_PLATFORM_DEFAULT_LANGUAGE
RUN npm run build:static -w bokito-dashboard

FROM caddy:2-alpine
COPY --from=build /app/apps/dashboard/dist /srv
COPY --from=build /app/apps/chat-widget/dist /srv/chat-widget
COPY Caddyfile /etc/caddy/Caddyfile
