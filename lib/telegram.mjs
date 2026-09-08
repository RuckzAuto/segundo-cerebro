import { db } from './db.mjs';
import { processMessage } from './brain.mjs';

const TELEGRAM_API_BASE = "https://api.telegram.org";
const TELEGRAM_MESSAGE_LIMIT = 4096;

export async function telegramRequest(token, method, body = {}) {
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(`Telegram API error in ${method}: ${JSON.stringify(data)}`);
  }
  return data.result;
}

export async function sendMessage(token, chatId, text, extra = {}) {
  for (const chunk of splitMessage(text)) {
    try {
      await telegramRequest(token, "sendMessage", {
        chat_id: chatId,
        text: chunk,
        parse_mode: "Markdown",
        ...extra,
      });
    } catch {
      await telegramRequest(token, "sendMessage", {
        chat_id: chatId,
        text: chunk,
        ...extra,
      });
    }
  }
}

export async function sendChatAction(token, chatId, action = "typing") {
  try {
    await telegramRequest(token, "sendChatAction", { chat_id: chatId, action });
  } catch {}
}

function splitMessage(text) {
  if (!text) return ["..."];
  if (text.length <= TELEGRAM_MESSAGE_LIMIT) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > TELEGRAM_MESSAGE_LIMIT) {
    let cut = remaining.lastIndexOf("\n", TELEGRAM_MESSAGE_LIMIT);
    if (cut < 1000) cut = remaining.lastIndexOf(" ", TELEGRAM_MESSAGE_LIMIT);
    if (cut < 1000) cut = TELEGRAM_MESSAGE_LIMIT;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export async function handleUpdate(update, token) {
  const message = update.message;
  if (!message || !message.chat || !message.from || !message.text) return;

  const chatId = message.chat.id;
  const text = message.text;

  if (text === '/start') {
    await sendMessage(token, chatId, "Bot ativo! Pronto para integrar com o Segundo Cérebro.");
    return;
  }

  if (text === '/reset') {
    let state = { chatHistories: {} };
    try {
      const stateRs = await db.execute({
        sql: 'SELECT data FROM agent_state WHERE id = ?',
        args: ['main_brain_state']
      });
      if (stateRs.rows.length > 0) {
        state = JSON.parse(stateRs.rows[0].data);
        if (!state.chatHistories) state.chatHistories = {};
      }
    } catch(e) {
      console.error("Erro ao ler state:", e);
    }
    
    if (state.chatHistories[String(chatId)]) {
      delete state.chatHistories[String(chatId)];
    }
    
    await db.execute({
      sql: 'INSERT INTO agent_state (id, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=CURRENT_TIMESTAMP',
      args: ['main_brain_state', JSON.stringify(state)]
    });
    
    await sendMessage(token, chatId, "Histórico reiniciado! ✅");
    return;
  }

  await sendChatAction(token, chatId, "typing");
  
  try {
    const reply = await processMessage(text, chatId);
    await sendMessage(token, chatId, reply);
  } catch (err) {
    console.error(err);
    await sendMessage(token, chatId, "Erro ao processar mensagem.");
  }
}
