FROM node:22-alpine
WORKDIR /app
COPY api/package.json ./
RUN npm install --omit=dev
COPY api/src ./src
COPY db/migrations ./migrations
EXPOSE 3333
CMD ["node","src/server.js"]
