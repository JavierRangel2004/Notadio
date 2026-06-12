# --- Stage 1: Build whisper-cli ---
FROM debian:bookworm-slim AS whisper-builder
RUN apt-get update && apt-get install -y git build-essential
WORKDIR /whisper
# Clone the stable tag of whisper.cpp
RUN git clone --depth 1 --branch v1.7.4 https://github.com/ggerganov/whisper.cpp.git .
# Build the main CLI (which outputs 'main' executable)
RUN make -j$(nproc) main

# --- Stage 2: Final API Runtime ---
FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y ffmpeg python3 python3-pip python3-venv && rm -rf /var/lib/apt/lists/*

# Copy whisper-cli and name it accordingly
COPY --from=whisper-builder /whisper/main /usr/local/bin/whisper-cli

WORKDIR /app

# Copy root monorepo files for dependency installation
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/

# Install dependencies
RUN npm install --omit=dev

# Copy backend source
COPY backend ./backend

# Build the backend TypeScript
RUN npm run build:backend

WORKDIR /app/backend
EXPOSE 8787

ENV PORT=8787
ENV NODE_ENV=production
ENV STORAGE_ROOT=/app/data
ENV FFMPEG_PATH=ffmpeg
ENV WHISPER_COMMAND=whisper-cli

# Command to start the backend
CMD ["node", "dist/index.js"]
