FROM node:20-bookworm-slim

WORKDIR /app

ENV PORT=4000

COPY package.json package-lock.json ./
# Include devDeps (tsx, prisma CLI) for staging migrate + runtime
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

RUN mkdir -p /app/storage/documents
ENV DOCUMENT_STORAGE_ROOT=/app/storage/documents \
    NODE_ENV=production

EXPOSE 4000

CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx src/server.ts"]
