from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from .player_keys import clean_player_name, normalize_player_key
from .scrapers import ScrapeError, blank_to_none, fetch_html, fetch_json, fetch_text, parse_float


@dataclass(frozen=True)
class OttoneuRosterEntry:
    section: str
    ottoneu_player_id: int | None
    player_name: str
    player_key: str
    mlb_team: str | None
    status: str | None
    salary: int
    positions: str | None
    games: int | None = None
    plate_appearances: int | None = None
    games_started: int | None = None
    innings_pitched: float | None = None
    points_per_game: float | None = None
    points_per_ip: float | None = None
    points: float | None = None


@dataclass(frozen=True)
class OttoneuCapPenalty:
    player_name: str
    player_key: str
    penalty: int
    cut_date: str | None


@dataclass(frozen=True)
class OttoneuLoan:
    direction: str
    counterparty: str
    amount: int


@dataclass(frozen=True)
class OttoneuTradeBlockItem:
    side: str
    player_name: str
    player_key: str
    positions: str | None
    salary: int | None


@dataclass(frozen=True)
class OttoneuTeamSnapshot:
    team_uid: str
    platform: str
    league_id: int
    team_id: int
    league_name: str | None
    team_name: str
    owner: str | None
    url: str
    roster_count: int | None
    roster_limit: int | None
    cap_used: int | None
    cap_limit: int | None
    salary_total: int | None
    penalty_total: int | None
    loans_in: int | None
    loans_out: int | None
    standings_rank: str | None
    points: float | None
    last_transaction: str | None
    trade_block_updated: str | None
    trade_block_note: str | None
    roster: list[OttoneuRosterEntry] = field(default_factory=list)
    penalties: list[OttoneuCapPenalty] = field(default_factory=list)
    loans: list[OttoneuLoan] = field(default_factory=list)
    trade_block: list[OttoneuTradeBlockItem] = field(default_factory=list)


@dataclass(frozen=True)
class OttoneuLeagueTeam:
    team_uid: str
    league_id: int
    team_id: int
    team_name: str
    url: str
    standings_rank: int | None
    points: float | None
    change: float | None


@dataclass(frozen=True)
class OttoneuMarketEntry:
    """A player listed on the league home page as available to acquire.

    ``market`` is "auction" or "waiver". ``amount`` is the minimum bid for an auction and
    the salary you assume for a waiver claim, so both answer "what does this cost me".
    """

    market: str
    ottoneu_player_id: int | None
    player_name: str
    player_key: str
    mlb_team: str | None
    positions: str | None
    handedness: str | None
    status: str | None
    amount: int | None
    deadline_text: str | None
    cut_by: str | None = None


@dataclass(frozen=True)
class OttoneuLeagueSnapshot:
    league_uid: str
    platform: str
    league_id: int
    league_name: str
    url: str
    teams: list[OttoneuLeagueTeam] = field(default_factory=list)
    auctions: list[OttoneuMarketEntry] = field(default_factory=list)
    waivers: list[OttoneuMarketEntry] = field(default_factory=list)

@dataclass(frozen=True)
class OttoneuLeagueDirectoryEntry:
    league_id: int
    league_name: str
    game_type: str
    opl_valid: bool
    created_by: str


def scrape_ottoneu_team(url: str) -> OttoneuTeamSnapshot:
    league_id, team_id = parse_ottoneu_team_url(url)
    canonical_url = f"https://ottoneu.fangraphs.com/{league_id}/team/{team_id}"
    html = fetch_html(canonical_url)
    return parse_ottoneu_team(html, canonical_url, league_id=league_id, team_id=team_id)


def scrape_ottoneu_league(url: str) -> OttoneuLeagueSnapshot:
    league_id = parse_ottoneu_league_url(url)
    canonical_url = f"https://ottoneu.fangraphs.com/{league_id}/home"
    html = fetch_html(canonical_url)
    return parse_ottoneu_league(html, canonical_url, league_id=league_id)

