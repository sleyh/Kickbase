"""Pushes rich briefing content to a Telegram chat/channel via the Bot API.

Uses HTML parse mode (not Markdown) - stricter but more predictable escaping
via html.escape(), so a player name with an underscore or asterisk in it
can't break the whole message the way Telegram's legacy Markdown mode does.

Buttons here are link buttons (open a URL) only, not callback buttons -
there's no listener running to respond to a callback_query yet, and an
unanswered callback button just spins forever in the Telegram UI, which is
worse than no button. Once there's a live endpoint to act on button
presses, this is the place a callback-based "Bid"/"Sell" button would go.
"""
from __future__ import annotations

import requests

TELEGRAM_API = "https://api.telegram.org"
MAX_MESSAGE_LENGTH = 4096  # Telegram's per-text-message limit
MAX_CAPTION_LENGTH = 1024  # Telegram's per-photo-caption limit


def inline_keyboard(rows: list[list[tuple[str, str]]]) -> dict:
    """Builds a reply_markup inline keyboard from rows of (label, url)."""
    return {"inline_keyboard": [[{"text": label, "url": url} for label, url in row] for row in rows]}


def send_message(token: str, chat_id: str, text: str, reply_markup: dict | None = None) -> None:
    """Sends text to a Telegram chat, splitting into multiple messages if
    it exceeds Telegram's 4096-character limit (relevant for --all-leagues
    briefings; a single-league one is well under this). reply_markup (if
    given) is only attached to the last chunk."""
    chunks = _chunks(text, MAX_MESSAGE_LENGTH)
    for i, chunk in enumerate(chunks):
        markup = reply_markup if i == len(chunks) - 1 else None
        _post("sendMessage", token, {"chat_id": chat_id, "text": chunk}, markup)


def send_photo(token: str, chat_id: str, photo_url: str, caption: str, reply_markup: dict | None = None) -> None:
    """Sends a photo (e.g. a player's Kickbase CDN image) with an HTML
    caption and optional inline keyboard. Caption is truncated to
    Telegram's 1024-char photo-caption limit (shorter than a text
    message's) if needed - callers should keep captions short anyway."""
    caption = caption if len(caption) <= MAX_CAPTION_LENGTH else caption[: MAX_CAPTION_LENGTH - 1] + "…"
    _post("sendPhoto", token, {"chat_id": chat_id, "photo": photo_url, "caption": caption}, reply_markup)


def _post(method: str, token: str, body: dict, reply_markup: dict | None) -> None:
    url = f"{TELEGRAM_API}/{'bot'}{token}/{method}"
    payload = {**body, "parse_mode": "HTML"}
    if reply_markup:
        payload["reply_markup"] = reply_markup
    resp = requests.post(url, json=payload, timeout=15)
    if not resp.ok:
        # HTML parsing is still strict about tag balance - fall back to
        # plain text (still with any reply_markup) so a formatting quirk
        # doesn't silently drop the update.
        plain = {k: v for k, v in payload.items() if k != "parse_mode"}
        if "text" in plain:
            plain["text"] = _strip_tags(plain["text"])
        if "caption" in plain:
            plain["caption"] = _strip_tags(plain["caption"])
        resp = requests.post(url, json=plain, timeout=15)
        if not resp.ok:
            raise RuntimeError(f"Telegram {method} failed ({resp.status_code}): {resp.text}")


def _strip_tags(text: str) -> str:
    import re
    return re.sub(r"</?[a-zA-Z][^>]*>", "", text)


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
