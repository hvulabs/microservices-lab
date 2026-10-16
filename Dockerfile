FROM node:22-alpine

WORKDIR /workspace
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile

ARG APP_NAME
ENV APP_NAME=${APP_NAME}
EXPOSE 3000 3001 3002 3003 3004 3005 5173
CMD ["sh", "-c", "if [ \"$APP_NAME\" = web ]; then pnpm --filter @lab/web dev --host 0.0.0.0; else pnpm exec nest start \"$APP_NAME\"; fi"]
