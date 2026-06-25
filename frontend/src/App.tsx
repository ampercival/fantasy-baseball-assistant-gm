import { Fragment, useEffect, useMemo, useState, type UIEvent } from "react";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  Home,
  ArrowLeftRight,
  RefreshCcw,
  Search,
  Tags,
  Trash2,
  Upload,
  Users,
  X
} from "lucide-react";
import type {
  AggregateBoard,
  AggregatePlayer,
  BoardSource,
  DeleteResult,
  FantasyLeague,
  FantasyTeam,
  LeagueAvailablePlayerStats,
  LeagueRosterPlayer,
  LeagueRosterMap,
  LeagueTradeBlockPlayer,
  LeagueUpdateResult,
  LeagueValueCurve,
  LineupDateOption,
  LineupPitcherStatsImportResult,
  LineupRecommendationResponse,
  LineupRecommendationRow,
  LineupUnavailablePlayer,
  PlayerNameCorrection,
  RankingSource,
  SourceTag,
  TeamUpdateResult,
  UpdateResult
} from "./types";

const SOURCE_TAGS: SourceTag[] = ["Continuous", "Updated", "Old/Pre-season"];
const emptyBoard: AggregateBoard = { sources: [], source_groups: [], included_source_tags: [], players: [] };
const TDG_OBP_SOURCE_ID = "tdg_2026_obp_top_500";
const TDG_POINTS_SOURCE_ID = "tdg_2026_points_top_500";
const FANTRAX_ROTO_SOURCE_ID = "fantrax_2026_top_500";
const FANTRAX_POINTS_SOURCE_ID = "fantrax_2026_top_500_points";
const DEFAULT_TEAM_URL = "https://ottoneu.fangraphs.com/1900/team/12519";
const DEFAULT_LEAGUE_URL = "https://ottoneu.fangraphs.com/1900/home";
const DEFAULT_MY_TEAM_UID = "ottoneu:1900:12519";
const AVAILABLE_TEAM_UID = "__available__";
const TRADE_BLOCK_TEAM_UID = "__trade_block__";
const POSITION_FILTERS = ["all", "C", "1B", "2B", "3B", "SS", "OF", "MI", "CI", "UTI", "SP", "RP", "P"] as const;
const ROSTER_TAG_FILTERS = ["all", "IL", "MiLB"] as const;
const HITTER_POSITION_TOKENS = new Set(["C", "1B", "2B", "3B", "SS", "OF", "LF", "CF", "RF", "DH", "UT", "UTL", "UTIL", "UTI"]);
const MINOR_LEVEL_TOKENS = new Set(["A", "A+", "AA", "AAA", "CPX", "ROK"]);
const LINEUP_SLOTS = [
  { id: "C1", label: "C", token: "C" },
  { id: "C2", label: "C", token: "C" },
  { id: "1B", label: "1B", token: "1B" },
  { id: "2B", label: "2B", token: "2B" },
  { id: "SS", label: "SS", token: "SS" },
  { id: "MI", label: "MI", token: "MI" },
  { id: "3B", label: "3B", token: "3B" },
  { id: "OF1", label: "OF", token: "OF" },
  { id: "OF2", label: "OF", token: "OF" },
  { id: "OF3", label: "OF", token: "OF" },
  { id: "OF4", label: "OF", token: "OF" },
  { id: "OF5", label: "OF", token: "OF" },
  { id: "UTIL", label: "UTIL", token: "UTI" }
] as const;
const SOURCE_QUALITY_TOP_RANK = 200;
const RANKING_ROW_HEIGHT = 42;
const RANKING_OVERSCAN_ROWS = 12;
const TRADE_ROW_HEIGHT = 42;
const TRADE_OVERSCAN_ROWS = 10;
const SORT_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

type ActiveTool = "home" | "rankings" | "sources" | "teams" | "trade" | "lineup";
type PositionFilter = (typeof POSITION_FILTERS)[number];
type RosterTagFilter = (typeof ROSTER_TAG_FILTERS)[number];
type LineupSlot = (typeof LINEUP_SLOTS)[number];
type LineupAssignment = {
  label: LineupSlot["label"];
  slotIndex: number;
};
type LineupOptimizerResult = {
  assignments: Map<string, LineupAssignment>;
  lockedCount: number;
  starterCount: number;
  totalPoints: number;
  warning: string;
};
type LineupDisplayRow = {
  assignment: LineupAssignment | null;
  estimatedPoints: number | null;
  row: LineupRecommendationRow;
};
type SourceQualityMetric = {
  peerSourceCount: number;
  qualityScore: number | null;
  topComparisonCount: number;
};
type ScoringValueMetric = {
  rank: number;
  value: number;
};
type SortDirection = "asc" | "desc";
type TableSort = {
  direction: SortDirection;
  key: string;
};
type SortableValue = string | number | null | undefined;

function App() {
  const [activeTool, setActiveTool] = useState<ActiveTool>("home");
  const [sources, setSources] = useState<RankingSource[]>([]);
  const [board, setBoard] = useState<AggregateBoard>(emptyBoard);
  const [sourceQualityBoard, setSourceQualityBoard] = useState<AggregateBoard>(emptyBoard);
  const [query, setQuery] = useState("");
  const [tdgFormat, setTdgFormat] = useState<"obp" | "points">("points");
  const [fantraxFormat, setFantraxFormat] = useState<"roto" | "points">("points");
  const [includedSourceTags, setIncludedSourceTags] = useState<SourceTag[]>(["Continuous", "Updated"]);
  const [minAge, setMinAge] = useState("");
  const [maxAge, setMaxAge] = useState("");
  const [positionFilter, setPositionFilter] = useState<PositionFilter>("all");
  const [rosterTagFilter, setRosterTagFilter] = useState<RosterTagFilter>("all");
  const [minSources, setMinSources] = useState(1);
  const [rankingsLoading, setRankingsLoading] = useState(true);
  const [busySource, setBusySource] = useState<string | null>(null);
  const [leagues, setLeagues] = useState<FantasyLeague[]>([]);
  const [selectedLeagueUid, setSelectedLeagueUid] = useState("");
  const [leagueRosterPlayers, setLeagueRosterPlayers] = useState<LeagueRosterPlayer[]>([]);
  const [leagueTradeBlockPlayers, setLeagueTradeBlockPlayers] = useState<LeagueTradeBlockPlayer[]>([]);
  const [leagueAvailablePlayerStats, setLeagueAvailablePlayerStats] = useState<LeagueAvailablePlayerStats[]>([]);
  const [leagueValueCurve, setLeagueValueCurve] = useState<LeagueValueCurve | null>(null);
  const [leagueOverlayEnabled, setLeagueOverlayEnabled] = useState(false);
  const [fantasyTeamFilter, setFantasyTeamFilter] = useState("all");
  const [leagueUrl, setLeagueUrl] = useState(DEFAULT_LEAGUE_URL);
  const [leaguesLoading, setLeaguesLoading] = useState(true);
  const [busyLeague, setBusyLeague] = useState<string | null>(null);
  const [teams, setTeams] = useState<FantasyTeam[]>([]);
  const [teamUrl, setTeamUrl] = useState(DEFAULT_TEAM_URL);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [busyTeam, setBusyTeam] = useState<string | null>(null);
  const [tradeSideBTeamUid, setTradeSideBTeamUid] = useState("");
  const [tradeSideAPlayerKeys, setTradeSideAPlayerKeys] = useState<string[]>([]);
  const [tradeSideBPlayerKeys, setTradeSideBPlayerKeys] = useState<string[]>([]);
  const [tradeSideADropPlayerKeys, setTradeSideADropPlayerKeys] = useState<string[]>([]);
  const [tradeSideBDropPlayerKeys, setTradeSideBDropPlayerKeys] = useState<string[]>([]);
  const [tradeSideACash, setTradeSideACash] = useState("");
  const [tradeSideBCash, setTradeSideBCash] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [importSourceId, setImportSourceId] = useState<string | null>(null);
  const [csvText, setCsvText] = useState("");
  const [playerNameCorrections, setPlayerNameCorrections] = useState<PlayerNameCorrection[]>([]);

  useEffect(() => {
    refreshRankings();
  }, [fantraxFormat, includedSourceTags, tdgFormat]);

  useEffect(() => {
    refreshTeams();
    refreshLeagues();
  }, []);

  useEffect(() => {
    if (selectedLeagueUid && (leagueOverlayEnabled || activeTool === "trade")) {
      refreshLeagueRosterMap(selectedLeagueUid);
    } else {
      setLeagueRosterPlayers([]);
      setLeagueTradeBlockPlayers([]);
      setLeagueAvailablePlayerStats([]);
      setLeagueValueCurve(null);
      setFantasyTeamFilter("all");
      setRosterTagFilter("all");
    }
  }, [activeTool, leagueOverlayEnabled, selectedLeagueUid]);

  async function refreshRankings() {
    setRankingsLoading(true);
    try {
      const params = rankingParams();
      const qualityParams = rankingParams(SOURCE_TAGS);
      const [sourceData, boardData, qualityBoardData, correctionData] = await Promise.all([
        fetchRest<RankingSource[]>("sources_with_status?select=*&order=name.asc,ranking_type.asc"),
        fetchFunction<AggregateBoard>("aggregate-board", String(params)),
        fetchFunction<AggregateBoard>("aggregate-board", `${qualityParams}&included_sources_only=false`),
        fetchRest<PlayerNameCorrection[]>("player_name_corrections_with_source?select=*&order=source_name.asc,original_name.asc")
      ]);
      setSources(sourceData);
      setBoard(boardData);
      setSourceQualityBoard(qualityBoardData);
      setPlayerNameCorrections(correctionData);
    } finally {
      setRankingsLoading(false);
    }
  }

  async function refreshTeams() {
    setTeamsLoading(true);
    try {
      const teamData = await fetchRest<FantasyTeam[]>("teams_with_status?select=*&order=league_name.asc,team_name.asc");
      setTeams(teamData);
    } finally {
      setTeamsLoading(false);
    }
  }

  async function refreshLeagues() {
    setLeaguesLoading(true);
    try {
      const leagueData = await fetchRest<FantasyLeague[]>("leagues_with_status?select=*&order=league_name.asc");
      setLeagues(leagueData);
      if (!selectedLeagueUid && leagueData.length) {
        setSelectedLeagueUid(leagueData[0].league_uid);
      }
    } finally {
      setLeaguesLoading(false);
    }
  }

  async function refreshLeagueRosterMap(leagueUid: string) {
    const mapData = await fetchJson<LeagueRosterMap>(`/api/leagues/${encodeURIComponent(leagueUid)}/roster-map`);
    setLeagueRosterPlayers(mapData.players);
    setLeagueTradeBlockPlayers(mapData.trade_block || []);
    setLeagueAvailablePlayerStats(mapData.available_player_stats || []);
    setLeagueValueCurve(mapData.value_curve);
  }

  async function updateSource(sourceId: string) {
    setBusySource(sourceId);
    try {
      const result = await postJson<UpdateResult>(`/api/sources/${sourceId}/update`, {});
      setToast(result.message);
      await refreshRankings();
    } catch (error) {
      setToast(errorMessage(error));
      await refreshRankings();
    } finally {
      setBusySource(null);
    }
  }

  async function updateAll() {
    setBusySource("all");
    try {
      const response = await postJson<{ results: UpdateResult[] }>("/api/update-all", {});
      const successes = response.results.filter((result) => result.status === "success").length;
      const errors = response.results.filter((result) => result.status === "error").length;
      setToast(`${successes} sources updated${errors ? `, ${errors} failed` : ""}.`);
      await refreshRankings();
    } catch (error) {
      setToast(errorMessage(error));
    } finally {
      setBusySource(null);
    }
  }

  async function importCsv() {
    if (!importSourceId) return;
    setBusySource(importSourceId);
    try {
      const result = await postJson<UpdateResult>(`/api/sources/${importSourceId}/import`, { csv_text: csvText });
      setToast(result.message);
      setCsvText("");
      setImportSourceId(null);
      await refreshRankings();
    } catch (error) {
      setToast(errorMessage(error));
    } finally {
      setBusySource(null);
    }
  }

  async function updateSourceTag(sourceId: string, sourceTag: SourceTag) {
    setBusySource(`tag:${sourceId}`);
    try {
      await postJson<{ source_id: string; source_tag: SourceTag; status: "success" }>(`/api/sources/${sourceId}/tag`, {
        source_tag: sourceTag
      });
      setToast("Source tag updated.");
      await refreshRankings();
    } catch (error) {
      setToast(errorMessage(error));
      await refreshRankings();
    } finally {
      setBusySource(null);
    }
  }

  async function updateSourceIncluded(sourceId: string, included: boolean) {
    setBusySource(`included:${sourceId}`);
    try {
      await postJson<{ source_id: string; included: boolean; status: "success" }>(`/api/sources/${sourceId}/included`, {
        included
      });
      setToast(included ? "Source included in rankings." : "Source excluded from rankings.");
      await refreshRankings();
    } catch (error) {
      setToast(errorMessage(error));
      await refreshRankings();
    } finally {
      setBusySource(null);
    }
  }

  async function savePlayerNameCorrection(sourceId: string, originalName: string, correctedName: string) {
    setBusySource(`correction:${sourceId}`);
    try {
      await postJson<{ status: "success"; correction: PlayerNameCorrection }>("/api/player-name-corrections", {
        source_id: sourceId,
        original_name: originalName,
        corrected_name: correctedName
      });
      setToast("Player name correction saved.");
      await refreshRankings();
    } catch (error) {
      setToast(errorMessage(error));
      await refreshRankings();
    } finally {
      setBusySource(null);
    }
  }

  async function deletePlayerNameCorrection(correctionId: number) {
    setBusySource(`correction-delete:${correctionId}`);
    try {
      await deleteJson<{ status: "success"; correction_id: number }>(`/api/player-name-corrections/${correctionId}`);
      setToast("Player name correction removed.");
      await refreshRankings();
    } catch (error) {
      setToast(errorMessage(error));
      await refreshRankings();
    } finally {
      setBusySource(null);
    }
  }

  async function importTeam() {
    if (!teamUrl.trim()) return;
    setBusyTeam("import");
    try {
      const result = await postJson<TeamUpdateResult>("/api/teams/import", { url: teamUrl.trim() });
      setToast(result.message);
      setActiveTool("teams");
      await refreshTeams();
    } catch (error) {
      setToast(errorMessage(error));
    } finally {
      setBusyTeam(null);
    }
  }

  async function importLeague() {
    if (!leagueUrl.trim()) return;
    setBusyLeague("import");
    try {
      const result = await postJson<LeagueUpdateResult>("/api/leagues/import", { url: leagueUrl.trim() });
      setToast(result.message);
      setSelectedLeagueUid(result.league_uid);
      setLeagueOverlayEnabled(true);
      await refreshLeagues();
      await refreshTeams();
      await refreshLeagueRosterMap(result.league_uid);
    } catch (error) {
      setToast(errorMessage(error));
    } finally {
      setBusyLeague(null);
    }
  }

  async function updateSelectedLeague() {
    if (!selectedLeagueUid) return;
    setBusyLeague(selectedLeagueUid);
    try {
      const result = await postJson<LeagueUpdateResult>(`/api/leagues/${encodeURIComponent(selectedLeagueUid)}/update`, {});
      setToast(result.message);
      await refreshLeagues();
      await refreshTeams();
      await refreshLeagueRosterMap(selectedLeagueUid);
    } catch (error) {
      setToast(errorMessage(error));
    } finally {
      setBusyLeague(null);
    }
  }

  async function updateAllLeagues() {
    setBusyLeague("all");
    try {
      const result = await postJson<{ results: LeagueUpdateResult[]; message: string }>("/api/leagues/update-all", {});
      setToast(result.message);
      await refreshLeagues();
      await refreshTeams();
      if (selectedLeagueUid) await refreshLeagueRosterMap(selectedLeagueUid);
    } catch (error) {
      setToast(errorMessage(error));
    } finally {
      setBusyLeague(null);
    }
  }

  async function updateTeam(teamUid: string) {
    setBusyTeam(teamUid);
    try {
      const result = await postJson<TeamUpdateResult>(`/api/teams/${encodeURIComponent(teamUid)}/update`, {});
      setToast(result.message);
      await refreshTeams();
      if (leagueOverlayEnabled && selectedLeagueUid) await refreshLeagueRosterMap(selectedLeagueUid);
    } catch (error) {
      setToast(errorMessage(error));
    } finally {
      setBusyTeam(null);
    }
  }

  async function removeTeam(teamUid: string, teamName: string) {
    if (!window.confirm(`Remove ${teamName} from this app?`)) return;
    setBusyTeam(teamUid);
    try {
      const result = await deleteJson<DeleteResult>(`/api/teams/${encodeURIComponent(teamUid)}`);
      setToast(result.message);
      await refreshTeams();
      if (leagueOverlayEnabled && selectedLeagueUid) await refreshLeagueRosterMap(selectedLeagueUid);
    } catch (error) {
      setToast(errorMessage(error));
    } finally {
      setBusyTeam(null);
    }
  }

  async function removeLeague(leagueUid: string, leagueName: string) {
    if (!window.confirm(`Remove ${leagueName} from this app? Team snapshots will remain unless you remove the teams separately.`)) return;
    setBusyLeague(leagueUid);
    try {
      const result = await deleteJson<DeleteResult>(`/api/leagues/${encodeURIComponent(leagueUid)}`);
      setToast(result.message);
      if (selectedLeagueUid === leagueUid) {
        setSelectedLeagueUid("");
        setLeagueOverlayEnabled(false);
      }
      await refreshLeagues();
    } catch (error) {
      setToast(errorMessage(error));
    } finally {
      setBusyLeague(null);
    }
  }

  function rankingParams(sourceTags: SourceTag[] = includedSourceTags) {
    return new URLSearchParams({
      tdg_format: tdgFormat,
      fantrax_format: fantraxFormat,
      included_source_tags: sourceTags.join(",")
    });
  }

  function toggleIncludedSourceTag(sourceTag: SourceTag) {
    setIncludedSourceTags((current) => {
      if (current.includes(sourceTag)) {
        return current.length === 1 ? current : current.filter((tag) => tag !== sourceTag);
      }
      return SOURCE_TAGS.filter((tag) => tag === sourceTag || current.includes(tag));
    });
  }

  const leagueRosterByPlayerKey = useMemo(() => {
    return new Map(leagueRosterPlayers.map((player) => [player.player_key, player]));
  }, [leagueRosterPlayers]);
  const availableStatsByPlayerKey = useMemo(() => {
    return new Map(leagueAvailablePlayerStats.map((player) => [player.player_key, player]));
  }, [leagueAvailablePlayerStats]);
  const scoringValueByPlayerKey = useMemo(() => {
    return buildScoringValueMap(leagueRosterPlayers, leagueValueCurve);
  }, [leagueRosterPlayers, leagueValueCurve]);
  const availableScoringValueByPlayerKey = useMemo(() => {
    return buildAvailableScoringValueMap(leagueRosterPlayers, leagueAvailablePlayerStats, leagueValueCurve);
  }, [leagueAvailablePlayerStats, leagueRosterPlayers, leagueValueCurve]);

  const fantasyTeamOptions = useMemo(() => {
    const byTeam = new Map<string, { team_uid: string; team_name: string; standings_rank: number | null }>();
    for (const player of leagueRosterPlayers) {
      byTeam.set(player.team_uid, {
        team_uid: player.team_uid,
        team_name: player.team_name,
        standings_rank: player.standings_rank
      });
    }
    return [...byTeam.values()].sort((left, right) => {
      return (left.standings_rank || 999) - (right.standings_rank || 999) || left.team_name.localeCompare(right.team_name);
    });
  }, [leagueRosterPlayers]);

  const visiblePlayers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const minAgeValue = parseAgeFilter(minAge);
    const maxAgeValue = parseAgeFilter(maxAge);
    return board.players.filter((player) => {
      const fantasyRoster = leagueOverlayEnabled ? leagueRosterByPlayerKey.get(player.player_key) : null;
      const eligiblePositions = leagueOverlayEnabled ? fantasyRoster?.positions || player.positions : player.positions;
      const matchesQuery = !normalized || player.player_name.toLowerCase().includes(normalized);
      const matchesAge =
        minAgeValue === null && maxAgeValue === null
          ? true
          : player.age !== null &&
            (minAgeValue === null || player.age >= minAgeValue) &&
            (maxAgeValue === null || player.age <= maxAgeValue);
      const matchesPosition = positionMatchesFilter(eligiblePositions, positionFilter);
      const matchesRosterTag = rosterTagMatches(fantasyRoster ?? null, rosterTagFilter);
      const matchesFantasyTeam =
        !leagueOverlayEnabled ||
        fantasyTeamFilter === "all" ||
        (fantasyTeamFilter === "available" ? !fantasyRoster : fantasyRoster?.team_uid === fantasyTeamFilter);
      return matchesQuery && matchesAge && matchesPosition && matchesRosterTag && matchesFantasyTeam && player.source_count >= minSources;
    });
  }, [board.players, fantasyTeamFilter, leagueOverlayEnabled, leagueRosterByPlayerKey, maxAge, minAge, minSources, positionFilter, query, rosterTagFilter]);

  const importSource = sources.find((source) => source.id === importSourceId) || null;
  const activeTdgSourceId = tdgFormat === "obp" ? TDG_OBP_SOURCE_ID : TDG_POINTS_SOURCE_ID;
  const activeFantraxSourceId = fantraxFormat === "roto" ? FANTRAX_ROTO_SOURCE_ID : FANTRAX_POINTS_SOURCE_ID;
  const displayedSources = sources.filter((source) => {
    if (isTdgSource(source.id)) return source.id === activeTdgSourceId;
    if (isFantraxSource(source.id)) return source.id === activeFantraxSourceId;
    return true;
  });
  const activeSourceIds = new Set(board.sources.map((source) => source.id));
  const exportParams = rankingParams();
  const selectedLeague = leagues.find((league) => league.league_uid === selectedLeagueUid) || null;
  const selectedLeagueTeams = selectedLeague
    ? teams
        .filter((team) => team.league_id === selectedLeague.league_id)
        .sort((left, right) => (left.standings_rank || 999) - (right.standings_rank || 999) || left.team_name.localeCompare(right.team_name))
    : [];
  const pageTitle =
    activeTool === "home"
      ? "Dashboard"
      : activeTool === "rankings"
        ? "Dynasty Rankings"
        : activeTool === "sources"
          ? "Manage Data Sources"
          : activeTool === "trade"
            ? "Trade Analyzer"
            : activeTool === "lineup"
              ? "Lineup Helper"
              : "Teams & Leagues";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Assistant GM</p>
          <h1>{pageTitle}</h1>
        </div>
        <div className="topbar-actions">
          <div className="segmented tool-nav" aria-label="Assistant tools">
            <button className={activeTool === "home" ? "active" : ""} onClick={() => setActiveTool("home")}>
              <Home size={15} />
              Home
            </button>
            <button className={activeTool === "rankings" ? "active" : ""} onClick={() => setActiveTool("rankings")}>
              <Database size={15} />
              Rankings
            </button>
            <button className={activeTool === "sources" ? "active" : ""} onClick={() => setActiveTool("sources")}>
              <Tags size={15} />
              Sources
            </button>
            <button className={activeTool === "trade" ? "active" : ""} onClick={() => setActiveTool("trade")}>
              <ArrowLeftRight size={15} />
              Trade
            </button>
            <button className={activeTool === "lineup" ? "active" : ""} onClick={() => setActiveTool("lineup")}>
              <CalendarDays size={15} />
              Lineup
            </button>
            <button className={activeTool === "teams" ? "active" : ""} onClick={() => setActiveTool("teams")}>
              <Users size={15} />
              Teams
            </button>
          </div>
          {activeTool === "rankings" ? (
            <a className="button ghost" href={apiUrl(`/api/rankings/export.csv?${exportParams}`)}>
              <Download size={18} />
              Export
            </a>
          ) : null}
          {activeTool === "rankings" || activeTool === "sources" ? (
            <button className="button primary" onClick={updateAll} disabled={busySource !== null}>
              <RefreshCcw size={18} className={busySource === "all" ? "spin" : ""} />
              Update All
            </button>
          ) : null}
        </div>
      </header>

      {activeTool === "home" ? (
        <HomeWorkspace
          board={board}
          busyLeague={busyLeague}
          busySource={busySource}
          leagues={leagues}
          onOpenRankings={() => setActiveTool("rankings")}
          onOpenSources={() => setActiveTool("sources")}
          onOpenTeams={() => setActiveTool("teams")}
          onOpenTrade={() => setActiveTool("trade")}
          onOpenLineup={() => setActiveTool("lineup")}
          refreshLeagues={updateAllLeagues}
          refreshRankings={updateAll}
          sources={sources}
          teams={teams}
        />
      ) : activeTool === "rankings" ? (
        <RankingsWorkspace
          activeSourceIds={activeSourceIds}
          board={board}
          busySource={busySource}
          displayedSources={displayedSources}
          fantraxFormat={fantraxFormat}
          importCsvSource={(sourceId) => setImportSourceId(sourceId)}
          includedSourceTags={includedSourceTags}
          fantasyTeamFilter={fantasyTeamFilter}
          fantasyTeamOptions={fantasyTeamOptions}
          leagueOverlayEnabled={leagueOverlayEnabled}
          leagueRosterByPlayerKey={leagueRosterByPlayerKey}
          leagueValueCurve={leagueValueCurve}
          scoringValueByPlayerKey={scoringValueByPlayerKey}
          leagues={leagues}
          loading={rankingsLoading}
          maxAge={maxAge}
          minAge={minAge}
          minSources={minSources}
          positionFilter={positionFilter}
          query={query}
          rosterTagFilter={rosterTagFilter}
          setFantraxFormat={setFantraxFormat}
          setFantasyTeamFilter={setFantasyTeamFilter}
          setLeagueOverlayEnabled={setLeagueOverlayEnabled}
          setSelectedLeagueUid={setSelectedLeagueUid}
          setMaxAge={setMaxAge}
          setMinAge={setMinAge}
          setMinSources={setMinSources}
          setPositionFilter={setPositionFilter}
          setQuery={setQuery}
          setRosterTagFilter={setRosterTagFilter}
          setTdgFormat={setTdgFormat}
          tdgFormat={tdgFormat}
          toggleIncludedSourceTag={toggleIncludedSourceTag}
          updateSource={updateSource}
          selectedLeagueUid={selectedLeagueUid}
          visiblePlayers={visiblePlayers}
        />
      ) : activeTool === "sources" ? (
        <SourceManagerWorkspace
          board={sourceQualityBoard}
          busySource={busySource}
          deletePlayerNameCorrection={deletePlayerNameCorrection}
          importCsvSource={(sourceId) => setImportSourceId(sourceId)}
          playerNameCorrections={playerNameCorrections}
          savePlayerNameCorrection={savePlayerNameCorrection}
          sources={sources}
          updateSource={updateSource}
          updateSourceIncluded={updateSourceIncluded}
          updateSourceTag={updateSourceTag}
        />
      ) : activeTool === "trade" ? (
        <TradeAnalyzerWorkspace
          availableScoringValueByPlayerKey={availableScoringValueByPlayerKey}
          availableStatsByPlayerKey={availableStatsByPlayerKey}
          board={board}
          includedSourceTags={includedSourceTags}
          leagueRosterPlayers={leagueRosterPlayers}
          leagueTradeBlockPlayers={leagueTradeBlockPlayers}
          leagueValueCurve={leagueValueCurve}
          scoringValueByPlayerKey={scoringValueByPlayerKey}
          leagues={leagues}
          selectedLeague={selectedLeague}
          selectedLeagueTeams={selectedLeagueTeams}
          selectedLeagueUid={selectedLeagueUid}
          setSelectedLeagueUid={(leagueUid) => {
            setSelectedLeagueUid(leagueUid);
            setTradeSideAPlayerKeys([]);
            setTradeSideBPlayerKeys([]);
            setTradeSideADropPlayerKeys([]);
            setTradeSideBDropPlayerKeys([]);
            setTradeSideACash("");
            setTradeSideBCash("");
          }}
          setTradeSideADropPlayerKeys={setTradeSideADropPlayerKeys}
          setTradeSideAPlayerKeys={setTradeSideAPlayerKeys}
          setTradeSideBDropPlayerKeys={setTradeSideBDropPlayerKeys}
          setTradeSideBPlayerKeys={setTradeSideBPlayerKeys}
          setTradeSideBTeamUid={(teamUid) => {
            setTradeSideBTeamUid(teamUid);
            setTradeSideBPlayerKeys([]);
            setTradeSideBDropPlayerKeys([]);
            setTradeSideBCash("");
          }}
          setTradeSideACash={setTradeSideACash}
          setTradeSideBCash={setTradeSideBCash}
          toggleIncludedSourceTag={toggleIncludedSourceTag}
          tradeSideACash={tradeSideACash}
          tradeSideADropPlayerKeys={tradeSideADropPlayerKeys}
          tradeSideAPlayerKeys={tradeSideAPlayerKeys}
          tradeSideBCash={tradeSideBCash}
          tradeSideBDropPlayerKeys={tradeSideBDropPlayerKeys}
          tradeSideBPlayerKeys={tradeSideBPlayerKeys}
          tradeSideBTeamUid={tradeSideBTeamUid}
        />
      ) : activeTool === "lineup" ? (
        <LineupHelperWorkspace
          leagues={leagues}
          selectedLeague={selectedLeague}
          selectedLeagueTeams={selectedLeagueTeams}
          selectedLeagueUid={selectedLeagueUid}
          setSelectedLeagueUid={setSelectedLeagueUid}
          setToast={setToast}
        />
      ) : (
        <TeamsWorkspace
          busyLeague={busyLeague}
          busyTeam={busyTeam}
          importLeague={importLeague}
          importTeam={importTeam}
          leagueUrl={leagueUrl}
          leagues={leagues}
          leaguesLoading={leaguesLoading}
          removeLeague={removeLeague}
          removeTeam={removeTeam}
          selectedLeague={selectedLeague}
          selectedLeagueTeams={selectedLeagueTeams}
          selectedLeagueUid={selectedLeagueUid}
          setLeagueUrl={setLeagueUrl}
          setSelectedLeagueUid={setSelectedLeagueUid}
          setTeamUrl={setTeamUrl}
          teams={teams}
          teamsLoading={teamsLoading}
          teamUrl={teamUrl}
          updateTeam={updateTeam}
          updateSelectedLeague={updateSelectedLeague}
        />
      )}

      {importSource && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">CSV Import</p>
                <h2>{importSource.name}</h2>
              </div>
              <button className="icon-button" title="Close" onClick={() => setImportSourceId(null)}>
                <X size={18} />
              </button>
            </div>
            <textarea
              value={csvText}
              onChange={(event) => setCsvText(event.target.value)}
              spellCheck={false}
              placeholder={"rank,player,team,position,age\n1,Shohei Ohtani,LAD,UT/P,31.6"}
            />
            <div className="modal-actions">
              <a className="button ghost" href={apiUrl("/api/import-template.csv")}>
                <Download size={17} />
                Template
              </a>
              <button className="button primary" onClick={importCsv} disabled={!csvText.trim() || busySource !== null}>
                <Upload size={17} />
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <button className="toast" onClick={() => setToast(null)}>
          {toast}
          <X size={16} />
        </button>
      )}
    </div>
  );
}

