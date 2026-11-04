FROM node:22-bookworm-slim

ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node docs ./docs
USER node

EXPOSE 8080
CMD ["npm", "start"]