def scrape_ottoneu_league_directory() -> list[OttoneuLeagueDirectoryEntry]:
    return parse_ottoneu_league_directory(fetch_json("https://ottoneu.fangraphs.com/ajax/browseleagues"))


def scrape_ottoneu_roster_export_salaries(league_id: int) -> list[float]:
    csv_text = fetch_text(f"https://ottoneu.fangraphs.com/{league_id}/rosterexport?csv=1")
    return parse_ottoneu_roster_export_salaries(csv_text)


def parse_ottoneu_league_directory(payload: object) -> list[OttoneuLeagueDirectoryEntry]:
    if not isinstance(payload, list):
        raise ScrapeError("Ottoneu league directory returned an unexpected payload.")
    leagues: list[OttoneuLeagueDirectoryEntry] = []
    for row in payload:
        if not isinstance(row, dict):
            continue
        try:
            league_id = int(row.get("ID") or 0)
        except (TypeError, ValueError):
            continue
        league_name = str(row.get("LeagueName") or "").strip()
        if league_id < 1 or not league_name:
            continue
        leagues.append(
            OttoneuLeagueDirectoryEntry(
                league_id=league_id,
                league_name=league_name,
                game_type=str(row.get("GameType") or "Unknown").strip(),
                opl_valid=bool(row.get("OPLValid")),
                created_by=str(row.get("CreatedBy") or "").strip(),
            )
        )
    if not leagues:
        raise ScrapeError("No Ottoneu leagues were found in the public directory.")
    return leagues


def parse_ottoneu_roster_export_salaries(csv_text: str) -> list[float]:
    reader = csv.DictReader(io.StringIO(csv_text.lstrip("\ufeff")))
    if not reader.fieldnames or "Salary" not in reader.fieldnames:
        raise ScrapeError("Ottoneu roster export did not contain a Salary column.")
    salaries: list[float] = []
    for row in reader:
        value = str(row.get("Salary") or "").strip().replace("$", "").replace(",", "")
        try:
            salary = float(value)
        except ValueError:
            continue
        if salary >= 0:
            salaries.append(salary)
    if not salaries:
        raise ScrapeError("Ottoneu roster export did not contain salary rows.")
    return salaries


def parse_ottoneu_team(html: str, url: str, *, league_id: int, team_id: int) -> OttoneuTeamSnapshot:
    soup = BeautifulSoup(html, "lxml")
    title_parts = [part.strip() for part in (soup.title.get_text(" ", strip=True) if soup.title else "").split(" - ")]
    league_name = title_parts[-2] if len(title_parts) >= 2 else None
    team_name = selected_team_name(soup) or (title_parts[-1] if title_parts else f"Team {team_id}")
    owner = parse_owner(soup)

    roster_count, roster_limit = parse_pair(section_value_after_heading(soup, "Roster"))
    cap_used, cap_limit = parse_pair(section_value_after_heading(soup, "Cap"))
    salary_total, penalty_total = parse_cap_used(section_value_after_heading(soup, "Cap Used"))
    loans_in, loans_out = parse_salary_cap(section_value_after_heading(soup, "Salary Cap"))

    snapshot = OttoneuTeamSnapshot(
        team_uid=f"ottoneu:{league_id}:{team_id}",
        platform="ottoneu",
        league_id=league_id,
        team_id=team_id,
        league_name=league_name,
        team_name=team_name,
        owner=owner,
        url=url,
        roster_count=roster_count,
        roster_limit=roster_limit,
        cap_used=cap_used,
        cap_limit=cap_limit,
        salary_total=salary_total,
        penalty_total=penalty_total,
        loans_in=loans_in,
        loans_out=loans_out,
        standings_rank=section_value_after_heading(soup, "Rank"),
        points=parse_float(section_value_after_heading(soup, "Points")),
        last_transaction=section_value_after_heading(soup, "Last Transaction"),
        trade_block_updated=parse_trade_block_updated(soup),
        trade_block_note=parse_trade_block_note(soup),
        roster=parse_roster(soup),
        penalties=parse_cap_penalties(soup),
        loans=parse_loans(soup),
        trade_block=parse_trade_block(soup),
    )
    if not snapshot.roster:
        raise ScrapeError("No Ottoneu roster rows were found.")
    return snapshot


