FROM node:22.18.0-alpine3.22 AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

COPY apps/web apps/web
COPY packages/shared packages/shared
RUN npm run build --workspace @messaging-lab/shared \
  && npm run build --workspace @messaging-lab/web

FROM nginx:1.29.1-alpine3.22 AS runtime

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
