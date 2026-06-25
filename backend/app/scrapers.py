from __future__ import annotations

import csv
import io
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Iterable
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

from .player_keys import clean_player_name
from .sources import RankingSource

USER_AGENT = "FantasyBaseballAssistantGM/0.1 (+local personal use)"
REQUEST_TIMEOUT_SECONDS = 30


@dataclass(frozen=True)
class RankingEntry:
    rank: int
    player_name: str
    team: str | None = None
    positions: str | None = None
    age: float | None = None


@dataclass(frozen=True)
class ScrapeResult:
    entries: list[RankingEntry]
    source_date: str | None = None
    source_date_kind: str | None = None


@dataclass(frozen=True)
class SourceDate:
    value: str
    kind: str


class ScrapeError(RuntimeError):
    pass


def scrape_source(source: RankingSource) -> list[RankingEntry]:
    return scrape_source_with_metadata(source).entries


def scrape_source_date(source: RankingSource) -> SourceDate | None:
    html = fetch_html(source.url)
    if source.scraper == "fantasypros_ecr":
        return extract_fantasypros_source_date(html) or extract_source_date(html)
    return extract_source_date(html)


def scrape_source_with_metadata(source: RankingSource) -> ScrapeResult:
    if source.scraper == "import_only":
        raise ScrapeError("This source is import-only.")

    html = fetch_html(source.url)
    if source.scraper == "fantasypros_ecr":
        source_date = extract_fantasypros_source_date(html) or extract_source_date(html)
    else:
        source_date = extract_source_date(html)
    if source.scraper == "html_table":
        entries = parse_html_rankings(html)
    elif source.scraper == "fantrax_roto":
        entries = parse_html_rankings(html, rank_header_aliases=("roto",))
    elif source.scraper == "fantrax_points":
        entries = parse_html_rankings(html, rank_header_aliases=("points",))
    elif source.scraper == "fantasypros_ecr":
        entries = parse_fantasypros_ecr(html)
    elif source.scraper == "fanranked_dynasty":
        entries = parse_fanranked_dynasty(fetch_json(urljoin(source.url, "/api/players?mode=dynasty")))
    elif source.scraper == "harry_knows_ball":
        entries = parse_harry_knows_ball_rankings(html)
    elif source.scraper == "dynatyze_mlb_rankings":
        entries = parse_dynatyze_mlb_rankings(html)
    elif source.scraper == "ben_rosener_datawrapper":
        entries = parse_ben_rosener_datawrapper_rankings(html)
    else:
        raise ScrapeError(f"Unsupported scraper: {source.scraper}")

    return ScrapeResult(
        entries=entries,
        source_date=source_date.value if source_date else None,
        source_date_kind=source_date.kind if source_date else None,
    )