def parse_ottoneu_league(html: str, url: str, *, league_id: int) -> OttoneuLeagueSnapshot:
    soup = BeautifulSoup(html, "lxml")
    title_parts = [part.strip() for part in (soup.title.get_text(" ", strip=True) if soup.title else "").split(" - ")]
    league_name = title_parts[-1] if title_parts else f"League {league_id}"
    teams = parse_standings_teams(soup, league_id)
    if not teams:
        raise ScrapeError("No Ottoneu standings team links were found.")
    return OttoneuLeagueSnapshot(
        league_uid=f"ottoneu:{league_id}",
        platform="ottoneu",
        league_id=league_id,
        league_name=league_name,
        url=url,
        auctions=parse_league_auctions(soup),
        waivers=parse_league_waivers(soup),
        teams=teams,
    )


# Position tokens Ottoneu prints in the player bio line, used to tell a bio that leads with an
# MLB team ("MIN SP/RP R") from one that leads straight into positions.
POSITION_TOKENS = {
    "C", "1B", "2B", "3B", "SS", "OF", "LF", "CF", "RF", "MI", "CI",
    "UTIL", "DH", "SP", "RP", "P",
}
HANDEDNESS_TOKENS = {"R", "L", "S", "B"}


def parse_league_auctions(soup: BeautifulSoup) -> list[OttoneuMarketEntry]:
    """Current Auctions: Name | End Time | Min. Bid."""
    return parse_league_market_table(
        table_after_heading(soup, "Current Auctions"),
        market="auction",
        amount_index=2,
        deadline_index=1,
    )


def parse_league_waivers(soup: BeautifulSoup) -> list[OttoneuMarketEntry]:
    """Players on Waivers: Name | Cut By | Claim Deadline | Salary."""
    return parse_league_market_table(
        table_after_heading(soup, "Players on Waivers"),
        market="waiver",
        amount_index=3,
        deadline_index=2,
        cut_by_index=1,
    )


def parse_league_market_table(
    table,
    *,
    market: str,
    amount_index: int,
    deadline_index: int,
    cut_by_index: int | None = None,
) -> list[OttoneuMarketEntry]:
    if table is None:
        return []
    entries: list[OttoneuMarketEntry] = []
    needed = max(amount_index, deadline_index, cut_by_index or 0)
    for row in table.find_all("tr"):
        cells = row.find_all("td")
        # An empty market renders one full-width "There are no players..." cell.
        if len(cells) <= needed:
            continue
        player = parse_market_player_cell(cells[0])
        if player is None:
            continue
        entries.append(
            OttoneuMarketEntry(
                market=market,
                amount=parse_money(cells[amount_index].get_text(" ", strip=True)),
                cut_by=blank_to_none(cells[cut_by_index].get_text(" ", strip=True)) if cut_by_index else None,
                deadline_text=blank_to_none(cells[deadline_index].get_text(" ", strip=True)),
                **player,
            )
        )
    return entries


def parse_market_player_cell(cell) -> dict | None:
    """Pull the player out of a market table's name cell.

    The cell holds a link to the player page plus a bio span such as "MIN SP/RP R"
    (non-breaking spaces), and optionally an injury span like "60IL".
    """
    link = cell.find("a", href=re.compile(r"/players/\d+"))
    player_name = clean_player_name(link.get_text(" ", strip=True) if link else "")
    if not player_name:
        return None
    bio_span = cell.find("span", class_=lambda value: value and "strong" in value.split())
    status_span = cell.find("span", class_=lambda value: value and "morered" in value.split())
    mlb_team, positions, handedness = parse_player_bio(bio_span.get_text(" ", strip=True) if bio_span else "")
    return {
        "handedness": handedness,
        "mlb_team": mlb_team,
        "ottoneu_player_id": parse_player_id(link.get("href", "")) if link else None,
        "player_key": normalize_player_key(player_name),
        "player_name": player_name,
        "positions": positions,
        "status": blank_to_none(status_span.get_text(" ", strip=True)) if status_span else None,
    }