function HomeWorkspace({
  board,
  busyLeague,
  busySource,
  leagues,
  onOpenRankings,
  onOpenSources,
  onOpenTeams,
  onOpenTrade,
  onOpenLineup,
  refreshLeagues,
  refreshRankings,
  sources,
  teams
}: {
  board: AggregateBoard;
  busyLeague: string | null;
  busySource: string | null;
  leagues: FantasyLeague[];
  onOpenRankings: () => void;
  onOpenSources: () => void;
  onOpenTeams: () => void;
  onOpenTrade: () => void;
  onOpenLineup: () => void;
  refreshLeagues: () => void;
  refreshRankings: () => void;
  sources: RankingSource[];
  teams: FantasyTeam[];
}) {
  const loadedSourceCount = board.sources.length;
  const totalRankingRows = board.sources.reduce((total, source) => total + source.row_count, 0);
  const loadedLeagueCount = leagues.length;
  const loadedTeamCount = teams.length;
  const rosteredPlayerCount = leagues.reduce((total, league) => total + league.rostered_player_count, 0);
  const taggedSourceCount = sources.filter((source) => source.source_tag).length;
  const tagGroupCount = SOURCE_TAGS.filter((tag) => sources.some((source) => source.source_tag === tag)).length;

  return (
    <main className="home-shell">
      <section className="home-hero">
        <p className="eyebrow">Local Tools</p>
        <h2>Choose a workflow</h2>
      </section>

      <section className="home-actions">
        <button className="button primary" onClick={refreshRankings} disabled={busySource !== null}>
          <RefreshCcw size={18} className={busySource === "all" ? "spin" : ""} />
          Refresh Rankings
        </button>
        <button className="button ghost" onClick={refreshLeagues} disabled={busyLeague !== null || !leagues.length}>
          <RefreshCcw size={18} className={busyLeague === "all" ? "spin" : ""} />
          Refresh Leagues
        </button>
      </section>

      <section className="door-grid">
        <button className="door-card" onClick={onOpenRankings} type="button">
          <div className="door-icon">
            <Database size={24} />
          </div>
          <div>
            <p className="eyebrow">Tool 1</p>
            <h3>Dynasty Ranking Aggregator</h3>
            <p>Aggregate public and imported dynasty ranking sources, then overlay fantasy league ownership.</p>
          </div>
          <div className="door-metrics">
            <Metric label="Players" value={board.players.length.toLocaleString()} />
            <Metric label="Sources" value={loadedSourceCount.toLocaleString()} />
            <Metric label="Rows" value={totalRankingRows.toLocaleString()} />
          </div>
        </button>

        <button className="door-card" onClick={onOpenTeams} type="button">
          <div className="door-icon">
            <Users size={24} />
          </div>
          <div>
            <p className="eyebrow">Tool 2</p>
            <h3>Teams / Leagues</h3>
            <p>Add, update, remove, and review Ottoneu teams and leagues by league.</p>
          </div>
          <div className="door-metrics">
            <Metric label="Leagues" value={loadedLeagueCount.toLocaleString()} />
            <Metric label="Teams" value={loadedTeamCount.toLocaleString()} />
            <Metric label="Rostered" value={rosteredPlayerCount.toLocaleString()} />
          </div>
        </button>

        <button className="door-card" onClick={onOpenSources} type="button">
          <div className="door-icon">
            <Tags size={24} />
          </div>
          <div>
            <p className="eyebrow">Tool 3</p>
            <h3>Manage Data Sources</h3>
            <p>Review ranking sources, open their sites, update imports, and assign ranking-cycle tags.</p>
          </div>
          <div className="door-metrics">
            <Metric label="Sources" value={sources.length.toLocaleString()} />
            <Metric label="Tagged" value={taggedSourceCount.toLocaleString()} />
            <Metric label="Groups" value={tagGroupCount.toLocaleString()} />
          </div>
        </button>

        <button className="door-card" onClick={onOpenTrade} type="button">
          <div className="door-icon">
            <ArrowLeftRight size={24} />
          </div>
          <div>
            <p className="eyebrow">Tool 4</p>
            <h3>Trade Analyzer</h3>
            <p>Compare packages from your team against another league roster using dynasty and scoring values.</p>
          </div>
          <div className="door-metrics">
            <Metric label="Leagues" value={loadedLeagueCount.toLocaleString()} />
            <Metric label="Teams" value={loadedTeamCount.toLocaleString()} />
            <Metric label="Players" value={board.players.length.toLocaleString()} />
          </div>
        </button>

        <button className="door-card" onClick={onOpenLineup} type="button">
          <div className="door-icon">
            <CalendarDays size={24} />
          </div>
          <div>
            <p className="eyebrow">Tool 5</p>
            <h3>Lineup Helper</h3>
            <p>Compare your hitters to today&apos;s probable starters and imported pitcher xFIP- values.</p>
          </div>
          <div className="door-metrics">
            <Metric label="Leagues" value={loadedLeagueCount.toLocaleString()} />
            <Metric label="Teams" value={loadedTeamCount.toLocaleString()} />
            <Metric label="Players" value={rosteredPlayerCount.toLocaleString()} />
          </div>
        </button>
      </section>
    </main>
  );
}

