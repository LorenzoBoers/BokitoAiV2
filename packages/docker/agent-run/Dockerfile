FROM node:20-bookworm-slim
WORKDIR /app
RUN useradd -u 1000 -m agent
COPY package.json agent-loop.js ./
RUN npm install --omit=dev && chown -R agent:agent /app
USER agent
ENV NODE_ENV=production
ENTRYPOINT ["node", "agent-loop.js"]
