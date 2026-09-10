# Discord-мониторинг ТюрьмаRP (бесплатно через GitHub Actions)

GitHub **не хостит бота 24/7**. Вместо этого Actions раз в ~5 минут:
1. спрашивает GMod-сервер (A2S / gamedig)
2. обновляет одно сообщение в Discord

## 1. Discord-бот

1. https://discord.com/developers/applications → New Application  
2. Bot → Add Bot → скопируй **Token**  
3. Включи Privileged Gateway Intent не нужны (пишем через REST)  
4. OAuth2 → URL Generator:
   - Scopes: `bot`
   - Permissions: `Send Messages`, `Embed Links`, `Manage Messages` (по желанию)
5. Открой ссылку, пригласи бота на сервер  
6. Канал для статуса → ПКМ → Копировать ID канала (режим разработчика)

## 2. Секреты GitHub

Settings → Secrets and variables → Actions → Secrets:

| Secret | Значение |
|--------|----------|
| `GAME_HOST` | IP сервера (например `94.26.255.7`) |
| `GAME_PORT` | `27615` |
| `DISCORD_BOT_TOKEN` | токен бота |
| `DISCORD_CHANNEL_ID` | id канала |
| `DISCORD_MESSAGE_ID` | id сообщения (после первого запуска) |

Variables (опционально):

| Variable | Пример |
|----------|--------|
| `SERVER_NAME` | `ТюрьмаRP │ Волчий Яр │ ОБТ` |
| `CONNECT_HINT` | `94.26.255.7:27615` |

## 3. Первый запуск

1. Actions → **Server status → Discord** → Run workflow  
2. В логе будет: `DISCORD_MESSAGE_ID=...`  
3. Добавь этот id в Secrets как `DISCORD_MESSAGE_ID`  
4. Дальше бот будет **редактировать** это сообщение, а не спамить новыми

## 4. Локально (если есть Node)

```bash
cp .env.example .env
# заполни .env
npm install
node --env-file=.env monitor.js
```

## Важно

- Сервер должен отвечать на **публичный** A2S (UDP порт игры).  
- Если хост режет query снаружи — в Discord будет «оффлайн».  
- Free GitHub Actions часто обновляет **реже**, чем раз в 5 мин (типично 8–15) — это лимит платформы, не баг бота.  
- Если онлайн есть, а ников нет — на Source иногда нужно `host_players_show 2` (или аналог на хостинге).
