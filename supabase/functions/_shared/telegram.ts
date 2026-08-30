/**
 * TypeScript port of kickbase/telegram.py - sends messages via the
 * Telegram Bot API. HTML parse mode (not Markdown) for the same reason
 * as the Python original: stricter but predictable escaping, so a player
 * name with an underscore or asterisk can't break the message the way
 * Telegram's legacy Markdown mode does.
 */

const TELEGRAM_API = "https://api.telegram.org";

export async function sendMessage(token: string, chatId: string, text: string): Promise<void> {
  const resp = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
  if (!resp.ok) {
    throw new Error(`Telegram sendMessage failed (${resp.status}): ${await resp.text()}`);
  }
}

export async function getMe(token: string): Promise<{ username: string }> {
  const resp = await fetch(`${TELEGRAM_API}/bot${token}/getMe`);
  if (!resp.ok) {
    throw new Error(`Telegram getMe failed (${resp.status}): ${await resp.text()}`);
  }
  const data = await resp.json();
  return data.result;
}
