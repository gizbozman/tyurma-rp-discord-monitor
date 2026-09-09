/**
 * ТюрьмаRP — мониторинг GMod-сервера → Discord.
 * Запускается локально или из GitHub Actions каждые N минут.
 *
 * Env:
 *   GAME_HOST          — IP сервера
 *   GAME_PORT          — порт (по умолчанию 27015)
 *   DISCORD_BOT_TOKEN  — токен бота
 *   DISCORD_CHANNEL_ID — канал для статуса
 *   DISCORD_MESSAGE_ID — (опционально) id сообщения для edit; иначе создаст новое и выведет id
 *   SERVER_NAME        — название в эмбеде
 *   CONNECT_HINT       — подсказка как зайти (IP / steam connect)
 */

const { GameDig } = require("gamedig");

const HOST = process.env.GAME_HOST || "127.0.0.1";
const PORT = Number(process.env.GAME_PORT || 27015);
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const MESSAGE_ID = process.env.DISCORD_MESSAGE_ID || "";
const SERVER_NAME = process.env.SERVER_NAME || "ТюрьмаRP │ Волчий Яр │ ОБТ";
const CONNECT_HINT = process.env.CONNECT_HINT || `${HOST}:${PORT}`;

if (!TOKEN || !CHANNEL_ID) {
  console.error("Нужны DISCORD_BOT_TOKEN и DISCORD_CHANNEL_ID");
  process.exit(1);
}

async function queryServer() {
  try {
    const state = await GameDig.query({
      type: "garrysmod",
      host: HOST,
      port: PORT,
      givenPortOnly: true,
      socketTimeout: 5000,
      attemptTimeout: 10000,
    });
    const list = Array.isArray(state.players)
      ? state.players
          .map((p) => (p && p.name ? String(p.name).trim() : ""))
          .filter(Boolean)
      : [];
    return {
      online: true,
      name: state.name || SERVER_NAME,
      map: state.map || "?",
      players: state.numplayers ?? list.length ?? 0,
      max: state.maxplayers ?? 32,
      ping: state.ping ?? null,
      connect: state.connect || CONNECT_HINT,
      playerList: list,
    };
  } catch (err) {
    return {
      online: false,
      error: err && err.message ? err.message : String(err),
    };
  }
}

function buildEmbed(info) {
  const now = Math.floor(Date.now() / 1000);
  if (!info.online) {
    return {
      title: SERVER_NAME,
      description: "🔴 **Сервер оффлайн** или не отвечает на запрос.",
      color: 0xb33a3a,
      fields: [
        { name: "Адрес", value: `\`${CONNECT_HINT}\``, inline: true },
        { name: "Ошибка", value: `\`\`\`${(info.error || "timeout").slice(0, 200)}\`\`\``, inline: false },
      ],
      footer: { text: "ТюрьмаRP мониторинг · GitHub Actions" },
      timestamp: new Date().toISOString(),
    };
  }

  const barFilled = Math.min(10, Math.round((info.players / Math.max(1, info.max)) * 10));
  const bar = "█".repeat(barFilled) + "░".repeat(10 - barFilled);
  const playerField = formatPlayerList(info.playerList || [], info.players);

  return {
    title: info.name || SERVER_NAME,
    description: "🟢 **Онлайн**",
    color: 0xd49848,
    fields: [
      { name: "Игроки", value: `**${info.players}** / **${info.max}**\n\`${bar}\``, inline: true },
      { name: "Карта", value: `\`${info.map}\``, inline: true },
      { name: "Пинг запроса", value: info.ping != null ? `${info.ping} мс` : "—", inline: true },
      { name: "Список игроков", value: playerField, inline: false },
      { name: "Подключение", value: `\`${info.connect || CONNECT_HINT}\``, inline: false },
      { name: "Обновлено", value: `<t:${now}:R>`, inline: false },
    ],
    footer: { text: "ТюрьмаRP мониторинг · обновление ~каждые 5 мин" },
    timestamp: new Date().toISOString(),
  };
}

/** Discord field value max 1024 chars */
function formatPlayerList(names, count) {
  if (!count || count < 1) return "_никого нет_";
  if (!names.length) {
    return `_сервер не отдал ники (${count} в игре)_`;
  }

  const lines = [];
  let used = 0;
  const limit = 980;
  for (let i = 0; i < names.length; i++) {
    const line = `\`${i + 1}.\` ${names[i].slice(0, 64)}`;
    if (used + line.length + 1 > limit) {
      const left = names.length - i;
      lines.push(`_…и ещё ${left}_`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  if (count > names.length) {
    lines.push(`_(+${count - names.length} без ника)_`);
  }
  return lines.join("\n") || "_никого нет_";
}

async function discordApi(method, path, body) {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    method,
    headers: {
      Authorization: `Bot ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`Discord ${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  }
  return data;
}

async function main() {
  console.log(`Query ${HOST}:${PORT} ...`);
  const info = await queryServer();
  if (info.online) {
    console.log(`Online ${info.players}/${info.max} map=${info.map}`);
    if (info.playerList && info.playerList.length) {
      console.log("Players:", info.playerList.join(", "));
    }
  } else {
    console.log(`Offline: ${info.error}`);
  }

  const embed = buildEmbed(info);
  const payload = { embeds: [embed] };

  if (MESSAGE_ID) {
    await discordApi("PATCH", `/channels/${CHANNEL_ID}/messages/${MESSAGE_ID}`, payload);
    console.log(`Updated message ${MESSAGE_ID}`);
    return;
  }

  const created = await discordApi("POST", `/channels/${CHANNEL_ID}/messages`, payload);
  console.log("Created new status message.");
  console.log("Добавь в GitHub Secrets / Variables:");
  console.log(`DISCORD_MESSAGE_ID=${created.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
