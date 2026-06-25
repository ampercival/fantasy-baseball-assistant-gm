from __future__ import annotations

import csv
import io
import statistics
from collections import Counter, defaultdict
from collections.abc import Iterable

from .db import get_connection, latest_successful_snapshot_ids
from .sources import SOURCE_TAGS


def build_aggregate_board(
    exclude_source_ids: set[str] | None = None,
    included_source_tags: Iterable[str] | None = None,
    included_sources_only: bool = True,
) -> dict:
    selected_tags = set(included_source_tags) if included_source_tags is not None else set(SOURCE_TAGS)
    with get_connection() as conn:
        snapshot_ids = latest_successful_snapshot_ids(
            conn,
            exclude_source_ids=exclude_source_ids,
            included_only=included_sources_only,
        )
        if not snapshot_ids:
            return {
                "sources": [],
                "source_groups": [],
                "included_source_tags": ordered_tags(selected_tags),
                "players": [],
            }

        placeholders = ",".join("?" for _ in snapshot_ids)
        sources = [
            dict(row)
            for row in conn.execute(
                f"""
                SELECT
                    s.*,
                    snap.id AS snapshot_id,
                    snap.fetched_at,
                    snap.row_count,
                    snap.source_date,
                    snap.source_date_kind
                FROM snapshots snap
                JOIN sources s ON s.id = snap.source_id
                WHERE snap.id IN ({placeholders})
                ORDER BY s.name, s.ranking_type
                """,
                snapshot_ids,
            ).fetchall()
        ]
        rows = conn.execute(
            f"""
            SELECT
                e.*,
                s.short_name,
                s.source_tag,
                c.id AS correction_id,
                c.corrected_name,
                c.corrected_player_key
            FROM ranking_entries e
            JOIN sources s ON s.id = e.source_id
            LEFT JOIN player_name_corrections c
                ON c.source_id = e.source_id
                AND c.original_player_key = e.player_key
            WHERE e.snapshot_id IN ({placeholders})
            ORDER BY e.rank
            """,
            snapshot_ids,
        ).fetchall()

    source_lengths = {source["id"]: int(source["row_count"]) for source in sources}
    source_tags = {source["id"]: source["source_tag"] for source in sources}
    grouped: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        entry = effective_entry(dict(row))
        entry["source_tag"] = source_tags.get(entry["source_id"], entry["source_tag"])
        append_grouped_entry(grouped, entry)

    group_rank_lookup = build_group_rank_lookup(grouped, source_lengths)

    players: list[dict] = []
    for player_key, entries in grouped.items():
        ranking_entries = [entry for entry in entries if entry["source_tag"] in selected_tags]
        if not ranking_entries:
            continue
        player = summarize_rank_entries(player_key, ranking_entries, source_lengths)
        player.update(display_fields(player_key, entries))
        player["group_ranks"] = {
            tag: group_players[player_key]
            for tag, group_players in group_rank_lookup.items()
            if player_key in group_players
        }
        players.append(player)

    players.sort(key=rank_sort_key)
    for index, player in enumerate(players, start=1):
        player["aggregate_rank"] = index

    return {
        "sources": sources,
        "source_groups": build_source_groups(sources, selected_tags),
        "included_source_tags": ordered_tags(selected_tags),
        "players": players,
    }


def effective_entry(entry: dict) -> dict:
    corrected_name = entry.pop("corrected_name", None)
    corrected_player_key = entry.pop("corrected_player_key", None)
    if corrected_name and corrected_player_key:
        entry["raw_player_name"] = entry["player_name"]
        entry["raw_player_key"] = entry["player_key"]
        entry["player_name"] = corrected_name
        entry["player_key"] = corrected_player_key
        entry["name_corrected"] = True
    else:
        entry["raw_player_name"] = None
        entry["raw_player_key"] = None
        entry["name_corrected"] = False
    return entry


def append_grouped_entry(grouped: dict[str, list[dict]], entry: dict) -> None:
    entries = grouped.setdefault(entry["player_key"], [])
    for index, existing in enumerate(entries):
        if existing["source_id"] == entry["source_id"]:
            if int(entry["rank"]) < int(existing["rank"]):
                entries[index] = entry
            return
    entries.append(entry)


def build_group_rank_lookup(grouped: dict[str, list[dict]], source_lengths: dict[str, int]) -> dict[str, dict[str, dict]]:
    group_summaries: dict[str, list[dict]] = defaultdict(list)
    for player_key, entries in grouped.items():
        entries_by_tag: dict[str, list[dict]] = defaultdict(list)
        for entry in entries:
            entries_by_tag[entry["source_tag"]].append(entry)
        for source_tag, tag_entries in entries_by_tag.items():
            summary = summarize_rank_entries(player_key, tag_entries, source_lengths)
            summary.update(display_fields(player_key, tag_entries, include_source_ranks=False))
            group_summaries[source_tag].append(summary)

    lookup: dict[str, dict[str, dict]] = {}
    for source_tag, summaries in group_summaries.items():
        summaries.sort(key=rank_sort_key)
        lookup[source_tag] = {}
        for index, summary in enumerate(summaries, start=1):
            lookup[source_tag][summary["player_key"]] = {
                "aggregate_rank": index,
                "avg_rank": summary["avg_rank"],
                "median_rank": summary["median_rank"],
                "source_count": summary["source_count"],
                "rank_spread": summary["rank_spread"],
                "avg_percentile": summary["avg_percentile"],
            }
    return lookup


