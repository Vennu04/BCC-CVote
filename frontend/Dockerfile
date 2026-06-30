FROM node:20-alpine AS builder

LABEL org.opencontainers.image.source="https://github.com/Vennu04/BCC-CVote"

WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# Production stage
FROM nginx:1.27-alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=10s \
    CMD curl -sf http://localhost/health.txt || exit 1

CMD ["nginx", "-g", "daemon off;"]