def fetch_html(url: str) -> str:
    response = requests.get(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return response.text


def fetch_json(url: str):
    response = requests.get(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return response.json()


def fetch_text(url: str) -> str:
    response = requests.get(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "text/csv,text/plain,*/*"},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return response.content.decode("utf-8-sig")


def extract_source_date(html: str) -> SourceDate | None:
    soup = BeautifulSoup(html, "lxml")
    meta_values = collect_meta_date_values(soup)

    preferred_meta = (
        ("article:modified_time", "updated"),
        ("og:updated_time", "updated"),
        ("datemodified", "updated"),
        ("date.modified", "updated"),
        ("lastmod", "updated"),
        ("article:published_time", "published"),
        ("dc.date.issued", "published"),
        ("parsely-pub-date", "published"),
        ("pubdate", "published"),
        ("publish-date", "published"),
        ("publish_date", "published"),
        ("datepublished", "published"),
        ("date", "published"),
    )
    for key, kind in preferred_meta:
        for value in meta_values.get(key, []):
            parsed = parse_source_date_value(value)
            if parsed:
                return SourceDate(parsed, kind)

    json_ld_date = extract_json_ld_source_date(soup)
    if json_ld_date:
        return json_ld_date

    for time in soup.find_all("time"):
        value = time.get("datetime") or time.get_text(" ", strip=True)
        parsed = parse_source_date_value(value)
        if parsed:
            classes = {str(item).lower() for item in time.get("class", [])}
            kind = "updated" if "updated" in classes else "published" if "published" in classes else "detected"
            return SourceDate(parsed, kind)

    text_date = extract_text_source_date(soup.get_text(" ", strip=True))
    if text_date:
        return text_date

    return None


def collect_meta_date_values(soup: BeautifulSoup) -> dict[str, list[str]]:
    values: dict[str, list[str]] = {}
    for meta in soup.find_all("meta"):
        key = meta.get("property") or meta.get("name") or meta.get("itemprop")
        content = meta.get("content")
        if not key or not content:
            continue
        normalized = str(key).strip().lower()
        values.setdefault(normalized, []).append(str(content).strip())
    return values


def extract_json_ld_source_date(soup: BeautifulSoup) -> SourceDate | None:
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        text = script.string or script.get_text("", strip=True)
        if not text:
            continue
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            continue
        for item in iter_json_ld_items(data):
            item_type = item.get("@type")
            item_types = {item_type.lower()} if isinstance(item_type, str) else {str(value).lower() for value in item_type or []}
            if item_types and not item_types.intersection({"article", "newsarticle", "blogposting", "webpage"}):
                continue
            modified = parse_source_date_value(item.get("dateModified"))
            if modified:
                return SourceDate(modified, "updated")
            published = parse_source_date_value(item.get("datePublished"))
            if published:
                return SourceDate(published, "published")
    return None


def iter_json_ld_items(data):
    if isinstance(data, list):
        for item in data:
            yield from iter_json_ld_items(item)
    elif isinstance(data, dict):
        graph = data.get("@graph")
        if isinstance(graph, list):
            for item in graph:
                yield from iter_json_ld_items(item)
        yield data


def extract_fantasypros_source_date(html: str) -> SourceDate | None:
    match = re.search(r"var\s+ecrData\s*=\s*(\{.*?\});", html, flags=re.DOTALL)
    if not match:
        return None
    try:
        data = json.loads(match.group(1))
    except json.JSONDecodeError:
        return None

    parsed = parse_source_date_value(data.get("last_updated_ts"))
    if parsed:
        return SourceDate(parsed, "updated")

    last_updated = data.get("last_updated")
    year = data.get("year")
    if last_updated and year:
        parsed = parse_source_date_value(f"{last_updated}/{year}")
        if parsed:
            return SourceDate(parsed, "updated")
    return None


def extract_text_source_date(text: str) -> SourceDate | None:
    patterns = (
        (r"\b(?:last\s+updated|updated(?:\s+on)?|as\s+of)\s+([A-Z][a-z]+ \d{1,2}, \d{4})", "updated"),
        (r"\bpublished:?\s+([A-Z][a-z]+ \d{1,2}, \d{4})", "published"),
    )
    for pattern, kind in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if not match:
            continue
        parsed = parse_source_date_value(match.group(1))
        if parsed:
            return SourceDate(parsed, kind)
    return None


def parse_source_date_value(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None

    if re.fullmatch(r"\d{10,13}", text):
        timestamp = int(text)
        if len(text) == 13:
            timestamp = int(timestamp / 1000)
        try:
            parsed = datetime.fromtimestamp(timestamp, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            parsed = None
        if parsed and 2000 <= parsed.year <= 2100:
            return parsed.date().isoformat()

    iso_text = text.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(iso_text).date().isoformat()
    except ValueError:
        pass

    try:
        parsed_email_date = parsedate_to_datetime(text)
        if parsed_email_date:
            return parsed_email_date.date().isoformat()
    except (TypeError, ValueError, IndexError, OverflowError):
        pass

    text = re.sub(r"(\d+)(st|nd|rd|th)", r"\1", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+", " ", text)
    formats = ("%B %d, %Y", "%b %d, %Y", "%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d", "%Y/%m/%d")
    for fmt in formats:
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue

    month_match = re.search(
        r"\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b",
        text,
    )
    if month_match:
        return parse_source_date_value(month_match.group(0))

    iso_match = re.search(r"\b\d{4}-\d{2}-\d{2}\b", text)
    if iso_match:
        return iso_match.group(0)

    return None


def parse_html_rankings(html: str, rank_header_aliases: Iterable[str] = ()) -> list[RankingEntry]:
    soup = BeautifulSoup(html, "lxml")
    candidates: list[RankingEntry] = []
    for table in soup.find_all("table"):
        entries = parse_table(table, rank_header_aliases=rank_header_aliases)
        if len(entries) > len(candidates):
            candidates = entries
    if not candidates:
        raise ScrapeError("No ranking table with rank and player columns was found.")
    return candidates


def parse_table(table, rank_header_aliases: Iterable[str] = ()) -> list[RankingEntry]:
    rows = table.find_all("tr")
    if not rows:
        return []

    rank_headers = {normalize_header(alias) for alias in rank_header_aliases}
    is_source_rank_header = lambda value: is_rank_header(value) or value in rank_headers

    headers: list[str] = []
    body_rows = rows
    for index, row in enumerate(rows[:3]):
        cells = row.find_all(["th", "td"])
        candidate = [normalize_header(cell.get_text(" ", strip=True)) for cell in cells]
        if any(is_source_rank_header(value) for value in candidate) and any(is_player_header(value) for value in candidate):
            headers = candidate
            body_rows = rows[index + 1 :]
            break

    if not headers:
        return []

    rank_idx = first_index(headers, is_source_rank_header)
    player_idx = first_index(headers, is_player_header)
    team_idx = first_index(headers, lambda value: value in {"team", "tm", "org", "organization"})
    pos_idx = first_index(
        headers,
        lambda value: value
        in {"pos", "position", "positions", "elig pos", "eligible pos", "eligible position", "other elig pos"},
    )
    age_idx = first_index(headers, lambda value: value == "age")
    if rank_idx is None or player_idx is None:
        return []

    entries: list[RankingEntry] = []
    for row in body_rows:
        cells = row.find_all(["td", "th"])
        if len(cells) <= max(rank_idx, player_idx):
            continue
        values = [cell.get_text(" ", strip=True) for cell in cells]
        rank = parse_rank(values[rank_idx])
        player_name = clean_player_name(values[player_idx])
        if rank is None or not player_name:
            continue
        entries.append(
            RankingEntry(
                rank=rank,
                player_name=player_name,
                team=value_at(values, team_idx),
                positions=value_at(values, pos_idx),
                age=parse_float(value_at(values, age_idx)),
            )
        )
    return dedupe_entries(entries)


def parse_fantasypros_ecr(html: str) -> list[RankingEntry]:
    match = re.search(r"var\s+ecrData\s*=\s*(\{.*?\});", html, flags=re.DOTALL)
    if not match:
        raise ScrapeError("FantasyPros ECR payload was not found.")
    data = json.loads(match.group(1))
    players = data.get("players", [])
    entries: list[RankingEntry] = []
    for player in players:
        rank = parse_rank(str(player.get("rank_ecr", "")))
        name = clean_player_name(str(player.get("player_name", "")))
        if rank is None or not name:
            continue
        entries.append(
            RankingEntry(
                rank=rank,
                player_name=name,
                team=blank_to_none(player.get("player_team_id")),
                positions=blank_to_none(player.get("player_positions") or player.get("position_id")),
                age=parse_float(player.get("player_age")),
            )
        )
    if not entries:
        raise ScrapeError("FantasyPros ECR payload did not contain player rankings.")
    return dedupe_entries(entries)


def parse_fanranked_dynasty(data) -> list[RankingEntry]:
    if not isinstance(data, list):
        raise ScrapeError("FanRanked player payload was not a list.")

    entries: list[RankingEntry] = []
    for player in data:
        if not isinstance(player, dict):
            continue
        rank = parse_rank(player.get("dynastyRank") or player.get("consensusRank") or player.get("rank"))
        name = clean_ranked_name(player.get("name"), player.get("positions"))
        if rank is None or not name:
            continue
        entries.append(
            RankingEntry(
                rank=rank,
                player_name=name,
                team=blank_to_none(player.get("team")),
                positions=join_positions(player.get("positions")),
                age=parse_float(player.get("age")),
            )
        )
    if not entries:
        raise ScrapeError("FanRanked payload did not contain player rankings.")
    return dedupe_entries(entries)


def parse_harry_knows_ball_rankings(html: str) -> list[RankingEntry]:
    soup = BeautifulSoup(html, "lxml")
    script = soup.find("script", id="__NEXT_DATA__", type="application/json")
    if not script or not script.string:
        raise ScrapeError("HarryKnowsBall ranking payload was not found.")

    data = json.loads(script.string)
    players = data.get("props", {}).get("pageProps", {}).get("players", [])
    if not isinstance(players, list):
        raise ScrapeError("HarryKnowsBall player payload was not a list.")

    entries: list[RankingEntry] = []
    for player in players:
        if not isinstance(player, dict):
            continue
        if player.get("assetType") and player.get("assetType") != "PLAYER":
            continue
        rank = parse_rank(player.get("rank"))
        name = clean_player_name(str(player.get("name", "")))
        if rank is None or not name:
            continue
        entries.append(
            RankingEntry(
                rank=rank,
                player_name=name,
                team=blank_to_none(player.get("team")),
                positions=join_positions(player.get("positions")),
                age=parse_float(player.get("age")),
            )
        )
    if not entries:
        raise ScrapeError("HarryKnowsBall payload did not contain player rankings.")
    return dedupe_entries(entries)


def parse_dynatyze_mlb_rankings(html: str) -> list[RankingEntry]:
    soup = BeautifulSoup(html, "lxml")
    ranking_section = soup.find(id="mlb-rankings-ssr") or soup

    entries: list[RankingEntry] = []
    for row in ranking_section.select("ol li"):
        link = row.find("a", href=re.compile(r"/baseball/players/\d+"))
        if not link:
            continue

        spans = [span.get_text(" ", strip=True) for span in row.find_all("span")]
        rank = parse_rank(spans[0] if spans else None)
        player_name = clean_player_name(link.get_text(" ", strip=True))
        if rank is None or not player_name or is_draft_pick_asset(player_name):
            continue

        entries.append(
            RankingEntry(
                rank=rank,
                player_name=player_name,
                positions=value_at(spans, 1),
                team=value_at(spans, 2),
            )
        )

    if not entries:
        raise ScrapeError("Dynatyze ranking list did not contain player rankings.")
    return dedupe_entries(entries)


def parse_ben_rosener_datawrapper_rankings(html: str) -> list[RankingEntry]:
    datawrapper_url = extract_datawrapper_url(html)
    if not datawrapper_url:
        raise ScrapeError("Ben Rosener Datawrapper embed was not found.")
    return parse_ben_rosener_datawrapper_csv(fetch_text(urljoin(datawrapper_url, "data.csv")))


def extract_datawrapper_url(html: str) -> str | None:
    match = re.search(r"https://datawrapper\.dwcdn\.net/[A-Za-z0-9]+/\d+/", html)
    return match.group(0) if match else None


def parse_ben_rosener_datawrapper_csv(csv_text: str) -> list[RankingEntry]:
    stream = io.StringIO(csv_text.strip())
    reader = csv.DictReader(stream)
    if not reader.fieldnames:
        raise ScrapeError("Ben Rosener Datawrapper CSV did not contain a header row.")

    header_map = {normalize_header(header): header for header in reader.fieldnames}
    player_header = find_header(header_map, ("dynasty", "player", "name", "player name"))
    if not player_header:
        raise ScrapeError("Ben Rosener Datawrapper CSV did not contain a player column.")

    entries: list[RankingEntry] = []
    for rank, row in enumerate(reader, start=1):
        player_name = clean_player_name(row.get(player_header, ""))
        if not player_name or is_draft_pick_asset(player_name):
            continue
        entries.append(RankingEntry(rank=rank, player_name=player_name))

    if not entries:
        raise ScrapeError("Ben Rosener Datawrapper CSV did not contain player rankings.")
    return dedupe_entries(entries)


def parse_csv_import(csv_text: str) -> list[RankingEntry]:
    stream = io.StringIO(csv_text.strip())
    sample = stream.read(4096)
    stream.seek(0)
    dialect = csv.Sniffer().sniff(sample, delimiters=",\t;|") if sample else csv.excel
    reader = csv.DictReader(stream, dialect=dialect)
    if not reader.fieldnames:
        raise ScrapeError("CSV import needs a header row.")

    header_map = {normalize_header(header): header for header in reader.fieldnames}
    rank_header = find_header(header_map, ("rank", "ranking", "overall rank", "may rank"))
    player_header = find_header(header_map, ("player", "name", "player name"))
    team_header = find_header(header_map, ("team", "tm", "org", "organization"))
    position_header = find_header(header_map, ("pos", "position", "positions"))
    age_header = find_header(header_map, ("age",))

    if not rank_header or not player_header:
        raise ScrapeError("CSV import requires rank and player/name columns.")

    entries: list[RankingEntry] = []
    for row in reader:
        rank = parse_rank(row.get(rank_header, ""))
        name = clean_player_name(row.get(player_header, ""))
        if rank is None or not name:
            continue
        entries.append(
            RankingEntry(
                rank=rank,
                player_name=name,
                team=blank_to_none(row.get(team_header)) if team_header else None,
                positions=blank_to_none(row.get(position_header)) if position_header else None,
                age=parse_float(row.get(age_header)) if age_header else None,
            )
        )
    if not entries:
        raise ScrapeError("CSV import did not contain any valid ranking rows.")
    return dedupe_entries(entries)


def normalize_header(value: str) -> str:
    value = value.replace("\xa0", " ").strip().lower()
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return " ".join(value.split())


def is_rank_header(value: str) -> bool:
    return value in {"rank", "ranking", "may rank", "overall rank", "ecr", "rk"}


def is_player_header(value: str) -> bool:
    return value in {"player", "name", "player name"}


def first_index(values: list[str], predicate) -> int | None:
    for index, value in enumerate(values):
        if predicate(value):
            return index
    return None


def parse_rank(value: str | int | float | None) -> int | None:
    if value is None:
        return None
    match = re.search(r"\d+", str(value).replace(",", ""))
    if not match:
        return None
    rank = int(match.group(0))
    return rank if rank > 0 else None


def parse_float(value: object) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def clean_ranked_name(value: object, positions: object = None) -> str:
    name = clean_player_name(str(value or ""))
    if not name:
        return ""
    position_values = positions if isinstance(positions, list) else []
    if len(position_values) == 1:
        position = str(position_values[0]).upper()
        if position in {"C", "1B", "2B", "3B", "SS", "OF", "SP", "RP", "DH", "UT"}:
            name = re.sub(rf"\s+{re.escape(position)}$", "", name, flags=re.IGNORECASE)
    return name


def join_positions(value: object) -> str | None:
    if isinstance(value, list):
        positions = [str(item).strip() for item in value if str(item).strip()]
        return "/".join(positions) if positions else None
    return blank_to_none(value)


def is_draft_pick_asset(player_name: str) -> bool:
    return bool(re.search(r"\b20\d{2}\s+(early|mid|late)\s+\d+(st|nd|rd|th)\b", player_name, flags=re.IGNORECASE))


def value_at(values: list[str], index: int | None) -> str | None:
    if index is None or index >= len(values):
        return None
    return blank_to_none(values[index])


def blank_to_none(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def find_header(header_map: dict[str, str], candidates: Iterable[str]) -> str | None:
    for candidate in candidates:
        if candidate in header_map:
            return header_map[candidate]
    return None


def dedupe_entries(entries: list[RankingEntry]) -> list[RankingEntry]:
    seen_names: set[str] = set()
    deduped: list[RankingEntry] = []
    for entry in sorted(entries, key=lambda item: item.rank):
        key = clean_player_name(entry.player_name).lower()
        if key in seen_names:
            continue
        seen_names.add(key)
        deduped.append(entry)
    return deduped
