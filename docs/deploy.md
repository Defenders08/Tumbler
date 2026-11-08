# Деплой Tumbler на VPS

Проверенная конфигурация: Ubuntu 22.04+, Node.js 22+, nginx + systemd + Let's Encrypt. Никаких платных сервисов.

## 1. Подготовка сервера

```bash
sudo apt update && sudo apt install -y nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
sudo adduser --system --group --home /opt/tumbler tumbler
```

## 2. Код и конфигурация

```bash
sudo rsync -a --exclude node_modules --exclude data --exclude .env ./ /opt/tumbler/
sudo chown -R tumbler:tumbler /opt/tumbler
```

`/opt/tumbler/.env` (права 600):

```ini
NODE_ENV=production
PORT=3000
SESSION_SECRET=<openssl rand -base64 48>
ADMIN_EMAIL=<ваша почта>
ADMIN_PASSWORD=<пароль администратора>
```

## 3. Первый запуск и проверка

```bash
cd /opt/tumbler && sudo -u tumbler npm ci && sudo -u tumbler npm start
curl -s http://127.0.0.1:3000/health   # {"status":"ok",...}
```

Администратор создастся при первом старте из `ADMIN_EMAIL`/`ADMIN_PASSWORD` (если админа в базе ещё нет).

## 4. systemd

`/etc/systemd/system/tumbler.service`:

```ini
[Unit]
Description=Tumbler
After=network.target

[Service]
User=tumbler
WorkingDirectory=/opt/tumbler
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production
# Секреты берутся из /opt/tumbler/.env самим приложением (--env-file-if-exlicts не нужен:
# src/config.js читает process.env, Environment= можно дополнить)
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=/opt/tumbler/data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now tumbler
systemctl status tumbler
```

## 5. nginx + TLS

`/etc/nginx/sites-available/tumbler`:

```nginx
server {
    listen 80;
    server_name example.com;
    client_max_body_size 200m;   # лимит загрузок из админки + запас

    location /static/ {
        alias /opt/tumbler/src/public/;
        expires 7d;
    }
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/tumbler /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx && sudo certbot --nginx -d example.com
```

HTTPS обязателен: в production cookies помечены `Secure` (см. `src/modules/auth/session.js`).

## 6. Резервные копии

Снапшот базы берётся онлайн (WAL), остановка не нужна:

```bash
sudo -u tumbler node /opt/tumbler/scripts/backup.js /opt/tumbler/backups
```

Cron — ежедневно в 4:00 (`crontab -e -u tumbler`):

```
0 4 * * * cd /opt/tumbler && node scripts/backup.js /opt/tumbler/backups
```

Настройте копирование `backups/` вне сервера (rsync/объектное хранилище).

## 7. Восстановление

```bash
sudo systemctl stop tumbler
# заменить базу и медиа из архива:
sudo -u tumbler cp /path/to/backup/tumbler.db /opt/tumbler/data/tumbler.db
sudo -u tumbler rsync -a /path/to/backup/uploads/ /opt/tumbler/data/uploads/
sudo systemctl start tumbler
curl -s http://127.0.0.1:3000/health
```

## 8. Обновление версии

```bash
sudo systemctl stop tumbler
cd /opt/tumbler && sudo -u tumbler git pull --ff-only   # или rsync новой версии
sudo -u tumbler npm ci
sudo -u tumbler node src/db/migrate.js   # миграции идемпотентны, данные сохраняются
sudo systemctl start tumbler
```

## 9. Чек-лист перед публичным запуском

- [ ] `SESSION_SECRET` задан, `.env` с правами 600, не в Git
- [ ] `NODE_ENV=production` (Secure-cookies, кеш статики, CSP активен)
- [ ] Админ создан, `ADMIN_PASSWORD` из env удалён из файла после первого запуска (опционально)
- [ ] `https://` работает, сертификат обновляется (certbot timer)
- [ ] Бэкап выполнен и **восстановление проверено** на тестовом каталоге
- [ ] `curl -I https://example.com/health` отдаёт 200 и security-заголовки
- [ ] Лимиты загрузок выставлены в админке (`/admin/settings`)
