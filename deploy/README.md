# Deploy — VPS Setup (Tencent Lighthouse, Ubuntu, 2vCPU/2GB)

Referensi: `docs/plan/01-architecture.md`, `docs/plan/modul-1-setup-fondasi.md`.

## 1. Setup awal VPS (sekali saja)

```bash
# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # logout/login setelah ini

# Swap 2GB — wajib, RAM 2GB mepet untuk spike Puppeteer render PDF (modul 3/5)
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Firewall — hanya 22 (SSH), 80, 443
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw enable

# fail2ban (proteksi brute-force SSH)
sudo apt install -y fail2ban
```

## 2. Login ke GHCR (GitHub Container Registry)

Buat Personal Access Token (classic) dengan scope `read:packages`, lalu:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u fabian4819 --password-stdin
```

## 3. Copy file deploy ke VPS

```bash
mkdir -p ~/azera-deploy && cd ~/azera-deploy
# copy docker-compose.yml, Caddyfile, .env (dari .env.example, isi nilai asli)
```

## 4. Jalankan

```bash
docker compose up -d
docker compose logs -f
```

Caddy otomatis provision TLS (Let's Encrypt) untuk domain di `DOMAIN` — pastikan DNS A record domain sudah mengarah ke IP VPS sebelum start.

## 5. Deploy update (dari CI/CD)

GitHub Actions build image → push ke GHCR dengan tag `latest` (dan tag commit SHA). Untuk pull versi terbaru di VPS:

```bash
cd ~/azera-deploy
docker compose pull
docker compose up -d
```

Ini yang dijalankan otomatis oleh workflow deploy lewat SSH (lihat `.github/workflows/deploy.yml` di masing-masing repo) begitu secret `VPS_HOST`/`VPS_SSH_KEY` dikonfigurasi.

## Estimasi RAM (2GB + swap 2GB)

| Komponen | Perkiraan |
|----------|-----------|
| Caddy | ~20–30MB |
| Nginx (client) | ~10–20MB |
| API + Baileys (idle) | ~150–250MB |
| Puppeteer render PDF (spike, di-queue satu-per-satu) | ~300–400MB |

Kalau nanti spike sering / trafik naik, upgrade ke 4GB — jangan jalankan render PDF paralel di 2GB tanpa antrian.