def parse_player_bio(text: str) -> tuple[str | None, str | None, str | None]:
    """Split "MIN SP/RP R" into team, positions, and handedness.

    Read from the outside in rather than by position, because a player without an MLB team
    leads with positions and one without a listed hand ends with them.
    """
    tokens = [token for token in re.split(r"[\s ]+", text or "") if token]
    handedness = tokens.pop() if tokens and tokens[-1].upper() in HANDEDNESS_TOKENS else None
    mlb_team = tokens.pop(0) if tokens and not looks_like_positions(tokens[0]) else None
    positions = " ".join(tokens) or None
    return mlb_team, positions, handedness


def looks_like_positions(token: str) -> bool:
    parts = [part.strip().upper() for part in token.split("/") if part.strip()]
    return bool(parts) and all(part in POSITION_TOKENS for part in parts)


def parse_ottoneu_team_url(url: str) -> tuple[int, int]:
    parsed = urlparse(url)
    if parsed.netloc not in {"ottoneu.fangraphs.com", "www.ottoneu.fangraphs.com"}:
        raise ScrapeError("Use an Ottoneu team URL from ottoneu.fangraphs.com.")
    match = re.fullmatch(r"/(\d+)/team/(\d+)/?", parsed.path)
    if not match:
        raise ScrapeError("Ottoneu team URL should look like https://ottoneu.fangraphs.com/{league}/team/{team}.")
    return int(match.group(1)), int(match.group(2))


def parse_ottoneu_league_url(url: str) -> int:
    parsed = urlparse(url)
    if parsed.netloc not in {"ottoneu.fangraphs.com", "www.ottoneu.fangraphs.com"}:
        raise ScrapeError("Use an Ottoneu league URL from ottoneu.fangraphs.com.")
    match = re.fullmatch(r"/(\d+)/(?:home)?/?", parsed.path)
    if not match:
        raise ScrapeError("Ottoneu league URL should look like https://ottoneu.fangraphs.com/{league}/home.")
    return int(match.group(1))


def parse_standings_teams(soup: BeautifulSoup, league_id: int) -> list[OttoneuLeagueTeam]:
    table = soup.find("table", class_=lambda value: value and "trophy_case" in value.split())
    if not table:
        return []
    teams: list[OttoneuLeagueTeam] = []
    for index, row in enumerate(table.find_all("tr")[1:], start=1):
        cells = row.find_all("td")
        if len(cells) < 3:
            continue
        link = cells[0].find("a", href=re.compile(r"/team/\d+"))
        if not link:
            continue
        team_name = link.get_text(" ", strip=True)
        team_url = urljoin(f"https://ottoneu.fangraphs.com/{league_id}/home", link.get("href", ""))
        _, team_id = parse_ottoneu_team_url(team_url)
        teams.append(
            OttoneuLeagueTeam(
                team_uid=f"ottoneu:{league_id}:{team_id}",
                league_id=league_id,
                team_id=team_id,
                team_name=team_name,
                url=team_url,
                standings_rank=index,
                points=parse_float(cells[1].get_text(" ", strip=True)),
                change=parse_float(cells[2].get_text(" ", strip=True)),
            )
        )
    return teams


def parse_roster(soup: BeautifulSoup) -> list[OttoneuRosterEntry]:
    roster: list[OttoneuRosterEntry] = []
    hitters_table = soup.find("table", id="hitters")
    pitchers_table = soup.find("table", id="pitchers")
    if hitters_table:
        roster.extend(parse_roster_table(hitters_table, "hitter"))
    if pitchers_table:
        roster.extend(parse_roster_table(pitchers_table, "pitcher"))
    return roster


