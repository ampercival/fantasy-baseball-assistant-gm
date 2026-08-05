import type { AggregateBoard, AggregatePlayer } from "./types";

export function aggregatePlayersToCsv(board: AggregateBoard, players: AggregatePlayer[]) {
  const headers: Array<string | number | null | undefined> = [
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
    ...board.source_groups.map((group) => `${group.source_tag} sub_aggregate_rank`),
    ...board.sources.map((source) => source.short_name)
  ];
  const rows: Array<Array<string | number | null | undefined>> = players.map((player) => [
    player.aggregate_rank,
    player.player_name,
    player.team,
    player.positions,
    player.age,
    player.avg_rank,
    player.median_rank,
    player.best_rank,
    player.worst_rank,
    player.rank_spread,
    player.source_count,
    ...board.source_groups.map((group) => player.group_ranks[group.source_tag]?.aggregate_rank),
    ...board.sources.map((source) => player.source_ranks[source.id]?.rank)
  ]);
  return `\ufeff${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function csvCell(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function downloadCsv(filename: string, csvText: string) {
  const url = URL.createObjectURL(new Blob([csvText], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.download = filename;
  link.href = url;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
