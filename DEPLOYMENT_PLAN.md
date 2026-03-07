# Notadio Deployment Plan (Fastest to Online + Server-Hosted Backend)

This guide is written for near-term implementation with minimal guesswork.

It contains two paths:

1. **Path A (fastest):** Netlify frontend + tunnel to backend running on your PC.
2. **Path B (recommended for stability):** Netlify frontend + backend hosted on a Linux server/VPS.

---

## 0) Current App Constraints (Important)

Notadio backend is not a typical lightweight API. It runs local binaries and local model files:

- `ffmpeg`
- `whisper-cli` (`whisper.cpp`)
- Whisper `.bin` model file(s)
- local `data/` storage for uploads, job state, and artifacts

Because of that, pure serverless functions are not the right fit for transcription jobs.

---

## 1) Quick Decision Matrix

- Choose **Path A** if you need it online today with the least effort.
- Choose **Path B** if you want it online even when your PC is off.

---

## 2) Path A - Ultra-Fast Online Launch (Netlify + Tunnel)

### 2.1 Architecture

- Frontend: Netlify
- Backend: your local machine (`localhost:8787`)
- Public API endpoint: tunnel hostname (for example `api.yourdomain.com`)

### 2.2 Prerequisites

- Domain already owned (you already have this).
- Netlify account.
- Backend runs locally with `npm run dev` and works at `http://localhost:8787`.
- `WEB_ORIGIN` can be set in `.env`.
- Frontend can read `VITE_API_BASE`.

### 2.3 Step-by-Step

#### Step A1 - Prepare frontend API variable

In Netlify, set:

- `VITE_API_BASE=https://api.yourdomain.com/api`

Why: frontend code uses `import.meta.env.VITE_API_BASE` and falls back to localhost if unset.

#### Step A2 - Deploy frontend to Netlify

If using Netlify UI:

- Build command: `npm run build:frontend`
- Publish directory: `frontend/dist`

If using Netlify CLI:

```bash
npm install
npm run build:frontend
```

Then deploy `frontend/dist`.

#### Step A3 - Update backend CORS origin

In repo `.env` on your machine, set:

- `WEB_ORIGIN=https://<your-netlify-site-or-custom-frontend-domain>`

Restart backend after changes.

#### Step A4 - Expose local backend with Cloudflare Tunnel

Recommended because it is fast to set up and works well with custom domains.

High-level steps:

1. Install `cloudflared`.
2. Authenticate to Cloudflare account.
3. Create a tunnel.
4. Route DNS `api.yourdomain.com` to tunnel.
5. Configure tunnel target as `http://localhost:8787`.
6. Run tunnel service continuously.

Example config (`~/.cloudflared/config.yml`):

```yaml
tunnel: <TUNNEL_ID>
credentials-file: <PATH_TO_TUNNEL_JSON>

ingress:
  - hostname: api.yourdomain.com
    service: http://localhost:8787
  - service: http_status:404
```

#### Step A5 - Validate end-to-end

Checks:

1. `https://api.yourdomain.com/api/jobs/<some-id>` returns JSON or expected error shape.
2. Netlify frontend loads.
3. Upload from frontend succeeds.
4. Job transitions to `processing` and eventually `completed`.
5. Export downloads (`txt`, `srt`, `json`) work.

### 2.4 Risks of Path A

- Backend stops if your machine sleeps/restarts.
- Uplink depends on home/office internet quality.
- Not ideal for multi-user concurrency.

---

## 3) Path B - Backend on Server (PC Can Be Off)

This is the path where backend leaves your personal machine.

### 3.1 Recommended topology

- Frontend: Netlify
- Backend: VPS (Ubuntu 22.04/24.04), running `backend` service with systemd
- Reverse proxy + HTTPS: Caddy or Nginx
- Domain:
  - `app.yourdomain.com` -> Netlify
  - `api.yourdomain.com` -> VPS

### 3.2 Server sizing baseline

Whisper workloads are CPU/RAM heavy. Start with:

- 4 vCPU minimum (8 vCPU preferred)
- 8 GB RAM minimum (16 GB preferred for larger models/concurrency)
- 80+ GB disk (models + uploads + artifacts)

### 3.3 Prepare repository for backend-only runtime

On server, you only need backend workspace + root deps, but easiest is full repo clone first.

### 3.4 Step-by-Step (Ubuntu VPS)

