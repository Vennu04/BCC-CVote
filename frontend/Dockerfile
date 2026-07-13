FROM node:20-alpine AS builder

LABEL org.opencontainers.image.source="https://github.com/Vennu04/BCC-CVote"

WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
# Empty by default — sentry.js checks for this and no-ops if unset, so local/
# dev builds without the secret configured still build and run fine.
ARG VITE_SENTRY_DSN=""
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
RUN npm run build

# Production stage
FROM nginx:1.27-alpine

# The nginx:1.27-alpine tag doesn't always carry the latest Alpine security
# patches (openssl/libexpat/libpng CVEs caught by CI here) — apply whatever's
# available at build time rather than waiting on the upstream tag to refresh.
RUN apk update && apk upgrade --no-cache

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=10s \
    CMD curl -sf http://localhost/health.txt || exit 1

CMD ["nginx", "-g", "daemon off;"]
