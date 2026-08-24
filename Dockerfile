FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY src ./src

ENV NODE_ENV=production

CMD ["npm", "start"]