#### Step B1 - Provision server

- Create Ubuntu VPS.
- Add SSH key.
- Open ports `22`, `80`, `443` in firewall/security group.

#### Step B2 - Install runtime dependencies

```bash
sudo apt update
sudo apt install -y git curl ffmpeg build-essential cmake
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Verify:

```bash
node -v
npm -v
ffmpeg -version
```

#### Step B3 - Install whisper.cpp binary

Option 1: use prebuilt `whisper-cli` release binary.
Option 2: build from source.

Build from source example:

```bash
git clone https://github.com/ggml-org/whisper.cpp.git
cd whisper.cpp
cmake -B build
cmake --build build --config Release
```

Copy `whisper-cli` to a stable location in PATH, for example:

```bash
sudo cp build/bin/whisper-cli /usr/local/bin/whisper-cli
```

#### Step B4 - Download model file(s)

Create model directory:

```bash
sudo mkdir -p /opt/notadio/models
sudo chown -R $USER:$USER /opt/notadio
```

Download preferred model (example naming):

- `/opt/notadio/models/ggml-large-v3.bin`

#### Step B5 - Deploy app code

```bash
cd /opt
git clone <your-repo-url> notadio
cd /opt/notadio
npm install
npm run build:backend
```

#### Step B6 - Create production environment file

Create `/opt/notadio/.env`:

```env
PORT=8787
WEB_ORIGIN=https://app.yourdomain.com
STORAGE_ROOT=./data
FFMPEG_PATH=ffmpeg
WHISPER_COMMAND=whisper-cli
WHISPER_MODEL_PATH=/opt/notadio/models/ggml-large-v3.bin
WHISPER_ARGS=-m "{model}" -f "{input}" --output-json --output-srt --output-file "{outputBase}" --language auto
WHISPER_TRANSLATE_ARGS=-m "{model}" -f "{input}" --output-json --output-file "{outputBase}" --language auto --translate
WHISPER_PERF_PROFILE=balanced
WHISPER_THREADS=
ENABLE_ENGLISH_TRANSLATION=true
JOB_LOG_LIMIT=300
DIARIZATION_COMMAND=
DIARIZATION_ARGS=--input "{input}" --output "{outputFile}"
```

#### Step B7 - Run backend with systemd

Create `/etc/systemd/system/notadio-backend.service`:

```ini
[Unit]
Description=Notadio Backend
After=network.target

[Service]
Type=simple
User=<YOUR_LINUX_USER>
WorkingDirectory=/opt/notadio/backend
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /opt/notadio/backend/dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable notadio-backend
sudo systemctl start notadio-backend
sudo systemctl status notadio-backend
```

#### Step B8 - Add reverse proxy + TLS (Caddy example)

Install Caddy, then configure:

```caddyfile
api.yourdomain.com {
  reverse_proxy 127.0.0.1:8787
}
```

Caddy handles HTTPS certificates automatically after DNS points to server.

#### Step B9 - Point DNS

- `api.yourdomain.com` -> VPS public IP (A/AAAA)
- `app.yourdomain.com` -> Netlify site

#### Step B10 - Configure Netlify frontend

In Netlify env vars:

- `VITE_API_BASE=https://api.yourdomain.com/api`

Redeploy frontend.

#### Step B11 - Validate

1. `https://api.yourdomain.com/api/jobs/<id>` responds.
2. Browser upload works from `app.yourdomain.com`.
3. Processing and exports succeed.
4. Server reboot test: backend auto-starts and still works.

---

## 4) Security and Reliability Checklist (Both Paths)

- Restrict backend CORS with exact `WEB_ORIGIN`.
- Keep model and upload paths outside webroot.
- Monitor disk usage for `data/` growth.
- Add periodic cleanup/retention policy for old jobs.
- Add uptime monitoring for `api.yourdomain.com`.
- Add backup strategy for data and configs.

---

## 5) Suggested Rollout Order

1. Implement **Path A** first for immediate public availability.
2. Validate user flow and performance.
3. Move to **Path B** when you need always-on reliability and independence from your PC.

---

## 6) Optional Enhancements After Initial Deployment

- Containerize backend (`Dockerfile`) for portable deploys.
- Add queue + worker split when concurrency grows.
- Add object storage for artifacts (S3-compatible) if local disk becomes a bottleneck.
- Add auth/rate limiting before opening to broad public access.

