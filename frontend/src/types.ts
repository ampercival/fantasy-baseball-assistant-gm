export type SourceStatus = "success" | "error" | "skipped" | null;
export type SourceTag = "Continuous" | "Updated" | "Old/Pre-season";

export type RankingSource = {
  id: string;
  name: string;
  short_name: string;
  ranking_type: string;
  url: string;
  scraper: string;
  access: string;
  notes: string;
  source_tag: SourceTag;
  included: number;
  can_update: number;
  last_snapshot_id: number | null;
  last_fetched_at: string | null;
  last_status: SourceStatus;
  last_row_count: number | null;
  last_message: string | null;
  last_source_date: string | null;
  last_source_date_kind: string | null;
  correction_count: number;
};

export type BoardSource = RankingSource & {
  snapshot_id: number;
  fetched_at: string;
  row_count: number;
  source_date: string | null;
  source_date_kind: string | null;
};

export type SourceGroup = {
  source_tag: SourceTag;
  source_ids: string[];
  source_count: number;
  row_count: number;
  included: boolean;
};

export type SourceRank = {
  rank: number;
  team: string | null;
  positions: string | null;
  player_name: string;
  raw_player_name: string | null;
  name_corrected: boolean;
};

export type PlayerNameCorrection = {
  id: number;
  source_id: string;
  source_name: string;
  source_short_name: string;
  original_name: string;
  original_player_key: string;
  corrected_name: string;
  corrected_player_key: string;
  created_at: string;
  updated_at: string;
};

export type GroupRank = {
  aggregate_rank: number;
  avg_rank: number;
  median_rank: number;
  source_count: number;
  rank_spread: number;
  avg_percentile: number;
};

export type AggregatePlayer = {
  aggregate_rank: number;
  player_key: string;
  player_name: string;
  team: string | null;
  positions: string | null;
  age: number | null;
  avg_rank: number;
  median_rank: number;
  best_rank: number;
  worst_rank: number;
  rank_spread: number;
  source_count: number;
  rank_stddev: number;
  avg_percentile: number;
  source_ranks: Record<string, SourceRank>;
  group_ranks: Partial<Record<SourceTag, GroupRank>>;
};

export type AggregateBoard = {
  sources: BoardSource[];
  source_groups: SourceGroup[];
  included_source_tags: SourceTag[];
  players: AggregatePlayer[];
};

export type UpdateResult = {
  source_id: string;
  snapshot_id?: number;
  status: "success" | "error" | "skipped";
  row_count: number;
  message: string;
  source_date?: string | null;
  source_date_kind?: string | null;
};

export type FantasyTeam = {
  team_uid: string;
  platform: string;
  league_id: number;
  team_id: number;
  league_name: string | null;
  team_name: string;
  owner: string | null;
  url: string;
  created_at: string;
  updated_at: string;
  last_snapshot_id: number | null;
  last_fetched_at: string | null;
  last_status: SourceStatus;
  last_roster_count: number | null;
  last_roster_limit: number | null;
  last_cap_used: number | null;
  last_cap_limit: number | null;
  last_points: number | null;
  last_message: string | null;
  standings_rank: number | null;
  standings_points: number | null;
  standings_change: number | null;
};

export type TeamSnapshot = {
  id: number;
  team_uid: string;
  fetched_at: string;
  status: "success" | "error";
  roster_count: number | null;
  roster_limit: number | null;
  cap_used: number | null;
  cap_limit: number | null;
  salary_total: number | null;
  penalty_total: number | null;
  loans_in: number | null;
  loans_out: number | null;
  standings_rank: string | null;
  points: number | null;
  last_transaction: string | null;
  trade_block_updated: string | null;
  trade_block_note: string | null;
  message: string;
  source_url: string;
};

export type TeamRosterRanking = {
  aggregate_rank: number;
  avg_rank: number;
  median_rank: number;
  source_count: number;
};

export type TeamRosterEntry = {
  id: number;
  snapshot_id: number;
  team_uid: string;
  section: "hitter" | "pitcher";
  ottoneu_player_id: number | null;
  player_name: string;
  player_key: string;
  mlb_team: string | null;
  status: string | null;
  salary: number;
  positions: string | null;
  games: number | null;
  plate_appearances: number | null;
  games_started: number | null;
  innings_pitched: number | null;
  points_per_game: number | null;
  points_per_ip: number | null;
  points: number | null;
  ranking: TeamRosterRanking | null;
};

export type TeamCapPenalty = {
  id: number;
  snapshot_id: number;
  team_uid: string;
  player_name: string;
  player_key: string;
  penalty: number;
  cut_date: string | null;
};

export type TeamLoan = {
  id: number;
  snapshot_id: number;
  team_uid: string;
  direction: "in" | "out";
  counterparty: string;
  amount: number;
};

export type TeamTradeBlockItem = {
  id: number;
  snapshot_id: number;
  team_uid: string;
  side: "have" | "need";
  player_name: string;
  player_key: string;
  positions: string | null;
  salary: number | null;
};

