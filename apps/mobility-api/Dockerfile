# mobility-api — imagem de produção (migrações + Nest)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

EXPOSE 3000
# Migrações pendentes rodam antes de subir o servidor (idempotente).
CMD ["sh", "-c", "npm run migration:run:prod && node dist/src/main.js"]
