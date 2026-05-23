FROM node:20-bookworm-slim
WORKDIR /app
RUN id -u agent >/dev/null 2>&1 || useradd -m agent
COPY package.json agent-loop.js ./
RUN npm install --omit=dev && chown -R agent:agent /app
USER agent
ENV NODE_ENV=production
ENTRYPOINT ["node", "agent-loop.js"]
