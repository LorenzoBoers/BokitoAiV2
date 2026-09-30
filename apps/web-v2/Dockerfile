FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY apps/web-v2/package.json apps/web-v2/
RUN npm ci --workspace apps/web-v2 --include-workspace-root
COPY apps/web-v2 apps/web-v2
ARG VITE_APP_VERSION=dev
ENV VITE_APP_VERSION=$VITE_APP_VERSION
RUN npm run build --workspace apps/web-v2

FROM nginx:1.27-alpine
COPY apps/web-v2/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web-v2/dist /usr/share/nginx/html
EXPOSE 80
