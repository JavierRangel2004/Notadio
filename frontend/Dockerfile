# --- Stage 1: Build Frontend ---
FROM node:20-bookworm-slim AS builder
WORKDIR /app

COPY package*.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/

RUN npm install

COPY frontend ./frontend

ARG VITE_API_BASE=http://localhost:8787/api
ENV VITE_API_BASE=$VITE_API_BASE

RUN npm run build:frontend

# --- Stage 2: Serve with Nginx ---
FROM nginx:alpine
COPY --from=builder /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