function RankingsWorkspace({
  activeSourceIds,
  board,
  busySource,
  displayedSources,
  fantraxFormat,
  fantasyTeamFilter,
  fantasyTeamOptions,
  importCsvSource,
  includedSourceTags,
  leagueOverlayEnabled,
  leagueRosterByPlayerKey,
  leagueValueCurve,
  scoringValueByPlayerKey,
  leagues,
  loading,
  maxAge,
  minAge,
  minSources,
  positionFilter,
  query,
  rosterTagFilter,
  setFantraxFormat,
  setFantasyTeamFilter,
  setLeagueOverlayEnabled,
  setSelectedLeagueUid,
  setMaxAge,
  setMinAge,
  setMinSources,
  setPositionFilter,
  setQuery,
  setRosterTagFilter,
  setTdgFormat,
  tdgFormat,
  toggleIncludedSourceTag,
  updateSource,
  selectedLeagueUid,
  visiblePlayers
}: {
  activeSourceIds: Set<string>;
  board: AggregateBoard;
  busySource: string | null;
  displayedSources: RankingSource[];
  fantraxFormat: "roto" | "points";
  fantasyTeamFilter: string;
  fantasyTeamOptions: { team_uid: string; team_name: string; standings_rank: number | null }[];
  importCsvSource: (sourceId: string) => void;
  includedSourceTags: SourceTag[];
  leagueOverlayEnabled: boolean;
  leagueRosterByPlayerKey: Map<string, LeagueRosterPlayer>;
  leagueValueCurve: LeagueValueCurve | null;
  scoringValueByPlayerKey: Map<string, ScoringValueMetric>;
  leagues: FantasyLeague[];
  loading: boolean;
  maxAge: string;
  minAge: string;
  minSources: number;
  positionFilter: PositionFilter;
  query: string;
  rosterTagFilter: RosterTagFilter;
  setFantraxFormat: (value: "roto" | "points") => void;
  setFantasyTeamFilter: (value: string) => void;
  setLeagueOverlayEnabled: (value: boolean) => void;
  setSelectedLeagueUid: (value: string) => void;
  setMaxAge: (value: string) => void;
  setMinAge: (value: string) => void;
  setMinSources: (value: number) => void;
  setPositionFilter: (value: PositionFilter) => void;
  setQuery: (value: string) => void;
  setRosterTagFilter: (value: RosterTagFilter) => void;
  setTdgFormat: (value: "obp" | "points") => void;
  tdgFormat: "obp" | "points";
  toggleIncludedSourceTag: (sourceTag: SourceTag) => void;
  updateSource: (sourceId: string) => void;
  selectedLeagueUid: string;
  visiblePlayers: AggregatePlayer[];
}) {
  const [rankingSort, setRankingSort] = useState<TableSort>({ direction: "asc", key: "dyAgg" });
  const groupedSources = useMemo(
    () =>
      SOURCE_TAGS.map((sourceTag) => ({
        source_tag: sourceTag,
        sources: board.sources.filter((source) => source.source_tag === sourceTag)
      })).filter((group) => group.sources.length > 0),
    [board.sources]
  );
  const showFantasyValue = leagueOverlayEnabled && leagueValueCurve !== null;
  const showLeaguePositions = leagueOverlayEnabled && Boolean(selectedLeagueUid);
  const showRosterStatus = leagueOverlayEnabled && Boolean(selectedLeagueUid);
  const sortedVisiblePlayers = useMemo(() => {
    return sortRankingRows(visiblePlayers, rankingSort, {
      leagueRosterByPlayerKey,
      leagueValueCurve,
      scoringValueByPlayerKey
    });
  }, [leagueRosterByPlayerKey, leagueValueCurve, rankingSort, scoringValueByPlayerKey, visiblePlayers]);
  const rankingWindow = useTableWindow(sortedVisiblePlayers.length, RANKING_ROW_HEIGHT, RANKING_OVERSCAN_ROWS);
  const renderedVisiblePlayers = sortedVisiblePlayers.slice(rankingWindow.startIndex, rankingWindow.endIndex);
  const rankingColumnCount =
    9 +
    (leagueOverlayEnabled ? 1 : 0) +
    (showLeaguePositions ? 1 : 0) +
    (showRosterStatus ? 1 : 0) +
    (showFantasyValue ? 5 : 0) +
    groupedSources.reduce((total, group) => total + group.sources.length + 1, 0);

  return (
    <main className="workspace">
      <aside className="sources-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Sources</p>
            <h2>{displayedSources.length || 0} cards</h2>
          </div>
          <Database size={22} />
        </div>

        <div className="source-list">
          {displayedSources.map((source) => (
            <article className={`source-item ${activeSourceIds.has(source.id) ? "loaded" : ""}`} key={source.id}>
              <div className="source-main">
                <div>
                  <h3>{source.name}</h3>
                  <p>{source.ranking_type}</p>
                </div>
                <span className={`status-pill ${statusClass(source.last_status)}`}>
                  {statusIcon(source.last_status)}
                  {statusLabel(source)}
                </span>
              </div>
              <div className="source-meta">
                <span>{source.access.replace("_", " ")}</span>
                <span className="tag-pill">{source.source_tag}</span>
                <span className={`tag-pill ${source.included ? "included-pill" : "excluded-pill"}`}>
                  {source.included ? "Included" : "Excluded"}
                </span>
                <span>{formatDate(source.last_fetched_at)}</span>
              </div>
              <div className="source-date">
                <CalendarDays size={14} />
                <span>Source date</span>
                <strong>{formatSourceDate(source.last_source_date, source.last_snapshot_id)}</strong>
                {source.last_source_date_kind && <em>{sourceDateKindLabel(source.last_source_date_kind)}</em>}
              </div>
              <a className="source-url" href={source.url} target="_blank" rel="noreferrer" title={source.url}>
                <ExternalLink size={14} />
                <span>{source.url}</span>
              </a>
              {isTdgSource(source.id) && (
                <FormatToggle
                  label="Format"
                  ariaLabel="The Dynasty Guru format"
                  options={[
                    {
                      label: "OBP",
                      active: tdgFormat === "obp",
                      onClick: () => setTdgFormat("obp"),
                      title: "Use The Dynasty Guru OBP rankings in the aggregate and hide the Points list.",
                      ariaLabel: "Use The Dynasty Guru OBP rankings"
                    },
                    {
                      label: "Points",
                      active: tdgFormat === "points",
                      onClick: () => setTdgFormat("points"),
                      title: "Use The Dynasty Guru Points rankings in the aggregate and hide the OBP list.",
                      ariaLabel: "Use The Dynasty Guru Points rankings"
                    }
                  ]}
                />
              )}
              {isFantraxSource(source.id) && (
                <FormatToggle
                  label="Scoring"
                  ariaLabel="FantraxHQ scoring format"
                  options={[
                    {
                      label: "Roto",
                      active: fantraxFormat === "roto",
                      onClick: () => setFantraxFormat("roto"),
                      title: "Use the FantraxHQ Roto rank column in the aggregate and hide the Points rank column.",
                      ariaLabel: "Use FantraxHQ Roto rankings"
                    },
                    {
                      label: "Points",
                      active: fantraxFormat === "points",
                      onClick: () => setFantraxFormat("points"),
                      title: "Use the FantraxHQ Points rank column in the aggregate and hide the Roto rank column.",
                      ariaLabel: "Use FantraxHQ Points rankings"
                    }
                  ]}
                />
              )}
              <p className="source-note">{source.notes}</p>
              <div className="source-actions">
                <button className="icon-button" title="Update source" disabled={!source.can_update || busySource !== null} onClick={() => updateSource(source.id)}>
                  <RefreshCcw size={17} className={busySource === source.id ? "spin" : ""} />
                </button>
                <button className="icon-button" title="Import CSV" disabled={busySource !== null} onClick={() => importCsvSource(source.id)}>
                  <Upload size={17} />
                </button>
                <a className="icon-button link" title="Open source" href={source.url} target="_blank" rel="noreferrer">
                  <ExternalLink size={17} />
                </a>
              </div>
            </article>
          ))}
        </div>
      </aside>

      <section className="rankings-panel">
        <div className="table-toolbar">
          <div className="search-box">
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search players" />
          </div>
          <div className="age-filter">
            <span>Age</span>
            <div className="age-inputs">
              <input
                aria-label="Minimum age"
                inputMode="decimal"
                min="16"
                max="50"
                onChange={(event) => setMinAge(event.target.value)}
                placeholder="Min"
                step="0.1"
                title="Minimum age to show. Leave blank for no minimum."
                type="number"
                value={minAge}
              />
              <span>to</span>
              <input
                aria-label="Maximum age"
                inputMode="decimal"
                min="16"
                max="50"
                onChange={(event) => setMaxAge(event.target.value)}
                placeholder="Max"
                step="0.1"
                title="Maximum age to show. Leave blank for no maximum."
                type="number"
                value={maxAge}
              />
            </div>
          </div>
          <div className="position-filter">
            <span>Pos</span>
            <select
              className="select-control"
              value={positionFilter}
              onChange={(event) => setPositionFilter(event.target.value as PositionFilter)}
              aria-label="Position filter"
              title="Filter by eligible position. MI includes 2B or SS, CI includes 1B or 3B, UTI includes hitters, and P includes SP or RP."
            >
              {POSITION_FILTERS.map((position) => (
                <option key={position} value={position}>
                  {position === "all" ? "All Pos" : position}
                </option>
              ))}
            </select>
          </div>
          {leagueOverlayEnabled && (
            <div className="position-filter">
              <span>Tag</span>
              <select
                className="select-control"
                value={rosterTagFilter}
                onChange={(event) => setRosterTagFilter(event.target.value as RosterTagFilter)}
                aria-label="Roster tag filter"
                title="Filter by Ottoneu roster tag. IL includes IL/DL statuses; MiLB includes minor league levels."
              >
                {ROSTER_TAG_FILTERS.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag === "all" ? "All Tags" : tag}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="segmented" aria-label="Minimum sources">
            {[1, 2, 3, 4].map((count) => (
              <button
                key={count}
                className={minSources === count ? "active" : ""}
                onClick={() => setMinSources(count)}
                title={`Show only players ranked by at least ${count} source${count === 1 ? "" : "s"}.`}
                aria-label={`Show players ranked by at least ${count} source${count === 1 ? "" : "s"}`}
              >
                {count}+ src
              </button>
            ))}
          </div>
          <div className="league-controls">
            <span>Fantasy League</span>
            <div className="segmented" aria-label="Fantasy league overlay">
              <button
                className={!leagueOverlayEnabled ? "active" : ""}
                onClick={() => setLeagueOverlayEnabled(false)}
                title="Hide fantasy league roster ownership in the rankings table."
              >
                Off
              </button>
              <button
                className={leagueOverlayEnabled ? "active" : ""}
                onClick={() => setLeagueOverlayEnabled(true)}
                disabled={!leagues.length}
                title="Show fantasy league roster ownership in the rankings table."
              >
                On
              </button>
            </div>
            {leagueOverlayEnabled && (
              <>
                <select
                  className="select-control"
                  value={selectedLeagueUid}
                  onChange={(event) => {
                    setSelectedLeagueUid(event.target.value);
                    setFantasyTeamFilter("all");
                  }}
                  aria-label="Fantasy league"
                >
                  {leagues.map((league) => (
                    <option key={league.league_uid} value={league.league_uid}>
                      {league.league_name}
                    </option>
                  ))}
                </select>
                <select
                  className="select-control"
                  value={fantasyTeamFilter}
                  onChange={(event) => setFantasyTeamFilter(event.target.value)}
                  aria-label="Fantasy team filter"
                >
                  <option value="all">All teams</option>
                  <option value="available">Available</option>
                  {fantasyTeamOptions.map((team) => (
                    <option key={team.team_uid} value={team.team_uid}>
                      {team.team_name}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
        </div>

        <div className="ranking-group-controls">
          <span>Full Ranking Uses</span>
          <div className="segmented tag-segmented" aria-label="Source tag groups used in full aggregate">
            {SOURCE_TAGS.map((sourceTag) => {
              const active = includedSourceTags.includes(sourceTag);
              return (
                <button
                  key={sourceTag}
                  className={active ? "active" : ""}
                  onClick={() => toggleIncludedSourceTag(sourceTag)}
                  title={`${active ? "Remove" : "Include"} ${sourceTag} sources in the main dynasty aggregate rank.`}
                  aria-label={`${active ? "Remove" : "Include"} ${sourceTag} sources in the main dynasty aggregate rank`}
                >
                  {sourceTag.replace("2026 ", "")}
                </button>
              );
            })}
          </div>
        </div>

        <div className="board-summary">
          <Metric label="Players" value={sortedVisiblePlayers.length.toLocaleString()} />
          <Metric label="Loaded Sources" value={board.sources.length.toLocaleString()} />
          <Metric label="Included Groups" value={includedSourceTags.length.toLocaleString()} />
          {leagueOverlayEnabled && (
            <Metric
              label="Dy. FV Curve"
              value={leagueValueCurve ? `${leagueValueCurve.player_count.toLocaleString()} players` : "No salaries"}
            />
          )}
          <Metric label="Total Rows" value={board.sources.reduce((total, source) => total + source.row_count, 0).toLocaleString()} />
        </div>

        <div className="table-wrap" onScroll={rankingWindow.onScroll}>
          {loading ? (
            <div className="empty-state">Loading rankings...</div>
          ) : sortedVisiblePlayers.length ? (
            <table className="grouped-rankings-table">
              <thead>
                <tr>
                  {showFantasyValue && <SortableHeader className="rank-col" label="Sc. Rank" rowSpan={2} sort={rankingSort} sortKey="scRank" setSort={setRankingSort} title="Scoring rank from league total points." />}
                  <SortableHeader className="rank-col" label="Dy. Agg" rowSpan={2} sort={rankingSort} sortKey="dyAgg" setSort={setRankingSort} />
                  {showFantasyValue && <SortableHeader className="value-col" label="Dy. FV" rowSpan={2} sort={rankingSort} sortKey="dyValue" setSort={setRankingSort} defaultDirection="desc" />}
                  {showFantasyValue && <SortableHeader className="value-col" label="Sc. Val" rowSpan={2} sort={rankingSort} sortKey="scValue" setSort={setRankingSort} defaultDirection="desc" title="Scoring value from total-points rank fitted to the league salary curve." />}
                  {showFantasyValue && <SortableHeader className="value-col" label="Dy. Val +/-" rowSpan={2} sort={rankingSort} sortKey="dyDelta" setSort={setRankingSort} defaultDirection="desc" title="Dy. FV - Salary" />}
                  {showFantasyValue && <SortableHeader className="value-col" label="Sc. Val +/-" rowSpan={2} sort={rankingSort} sortKey="scDelta" setSort={setRankingSort} defaultDirection="desc" title="Sc. Val - Salary" />}
                  <SortableHeader className="player-col" label="Player" rowSpan={2} sort={rankingSort} sortKey="player" setSort={setRankingSort} />
                  {showRosterStatus && <SortableHeader className="status-col" label="Status" rowSpan={2} sort={rankingSort} sortKey="rosterStatus" setSort={setRankingSort} />}
                  {leagueOverlayEnabled && <SortableHeader label="Fantasy Team" rowSpan={2} sort={rankingSort} sortKey="fantasyTeam" setSort={setRankingSort} />}
                  {showLeaguePositions && <SortableHeader label="Elig" rowSpan={2} sort={rankingSort} sortKey="elig" setSort={setRankingSort} />}
                  <SortableHeader label="Team" rowSpan={2} sort={rankingSort} sortKey="team" setSort={setRankingSort} />
                  <SortableHeader label="Pos" rowSpan={2} sort={rankingSort} sortKey="positions" setSort={setRankingSort} />
                  <SortableHeader label="Age" rowSpan={2} sort={rankingSort} sortKey="age" setSort={setRankingSort} />
                  <SortableHeader label="Avg" rowSpan={2} sort={rankingSort} sortKey="avg" setSort={setRankingSort} />
                  <SortableHeader label="Med" rowSpan={2} sort={rankingSort} sortKey="median" setSort={setRankingSort} />
                  <SortableHeader label="Src" rowSpan={2} sort={rankingSort} sortKey="sources" setSort={setRankingSort} defaultDirection="desc" />
                  <SortableHeader label="Spread" rowSpan={2} sort={rankingSort} sortKey="spread" setSort={setRankingSort} />
                  {groupedSources.map((group) => (
                    <th className="group-header" key={group.source_tag} colSpan={group.sources.length + 1}>
                      {group.source_tag}
                    </th>
                  ))}
                </tr>
                <tr>
                  {groupedSources.map((group) => (
                    <Fragment key={group.source_tag}>
                      <SortableHeader className="subagg-col" label="Sub Dy. Agg" sort={rankingSort} sortKey={`group:${group.source_tag}`} setSort={setRankingSort} />
                      {group.sources.map((source) => (
                        <SortableHeader key={source.id} label={source.short_name} sort={rankingSort} sortKey={`source:${source.id}`} setSort={setRankingSort} title={`${source.name} - ${source.ranking_type}`} />
                      ))}
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                <TableSpacerRow colSpan={rankingColumnCount} height={rankingWindow.beforeHeight} />
                {renderedVisiblePlayers.map((player) => (
                  <RankingRow
                    key={player.player_key}
                    fantasyRoster={leagueOverlayEnabled ? leagueRosterByPlayerKey.get(player.player_key) || null : null}
                    fantasyValue={leagueValueCurve ? fittedFantasyValue(player.aggregate_rank, leagueValueCurve) : null}
                    groupedSources={groupedSources}
                    player={player}
                    scoringValue={scoringValueByPlayerKey.get(player.player_key) ?? null}
                    showLeaguePositions={showLeaguePositions}
                    showRosterStatus={showRosterStatus}
                    showFantasyTeam={leagueOverlayEnabled}
                    showFantasyValue={showFantasyValue}
                  />
                ))}
                <TableSpacerRow colSpan={rankingColumnCount} height={rankingWindow.afterHeight} />
              </tbody>
            </table>
          ) : (
            <div className="empty-state">No ranking rows loaded.</div>
          )}
        </div>
      </section>
    </main>
  );
}

function SourceManagerWorkspace({
  board,
  busySource,
  deletePlayerNameCorrection,
  importCsvSource,
  playerNameCorrections,
  savePlayerNameCorrection,
  sources,
  updateSource,
  updateSourceIncluded,
  updateSourceTag
}: {
  board: AggregateBoard;
  busySource: string | null;
  deletePlayerNameCorrection: (correctionId: number) => void;
  importCsvSource: (sourceId: string) => void;
  playerNameCorrections: PlayerNameCorrection[];
  savePlayerNameCorrection: (sourceId: string, originalName: string, correctedName: string) => void;
  sources: RankingSource[];
  updateSource: (sourceId: string) => void;
  updateSourceIncluded: (sourceId: string, included: boolean) => void;
  updateSourceTag: (sourceId: string, sourceTag: SourceTag) => void;
}) {
  const loadedSourceIds = new Set(board.sources.map((source) => source.id));
  const sourceQualityById = useMemo(() => buildSourceQualityMetrics(board), [board]);
  const totalRows = sources.reduce((total, source) => total + (source.last_row_count || 0), 0);
  const autoUpdateCount = sources.filter((source) => source.can_update).length;
  const includedSourceCount = sources.filter((source) => source.included).length;
  const [correctionSourceId, setCorrectionSourceId] = useState(sources[0]?.id || "");
  const [correctionOriginalName, setCorrectionOriginalName] = useState("");
  const [correctionCorrectedName, setCorrectionCorrectedName] = useState("");

  useEffect(() => {
    if (!correctionSourceId && sources.length) {
      setCorrectionSourceId(sources[0].id);
    }
  }, [correctionSourceId, sources]);

  return (
    <main className="workspace source-manager-workspace">
      <aside className="sources-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Manage Sources</p>
            <h2>{sources.length || 0} sources</h2>
          </div>
          <Tags size={22} />
        </div>

        <div className="source-tag-list">
          {SOURCE_TAGS.map((sourceTag) => {
            const taggedSources = sources.filter((source) => source.source_tag === sourceTag);
            const loadedSources = taggedSources.filter((source) => source.last_snapshot_id !== null);
            const includedSources = taggedSources.filter((source) => source.included);
            const rowCount = taggedSources.reduce((total, source) => total + (source.last_row_count || 0), 0);
            return (
              <article className="source-tag-card" key={sourceTag}>
                <strong>{sourceTag}</strong>
                <span>
                  {taggedSources.length} sources - {includedSources.length} included - {loadedSources.length} loaded - {rowCount.toLocaleString()} rows
                </span>
              </article>
            );
          })}
        </div>
      </aside>

      <section className="rankings-panel">
        <div className="team-heading">
          <div>
            <p className="eyebrow">Source Tags</p>
            <h2>Ranking-cycle groups</h2>
          </div>
        </div>

        <div className="board-summary source-manager-summary">
          <Metric label="Sources" value={sources.length.toLocaleString()} />
          <Metric label="Included" value={includedSourceCount.toLocaleString()} />
          <Metric label="Loaded" value={loadedSourceIds.size.toLocaleString()} />
          <Metric label="Auto Update" value={autoUpdateCount.toLocaleString()} />
          <Metric label="Rows" value={totalRows.toLocaleString()} />
        </div>

        <section className="correction-card">
          <div className="correction-heading">
            <div>
              <p className="eyebrow">Name Fixes</p>
              <h3>Source-specific spelling</h3>
            </div>
            <Metric label="Saved" value={playerNameCorrections.length.toLocaleString()} />
          </div>
          <form
            className="correction-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!correctionSourceId || !correctionOriginalName.trim() || !correctionCorrectedName.trim()) return;
              savePlayerNameCorrection(correctionSourceId, correctionOriginalName.trim(), correctionCorrectedName.trim());
              setCorrectionOriginalName("");
              setCorrectionCorrectedName("");
            }}
          >
            <label>
              <span>Source</span>
              <select
                className="select-control"
                value={correctionSourceId}
                onChange={(event) => setCorrectionSourceId(event.target.value)}
              >
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name} - {source.ranking_type}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Source spelling</span>
              <input
                value={correctionOriginalName}
                onChange={(event) => setCorrectionOriginalName(event.target.value)}
                placeholder="Garrett Crochett"
              />
            </label>
            <label>
              <span>Correct name</span>
              <input
                value={correctionCorrectedName}
                onChange={(event) => setCorrectionCorrectedName(event.target.value)}
                placeholder="Garrett Crochet"
              />
            </label>
            <button
              className="button primary"
              type="submit"
              disabled={
                busySource !== null ||
                !correctionSourceId ||
                !correctionOriginalName.trim() ||
                !correctionCorrectedName.trim()
              }
            >
              <CheckCircle2 size={17} />
              Save Fix
            </button>
          </form>

          <div className="correction-list">
            {playerNameCorrections.length ? (
              playerNameCorrections.map((correction) => (
                <article className="correction-item" key={correction.id}>
                  <div>
                    <span className="tag-pill">{correction.source_short_name}</span>
                    <strong>{correction.original_name}</strong>
                    <span>to {correction.corrected_name}</span>
                  </div>
                  <button
                    className="icon-button danger"
                    disabled={busySource !== null}
                    onClick={() => deletePlayerNameCorrection(correction.id)}
                    title="Remove correction"
                    type="button"
                  >
                    <Trash2 size={16} />
                  </button>
                </article>
              ))
            ) : (
              <div className="empty-card compact">No source-specific corrections saved.</div>
            )}
          </div>
        </section>

        <div className="table-wrap source-manager-wrap">
          <table className="source-management-table">
            <thead>
              <tr>
                <th className="player-col">Source</th>
                <th>Included</th>
                <th>Tag</th>
                <th>Status</th>
                <th>Fixes</th>
                <th title="Lower is better. Sum of same-tag top-200 rank distances, capped at 201, divided by 200 and by the number of peer sources in the tag. Blank peer ranks add no distance.">Quality</th>
                <th>Source Date</th>
                <th>Last Fetch</th>
                <th>Rows</th>
                <th>Access</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((source) => {
                const quality = sourceQualityById.get(source.id) || null;
                return (
                  <tr key={source.id}>
                  <td className="player-col source-name-cell">
                    <strong>{source.name}</strong>
                    <span>{source.ranking_type}</span>
                  </td>
                  <td>
                    <label className="include-toggle" title="Include this source in ranking table columns, aggregates, exports, and trade values.">
                      <input
                        checked={Boolean(source.included)}
                        disabled={busySource !== null}
                        onChange={(event) => updateSourceIncluded(source.id, event.target.checked)}
                        type="checkbox"
                      />
                      <span>{source.included ? "On" : "Off"}</span>
                    </label>
                  </td>
                  <td>
                    <select
                        className="select-control tag-select"
                        disabled={busySource !== null}
                        value={source.source_tag}
                        onChange={(event) => updateSourceTag(source.id, event.target.value as SourceTag)}
                        aria-label={`Tag for ${source.name}`}
                      >
                        {SOURCE_TAGS.map((sourceTag) => (
                          <option key={sourceTag} value={sourceTag}>
                            {sourceTag}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <span className={`status-pill ${statusClass(source.last_status)}`}>
                        {statusIcon(source.last_status)}
                        {statusLabel(source)}
                      </span>
                    </td>
                    <td>{source.correction_count || 0}</td>
                    <td>
                      <SourceQualityCell quality={quality} source={source} />
                    </td>
                    <td>
                      <span>{formatSourceDate(source.last_source_date, source.last_snapshot_id)}</span>
                      {source.last_source_date_kind && <em className="table-note"> {sourceDateKindLabel(source.last_source_date_kind)}</em>}
                    </td>
                    <td>{formatDate(source.last_fetched_at)}</td>
                    <td>{source.last_row_count ?? "-"}</td>
                    <td>{source.access.replace("_", " ")}</td>
                    <td>
                      <div className="row-actions">
                        <button className="icon-button" title="Update source" disabled={!source.can_update || busySource !== null} onClick={() => updateSource(source.id)}>
                          <RefreshCcw size={16} className={busySource === source.id ? "spin" : ""} />
                        </button>
                        <button className="icon-button" title="Import CSV" disabled={busySource !== null} onClick={() => importCsvSource(source.id)}>
                          <Upload size={16} />
                        </button>
                        <a className="icon-button link" title="Open source" href={source.url} target="_blank" rel="noreferrer">
                          <ExternalLink size={16} />
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function SourceQualityCell({
  quality,
  source
}: {
  quality: SourceQualityMetric | null;
  source: RankingSource;
}) {
  if (!source.last_snapshot_id) return <span className="missing-rank">No snapshot</span>;
  if (!quality) return <span className="missing-rank">No data</span>;
  if (!quality || quality.peerSourceCount === 0) return <span className="missing-rank">No peers</span>;
  if (!quality.topComparisonCount) return <span className="missing-rank">No top 200 overlap</span>;

  return (
    <div className="quality-cell">
      <strong>{formatQualityScore(quality.qualityScore)}</strong>
    </div>
  );
}

type TradePlayerRow = {
  player_key: string;
  player_name: string;
  positions: string | null;
  status: string | null;
  ownerTeamName: string | null;
  mlbTeam: string | null;
  section: "hitter" | "pitcher";
  salary: number;
  points: number | null;
  pointsAreRate?: boolean;
  pointsPerGame: number | null;
  pointsPerIp: number | null;
  aggregate_rank: number | null;
  scoringRank: number | null;
  value: number | null;
  scoredValue: number | null;
  minValue: number | null;
  maxValue: number | null;
};

type TradeTotal = {
  cash: number;
  count: number;
  dropCount: number;
  salary: number;
  salaryDelta: number;
  scoredSalaryDelta: number;
  scoredValue: number;
  value: number;
  minValue: number;
  maxValue: number;
};

type CapProjection = {
  capSpace: number | null;
  currentLimit: number | null;
  currentUsed: number | null;
  overCap: boolean;
  projectedLimit: number | null;
  projectedUsed: number | null;
};

function TradeAnalyzerWorkspace({
  availableScoringValueByPlayerKey,
  availableStatsByPlayerKey,
  board,
  includedSourceTags,
  leagueRosterPlayers,
  leagueTradeBlockPlayers,
  leagueValueCurve,
  scoringValueByPlayerKey,
  leagues,
  selectedLeague,
  selectedLeagueTeams,
  selectedLeagueUid,
  setTradeSideADropPlayerKeys,
  setSelectedLeagueUid,
  setTradeSideACash,
  setTradeSideAPlayerKeys,
  setTradeSideBCash,
  setTradeSideBDropPlayerKeys,
  setTradeSideBPlayerKeys,
  setTradeSideBTeamUid,
  toggleIncludedSourceTag,
  tradeSideACash,
  tradeSideADropPlayerKeys,
  tradeSideAPlayerKeys,
  tradeSideBCash,
  tradeSideBDropPlayerKeys,
  tradeSideBPlayerKeys,
  tradeSideBTeamUid
}: {
  availableScoringValueByPlayerKey: Map<string, ScoringValueMetric>;
  availableStatsByPlayerKey: Map<string, LeagueAvailablePlayerStats>;
  board: AggregateBoard;
  includedSourceTags: SourceTag[];
  leagueRosterPlayers: LeagueRosterPlayer[];
  leagueTradeBlockPlayers: LeagueTradeBlockPlayer[];
  leagueValueCurve: LeagueValueCurve | null;
  scoringValueByPlayerKey: Map<string, ScoringValueMetric>;
  leagues: FantasyLeague[];
  selectedLeague: FantasyLeague | null;
  selectedLeagueTeams: FantasyTeam[];
  selectedLeagueUid: string;
  setTradeSideADropPlayerKeys: (playerKeys: string[]) => void;
  setSelectedLeagueUid: (leagueUid: string) => void;
  setTradeSideACash: (value: string) => void;
  setTradeSideAPlayerKeys: (playerKeys: string[]) => void;
  setTradeSideBCash: (value: string) => void;
  setTradeSideBDropPlayerKeys: (playerKeys: string[]) => void;
  setTradeSideBPlayerKeys: (playerKeys: string[]) => void;
  setTradeSideBTeamUid: (teamUid: string) => void;
  toggleIncludedSourceTag: (sourceTag: SourceTag) => void;
  tradeSideACash: string;
  tradeSideADropPlayerKeys: string[];
  tradeSideAPlayerKeys: string[];
  tradeSideBCash: string;
  tradeSideBDropPlayerKeys: string[];
  tradeSideBPlayerKeys: string[];
  tradeSideBTeamUid: string;
}) {
  const myTeam = selectedLeagueTeams.find((team) => team.team_uid === DEFAULT_MY_TEAM_UID) || selectedLeagueTeams[0] || null;
  const sideBTeams = selectedLeagueTeams.filter((team) => team.team_uid !== myTeam?.team_uid);
  const sideBIsAvailable = tradeSideBTeamUid === AVAILABLE_TEAM_UID;
  const sideBIsTradeBlock = tradeSideBTeamUid === TRADE_BLOCK_TEAM_UID;
  const sideBUsesAggregateList = sideBIsAvailable || sideBIsTradeBlock;
  const sideBTeam = sideBUsesAggregateList ? null : sideBTeams.find((team) => team.team_uid === tradeSideBTeamUid) || sideBTeams[0] || null;
  const teamKey = sideBTeams.map((team) => team.team_uid).join("|");
  const allowedSourceIds = useMemo(() => {
    return board.sources.filter((source) => includedSourceTags.includes(source.source_tag)).map((source) => source.id);
  }, [board.sources, includedSourceTags]);
  const boardPlayerByKey = useMemo(() => {
    return new Map(board.players.map((player) => [player.player_key, player]));
  }, [board.players]);
  const sideAPlayers = useMemo(() => {
    return buildTradeRows(myTeam?.team_uid || "", leagueRosterPlayers, boardPlayerByKey, leagueValueCurve, allowedSourceIds, scoringValueByPlayerKey);
  }, [allowedSourceIds, boardPlayerByKey, leagueRosterPlayers, leagueValueCurve, myTeam?.team_uid, scoringValueByPlayerKey]);
  const sideBPlayers = useMemo(() => {
    if (sideBIsAvailable) {
      return buildAvailableTradeRows(board.players, leagueRosterPlayers, leagueValueCurve, allowedSourceIds, availableStatsByPlayerKey, availableScoringValueByPlayerKey);
    }
    if (sideBIsTradeBlock) {
      return buildTradeBlockRows(leagueTradeBlockPlayers, boardPlayerByKey, leagueValueCurve, allowedSourceIds, scoringValueByPlayerKey);
    }
    return buildTradeRows(sideBTeam?.team_uid || "", leagueRosterPlayers, boardPlayerByKey, leagueValueCurve, allowedSourceIds, scoringValueByPlayerKey);
  }, [allowedSourceIds, availableScoringValueByPlayerKey, availableStatsByPlayerKey, board.players, boardPlayerByKey, leagueRosterPlayers, leagueTradeBlockPlayers, leagueValueCurve, scoringValueByPlayerKey, sideBIsAvailable, sideBIsTradeBlock, sideBTeam?.team_uid]);
  const sideACashValue = parseTradeCash(tradeSideACash);
  const sideBCashValue = parseTradeCash(tradeSideBCash);
  const sideATotal = tradeTotal(sideAPlayers, tradeSideAPlayerKeys, tradeSideADropPlayerKeys, sideACashValue);
  const sideBTotal = tradeTotal(sideBPlayers, tradeSideBPlayerKeys, tradeSideBDropPlayerKeys, sideBCashValue);
  const sideASelectedRows = selectedTradeRows(sideAPlayers, tradeSideAPlayerKeys);
  const sideBSelectedRows = selectedTradeRows(sideBPlayers, tradeSideBPlayerKeys);
  const sideADropRows = selectedTradeRows(sideAPlayers, tradeSideADropPlayerKeys);
  const sideBDropRows = selectedTradeRows(sideBPlayers, tradeSideBDropPlayerKeys);
  const sideADropsNeeded = Math.max(0, sideBSelectedRows.length - sideASelectedRows.length);
  const sideBDropsNeeded = sideBUsesAggregateList ? 0 : Math.max(0, sideASelectedRows.length - sideBSelectedRows.length);
  const sideACapProjection = buildCapProjection(myTeam, sideASelectedRows, sideBSelectedRows, sideADropRows, sideACashValue, sideBCashValue);
  const sideBCapProjection = sideBUsesAggregateList ? emptyCapProjection() : buildCapProjection(sideBTeam, sideBSelectedRows, sideASelectedRows, sideBDropRows, sideBCashValue, sideACashValue);
  const dynastyResult = tradeResult(sideATotal, sideBTotal);
  const scoringResult = scoringTradeResult(sideATotal, sideBTotal);

  useEffect(() => {
    if (!sideBUsesAggregateList && sideBTeam && sideBTeam.team_uid !== tradeSideBTeamUid) {
      setTradeSideBTeamUid(sideBTeam.team_uid);
    } else if (!sideBUsesAggregateList && !sideBTeam && tradeSideBTeamUid !== AVAILABLE_TEAM_UID) {
      setTradeSideBTeamUid(AVAILABLE_TEAM_UID);
    }
  }, [selectedLeagueUid, sideBUsesAggregateList, sideBTeam?.team_uid, teamKey, tradeSideBTeamUid, setTradeSideBTeamUid]);

  useEffect(() => {
    if (!sideBUsesAggregateList) return;
    if (sideBIsAvailable && tradeSideAPlayerKeys.length) setTradeSideAPlayerKeys([]);
    if (tradeSideBDropPlayerKeys.length) setTradeSideBDropPlayerKeys([]);
    if (sideBIsAvailable && tradeSideACash) setTradeSideACash("");
    if (tradeSideBCash) setTradeSideBCash("");
  }, [
    sideBIsAvailable,
    sideBUsesAggregateList,
    tradeSideACash,
    tradeSideAPlayerKeys.length,
    tradeSideBCash,
    tradeSideBDropPlayerKeys.length,
    setTradeSideACash,
    setTradeSideAPlayerKeys,
    setTradeSideBCash,
    setTradeSideBDropPlayerKeys
  ]);

  return (
    <main className="trade-shell">
      <section className="trade-toolbar">
        <div>
          <p className="eyebrow">Trade Analyzer</p>
          <h2>{selectedLeague?.league_name || "No league selected"}</h2>
        </div>
        <div className="trade-selectors">
          <select
            className="select-control"
            value={selectedLeagueUid}
            onChange={(event) => setSelectedLeagueUid(event.target.value)}
            aria-label="Trade analyzer league"
          >
            {leagues.map((league) => (
              <option key={league.league_uid} value={league.league_uid}>
                {league.league_name}
              </option>
            ))}
          </select>
          <div className="trade-team-lock">
            <span>Side A</span>
            <strong>{myTeam?.team_name || "-"}</strong>
          </div>
          <select
            className="select-control"
            value={sideBIsAvailable ? AVAILABLE_TEAM_UID : sideBIsTradeBlock ? TRADE_BLOCK_TEAM_UID : sideBTeam?.team_uid || ""}
            onChange={(event) => setTradeSideBTeamUid(event.target.value)}
            aria-label="Side B team"
          >
            <option value={AVAILABLE_TEAM_UID}>Available</option>
            <option value={TRADE_BLOCK_TEAM_UID}>Trade Block</option>
            {sideBTeams.map((team) => (
              <option key={team.team_uid} value={team.team_uid}>
                {team.team_name}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="trade-source-controls">
        <span>Allowed Sources</span>
        <div className="segmented tag-segmented" aria-label="Source tag groups used in trade values">
          {SOURCE_TAGS.map((sourceTag) => {
            const active = includedSourceTags.includes(sourceTag);
            return (
              <button
                key={sourceTag}
                className={active ? "active" : ""}
                onClick={() => toggleIncludedSourceTag(sourceTag)}
                title={`${active ? "Remove" : "Include"} ${sourceTag} sources in trade values.`}
                aria-label={`${active ? "Remove" : "Include"} ${sourceTag} sources in trade values`}
              >
                {sourceTag}
              </button>
            );
          })}
        </div>
      </section>

      <section className="trade-side-grid">
        <TradeSidePanel
          allowCash={!sideBIsAvailable}
          allowSend={!sideBIsAvailable}
          capProjection={sideACapProjection}
          cashSent={tradeSideACash}
          comparisonTotal={sideBTotal}
          dropRows={sideADropRows}
          dropsNeeded={sideADropsNeeded}
          rows={sideAPlayers}
          selectedDropPlayerKeys={tradeSideADropPlayerKeys}
          selectedPlayerKeys={tradeSideAPlayerKeys}
          selectedRows={sideASelectedRows}
          setCashSent={setTradeSideACash}
          setSelectedDropPlayerKeys={setTradeSideADropPlayerKeys}
          setSelectedPlayerKeys={setTradeSideAPlayerKeys}
          sideLabel="Side A Sends"
          sendLabel="Send"
          teamName={myTeam?.team_name || "-"}
          total={sideATotal}
        />
        <TradeSidePanel
          allowCash={!sideBUsesAggregateList}
          allowDrop={!sideBUsesAggregateList}
          capProjection={sideBCapProjection}
          cashSent={tradeSideBCash}
          comparisonTotal={sideATotal}
          dropRows={sideBDropRows}
          dropsNeeded={sideBDropsNeeded}
          rows={sideBPlayers}
          selectedDropPlayerKeys={tradeSideBDropPlayerKeys}
          selectedPlayerKeys={tradeSideBPlayerKeys}
          selectedRows={sideBSelectedRows}
          setCashSent={setTradeSideBCash}
          setSelectedDropPlayerKeys={setTradeSideBDropPlayerKeys}
          setSelectedPlayerKeys={setTradeSideBPlayerKeys}
          showCap={!sideBUsesAggregateList}
          sideLabel={sideBIsAvailable ? "Available Pickups" : sideBIsTradeBlock ? "Trade Block Targets" : "Side B Sends"}
          sendLabel={sideBIsAvailable ? "Pick Up" : sideBIsTradeBlock ? "Target" : "Send"}
          teamName={sideBIsAvailable ? "Available" : sideBIsTradeBlock ? "League Trade Block" : sideBTeam?.team_name || "-"}
          total={sideBTotal}
        />
      </section>

      <section className="trade-result-panel">
        <div className="trade-result-heading">
          <div>
            <p className="eyebrow">Result</p>
            <h2>{combinedTradeLabel(dynastyResult, scoringResult)}</h2>
          </div>
          <span className={`trade-result-badge ${dynastyResult.close || scoringResult.close ? "close" : ""}`}>
            Dy. {dynastyResult.badge} / Sc. {scoringResult.badge}
          </span>
        </div>
        <div className="trade-perspective-grid">
          <TradePerspectiveCard
            label="Dynasty"
            result={dynastyResult}
            sideAValue={sideATotal.value}
            sideBValue={sideBTotal.value}
          />
          <TradePerspectiveCard
            label="Scoring"
            result={scoringResult}
            sideAValue={sideATotal.scoredValue}
            sideBValue={sideBTotal.scoredValue}
          />
        </div>
        <div className="trade-balance">
          <span>Side A sends</span>
          <strong>{formatFantasyValue(sideATotal.value)}</strong>
          <div className="trade-balance-track">
            <div
              className="trade-balance-band side-a"
              style={{
                left: `${dynastyResult.sideABandLeft}%`,
                width: `${dynastyResult.sideABandWidth}%`
              }}
              title={`Side A range ${formatFantasyValue(sideATotal.minValue)} to ${formatFantasyValue(sideATotal.maxValue)}`}
            />
            <div
              className="trade-balance-band side-b"
              style={{
                left: `${dynastyResult.sideBBandLeft}%`,
                width: `${dynastyResult.sideBBandWidth}%`
              }}
              title={`Side B range ${formatFantasyValue(sideBTotal.minValue)} to ${formatFantasyValue(sideBTotal.maxValue)}`}
            />
            <div className="trade-balance-marker side-a" style={{ left: `${dynastyResult.sideAPoint}%` }} />
            <div className="trade-balance-marker side-b" style={{ left: `${dynastyResult.sideBPoint}%` }} />
          </div>
          <strong>{formatFantasyValue(sideBTotal.value)}</strong>
          <span>Side B sends</span>
        </div>
        <p className="trade-result-copy">{tradePerspectiveCopy(dynastyResult, scoringResult)}</p>
      </section>
    </main>
  );
}

function TradePerspectiveCard({
  label,
  result,
  sideAValue,
  sideBValue
}: {
  label: string;
  result: ReturnType<typeof tradeResult>;
  sideAValue: number;
  sideBValue: number;
}) {
  return (
    <div className="trade-perspective-card">
      <span>{label}</span>
      <strong>{result.label}</strong>
      <em>{result.badge}</em>
      <div>
        <small>Side A sends {formatFantasyValue(sideAValue)}</small>
        <small>Side B sends {formatFantasyValue(sideBValue)}</small>
      </div>
    </div>
  );
}

function TradeSidePanel({
  allowCash = true,
  allowDrop = true,
  allowSend = true,
  capProjection,
  cashSent,
  comparisonTotal,
  dropRows,
  dropsNeeded,
  rows,
  selectedDropPlayerKeys,
  selectedPlayerKeys,
  selectedRows,
  setCashSent,
  setSelectedDropPlayerKeys,
  setSelectedPlayerKeys,
  showCap = true,
  sideLabel,
  sendLabel = "Send",
  teamName,
  total
}: {
  allowCash?: boolean;
  allowDrop?: boolean;
  allowSend?: boolean;
  capProjection: CapProjection;
  cashSent: string;
  comparisonTotal: TradeTotal;
  dropRows: TradePlayerRow[];
  dropsNeeded: number;
  rows: TradePlayerRow[];
  selectedDropPlayerKeys: string[];
  selectedPlayerKeys: string[];
  selectedRows: TradePlayerRow[];
  setCashSent: (value: string) => void;
  setSelectedDropPlayerKeys: (playerKeys: string[]) => void;
  setSelectedPlayerKeys: (playerKeys: string[]) => void;
  showCap?: boolean;
  sideLabel: string;
  sendLabel?: string;
  teamName: string;
  total: TradeTotal;
}) {
  const [playerQuery, setPlayerQuery] = useState("");
  const [positionFilter, setPositionFilter] = useState<PositionFilter>("all");
  const [tradeSort, setTradeSort] = useState<TableSort>({ direction: "desc", key: "dyValue" });
  const remainingDropsNeeded = Math.max(0, dropsNeeded - dropRows.length);
  const valueDifference = total.value - comparisonTotal.value;
  const scoredValueDifference = total.scoredValue - comparisonTotal.scoredValue;
  const minDifference = total.minValue - comparisonTotal.maxValue;
  const maxDifference = total.maxValue - comparisonTotal.minValue;
  const salaryDifference = total.salary - comparisonTotal.salary;
  const gettingDynastyValueMinusSalary = comparisonTotal.salaryDelta;
  const gettingScoringValueMinusSalary = comparisonTotal.scoredSalaryDelta;
  const selectedListTitle = sendLabel === "Pick Up" ? "Pickups" : sendLabel === "Target" ? "Targets" : "In Trade";
  const positionOptions = useMemo(() => buildTradePositionOptions(rows), [rows]);
  const filteredRows = useMemo(() => {
    const normalizedQuery = playerQuery.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesQuery = !normalizedQuery || row.player_name.toLowerCase().includes(normalizedQuery);
      const matchesPosition = positionMatchesFilter(row.positions, positionFilter);
      return matchesQuery && matchesPosition;
    });
  }, [playerQuery, positionFilter, rows]);
  const sortedRows = useMemo(() => sortTradeRows(filteredRows, tradeSort), [filteredRows, tradeSort]);
  const tradeWindow = useTableWindow(sortedRows.length, TRADE_ROW_HEIGHT, TRADE_OVERSCAN_ROWS);
  const renderedRows = sortedRows.slice(tradeWindow.startIndex, tradeWindow.endIndex);
  const selectedPlayerKeySet = useMemo(() => new Set(selectedPlayerKeys), [selectedPlayerKeys]);
  const selectedDropPlayerKeySet = useMemo(() => new Set(selectedDropPlayerKeys), [selectedDropPlayerKeys]);

  useEffect(() => {
    if (!positionOptions.includes(positionFilter)) {
      setPositionFilter("all");
    }
  }, [positionFilter, positionOptions]);

  return (
    <article className="trade-side-panel">
      <div className="trade-side-heading">
        <div>
          <p className="eyebrow">{sideLabel}</p>
          <h2>{teamName}</h2>
          <span>
            {total.count} {sendLabel.toLowerCase()}, {allowDrop ? total.dropCount : 0} drop
            {total.cash ? `, ${formatMoney(total.cash)} cash` : ""} - {formatMoney(total.salary)} salary - Dy. Val +/-{" "}
            <SignedValue value={total.salaryDelta} />
          </span>
        </div>
        <div className="trade-side-value">
          <strong>{formatFantasyValue(total.value)}</strong>
          <span>Dy. FV {formatFantasyValue(total.minValue)} - {formatFantasyValue(total.maxValue)}</span>
          <span>Sc. Val {formatFantasyValue(total.scoredValue)}</span>
        </div>
      </div>
      <div className="trade-side-diffs">
        <div>
          <span>Dy. FV Diff</span>
          <strong><SignedValue value={valueDifference} /></strong>
        </div>
        <div>
          <span>Sc. Val Diff</span>
          <strong><SignedValue value={scoredValueDifference} /></strong>
        </div>
        <div>
          <span>Dy. Range Diff</span>
          <strong><SignedValue value={minDifference} /> to <SignedValue value={maxDifference} /></strong>
        </div>
        <div>
          <span>Salary Diff</span>
          <strong><SignedValue value={salaryDifference} /></strong>
        </div>
        <div>
          <span>Getting Dy. Val +/-</span>
          <strong><SignedValue value={gettingDynastyValueMinusSalary} /></strong>
        </div>
        <div>
          <span>Getting Sc. Val +/-</span>
          <strong><SignedValue value={gettingScoringValueMinusSalary} /></strong>
        </div>
      </div>
      {showCap && <TradeCapSummary capProjection={capProjection} />}
      <div className="trade-side-controls">
        <div className="trade-search-box">
          <Search size={16} />
          <input
            value={playerQuery}
            onChange={(event) => setPlayerQuery(event.target.value)}
            placeholder="Search player"
            aria-label={`${sideLabel} player search`}
          />
        </div>
        <label className="trade-position-filter">
          <span>Pos</span>
          <select
            className="select-control"
            value={positionFilter}
            onChange={(event) => setPositionFilter(event.target.value as PositionFilter)}
            aria-label={`${sideLabel} position filter`}
          >
            {positionOptions.map((position) => (
              <option key={position} value={position}>
                {position === "all" ? "All Pos" : position}
              </option>
            ))}
          </select>
        </label>
        <span className="trade-filter-count">
          {filteredRows.length.toLocaleString()} / {rows.length.toLocaleString()}
        </span>
        {allowDrop && dropsNeeded > 0 && (
          <span className={`drop-fit-badge ${remainingDropsNeeded ? "" : "complete"}`}>
            Taking on +{dropsNeeded} - {remainingDropsNeeded ? `drop ${remainingDropsNeeded} to fit` : "drops covered"}
          </span>
        )}
      </div>
      <div className="trade-table-wrap" onScroll={tradeWindow.onScroll}>
        <table className="trade-player-table">
          <thead>
            <tr>
              <th className="check-col">{sendLabel}</th>
              <th className="check-col">Drop</th>
              <SortableHeader className="player-col" label="Player" sort={tradeSort} sortKey="player" setSort={setTradeSort} />
              <SortableHeader label="Owner" sort={tradeSort} sortKey="owner" setSort={setTradeSort} />
              <SortableHeader label="Dy. Agg" sort={tradeSort} sortKey="dyAgg" setSort={setTradeSort} />
              <SortableHeader label="Sc. Agg" sort={tradeSort} sortKey="scAgg" setSort={setTradeSort} />
              <SortableHeader label="Pos" sort={tradeSort} sortKey="positions" setSort={setTradeSort} />
              <SortableHeader label="Salary" sort={tradeSort} sortKey="salary" setSort={setTradeSort} defaultDirection="desc" />
              <SortableHeader label="Pts" sort={tradeSort} sortKey="points" setSort={setTradeSort} defaultDirection="desc" />
              <SortableHeader label="Rate" sort={tradeSort} sortKey="rate" setSort={setTradeSort} defaultDirection="desc" />
              <SortableHeader label="Dy. FV" sort={tradeSort} sortKey="dyValue" setSort={setTradeSort} defaultDirection="desc" />
              <SortableHeader label="Sc. Val" sort={tradeSort} sortKey="scValue" setSort={setTradeSort} defaultDirection="desc" title="Scoring value from total-points rank fitted to the league salary curve." />
              <SortableHeader label="Dy. Val +/-" sort={tradeSort} sortKey="dyDelta" setSort={setTradeSort} defaultDirection="desc" title="Dy. FV - Salary" />
              <SortableHeader label="Sc. Val +/-" sort={tradeSort} sortKey="scDelta" setSort={setTradeSort} defaultDirection="desc" title="Sc. Val - Salary" />
              <SortableHeader label="Dy. Min" sort={tradeSort} sortKey="dyMin" setSort={setTradeSort} defaultDirection="desc" />
              <SortableHeader label="Dy. Max" sort={tradeSort} sortKey="dyMax" setSort={setTradeSort} defaultDirection="desc" />
            </tr>
          </thead>
          <tbody>
            {sortedRows.length ? (
              <>
                <TableSpacerRow colSpan={16} height={tradeWindow.beforeHeight} />
                {renderedRows.map((row) => {
              const selected = selectedPlayerKeySet.has(row.player_key);
              const dropSelected = selectedDropPlayerKeySet.has(row.player_key);
              return (
                <tr className={selected ? "selected" : dropSelected ? "drop-selected" : ""} key={row.player_key}>
                  <td className="check-col">
                    {allowSend ? (
                      <input
                        aria-label={`${sendLabel} ${row.player_name}`}
                        checked={selected}
                        onChange={() => {
                          setSelectedPlayerKeys(toggleKey(selectedPlayerKeys, row.player_key));
                          if (!selected) setSelectedDropPlayerKeys(selectedDropPlayerKeys.filter((key) => key !== row.player_key));
                        }}
                        type="checkbox"
                      />
                    ) : (
                      <span className="disabled-action">-</span>
                    )}
                  </td>
                  <td className="check-col">
                    {allowDrop ? (
                      <input
                        aria-label={`Drop ${row.player_name}`}
                        checked={dropSelected}
                        onChange={() => {
                          setSelectedDropPlayerKeys(toggleKey(selectedDropPlayerKeys, row.player_key));
                          if (!dropSelected) setSelectedPlayerKeys(selectedPlayerKeys.filter((key) => key !== row.player_key));
                        }}
                        type="checkbox"
                      />
                    ) : (
                      <span className="disabled-action">-</span>
                    )}
                  </td>
                  <td className="player-col">
                    <strong>{row.player_name}</strong>
                    <RosterStatusBadge mlbTeam={row.mlbTeam} status={row.status} />
                  </td>
                  <td>{row.ownerTeamName || "-"}</td>
                  <td>{row.aggregate_rank ? `#${row.aggregate_rank}` : "-"}</td>
                  <td>{row.scoringRank ? `#${row.scoringRank}` : "-"}</td>
                  <td>{row.positions || "-"}</td>
                  <td>{formatMoney(row.salary)}</td>
                  <td>{formatTradePoints(row)}</td>
                  <td>{formatRate(row)}</td>
                  <td>{formatFantasyValue(row.value)}</td>
                  <td>{formatFantasyValue(row.scoredValue)}</td>
                  <td><ValueMinusSalary value={row.value} salary={row.salary} /></td>
                  <td><ValueMinusSalary value={row.scoredValue} salary={row.salary} /></td>
                  <td>{formatFantasyValue(row.minValue)}</td>
                  <td>{formatFantasyValue(row.maxValue)}</td>
                </tr>
              );
              })}
                <TableSpacerRow colSpan={16} height={tradeWindow.afterHeight} />
              </>
            ) : (
              <tr>
                <td className="empty-table-cell" colSpan={16}>No players match these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {allowCash && (
        <div className="trade-cash-control">
          <label>
            <span>Cash Sent</span>
            <div className="cash-input-wrap">
              <span>$</span>
              <input
                aria-label={`${sideLabel} cash sent`}
                inputMode="numeric"
                min="0"
                onChange={(event) => setCashSent(event.target.value)}
                placeholder="0"
                step="1"
                type="number"
                value={cashSent}
              />
            </div>
          </label>
          <span>Adds to Dy. FV and Sc. Val; player salary is unchanged.</span>
        </div>
      )}
      <TradeSelectedList emptyText="No players selected." rows={selectedRows} title={selectedListTitle} />
      {allowDrop && <TradeSelectedList emptyText="No drops selected." rows={dropRows} title="Drops To Fit" valuePrefix="-" />}
    </article>
  );
}

function TradeSelectedList({
  emptyText,
  rows,
  title,
  valuePrefix = ""
}: {
  emptyText: string;
  rows: TradePlayerRow[];
  title: string;
  valuePrefix?: string;
}) {
  return (
    <div className="trade-selected-list">
      <div className="trade-selected-heading">
        <span>{title}</span>
        <strong>{rows.length}</strong>
      </div>
      {rows.length ? (
        <div className="trade-selected-items">
          {rows.map((row) => (
            <div className="trade-selected-item" key={row.player_key}>
              <div>
                <strong>{row.player_name}</strong>
                <RosterStatusBadge mlbTeam={row.mlbTeam} status={row.status} />
                <span>
                  {row.positions || "-"} - Dy. {row.aggregate_rank ? `#${row.aggregate_rank}` : "unranked"} - Sc.{" "}
                  {row.scoringRank ? `#${row.scoringRank}` : "unranked"} - {formatMoney(row.salary)}
                  {row.ownerTeamName ? ` - ${row.ownerTeamName}` : ""}
                </span>
              </div>
              <div className="trade-selected-values">
                <strong>
                  {valuePrefix ? formatFantasyValue(typeof row.value === "number" ? -row.value : row.value) : formatFantasyValue(row.value)}
                </strong>
                <span>
                  Sc. {valuePrefix ? formatFantasyValue(typeof row.scoredValue === "number" ? -row.scoredValue : row.scoredValue) : formatFantasyValue(row.scoredValue)} - {formatTradePointsSummary(row)} - {formatRate(row)}
                </span>
                <span>
                  {valuePrefix
                    ? `${formatFantasyValue(typeof row.maxValue === "number" ? -row.maxValue : row.maxValue)} - ${formatFantasyValue(typeof row.minValue === "number" ? -row.minValue : row.minValue)}`
                    : `${formatFantasyValue(row.minValue)} - ${formatFantasyValue(row.maxValue)}`}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="trade-selected-empty">{emptyText}</p>
      )}
    </div>
  );
}

function TradeCapSummary({ capProjection }: { capProjection: CapProjection }) {
  if (capProjection.currentUsed === null || capProjection.currentLimit === null) {
    return (
      <div className="trade-cap-summary">
        <div>
          <span>Cap</span>
          <strong>No cap data</strong>
        </div>
      </div>
    );
  }

  return (
    <div className={`trade-cap-summary ${capProjection.overCap ? "over" : ""}`}>
      <div>
        <span>Current Cap</span>
        <strong>
          {formatMoney(capProjection.currentUsed)} of {formatMoney(capProjection.currentLimit)}
        </strong>
      </div>
      <div>
        <span>After Trade</span>
        <strong>
          {formatMoney(capProjection.projectedUsed)} of {formatMoney(capProjection.projectedLimit)}
        </strong>
      </div>
      <div>
        <span>Cap Space</span>
        <strong>{formatMoney(capProjection.capSpace)}</strong>
      </div>
      {capProjection.overCap && <em>Over cap</em>}
    </div>
  );
}

function buildTradePositionOptions(rows: TradePlayerRow[]): PositionFilter[] {
  return POSITION_FILTERS.filter((position) => position === "all" || rows.some((row) => positionMatchesFilter(row.positions, position)));
}

function LineupHelperWorkspace({
  leagues,
  selectedLeague,
  selectedLeagueTeams,
  selectedLeagueUid,
  setSelectedLeagueUid,
  setToast
}: {
  leagues: FantasyLeague[];
  selectedLeague: FantasyLeague | null;
  selectedLeagueTeams: FantasyTeam[];
  selectedLeagueUid: string;
  setSelectedLeagueUid: (leagueUid: string) => void;
  setToast: (message: string) => void;
}) {
  const myTeam = selectedLeagueTeams.find((team) => team.team_uid === DEFAULT_MY_TEAM_UID) || selectedLeagueTeams[0] || null;
  const [teamUid, setTeamUid] = useState(myTeam?.team_uid || "");
  const [dateOptions, setDateOptions] = useState<LineupDateOption[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [rows, setRows] = useState<LineupRecommendationRow[]>([]);
  const [summary, setSummary] = useState<LineupRecommendationResponse | null>(null);
  const [lineupOptimizer, setLineupOptimizer] = useState<LineupOptimizerResult | null>(null);
  const [csvText, setCsvText] = useState("");
  const [xfipDeltaFactor, setXfipDeltaFactor] = useState(1);
  const [busy, setBusy] = useState<"dates" | "starters" | "import" | null>(null);
  const [busyPlayerKey, setBusyPlayerKey] = useState<string | null>(null);
  const selectedTeam = selectedLeagueTeams.find((team) => team.team_uid === teamUid) || myTeam;
  const selectedTeamUid = selectedTeam?.team_uid || "";
  const lineupDisplayRows = useMemo(() => buildLineupDisplayRows(rows, lineupOptimizer, xfipDeltaFactor), [lineupOptimizer, rows, xfipDeltaFactor]);
  const recommendationCounts = useMemo(() => {
    return rows.reduce(
      (counts, row) => {
        counts[row.recommendation_code] = (counts[row.recommendation_code] || 0) + 1;
        return counts;
      },
      {} as Partial<Record<LineupRecommendationRow["recommendation_code"], number>>
    );
  }, [rows]);

  useEffect(() => {
    if (!selectedLeagueTeams.length) {
      setTeamUid("");
      return;
    }
    if (!selectedLeagueTeams.some((team) => team.team_uid === teamUid)) {
      setTeamUid(myTeam?.team_uid || selectedLeagueTeams[0].team_uid);
    }
  }, [myTeam?.team_uid, selectedLeagueTeams, teamUid]);

  useEffect(() => {
    setRows([]);
    setSummary(null);
    setLineupOptimizer(null);
  }, [selectedDate, selectedLeagueUid, teamUid]);

  async function fetchDates() {
    setBusy("dates");
    try {
      const response = await fetchJson<{ dates: LineupDateOption[] }>("/api/lineup/dates?days=10");
      setDateOptions(response.dates);
      const preferredDate = response.dates.find((option) => option.probable_starter_count > 0)?.date || response.dates[0]?.date || "";
      setSelectedDate(preferredDate);
      setRows([]);
      setSummary(null);
      setLineupOptimizer(null);
      setToast(response.dates.length ? "Available starter dates loaded." : "No starter dates found.");
    } catch (error) {
      setToast(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function getStarterData() {
    if (!selectedLeagueUid || !teamUid || !selectedDate) return;
    setBusy("starters");
    try {
      const params = new URLSearchParams({
        league_uid: selectedLeagueUid,
        team_uid: teamUid,
        date: selectedDate
      });
      const response = await fetchJson<LineupRecommendationResponse>(`/api/lineup/recommendations?${params}`);
      setSummary(response);
      setRows(response.rows);
      setLineupOptimizer(null);
      setToast(`Starter data loaded for ${response.rows.length} active hitters.`);
    } catch (error) {
      setToast(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  function optimizeSelectedLineup() {
    if (!rows.length) {
      setToast("Get starter data before optimizing the lineup.");
      return;
    }
    const result = optimizeLineup(rows, xfipDeltaFactor);
    setLineupOptimizer(result);
    setToast(`Optimized ${result.starterCount}/${LINEUP_SLOTS.length} lineup slots for ${formatDecimal(result.totalPoints)} estimated points.`);
  }

  async function importPitcherStats() {
    if (!csvText.trim()) return;
    setBusy("import");
    try {
      const result = await postJson<LineupPitcherStatsImportResult>("/api/lineup/pitcher-stats/import", {
        csv_text: csvText,
        season: new Date().getFullYear(),
        source: "FanGraphs CSV"
      });
      setCsvText("");
      setToast(result.message);
      setLineupOptimizer(null);
    } catch (error) {
      setToast(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function toggleAlwaysStart(row: LineupRecommendationRow, alwaysStart: boolean) {
    if (!selectedLeagueUid || !teamUid) return;
    setBusyPlayerKey(row.player_key);
    try {
      await postJson<{ status: "success"; always_start: boolean }>("/api/lineup/always-start", {
        league_uid: selectedLeagueUid,
        team_uid: teamUid,
        player_key: row.player_key,
        player_name: row.player_name,
        always_start: alwaysStart
      });
      setRows((current) =>
        sortLineupRows(
          current.map((item) => {
            if (item.player_key !== row.player_key) return item;
            const nextAlwaysSit = alwaysStart ? false : item.always_sit;
            const recommendation = recommendationForLineupRow(item, alwaysStart, nextAlwaysSit);
            return {
              ...item,
              always_start: alwaysStart,
              always_sit: nextAlwaysSit,
              recommendation: recommendation.label,
              recommendation_code: recommendation.code
            };
          })
        )
      );
      setLineupOptimizer(null);
      setToast(alwaysStart ? "Locked player saved. Re-run the optimizer to update slots." : "Locked player removed. Re-run the optimizer to update slots.");
    } catch (error) {
      setToast(errorMessage(error));
    } finally {
      setBusyPlayerKey(null);
    }
  }

  async function toggleAlwaysSit(row: LineupRecommendationRow, alwaysSit: boolean) {
    if (!selectedLeagueUid || !teamUid) return;
    setBusyPlayerKey(row.player_key);
    try {
      await postJson<{ status: "success"; always_sit: boolean }>("/api/lineup/always-sit", {
        league_uid: selectedLeagueUid,
        team_uid: teamUid,
        player_key: row.player_key,
        player_name: row.player_name,
        always_sit: alwaysSit
      });
      setRows((current) =>
        sortLineupRows(
          current.map((item) => {
            if (item.player_key !== row.player_key) return item;
            const nextAlwaysStart = alwaysSit ? false : item.always_start;
            const recommendation = recommendationForLineupRow(item, nextAlwaysStart, alwaysSit);
            return {
              ...item,
              always_start: nextAlwaysStart,
              always_sit: alwaysSit,
              recommendation: recommendation.label,
              recommendation_code: recommendation.code
            };
          })
        )
      );
      setLineupOptimizer(null);
      setToast(alwaysSit ? "Sit preference saved. Re-run the optimizer to update slots." : "Sit preference removed. Re-run the optimizer to update slots.");
    } catch (error) {
      setToast(errorMessage(error));
    } finally {
      setBusyPlayerKey(null);
    }
  }

  return (
    <main className="workspace lineup-workspace">
      <aside className="sources-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Lineup Helper</p>
            <h2>{selectedLeague?.league_name || "No league selected"}</h2>
          </div>
          <CalendarDays size={22} />
        </div>

        <section className="team-import-card">
          <label>League</label>
          <select className="select-control" value={selectedLeagueUid} onChange={(event) => setSelectedLeagueUid(event.target.value)}>
            {leagues.map((league) => (
              <option key={league.league_uid} value={league.league_uid}>
                {league.league_name}
              </option>
            ))}
          </select>

          <label>Team</label>
          <select className="select-control" value={selectedTeam?.team_uid || ""} onChange={(event) => setTeamUid(event.target.value)}>
            {selectedLeagueTeams.map((team) => (
              <option key={team.team_uid} value={team.team_uid}>
                {team.team_name}
              </option>
            ))}
          </select>

          <button className="button primary" type="button" onClick={() => fetchDates()} disabled={busy !== null || !selectedLeagueUid}>
            <RefreshCcw size={17} className={busy === "dates" ? "spin" : ""} />
            Fetch Available Dates
          </button>

          <label>Date</label>
          <select
            className="select-control"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
            disabled={!dateOptions.length}
          >
            {dateOptions.length ? (
              dateOptions.map((option) => (
                <option key={option.date} value={option.date}>
                  {formatPlainDate(option.date)} - {option.probable_starter_count}/{option.game_count * 2} starters
                </option>
              ))
            ) : (
              <option value="">Fetch first</option>
            )}
          </select>

          <button
            className="button ghost"
            type="button"
            onClick={() => getStarterData()}
            disabled={busy !== null || !selectedLeagueUid || !selectedTeam || !selectedDate}
          >
            <Database size={17} className={busy === "starters" ? "spin" : ""} />
            Get Starter Data
          </button>

          <button
            className="button ghost"
            type="button"
            onClick={optimizeSelectedLineup}
            disabled={busy !== null || !rows.length}
          >
            <CheckCircle2 size={17} />
            Optimize Lineup
          </button>

          <label>xFIP Factor</label>
          <input
            aria-label="xFIP adjustment factor"
            inputMode="decimal"
            min="0"
            onChange={(event) => {
              const parsed = Number(event.target.value);
              setXfipDeltaFactor(Number.isFinite(parsed) ? parsed : 1);
              setLineupOptimizer(null);
            }}
            step="0.1"
            title="Multiplier for the xFIP- delta from 100 in Est. Pts. Default is 1."
            type="number"
            value={xfipDeltaFactor}
          />
        </section>

        <section className="team-import-card lineup-import-card">
          <label>Pitcher xFIP- CSV</label>
          <textarea
            value={csvText}
            onChange={(event) => setCsvText(event.target.value)}
            spellCheck={false}
            placeholder={"Name,xFIP-\nTarik Skubal,74\nPaul Skenes,78\nLogan Webb,92"}
          />
          <button className="button primary" type="button" onClick={importPitcherStats} disabled={busy !== null || !csvText.trim()}>
            <Upload size={17} className={busy === "import" ? "spin" : ""} />
            Import xFIP-
          </button>
        </section>
      </aside>

      <section className="rankings-panel">
        <div className="team-heading">
          <div>
            <p className="eyebrow">Recommendations</p>
            <h2>{selectedTeam?.team_name || "Select a team"}</h2>
          </div>
        </div>

        <div className="board-summary lineup-summary">
          <Metric label="Hitters" value={rows.length.toLocaleString()} />
          <Metric label="Games" value={(summary?.game_count || 0).toLocaleString()} />
          <Metric label="Probables" value={(summary?.probable_starter_count || 0).toLocaleString()} />
          <Metric label="xFIP Rows" value={(summary?.pitcher_stats_count || 0).toLocaleString()} />
          <Metric label="Refreshed" value={(summary?.xfip_refresh?.row_count || 0).toLocaleString()} />
          <Metric label="Starters" value={lineupOptimizer ? `${lineupOptimizer.starterCount}/${LINEUP_SLOTS.length}` : "-"} />
          <Metric label="Opt Est Pts" value={lineupOptimizer ? formatDecimal(lineupOptimizer.totalPoints) : "-"} />
          <Metric label="Lean Start" value={(recommendationCounts["lean-start"] || 0).toLocaleString()} />
          <Metric label="Lean Sit" value={(recommendationCounts["lean-sit"] || 0).toLocaleString()} />
        </div>

        {summary && (
          <div className={`lineup-notice ${summary.xfip_refresh?.row_count ? "success" : ""}`}>
            {summary.xfip_refresh?.message ||
              (summary.pitcher_stats_count === 0
                ? "No pitcher xFIP- rows are saved locally yet."
                : "Using saved pitcher xFIP- rows.")}
          </div>
        )}

        {lineupOptimizer?.warning && <div className="lineup-notice">{lineupOptimizer.warning}</div>}

        <div className="table-wrap lineup-table-wrap">
          {rows.length ? (
            <table className="lineup-table">
              <thead>
                <tr>
                  <th className="check-col" title="Locked always-start player">Locked</th>
                  <th className="check-col" title="Force player to the bench in the optimizer">Sit</th>
                  <th>Slot</th>
                  <th className="player-col">Player</th>
                  <th>Pos</th>
                  <th>MLB</th>
                  <th>Salary</th>
                  <th>Pts</th>
                  <th>P/G</th>
                  <th title={`P/G multiplied by 100 + ((xFIP- - 100) * ${formatDecimal(xfipDeltaFactor)}) percent.`}>Est. Pts</th>
                  <th>Opp</th>
                  <th className="player-col">Starter</th>
                  <th>xFIP-</th>
                  <th>Lean</th>
                </tr>
              </thead>
              <tbody>
                {lineupDisplayRows.map(({ assignment, row }) => (
                  <tr className={assignment ? "lineup-starter-row" : ""} key={row.player_key}>
                    <td className="check-col">
                      <input
                        aria-label={`Lock ${row.player_name}`}
                        checked={row.always_start}
                        disabled={busyPlayerKey !== null}
                        onChange={(event) => toggleAlwaysStart(row, event.target.checked)}
                        title={`Always start ${row.player_name}`}
                        type="checkbox"
                      />
                    </td>
                    <td className="check-col">
                      <input
                        aria-label={`Sit ${row.player_name}`}
                        checked={row.always_sit}
                        disabled={busyPlayerKey !== null}
                        onChange={(event) => toggleAlwaysSit(row, event.target.checked)}
                        title={`Keep ${row.player_name} on the bench`}
                        type="checkbox"
                      />
                    </td>
                    <td>
                      <span className={`lineup-slot-pill ${assignment ? "starter" : lineupOptimizer ? "bench" : "pending"}`}>
                        {assignment?.label || (lineupOptimizer ? "Bench" : "-")}
                      </span>
                    </td>
                    <td className="player-col">
                      <strong>{row.player_name}</strong>
                      <RosterStatusBadge mlbTeam={row.mlb_team} status={row.status} />
                    </td>
                    <td>{row.positions || "-"}</td>
                    <td>{row.mlb_team || "-"}</td>
                    <td>{formatMoney(row.salary)}</td>
                    <td>{formatDecimal(row.points)}</td>
                    <td>{formatDecimal(row.points_per_game)}</td>
                    <td>{formatEstimatedLineupPoints(row, xfipDeltaFactor)}</td>
                    <td>{row.opponent_team || "-"}</td>
                    <td className="player-col lineup-pitcher-cell">
                      <strong>{row.opposing_pitcher_name || "-"}</strong>
                      {row.opponent_name && <span>{row.opponent_name}</span>}
                    </td>
                    <td><LineupXfipValue value={row.opposing_pitcher_xfip_minus} /></td>
                    <td>
                      <span className={`lineup-pill ${row.recommendation_code}`}>{row.recommendation}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-state">Fetch available dates, choose a date, then get starter data.</div>
          )}
        </div>

        {summary && (
          <div className="lineup-unavailable-grid">
            <LineupUnavailableSection emptyText="No IL players on this roster." players={summary.il_players} title="IL Players" />
            <LineupUnavailableSection
              emptyText="No minor leaguers on this roster."
              players={summary.minor_league_players}
              title="Minor Leagues"
            />
          </div>
        )}
      </section>
    </main>
  );
}

function LineupUnavailableSection({
  emptyText,
  players,
  title
}: {
  emptyText: string;
  players: LineupUnavailablePlayer[];
  title: string;
}) {
  return (
    <section className="lineup-unavailable-section">
      <div className="trade-selected-heading">
        <span>{title}</span>
        <strong>{players.length}</strong>
      </div>
      {players.length ? (
        <div className="table-wrap lineup-unavailable-wrap">
          <table className="lineup-unavailable-table">
            <thead>
              <tr>
                <th className="player-col">Player</th>
                <th>Status</th>
                <th>Type</th>
                <th>Team</th>
                <th>Pos</th>
                <th>Salary</th>
                <th>Pts</th>
                <th>Rate</th>
              </tr>
            </thead>
            <tbody>
              {players.map((player) => (
                <tr key={player.player_key}>
                  <td className="player-col">
                    <strong>{player.player_name}</strong>
                    <RosterStatusBadge mlbTeam={player.mlb_team} status={player.status} />
                  </td>
                  <td>{player.availability_label}</td>
                  <td>{player.section === "hitter" ? "Bat" : "Pit"}</td>
                  <td>{player.mlb_team || "-"}</td>
                  <td>{player.positions || "-"}</td>
                  <td>{formatMoney(player.salary)}</td>
                  <td>{formatDecimal(player.points)}</td>
                  <td>{formatUnavailableRate(player)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="panel-empty">{emptyText}</p>
      )}
    </section>
  );
}

function TeamsWorkspace({
  busyLeague,
  busyTeam,
  importLeague,
  importTeam,
  leagueUrl,
  leagues,
  leaguesLoading,
  removeLeague,
  removeTeam,
  selectedLeague,
  selectedLeagueTeams,
  selectedLeagueUid,
  setLeagueUrl,
  setSelectedLeagueUid,
  setTeamUrl,
  teams,
  teamsLoading,
  teamUrl,
  updateTeam,
  updateSelectedLeague,
}: {
  busyLeague: string | null;
  busyTeam: string | null;
  importLeague: () => void;
  importTeam: () => void;
  leagueUrl: string;
  leagues: FantasyLeague[];
  leaguesLoading: boolean;
  removeLeague: (leagueUid: string, leagueName: string) => void;
  removeTeam: (teamUid: string, teamName: string) => void;
  selectedLeague: FantasyLeague | null;
  selectedLeagueTeams: FantasyTeam[];
  selectedLeagueUid: string;
  setLeagueUrl: (url: string) => void;
  setSelectedLeagueUid: (leagueUid: string) => void;
  setTeamUrl: (url: string) => void;
  teams: FantasyTeam[];
  teamsLoading: boolean;
  teamUrl: string;
  updateTeam: (teamUid: string) => void;
  updateSelectedLeague: () => void;
}) {
  const loadedTeamCount = selectedLeagueTeams.filter((team) => team.last_snapshot_id !== null).length;
  const selectedRosteredCount = selectedLeagueTeams.reduce((total, team) => total + (team.last_roster_count || 0), 0);

  return (
    <main className="workspace">
      <aside className="sources-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Teams / Leagues</p>
            <h2>{leagues.length || 0} leagues</h2>
          </div>
          <Users size={22} />
        </div>

        <form
          className="team-import-card"
          onSubmit={(event) => {
            event.preventDefault();
            importLeague();
          }}
        >
          <label htmlFor="league-url">Ottoneu league URL</label>
          <input
            id="league-url"
            value={leagueUrl}
            onChange={(event) => setLeagueUrl(event.target.value)}
            placeholder="https://ottoneu.fangraphs.com/1900/home"
          />
          <div className="inline-actions">
            <button className="button primary" type="submit" disabled={busyLeague !== null || !leagueUrl.trim()}>
              <Upload size={17} className={busyLeague === "import" ? "spin" : ""} />
              Import League
            </button>
            <button className="button ghost" type="button" onClick={updateSelectedLeague} disabled={!selectedLeagueUid || busyLeague !== null}>
              <RefreshCcw size={17} className={busyLeague === selectedLeagueUid ? "spin" : ""} />
              Update
            </button>
          </div>
        </form>

        <div className="league-list">
          {leaguesLoading ? (
            <div className="empty-card compact">Loading leagues...</div>
          ) : leagues.length ? (
            leagues.map((league) => (
              <article
                className={`league-item ${selectedLeagueUid === league.league_uid ? "active" : ""}`}
                key={league.league_uid}
              >
                <button className="league-select" onClick={() => setSelectedLeagueUid(league.league_uid)} type="button">
                  <strong>{league.league_name}</strong>
                  <span>
                    {league.loaded_team_count}/{league.team_count} teams - {league.rostered_player_count} rostered
                  </span>
                </button>
                <div className="item-actions">
                  <a className="icon-button link" href={league.url} target="_blank" rel="noreferrer" title="Open league">
                    <ExternalLink size={16} />
                  </a>
                  <button
                    className="icon-button danger"
                    onClick={() => removeLeague(league.league_uid, league.league_name)}
                    disabled={busyLeague !== null}
                    title="Remove league"
                    type="button"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            ))
          ) : (
            <div className="empty-card compact">Import a league URL to enable roster ownership overlays.</div>
          )}
        </div>

        <form
          className="team-import-card"
          onSubmit={(event) => {
            event.preventDefault();
            importTeam();
          }}
        >
          <label htmlFor="team-url">Ottoneu team URL</label>
          <input
            id="team-url"
            value={teamUrl}
            onChange={(event) => setTeamUrl(event.target.value)}
            placeholder="https://ottoneu.fangraphs.com/1900/team/12519"
          />
          <button className="button primary" type="submit" disabled={busyTeam !== null || !teamUrl.trim()}>
            <Upload size={17} className={busyTeam === "import" ? "spin" : ""} />
            Import
          </button>
        </form>

        <div className="sidebar-section-title">Imported Teams</div>
        <div className="team-management-list">
          {teamsLoading ? (
            <div className="empty-card compact">Loading teams...</div>
          ) : teams.length ? (
            teams.map((team) => (
              <article className="team-management-item" key={team.team_uid}>
                <button
                  className="team-select"
                  onClick={() => {
                    const league = leagues.find((item) => item.league_id === team.league_id);
                    if (league) setSelectedLeagueUid(league.league_uid);
                  }}
                  type="button"
                >
                  <strong>{team.team_name}</strong>
                  <span>{team.league_name || `League ${team.league_id}`}</span>
                </button>
                <button
                  className="icon-button danger"
                  onClick={() => removeTeam(team.team_uid, team.team_name)}
                  disabled={busyTeam !== null}
                  title="Remove team"
                  type="button"
                >
                  <Trash2 size={16} />
                </button>
              </article>
            ))
          ) : (
            <div className="empty-card compact">Import an Ottoneu team URL to get started.</div>
          )}
        </div>
      </aside>

      <section className="rankings-panel">
        {!selectedLeague ? (
          <div className="empty-state">No league selected.</div>
        ) : (
          <>
            <div className="team-heading">
              <div>
                <p className="eyebrow">League Overview</p>
                <h2>{selectedLeague.league_name}</h2>
              </div>
              <div className="source-actions">
                <a className="icon-button link" href={selectedLeague.url} target="_blank" rel="noreferrer" title="Open league">
                  <ExternalLink size={17} />
                </a>
                <button className="icon-button" onClick={updateSelectedLeague} disabled={busyLeague !== null} title="Update league" type="button">
                  <RefreshCcw size={17} className={busyLeague === selectedLeagueUid ? "spin" : ""} />
                </button>
                <button
                  className="icon-button danger"
                  onClick={() => removeLeague(selectedLeague.league_uid, selectedLeague.league_name)}
                  disabled={busyLeague !== null}
                  title="Remove league"
                  type="button"
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </div>

            <div className="board-summary team-summary">
              <Metric label="Teams" value={selectedLeague.team_count.toLocaleString()} />
              <Metric label="Loaded" value={loadedTeamCount.toLocaleString()} />
              <Metric label="Rostered" value={selectedRosteredCount.toLocaleString()} />
              <Metric label="Saved Teams" value={teams.length.toLocaleString()} />
            </div>

            {selectedLeagueTeams.length ? (
              <div className="table-wrap league-overview-wrap">
                <table className="league-overview-table">
                  <thead>
                    <tr>
                      <th className="rank-col">Rank</th>
                      <th className="player-col">Team</th>
                      <th>Owner</th>
                      <th>Roster</th>
                      <th>Cap</th>
                      <th>Points</th>
                      <th>Change</th>
                      <th>Updated</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedLeagueTeams.map((team) => (
                      <TeamOverviewRow
                        busyTeam={busyTeam}
                        key={team.team_uid}
                        removeTeam={removeTeam}
                        team={team}
                        updateTeam={updateTeam}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">No teams loaded for this league.</div>
            )}
          </>
        )}
      </section>
    </main>
  );
}

function TeamOverviewRow({
  busyTeam,
  removeTeam,
  team,
  updateTeam
}: {
  busyTeam: string | null;
  removeTeam: (teamUid: string, teamName: string) => void;
  team: FantasyTeam;
  updateTeam: (teamUid: string) => void;
}) {
  return (
    <tr>
      <td className="rank-col">{team.standings_rank || "-"}</td>
      <td className="player-col">
        <strong>{team.team_name}</strong>
      </td>
      <td>{team.owner || "-"}</td>
      <td>
        {team.last_roster_count !== null
          ? `${team.last_roster_count}${team.last_roster_limit ? `/${team.last_roster_limit}` : ""}`
          : "-"}
      </td>
      <td>{`${formatMoney(team.last_cap_used)} / ${formatMoney(team.last_cap_limit)}`}</td>
      <td>{formatDecimal(team.standings_points ?? team.last_points)}</td>
      <td>{formatSigned(team.standings_change)}</td>
      <td>{formatDate(team.last_fetched_at)}</td>
      <td>
        <div className="row-actions">
          <button className="icon-button" onClick={() => updateTeam(team.team_uid)} disabled={busyTeam !== null} title="Update team" type="button">
            <RefreshCcw size={16} className={busyTeam === team.team_uid ? "spin" : ""} />
          </button>
          <a className="icon-button link" href={team.url} target="_blank" rel="noreferrer" title="Open team">
            <ExternalLink size={16} />
          </a>
          <button
            className="icon-button danger"
            onClick={() => removeTeam(team.team_uid, team.team_name)}
            disabled={busyTeam !== null}
            title="Remove team"
            type="button"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </td>
    </tr>
  );
}

function RankingRow({
  fantasyRoster,
  fantasyValue,
  groupedSources,
  player,
  scoringValue,
  showLeaguePositions,
  showRosterStatus,
  showFantasyTeam,
  showFantasyValue
}: {
  fantasyRoster: LeagueRosterPlayer | null;
  fantasyValue: number | null;
  groupedSources: { source_tag: SourceTag; sources: BoardSource[] }[];
  player: AggregatePlayer;
  scoringValue: ScoringValueMetric | null;
  showLeaguePositions: boolean;
  showRosterStatus: boolean;
  showFantasyTeam: boolean;
  showFantasyValue: boolean;
}) {
  const eligiblePositions = fantasyRoster?.positions || player.positions;
  const rosterStatuses = fantasyRoster ? rosterAvailabilities(fantasyRoster.mlb_team, fantasyRoster.status) : [];

  return (
    <tr>
      {showFantasyValue && <td className="rank-col">{scoringValue?.rank || "-"}</td>}
      <td className="rank-col">{player.aggregate_rank}</td>
      {showFantasyValue && <td className="value-col">{formatFantasyValue(fantasyValue)}</td>}
      {showFantasyValue && <td className="value-col">{formatFantasyValue(scoringValue?.value)}</td>}
      {showFantasyValue && <td className="value-col"><ValueMinusSalary value={fantasyValue} salary={fantasyRoster?.salary} /></td>}
      {showFantasyValue && <td className="value-col"><ValueMinusSalary value={scoringValue?.value} salary={fantasyRoster?.salary} /></td>}
      <td className="player-col">
        <strong>{player.player_name}</strong>
        {fantasyRoster && !showRosterStatus && <RosterStatusBadge mlbTeam={fantasyRoster.mlb_team} status={fantasyRoster.status} />}
      </td>
      {showRosterStatus && (
        <td className="status-col">
          {rosterStatuses.length ? <RosterStatusBadge mlbTeam={fantasyRoster?.mlb_team} status={fantasyRoster?.status} /> : <span className="missing-rank">-</span>}
        </td>
      )}
      {showFantasyTeam && (
        <td className={fantasyRoster ? "fantasy-team-cell" : "missing-rank"}>
          {fantasyRoster ? `${fantasyRoster.team_name} (${formatMoney(fantasyRoster.salary)})` : "Available"}
        </td>
      )}
      {showLeaguePositions && <td>{eligiblePositions || "-"}</td>}
      <td>{player.team || "-"}</td>
      <td>{player.positions || "-"}</td>
      <td>{player.age !== null ? player.age : "-"}</td>
      <td>{player.avg_rank}</td>
      <td>{player.median_rank}</td>
      <td>{player.source_count}</td>
      <td>{player.rank_spread}</td>
      {groupedSources.map((group) => (
        <Fragment key={group.source_tag}>
          <td className={player.group_ranks[group.source_tag] ? "source-rank subagg-rank" : "missing-rank"}>
            {player.group_ranks[group.source_tag]?.aggregate_rank || "-"}
          </td>
          {group.sources.map((source) => (
            <td key={source.id} className={player.source_ranks[source.id] ? "source-rank" : "missing-rank"}>
              {player.source_ranks[source.id]?.rank || "-"}
            </td>
          ))}
        </Fragment>
      ))}
    </tr>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SortableHeader({
  className = "",
  colSpan,
  defaultDirection = "asc",
  label,
  rowSpan,
  setSort,
  sort,
  sortKey,
  title
}: {
  className?: string;
  colSpan?: number;
  defaultDirection?: SortDirection;
  label: string;
  rowSpan?: number;
  setSort: (sort: TableSort) => void;
  sort: TableSort;
  sortKey: string;
  title?: string;
}) {
  const active = sort.key === sortKey;
  const nextDirection: SortDirection = active ? (sort.direction === "asc" ? "desc" : "asc") : defaultDirection;
  return (
    <th className={`${className} sortable-col`.trim()} colSpan={colSpan} rowSpan={rowSpan} title={title}>
      <button
        type="button"
        className={active ? "active" : ""}
        onClick={() => setSort({ key: sortKey, direction: nextDirection })}
        aria-label={`Sort by ${label}`}
      >
        <span>{label}</span>
        <span className="sort-indicator">{active ? (sort.direction === "asc" ? "^" : "v") : "-"}</span>
      </button>
    </th>
  );
}

function useTableWindow(rowCount: number, rowHeight: number, overscan: number) {
  const [scrollState, setScrollState] = useState({ scrollTop: 0, viewportHeight: rowHeight * 24 });
  const visibleCount = Math.ceil(scrollState.viewportHeight / rowHeight) + overscan * 2;
  const maxStartIndex = Math.max(0, rowCount - visibleCount);
  const startIndex = Math.min(maxStartIndex, Math.max(0, Math.floor(scrollState.scrollTop / rowHeight) - overscan));
  const endIndex = Math.min(rowCount, startIndex + visibleCount);

  function onScroll(event: UIEvent<HTMLDivElement>) {
    const nextScrollTop = event.currentTarget.scrollTop;
    const nextViewportHeight = event.currentTarget.clientHeight || rowHeight * 24;
    setScrollState((current) => {
      if (current.scrollTop === nextScrollTop && current.viewportHeight === nextViewportHeight) return current;
      return { scrollTop: nextScrollTop, viewportHeight: nextViewportHeight };
    });
  }

  return {
    afterHeight: Math.max(0, (rowCount - endIndex) * rowHeight),
    beforeHeight: startIndex * rowHeight,
    endIndex,
    onScroll,
    startIndex
  };
}

function TableSpacerRow({ colSpan, height }: { colSpan: number; height: number }) {
  if (height <= 0) return null;
  return (
    <tr className="virtual-spacer-row" aria-hidden="true">
      <td colSpan={colSpan} style={{ height }} />
    </tr>
  );
}

type FormatToggleOption = {
  label: string;
  active: boolean;
  onClick: () => void;
  title: string;
  ariaLabel: string;
};

function FormatToggle({ label, ariaLabel, options }: { label: string; ariaLabel: string; options: FormatToggleOption[] }) {
  return (
    <div className="source-toggle">
      <span>{label}</span>
      <div className="segmented" aria-label={ariaLabel}>
        {options.map((option) => (
          <button
            key={option.label}
            className={option.active ? "active" : ""}
            onClick={option.onClick}
            title={option.title}
            aria-label={option.ariaLabel}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function buildTradeRows(
  teamUid: string,
  rosterPlayers: LeagueRosterPlayer[],
  boardPlayerByKey: Map<string, AggregatePlayer>,
  leagueValueCurve: LeagueValueCurve | null,
  allowedSourceIds: string[],
  scoringValueByPlayerKey: Map<string, ScoringValueMetric>
): TradePlayerRow[] {
  if (!teamUid) return [];
  return rosterPlayers
    .filter((player) => player.team_uid === teamUid)
    .map((player) => {
      const ranking = boardPlayerByKey.get(player.player_key) || null;
      const value = ranking && leagueValueCurve ? fittedFantasyValue(ranking.aggregate_rank, leagueValueCurve) : null;
      const scoringValue = scoringValueByPlayerKey.get(player.player_key) || null;
      const sourceValues =
        ranking && leagueValueCurve
          ? allowedSourceIds
              .map((sourceId) => ranking.source_ranks[sourceId]?.rank)
              .filter((rank): rank is number => typeof rank === "number")
              .map((rank) => fittedFantasyValue(rank, leagueValueCurve))
          : [];
      return {
        player_key: player.player_key,
        player_name: player.player_name,
        positions: player.positions,
        status: player.status,
        ownerTeamName: player.team_name,
        mlbTeam: player.mlb_team,
        section: player.section,
        salary: player.salary,
        points: player.points,
        pointsPerGame: player.points_per_game,
        pointsPerIp: player.points_per_ip,
        aggregate_rank: ranking?.aggregate_rank || null,
        scoringRank: scoringValue?.rank || null,
        value,
        scoredValue: scoringValue?.value ?? null,
        minValue: sourceValues.length ? Math.min(...sourceValues) : value,
        maxValue: sourceValues.length ? Math.max(...sourceValues) : value
      };
    })
    .sort((left, right) => {
      return (right.value || 0) - (left.value || 0) || (right.scoredValue || 0) - (left.scoredValue || 0) || right.salary - left.salary || left.player_name.localeCompare(right.player_name);
    });
}

function buildAvailableTradeRows(
  players: AggregatePlayer[],
  rosterPlayers: LeagueRosterPlayer[],
  leagueValueCurve: LeagueValueCurve | null,
  allowedSourceIds: string[],
  availableStatsByPlayerKey: Map<string, LeagueAvailablePlayerStats>,
  availableScoringValueByPlayerKey: Map<string, ScoringValueMetric>
): TradePlayerRow[] {
  const rosteredPlayerKeys = new Set(rosterPlayers.map((player) => player.player_key));
  return players
    .filter((player) => !rosteredPlayerKeys.has(player.player_key))
    .map((player) => {
      const stats = availableStatsByPlayerKey.get(player.player_key) || null;
      const scoringValue = availableScoringValueByPlayerKey.get(player.player_key) || null;
      const value = leagueValueCurve ? fittedFantasyValue(player.aggregate_rank, leagueValueCurve) : null;
      const sourceValues = leagueValueCurve
        ? allowedSourceIds
            .map((sourceId) => player.source_ranks[sourceId]?.rank)
            .filter((rank): rank is number => typeof rank === "number")
            .map((rank) => fittedFantasyValue(rank, leagueValueCurve))
        : [];
      return {
        player_key: player.player_key,
        player_name: stats?.player_name || player.player_name,
        positions: stats?.positions || player.positions,
        status: stats?.status || null,
        ownerTeamName: null,
        mlbTeam: stats?.mlb_team || player.team,
        section: stats?.section || playerSectionFromPositions(stats?.positions || player.positions),
        salary: 0,
        points: stats?.points_per_game ?? stats?.points ?? null,
        pointsAreRate: typeof stats?.points_per_game === "number",
        pointsPerGame: stats?.points_per_game ?? null,
        pointsPerIp: stats?.points_per_ip ?? null,
        aggregate_rank: player.aggregate_rank,
        scoringRank: scoringValue?.rank || null,
        value,
        scoredValue: scoringValue?.value ?? null,
        minValue: sourceValues.length ? Math.min(...sourceValues) : value,
        maxValue: sourceValues.length ? Math.max(...sourceValues) : value
      };
    })
    .sort((left, right) => {
      return (right.value || 0) - (left.value || 0) || (right.scoredValue || 0) - (left.scoredValue || 0) || left.player_name.localeCompare(right.player_name);
    });
}

function buildTradeBlockRows(
  players: LeagueTradeBlockPlayer[],
  boardPlayerByKey: Map<string, AggregatePlayer>,
  leagueValueCurve: LeagueValueCurve | null,
  allowedSourceIds: string[],
  scoringValueByPlayerKey: Map<string, ScoringValueMetric>
): TradePlayerRow[] {
  return players
    .filter((player) => player.side === "have")
    .map((player) => {
      const ranking = boardPlayerByKey.get(player.player_key) || null;
      const value = ranking && leagueValueCurve ? fittedFantasyValue(ranking.aggregate_rank, leagueValueCurve) : null;
      const scoringValue = scoringValueByPlayerKey.get(player.player_key) || null;
      const sourceValues =
        ranking && leagueValueCurve
          ? allowedSourceIds
              .map((sourceId) => ranking.source_ranks[sourceId]?.rank)
              .filter((rank): rank is number => typeof rank === "number")
              .map((rank) => fittedFantasyValue(rank, leagueValueCurve))
          : [];
      return {
        player_key: player.player_key,
        player_name: player.player_name,
        positions: player.positions,
        status: player.status,
        ownerTeamName: player.team_name,
        mlbTeam: player.mlb_team,
        section: player.section,
        salary: player.salary,
        points: player.points,
        pointsPerGame: player.points_per_game,
        pointsPerIp: player.points_per_ip,
        aggregate_rank: ranking?.aggregate_rank || null,
        scoringRank: scoringValue?.rank || null,
        value,
        scoredValue: scoringValue?.value ?? null,
        minValue: sourceValues.length ? Math.min(...sourceValues) : value,
        maxValue: sourceValues.length ? Math.max(...sourceValues) : value
      };
    })
    .sort((left, right) => {
      return (right.value || 0) - (left.value || 0) || (right.scoredValue || 0) - (left.scoredValue || 0) || right.salary - left.salary || left.player_name.localeCompare(right.player_name);
    });
}

function playerSectionFromPositions(positions: string | null): "hitter" | "pitcher" {
  const tokens = expandedPositionTokens(positions);
  return tokens.has("P") && !tokens.has("UTI") ? "pitcher" : "hitter";
}

function tradeTotal(
  rows: TradePlayerRow[],
  selectedPlayerKeys: string[],
  selectedDropPlayerKeys: string[] = [],
  cashSent: number = 0
): TradeTotal {
  const selected = new Set(selectedPlayerKeys);
  const dropped = new Set(selectedDropPlayerKeys);
  const total: TradeTotal = { cash: cashSent, count: 0, dropCount: 0, salary: 0, salaryDelta: 0, scoredSalaryDelta: 0, scoredValue: 0, value: 0, minValue: 0, maxValue: 0 };
  for (const row of rows) {
    const value = row.value ?? 0;
    const scoredValue = row.scoredValue ?? 0;
    const minValue = row.minValue ?? value;
    const maxValue = row.maxValue ?? value;
    if (selected.has(row.player_key)) {
      total.count += 1;
      total.salary += row.salary;
      total.value += value;
      total.scoredValue += scoredValue;
      total.minValue += minValue;
      total.maxValue += maxValue;
    }
    if (dropped.has(row.player_key)) {
      total.dropCount += 1;
      total.salary -= row.salary;
      total.value -= value;
      total.scoredValue -= scoredValue;
      total.minValue -= maxValue;
      total.maxValue -= minValue;
    }
  }
  total.value += cashSent;
  total.scoredValue += cashSent;
  total.minValue += cashSent;
  total.maxValue += cashSent;
  total.salaryDelta = total.value - total.salary;
  total.scoredSalaryDelta = total.scoredValue - total.salary;
  return total;
}

function selectedTradeRows(rows: TradePlayerRow[], selectedPlayerKeys: string[]) {
  const selected = new Set(selectedPlayerKeys);
  return rows.filter((row) => selected.has(row.player_key));
}

function sortTradeRows(rows: TradePlayerRow[], sort: TableSort) {
  return rows
    .map((row) => ({ row, sortValue: tradeSortValue(row, sort.key) }))
    .sort((left, right) => {
      const comparison = compareSortValues(left.sortValue, right.sortValue, sort.direction);
      return comparison || (right.row.value || 0) - (left.row.value || 0) || SORT_COLLATOR.compare(left.row.player_name, right.row.player_name);
    })
    .map((entry) => entry.row);
}

function tradeSortValue(row: TradePlayerRow, sortKey: string) {
  switch (sortKey) {
    case "player":
      return row.player_name;
    case "owner":
      return row.ownerTeamName;
    case "dyAgg":
      return row.aggregate_rank;
    case "scAgg":
      return row.scoringRank;
    case "positions":
      return row.positions;
    case "salary":
      return row.salary;
    case "points":
      return row.points;
    case "rate":
      return row.pointsPerGame ?? row.pointsPerIp;
    case "dyValue":
      return row.value;
    case "scValue":
      return row.scoredValue;
    case "dyDelta":
      return typeof row.value === "number" ? row.value - row.salary : null;
    case "scDelta":
      return typeof row.scoredValue === "number" ? row.scoredValue - row.salary : null;
    case "dyMin":
      return row.minValue;
    case "dyMax":
      return row.maxValue;
    default:
      return row.value;
  }
}

function buildCapProjection(
  team: FantasyTeam | null,
  outgoingRows: TradePlayerRow[],
  incomingRows: TradePlayerRow[],
  dropRows: TradePlayerRow[],
  cashSent: number,
  cashReceived: number
): CapProjection {
  const currentUsed = typeof team?.last_cap_used === "number" ? team.last_cap_used : null;
  const currentLimit = typeof team?.last_cap_limit === "number" ? team.last_cap_limit : null;
  if (currentUsed === null || currentLimit === null) {
    return {
      currentLimit,
      currentUsed,
      capSpace: null,
      overCap: false,
      projectedLimit: null,
      projectedUsed: null
    };
  }

  const projectedUsed = currentUsed - sumTradeSalary(outgoingRows) - sumTradeSalary(dropRows) + sumTradeSalary(incomingRows);
  const projectedLimit = currentLimit - cashSent + cashReceived;
  return {
    capSpace: projectedLimit - projectedUsed,
    currentLimit,
    currentUsed,
    overCap: projectedUsed > projectedLimit,
    projectedLimit,
    projectedUsed
  };
}

function emptyCapProjection(): CapProjection {
  return {
    capSpace: null,
    currentLimit: null,
    currentUsed: null,
    overCap: false,
    projectedLimit: null,
    projectedUsed: null
  };
}

function sumTradeSalary(rows: TradePlayerRow[]) {
  return rows.reduce((total, row) => total + row.salary, 0);
}

function parseTradeCash(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function tradeResult(sideA: TradeTotal, sideB: TradeTotal) {
  const valueMax = Math.max(sideA.maxValue, sideB.maxValue, sideA.value, sideB.value, 1);
  const average = (sideA.value + sideB.value) / 2;
  const diff = sideA.value - sideB.value;
  const margin = average > 0 ? Math.abs(diff) / average : 0;
  const close = average === 0 || (sideA.minValue <= sideB.maxValue && sideB.minValue <= sideA.maxValue);
  const winner = Math.abs(diff) < 0.05 ? "Even" : diff > 0 ? "Side B" : "Side A";
  const sideABandLeft = percentOfValue(sideA.minValue, valueMax);
  const sideABandRight = percentOfValue(sideA.maxValue, valueMax);
  const sideBBandLeft = percentOfValue(sideB.minValue, valueMax);
  const sideBBandRight = percentOfValue(sideB.maxValue, valueMax);
  const label = winner === "Even" ? "Even Trade" : `${winner} Wins`;
  const badge = close ? "Too close to call" : `${(margin * 100).toFixed(1)}% edge`;
  const copy =
    average === 0
      ? "Select players from each side to evaluate the package."
      : close
        ? `${label} by midpoint value, but the source ranges overlap. Treat this as effectively even.`
        : `${label} by ${(margin * 100).toFixed(1)}% based on midpoint fantasy value.`;
  return {
    badge,
    close,
    copy,
    label,
    winner,
    sideABandLeft,
    sideABandWidth: Math.max(1, sideABandRight - sideABandLeft),
    sideAPoint: percentOfValue(sideA.value, valueMax),
    sideBBandLeft,
    sideBBandWidth: Math.max(1, sideBBandRight - sideBBandLeft),
    sideBPoint: percentOfValue(sideB.value, valueMax)
  };
}

function scoringTradeResult(sideA: TradeTotal, sideB: TradeTotal) {
  const valueMax = Math.max(sideA.scoredValue, sideB.scoredValue, 1);
  const average = (sideA.scoredValue + sideB.scoredValue) / 2;
  const diff = sideA.scoredValue - sideB.scoredValue;
  const margin = average > 0 ? Math.abs(diff) / average : 0;
  const close = average === 0 || margin < 0.05;
  const winner = Math.abs(diff) < 0.05 ? "Even" : diff > 0 ? "Side B" : "Side A";
  const label = winner === "Even" ? "Even Trade" : `${winner} Wins`;
  const badge = close ? "Too close to call" : `${(margin * 100).toFixed(1)}% edge`;
  const copy =
    average === 0
      ? "Select players from each side to evaluate the package."
      : close
        ? `${label} by scoring value, but the edge is inside the safety margin.`
        : `${label} by ${(margin * 100).toFixed(1)}% based on scoring value.`;
  return {
    badge,
    close,
    copy,
    label,
    winner,
    sideABandLeft: percentOfValue(sideA.scoredValue, valueMax),
    sideABandWidth: 1,
    sideAPoint: percentOfValue(sideA.scoredValue, valueMax),
    sideBBandLeft: percentOfValue(sideB.scoredValue, valueMax),
    sideBBandWidth: 1,
    sideBPoint: percentOfValue(sideB.scoredValue, valueMax)
  };
}

function combinedTradeLabel(dynastyResult: ReturnType<typeof tradeResult>, scoringResult: ReturnType<typeof tradeResult>) {
  if (dynastyResult.winner === scoringResult.winner) return dynastyResult.label;
  return "Split Result";
}

function tradePerspectiveCopy(dynastyResult: ReturnType<typeof tradeResult>, scoringResult: ReturnType<typeof tradeResult>) {
  if (dynastyResult.winner === scoringResult.winner) {
    return `${dynastyResult.label} from both dynasty and scoring perspectives. Dynasty: ${dynastyResult.copy} Scoring: ${scoringResult.copy}`;
  }
  return `Dynasty view: ${dynastyResult.copy} Scoring view: ${scoringResult.copy}`;
}

function percentOfValue(value: number, maxValue: number) {
  if (maxValue <= 0) return 0;
  return Math.max(0, Math.min(100, (value / maxValue) * 100));
}

function toggleKey(values: string[], key: string) {
  return values.includes(key) ? values.filter((value) => value !== key) : [...values, key];
}

// Base URL for the backend API. Empty in local dev so requests stay relative
// (and go through the Vite dev proxy). Set VITE_API_URL to the hosted backend
// origin (e.g. https://your-backend.onrender.com) for the GitHub Pages build.
const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

// Supabase Edge Functions (used for reads ported off the FastAPI backend, e.g. the
// aggregate board). The publishable/anon key is safe to expose and is RLS-protected.
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

async function fetchFunction<T>(name: string, query = ""): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}${query ? `?${query}` : ""}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

// Direct PostgREST read (for simple table/view reads ported off the FastAPI backend).
async function fetchRest<T>(pathAndQuery: string): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(apiUrl(url), { credentials: "include" });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(apiUrl(url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text);
  }
  return response.json() as Promise<T>;
}

async function deleteJson<T>(url: string): Promise<T> {
  const response = await fetch(apiUrl(url), { method: "DELETE", credentials: "include" });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text);
  }
  return response.json() as Promise<T>;
}

function errorMessage(error: unknown) {
  if (!(error instanceof Error)) return "Request failed.";
  try {
    const parsed = JSON.parse(error.message);
    return parsed.detail?.message || parsed.detail || parsed.message || "Request failed.";
  } catch {
    return error.message || "Request failed.";
  }
}

function statusClass(status: string | null) {
  if (status === "success") return "success";
  if (status === "error") return "error";
  return "idle";
}

function statusIcon(status: string | null) {
  if (status === "success") return <CheckCircle2 size={14} />;
  if (status === "error") return <AlertCircle size={14} />;
  return <Database size={14} />;
}

function statusLabel(source: RankingSource) {
  if (source.last_status === "success") return `${source.last_row_count || 0} rows`;
  if (source.last_status === "error") return "error";
  return source.can_update ? "ready" : "import";
}

function isTdgSource(sourceId: string) {
  return sourceId === TDG_OBP_SOURCE_ID || sourceId === TDG_POINTS_SOURCE_ID;
}

function isFantraxSource(sourceId: string) {
  return sourceId === FANTRAX_ROTO_SOURCE_ID || sourceId === FANTRAX_POINTS_SOURCE_ID;
}

function parseAgeFilter(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positionMatchesFilter(value: string | null | undefined, filter: PositionFilter) {
  if (filter === "all") return true;
  const tokens = expandedPositionTokens(value);
  return tokens.has(filter);
}

function rosterTagMatches(player: LeagueRosterPlayer | null, filter: RosterTagFilter) {
  if (filter === "all") return true;
  if (!player) return false;
  const statuses = rosterAvailabilities(player.mlb_team, player.status);
  return statuses.some((status) => status.label === filter);
}

function expandedPositionTokens(value: string | null | undefined) {
  const tokens = new Set<string>();
  const normalizedValue = value?.toUpperCase().replace(/C\.I\./g, "CI").replace(/M\.I\./g, "MI") || "";
  for (const rawToken of normalizedValue.match(/[A-Z0-9]+/g) || []) {
    const token = rawToken === "UTIL" || rawToken === "UTL" || rawToken === "UT" ? "UTI" : rawToken;
    tokens.add(token);
  }

  if (tokens.has("LF") || tokens.has("CF") || tokens.has("RF")) {
    tokens.add("OF");
  }
  if (tokens.has("SP") || tokens.has("RP")) {
    tokens.add("P");
  }
  if (tokens.has("1B") || tokens.has("3B") || tokens.has("CI")) {
    tokens.add("CI");
  }
  if (tokens.has("2B") || tokens.has("SS") || tokens.has("MI")) {
    tokens.add("MI");
  }

  const hitterEligible = [...tokens].some((token) => HITTER_POSITION_TOKENS.has(token) || token === "MI" || token === "CI");
  if (hitterEligible) {
    tokens.add("UTI");
  }

  return tokens;
}

function sortRankingRows(
  players: AggregatePlayer[],
  sort: TableSort,
  context: {
    leagueRosterByPlayerKey: Map<string, LeagueRosterPlayer>;
    leagueValueCurve: LeagueValueCurve | null;
    scoringValueByPlayerKey: Map<string, ScoringValueMetric>;
  }
) {
  return players
    .map((player) => ({ player, sortValue: rankingSortValue(player, sort.key, context) }))
    .sort((left, right) => {
      const comparison = compareSortValues(left.sortValue, right.sortValue, sort.direction);
      return (
        comparison ||
        left.player.aggregate_rank - right.player.aggregate_rank ||
        SORT_COLLATOR.compare(left.player.player_name, right.player.player_name)
      );
    })
    .map((entry) => entry.player);
}

function rankingSortValue(
  player: AggregatePlayer,
  sortKey: string,
  context: {
    leagueRosterByPlayerKey: Map<string, LeagueRosterPlayer>;
    leagueValueCurve: LeagueValueCurve | null;
    scoringValueByPlayerKey: Map<string, ScoringValueMetric>;
  }
) {
  if (sortKey.startsWith("source:")) {
    return player.source_ranks[sortKey.slice("source:".length)]?.rank ?? null;
  }
  if (sortKey.startsWith("group:")) {
    return player.group_ranks[sortKey.slice("group:".length) as SourceTag]?.aggregate_rank ?? null;
  }

  switch (sortKey) {
    case "dyAgg":
      return player.aggregate_rank;
    case "scRank":
    case "scAgg":
      return context.scoringValueByPlayerKey.get(player.player_key)?.rank ?? null;
    case "dyValue":
      return context.leagueValueCurve ? fittedFantasyValue(player.aggregate_rank, context.leagueValueCurve) : null;
    case "scValue":
      return context.scoringValueByPlayerKey.get(player.player_key)?.value ?? null;
    case "dyDelta":
      return rankingDynastyDelta(player, context);
    case "scDelta":
      return rankingScoringDelta(player, context);
    case "player":
      return player.player_name;
    case "fantasyTeam":
      return context.leagueRosterByPlayerKey.get(player.player_key)?.team_name ?? null;
    case "rosterStatus":
      return rankingRosterStatusSortValue(context.leagueRosterByPlayerKey.get(player.player_key));
    case "elig":
      return context.leagueRosterByPlayerKey.get(player.player_key)?.positions || player.positions;
    case "team":
      return player.team;
    case "positions":
      return player.positions;
    case "age":
      return player.age;
    case "avg":
      return player.avg_rank;
    case "median":
      return player.median_rank;
    case "sources":
      return player.source_count;
    case "spread":
      return player.rank_spread;
    default:
      return player.aggregate_rank;
  }
}

function rankingDynastyDelta(
  player: AggregatePlayer,
  context: {
    leagueRosterByPlayerKey: Map<string, LeagueRosterPlayer>;
    leagueValueCurve: LeagueValueCurve | null;
  }
) {
  const roster = context.leagueRosterByPlayerKey.get(player.player_key) || null;
  if (!context.leagueValueCurve || typeof roster?.salary !== "number") return null;
  return fittedFantasyValue(player.aggregate_rank, context.leagueValueCurve) - roster.salary;
}

function rankingScoringDelta(
  player: AggregatePlayer,
  context: {
    leagueRosterByPlayerKey: Map<string, LeagueRosterPlayer>;
    scoringValueByPlayerKey: Map<string, ScoringValueMetric>;
  }
) {
  const roster = context.leagueRosterByPlayerKey.get(player.player_key) || null;
  const scoringValue = context.scoringValueByPlayerKey.get(player.player_key) || null;
  return scoringValue && typeof roster?.salary === "number" ? scoringValue.value - roster.salary : null;
}

function rankingRosterStatusSortValue(player: LeagueRosterPlayer | undefined) {
  if (!player) return null;
  const statuses = rosterAvailabilities(player.mlb_team, player.status);
  if (!statuses.length) return null;
  return statuses.map((status) => status.label).join(" ");
}

function compareSortValues(left: SortableValue, right: SortableValue, direction: SortDirection) {
  const leftMissing = left === null || left === undefined || left === "";
  const rightMissing = right === null || right === undefined || right === "";
  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;

  const comparison =
    typeof left === "number" && typeof right === "number"
      ? left - right
      : SORT_COLLATOR.compare(String(left), String(right));
  return direction === "asc" ? comparison : -comparison;
}

function buildSourceQualityMetrics(board: AggregateBoard) {
  const sourcesByTag = new Map<SourceTag, BoardSource[]>();
  for (const source of board.sources) {
    const tagSources = sourcesByTag.get(source.source_tag) || [];
    tagSources.push(source);
    sourcesByTag.set(source.source_tag, tagSources);
  }

  const metrics = new Map<string, SourceQualityMetric>();
  for (const source of board.sources) {
    const peerSources = (sourcesByTag.get(source.source_tag) || []).filter((peer) => peer.id !== source.id);
    let topComparisonCount = 0;
    let totalTopRankDifference = 0;

    for (const player of board.players) {
      const sourceRank = player.source_ranks[source.id]?.rank;
      if (typeof sourceRank !== "number") continue;

      for (const peer of peerSources) {
        const peerRank = player.source_ranks[peer.id]?.rank;
        if (typeof peerRank !== "number") continue;

        if (sourceRank <= SOURCE_QUALITY_TOP_RANK || peerRank <= SOURCE_QUALITY_TOP_RANK) {
          topComparisonCount += 1;
          totalTopRankDifference += Math.abs(topRankWindowValue(sourceRank) - topRankWindowValue(peerRank));
        }
      }
    }

    metrics.set(source.id, {
      peerSourceCount: peerSources.length,
      qualityScore:
        topComparisonCount && peerSources.length
          ? totalTopRankDifference / SOURCE_QUALITY_TOP_RANK / peerSources.length
          : null,
      topComparisonCount
    });
  }

  return metrics;
}

function topRankWindowValue(rank: number) {
  return Math.min(rank, SOURCE_QUALITY_TOP_RANK + 1);
}

function formatDate(value: string | null) {
  if (!value) return "Not loaded";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatPlainDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatSourceDate(value: string | null, snapshotId: number | null) {
  if (!value) return snapshotId ? "Not detected" : "No ranking snapshot";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function sourceDateKindLabel(value: string) {
  if (value === "updated") return "updated";
  if (value === "published") return "published";
  return "detected";
}

function fittedFantasyValue(rank: number, curve: LeagueValueCurve) {
  const { c, A, m, s, g, D, k } = curve.parameters;
  return c + (A - c) / Math.pow(1 + Math.pow(rank / m, s), g) + D * Math.exp(-k * (rank - 1));
}

function buildScoringValueMap(rosterPlayers: LeagueRosterPlayer[], curve: LeagueValueCurve | null) {
  const values = new Map<string, ScoringValueMetric>();
  if (!curve) return values;

  rosterPlayers
    .filter((player) => !isMinorLeaguePlayer(player))
    .sort((left, right) => {
      const leftPoints = typeof left.points === "number" && Number.isFinite(left.points) ? left.points : 0;
      const rightPoints = typeof right.points === "number" && Number.isFinite(right.points) ? right.points : 0;
      return rightPoints - leftPoints || left.player_name.localeCompare(right.player_name) || left.player_key.localeCompare(right.player_key);
    })
    .forEach((player, index) => {
      const rank = index + 1;
      values.set(player.player_key, {
        rank,
        value: fittedFantasyValue(rank, curve)
      });
    });

  return values;
}

function buildAvailableScoringValueMap(
  rosterPlayers: LeagueRosterPlayer[],
  availablePlayers: LeagueAvailablePlayerStats[],
  curve: LeagueValueCurve | null
) {
  const values = new Map<string, ScoringValueMetric>();
  if (!curve) return values;

  const availablePlayerKeys = new Set(availablePlayers.map((player) => player.player_key));
  const scoringRows = [
    ...rosterPlayers.map((player) => ({
      player_key: player.player_key,
      player_name: player.player_name,
      mlb_team: player.mlb_team,
      status: player.status,
      points: player.points
    })),
    ...availablePlayers.map((player) => ({
      player_key: player.player_key,
      player_name: player.player_name,
      mlb_team: player.mlb_team,
      status: player.status,
      points: player.points
    }))
  ]
    .filter((player) => availablePlayerKeys.has(player.player_key) || !isMinorLeaguePlayer(player))
    .filter((player) => !isMinorLeaguePlayer(player))
    .filter((player) => typeof player.points === "number" && Number.isFinite(player.points));

  scoringRows
    .sort((left, right) => {
      return (right.points || 0) - (left.points || 0) || left.player_name.localeCompare(right.player_name) || left.player_key.localeCompare(right.player_key);
    })
    .forEach((player, index) => {
      if (!availablePlayerKeys.has(player.player_key)) return;
      const rank = index + 1;
      values.set(player.player_key, {
        rank,
        value: fittedFantasyValue(rank, curve)
      });
    });

  return values;
}

function formatFantasyValue(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 1 })}`;
}

function formatValueDelta(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${formatFantasyValue(Math.abs(value))}`;
}

function SignedValue({ value }: { value: number | null | undefined }) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return <span className="signed-value missing">-</span>;
  }
  const tone = value < 0 ? "negative" : value > 0 ? "positive" : "neutral";
  return <span className={`signed-value ${tone}`}>{formatValueDelta(value)}</span>;
}

function ValueMinusSalary({ value, salary }: { value: number | null | undefined; salary: number | null | undefined }) {
  if (typeof value !== "number" || !Number.isFinite(value) || typeof salary !== "number") {
    return <span className="signed-value missing">-</span>;
  }
  return <SignedValue value={value - salary} />;
}

function formatMoney(value: number | null | undefined) {
  if (typeof value !== "number") return "-";
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString()}`;
}

function formatDecimal(value: number | null | undefined) {
  if (typeof value !== "number") return "-";
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatXfipMinus(value: number | null | undefined) {
  if (typeof value !== "number") return "-";
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function LineupXfipValue({ value }: { value: number | null | undefined }) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return <span>{formatXfipMinus(value)}</span>;
  }
  return (
    <span className="lineup-estimated-xfip" title="No xFIP- found. Est. Pts uses neutral 100.">
      100 est.
    </span>
  );
}

function lineupPointsAdjustment(xfipMinus: number | null | undefined, factor: number = 1) {
  const baseline = typeof xfipMinus === "number" && Number.isFinite(xfipMinus) ? xfipMinus : 100;
  return (100 + (baseline - 100) * factor) / 100;
}

function estimatedLineupPoints(row: LineupRecommendationRow, factor: number = 1) {
  const adjustment = lineupPointsAdjustment(row.opposing_pitcher_xfip_minus, factor);
  if (typeof row.points_per_game !== "number" || !Number.isFinite(row.points_per_game)) return null;
  return row.points_per_game * adjustment;
}

function formatEstimatedLineupPoints(row: LineupRecommendationRow, factor: number = 1) {
  return formatDecimal(estimatedLineupPoints(row, factor));
}

function optimizeLineup(rows: LineupRecommendationRow[], factor: number = 1): LineupOptimizerResult {
  const players = rows.map((row, index) => {
    const canStart = !row.always_sit && row.recommendation_code !== "no-game" && row.recommendation_code !== "no-mlb-team";
    return {
      eligibleSlotIndexes: !canStart
        ? []
        : LINEUP_SLOTS.map((slot, slotIndex) => (lineupSlotEligible(row, slot) ? slotIndex : -1)).filter((slotIndex) => slotIndex >= 0),
      index,
      locked: row.always_start && !row.always_sit,
      points: estimatedLineupPoints(row, factor) ?? 0,
      row,
      sitting: row.always_sit
    };
  });
  const lockedPlayerIndexes = new Set(players.filter((player) => player.locked).map((player) => player.index));
  const forcedResult = solveLineupAssignment(players, lockedPlayerIndexes);
  const result = forcedResult || solveLineupAssignment(players, new Set<number>());
  const assignments = new Map<string, LineupAssignment>();
  let totalPoints = 0;

  if (result) {
    result.assignedPlayerIndexes.forEach((playerIndex, slotIndex) => {
      if (playerIndex < 0) return;
      const player = players[playerIndex];
      if (!player) return;
      assignments.set(player.row.player_key, {
        label: LINEUP_SLOTS[slotIndex].label,
        slotIndex
      });
      totalPoints += player.points;
    });
  }

  const unassignedLocked = rows.filter((row) => row.always_start && !assignments.has(row.player_key));
  const warning =
    rows.length && unassignedLocked.length
      ? `Locked players could not all fit in the available lineup slots: ${unassignedLocked
          .map((row) => row.player_name)
          .join(", ")}. Showing the best valid lineup.`
      : "";

  return {
    assignments,
    lockedCount: lockedPlayerIndexes.size,
    starterCount: assignments.size,
    totalPoints,
    warning
  };
}

function solveLineupAssignment(
  players: {
    eligibleSlotIndexes: number[];
    index: number;
    locked: boolean;
    points: number;
    row: LineupRecommendationRow;
    sitting: boolean;
  }[],
  forcedPlayerIndexes: Set<number>
): { assignedPlayerIndexes: number[]; points: number; starterCount: number } | null {
  const forcedMask = [...forcedPlayerIndexes].reduce((mask, playerIndex) => mask | (1n << BigInt(playerIndex)), 0n);
  type AssignmentState = {
    assignedPlayerIndexes: number[];
    mask: bigint;
    points: number;
    starterCount: number;
  };
  let states = new Map<bigint, AssignmentState>([
    [
      0n,
      {
        assignedPlayerIndexes: [],
        mask: 0n,
        points: 0,
        starterCount: 0
      }
    ]
  ]);

  for (let slotIndex = 0; slotIndex < LINEUP_SLOTS.length; slotIndex += 1) {
    const nextStates = new Map<bigint, AssignmentState>();
    const slotCandidates = players.filter((player) => player.eligibleSlotIndexes.includes(slotIndex));
    for (const state of states.values()) {
      saveAssignmentState(nextStates, {
        ...state,
        assignedPlayerIndexes: [...state.assignedPlayerIndexes, -1]
      });

      for (const player of slotCandidates) {
        const bit = 1n << BigInt(player.index);
        if ((state.mask & bit) !== 0n) continue;
        saveAssignmentState(nextStates, {
          assignedPlayerIndexes: [...state.assignedPlayerIndexes, player.index],
          mask: state.mask | bit,
          points: state.points + player.points,
          starterCount: state.starterCount + 1
        });
      }
    }
    states = nextStates;
  }

  let best: AssignmentState | null = null;
  for (const state of states.values()) {
    if ((state.mask & forcedMask) !== forcedMask) continue;
    if (!best || betterLineupState(state, best)) {
      best = state;
    }
  }

  return best;
}

function saveAssignmentState(states: Map<bigint, { assignedPlayerIndexes: number[]; mask: bigint; points: number; starterCount: number }>, state: {
  assignedPlayerIndexes: number[];
  mask: bigint;
  points: number;
  starterCount: number;
}) {
  const existing = states.get(state.mask);
  if (!existing || betterLineupState(state, existing)) {
    states.set(state.mask, state);
  }
}

function betterLineupState(
  candidate: { points: number; starterCount: number; assignedPlayerIndexes: number[] },
  incumbent: { points: number; starterCount: number; assignedPlayerIndexes: number[] }
) {
  const pointDifference = candidate.points - incumbent.points;
  if (Math.abs(pointDifference) > 0.000001) return pointDifference > 0;
  return candidate.starterCount > incumbent.starterCount;
}

function lineupSlotEligible(row: LineupRecommendationRow, slot: LineupSlot) {
  return expandedPositionTokens(row.positions).has(slot.token);
}

function buildLineupDisplayRows(rows: LineupRecommendationRow[], optimizer: LineupOptimizerResult | null, factor: number = 1): LineupDisplayRow[] {
  return rows
    .map((row) => ({
      assignment: optimizer?.assignments.get(row.player_key) || null,
      estimatedPoints: estimatedLineupPoints(row, factor),
      row
    }))
    .sort((left, right) => {
      if (left.assignment && right.assignment) {
        return left.assignment.slotIndex - right.assignment.slotIndex || left.row.player_name.localeCompare(right.row.player_name);
      }
      if (left.assignment) return -1;
      if (right.assignment) return 1;
      return (
        (right.estimatedPoints ?? -Infinity) - (left.estimatedPoints ?? -Infinity) ||
        lineupSortOrder(left.row.recommendation_code) - lineupSortOrder(right.row.recommendation_code) ||
        (right.row.salary || 0) - (left.row.salary || 0) ||
        left.row.player_name.localeCompare(right.row.player_name)
      );
    });
}

function RosterStatusBadge({
  mlbTeam,
  status
}: {
  mlbTeam: string | null | undefined;
  status: string | null | undefined;
}) {
  const availabilities = rosterAvailabilities(mlbTeam, status);
  if (!availabilities.length) return null;
  return (
    <>
      {availabilities.map((availability) => (
        <span className={`roster-status-badge ${availability.code}`} key={availability.code} title={availability.title}>
          {availability.label}
        </span>
      ))}
    </>
  );
}

function rosterAvailabilities(
  mlbTeam: string | null | undefined,
  status: string | null | undefined
): { code: "il" | "minors"; label: string; title: string }[] {
  const cleanStatus = (status || "").trim();
  const availabilities: { code: "il" | "minors"; label: string; title: string }[] = [];
  if (isIlRosterStatus(cleanStatus)) {
    availabilities.push({
      code: "il",
      label: "IL",
      title: cleanStatus ? `Roster status: ${cleanStatus}` : "Roster status: IL"
    });
  }

  const level = minorLeagueLevel(mlbTeam) || minorLeagueLevel(cleanStatus);
  if (isMinorRosterStatus(cleanStatus) || level) {
    availabilities.push({
      code: "minors",
      label: "MiLB",
      title: level ? `Minor league level: ${level}` : cleanStatus ? `Roster status: ${cleanStatus}` : "Minor league player"
    });
  }

  return availabilities;
}

function isIlRosterStatus(status: string) {
  const upperStatus = status.toUpperCase();
  return upperStatus.includes("IL") || upperStatus.includes("DL");
}

function isMinorRosterStatus(status: string) {
  return status.toUpperCase().includes("MILB") || minorLeagueLevel(status) !== null;
}

function isMinorLeaguePlayer(player: Pick<LeagueRosterPlayer, "mlb_team" | "status">) {
  return isMinorRosterStatus((player.status || "").trim()) || minorLeagueLevel(player.mlb_team) !== null;
}

function minorLeagueLevel(mlbTeam: string | null | undefined) {
  const parts = (mlbTeam || "").trim().toUpperCase().split(/\s+/);
  const level = parts.length > 1 ? parts[1] : parts[0] || "";
  return MINOR_LEVEL_TOKENS.has(level) ? level : null;
}

function formatQualityScore(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatRate(row: Pick<TradePlayerRow, "pointsPerGame" | "pointsPerIp">) {
  if (typeof row.pointsPerGame === "number") {
    return `${formatDecimal(row.pointsPerGame)} P/G`;
  }
  if (typeof row.pointsPerIp === "number") {
    return `${formatDecimal(row.pointsPerIp)} P/IP`;
  }
  return "-";
}

function formatTradePoints(row: Pick<TradePlayerRow, "points" | "pointsAreRate">) {
  if (typeof row.points !== "number") return "-";
  return row.pointsAreRate ? `${formatDecimal(row.points)} P/G` : formatDecimal(row.points);
}

function formatTradePointsSummary(row: Pick<TradePlayerRow, "points" | "pointsAreRate">) {
  if (typeof row.points !== "number") return "-";
  return row.pointsAreRate ? `${formatDecimal(row.points)} P/G` : `${formatDecimal(row.points)} pts`;
}

function formatUnavailableRate(player: LineupUnavailablePlayer) {
  if (typeof player.points_per_game === "number") {
    return `${formatDecimal(player.points_per_game)} P/G`;
  }
  if (typeof player.points_per_ip === "number") {
    return `${formatDecimal(player.points_per_ip)} P/IP`;
  }
  return "-";
}

function sortLineupRows(rows: LineupRecommendationRow[]) {
  return [...rows].sort((left, right) => {
    return (
      lineupSortOrder(left.recommendation_code) - lineupSortOrder(right.recommendation_code) ||
      (right.salary || 0) - (left.salary || 0) ||
      left.player_name.localeCompare(right.player_name)
    );
  });
}

function lineupSortOrder(code: LineupRecommendationRow["recommendation_code"]) {
  const order: Record<LineupRecommendationRow["recommendation_code"], number> = {
    "always-start": 0,
    "lean-start": 1,
    neutral: 2,
    "no-xfip": 3,
    "no-probable": 4,
    "lean-sit": 5,
    "always-sit": 6,
    "no-game": 7,
    "no-mlb-team": 8
  };
  return order[code] ?? 99;
}

function recommendationForLineupRow(row: LineupRecommendationRow, alwaysStart: boolean, alwaysSit: boolean): { code: LineupRecommendationRow["recommendation_code"]; label: string } {
  if (alwaysSit) return { code: "always-sit", label: "Sit" };
  if (alwaysStart) return { code: "always-start", label: "Always start" };
  if (!row.mlb_team || row.mlb_team.trim().split(/\s+/).length > 1) return { code: "no-mlb-team", label: "No MLB team" };
  if (!row.opponent_team) return { code: "no-game", label: "No game" };
  if (!row.opposing_pitcher_name) return { code: "no-probable", label: "No probable" };
  if (typeof row.opposing_pitcher_xfip_minus !== "number") return { code: "no-xfip", label: "No xFIP-" };
  if (row.opposing_pitcher_xfip_minus < 90) return { code: "lean-sit", label: "Lean sit" };
  if (row.opposing_pitcher_xfip_minus > 110) return { code: "lean-start", label: "Lean start" };
  return { code: "neutral", label: "Neutral" };
}

function formatSigned(value: number | null | undefined) {
  if (typeof value !== "number") return "-";
  const formatted = value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return value > 0 ? `+${formatted}` : formatted;
}

export default App;
