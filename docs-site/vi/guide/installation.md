# Cài đặt

## Cách 1: Docker (Khuyến nghị)

**Yêu cầu:** Docker, Docker Compose

```bash
git clone https://github.com/nhannguyen09/dugate.git
cd dugate

cp .env.example .env
# Sửa .env: điền DATABASE_URL, NEXTAUTH_SECRET, ENCRYPTION_KEY, NEXTAUTH_URL

docker compose up -d
```

Mở `http://your-server:2023/setup` để tạo tài khoản admin.

**Cập nhật:**

```bash
git pull
docker compose down
docker compose up -d --build
```

---

## Cách 2: VPS — Ubuntu 22.04

### 1. Cài dependencies

```bash
sudo apt update && sudo apt install -y pandoc ghostscript nodejs npm postgresql nginx certbot python3-certbot-nginx
sudo npm install -g pm2
```

### 2. Tạo database PostgreSQL

```bash
sudo -u postgres psql -c "CREATE USER dugate WITH PASSWORD 'your_password';"
sudo -u postgres psql -c "CREATE DATABASE dugate OWNER dugate;"
```

### 3. Clone và cấu hình

```bash
git clone https://github.com/nhannguyen09/dugate.git /var/www/dugate
cd /var/www/dugate
npm install
cp .env.example .env
# Sửa .env
npx prisma migrate deploy
npm run build
```

### 4. Khởi động với PM2

```bash
pm2 start npm --name dugate -- start
pm2 save
pm2 startup
```

### 5. Nginx + SSL

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/dugate
sudo ln -s /etc/nginx/sites-available/dugate /etc/nginx/sites-enabled/
# Sửa config: thay YOUR_DOMAIN
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d your-domain.com
```

---

## Cách 3: Vercel (Giới hạn)

::: warning
Vercel không hỗ trợ Pandoc và Ghostscript. Tính năng transform DOCX không hoạt động. Chỉ dùng được PDF với AI Vision trực tiếp.
:::

```bash
npm install -g vercel
vercel --prod
```

Cài biến môi trường trong Vercel dashboard. Dùng PostgreSQL ngoài (Supabase, Neon) cho `DATABASE_URL`.

Để dùng đầy đủ tính năng, hãy chọn Docker hoặc VPS.
