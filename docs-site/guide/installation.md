# Installation

## Option 1: Docker (Recommended)

**Requirements:** Docker, Docker Compose

```bash
git clone https://github.com/nhannguyen09/dugate.git
cd dugate

cp .env.example .env
# Edit .env — set DATABASE_URL, NEXTAUTH_SECRET, ENCRYPTION_KEY, NEXTAUTH_URL

docker compose up -d
```

Open `http://your-server:2023/setup` to create your admin account.

**Update:**

```bash
git pull
docker compose down
docker compose up -d --build
```

---

## Option 2: VPS — Ubuntu 22.04

### 1. Install dependencies

```bash
sudo apt update && sudo apt install -y pandoc ghostscript nodejs npm postgresql nginx certbot python3-certbot-nginx
sudo npm install -g pm2
```

### 2. Set up PostgreSQL

```bash
sudo -u postgres psql -c "CREATE USER dugate WITH PASSWORD 'your_password';"
sudo -u postgres psql -c "CREATE DATABASE dugate OWNER dugate;"
```

### 3. Clone and configure

```bash
git clone https://github.com/nhannguyen09/dugate.git /var/www/dugate
cd /var/www/dugate
npm install
cp .env.example .env
# Edit .env
npx prisma migrate deploy
npm run build
```

### 4. Start with PM2

```bash
pm2 start npm --name dugate -- start
pm2 save
pm2 startup
```

### 5. Nginx + SSL

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/dugate
sudo ln -s /etc/nginx/sites-available/dugate /etc/nginx/sites-enabled/
# Edit the config: replace YOUR_DOMAIN
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d your-domain.com
```

---

## Option 3: Vercel (Limited)

::: warning
Vercel does not support Pandoc or Ghostscript. DOCX transformation is not supported. PDF-only mode works with a direct AI Vision provider.
:::

```bash
npm install -g vercel
vercel --prod
```

Set environment variables in the Vercel dashboard. Use an external PostgreSQL service (Supabase, Neon) for `DATABASE_URL`.

For full functionality, use Docker or VPS.