def summarize_rank_entries(player_key: str, entries: list[dict], source_lengths: dict[str, int]) -> dict:
    ranks = [int(entry["rank"]) for entry in entries]
    normalized = [
        int(entry["rank"]) / max(1, source_lengths.get(entry["source_id"], int(entry["rank"])))
        for entry in entries
    ]
    return {
        "player_key": player_key,
        "avg_rank": round(statistics.fmean(ranks), 1),
        "median_rank": round(statistics.median(ranks), 1),
        "best_rank": min(ranks),
        "worst_rank": max(ranks),
        "rank_spread": max(ranks) - min(ranks),
        "source_count": len(entries),
        "rank_stddev": round(statistics.pstdev(ranks), 1) if len(ranks) > 1 else 0,
        "avg_percentile": round(statistics.fmean(normalized), 4),
    }


def display_fields(player_key: str, entries: list[dict], *, include_source_ranks: bool = True) -> dict:
    names = Counter(entry["player_name"] for entry in entries)
    teams = Counter(entry["team"] for entry in entries if entry["team"])
    positions = Counter(entry["positions"] for entry in entries if entry["positions"])
    ages = [float(entry["age"]) for entry in entries if entry["age"] is not None]
    fields = {
        "player_key": player_key,
        "player_name": names.most_common(1)[0][0],
        "team": teams.most_common(1)[0][0] if teams else None,
        "positions": positions.most_common(1)[0][0] if positions else None,
        "age": round(statistics.median(ages), 1) if ages else None,
    }
    if include_source_ranks:
        fields["source_ranks"] = {
            entry["source_id"]: {
                "rank": int(entry["rank"]),
                "team": entry["team"],
                "positions": entry["positions"],
                "player_name": entry["player_name"],
                "raw_player_name": entry.get("raw_player_name"),
                "name_corrected": bool(entry.get("name_corrected")),
            }
            for entry in entries
        }
    return fields


def build_source_groups(sources: list[dict], selected_tags: set[str]) -> list[dict]:
    groups = []
    for source_tag in ordered_tags({source["source_tag"] for source in sources}):
        group_sources = [source for source in sources if source["source_tag"] == source_tag]
        if not group_sources:
            continue
        groups.append(
            {
                "source_tag": source_tag,
                "source_ids": [source["id"] for source in group_sources],
                "source_count": len(group_sources),
                "row_count": sum(int(source["row_count"]) for source in group_sources),
                "included": source_tag in selected_tags,
            }
        )
    return groups


def ordered_tags(tags: Iterable[str]) -> list[str]:
    tag_set = set(tags)
    known = [tag for tag in SOURCE_TAGS if tag in tag_set]
    extra = sorted(tag for tag in tag_set if tag not in SOURCE_TAGS)
    return known + extra


def rank_sort_key(item: dict) -> tuple[float, float, int, str]:
    return (item["avg_rank"], item["avg_percentile"], item["source_count"] * -1, item["player_name"])


def aggregate_to_csv(board: dict) -> str:
    output = io.StringIO()
    sources = board["sources"]
    source_ids = [source["id"] for source in sources]
    source_labels = [source["short_name"] for source in sources]
    group_labels = [group["source_tag"] for group in board.get("source_groups", [])]
    fieldnames = [
        "aggregate_rank",
        "player",
        "team",
        "positions",
        "age",
        "avg_rank",
        "median_rank",
        "best_rank",
        "worst_rank",
        "rank_spread",
        "source_count",
        *[f"{label} sub_aggregate_rank" for label in group_labels],
        *source_labels,
    ]
    writer = csv.DictWriter(output, fieldnames=fieldnames, lineterminator="\n")
    writer.writeheader()
    for player in board["players"]:
        row = {
            "aggregate_rank": player["aggregate_rank"],
            "player": player["player_name"],
            "team": player["team"] or "",
            "positions": player["positions"] or "",
            "age": player["age"] if player["age"] is not None else "",
            "avg_rank": player["avg_rank"],
            "median_rank": player["median_rank"],
            "best_rank": player["best_rank"],
            "worst_rank": player["worst_rank"],
            "rank_spread": player["rank_spread"],
            "source_count": player["source_count"],
        }
        for label in group_labels:
            row[f"{label} sub_aggregate_rank"] = player.get("group_ranks", {}).get(label, {}).get("aggregate_rank", "")
        for source_id, label in zip(source_ids, source_labels):
            rank = player["source_ranks"].get(source_id, {}).get("rank")
            row[label] = rank if rank is not None else ""
        writer.writerow(row)
    return output.getvalue()