def parse_roster_table(table, section: str) -> list[OttoneuRosterEntry]:
    entries: list[OttoneuRosterEntry] = []
    for row in table.find_all("tr")[1:]:
        cells = row.find_all("td")
        expected_cells = 7 if section == "hitter" else 8
        if len(cells) < 4:
            continue
        player_cell = cells[0]
        player_link = player_cell.find("a", href=re.compile(r"/players/\d+"))
        player_name = clean_player_name(player_link.get_text(" ", strip=True) if player_link else "")
        if not player_name:
            continue
        team_span = player_cell.find("span", class_=lambda value: value and "strong" in value.split())
        status_span = player_cell.find("span", class_=lambda value: value and "morered" in value.split())
        player_id = parse_player_id(player_link.get("href", "")) if player_link else None
        values = [cell.get_text(" ", strip=True) for cell in cells]
        common = {
            "section": section,
            "ottoneu_player_id": player_id,
            "player_name": player_name,
            "player_key": normalize_player_key(player_name),
            "mlb_team": blank_to_none(team_span.get_text(" ", strip=True)) if team_span else None,
            "status": blank_to_none(status_span.get_text(" ", strip=True)) if status_span else None,
            "salary": parse_money(values[1]) or 0,
            "positions": blank_to_none(values[2]),
            "games": parse_int(values[3]),
        }
        if len(cells) < expected_cells or values[-1] == "Not Available":
            common["games"] = None
            entries.append(OttoneuRosterEntry(**common))
            continue
        if section == "hitter":
            entries.append(
                OttoneuRosterEntry(
                    **common,
                    plate_appearances=parse_int(values[4]),
                    points_per_game=parse_float(values[5]),
                    points=parse_float(values[6]),
                )
            )
        else:
            entries.append(
                OttoneuRosterEntry(
                    **common,
                    games_started=parse_int(values[4]),
                    innings_pitched=parse_float(values[5]),
                    points_per_ip=parse_float(values[6]),
                    points=parse_float(values[7]),
                )
            )
    return entries


def parse_cap_penalties(soup: BeautifulSoup) -> list[OttoneuCapPenalty]:
    table = soup.find("table", id="cap_penalties")
    if not table:
        return []
    penalties: list[OttoneuCapPenalty] = []
    for row in table.find_all("tr")[1:]:
        cells = [cell.get_text(" ", strip=True) for cell in row.find_all("td")]
        if len(cells) < 2:
            continue
        player_name = clean_player_name(cells[0])
        if not player_name:
            continue
        penalties.append(
            OttoneuCapPenalty(
                player_name=player_name,
                player_key=normalize_player_key(player_name),
                penalty=parse_money(cells[1]) or 0,
                cut_date=blank_to_none(cells[2]) if len(cells) > 2 else None,
            )
        )
    return penalties


def parse_loans(soup: BeautifulSoup) -> list[OttoneuLoan]:
    loans: list[OttoneuLoan] = []
    for heading, direction in (("Incoming Loans", "in"), ("Outgoing Loans", "out")):
        table = table_after_heading(soup, heading)
        if not table:
            continue
        for row in table.find_all("tr")[1:]:
            cells = [cell.get_text(" ", strip=True) for cell in row.find_all("td")]
            if len(cells) < 2 or not cells[0]:
                continue
            loans.append(OttoneuLoan(direction=direction, counterparty=cells[0], amount=parse_money(cells[1]) or 0))
    return loans


def parse_trade_block(soup: BeautifulSoup) -> list[OttoneuTradeBlockItem]:
    section = trade_block_section(soup)
    if not section:
        return []
    items: list[OttoneuTradeBlockItem] = []
    current_side: str | None = None
    for element in section.find_all(["h3", "ul"]):
        label = element.get_text(" ", strip=True).lower()
        if element.name == "h3" and label in {"haves", "needs"}:
            current_side = label[:-1]
        elif element.name == "ul" and current_side:
            for item in element.find_all("li", recursive=False):
                parsed = parse_trade_block_item(item.get_text(" ", strip=True), current_side)
                if parsed:
                    items.append(parsed)
    return items


