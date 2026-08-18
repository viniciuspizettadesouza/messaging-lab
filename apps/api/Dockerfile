FROM node:22.18.0-alpine3.22 AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

COPY apps/api apps/api
COPY packages/shared packages/shared
RUN npm run build --workspace @messaging-lab/shared \
  && npm run build --workspace @messaging-lab/api \
  && npm prune --omit=dev

FROM node:22.18.0-alpine3.22 AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist

RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 3000

CMD ["node", "apps/api/dist/index.js"]
