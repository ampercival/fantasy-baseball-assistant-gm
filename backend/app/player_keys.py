from __future__ import annotations

import re
import unicodedata

SUFFIX_PATTERN = re.compile(r"\b(jr|sr|ii|iii|iv|v)\b\.?", re.IGNORECASE)
NON_WORD_PATTERN = re.compile(r"[^a-z0-9]+")
PLAYER_KEY_ALIASES = {
    "leodalis de vries": "leo de vries",
}


def normalize_player_key(name: str) -> str:
    normalized = unicodedata.normalize("NFKD", name)
    ascii_name = normalized.encode("ascii", "ignore").decode("ascii")
    ascii_name = SUFFIX_PATTERN.sub("", ascii_name)
    ascii_name = NON_WORD_PATTERN.sub(" ", ascii_name.lower())
    key = " ".join(ascii_name.split())
    return PLAYER_KEY_ALIASES.get(key, key)


def clean_player_name(name: str) -> str:
    return " ".join(name.replace("\xa0", " ").split())