def parse_trade_block_item(text: str, side: str) -> OttoneuTradeBlockItem | None:
    match = re.match(r"(.+?)\s+([A-Z0-9/]+)\s+\$(\d+)\s*$", text)
    if not match:
        return None
    player_name = clean_player_name(match.group(1))
    return OttoneuTradeBlockItem(
        side=side,
        player_name=player_name,
        player_key=normalize_player_key(player_name),
        positions=match.group(2),
        salary=int(match.group(3)),
    )


def selected_team_name(soup: BeautifulSoup) -> str | None:
    selected = soup.select_one('select[name="team"] option[selected]')
    return blank_to_none(selected.get_text(" ", strip=True)) if selected else None


def parse_owner(soup: BeautifulSoup) -> str | None:
    secondary = soup.find("div", class_=lambda value: value and "page-header__secondary" in value.split())
    if not secondary:
        return None
    owner_heading = secondary.find("h3")
    return blank_to_none(owner_heading.get_text(" ", strip=True)) if owner_heading else None


def section_value_after_heading(soup: BeautifulSoup, heading_text: str) -> str | None:
    heading = soup.find(lambda tag: tag.name in {"h3", "h4"} and tag.get_text(" ", strip=True) == heading_text)
    if not heading:
        return None
    value = heading.find_next_sibling(["h2", "h5"])
    return blank_to_none(value.get_text(" ", strip=True)) if value else None


def table_after_heading(soup: BeautifulSoup, heading_text: str):
    heading = soup.find(lambda tag: tag.name in {"h3", "h4"} and tag.get_text(" ", strip=True) == heading_text)
    return heading.find_next("table") if heading else None


def trade_block_section(soup: BeautifulSoup):
    heading = soup.find(lambda tag: tag.name == "h3" and tag.get_text(" ", strip=True).startswith("Trade Block"))
    return heading.find_parent("section") if heading else None


def parse_trade_block_updated(soup: BeautifulSoup) -> str | None:
    heading = soup.find(lambda tag: tag.name == "h3" and tag.get_text(" ", strip=True).startswith("Trade Block"))
    if not heading:
        return None
    match = re.search(r"Updated on (.+)$", heading.get_text(" ", strip=True))
    return match.group(1) if match else None


def parse_trade_block_note(soup: BeautifulSoup) -> str | None:
    section = trade_block_section(soup)
    if not section:
        return None
    for paragraph in section.find_all("p"):
        text = paragraph.get_text(" ", strip=True)
        if text.startswith("Wanted:"):
            return text
    return None


def parse_salary_cap(text: str | None) -> tuple[int | None, int | None]:
    if not text:
        return None, None
    loans_in_match = re.search(r"\+\s*\$(\d+)\s*\(loans in\)", text)
    loans_out_match = re.search(r"-\s*\$(\d+)\s*\(loans out\)", text)
    return money_group(loans_in_match), money_group(loans_out_match)


def parse_cap_used(text: str | None) -> tuple[int | None, int | None]:
    if not text:
        return None, None
    salary_match = re.search(r"\$(\d+)\s*\(salary\)", text)
    penalty_match = re.search(r"\+\s*\$(\d+)\s*\(cap penalties\)", text)
    return money_group(salary_match), money_group(penalty_match)


def parse_pair(text: str | None) -> tuple[int | None, int | None]:
    if not text:
        return None, None
    match = re.search(r"\$?([\d,]+)\s+of\s+\$?([\d,]+)", text)
    if not match:
        return None, None
    return int(match.group(1).replace(",", "")), int(match.group(2).replace(",", ""))


def money_group(match: re.Match[str] | None) -> int | None:
    return int(match.group(1).replace(",", "")) if match else None


def parse_player_id(href: str) -> int | None:
    match = re.search(r"/players/(\d+)", href)
    return int(match.group(1)) if match else None


def parse_money(value: str | None) -> int | None:
    if value is None:
        return None
    match = re.search(r"\$?(-?\d+)", value.replace(",", ""))
    return int(match.group(1)) if match else None


def parse_int(value: str | None) -> int | None:
    if value is None:
        return None
    match = re.search(r"-?\d+", value.replace(",", ""))
    return int(match.group(0)) if match else None
