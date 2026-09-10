/**
 * ТюрьмаRP — мониторинг GMod-сервера → Discord.
 * Запускается локально или из GitHub Actions.
 *
 * Env:
 *   GAME_HOST          — IP сервера
 *   GAME_PORT          — порт (по умолчанию 27615)
 *   DISCORD_BOT_TOKEN  — токен бота
 *   DISCORD_CHANNEL_ID — канал для статуса
 *   DISCORD_MESSAGE_ID — (опционально) id сообщения для edit
 *   SERVER_NAME        — название в эмбеде (если query не отдал name)
 *   CONNECT_HINT       — подсказка как зайти
 */

const { GameDig } = require("gamedig");

const HOST = (process.env.GAME_HOST || "127.0.0.1").trim();
const PORT = Number(process.env.GAME_PORT || 27615);
const TOKEN = (process.env.DISCORD_BOT_TOKEN || "").trim();
const CHANNEL_ID = (process.env.DISCORD_CHANNEL_ID || "").trim();
const MESSAGE_ID = (process.env.DISCORD_MESSAGE_ID || "").trim();
const SERVER_NAME = (process.env.SERVER_NAME || "ТюрьмаRP │ Волчий Яр │ ОБТ").trim();
const CONNECT_HINT = (process.env.CONNECT_HINT || `${HOST}:${PORT}`).trim();

if (!TOKEN || !CHANNEL_ID) {
  console.error("Нужны DISCORD_BOT_TOKEN и DISCORD_CHANNEL_ID");
  process.exit(1);
}
if (!Number.isFinite(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`Некорректный GAME_PORT: ${process.env.GAME_PORT}`);
  process.exit(1);
}

function escapeMd(text) {
  return String(text).replace(/([\\`*_~|>])/g, "\\$1");
}

function truncate(text, max) {
  const s = String(text || "");
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

async function queryServer() {
  try {
    const state = await GameDig.query({
      type: "garrysmod",
      host: HOST,
      port: PORT,
      givenPortOnly: true,
      requestPlayers: true,
      socketTimeout: 5000,
      attemptTimeout: 10000,
      maxRetries: 2,
    });

    const list = Array.isArray(state.players)
      ? state.players
          .map((p) => (p && p.name ? String(p.name).trim() : ""))
          .filter(Boolean)
      : [];

    const num = Number(state.numplayers);
    const players = Number.isFinite(num) ? num : list.length;
    const maxRaw = Number(state.maxplayers);
    const max = Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : 128;

    return {
      online: true,
      name: state.name || SERVER_NAME,
      map: state.map || "?",
      players,
      max,
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
    const line = `\`${i + 1}.\` ${escapeMd(truncate(names[i], 64))}`;
    if (used + line.length + 1 > limit) {
      lines.push(`_…и ещё ${names.length - i}_`);
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

function buildEmbed(info) {
  const now = Math.floor(Date.now() / 1000);
  if (!info.online) {
    return {
      title: truncate(SERVER_NAME, 256),
      description: "🔴 **Сервер оффлайн** или не отвечает на запрос.",
      color: 0xb33a3a,
      fields: [
        { name: "Адрес", value: `\`${truncate(CONNECT_HINT, 200)}\``, inline: true },
        {
          name: "Ошибка",
          value: `\`\`\`${truncate(info.error || "timeout", 200)}\`\`\``,
          inline: false,
        },
      ],
      footer: { text: "ТюрьмаRP мониторинг · GitHub Actions (~5–15 мин)" },
      timestamp: new Date().toISOString(),
    };
  }

  const ratio = info.players / Math.max(1, info.max);
  const barFilled = Math.min(10, Math.max(0, Math.round(ratio * 10)));
  const bar = "█".repeat(barFilled) + "░".repeat(10 - barFilled);

  return {
    title: truncate(info.name || SERVER_NAME, 256),
    description: "🟢 **Онлайн**",
    color: 0xd49848,
    fields: [
      { name: "Игроки", value: `**${info.players}** / **${info.max}**\n\`${bar}\``, inline: true },
      { name: "Карта", value: `\`${truncate(info.map, 100)}\``, inline: true },
      { name: "Пинг запроса", value: info.ping != null ? `${info.ping} мс` : "—", inline: true },
      { name: "Список игроков", value: formatPlayerList(info.playerList || [], info.players), inline: false },
      { name: "Подключение", value: `\`${truncate(info.connect || CONNECT_HINT, 200)}\``, inline: false },
      { name: "Обновлено", value: `<t:${now}:R>`, inline: false },
    ],
    footer: { text: "ТюрьмаRP мониторинг · GitHub может обновлять реже 5 мин" },
    timestamp: new Date().toISOString(),
  };
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function discordApi(method, path, body, { allowNotFound = false } = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
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

    if (res.status === 429) {
      const waitSec = (data && data.retry_after) || 1;
      console.warn(`Discord rate limit, wait ${waitSec}s`);
      await sleep(Math.ceil(Number(waitSec) * 1000) + 100);
      continue;
    }

    if (allowNotFound && (res.status === 404 || (data && data.code === 10008))) {
      return { notFound: true, data };
    }

    if (!res.ok) {
      throw new Error(`Discord ${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
    }
    return data;
  }
  throw new Error(`Discord ${method} ${path} → rate limit retries exhausted`);
}

async function postOrUpdate(payload) {
  if (MESSAGE_ID) {
    const updated = await discordApi(
      "PATCH",
      `/channels/${CHANNEL_ID}/messages/${MESSAGE_ID}`,
      payload,
      { allowNotFound: true }
    );
    if (!updated || !updated.notFound) {
      console.log(`Updated message ${MESSAGE_ID}`);
      return;
    }
    console.warn(`Message ${MESSAGE_ID} not found — creating a new one`);
  }

  const created = await discordApi("POST", `/channels/${CHANNEL_ID}/messages`, payload);
  console.log("Created new status message.");
  console.log("Добавь / обнови GitHub Secret:");
  console.log(`DISCORD_MESSAGE_ID=${created.id}`);
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

  await postOrUpdate({ embeds: [buildEmbed(info)] });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
