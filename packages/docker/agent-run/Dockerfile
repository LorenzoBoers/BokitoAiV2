FROM node:20-bookworm-slim
WORKDIR /app
RUN useradd -u 1000 -m agent && chown -R agent:agent /app
COPY package.json agent-loop.js ./
USER agent
ENV NODE_ENV=production
ENTRYPOINT ["node", "agent-loop.js"]