export type TeamDetail = {
  team: FantasyTeam;
  snapshot: TeamSnapshot | null;
  roster: TeamRosterEntry[];
  penalties: TeamCapPenalty[];
  loans: TeamLoan[];
  trade_block: TeamTradeBlockItem[];
};

export type TeamUpdateResult = {
  team_uid: string;
  snapshot_id: number;
  status: "success" | "error";
  row_count: number;
  message: string;
};

export type FantasyLeague = {
  league_uid: string;
  platform: string;
  league_id: number;
  league_name: string;
  url: string;
  created_at: string;
  updated_at: string;
  team_count: number;
  loaded_team_count: number;
  rostered_player_count: number;
};

export type LeagueTeamMembership = {
  league_uid: string;
  team_uid: string;
  team_name: string;
  team_url: string;
  standings_rank: number | null;
  points: number | null;
  change: number | null;
  updated_at: string;
  owner: string | null;
  last_snapshot_id: number | null;
  last_fetched_at: string | null;
  last_roster_count: number | null;
  last_cap_used: number | null;
  last_cap_limit: number | null;
};

export type LeagueDetail = {
  league: FantasyLeague;
  teams: LeagueTeamMembership[];
};

export type LeagueRosterPlayer = {
  player_key: string;
  player_name: string;
  salary: number;
  positions: string | null;
  status: string | null;
  mlb_team: string | null;
  section: "hitter" | "pitcher";
  games: number | null;
  innings_pitched: number | null;
  points_per_game: number | null;
  points_per_ip: number | null;
  points: number | null;
  league_uid: string;
  team_uid: string;
  team_name: string;
  standings_rank: number | null;
};

export type LeagueTradeBlockPlayer = LeagueRosterPlayer & {
  side: "have" | "need";
};

export type LeagueAvailablePlayerStats = {
  player_key: string;
  player_name: string;
  positions: string | null;
  status: string | null;
  mlb_team: string | null;
  section: "hitter" | "pitcher";
  games: number | null;
  innings_pitched: number | null;
  points_per_game: number | null;
  points_per_ip: number | null;
  points: number | null;
};

export type LeagueValueCurve = {
  parameters: {
    c: number;
    A: number;
    m: number;
    s: number;
    g: number;
    D: number;
    k: number;
  };
  player_count: number;
  rmse: number;
};

export type LeagueRosterMap = {
  league: FantasyLeague;
  players: LeagueRosterPlayer[];
  trade_block: LeagueTradeBlockPlayer[];
  available_player_stats: LeagueAvailablePlayerStats[];
  value_curve: LeagueValueCurve | null;
};

export type LeagueUpdateResult = {
  league_uid: string;
  league_name: string;
  status: "success" | "partial" | "error";
  team_count: number;
  updated_team_count: number;
  error_count: number;
  message: string;
  results: TeamUpdateResult[];
};

export type DeleteResult = {
  team_uid?: string;
  league_uid?: string;
  status: "success";
  message: string;
};

export type LineupDateOption = {
  date: string;
  game_count: number;
  probable_starter_count: number;
  source?: string;
};

export type LineupRecommendationCode =
  | "always-start"
  | "always-sit"
  | "lean-start"
  | "neutral"
  | "lean-sit"
  | "no-xfip"
  | "no-probable"
  | "no-game"
  | "no-mlb-team";

export type LineupRecommendationRow = {
  player_key: string;
  player_name: string;
  positions: string | null;
  mlb_team: string | null;
  status: string | null;
  section: "hitter" | "pitcher";
  salary: number | null;
  points: number | null;
  points_per_game: number | null;
  opponent_team: string | null;
  opponent_name: string | null;
  opposing_pitcher_key: string | null;
  opposing_pitcher_name: string | null;
  opposing_pitcher_xfip_minus: number | null;
  recommendation: string;
  recommendation_code: LineupRecommendationCode;
  always_start: boolean;
  always_sit: boolean;
};

export type LineupUnavailablePlayer = {
  player_key: string;
  player_name: string;
  positions: string | null;
  mlb_team: string | null;
  status: string | null;
  section: "hitter" | "pitcher";
  salary: number | null;
  points: number | null;
  points_per_game: number | null;
  points_per_ip: number | null;
  availability_code: "il" | "minors";
  availability_label: string;
};

export type LineupRecommendationResponse = {
  league: FantasyLeague;
  team_uid: string;
  source: string;
  xfip_refresh?: {
    row_count: number;
    error_count: number;
    message: string;
    errors?: string[];
  };
  date: string;
  game_count: number;
  probable_starter_count: number;
  pitcher_stats_count: number;
  il_players: LineupUnavailablePlayer[];
  minor_league_players: LineupUnavailablePlayer[];
  rows: LineupRecommendationRow[];
};

export type LineupPitcherStatsImportResult = {
  status: "success";
  row_count: number;
  season: number;
  message: string;
};
