"""Pushes briefing text to a Telegram chat/channel via the Bot API."""
from __future__ import annotations

import requests

TELEGRAM_API = "https://api.telegram.org"
MAX_MESSAGE_LENGTH = 4096  # Telegram's per-message limit


def send_message(token: str, chat_id: str, text: str) -> None:
    """Sends text to a Telegram chat, splitting into multiple messages if
    it exceeds Telegram's 4096-character limit (relevant for --all-leagues
    briefings; a single-league one is well under this)."""
    for chunk in _chunks(text, MAX_MESSAGE_LENGTH):
        _send_chunk(token, chat_id, chunk)


def _send_chunk(token: str, chat_id: str, text: str) -> None:
    url = f"{TELEGRAM_API}/bot{token}/sendMessage"
    resp = requests.post(url, json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown"}, timeout=15)
    if not resp.ok:
        # Telegram's Markdown parsing is strict (an unmatched * or _ - e.g.
        # from a player name - breaks the whole message). Retry as plain
        # text so a formatting quirk doesn't silently drop the update.
        resp = requests.post(url, json={"chat_id": chat_id, "text": text}, timeout=15)
        if not resp.ok:
            raise RuntimeError(f"Telegram send failed ({resp.status_code}): {resp.text}")


def _chunks(text: str, limit: int) -> list[str]:
    if len(text) <= limit:
        return [text]
    parts: list[str] = []
    current = ""
    for line in text.split("\n"):
        candidate = f"{current}\n{line}" if current else line
        if len(candidate) > limit:
            if current:
                parts.append(current)
            current = line
        else:
            current = candidate
    if current:
        parts.append(current)
    return parts
