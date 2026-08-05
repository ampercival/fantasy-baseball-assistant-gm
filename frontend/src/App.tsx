import { Fragment, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type UIEvent } from "react";
import {
  Activity,
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
  Target,
  Trash2,
  TrendingUp,
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
  LineupOpponentOffenseRanks,
  LineupPitcherStartRow,
  LineupPitcherStatsImportResult,
  LineupRecommendationResponse,
  LineupRecommendationRow,
  LineupUnavailablePlayer,
  OptimalLineupHitter,
  OptimalLineupResponse,
  PitcherUsageResponse,
  PitcherUsageRole,
  PitcherUsageRow,
  PlatformValueCurve,
  PlatformValueCurveResponse,
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
const DEFAULT_LEAGUE_URL = "https://ottoneu.fangraphs.com/1900/home";
const DEFAULT_MY_TEAM_UID = "ottoneu:1900:12519";
const AVAILABLE_TEAM_UID = "__available__";
const MY_TEAMS_STORAGE_KEY = "fantasy-baseball-assistant-gm:my-teams-by-league";
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

type ActiveTool = "home" | "rankings" | "sources" | "leagues" | "trade" | "lineup" | "optimal-lineup" | "pitchers";
const TOOL_HASH_PATHS = {
  home: "#/home",
  rankings: "#/rankings",
  sources: "#/sources",
  leagues: "#/leagues",
  trade: "#/trade",
  lineup: "#/lineup",
  "optimal-lineup": "#/optimal-lineup",
  pitchers: "#/pitchers"
} satisfies Record<ActiveTool, string>;
type MyTeamUidsByLeague = Record<string, string>;
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
type LeagueValueCurveRow = {
  difference: number;
  fittedValue: number;
  platformDelta: number | null;
  platformValue: number | null;
  observedSalary: number;
  playerName: string;
  rank: number;
  teamName: string;
};
type LineupDisplayRow = {
  assignment: LineupAssignment | null;
  estimatedPoints: number | null;
  row: LineupRecommendationRow;
};
type OptimalLineupDisplayRow = {
  assignment: LineupAssignment | null;
  row: OptimalLineupHitter;
  score: number | null;
};
type StrengthTier = "strong" | "solid" | "weak";
type DepthTier = "strong" | "covered" | "thin";
type PositionMapPlayerRow = {
  dropoff: number | null;
  entry: OptimalLineupDisplayRow;
  role: "Starter" | "Tandem" | `Depth ${1 | 2 | 3}`;
};
type PositionStrengthRow = {
  position: string;
  players: PositionMapPlayerRow[];
  starterScore: number | null;
  starterTier: StrengthTier;
  depthScore: number | null;
  depthTier: DepthTier;
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
type CloudRefreshRequest = { id: number; status: string; message: string | null };
type PitcherUsageOverride = Exclude<PitcherUsageRole, "No season usage" | "Usage unavailable">;
type PitcherPlan = {
  bubbleSpKeys: string[];
  bubbleTarget: number;
  rpTarget: number;
  selectedRpKeys: string[];
  selectedSpKeys: string[];
  spTarget: number;
  usageOverrides: Record<string, PitcherUsageOverride>;
};
type PitcherPlanResponse = {
  league_uid: string;
  plan: PitcherPlan | null;
  team_uid: string;
  updated_at: string | null;
};
type PitcherPlanSyncState = "idle" | "loading" | "saving" | "saved" | "offline";
type LineupPitcherDecision = LineupPitcherStartRow & {
  decision: "start" | "decide" | "sit";
};
const DEFAULT_SP_TARGET = 5;
const DEFAULT_BUBBLE_TARGET = 0;
const DEFAULT_RP_TARGET = 5;
const MAX_PITCHER_PLAN_SLOTS = 20;
const PITCHER_USAGE_OVERRIDE_OPTIONS: PitcherUsageOverride[] = ["SP", "Mixed - SP", "Mixed - RP", "RP"];
const PITCHER_PLAN_STORAGE_PREFIX = "fantasy-baseball-assistant-gm:pitcher-plan";
const PITCHER_USAGE_CACHE = new Map<string, PitcherUsageResponse>();
const OPTIMAL_LINEUP_CACHE = new Map<string, OptimalLineupResponse>();
const POSITION_STRENGTH_GROUPS = [
  { label: "C", token: "C" },
  { label: "1B", token: "1B" },
  { label: "2B", token: "2B" },
  { label: "SS", token: "SS" },
  { label: "MI", token: "MI" },
  { label: "3B", token: "3B" },
  { label: "OF", token: "OF" },
  { label: "UTIL", token: "UTI" }
] as const;

function loadMyTeamUidsByLeague(): MyTeamUidsByLeague {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MY_TEAMS_STORAGE_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([leagueUid, teamUid]) => Boolean(leagueUid) && typeof teamUid === "string" && Boolean(teamUid)
      )
    ) as MyTeamUidsByLeague;
  } catch {
    return {};
  }
}

function myTeamUidForLeague(
  leagueUid: string,
  leagueTeams: FantasyTeam[],
  savedSelections: MyTeamUidsByLeague
) {
  const savedTeamUid = savedSelections[leagueUid];
  if (savedTeamUid && leagueTeams.some((team) => team.team_uid === savedTeamUid)) return savedTeamUid;
  if (leagueTeams.some((team) => team.team_uid === DEFAULT_MY_TEAM_UID)) return DEFAULT_MY_TEAM_UID;
  return "";
}

function App() {
  const [activeTool, setActiveTool] = useState<ActiveTool>(() => toolFromHash(window.location.hash));
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
  const [cloudRefreshBusy, setCloudRefreshBusy] = useState(false);
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
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [busyTeam, setBusyTeam] = useState<string | null>(null);
  const [myTeamUidsByLeague, setMyTeamUidsByLeague] = useState<MyTeamUidsByLeague>(loadMyTeamUidsByLeague);
  const [busyMyTeamLeagueUid, setBusyMyTeamLeagueUid] = useState<string | null>(null);
  const myTeamPreferenceMigrationAttemptsRef = useRef(new Set<string>());
  const toolNavRef = useRef<HTMLElement>(null);
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
    function syncToolFromHash(scrollToTop: boolean) {
      const tool = toolFromHash(window.location.hash);
      const canonicalHash = TOOL_HASH_PATHS[tool];
      const currentHashPath = window.location.hash.split("?", 1)[0].replace(/\/+$/, "");
      if (currentHashPath !== canonicalHash) {
        window.history.replaceState(window.history.state, "", canonicalHash);
      }

      setActiveTool(tool);
      if (scrollToTop) window.scrollTo(0, 0);
    }

    function handleHashChange() {
      syncToolFromHash(true);
    }

    syncToolFromHash(false);
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    if (!window.matchMedia("(max-width: 600px)").matches) return;
    toolNavRef.current
      ?.querySelector<HTMLButtonElement>('button[aria-current="page"]')
      ?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [activeTool]);

  function navigateToTool(tool: ActiveTool) {
    const nextHash = TOOL_HASH_PATHS[tool];
    const currentHashPath = window.location.hash.split("?", 1)[0].replace(/\/+$/, "");
    if (currentHashPath === nextHash) {
      setActiveTool(tool);
      window.scrollTo(0, 0);
      return;
    }
    window.location.hash = nextHash;
  }

  useEffect(() => {
    refreshRankings();
  }, [fantraxFormat, includedSourceTags, tdgFormat]);

  useEffect(() => {
    refreshTeams();
    refreshLeagues();
  }, []);

  useEffect(() => {
    if (!leagues.length || !teams.length) return;
    for (const league of leagues) {
      if (league.my_team_uid) {
        myTeamPreferenceMigrationAttemptsRef.current.add(league.league_uid);
        continue;
      }
      if (myTeamPreferenceMigrationAttemptsRef.current.has(league.league_uid)) continue;
      const leagueTeams = teams.filter((team) => team.league_id === league.league_id);
      const localTeamUid = myTeamUidForLeague(league.league_uid, leagueTeams, myTeamUidsByLeague);
      if (!localTeamUid) continue;
      myTeamPreferenceMigrationAttemptsRef.current.add(league.league_uid);
      void persistMyTeamSelection(league.league_uid, localTeamUid, false);
    }
  }, [leagues, myTeamUidsByLeague, teams]);

  useEffect(() => {
    if (selectedLeagueUid && (leagueOverlayEnabled || activeTool === "trade" || activeTool === "pitchers")) {
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
      saveMyTeamUidsByLeague((current) => {
        const next = { ...current };
        for (const league of leagueData) {
          if (league.my_team_uid) next[league.league_uid] = league.my_team_uid;
        }
        return next;
      });
      if (!selectedLeagueUid && leagueData.length) {
        setSelectedLeagueUid(leagueData[0].league_uid);
      }
    } finally {
      setLeaguesLoading(false);
    }
  }

  async function refreshLeagueRosterMap(leagueUid: string) {
    const mapData = await fetchFunction<LeagueRosterMap>("league-roster-map", `league_uid=${encodeURIComponent(leagueUid)}`);
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

  async function runUpdate(busyLabel: string, sourceTags: string) {
    setBusySource(busyLabel);
    try {
      const query = sourceTags ? `?source_tags=${encodeURIComponent(sourceTags)}` : "";
      const response = await postJson<{ results: UpdateResult[] }>(`/api/update-all${query}`, {});
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

  async function updateAll() {
    await runUpdate("all", "");
  }

  async function updateContinuous() {
    await runUpdate("continuous", "Continuous");
  }

  // Enqueue a cloud refresh: the local worker on the operator's machine picks this up and
  // scrapes -> Supabase. Works from anywhere (e.g. the deployed GitHub Pages site). After
  // queuing we poll the request row (public read) so we can toast when the worker finishes.
  async function requestCloudRefresh(scope: string) {
    setCloudRefreshBusy(true);
    try {
      const res = await fetchFunction<{ status: string; request?: CloudRefreshRequest }>(
        "request-refresh",
        `scope=${scope}`,
        "POST"
      );
      if (res.status === "rate_limited") {
        setToast("A refresh just ran — try again in a minute.");
        return;
      }
      if (res.status === "already_queued") {
        setToast("A refresh is already in progress — waiting for it to finish…");
      } else if (res.status === "queued") {
        setToast(`Refresh requested (${scope}). Waiting for your home worker…`);
      } else {
        setToast("Refresh request submitted.");
      }
      if (res.request?.id) {
        await pollCloudRefresh(res.request.id);
      }
    } catch (error) {
      setToast(errorMessage(error));
    } finally {
      setCloudRefreshBusy(false);
    }
  }

  // Poll a queued refresh request until the worker marks it done/error, then toast the
  // outcome and pull the freshly-scraped data into the UI.
  async function pollCloudRefresh(requestId: number) {
    const deadline = Date.now() + 3 * 60_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      let rows: CloudRefreshRequest[];
      try {
        rows = await fetchRest<CloudRefreshRequest[]>(`refresh_requests?id=eq.${requestId}&select=status,message`);
      } catch {
        continue;
      }
      const status = rows[0]?.status;
      if (status === "done") {
        setToast(`Refresh complete: ${(rows[0]?.message ?? "data updated").replace(/\.$/, "")}.`);
        await Promise.all([refreshRankings(), refreshTeams(), refreshLeagues(), selectedLeagueUid ? refreshLeagueRosterMap(selectedLeagueUid) : Promise.resolve()]);
        return;
      }
      if (status === "error") {
        setToast(`Refresh failed: ${rows[0]?.message ?? "unknown error"}.`);
        return;
      }
    }
    setToast("Refresh is taking longer than expected — is the worker running on your home PC?");
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


  async function removeLeague(leagueUid: string, leagueName: string) {
    if (!window.confirm(`Remove ${leagueName} from this app?`)) return;
    setBusyLeague(leagueUid);
    try {
      const result = await deleteJson<DeleteResult>(`/api/leagues/${encodeURIComponent(leagueUid)}`);
      setToast(result.message);
      saveMyTeamUidsByLeague((current) => {
        const next = { ...current };
        delete next[leagueUid];
        return next;
      });
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

  function saveMyTeamUidsByLeague(
    update: MyTeamUidsByLeague | ((current: MyTeamUidsByLeague) => MyTeamUidsByLeague)
  ) {
    setMyTeamUidsByLeague((current) => {
      const next = typeof update === "function" ? update(current) : update;
      try {
        window.localStorage.setItem(MY_TEAMS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // The in-memory choice still works if browser storage is unavailable.
      }
      return next;
    });
  }

  async function persistMyTeamSelection(leagueUid: string, teamUid: string, announce = true) {
    const previousTeamUid = myTeamUidsByLeague[leagueUid] || "";
    saveMyTeamUidsByLeague((current) => {
      const next = { ...current };
      if (teamUid) next[leagueUid] = teamUid;
      else delete next[leagueUid];
      return next;
    });
    setBusyMyTeamLeagueUid(leagueUid);
    try {
      await saveLeagueMyTeamPreference(leagueUid, teamUid);
      setLeagues((current) =>
        current.map((league) =>
          league.league_uid === leagueUid ? { ...league, my_team_uid: teamUid || null } : league
        )
      );
      if (announce) {
        const team = teams.find((item) => item.team_uid === teamUid);
        setToast(team ? `${team.team_name} is now your team in this league and is saved across devices.` : "My-team selection cleared across devices.");
      }
    } catch (error) {
      if (announce) {
        saveMyTeamUidsByLeague((current) => {
          const next = { ...current };
          if (previousTeamUid) next[leagueUid] = previousTeamUid;
          else delete next[leagueUid];
          return next;
        });
        setToast(`Could not save the team selection across devices: ${errorMessage(error)}`);
      }
    } finally {
      setBusyMyTeamLeagueUid((current) => current === leagueUid ? null : current);
    }
  }

  function selectMyTeam(leagueUid: string, teamUid: string) {
    void persistMyTeamSelection(leagueUid, teamUid);
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
    return buildScoringValueMap(leagueRosterPlayers, leagueAvailablePlayerStats, leagueValueCurve);
  }, [leagueAvailablePlayerStats, leagueRosterPlayers, leagueValueCurve]);
  const availableScoringValueByPlayerKey = scoringValueByPlayerKey;

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
  const selectedMyTeamUid = selectedLeague
    ? myTeamUidForLeague(selectedLeague.league_uid, selectedLeagueTeams, myTeamUidsByLeague)
    : "";

  const pageTitle =
    activeTool === "home"
      ? "Dashboard"
      : activeTool === "rankings"
        ? "Dynasty Rankings"
        : activeTool === "sources"
          ? "Manage Data Sources"
          : activeTool === "trade"
            ? "Trade Analyzer"
            : activeTool === "optimal-lineup"
              ? "Optimal Lineup"
            : activeTool === "pitchers"
              ? "Pitchers"
            : activeTool === "lineup"
              ? "Lineup Helper"
              : "Leagues";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-title">
          <p className="eyebrow">Assistant GM</p>
          <h1>{pageTitle}</h1>
        </div>
        <div className="topbar-actions">
          <nav className="segmented tool-nav" aria-label="Assistant tools" ref={toolNavRef}>
            <button aria-current={activeTool === "home" ? "page" : undefined} className={activeTool === "home" ? "active" : ""} onClick={() => navigateToTool("home")} type="button">
              <Home size={15} />
              Home
            </button>
            <button aria-current={activeTool === "rankings" ? "page" : undefined} className={activeTool === "rankings" ? "active" : ""} onClick={() => navigateToTool("rankings")} type="button">
              <Database size={15} />
              Rankings
            </button>
            <button aria-current={activeTool === "sources" ? "page" : undefined} className={activeTool === "sources" ? "active" : ""} onClick={() => navigateToTool("sources")} type="button">
              <Tags size={15} />
              Sources
            </button>
            <button aria-current={activeTool === "trade" ? "page" : undefined} className={activeTool === "trade" ? "active" : ""} onClick={() => navigateToTool("trade")} type="button">
              <ArrowLeftRight size={15} />
              Trade
            </button>
            <button aria-current={activeTool === "lineup" ? "page" : undefined} className={activeTool === "lineup" ? "active" : ""} onClick={() => navigateToTool("lineup")} type="button">
              <CalendarDays size={15} />
              Lineup
            </button>
            <button aria-current={activeTool === "optimal-lineup" ? "page" : undefined} className={activeTool === "optimal-lineup" ? "active" : ""} onClick={() => navigateToTool("optimal-lineup")} type="button">
              <Target size={15} />
              Optimal
            </button>
            <button aria-current={activeTool === "pitchers" ? "page" : undefined} className={activeTool === "pitchers" ? "active" : ""} onClick={() => navigateToTool("pitchers")} type="button">
              <Activity size={15} />
              Pitchers
            </button>
            <button aria-current={activeTool === "leagues" ? "page" : undefined} className={activeTool === "leagues" ? "active" : ""} onClick={() => navigateToTool("leagues")} type="button">
              <Users size={15} />
              Leagues
            </button>
          </nav>
          <div className="topbar-commands" aria-label="Page actions" key={activeTool} role="group">
          {activeTool === "rankings" ? (
            <a className="button ghost" href={`/api/rankings/export.csv?${exportParams}`}>
              <Download size={18} />
              Export
            </a>
          ) : null}
          <button
            className="button ghost"
            onClick={() => requestCloudRefresh("all")}
            disabled={cloudRefreshBusy}
            title="Ask your home machine to re-scrape everything and update the live site. Works from anywhere."
          >
            <RefreshCcw size={18} className={cloudRefreshBusy ? "spin" : ""} />
            Request Refresh
          </button>
          {activeTool === "rankings" || activeTool === "sources" ? (
            <>
              <button
                className="button ghost"
                onClick={updateContinuous}
                disabled={busySource !== null}
                title="Re-scrape only Continuous-tagged sources. Static sources (Updated / Old-Pre-season) don't need refreshing."
              >
                <RefreshCcw size={18} className={busySource === "continuous" ? "spin" : ""} />
                Update Continuous
              </button>
              <button className="button primary" onClick={updateAll} disabled={busySource !== null}>
                <RefreshCcw size={18} className={busySource === "all" ? "spin" : ""} />
                Update All
              </button>
            </>
          ) : null}
          </div>
        </div>
      </header>

      {activeTool === "home" ? (
        <HomeWorkspace
          board={board}
          busyLeague={busyLeague}
          busySource={busySource}
          cloudRefreshBusy={cloudRefreshBusy}
          requestCloudRefresh={requestCloudRefresh}
          leagues={leagues}
          onOpenRankings={() => navigateToTool("rankings")}
          onOpenSources={() => navigateToTool("sources")}
          onOpenLeagues={() => navigateToTool("leagues")}
          onOpenTrade={() => navigateToTool("trade")}
          onOpenLineup={() => navigateToTool("lineup")}
          onOpenOptimalLineup={() => navigateToTool("optimal-lineup")}
          onOpenPitchers={() => navigateToTool("pitchers")}
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
          availableStatsByPlayerKey={availableStatsByPlayerKey}
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
          myTeamUid={selectedMyTeamUid}
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
          myTeamUid={selectedMyTeamUid}
          selectedLeague={selectedLeague}
          selectedLeagueTeams={selectedLeagueTeams}
          selectedLeagueUid={selectedLeagueUid}
          setSelectedLeagueUid={setSelectedLeagueUid}
          setToast={setToast}
        />
      ) : activeTool === "optimal-lineup" ? (
        <OptimalLineupWorkspace
          leagues={leagues}
          myTeamUid={selectedMyTeamUid}
          selectedLeague={selectedLeague}
          selectedLeagueTeams={selectedLeagueTeams}
          selectedLeagueUid={selectedLeagueUid}
          setSelectedLeagueUid={setSelectedLeagueUid}
          setToast={setToast}
        />
      ) : activeTool === "pitchers" ? (
        <PitchersWorkspace
          board={board}
          includedSourceTags={includedSourceTags}
          leagueRosterPlayers={leagueRosterPlayers}
          leagueValueCurve={leagueValueCurve}
          leagues={leagues}
          myTeamUid={selectedMyTeamUid}
          scoringValueByPlayerKey={scoringValueByPlayerKey}
          selectedLeague={selectedLeague}
          selectedLeagueTeams={selectedLeagueTeams}
          selectedLeagueUid={selectedLeagueUid}
          setSelectedLeagueUid={setSelectedLeagueUid}
          setToast={setToast}
          toggleIncludedSourceTag={toggleIncludedSourceTag}
        />
      ) : (
        <LeaguesWorkspace
          busyLeague={busyLeague}
          busyTeam={busyTeam}
          cloudRefreshBusy={cloudRefreshBusy}
          importLeague={importLeague}
          leagueUrl={leagueUrl}
          leagueRosterPlayers={leagueRosterPlayers}
          leagueValueCurve={leagueValueCurve}
          leagues={leagues}
          leaguesLoading={leaguesLoading}
          myTeamUid={selectedMyTeamUid}
          myTeamSaving={busyMyTeamLeagueUid === selectedLeagueUid}
          myTeamUidsByLeague={myTeamUidsByLeague}
          removeLeague={removeLeague}
          requestCloudRefresh={requestCloudRefresh}
          refreshLeagueValueCurve={refreshLeagueRosterMap}
          selectedLeague={selectedLeague}
          selectedLeagueTeams={selectedLeagueTeams}
          selectedLeagueUid={selectedLeagueUid}
          selectMyTeam={selectMyTeam}
          setLeagueUrl={setLeagueUrl}
          setToast={setToast}
          setSelectedLeagueUid={setSelectedLeagueUid}
          teams={teams}
          teamsLoading={teamsLoading}
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
              <a className="button ghost" href="/api/import-template.csv">
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
  cloudRefreshBusy,
  requestCloudRefresh,
  leagues,
  onOpenRankings,
  onOpenSources,
  onOpenLeagues,
  onOpenTrade,
  onOpenLineup,
  onOpenOptimalLineup,
  onOpenPitchers,
  refreshLeagues,
  refreshRankings,
  sources,
  teams
}: {
  board: AggregateBoard;
  busyLeague: string | null;
  busySource: string | null;
  cloudRefreshBusy: boolean;
  requestCloudRefresh: (scope: string) => void;
  leagues: FantasyLeague[];
  onOpenRankings: () => void;
  onOpenSources: () => void;
  onOpenLeagues: () => void;
  onOpenTrade: () => void;
  onOpenLineup: () => void;
  onOpenOptimalLineup: () => void;
  onOpenPitchers: () => void;
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
        <button
          className="button primary"
          onClick={() => requestCloudRefresh("all")}
          disabled={cloudRefreshBusy}
          title="Ask your home worker to re-scrape all sources and teams, then update the live site. Works from anywhere."
        >
          <RefreshCcw size={18} className={cloudRefreshBusy ? "spin" : ""} />
          Request All
        </button>
        <button className="button ghost" onClick={refreshRankings} disabled={busySource !== null}>
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

        <button className="door-card" onClick={onOpenLeagues} type="button">
          <div className="door-icon">
            <Users size={24} />
          </div>
          <div>
            <p className="eyebrow">Tool 2</p>
            <h3>Leagues</h3>
            <p>Connect Ottoneu leagues, choose your team in each one, and manage every league from one place.</p>
          </div>
          <div className="door-metrics">
            <Metric label="Leagues" value={loadedLeagueCount.toLocaleString()} />
            <Metric label="League teams" value={loadedTeamCount.toLocaleString()} />
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

        <button className="door-card" onClick={onOpenOptimalLineup} type="button">
          <div className="door-icon">
            <Target size={24} />
          </div>
          <div>
            <p className="eyebrow">Tool 6</p>
            <h3>Optimal Lineup</h3>
            <p>Build a best-case MLB hitter lineup and expose positional strength, weakness, and bench depth.</p>
          </div>
          <div className="door-metrics">
            <Metric label="Slots" value={LINEUP_SLOTS.length.toLocaleString()} />
            <Metric label="Leagues" value={loadedLeagueCount.toLocaleString()} />
            <Metric label="Rostered" value={rosteredPlayerCount.toLocaleString()} />
          </div>
        </button>

        <button className="door-card" onClick={onOpenPitchers} type="button">
          <div className="door-icon">
            <Activity size={24} />
          </div>
          <div>
            <p className="eyebrow">Tool 7</p>
            <h3>Pitchers</h3>
            <p>Split a fantasy staff into starters and relievers using current FanGraphs appearance usage.</p>
          </div>
          <div className="door-metrics">
            <Metric label="Leagues" value={loadedLeagueCount.toLocaleString()} />
            <Metric label="Teams" value={loadedTeamCount.toLocaleString()} />
            <Metric label="Rostered" value={rosteredPlayerCount.toLocaleString()} />
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
  availableStatsByPlayerKey,
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
  availableStatsByPlayerKey: Map<string, LeagueAvailablePlayerStats>;
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
                  {showFantasyValue && <SortableHeader className="rank-col" label="Sc. Rank" rowSpan={2} sort={rankingSort} sortKey="scRank" setSort={setRankingSort} title="Scoring rank from Ottoneu total points for rostered and available MLB players." />}
                  <SortableHeader className="rank-col" label="Dy. Agg" rowSpan={2} sort={rankingSort} sortKey="dyAgg" setSort={setRankingSort} />
                  {showFantasyValue && <SortableHeader className="value-col" label="Dy. FV" rowSpan={2} sort={rankingSort} sortKey="dyValue" setSort={setRankingSort} defaultDirection="desc" />}
                  {showFantasyValue && <SortableHeader className="value-col" label="Sc. Val" rowSpan={2} sort={rankingSort} sortKey="scValue" setSort={setRankingSort} defaultDirection="desc" title="Scoring value from rostered and available MLB players ranked by Ottoneu total points, fitted to the league salary curve." />}
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
                    availableStats={leagueOverlayEnabled ? availableStatsByPlayerKey.get(player.player_key) || null : null}
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

type PitcherDisplayRow = TradePlayerRow & {
  usage: PitcherUsageRow;
  effectiveBucket: "SP" | "RP";
  effectiveRole: PitcherUsageOverride;
  usageMismatch: boolean;
  usageOverride: PitcherUsageOverride | null;
  usageRealityUnavailable: boolean;
};

function PitchersWorkspace({
  board,
  includedSourceTags,
  leagueRosterPlayers,
  leagueValueCurve,
  leagues,
  myTeamUid,
  scoringValueByPlayerKey,
  selectedLeague,
  selectedLeagueTeams,
  selectedLeagueUid,
  setSelectedLeagueUid,
  setToast,
  toggleIncludedSourceTag
}: {
  board: AggregateBoard;
  includedSourceTags: SourceTag[];
  leagueRosterPlayers: LeagueRosterPlayer[];
  leagueValueCurve: LeagueValueCurve | null;
  leagues: FantasyLeague[];
  myTeamUid: string;
  scoringValueByPlayerKey: Map<string, ScoringValueMetric>;
  selectedLeague: FantasyLeague | null;
  selectedLeagueTeams: FantasyTeam[];
  selectedLeagueUid: string;
  setSelectedLeagueUid: (leagueUid: string) => void;
  setToast: (message: string) => void;
  toggleIncludedSourceTag: (sourceTag: SourceTag) => void;
}) {
  const myTeam = selectedLeagueTeams.find((team) => team.team_uid === myTeamUid) || null;
  const [teamUid, setTeamUid] = useState(myTeam?.team_uid || "");
  const [usageResponse, setUsageResponse] = useState<PitcherUsageResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pitcherSort, setPitcherSort] = useState<TableSort>({ key: "dyValue", direction: "desc" });
  const [pitcherPlan, setPitcherPlan] = useState<PitcherPlan>(defaultPitcherPlan);
  const [planSyncState, setPlanSyncState] = useState<PitcherPlanSyncState>("idle");
  const pitcherPlanRef = useRef(pitcherPlan);
  const planLoadRequestRef = useRef(0);
  const planEditVersionRef = useRef(0);
  const planSaveVersionRef = useRef(0);
  const planSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingPlanSavesRef = useRef(new Map<string, { plan: PitcherPlan; version: number }>());
  const activePlanStorageKeyRef = useRef("");
  const season = new Date().getFullYear();
  const selectedTeam = selectedLeagueTeams.find((team) => team.team_uid === teamUid) || myTeam;
  const selectedTeamUid = selectedTeam?.team_uid || "";
  const cacheKey = `${selectedLeagueUid}:${selectedTeamUid}:${season}`;
  const confirmedSpTarget = Math.max(0, pitcherPlan.spTarget - pitcherPlan.bubbleTarget);
  const planStorageKey = selectedLeagueUid && selectedTeamUid
    ? `${PITCHER_PLAN_STORAGE_PREFIX}:${selectedLeagueUid}:${selectedTeamUid}`
    : "";
  const boardPlayerByKey = useMemo(() => new Map(board.players.map((player) => [player.player_key, player])), [board.players]);
  const allowedSourceIds = useMemo(
    () => board.sources.filter((source) => includedSourceTags.includes(source.source_tag)).map((source) => source.id),
    [board.sources, includedSourceTags]
  );
  const tradeRows = useMemo(
    () =>
      buildTradeRows(
        selectedTeamUid,
        leagueRosterPlayers,
        boardPlayerByKey,
        leagueValueCurve,
        allowedSourceIds,
        scoringValueByPlayerKey
      ).filter((row) => row.section === "pitcher"),
    [allowedSourceIds, boardPlayerByKey, leagueRosterPlayers, leagueValueCurve, scoringValueByPlayerKey, selectedTeamUid]
  );
  const usageByPlayerKey = useMemo(
    () => new Map((usageResponse?.rows || []).map((row) => [row.player_key, row])),
    [usageResponse]
  );
  const pitcherRows = useMemo(
    () =>
      tradeRows
        .map((row) => {
          const usage = usageByPlayerKey.get(row.player_key);
          if (!usage) return null;
          const usageOverride = pitcherPlan.usageOverrides[row.player_key] ?? null;
          const usageRealityUnavailable = !isPitcherUsageOverride(usage.role);
          const observedRole = isPitcherUsageOverride(usage.role) ? usage.role : usage.bucket;
          const effectiveRole = usageOverride ?? observedRole;
          return ({
            ...row,
            effectiveBucket: pitcherUsageBucket(effectiveRole, usage.bucket),
            effectiveRole,
            usage,
            usageMismatch: Boolean(usageOverride && !usageRealityUnavailable && usageOverride !== observedRole),
            usageOverride,
            usageRealityUnavailable
          } as PitcherDisplayRow);
        })
        .filter((row): row is PitcherDisplayRow => row !== null),
    [pitcherPlan.usageOverrides, tradeRows, usageByPlayerKey]
  );
  const spRows = useMemo(
    () => sortPitcherRows(pitcherRows.filter((row) => row.effectiveBucket === "SP"), pitcherSort),
    [pitcherRows, pitcherSort]
  );
  const rpRows = useMemo(
    () => sortPitcherRows(pitcherRows.filter((row) => row.effectiveBucket === "RP"), pitcherSort),
    [pitcherRows, pitcherSort]
  );
  const pitcherRowByKey = useMemo(
    () => new Map(pitcherRows.map((row) => [row.player_key, row])),
    [pitcherRows]
  );
  const selectedSpRows = useMemo(
    () =>
      pitcherPlan.selectedSpKeys
        .map((playerKey) => pitcherRowByKey.get(playerKey))
        .filter((row): row is PitcherDisplayRow => row !== undefined),
    [pitcherPlan.selectedSpKeys, pitcherRowByKey]
  );
  const bubbleSpRows = useMemo(
    () =>
      pitcherPlan.bubbleSpKeys
        .map((playerKey) => pitcherRowByKey.get(playerKey))
        .filter((row): row is PitcherDisplayRow => row !== undefined),
    [pitcherPlan.bubbleSpKeys, pitcherRowByKey]
  );
  const selectedRpRows = useMemo(
    () =>
      pitcherPlan.selectedRpKeys
        .map((playerKey) => pitcherRowByKey.get(playerKey))
        .filter((row): row is PitcherDisplayRow => row !== undefined),
    [pitcherPlan.selectedRpKeys, pitcherRowByKey]
  );
  const mixedCount = pitcherRows.filter((row) => row.usage.role.startsWith("Mixed")).length;

  const manualUsageCount = pitcherRows.filter((row) => row.usageOverride).length;
  const usageMismatchCount = pitcherRows.filter((row) => row.usageMismatch).length;
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
    const requestId = ++planLoadRequestRef.current;
    const hasCachedPlan = hasPitcherPlanCache(planStorageKey);
    const cachedPlan = loadPitcherPlan(planStorageKey);
    activePlanStorageKeyRef.current = planStorageKey;
    planEditVersionRef.current = 0;
    pitcherPlanRef.current = cachedPlan;
    setPitcherPlan(cachedPlan);
    if (!planStorageKey || !selectedLeagueUid || !selectedTeamUid) {
      setPlanSyncState("idle");
      return;
    }

    setPlanSyncState("loading");
    fetchPitcherPlan(selectedLeagueUid, selectedTeamUid)
      .then((response) => {
        if (requestId !== planLoadRequestRef.current || activePlanStorageKeyRef.current !== planStorageKey) return;
        const pendingSave = pendingPlanSavesRef.current.get(planStorageKey);
        if (pendingSave) {
          pitcherPlanRef.current = pendingSave.plan;
          setPitcherPlan(pendingSave.plan);
          setPlanSyncState("saving");
          return;
        }
        if (planEditVersionRef.current > 0) {
          queuePitcherPlanSave(pitcherPlanRef.current);
          return;
        }
        if (response.plan) {
          const savedPlan = normalizePitcherPlan(response.plan);
          pitcherPlanRef.current = savedPlan;
          setPitcherPlan(savedPlan);
          savePitcherPlanCache(planStorageKey, savedPlan);
          setPlanSyncState("saved");
          return;
        }
        if (hasCachedPlan) {
          // First visit after this feature ships: migrate this browser's existing plan into the DB.
          queuePitcherPlanSave(cachedPlan);
        } else {
          // Do not let a brand-new device overwrite the real browser-only plan with untouched defaults.
          setPlanSyncState("idle");
        }
      })
      .catch((error) => {
        if (requestId !== planLoadRequestRef.current || activePlanStorageKeyRef.current !== planStorageKey) return;
        setPlanSyncState("offline");
        setToast(`Pitcher plan database sync failed: ${errorMessage(error)} Browser backup is still active.`);
      });
  }, [planStorageKey, selectedLeagueUid, selectedTeamUid, setToast]);

  useEffect(() => {
    if (!selectedLeagueUid || !selectedTeamUid) {
      setUsageResponse(null);
      setLoadError(null);
      return;
    }
    const cached = PITCHER_USAGE_CACHE.get(cacheKey);
    if (cached) {
      setUsageResponse(cached);
      setLoadError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setUsageResponse(null);
    setLoadError(null);
    setLoading(true);
    fetchPitcherUsage(selectedLeagueUid, selectedTeamUid, season)
      .then((response) => {
        if (cancelled) return;
        PITCHER_USAGE_CACHE.set(cacheKey, response);
        setUsageResponse(response);
      })
      .catch((error) => {
        if (!cancelled) {
          const message = errorMessage(error);
          setLoadError(message);
          setToast(message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cacheKey, season, selectedLeagueUid, selectedTeamUid, setToast]);

  useEffect(() => {
    if (
      !planStorageKey ||
      planSyncState === "loading" ||
      !usageResponse ||
      usageResponse.league_uid !== selectedLeagueUid ||
      usageResponse.team_uid !== selectedTeamUid
    ) {
      return;
    }
    const current = pitcherPlanRef.current;
    const validPlayerKeys = new Set(usageResponse.rows.map((row) => row.player_key));
    const effectiveBucketByKey = new Map(
      usageResponse.rows.map((row) => {
        const observedRole = isPitcherUsageOverride(row.role) ? row.role : row.bucket;
        const effectiveRole = current.usageOverrides[row.player_key] ?? observedRole;
        return [row.player_key, pitcherUsageBucket(effectiveRole, row.bucket)] as const;
      })
    );
    const validSpKeys = new Set(
      [...effectiveBucketByKey].filter(([, bucket]) => bucket === "SP").map(([playerKey]) => playerKey)
    );
    const validRpKeys = new Set(
      [...effectiveBucketByKey].filter(([, bucket]) => bucket === "RP").map(([playerKey]) => playerKey)
    );
    const selectedSpKeys = current.selectedSpKeys.filter((playerKey) => validSpKeys.has(playerKey));
    const selectedSpKeySet = new Set(selectedSpKeys);
    const bubbleSpKeys = current.bubbleSpKeys.filter(
      (playerKey) => validSpKeys.has(playerKey) && !selectedSpKeySet.has(playerKey)
    );
    const selectedRpKeys = current.selectedRpKeys.filter((playerKey) => validRpKeys.has(playerKey));
    const usageOverrides = Object.fromEntries(
      Object.entries(current.usageOverrides).filter(([playerKey]) => validPlayerKeys.has(playerKey))
    );
    if (
      selectedSpKeys.length === current.selectedSpKeys.length &&
      bubbleSpKeys.length === current.bubbleSpKeys.length &&
      selectedRpKeys.length === current.selectedRpKeys.length &&
      Object.keys(usageOverrides).length === Object.keys(current.usageOverrides).length
    ) {
      return;
    }
    const next = { ...current, bubbleSpKeys, selectedSpKeys, selectedRpKeys, usageOverrides };
    updatePitcherPlan(() => next);
  }, [planStorageKey, planSyncState, selectedLeagueUid, selectedTeamUid, usageResponse]);

  function updatePitcherPlan(updater: (current: PitcherPlan) => PitcherPlan) {
    const next = normalizePitcherPlan(updater(pitcherPlanRef.current));
    planEditVersionRef.current += 1;
    pitcherPlanRef.current = next;
    setPitcherPlan(next);
    queuePitcherPlanSave(next);
  }

  function queuePitcherPlanSave(plan: PitcherPlan) {
    if (!planStorageKey || !selectedLeagueUid || !selectedTeamUid) return;
    const storageKey = planStorageKey;
    const leagueUid = selectedLeagueUid;
    const teamUid = selectedTeamUid;
    const saveVersion = ++planSaveVersionRef.current;
    pendingPlanSavesRef.current.set(storageKey, { plan, version: saveVersion });
    savePitcherPlanCache(storageKey, plan);
    if (activePlanStorageKeyRef.current === storageKey) setPlanSyncState("saving");
    planSaveQueueRef.current = planSaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        await savePitcherPlanToDatabase(leagueUid, teamUid, plan);
        if (pendingPlanSavesRef.current.get(storageKey)?.version === saveVersion) {
          pendingPlanSavesRef.current.delete(storageKey);
        }
        if (
          activePlanStorageKeyRef.current === storageKey &&
          planSaveVersionRef.current === saveVersion
        ) {
          setPlanSyncState("saved");
        }
      })
      .catch((error) => {
        if (pendingPlanSavesRef.current.get(storageKey)?.version === saveVersion) {
          pendingPlanSavesRef.current.delete(storageKey);
        }
        if (
          activePlanStorageKeyRef.current === storageKey &&
          planSaveVersionRef.current === saveVersion
        ) {
          setPlanSyncState("offline");
          setToast(`Pitcher plan database sync failed: ${errorMessage(error)} Browser backup is still active.`);
        }
      });
  }

  function updatePitcherTarget(bucket: "SP" | "BUBBLE" | "RP", value: number) {
    const target = clampPitcherPlanTarget(value);
    updatePitcherPlan((current) =>
      bucket === "SP"
        ? { ...current, bubbleTarget: Math.min(current.bubbleTarget, target), spTarget: target }
        : bucket === "BUBBLE"
          ? { ...current, bubbleTarget: Math.min(target, current.spTarget) }
          : { ...current, rpTarget: target }
    );
  }

  function setPitcherUsageOverride(playerKey: string, role: PitcherUsageOverride | null) {
    const usage = usageByPlayerKey.get(playerKey);
    if (!usage) return;
    const observedRole = isPitcherUsageOverride(usage.role) ? usage.role : usage.bucket;
    const effectiveRole = role ?? observedRole;
    const effectiveBucket = pitcherUsageBucket(effectiveRole, usage.bucket);
    updatePitcherPlan((current) => {
      const usageOverrides = { ...current.usageOverrides };
      if (role) {
        usageOverrides[playerKey] = role;
      } else {
        delete usageOverrides[playerKey];
      }
      return effectiveBucket === "SP"
        ? {
            ...current,
            selectedRpKeys: current.selectedRpKeys.filter((selectedKey) => selectedKey !== playerKey),
            usageOverrides
          }
        : {
            ...current,
            bubbleSpKeys: current.bubbleSpKeys.filter((selectedKey) => selectedKey !== playerKey),
            selectedSpKeys: current.selectedSpKeys.filter((selectedKey) => selectedKey !== playerKey),
            usageOverrides
          };
    });
  }

  function togglePitcherSelection(bucket: "SP" | "RP", playerKey: string) {
    const selectedKeys = bucket === "SP" ? pitcherPlan.selectedSpKeys : pitcherPlan.selectedRpKeys;
    const target = bucket === "SP" ? confirmedSpTarget : pitcherPlan.rpTarget;
    const isSelected = selectedKeys.includes(playerKey);
    if (!isSelected && selectedKeys.length >= target) {
      setToast(
        bucket === "SP"
          ? "Selected starter slots are full. Increase total SP slots, reduce Bubble slots, or remove a starter first."
          : "RP plan is full. Increase the RP slot count or remove a pitcher first."
      );
      return;
    }
    updatePitcherPlan((current) => {
      const key = bucket === "SP" ? "selectedSpKeys" : "selectedRpKeys";
      const currentKeys = current[key];
      const nextKeys = currentKeys.includes(playerKey)
        ? currentKeys.filter((selectedKey) => selectedKey !== playerKey)
        : [...currentKeys, playerKey];
      return bucket === "SP"
        ? { ...current, bubbleSpKeys: current.bubbleSpKeys.filter((selectedKey) => selectedKey !== playerKey), [key]: nextKeys }
        : { ...current, [key]: nextKeys };
    });
  }

  function toggleBubbleSelection(playerKey: string) {
    const isSelected = pitcherPlan.bubbleSpKeys.includes(playerKey);
    if (!isSelected && pitcherPlan.bubbleSpKeys.length >= pitcherPlan.bubbleTarget) {
      setToast("SP Bubble is full. Increase the Bubble slot count or remove a pitcher first.");
      return;
    }
    updatePitcherPlan((current) => {
      const bubbleSpKeys = current.bubbleSpKeys.includes(playerKey)
        ? current.bubbleSpKeys.filter((selectedKey) => selectedKey !== playerKey)
        : [...current.bubbleSpKeys, playerKey];
      return {
        ...current,
        bubbleSpKeys,
        selectedSpKeys: current.selectedSpKeys.filter((selectedKey) => selectedKey !== playerKey)
      };
    });
  }

  async function refreshUsage() {
    if (!selectedLeagueUid || !selectedTeamUid) return;
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetchPitcherUsage(selectedLeagueUid, selectedTeamUid, season);
      PITCHER_USAGE_CACHE.set(cacheKey, response);
      setUsageResponse(response);
      setToast(`Pitcher roles refreshed for ${response.rows.length} pitchers.`);
    } catch (error) {
      const message = errorMessage(error);
      setLoadError(message);
      setToast(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="pitchers-shell">
      <section className="pitchers-toolbar">
        <div>
          <p className="eyebrow">Pitching Staff</p>
          <h2>{selectedTeam?.team_name || selectedLeague?.league_name || "No team selected"}</h2>
        </div>
        <div className="pitchers-selectors">
          <select
            className="select-control"
            value={selectedLeagueUid}
            onChange={(event) => setSelectedLeagueUid(event.target.value)}
            aria-label="Pitchers league"
          >
            {leagues.map((league) => (
              <option key={league.league_uid} value={league.league_uid}>
                {league.league_name}
              </option>
            ))}
          </select>
          <select
            className="select-control"
            value={selectedTeamUid}
            onChange={(event) => setTeamUid(event.target.value)}
            aria-label="Pitchers fantasy team"
          >
            {selectedLeagueTeams.map((team) => (
              <option key={team.team_uid} value={team.team_uid}>
                {team.team_name}
              </option>
            ))}
          </select>
          <button className="button ghost" disabled={loading || !selectedTeamUid} onClick={refreshUsage} type="button">
            <RefreshCcw size={16} className={loading ? "spin" : ""} />
            Refresh Usage
          </button>
        </div>
      </section>

      <section className="pitchers-options">
        <p>
          SP/RP pitchers are classified from {season} FanGraphs game logs. A mixed pitcher lands with the role used most
          often in his last five appearances; ties go to RP. Use My Usage to save an override while keeping the observed
          role visible for comparison. Bubble slots are reserved within the total SP slots.
        </p>
        <div className="trade-source-controls">
          <span>Allowed Sources</span>
          <div className="segmented tag-segmented" aria-label="Source tag groups used in pitcher values">
            {SOURCE_TAGS.map((sourceTag) => {
              const active = includedSourceTags.includes(sourceTag);
              return (
                <button
                  key={sourceTag}
                  className={active ? "active" : ""}
                  onClick={() => toggleIncludedSourceTag(sourceTag)}
                  title={`${active ? "Remove" : "Include"} ${sourceTag} sources in pitcher values.`}
                  aria-label={`${active ? "Remove" : "Include"} ${sourceTag} sources in pitcher values`}
                >
                  {sourceTag}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="pitchers-summary" aria-label="Pitcher role summary">
        <Metric label="Pitchers" value={(usageResponse?.rows.length || 0).toLocaleString()} />
        <Metric label="SP / SP-leaning" value={spRows.length.toLocaleString()} />
        <Metric label="RP / RP-leaning" value={rpRows.length.toLocaleString()} />
        <Metric label="Mixed Use" value={mixedCount.toLocaleString()} />
        <Metric label="Manual Usage" value={manualUsageCount.toLocaleString()} />
        <Metric label="Out of Sync" value={usageMismatchCount.toLocaleString()} />
      </section>

      {selectedTeamUid ? (
        <section className="pitcher-plan-builder" aria-label="Selected pitching staff">
          <div className="pitcher-plan-heading">
            <div>
              <p className="eyebrow">My Pitching Plan</p>
              <h2>Build your rotation and bullpen</h2>
              <p>
                Your choices are saved for this fantasy team across devices.
                <span className={`pitcher-plan-sync ${planSyncState}`}>
                  {pitcherPlanSyncLabel(planSyncState)}
                </span>
              </p>
            </div>
            <div className="pitcher-plan-targets">
              <label>
                <span>Total SP slots</span>
                <input
                  aria-label="Total starting pitcher slots"
                  max={MAX_PITCHER_PLAN_SLOTS}
                  min={0}
                  onChange={(event) => updatePitcherTarget("SP", Number(event.target.value))}
                  type="number"
                  value={pitcherPlan.spTarget}
                />
              </label>
              <label>
                <span>Bubble slots within SP</span>
                <input
                  aria-label="Bubble slots within total starting pitcher slots"
                  max={pitcherPlan.spTarget}
                  min={0}
                  onChange={(event) => updatePitcherTarget("BUBBLE", Number(event.target.value))}
                  type="number"
                  value={pitcherPlan.bubbleTarget}
                />
              </label>
              <label>
                <span>RP slots</span>
                <input
                  aria-label="Relief pitcher slots"
                  max={MAX_PITCHER_PLAN_SLOTS}
                  min={0}
                  onChange={(event) => updatePitcherTarget("RP", Number(event.target.value))}
                  type="number"
                  value={pitcherPlan.rpTarget}
                />
              </label>
            </div>
          </div>
          <div className="pitcher-plan-lists">
            <PitcherPlanCard
              kind="SP"
              onRemove={(playerKey) => togglePitcherSelection("SP", playerKey)}
              rows={selectedSpRows}
              target={confirmedSpTarget}
            />
            <PitcherPlanCard
              kind="BUBBLE"
              onRemove={toggleBubbleSelection}
              rows={bubbleSpRows}
              target={pitcherPlan.bubbleTarget}
            />
            <PitcherPlanCard
              kind="RP"
              onRemove={(playerKey) => togglePitcherSelection("RP", playerKey)}
              rows={selectedRpRows}
              target={pitcherPlan.rpTarget}
            />
          </div>
        </section>
      ) : null}

      {usageResponse?.errors.length ? (
        <div className="pitchers-warning" title={usageResponse.errors.join("\n")}>
          <AlertCircle size={17} />
          {usageResponse.errors.length} usage {usageResponse.errors.length === 1 ? "lookup used" : "lookups used"} roster
          totals as a fallback. Hover for details.
        </div>
      ) : null}


      {usageMismatchCount ? (
        <div className="pitchers-warning usage-sync-warning">
          <AlertCircle size={17} />
          {usageMismatchCount} manual usage {usageMismatchCount === 1 ? "selection differs" : "selections differ"} from
          current FanGraphs usage. Review the rows marked Out of sync.
        </div>
      ) : null}
      {loading && !usageResponse ? (
        <section className="pitchers-loading">
          <RefreshCcw className="spin" size={20} />
          Loading current pitcher usage...
        </section>
      ) : loadError && !usageResponse ? (
        <section className="pitchers-loading pitchers-load-error">
          <AlertCircle size={20} />
          Pitcher usage could not be loaded: {loadError}
        </section>
      ) : !selectedTeamUid ? (
        <section className="pitchers-loading">Select a loaded fantasy team to assess its pitching staff.</section>
      ) : (
        <section className="pitcher-tables">
          <PitcherQualityTable
            bucket="SP"
            bubblePlayerKeys={pitcherPlan.bubbleSpKeys}
            bubbleTarget={pitcherPlan.bubbleTarget}
            onToggleBubble={toggleBubbleSelection}
            onToggleSelection={(playerKey) => togglePitcherSelection("SP", playerKey)}
            rows={spRows}
            onUsageOverride={setPitcherUsageOverride}
            selectedPlayerKeys={pitcherPlan.selectedSpKeys}
            selectionTarget={confirmedSpTarget}
            setSort={setPitcherSort}
            sort={pitcherSort}
          />
          <PitcherQualityTable
            bucket="RP"
            onToggleSelection={(playerKey) => togglePitcherSelection("RP", playerKey)}
            rows={rpRows}
            selectedPlayerKeys={pitcherPlan.selectedRpKeys}
            selectionTarget={pitcherPlan.rpTarget}
            onUsageOverride={setPitcherUsageOverride}
            setSort={setPitcherSort}
            sort={pitcherSort}
          />
        </section>
      )}
    </main>
  );
}

function PitcherPlanCard({
  kind,
  onRemove,
  rows,
  target
}: {
  kind: "SP" | "BUBBLE" | "RP";
  onRemove: (playerKey: string) => void;
  rows: PitcherDisplayRow[];
  target: number;
}) {
  const openSlots = Math.max(0, target - rows.length);
  const isComplete = target > 0 && rows.length === target;
  const isOver = rows.length > target;
  const label = kind === "SP" ? "Rotation" : kind === "BUBBLE" ? "Decisions" : "Bullpen";
  const title = kind === "SP" ? "Selected Starters" : kind === "BUBBLE" ? "On the Bubble" : "Selected Relievers";
  const slotLabel = kind === "BUBBLE" ? "Bubble SP" : kind;
  return (
    <article className={`pitcher-plan-card ${kind.toLowerCase()}`}>
      <div className="pitcher-plan-card-heading">
        <div>
          <p className="eyebrow">{label}</p>
          <h3>{title}</h3>
        </div>
        <strong className={isOver ? "over" : isComplete ? "complete" : ""}>
          {rows.length} / {target}
        </strong>
      </div>
      {target === 0 && rows.length === 0 ? (
        <p className="pitcher-plan-empty">
          {kind === "SP"
            ? "Selected starter slots equal total SP slots minus Bubble slots."
            : `Set the ${slotLabel} slot count above to start building this list.`}
        </p>
      ) : (
        <ol className="pitcher-plan-list">
          {rows.map((row, index) => (
            <li className="filled" key={row.player_key}>
              <span className="pitcher-plan-slot">{index + 1}</span>
              <div>
                <strong>{row.player_name}</strong>
                <span>
                  {row.effectiveRole} / {formatRate(row)} / Dy. {formatFantasyValue(row.value)}
                  {row.usageMismatch ? ` / Observed ${row.usage.role}` : ""}
                </span>
              </div>
              <button
                aria-label={`Remove ${row.player_name} from ${label.toLowerCase()}`}
                className="pitcher-plan-remove"
                onClick={() => onRemove(row.player_key)}
                title="Remove from plan"
                type="button"
              >
                <X size={15} />
              </button>
            </li>
          ))}
          {Array.from({ length: openSlots }, (_, index) => (
            <li className="open" key={`open-${index}`}>
              <span className="pitcher-plan-slot">{rows.length + index + 1}</span>
              <span>Open {slotLabel} slot</span>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

function PitcherQualityTable({
  bubblePlayerKeys = [],
  bubbleTarget = 0,
  bucket,
  onToggleBubble,
  onToggleSelection,
  onUsageOverride,
  rows,
  selectedPlayerKeys,
  selectionTarget,
  setSort,
  sort
}: {
  bubblePlayerKeys?: string[];
  bubbleTarget?: number;
  bucket: "SP" | "RP";
  onToggleBubble?: (playerKey: string) => void;
  onToggleSelection: (playerKey: string) => void;
  onUsageOverride: (playerKey: string, role: PitcherUsageOverride | null) => void;
  rows: PitcherDisplayRow[];
  selectedPlayerKeys: string[];
  selectionTarget: number;
  setSort: (sort: TableSort) => void;
  sort: TableSort;
}) {
  const selectionFull = selectedPlayerKeys.length >= selectionTarget;
  const bubbleFull = bubblePlayerKeys.length >= bubbleTarget;
  const planCount = bucket === "SP" ? selectedPlayerKeys.length + bubblePlayerKeys.length : selectedPlayerKeys.length;
  const planTarget = bucket === "SP" ? selectionTarget + bubbleTarget : selectionTarget;
  return (
    <article className="pitcher-table-panel">
      <div className="pitcher-table-heading">
        <div>
          <p className="eyebrow">{bucket === "SP" ? "Rotation" : "Bullpen"}</p>
          <h2>{bucket === "SP" ? "Starting Pitchers" : "Relief Pitchers"}</h2>
        </div>
        <strong title={`${rows.length} eligible ${bucket}s`}>{planCount} / {planTarget}</strong>
      </div>
      <div className="pitcher-table-wrap">
        <table className="pitcher-quality-table">
          <thead>
            <tr>
              <th className="pitcher-plan-select-col">Plan</th>
              <SortableHeader className="player-col" label="Player" sort={sort} sortKey="player" setSort={setSort} />
              <th className="pitcher-usage-choice-col">My Usage</th>
              <SortableHeader label="Observed" sort={sort} sortKey="role" setSort={setSort} />
              <SortableHeader label="Usage" sort={sort} sortKey="usage" setSort={setSort} defaultDirection="desc" />
              <th>Last 5</th>
              <SortableHeader label="Dy. Agg" sort={sort} sortKey="dyAgg" setSort={setSort} />
              <SortableHeader label="Sc. Agg" sort={sort} sortKey="scAgg" setSort={setSort} />
              <SortableHeader label="Pos" sort={sort} sortKey="positions" setSort={setSort} />
              <SortableHeader label="Salary" sort={sort} sortKey="salary" setSort={setSort} defaultDirection="desc" />
              <SortableHeader label="Pts" sort={sort} sortKey="points" setSort={setSort} defaultDirection="desc" />
              <SortableHeader label="xFIP-" sort={sort} sortKey="xfip" setSort={setSort} defaultDirection="asc" />
              <SortableHeader label="Rate" sort={sort} sortKey="rate" setSort={setSort} defaultDirection="desc" />
              <SortableHeader label="Dy. FV" sort={sort} sortKey="dyValue" setSort={setSort} defaultDirection="desc" />
              <SortableHeader label="Sc. Val" sort={sort} sortKey="scValue" setSort={setSort} defaultDirection="desc" />
              <SortableHeader label="Dy. Val +/-" sort={sort} sortKey="dyDelta" setSort={setSort} defaultDirection="desc" />
              <SortableHeader label="Sc. Val +/-" sort={sort} sortKey="scDelta" setSort={setSort} defaultDirection="desc" />
              <SortableHeader label="Dy. Min" sort={sort} sortKey="dyMin" setSort={setSort} defaultDirection="desc" />
              <SortableHeader label="Dy. Max" sort={sort} sortKey="dyMax" setSort={setSort} defaultDirection="desc" />
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => {
                const isSelected = selectedPlayerKeys.includes(row.player_key);
                const isBubble = bubblePlayerKeys.includes(row.player_key);
                return (
                <tr
                  className={`${isSelected ? "pitcher-row-selected" : isBubble ? "pitcher-row-bubble" : ""} ${row.usageMismatch ? "pitcher-row-usage-mismatch" : ""}`.trim()}
                  key={row.player_key}
                >
                  <td className="pitcher-plan-select-col">
                    <div className="pitcher-select-actions">
                      <button
                        aria-pressed={isSelected}
                        className={`pitcher-select-button ${isSelected ? "selected" : ""}`}
                        disabled={!isSelected && selectionFull}
                        onClick={() => onToggleSelection(row.player_key)}
                        title={
                          isSelected
                            ? `Remove ${row.player_name} from the ${bucket === "SP" ? "rotation" : "bullpen"}`
                            : selectionFull
                              ? `${bucket} plan is full`
                              : `Add ${row.player_name} to the ${bucket === "SP" ? "rotation" : "bullpen"}`
                        }
                        type="button"
                      >
                        {isSelected ? <CheckCircle2 size={14} /> : null}
                        {bucket === "SP" ? (isSelected ? "Starter" : "Start") : (isSelected ? "Selected" : "Add")}
                      </button>
                      {bucket === "SP" && onToggleBubble ? (
                        <button
                          aria-pressed={isBubble}
                          className={`pitcher-select-button bubble ${isBubble ? "selected" : ""}`}
                          disabled={!isBubble && bubbleFull}
                          onClick={() => onToggleBubble(row.player_key)}
                          title={
                            isBubble
                              ? `Remove ${row.player_name} from the Bubble`
                              : bubbleFull
                                ? "SP Bubble is full"
                                : `Put ${row.player_name} on the Bubble`
                          }
                          type="button"
                        >
                          {isBubble ? <CheckCircle2 size={14} /> : null}
                          Bubble
                        </button>
                      ) : null}
                    </div>
                  </td>
                  <td className="player-col">
                    <strong>{row.player_name}</strong>
                    <RosterStatusBadge mlbTeam={row.mlbTeam} status={row.status} />
                    {row.usage.fangraphs_url ? (
                      <a
                        className="pitcher-log-link"
                        href={row.usage.fangraphs_url}
                        target="_blank"
                        rel="noreferrer"
                        title="Open FanGraphs game log"
                      >
                        <ExternalLink size={13} />
                      </a>
                    ) : null}
                  </td>
                  <td className="pitcher-usage-choice-cell">
                    <select
                      aria-label={`My usage for ${row.player_name}`}
                      className={`pitcher-usage-select ${row.usageMismatch ? "mismatch" : ""}`}
                      onChange={(event) => {
                        const role = event.target.value;
                        onUsageOverride(row.player_key, isPitcherUsageOverride(role) ? role : null);
                      }}
                      value={row.usageOverride ?? ""}
                    >
                      <option value="">Automatic ({row.usage.role})</option>
                      {PITCHER_USAGE_OVERRIDE_OPTIONS.map((role) => (
                        <option key={role} value={role}>{role}</option>
                      ))}
                    </select>
                    <span className={`pitcher-usage-sync-state ${row.usageMismatch ? "mismatch" : ""}`}>
                      {row.usageOverride
                        ? row.usageRealityUnavailable
                          ? "Reality unavailable"
                          : row.usageMismatch
                            ? `Out of sync: ${row.usage.role}`
                            : "Matches observed"
                        : "Following observed"}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`pitcher-role ${pitcherRoleClass(row.usage)}`}
                      title={row.usage.error || pitcherRoleTitle(row.usage)}
                    >
                      {row.usage.role}
                    </span>
                  </td>
                  <td>{formatPitcherUsage(row.usage)}</td>
                  <td>
                    <div className="recent-usage" aria-label={`Last appearances: ${row.usage.last_five.join(", ") || "none"}`}>
                      {row.usage.last_five.length
                        ? row.usage.last_five.map((role, index) => (
                            <span className={role.toLowerCase()} key={`${role}-${index}`}>
                              {role}
                            </span>
                          ))
                        : "-"}
                    </div>
                  </td>
                  <td>{row.aggregate_rank ? `#${row.aggregate_rank}` : "-"}</td>
                  <td>{row.scoringRank ? `#${row.scoringRank}` : "-"}</td>
                  <td>{row.positions || "-"}</td>
                  <td>{formatMoney(row.salary)}</td>
                  <td>{formatTradePoints(row)}</td>
                  <td title={row.usage.xfip_error || "FanGraphs season xFIP-"}>
                    {formatXfipMinus(row.usage.xfip_minus)}
                  </td>
                  <td>{formatRate(row)}</td>
                  <td>{formatFantasyValue(row.value)}</td>
                  <td>{formatFantasyValue(row.scoredValue)}</td>
                  <td><ValueMinusSalary value={row.value} salary={row.salary} /></td>
                  <td><ValueMinusSalary value={row.scoredValue} salary={row.salary} /></td>
                  <td>{formatFantasyValue(row.minValue)}</td>
                  <td>{formatFantasyValue(row.maxValue)}</td>
                </tr>
                );
              })
            ) : (
              <tr>
                <td className="empty-table-cell" colSpan={19}>No pitchers classified in this group.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </article>
  );
}

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
  myTeamUid,
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
  myTeamUid: string;
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
  const myTeam = selectedLeagueTeams.find((team) => team.team_uid === myTeamUid) || null;
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

function OptimalLineupWorkspace({
  leagues,
  myTeamUid,
  selectedLeague,
  selectedLeagueTeams,
  selectedLeagueUid,
  setSelectedLeagueUid,
  setToast
}: {
  leagues: FantasyLeague[];
  myTeamUid: string;
  selectedLeague: FantasyLeague | null;
  selectedLeagueTeams: FantasyTeam[];
  selectedLeagueUid: string;
  setSelectedLeagueUid: (leagueUid: string) => void;
  setToast: (message: string) => void;
}) {
  const myTeam = selectedLeagueTeams.find((team) => team.team_uid === myTeamUid) || null;
  const [teamUid, setTeamUid] = useState(myTeam?.team_uid || "");
  const [response, setResponse] = useState<OptimalLineupResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const season = new Date().getFullYear();
  const selectedTeam = selectedLeagueTeams.find((team) => team.team_uid === teamUid) || myTeam;
  const selectedTeamUid = selectedTeam?.team_uid || "";
  const cacheKey = `${selectedLeagueUid}:${selectedTeamUid}:${season}`;
  const rows = response?.rows || [];
  const optimizer = useMemo(() => optimizeBestCaseLineup(rows), [rows]);
  const displayRows = useMemo(() => buildOptimalLineupDisplayRows(rows, optimizer), [optimizer, rows]);
  const starterRows = useMemo(() => displayRows.filter((row) => row.assignment !== null), [displayRows]);
  const benchRows = useMemo(() => displayRows.filter((row) => row.assignment === null), [displayRows]);
  const positionRows = useMemo(() => buildPositionStrengthRows(starterRows, benchRows), [benchRows, starterRows]);
  const strongestPosition = bestPositionBy(positionRows, (row) => row.starterScore, "max");
  const weakestPosition = bestPositionBy(positionRows, (row) => row.starterScore, "min");
  const deepestPosition = bestPositionBy(positionRows, (row) => row.depthScore, "max");
  const thinnestPosition = bestPositionBy(positionRows, (row) => row.depthScore, "min");
  const starterPoints = bestCaseLineupSeasonPoints(starterRows);
  const starterWrcPlus = bestCaseLineupAverageMetric(starterRows, (entry) => entry.row.wrc_plus);
  const benchPpg = averageMetric(benchRows.map((entry) => entry.row.points_per_game));

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
    if (!selectedLeagueUid || !selectedTeamUid) {
      setResponse(null);
      setLoadError(null);
      return;
    }
    const cached = OPTIMAL_LINEUP_CACHE.get(cacheKey);
    if (cached) {
      setResponse(cached);
      setLoadError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setResponse(null);
    setLoadError(null);
    setLoading(true);
    fetchOptimalLineup(selectedLeagueUid, selectedTeamUid, season)
      .then((result) => {
        if (cancelled) return;
        OPTIMAL_LINEUP_CACHE.set(cacheKey, result);
        setResponse(result);
      })
      .catch((error) => {
        if (!cancelled) {
          const message = errorMessage(error);
          setLoadError(message);
          setToast(message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cacheKey, season, selectedLeagueUid, selectedTeamUid, setToast]);

  async function refreshOptimalLineup() {
    if (!selectedLeagueUid || !selectedTeamUid) return;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await fetchOptimalLineup(selectedLeagueUid, selectedTeamUid, season);
      OPTIMAL_LINEUP_CACHE.set(cacheKey, result);
      setResponse(result);
      setToast(`Best-case lineup refreshed for ${result.rows.length} MLB hitters.`);
    } catch (error) {
      const message = errorMessage(error);
      setLoadError(message);
      setToast(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="workspace optimal-lineup-workspace">
      <aside className="sources-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Best-Case Roster</p>
            <h2>{selectedLeague?.league_name || "No league selected"}</h2>
          </div>
          <Target size={22} />
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
          <select className="select-control" value={selectedTeamUid} onChange={(event) => setTeamUid(event.target.value)}>
            {selectedLeagueTeams.map((team) => (
              <option key={team.team_uid} value={team.team_uid}>
                {team.team_name}
              </option>
            ))}
          </select>

          <button className="button primary" disabled={loading || !selectedTeamUid} onClick={refreshOptimalLineup} type="button">
            <RefreshCcw size={17} className={loading ? "spin" : ""} />
            Refresh Roster Quality
          </button>
        </section>

        <section className="optimal-method-card">
          <p className="eyebrow">How it works</p>
          <h3>Best case, not today&apos;s availability</h3>
          <p>IL, DL, and suspended MLB hitters remain eligible. Minor-league players are excluded.</p>
          <p>The optimizer fills all 13 lineup boxes. The two C boxes share one 162-game cap, so they count as one season-long position.</p>
          <p>Catcher tandem P/G and wRC+ are weighted by games played. Combined C points are capped at one position&apos;s current games pace.</p>
          <p>Strength blends P/G with FanGraphs wRC+. Total points show season volume and reliability.</p>
        </section>
      </aside>

      <section className="rankings-panel optimal-lineup-panel">
        <div className="team-heading">
          <div>
            <p className="eyebrow">Optimal MLB Hitters</p>
            <h2>{selectedTeam?.team_name || "Select a team"}</h2>
          </div>
          <span className="optimal-best-case-badge">Injuries ignored</span>
        </div>

        <div className="board-summary optimal-lineup-summary">
          <Metric label="MLB hitters" value={rows.length.toLocaleString()} />
          <Metric label="Filled slots" value={`${optimizer.starterCount}/${LINEUP_SLOTS.length}`} />
          <Metric label="12-pos P/G" value={formatDecimal(optimizer.totalPoints)} />
          <Metric label="Lineup Pts" value={formatDecimal(starterPoints)} />
          <Metric label="Avg wRC+" value={formatWrcPlus(starterWrcPlus)} />
          <Metric label="Bench bats" value={benchRows.length.toLocaleString()} />
          <Metric label="Avg bench P/G" value={formatDecimal(benchPpg)} />
          <Metric label="Strongest" value={strongestPosition?.position || "-"} />
          <Metric label="Weakest" value={weakestPosition?.position || "-"} />
          <Metric label="Deepest" value={deepestPosition?.position || "-"} />
          <Metric label="Thinnest" value={thinnestPosition?.position || "-"} />
        </div>

        {response?.errors.length ? (
          <div className="lineup-notice" title={response.errors.join("\n")}>
            FanGraphs wRC+ was unavailable for {response.errors.length} {response.errors.length === 1 ? "hitter" : "hitters"}.
            Ottoneu P/G still determines the optimal lineup. Hover for details.
          </div>
        ) : null}

        {loading && !response ? (
          <section className="optimal-loading">
            <RefreshCcw className="spin" size={20} />
            Loading Ottoneu scoring and FanGraphs wRC+...
          </section>
        ) : loadError && !response ? (
          <section className="optimal-loading optimal-load-error">
            <AlertCircle size={20} />
            Optimal lineup could not be loaded: {loadError}
          </section>
        ) : !selectedTeamUid ? (
          <section className="optimal-loading">Select a loaded fantasy team.</section>
        ) : (
          <>
            <OptimalPositionStrengthTable rows={positionRows} />
            <OptimalHitterTable eyebrow="Best-case starters" rows={starterRows} title="Optimal Lineup" />
            <OptimalHitterTable eyebrow="Roster depth" rows={benchRows} title="Bench Strength" />
          </>
        )}
      </section>
    </main>
  );
}

function OptimalPositionStrengthTable({ rows }: { rows: PositionStrengthRow[] }) {
  return (
    <section className="optimal-section">
      <div className="optimal-section-heading">
        <div>
          <p className="eyebrow">Position Map</p>
          <h3>Where the roster is strong, weak, deep, or thin</h3>
        </div>
        <span>P/G + Pts + wRC+; C is one shared cap</span>
      </div>
      <div className="table-wrap optimal-position-wrap">
        <table className="optimal-position-table">
          <thead>
            <tr>
              <th>Pos</th>
              <th>Role</th>
              <th className="player-col">Player</th>
              <th>Quality</th>
              <th>P/G</th>
              <th>Pts</th>
              <th>wRC+</th>
              <th>G</th>
              <th>PA</th>
              <th>Status</th>
              <th>Drop</th>
            </tr>
          </thead>
          {rows.map((positionRow) => (
            <tbody className="optimal-position-group" key={positionRow.position}>
              {positionRow.players.length ? positionRow.players.map((playerRow, index) => {
                const player = playerRow.entry.row;
                const qualityTier = strengthTier(playerRow.entry.score);
                return (
                  <tr
                    className={`optimal-position-player-row ${index === 0 ? "group-start" : ""} ${playerRow.entry.assignment ? "starter" : "depth"}`}
                    key={`${positionRow.position}:${player.player_key}`}
                  >
                    {index === 0 ? (
                      <td className="optimal-position-label" rowSpan={positionRow.players.length}>
                        <strong>{positionRow.position}</strong>
                        <span>Lineup</span>
                        <StrengthPill label={strengthTierLabel(positionRow.starterTier)} tone={positionRow.starterTier} />
                        <span>Depth</span>
                        <StrengthPill label={depthTierLabel(positionRow.depthTier)} tone={depthTone(positionRow.depthTier)} />
                      </td>
                    ) : null}
                    <td>
                      <span className={`position-map-role ${playerRow.entry.assignment ? "starter" : "depth"}`}>
                        {playerRow.role}
                      </span>
                    </td>
                    <td className="player-col">
                      <strong>{player.player_name}</strong>
                      {player.fangraphs_url ? (
                        <a
                          className="pitcher-log-link"
                          href={player.fangraphs_url}
                          rel="noreferrer"
                          target="_blank"
                          title="Open FanGraphs hitter page"
                        >
                          <ExternalLink size={13} />
                        </a>
                      ) : null}
                    </td>
                    <td><StrengthPill label={strengthTierLabel(qualityTier)} tone={qualityTier} /></td>
                    <td><strong>{formatDecimal(player.points_per_game)}</strong></td>
                    <td>{formatDecimal(player.points)}</td>
                    <td>{formatWrcPlus(player.wrc_plus)}</td>
                    <td>{formatWholeNumber(player.games)}</td>
                    <td>{formatWholeNumber(player.plate_appearances)}</td>
                    <td>
                      <RosterStatusBadge mlbTeam={player.mlb_team} status={player.status} />
                      {!player.status ? "Active" : null}
                    </td>
                    <td>{playerRow.entry.assignment ? "-" : formatPpgDrop(playerRow.dropoff)}</td>
                  </tr>
                );
              }) : (
                <tr className="optimal-position-player-row group-start">
                  <td className="optimal-position-label">
                    <strong>{positionRow.position}</strong>
                  </td>
                  <td className="empty-table-cell" colSpan={10}>No eligible MLB hitters.</td>
                </tr>
              )}
            </tbody>
          ))}
        </table>
      </div>
    </section>
  );
}

function OptimalHitterTable({
  eyebrow,
  rows,
  title
}: {
  eyebrow: string;
  rows: OptimalLineupDisplayRow[];
  title: string;
}) {
  const isBench = rows.every((row) => row.assignment === null);
  return (
    <section className="optimal-section">
      <div className="optimal-section-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3>{title}</h3>
        </div>
        <strong>{rows.length}</strong>
      </div>
      <div className="table-wrap optimal-hitter-wrap">
        <table className="optimal-hitter-table">
          <thead>
            <tr>
              <th>{isBench ? "Depth" : "Slot"}</th>
              <th className="player-col">Player</th>
              <th>Quality</th>
              <th>Pos</th>
              <th>MLB</th>
              <th>Status</th>
              <th>P/G</th>
              <th>Pts</th>
              <th>wRC+</th>
              <th>G</th>
              <th>PA</th>
              <th>Salary</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((entry) => {
              const tier = strengthTier(entry.score);
              return (
                <tr className={`optimal-hitter-row ${tier}`} key={entry.row.player_key}>
                  <td>
                    {entry.assignment ? (
                      <span className="lineup-slot-pill starter">{entry.assignment.label}</span>
                    ) : (
                      <span className="lineup-slot-pill bench">Bench</span>
                    )}
                  </td>
                  <td className="player-col">
                    <strong>{entry.row.player_name}</strong>
                    {entry.row.fangraphs_url ? (
                      <a
                        className="pitcher-log-link"
                        href={entry.row.fangraphs_url}
                        rel="noreferrer"
                        target="_blank"
                        title="Open FanGraphs hitter page"
                      >
                        <ExternalLink size={13} />
                      </a>
                    ) : null}
                  </td>
                  <td><StrengthPill label={strengthTierLabel(tier)} tone={tier} /></td>
                  <td>{entry.row.positions || "-"}</td>
                  <td>{entry.row.mlb_team || "-"}</td>
                  <td>
                    <RosterStatusBadge mlbTeam={entry.row.mlb_team} status={entry.row.status} />
                    {!entry.row.status ? "Active" : null}
                  </td>
                  <td><strong>{formatDecimal(entry.row.points_per_game)}</strong></td>
                  <td>{formatDecimal(entry.row.points)}</td>
                  <td title={entry.row.wrc_error || "FanGraphs current-season wRC+"}>{formatWrcPlus(entry.row.wrc_plus)}</td>
                  <td>{formatWholeNumber(entry.row.games)}</td>
                  <td>{formatWholeNumber(entry.row.plate_appearances)}</td>
                  <td>{formatMoney(entry.row.salary)}</td>
                </tr>
              );
            }) : (
              <tr>
                <td className="empty-table-cell" colSpan={12}>{isBench ? "No MLB hitters remain on the bench." : "No valid lineup could be built."}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StrengthPill({ label, tone }: { label: string; tone: StrengthTier }) {
  return <span className={`optimal-strength-pill ${tone}`}>{label}</span>;
}

function LineupHelperWorkspace({
  leagues,
  myTeamUid,
  selectedLeague,
  selectedLeagueTeams,
  selectedLeagueUid,
  setSelectedLeagueUid,
  setToast
}: {
  leagues: FantasyLeague[];
  myTeamUid: string;
  selectedLeague: FantasyLeague | null;
  selectedLeagueTeams: FantasyTeam[];
  selectedLeagueUid: string;
  setSelectedLeagueUid: (leagueUid: string) => void;
  setToast: (message: string) => void;
}) {
  const myTeam = selectedLeagueTeams.find((team) => team.team_uid === myTeamUid) || null;
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
  const [pitcherPlan, setPitcherPlan] = useState<PitcherPlan>(defaultPitcherPlan);
  const selectedTeam = selectedLeagueTeams.find((team) => team.team_uid === teamUid) || myTeam;
  const selectedTeamUid = selectedTeam?.team_uid || "";
  const pitcherPlanStorageKey = selectedLeagueUid && selectedTeamUid
    ? `${PITCHER_PLAN_STORAGE_PREFIX}:${selectedLeagueUid}:${selectedTeamUid}`
    : "";
  const lineupDisplayRows = useMemo(() => buildLineupDisplayRows(rows, lineupOptimizer, xfipDeltaFactor), [lineupOptimizer, rows, xfipDeltaFactor]);
  const pitcherDecisions = useMemo(
    () => buildLineupPitcherDecisions(summary?.pitcher_starts || [], pitcherPlan),
    [pitcherPlan, summary?.pitcher_starts]
  );
  const pitcherDecisionCounts = useMemo(
    () =>
      pitcherDecisions.reduce(
        (counts, row) => {
          counts[row.decision] += 1;
          return counts;
        },
        { start: 0, decide: 0, sit: 0 }
      ),
    [pitcherDecisions]
  );
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
    const cachedPlan = loadPitcherPlan(pitcherPlanStorageKey);
    setPitcherPlan(cachedPlan);
    if (!pitcherPlanStorageKey || !selectedLeagueUid || !selectedTeamUid) return;
    let cancelled = false;
    fetchPitcherPlan(selectedLeagueUid, selectedTeamUid)
      .then((response) => {
        if (cancelled || !response.plan) return;
        const savedPlan = normalizePitcherPlan(response.plan);
        savePitcherPlanCache(pitcherPlanStorageKey, savedPlan);
        setPitcherPlan(savedPlan);
      })
      .catch((error) => {
        if (!cancelled) {
          setToast(`Pitcher plan database sync failed: ${errorMessage(error)} Using this browser's backup.`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pitcherPlanStorageKey, selectedLeagueUid, selectedTeamUid, setToast]);

  useEffect(() => {
    setRows([]);
    setSummary(null);
    setLineupOptimizer(null);
  }, [selectedDate, selectedLeagueUid, teamUid]);

  async function fetchDates() {
    setBusy("dates");
    try {
      const response = await fetchFunction<{ dates: LineupDateOption[] }>("lineup-dates", "days=10");
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
      const response = await fetchFunction<LineupRecommendationResponse>("lineup-recommendations", String(params));
      setSummary(response);
      setRows(response.rows);
      setLineupOptimizer(null);
      setToast(
        `Starter data loaded for ${response.rows.length} active hitters and ${(response.pitcher_starts || []).length} probable pitchers on your team.`
      );
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
      await fetchFunction<{ status: string }>("lineup-set-pref", "", "POST", {
        league_uid: selectedLeagueUid,
        team_uid: teamUid,
        player_key: row.player_key,
        player_name: row.player_name,
        kind: "start",
        value: alwaysStart
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
      await fetchFunction<{ status: string }>("lineup-set-pref", "", "POST", {
        league_uid: selectedLeagueUid,
        team_uid: teamUid,
        player_key: row.player_key,
        player_name: row.player_name,
        kind: "sit",
        value: alwaysSit
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
          <Metric label="SP Start" value={pitcherDecisionCounts.start.toLocaleString()} />
          <Metric label="SP Decide" value={pitcherDecisionCounts.decide.toLocaleString()} />
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

        {summary ? (
          <LineupPitcherStartSection
            decisions={pitcherDecisions}
            selectedDate={summary.date}
          />
        ) : null}

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
            <LineupUnavailableSection
              emptyText="No unavailable players on this roster."
              players={[...summary.il_players, ...(summary.suspended_players ?? [])]}
              title="Unavailable Players"
            />
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

function LineupPitcherStartSection({
  decisions,
  selectedDate
}: {
  decisions: LineupPitcherDecision[];
  selectedDate: string;
}) {
  return (
    <section className="lineup-pitcher-starts">
      <div className="lineup-pitcher-starts-heading">
        <div>
          <p className="eyebrow">My Probable Pitchers</p>
          <h3>SP decisions for {formatPlainDate(selectedDate)}</h3>
          <p>Selected rotation pitchers are Start, Bubble pitchers are Decide, and other probable starters are Sit. Opponent ranks use 1 for MLB's strongest offense.</p>
        </div>
        <strong>{decisions.length}</strong>
      </div>
      {decisions.length ? (
        <div className="table-wrap lineup-pitcher-starts-wrap">
          <table className="lineup-pitcher-starts-table">
            <thead>
              <tr>
                <th>Decision</th>
                <th className="player-col">Pitcher</th>
                <th>Plan</th>
                <th>MLB</th>
                <th>Opponent</th>
                <th title="Aggregate and component FanGraphs team batting ranks; 1 is the strongest offense.">Opp. offense</th>
                <th>Pos</th>
                <th>Salary</th>
                <th>Pts</th>
                <th>P/IP</th>
              </tr>
            </thead>
            <tbody>
              {decisions.map((row) => (
                <tr className={`pitcher-decision-row ${row.decision}`} key={row.player_key}>
                  <td>
                    <span className={`pitcher-decision-pill ${row.decision}`}>
                      {row.decision === "start" ? "Start" : row.decision === "decide" ? "Decide" : "Sit"}
                    </span>
                  </td>
                  <td className="player-col">
                    <strong>{row.player_name}</strong>
                    <RosterStatusBadge mlbTeam={row.mlb_team} status={row.status} />
                    {row.fangraphs_url ? (
                      <a
                        className="pitcher-log-link"
                        href={row.fangraphs_url}
                        rel="noreferrer"
                        target="_blank"
                        title="Open FanGraphs pitcher page"
                      >
                        <ExternalLink size={13} />
                      </a>
                    ) : null}
                  </td>
                  <td>{row.decision === "start" ? "Selected starter" : row.decision === "decide" ? "SP Bubble" : "Outside plan"}</td>
                  <td>{row.mlb_team || "-"}</td>
                  <td>{row.opponent_team || row.opponent_name || "-"}</td>
                  <td><OpponentOffenseRanks ranks={row.opponent_offense_ranks} /></td>
                  <td>{row.positions || "-"}</td>
                  <td>{formatMoney(row.salary)}</td>
                  <td>{formatDecimal(row.points)}</td>
                  <td>{formatDecimal(row.points_per_ip)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="lineup-pitcher-starts-empty">No pitchers on this fantasy roster are listed as probable starters for this date.</p>
      )}
    </section>
  );
}

function OpponentOffenseRanks({ ranks }: { ranks: LineupOpponentOffenseRanks | null | undefined }) {
  if (!ranks || ranks.aggregate_rank == null) {
    return <span title="FanGraphs opponent offense rankings are unavailable.">-</span>;
  }

  const teamCount = ranks.team_count || 30;
  const tone = ranks.aggregate_rank <= 10 ? "danger" : ranks.aggregate_rank >= 21 ? "favorable" : "neutral";
  const tooltip = [
    "1 = strongest MLB offense. Aggregate rank is based on the average of the four component ranks.",
    `Average component rank: ${formatDecimal(ranks.average_rank)}.`,
    `wRC ${formatDecimal(ranks.wrc)} (#${ranks.wrc_rank ?? "-"}), wRAA ${formatDecimal(ranks.wraa)} (#${ranks.wraa_rank ?? "-"}),`,
    `wOBA ${ranks.woba == null ? "-" : ranks.woba.toFixed(3)} (#${ranks.woba_rank ?? "-"}), wRC+ ${formatDecimal(ranks.wrc_plus)} (#${ranks.wrc_plus_rank ?? "-"}).`
  ].join(" ");

  return (
    <div className={`opponent-offense-ranks ${tone}`} title={tooltip}>
      <div className="opponent-offense-summary"><strong>#{ranks.aggregate_rank}</strong><span>of {teamCount}</span></div>
      <small>wRC #{ranks.wrc_rank ?? "-"} / wRAA #{ranks.wraa_rank ?? "-"}</small>
      <small>wOBA #{ranks.woba_rank ?? "-"} / wRC+ #{ranks.wrc_plus_rank ?? "-"}</small>
    </div>
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

function LeaguesWorkspace({
  busyLeague,
  busyTeam,
  cloudRefreshBusy,
  importLeague,
  leagueUrl,
  leagueRosterPlayers,
  leagueValueCurve,
  leagues,
  leaguesLoading,
  myTeamUid,
  myTeamSaving,
  myTeamUidsByLeague,
  removeLeague,
  requestCloudRefresh,
  refreshLeagueValueCurve,
  selectedLeague,
  selectedLeagueTeams,
  selectedLeagueUid,
  selectMyTeam,
  setLeagueUrl,
  setToast,
  setSelectedLeagueUid,
  teams,
  teamsLoading,
  updateTeam,
  updateSelectedLeague
}: {
  busyLeague: string | null;
  busyTeam: string | null;
  cloudRefreshBusy: boolean;
  importLeague: () => void;
  leagueUrl: string;
  leagueRosterPlayers: LeagueRosterPlayer[];
  leagueValueCurve: LeagueValueCurve | null;
  leagues: FantasyLeague[];
  leaguesLoading: boolean;
  myTeamUid: string;
  myTeamSaving: boolean;
  myTeamUidsByLeague: MyTeamUidsByLeague;
  removeLeague: (leagueUid: string, leagueName: string) => void;
  requestCloudRefresh: (scope: string) => Promise<void>;
  refreshLeagueValueCurve: (leagueUid: string) => Promise<void>;
  selectedLeague: FantasyLeague | null;
  selectedLeagueTeams: FantasyTeam[];
  selectedLeagueUid: string;
  selectMyTeam: (leagueUid: string, teamUid: string) => void;
  setLeagueUrl: (url: string) => void;
  setToast: (message: string) => void;
  setSelectedLeagueUid: (leagueUid: string) => void;
  teams: FantasyTeam[];
  teamsLoading: boolean;
  updateTeam: (teamUid: string) => void;
  updateSelectedLeague: () => void;
}) {
  const loadedTeamCount = selectedLeagueTeams.filter((team) => team.last_snapshot_id !== null).length;
  const selectedRosteredCount = selectedLeagueTeams.reduce((total, team) => total + (team.last_roster_count || 0), 0);
  const myTeam = selectedLeagueTeams.find((team) => team.team_uid === myTeamUid) || null;
  const [valueCurveOpen, setValueCurveOpen] = useState(false);
  const [valueCurveLoading, setValueCurveLoading] = useState(false);
  const [platformCurveOpen, setPlatformCurveOpen] = useState(false);
  const [platformCurveLoading, setPlatformCurveLoading] = useState(true);
  const [platformData, setPlatformData] = useState<PlatformValueCurveResponse | null>(null);
  const [platformSampleSize, setPlatformSampleSize] = useState("20");
  const selectedLeagueCurvePlayers = useMemo(
    () => leagueRosterPlayers.filter((player) => player.league_uid === selectedLeagueUid),
    [leagueRosterPlayers, selectedLeagueUid]
  );
  const curveRosterLoaded = selectedLeagueCurvePlayers.length > 0;

  useEffect(() => {
    setValueCurveOpen(false);
    setValueCurveLoading(false);
  }, [selectedLeagueUid]);

  useEffect(() => {
    void refreshPlatformData();
  }, []);

  async function loadValueCurve(force = false) {
    if (!selectedLeagueUid || (!force && curveRosterLoaded)) return;
    setValueCurveLoading(true);
    try {
      await refreshLeagueValueCurve(selectedLeagueUid);
    } catch (error) {
      setToast(errorMessage(error));
    } finally {
      setValueCurveLoading(false);
    }
  }

  function openValueCurve() {
    setValueCurveOpen(true);
    void loadValueCurve();
  }

  async function updateValueCurve() {
    if (!selectedLeagueUid) return;
    setValueCurveLoading(true);
    try {
      await requestCloudRefresh("leagues");
      await refreshLeagueValueCurve(selectedLeagueUid);
    } catch (error) {
      setToast(errorMessage(error));
    } finally {
      setValueCurveLoading(false);
    }
  }

  async function refreshPlatformData() {
    setPlatformCurveLoading(true);
    try {
      const data = await fetchPlatformValueCurve();
      setPlatformData(data);
      setPlatformSampleSize(String(data.setting.sample_size));
    } catch (error) {
      setToast(errorMessage(error));
    } finally {
      setPlatformCurveLoading(false);
    }
  }

  async function updatePlatformCurve() {
    const sampleSize = Number(platformSampleSize);
    if (!Number.isInteger(sampleSize) || sampleSize < 1 || sampleSize > 500) {
      setToast("Sample size must be a whole number between 1 and 500.");
      return;
    }
    setPlatformCurveLoading(true);
    try {
      const saved = await savePlatformValueCurveSettings(sampleSize);
      setPlatformData(saved);
      await requestCloudRefresh("platform");
      await refreshPlatformData();
    } catch (error) {
      setToast(errorMessage(error));
    } finally {
      setPlatformCurveLoading(false);
    }
  }

  return (
    <main className="leagues-shell">
      <section className="platform-landing">
        <div className="platform-identity">
          <div className="platform-mark" aria-hidden="true">O</div>
          <div>
            <p className="eyebrow">Fantasy platform</p>
            <h2>Ottoneu Fantasy Baseball</h2>
            <p>Connect a league once to load every roster, then choose which team belongs to you.</p>
          </div>
        </div>
        <div className="platform-status">
          <span className="status-pill success"><CheckCircle2 size={14} /> Active platform</span>
          <strong>{leagues.length.toLocaleString()} connected {leagues.length === 1 ? "league" : "leagues"}</strong>
          <button className="button platform-curve-button" onClick={() => setPlatformCurveOpen(true)} type="button">
            <TrendingUp size={16} />
            Platform Curve
          </button>
          <small>
            {platformData?.curve
              ? `${platformData.curve.successful_league_count} random leagues sampled ${formatDate(platformData.curve.generated_at)}.`
              : platformCurveLoading ? "Loading the platform benchmark..." : "Build the first Ottoneu-wide benchmark."}
          </small>
        </div>
      </section>

      <section className="leagues-layout">
        <aside className="league-directory">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Current leagues</p>
              <h2>Your Ottoneu leagues</h2>
            </div>
            <span className="league-count">{leagues.length}</span>
          </div>

          <form
            className="league-import-form"
            onSubmit={(event) => {
              event.preventDefault();
              importLeague();
            }}
          >
            <label htmlFor="league-url">Add an Ottoneu league</label>
            <p>Paste the league home URL. All teams are imported together.</p>
            <input
              id="league-url"
              value={leagueUrl}
              onChange={(event) => setLeagueUrl(event.target.value)}
              placeholder="https://ottoneu.fangraphs.com/1900/home"
            />
            <button className="button primary" type="submit" disabled={busyLeague !== null || !leagueUrl.trim()}>
              <Upload size={17} className={busyLeague === "import" ? "spin" : ""} />
              Add League
            </button>
          </form>

          <div className="league-directory-list">
            {leaguesLoading || teamsLoading ? (
              <div className="empty-card compact">Loading leagues...</div>
            ) : leagues.length ? (
              leagues.map((league) => {
                const leagueTeams = teams.filter((team) => team.league_id === league.league_id);
                const leagueMyTeamUid = myTeamUidForLeague(league.league_uid, leagueTeams, myTeamUidsByLeague);
                const leagueMyTeam = leagueTeams.find((team) => team.team_uid === leagueMyTeamUid) || null;
                return (
                  <article
                    className={"league-directory-card " + (selectedLeagueUid === league.league_uid ? "active" : "")}
                    key={league.league_uid}
                  >
                    <button className="league-select" onClick={() => setSelectedLeagueUid(league.league_uid)} type="button">
                      <span className="league-card-platform">Ottoneu</span>
                      <strong>{league.league_name}</strong>
                      <span>{league.team_count} teams &middot; {league.rostered_player_count} rostered players</span>
                      <span className={leagueMyTeam ? "league-my-team configured" : "league-my-team"}>
                        {leagueMyTeam ? "My team: " + leagueMyTeam.team_name : "Choose your team"}
                      </span>
                    </button>
                    <a className="icon-button link" href={league.url} target="_blank" rel="noreferrer" title="Open league">
                      <ExternalLink size={16} />
                    </a>
                  </article>
                );
              })
            ) : (
              <div className="empty-card compact">Add your first Ottoneu league to get started.</div>
            )}
          </div>
        </aside>

        <section className="league-detail-panel">
          {!selectedLeague ? (
            <div className="empty-state league-empty-state">
              <Users size={28} />
              <h2>No league selected</h2>
              <p>Add an Ottoneu league or choose one from the list.</p>
            </div>
          ) : (
            <>
              <div className="team-heading league-detail-heading">
                <div>
                  <p className="eyebrow">Ottoneu league</p>
                  <h2>{selectedLeague.league_name}</h2>
                </div>
                <div className="source-actions">
                  <button className="button ghost" onClick={openValueCurve} type="button">
                    <TrendingUp size={17} />
                    Value Curve
                  </button>
                  <button
                    className="button"
                    onClick={() => requestCloudRefresh("leagues")}
                    disabled={cloudRefreshBusy}
                    title="Ask your home worker to refresh every connected league."
                    type="button"
                  >
                    <RefreshCcw size={17} className={cloudRefreshBusy ? "spin" : ""} />
                    Request Update
                  </button>
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
                    title="Delete league"
                    type="button"
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </div>

              <div className="my-team-card">
                <div className="my-team-copy">
                  <div className={"my-team-icon " + (myTeam ? "configured" : "")}>
                    {myTeam ? <CheckCircle2 size={21} /> : <Users size={21} />}
                  </div>
                  <div>
                    <p className="eyebrow">My team in this league</p>
                    <h3>{myTeam?.team_name || "Choose your team"}</h3>
                    <p>This team becomes your default side in Trade, Pitchers, Optimal Lineup, and Lineup Helper.</p>
                  </div>
                </div>
                <label className="my-team-picker" htmlFor={"my-team-" + selectedLeague.league_uid}>
                  <span>Team</span>
                  <select
                    className="select-control"
                    id={"my-team-" + selectedLeague.league_uid}
                    value={myTeamUid}
                    onChange={(event) => selectMyTeam(selectedLeague.league_uid, event.target.value)}
                    disabled={myTeamSaving}
                  >
                    <option value="">Select your team...</option>
                    {selectedLeagueTeams.map((team) => (
                      <option key={team.team_uid} value={team.team_uid}>{team.team_name}</option>
                    ))}
                  </select>
                  <small>{myTeamSaving ? "Saving across devices..." : "Saved across devices for this league."}</small>
                </label>
              </div>

              <div className="board-summary team-summary">
                <Metric label="League teams" value={selectedLeague.team_count.toLocaleString()} />
                <Metric label="Loaded rosters" value={loadedTeamCount.toLocaleString()} />
                <Metric label="Rostered players" value={selectedRosteredCount.toLocaleString()} />
                <Metric label="My team" value={myTeam?.team_name || "Not selected"} />
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
                          isMyTeam={team.team_uid === myTeamUid}
                          key={team.team_uid}
                          team={team}
                          updateTeam={updateTeam}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state">No teams are loaded for this league yet.</div>
              )}
            </>
          )}
        </section>
      </section>

      {valueCurveOpen && selectedLeague ? (
        <LeagueValueCurveModal
          busy={valueCurveLoading || cloudRefreshBusy}
          curve={leagueValueCurve}
          league={selectedLeague}
          platformCurve={platformData?.curve || null}
          onClose={() => setValueCurveOpen(false)}
          onReload={() => loadValueCurve(true)}
          onUpdate={updateValueCurve}
          rosterPlayers={selectedLeagueCurvePlayers}
        />
      ) : null}
      {platformCurveOpen ? (
        <PlatformValueCurveModal
          busy={platformCurveLoading || cloudRefreshBusy}
          curve={platformData?.curve || null}
          onClose={() => setPlatformCurveOpen(false)}
          onReload={refreshPlatformData}
          onUpdate={updatePlatformCurve}
          sampleSize={platformSampleSize}
          setSampleSize={setPlatformSampleSize}
        />
      ) : null}
    </main>
  );
}

function TeamOverviewRow({
  busyTeam,
  isMyTeam,
  team,
  updateTeam
}: {
  busyTeam: string | null;
  isMyTeam: boolean;
  team: FantasyTeam;
  updateTeam: (teamUid: string) => void;
}) {
  return (
    <tr className={isMyTeam ? "my-team-row" : ""}>
      <td className="rank-col">{team.standings_rank || "-"}</td>
      <td className="player-col">
        <div className="league-team-name">
          <strong>{team.team_name}</strong>
          {isMyTeam ? <span className="my-team-pill"><CheckCircle2 size={13} /> My team</span> : null}
        </div>
      </td>
      <td>{team.owner || "-"}</td>
      <td>
        {team.last_roster_count !== null
          ? String(team.last_roster_count) + (team.last_roster_limit ? "/" + team.last_roster_limit : "")
          : "-"}
      </td>
      <td>{formatMoney(team.last_cap_used) + " / " + formatMoney(team.last_cap_limit)}</td>
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
        </div>
      </td>
    </tr>
  );
}
const VALUE_CURVE_CHART_WIDTH = 820;
const VALUE_CURVE_CHART_HEIGHT = 340;
const VALUE_CURVE_CHART_MARGIN = { top: 22, right: 22, bottom: 42, left: 58 };

function LeagueValueCurveModal({
  busy,
  curve,
  league,
  platformCurve,
  onClose,
  onReload,
  onUpdate,
  rosterPlayers
}: {
  busy: boolean;
  curve: LeagueValueCurve | null;
  league: FantasyLeague;
  platformCurve: PlatformValueCurve | null;
  onClose: () => void;
  onReload: () => void;
  onUpdate: () => void;
  rosterPlayers: LeagueRosterPlayer[];
}) {
  const rows = useMemo(
    () => buildLeagueValueCurveRows(rosterPlayers, curve, platformCurve),
    [curve, platformCurve, rosterPlayers]
  );
  const [selectedRank, setSelectedRank] = useState(1);
  const selectedRow = rows[Math.min(Math.max(selectedRank - 1, 0), Math.max(rows.length - 1, 0))] || null;
  const plotWidth = VALUE_CURVE_CHART_WIDTH - VALUE_CURVE_CHART_MARGIN.left - VALUE_CURVE_CHART_MARGIN.right;
  const plotHeight = VALUE_CURVE_CHART_HEIGHT - VALUE_CURVE_CHART_MARGIN.top - VALUE_CURVE_CHART_MARGIN.bottom;
  const maxChartValue = Math.max(
    1,
    ...rows.map((row) => Math.max(row.fittedValue, row.observedSalary, row.platformValue || 0))
  );
  const xForRank = (rank: number) =>
    VALUE_CURVE_CHART_MARGIN.left +
    ((rank - 1) / Math.max(1, rows.length - 1)) * plotWidth;
  const yForValue = (value: number) =>
    VALUE_CURVE_CHART_MARGIN.top +
    (1 - value / maxChartValue) * plotHeight;
  const fitPath = rows
    .map((row, index) =>
      (index ? "L" : "M") + xForRank(row.rank).toFixed(2) + "," + yForValue(row.fittedValue).toFixed(2)
    )
    .join(" ");
  const platformPath = rows
    .filter((row) => row.platformValue !== null)
    .map((row, index) =>
      (index ? "L" : "M") + xForRank(row.rank).toFixed(2) + "," + yForValue(row.platformValue || 0).toFixed(2)
    )
    .join(" ");
  const xTicks = uniqueNumbers([
    1,
    Math.max(1, Math.round(rows.length * 0.25)),
    Math.max(1, Math.round(rows.length * 0.5)),
    Math.max(1, Math.round(rows.length * 0.75)),
    Math.max(1, rows.length)
  ]);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => maxChartValue * ratio);

  useEffect(() => {
    setSelectedRank((current) => Math.min(Math.max(current, 1), Math.max(rows.length, 1)));
  }, [league.league_uid, rows.length]);

  function selectRankFromPointer(event: ReactPointerEvent<SVGSVGElement>) {
    if (!rows.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * VALUE_CURVE_CHART_WIDTH;
    const ratio = (svgX - VALUE_CURVE_CHART_MARGIN.left) / Math.max(plotWidth, 1);
    setSelectedRank(Math.min(rows.length, Math.max(1, Math.round(ratio * Math.max(rows.length - 1, 1)) + 1)));
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="league-value-curve-title">
      <div className="modal value-curve-modal">
        <div className="modal-heading value-curve-heading">
          <div>
            <p className="eyebrow">League valuation model</p>
            <h2 id="league-value-curve-title">{league.league_name} Value Curve</h2>
            <p>Compare this league's fitted salary market with the latest Ottoneu platform sample.</p>
          </div>
          <div className="value-curve-actions">
            <button className="button ghost" disabled={busy} onClick={onReload} type="button">
              <RefreshCcw size={17} className={busy ? "spin" : ""} />
              Reload Fit
            </button>
            <button className="button primary" disabled={busy} onClick={onUpdate} type="button">
              <TrendingUp size={17} />
              Update League &amp; Curve
            </button>
            <button className="icon-button" title="Close value curve" onClick={onClose} type="button">
              <X size={18} />
            </button>
          </div>
        </div>

        {busy && !rows.length ? (
          <div className="value-curve-loading">
            <RefreshCcw size={24} className="spin" />
            Loading the latest league fit...
          </div>
        ) : rows.length && curve ? (
          <div className="value-curve-content">
            <div className="value-curve-summary">
              <Metric label="Salary ranks" value={curve.player_count.toLocaleString()} />
              <Metric label="Fit error (RMSE)" value={formatFantasyValue(curve.rmse)} />
              <Metric label="Fit generated" value={formatDate(curve.generated_at)} />
              <Metric label="Rank 1 value" value={formatFantasyValue(rows[0]?.fittedValue)} />
              <Metric label="Final rank value" value={formatFantasyValue(rows[rows.length - 1]?.fittedValue)} />
            </div>

            <div className="value-curve-layout">
              <section className="value-curve-chart-panel">
                <div className="value-curve-chart-heading">
                  <div>
                    <p className="eyebrow">Interactive fit</p>
                    <h3>Salary rank to dollars</h3>
                  </div>
                  <div className="value-curve-legend" aria-label="Chart legend">
                    <span><i className="fit-line" /> League fit</span>
                    <span><i className="platform-line" /> Platform fit</span>
                    <span><i className="observed-dot" /> Roster salary</span>
                  </div>
                </div>

                <svg
                  className="value-curve-chart"
                  viewBox={"0 0 " + VALUE_CURVE_CHART_WIDTH + " " + VALUE_CURVE_CHART_HEIGHT}
                  aria-label="League and Ottoneu platform fitted dollar values with observed roster salary by salary rank"
                  onPointerDown={selectRankFromPointer}
                  onPointerMove={selectRankFromPointer}
                >
                  <rect
                    className="value-curve-hit-area"
                    x={VALUE_CURVE_CHART_MARGIN.left}
                    y={VALUE_CURVE_CHART_MARGIN.top}
                    width={plotWidth}
                    height={plotHeight}
                  />
                  {yTicks.map((tick) => (
                    <g key={"y-" + tick}>
                      <line
                        className="value-curve-grid"
                        x1={VALUE_CURVE_CHART_MARGIN.left}
                        x2={VALUE_CURVE_CHART_WIDTH - VALUE_CURVE_CHART_MARGIN.right}
                        y1={yForValue(tick)}
                        y2={yForValue(tick)}
                      />
                      <text
                        className="value-curve-axis-label"
                        x={VALUE_CURVE_CHART_MARGIN.left - 10}
                        y={yForValue(tick) + 4}
                        textAnchor="end"
                      >
                        {formatFantasyValue(tick)}
                      </text>
                    </g>
                  ))}
                  {xTicks.map((tick) => (
                    <g key={"x-" + tick}>
                      <line
                        className="value-curve-grid vertical"
                        x1={xForRank(tick)}
                        x2={xForRank(tick)}
                        y1={VALUE_CURVE_CHART_MARGIN.top}
                        y2={VALUE_CURVE_CHART_HEIGHT - VALUE_CURVE_CHART_MARGIN.bottom}
                      />
                      <text
                        className="value-curve-axis-label"
                        x={xForRank(tick)}
                        y={VALUE_CURVE_CHART_HEIGHT - 14}
                        textAnchor="middle"
                      >
                        {tick}
                      </text>
                    </g>
                  ))}
                  {rows.map((row) => (
                    <circle
                      className="value-curve-observed"
                      cx={xForRank(row.rank)}
                      cy={yForValue(row.observedSalary)}
                      key={"observed-" + row.rank}
                      r={row.rank === selectedRank ? 4 : 2}
                    />
                  ))}
                  {platformPath ? <path className="value-curve-platform-path" d={platformPath} /> : null}
                  <path className="value-curve-fit-path" d={fitPath} />
                  {selectedRow ? (
                    <>
                      <line
                        className="value-curve-selection-line"
                        x1={xForRank(selectedRow.rank)}
                        x2={xForRank(selectedRow.rank)}
                        y1={VALUE_CURVE_CHART_MARGIN.top}
                        y2={VALUE_CURVE_CHART_HEIGHT - VALUE_CURVE_CHART_MARGIN.bottom}
                      />
                      <circle
                        className="value-curve-selected-fit"
                        cx={xForRank(selectedRow.rank)}
                        cy={yForValue(selectedRow.fittedValue)}
                        r="5"
                      />
                    </>
                  ) : null}
                  <text
                    className="value-curve-axis-title"
                    x={VALUE_CURVE_CHART_WIDTH / 2}
                    y={VALUE_CURVE_CHART_HEIGHT - 1}
                    textAnchor="middle"
                  >
                    Salary rank
                  </text>
                </svg>

                <label className="value-curve-scrubber">
                  <span>Explore rank</span>
                  <input
                    type="range"
                    min="1"
                    max={rows.length}
                    value={selectedRank}
                    onChange={(event) => setSelectedRank(Number(event.target.value))}
                  />
                  <output>#{selectedRank}</output>
                </label>

                {selectedRow ? (
                  <div className="value-curve-selected-card">
                    <div><span>Rank</span><strong>#{selectedRow.rank}</strong></div>
                    <div><span>League value</span><strong>{formatFantasyValue(selectedRow.fittedValue)}</strong></div>
                    <div><span>Platform value</span><strong>{formatFantasyValue(selectedRow.platformValue)}</strong></div>
                    <div><span>League vs platform</span><strong>{formatValueDelta(selectedRow.platformDelta)}</strong></div>
                    <div><span>Roster salary</span><strong>{formatFantasyValue(selectedRow.observedSalary)}</strong></div>
                    <div><span>Fit vs roster</span><strong>{formatValueDelta(selectedRow.difference)}</strong></div>
                    <div className="selected-player"><span>Player at rank</span><strong>{selectedRow.playerName}</strong><small>{selectedRow.teamName}</small></div>
                  </div>
                ) : null}
              </section>

              <section className="value-curve-table-panel">
                <div className="value-curve-table-heading">
                  <div>
                    <p className="eyebrow">Rank table</p>
                    <h3>Rank to dollars</h3>
                  </div>
                  <span>{rows.length.toLocaleString()} rows</span>
                </div>
                <div className="value-curve-table-wrap">
                  <table className="value-curve-table">
                    <thead>
                      <tr>
                        <th>Rank</th>
                        <th>League $</th>
                        <th>Platform $</th>
                        <th>Delta</th>
                        <th>Roster $</th>
                        <th>Fit-Roster</th>
                        <th>Player</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr className={row.rank === selectedRank ? "selected" : ""} key={row.rank}>
                          <td>
                            <button className="curve-rank-button" onClick={() => setSelectedRank(row.rank)} type="button">
                              {row.rank}
                            </button>
                          </td>
                          <td><strong>{formatFantasyValue(row.fittedValue)}</strong></td>
                          <td>{formatFantasyValue(row.platformValue)}</td>
                          <td>{formatValueDelta(row.platformDelta)}</td>
                          <td>{formatFantasyValue(row.observedSalary)}</td>
                          <td>{formatValueDelta(row.difference)}</td>
                          <td title={row.teamName}>{row.playerName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </div>
        ) : (
          <div className="value-curve-empty">
            <TrendingUp size={26} />
            <h3>No fitted curve is available yet</h3>
            <p>A league needs at least eight loaded salary rows. Reload the fit or update the league data to try again.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function PlatformValueCurveModal({
  busy,
  curve,
  onClose,
  onReload,
  onUpdate,
  sampleSize,
  setSampleSize
}: {
  busy: boolean;
  curve: PlatformValueCurve | null;
  onClose: () => void;
  onReload: () => void;
  onUpdate: () => void;
  sampleSize: string;
  setSampleSize: (value: string) => void;
}) {
  const rows = useMemo(
    () => (curve?.points || []).map((point) => {
      const fittedValue = curve ? fittedFantasyValue(point.rank, curve) : point.salary;
      return {
        difference: fittedValue - point.salary,
        fittedValue,
        observedSalary: point.salary,
        rank: point.rank,
        sampleCount: point.sample_count
      };
    }),
    [curve]
  );
  const [selectedRank, setSelectedRank] = useState(1);
  const selectedRow = rows[Math.min(Math.max(selectedRank - 1, 0), Math.max(rows.length - 1, 0))] || null;
  const plotWidth = VALUE_CURVE_CHART_WIDTH - VALUE_CURVE_CHART_MARGIN.left - VALUE_CURVE_CHART_MARGIN.right;
  const plotHeight = VALUE_CURVE_CHART_HEIGHT - VALUE_CURVE_CHART_MARGIN.top - VALUE_CURVE_CHART_MARGIN.bottom;
  const maxChartValue = Math.max(1, ...rows.map((row) => Math.max(row.fittedValue, row.observedSalary)));
  const xForRank = (rank: number) =>
    VALUE_CURVE_CHART_MARGIN.left + ((rank - 1) / Math.max(1, rows.length - 1)) * plotWidth;
  const yForValue = (value: number) =>
    VALUE_CURVE_CHART_MARGIN.top + (1 - value / maxChartValue) * plotHeight;
  const fitPath = rows
    .map((row, index) =>
      (index ? "L" : "M") + xForRank(row.rank).toFixed(2) + "," + yForValue(row.fittedValue).toFixed(2)
    )
    .join(" ");
  const xTicks = uniqueNumbers([
    1,
    Math.max(1, Math.round(rows.length * 0.25)),
    Math.max(1, Math.round(rows.length * 0.5)),
    Math.max(1, Math.round(rows.length * 0.75)),
    Math.max(1, rows.length)
  ]);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => maxChartValue * ratio);

  useEffect(() => {
    setSelectedRank((current) => Math.min(Math.max(current, 1), Math.max(rows.length, 1)));
  }, [rows.length]);

  function selectRankFromPointer(event: ReactPointerEvent<SVGSVGElement>) {
    if (!rows.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * VALUE_CURVE_CHART_WIDTH;
    const ratio = (svgX - VALUE_CURVE_CHART_MARGIN.left) / Math.max(plotWidth, 1);
    setSelectedRank(Math.min(rows.length, Math.max(1, Math.round(ratio * Math.max(rows.length - 1, 1)) + 1)));
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="platform-value-curve-title">
      <div className="modal value-curve-modal platform-value-curve-modal">
        <div className="modal-heading value-curve-heading">
          <div>
            <p className="eyebrow">Ottoneu platform benchmark</p>
            <h2 id="platform-value-curve-title">Platform Value Curve</h2>
            <p>Each refresh draws a new random sample and averages salary at every rank before fitting the curve.</p>
          </div>
          <div className="value-curve-actions">
            <label className="platform-sample-control">
              <span>Random leagues (N)</span>
              <input
                aria-label="Random league sample size"
                disabled={busy}
                max="500"
                min="1"
                onChange={(event) => setSampleSize(event.target.value)}
                type="number"
                value={sampleSize}
              />
            </label>
            <button className="button ghost" disabled={busy} onClick={onReload} type="button">
              <RefreshCcw size={17} className={busy ? "spin" : ""} />
              Reload
            </button>
            <button className="button primary" disabled={busy} onClick={onUpdate} type="button">
              <TrendingUp size={17} />
              Resample &amp; Refresh
            </button>
            <button className="icon-button" title="Close platform value curve" onClick={onClose} type="button">
              <X size={18} />
            </button>
          </div>
        </div>

        {busy && !rows.length ? (
          <div className="value-curve-loading">
            <RefreshCcw size={24} className="spin" />
            Loading the Ottoneu platform benchmark...
          </div>
        ) : rows.length && curve ? (
          <div className="value-curve-content">
            <div className="value-curve-summary">
              <Metric label="Random leagues" value={curve.successful_league_count.toLocaleString()} />
              <Metric label="Salary observations" value={curve.observation_count.toLocaleString()} />
              <Metric label="Salary ranks" value={curve.rank_count.toLocaleString()} />
              <Metric label="Fit error (RMSE)" value={formatFantasyValue(curve.rmse)} />
              <Metric label="Generated" value={formatDate(curve.generated_at)} />
            </div>

            <div className="value-curve-layout">
              <section className="value-curve-chart-panel">
                <div className="value-curve-chart-heading">
                  <div>
                    <p className="eyebrow">Interactive platform fit</p>
                    <h3>Aggregate salary rank to dollars</h3>
                  </div>
                  <div className="value-curve-legend" aria-label="Chart legend">
                    <span><i className="platform-line" /> Platform fit</span>
                    <span><i className="observed-dot" /> Mean sampled salary</span>
                  </div>
                </div>

                <svg
                  className="value-curve-chart"
                  viewBox={"0 0 " + VALUE_CURVE_CHART_WIDTH + " " + VALUE_CURVE_CHART_HEIGHT}
                  aria-label="Ottoneu platform fitted dollar value and sampled mean salary by rank"
                  onPointerDown={selectRankFromPointer}
                  onPointerMove={selectRankFromPointer}
                >
                  <rect
                    className="value-curve-hit-area"
                    x={VALUE_CURVE_CHART_MARGIN.left}
                    y={VALUE_CURVE_CHART_MARGIN.top}
                    width={plotWidth}
                    height={plotHeight}
                  />
                  {yTicks.map((tick) => (
                    <g key={"platform-y-" + tick}>
                      <line
                        className="value-curve-grid"
                        x1={VALUE_CURVE_CHART_MARGIN.left}
                        x2={VALUE_CURVE_CHART_WIDTH - VALUE_CURVE_CHART_MARGIN.right}
                        y1={yForValue(tick)}
                        y2={yForValue(tick)}
                      />
                      <text
                        className="value-curve-axis-label"
                        x={VALUE_CURVE_CHART_MARGIN.left - 10}
                        y={yForValue(tick) + 4}
                        textAnchor="end"
                      >
                        {formatFantasyValue(tick)}
                      </text>
                    </g>
                  ))}
                  {xTicks.map((tick) => (
                    <g key={"platform-x-" + tick}>
                      <line
                        className="value-curve-grid vertical"
                        x1={xForRank(tick)}
                        x2={xForRank(tick)}
                        y1={VALUE_CURVE_CHART_MARGIN.top}
                        y2={VALUE_CURVE_CHART_HEIGHT - VALUE_CURVE_CHART_MARGIN.bottom}
                      />
                      <text
                        className="value-curve-axis-label"
                        x={xForRank(tick)}
                        y={VALUE_CURVE_CHART_HEIGHT - 14}
                        textAnchor="middle"
                      >
                        {tick}
                      </text>
                    </g>
                  ))}
                  {rows.map((row) => (
                    <circle
                      className="value-curve-observed"
                      cx={xForRank(row.rank)}
                      cy={yForValue(row.observedSalary)}
                      key={"platform-observed-" + row.rank}
                      r={row.rank === selectedRank ? 4 : 2}
                    />
                  ))}
                  <path className="value-curve-platform-path" d={fitPath} />
                  {selectedRow ? (
                    <>
                      <line
                        className="value-curve-selection-line"
                        x1={xForRank(selectedRow.rank)}
                        x2={xForRank(selectedRow.rank)}
                        y1={VALUE_CURVE_CHART_MARGIN.top}
                        y2={VALUE_CURVE_CHART_HEIGHT - VALUE_CURVE_CHART_MARGIN.bottom}
                      />
                      <circle
                        className="value-curve-selected-platform"
                        cx={xForRank(selectedRow.rank)}
                        cy={yForValue(selectedRow.fittedValue)}
                        r="5"
                      />
                    </>
                  ) : null}
                  <text
                    className="value-curve-axis-title"
                    x={VALUE_CURVE_CHART_WIDTH / 2}
                    y={VALUE_CURVE_CHART_HEIGHT - 1}
                    textAnchor="middle"
                  >
                    Salary rank
                  </text>
                </svg>

                <label className="value-curve-scrubber">
                  <span>Explore rank</span>
                  <input
                    type="range"
                    min="1"
                    max={rows.length}
                    value={selectedRank}
                    onChange={(event) => setSelectedRank(Number(event.target.value))}
                  />
                  <output>#{selectedRank}</output>
                </label>

                {selectedRow ? (
                  <div className="value-curve-selected-card platform-selected-card">
                    <div><span>Rank</span><strong>#{selectedRow.rank}</strong></div>
                    <div><span>Platform value</span><strong>{formatFantasyValue(selectedRow.fittedValue)}</strong></div>
                    <div><span>Mean salary</span><strong>{formatFantasyValue(selectedRow.observedSalary)}</strong></div>
                    <div><span>Fit vs mean</span><strong>{formatValueDelta(selectedRow.difference)}</strong></div>
                    <div><span>Leagues at rank</span><strong>{selectedRow.sampleCount}</strong></div>
                  </div>
                ) : null}

                <details className="platform-sample-list">
                  <summary>Latest random sample ({curve.sampled_leagues.length} leagues)</summary>
                  <div>
                    {curve.sampled_leagues.map((league) => (
                      <a href={league.url} key={league.league_id} target="_blank" rel="noreferrer">
                        <span>{league.league_name}</span>
                        <small>{league.game_type} &middot; {league.player_count} salaries</small>
                      </a>
                    ))}
                  </div>
                </details>
              </section>

              <section className="value-curve-table-panel">
                <div className="value-curve-table-heading">
                  <div>
                    <p className="eyebrow">Aggregate rank table</p>
                    <h3>Platform rank to dollars</h3>
                  </div>
                  <span>{rows.length.toLocaleString()} rows</span>
                </div>
                <div className="value-curve-table-wrap">
                  <table className="value-curve-table">
                    <thead>
                      <tr>
                        <th>Rank</th>
                        <th>Platform $</th>
                        <th>Mean salary</th>
                        <th>Diff</th>
                        <th title="Leagues contributing at this rank">N</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr className={row.rank === selectedRank ? "selected" : ""} key={row.rank}>
                          <td>
                            <button className="curve-rank-button" onClick={() => setSelectedRank(row.rank)} type="button">
                              {row.rank}
                            </button>
                          </td>
                          <td><strong>{formatFantasyValue(row.fittedValue)}</strong></td>
                          <td>{formatFantasyValue(row.observedSalary)}</td>
                          <td>{formatValueDelta(row.difference)}</td>
                          <td>{row.sampleCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </div>
        ) : (
          <div className="value-curve-empty">
            <TrendingUp size={26} />
            <h3>No platform curve is available yet</h3>
            <p>Choose a random league sample size and run the first platform refresh.</p>
            <button className="button primary" disabled={busy} onClick={onUpdate} type="button">
              Build Platform Curve
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function buildLeagueValueCurveRows(
  rosterPlayers: LeagueRosterPlayer[],
  curve: LeagueValueCurve | null,
  platformCurve: PlatformValueCurve | null
): LeagueValueCurveRow[] {
  if (!curve) return [];
  return [...rosterPlayers]
    .filter((player) => typeof player.salary === "number" && Number.isFinite(player.salary))
    .sort((left, right) =>
      right.salary - left.salary ||
      compareCurveText(left.team_name, right.team_name) ||
      compareCurveText(left.player_name, right.player_name) ||
      compareCurveText(left.player_key, right.player_key)
    )
    .map((player, index) => {
      const rank = index + 1;
      const fittedValue = fittedFantasyValue(rank, curve);
      const platformValue = platformCurve && rank <= platformCurve.rank_count
        ? fittedFantasyValue(rank, platformCurve)
        : null;
      return {
        difference: fittedValue - player.salary,
        fittedValue,
        platformDelta: platformValue === null ? null : fittedValue - platformValue,
        platformValue,
        observedSalary: player.salary,
        playerName: player.player_name,
        rank,
        teamName: player.team_name
      };
    });
}

function compareCurveText(left: string | null | undefined, right: string | null | undefined) {
  const leftValue = left || "";
  const rightValue = right || "";
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function uniqueNumbers(values: number[]) {
  return [...new Set(values)];
}
function RankingRow({
  fantasyRoster,
  availableStats,
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
  availableStats: LeagueAvailablePlayerStats | null;
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
  // IL/MiLB status applies to rostered players and, for available players, to their
  // most-recent league stats so the tags show for unrostered IL/MiLB players too.
  const statusInfo = fantasyRoster ?? availableStats;
  const rosterStatuses = statusInfo ? rosterAvailabilities(statusInfo.mlb_team, statusInfo.status) : [];

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
        {statusInfo && !showRosterStatus && <RosterStatusBadge mlbTeam={statusInfo.mlb_team} status={statusInfo.status} />}
      </td>
      {showRosterStatus && (
        <td className="status-col">
          {rosterStatuses.length ? <RosterStatusBadge mlbTeam={statusInfo?.mlb_team} status={statusInfo?.status} /> : <span className="missing-rank">-</span>}
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

function sortPitcherRows(rows: PitcherDisplayRow[], sort: TableSort) {
  return rows
    .map((row) => ({
      row,
      sortValue:
        sort.key === "role"
          ? row.usage.role
          : sort.key === "usage"
            ? row.usage.season_appearances
            : sort.key === "xfip"
              ? row.usage.xfip_minus
            : tradeSortValue(row, sort.key)
    }))
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

function defaultPitcherPlan(): PitcherPlan {
  return {
    bubbleSpKeys: [],
    bubbleTarget: DEFAULT_BUBBLE_TARGET,
    rpTarget: DEFAULT_RP_TARGET,
    selectedRpKeys: [],
    selectedSpKeys: [],
    spTarget: DEFAULT_SP_TARGET,
    usageOverrides: {}
  };
}

function isPitcherUsageOverride(value: unknown): value is PitcherUsageOverride {
  return (
    typeof value === "string" &&
    PITCHER_USAGE_OVERRIDE_OPTIONS.includes(value as PitcherUsageOverride)
  );
}

function pitcherUsageBucket(role: PitcherUsageOverride, fallback: "SP" | "RP"): "SP" | "RP" {
  if (role === "SP" || role === "Mixed - SP") return "SP";
  if (role === "RP" || role === "Mixed - RP") return "RP";
  return fallback;
}

function clampPitcherPlanTarget(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_PITCHER_PLAN_SLOTS, Math.max(0, Math.trunc(value)));
}

function normalizePitcherPlan(saved: Partial<PitcherPlan> | null | undefined): PitcherPlan {
  const fallback = defaultPitcherPlan();
  const spTarget = Number(saved?.spTarget);
  const bubbleTarget = Number(saved?.bubbleTarget);
  const rpTarget = Number(saved?.rpTarget);
  const normalizedSpTarget = Number.isFinite(spTarget) ? clampPitcherPlanTarget(spTarget) : fallback.spTarget;
  const normalizedBubbleTarget = Number.isFinite(bubbleTarget)
    ? Math.min(clampPitcherPlanTarget(bubbleTarget), normalizedSpTarget)
    : fallback.bubbleTarget;
  const selectedSpKeys = Array.isArray(saved?.selectedSpKeys)
    ? [...new Set(saved.selectedSpKeys.filter((value): value is string => typeof value === "string" && Boolean(value.trim())))]
    : [];
  const selectedSpKeySet = new Set(selectedSpKeys);
  const usageOverrides: Record<string, PitcherUsageOverride> = {};
  if (saved?.usageOverrides && typeof saved.usageOverrides === "object" && !Array.isArray(saved.usageOverrides)) {
    for (const [candidateKey, candidateRole] of Object.entries(saved.usageOverrides)) {
      const playerKey = candidateKey.trim();
      if (!playerKey || !isPitcherUsageOverride(candidateRole)) continue;
      usageOverrides[playerKey] = candidateRole;
      if (Object.keys(usageOverrides).length >= 100) break;
    }
  }
  return {
    spTarget: normalizedSpTarget,
    bubbleTarget: normalizedBubbleTarget,
    rpTarget: Number.isFinite(rpTarget) ? clampPitcherPlanTarget(rpTarget) : fallback.rpTarget,
    selectedSpKeys,
    bubbleSpKeys: Array.isArray(saved?.bubbleSpKeys)
      ? [
          ...new Set(
            saved.bubbleSpKeys.filter(
              (value): value is string => typeof value === "string" && Boolean(value.trim()) && !selectedSpKeySet.has(value)
            )
          )
        ]
      : [],
    selectedRpKeys: Array.isArray(saved?.selectedRpKeys)
      ? [...new Set(saved.selectedRpKeys.filter((value): value is string => typeof value === "string" && Boolean(value.trim())))]
      : [],
    usageOverrides
  };
}

function loadPitcherPlan(storageKey: string): PitcherPlan {
  if (!storageKey || typeof window === "undefined") return defaultPitcherPlan();
  try {
    return normalizePitcherPlan(JSON.parse(window.localStorage.getItem(storageKey) || "{}") as Partial<PitcherPlan>);
  } catch {
    return defaultPitcherPlan();
  }
}

function hasPitcherPlanCache(storageKey: string) {
  if (!storageKey || typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(storageKey) !== null;
  } catch {
    return false;
  }
}

function savePitcherPlanCache(storageKey: string, plan: PitcherPlan) {
  if (!storageKey || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(plan));
  } catch {
    // Keep the in-memory plan usable if browser storage is unavailable.
  }
}

function pitcherPlanSyncLabel(state: PitcherPlanSyncState) {
  switch (state) {
    case "loading":
      return "Loading shared plan...";
    case "saving":
      return "Saving...";
    case "saved":
      return "Saved to database";
    case "offline":
      return "Browser backup only";
    default:
      return "";
  }
}

function buildLineupPitcherDecisions(rows: LineupPitcherStartRow[], plan: PitcherPlan): LineupPitcherDecision[] {
  const selectedSpKeys = new Set(plan.selectedSpKeys);
  const bubbleSpKeys = new Set(plan.bubbleSpKeys);
  const order = { start: 0, decide: 1, sit: 2 };
  return rows
    .map((row) => ({
      ...row,
      decision: selectedSpKeys.has(row.player_key)
        ? "start" as const
        : bubbleSpKeys.has(row.player_key)
          ? "decide" as const
          : "sit" as const
    }))
    .sort((left, right) => order[left.decision] - order[right.decision] || SORT_COLLATOR.compare(left.player_name, right.player_name));
}

function formatPitcherUsage(usage: PitcherUsageRow) {
  if (usage.season_appearances === null || usage.season_starts === null) return "-";
  return `${usage.season_starts} GS / ${usage.season_appearances} G`;
}

function pitcherRoleClass(usage: PitcherUsageRow) {
  if (usage.role === "Usage unavailable" || usage.role === "No season usage") return "unavailable";
  if (usage.role.startsWith("Mixed")) return "mixed";
  return usage.bucket.toLowerCase();
}

function pitcherRoleTitle(usage: PitcherUsageRow) {
  if (usage.usage_source === "eligibility") return `Classified directly from ${usage.positions || "roster"} eligibility.`;
  if (usage.role.startsWith("Mixed")) return "Season usage includes starts and relief appearances; current role is based on the last five.";
  return "Classified from the current-season FanGraphs game log.";
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

// Supabase reads. The static (GitHub Pages) build reads rankings/rosters directly from
// Supabase; writes (scrape/import/edit) still go to the local /api backend. The publishable
// anon key is safe to expose and is protected by RLS.
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

function supabaseHeaders(): Record<string, string> {
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
}

async function fetchFunction<T>(name: string, query = "", method: string = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}${query ? `?${query}` : ""}`, {
    method,
    headers: body === undefined ? supabaseHeaders() : { ...supabaseHeaders(), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

async function fetchPlatformValueCurve() {
  try {
    return await fetchFunction<PlatformValueCurveResponse>("platform-value-curve");
  } catch (error) {
    if (!["localhost", "127.0.0.1"].includes(window.location.hostname)) throw error;
    return fetchJson<PlatformValueCurveResponse>("/api/platforms/ottoneu/value-curve");
  }
}

async function savePlatformValueCurveSettings(sampleSize: number) {
  try {
    return await fetchFunction<PlatformValueCurveResponse>(
      "platform-value-curve",
      "",
      "POST",
      { sample_size: sampleSize }
    );
  } catch (error) {
    if (!["localhost", "127.0.0.1"].includes(window.location.hostname)) throw error;
    return postJson<PlatformValueCurveResponse>(
      "/api/platforms/ottoneu/value-curve/settings",
      { sample_size: sampleSize }
    );
  }
}
async function saveLeagueMyTeamPreference(leagueUid: string, teamUid: string) {
  const body = { league_uid: leagueUid, team_uid: teamUid || null };
  try {
    return await fetchFunction<{ status: "success"; league_uid: string; team_uid: string | null }>(
      "league-preference",
      "",
      "POST",
      body
    );
  } catch (error) {
    if (!["localhost", "127.0.0.1"].includes(window.location.hostname)) throw error;
    return postJson<{ status: "success"; league_uid: string; team_uid: string | null }>(
      `/api/leagues/${encodeURIComponent(leagueUid)}/my-team`,
      { team_uid: teamUid || null }
    );
  }
}

async function fetchPitcherUsage(leagueUid: string, teamUid: string, season: number) {
  const params = new URLSearchParams({
    league_uid: leagueUid,
    team_uid: teamUid,
    season: String(season)
  });
  try {
    return await fetchFunction<PitcherUsageResponse>("pitcher-usage", String(params));
  } catch (error) {
    if (!["localhost", "127.0.0.1"].includes(window.location.hostname)) throw error;
    return fetchJson<PitcherUsageResponse>(`/api/pitchers/usage?${params}`);
  }
}

async function fetchPitcherPlan(leagueUid: string, teamUid: string): Promise<PitcherPlanResponse> {
  const params = new URLSearchParams({ league_uid: leagueUid, team_uid: teamUid });
  try {
    return await fetchFunction<PitcherPlanResponse>("pitcher-plan", String(params));
  } catch (error) {
    if (!["localhost", "127.0.0.1"].includes(window.location.hostname)) throw error;
    return fetchJson<PitcherPlanResponse>(`/api/pitcher-plan?${params}`);
  }
}

async function savePitcherPlanToDatabase(
  leagueUid: string,
  teamUid: string,
  plan: PitcherPlan
): Promise<PitcherPlanResponse> {
  const body = { league_uid: leagueUid, team_uid: teamUid, plan };
  try {
    return await fetchFunction<PitcherPlanResponse>("pitcher-plan", "", "POST", body);
  } catch (error) {
    if (!["localhost", "127.0.0.1"].includes(window.location.hostname)) throw error;
    return postJson<PitcherPlanResponse>("/api/pitcher-plan", body);
  }
}

async function fetchOptimalLineup(leagueUid: string, teamUid: string, season: number) {
  const params = new URLSearchParams({
    league_uid: leagueUid,
    team_uid: teamUid,
    season: String(season)
  });
  try {
    return await fetchFunction<OptimalLineupResponse>("optimal-lineup", String(params));
  } catch (error) {
    if (!["localhost", "127.0.0.1"].includes(window.location.hostname)) throw error;
    return fetchJson<OptimalLineupResponse>(`/api/optimal-lineup?${params}`);
  }
}

async function fetchRest<T>(pathAndQuery: string): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, { headers: supabaseHeaders() });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text);
  }
  return response.json() as Promise<T>;
}

async function deleteJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { method: "DELETE" });
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

function toolFromHash(hash: string): ActiveTool {
  const path = hash.replace(/^#\/?/, "").split("?", 1)[0].replace(/\/+$/, "");
  return Object.prototype.hasOwnProperty.call(TOOL_HASH_PATHS, path) ? (path as ActiveTool) : "home";
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

function fittedFantasyValue(rank: number, curve: Pick<LeagueValueCurve, "parameters">) {
  const { c, A, m, s, g, D, k } = curve.parameters;
  return c + (A - c) / Math.pow(1 + Math.pow(rank / m, s), g) + D * Math.exp(-k * (rank - 1));
}

function buildScoringValueMap(
  rosterPlayers: LeagueRosterPlayer[],
  availablePlayers: LeagueAvailablePlayerStats[],
  curve: LeagueValueCurve | null
) {
  const values = new Map<string, ScoringValueMetric>();
  if (!curve) return values;

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
    .filter((player) => !isMinorLeaguePlayer(player))
    .filter((player) => typeof player.points === "number" && Number.isFinite(player.points));

  scoringRows
    .sort((left, right) => {
      return (right.points || 0) - (left.points || 0) || left.player_name.localeCompare(right.player_name) || left.player_key.localeCompare(right.player_key);
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

function formatWholeNumber(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return Math.round(value).toLocaleString();
}

function formatWrcPlus(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatPpgDrop(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  if (Math.abs(value) < 0.005) return "Even";
  return value > 0 ? `-${formatDecimal(value)}` : `+${formatDecimal(Math.abs(value))}`;
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

function optimizeBestCaseLineup(rows: OptimalLineupHitter[]): LineupOptimizerResult {
  type FlowEdge = {
    capacity: number;
    cost: number;
    reverseIndex: number;
    slotIndex?: number;
    to: number;
  };
  const source = 0;
  const playerOffset = 1;
  const slotOffset = playerOffset + rows.length;
  const sink = slotOffset + LINEUP_SLOTS.length;
  const graph: FlowEdge[][] = Array.from({ length: sink + 1 }, () => []);

  function addEdge(from: number, to: number, capacity: number, cost: number, slotIndex?: number) {
    const forward: FlowEdge = { capacity, cost, reverseIndex: graph[to].length, slotIndex, to };
    const reverse: FlowEdge = { capacity: 0, cost: -cost, reverseIndex: graph[from].length, to: from };
    graph[from].push(forward);
    graph[to].push(reverse);
  }

  rows.forEach((row, playerIndex) => {
    addEdge(source, playerOffset + playerIndex, 1, 0);
    const ppg = finiteNumber(row.points_per_game) ?? 0;
    const tieBreak = (finiteNumber(row.points) ?? 0) / 1_000_000 + (finiteNumber(row.wrc_plus) ?? 0) / 1_000_000_000;
    LINEUP_SLOTS.forEach((slot, slotIndex) => {
      if (lineupSlotEligible(row, slot)) {
        addEdge(playerOffset + playerIndex, slotOffset + slotIndex, 1, -(ppg + tieBreak), slotIndex);
      }
    });
  });
  LINEUP_SLOTS.forEach((_, slotIndex) => addEdge(slotOffset + slotIndex, sink, 1, 0));

  for (let flow = 0; flow < LINEUP_SLOTS.length; flow += 1) {
    const distances = Array<number>(graph.length).fill(Infinity);
    const previousNode = Array<number>(graph.length).fill(-1);
    const previousEdge = Array<number>(graph.length).fill(-1);
    distances[source] = 0;
    for (let pass = 0; pass < graph.length - 1; pass += 1) {
      let changed = false;
      for (let node = 0; node < graph.length; node += 1) {
        if (!Number.isFinite(distances[node])) continue;
        graph[node].forEach((edge, edgeIndex) => {
          if (edge.capacity <= 0) return;
          const nextDistance = distances[node] + edge.cost;
          if (nextDistance + 0.000000001 < distances[edge.to]) {
            distances[edge.to] = nextDistance;
            previousNode[edge.to] = node;
            previousEdge[edge.to] = edgeIndex;
            changed = true;
          }
        });
      }
      if (!changed) break;
    }
    if (previousNode[sink] < 0) break;
    for (let node = sink; node !== source; node = previousNode[node]) {
      const edge = graph[previousNode[node]][previousEdge[node]];
      edge.capacity -= 1;
      graph[node][edge.reverseIndex].capacity += 1;
    }
  }

  const assignments = new Map<string, LineupAssignment>();
  const assignedRows: OptimalLineupDisplayRow[] = [];
  rows.forEach((row, playerIndex) => {
    const usedEdge = graph[playerOffset + playerIndex].find(
      (edge) => edge.slotIndex !== undefined && edge.capacity === 0
    );
    if (usedEdge?.slotIndex === undefined) return;
    assignments.set(row.player_key, {
      label: LINEUP_SLOTS[usedEdge.slotIndex].label,
      slotIndex: usedEdge.slotIndex
    });
    assignedRows.push({
      assignment: {
        label: LINEUP_SLOTS[usedEdge.slotIndex].label,
        slotIndex: usedEdge.slotIndex
      },
      row,
      score: hitterQualityScore(row)
    });
  });
  const totalPoints = bestCaseLineupRate(assignedRows);

  return {
    assignments,
    lockedCount: 0,
    starterCount: assignments.size,
    totalPoints,
    warning:
      assignments.size < LINEUP_SLOTS.length
        ? `${LINEUP_SLOTS.length - assignments.size} lineup ${LINEUP_SLOTS.length - assignments.size === 1 ? "slot is" : "slots are"} unfilled because no eligible MLB hitter is available.`
        : ""
  };
}

function buildOptimalLineupDisplayRows(
  rows: OptimalLineupHitter[],
  optimizer: LineupOptimizerResult
): OptimalLineupDisplayRow[] {
  return rows
    .map((row) => ({
      assignment: optimizer.assignments.get(row.player_key) || null,
      row,
      score: hitterQualityScore(row)
    }))
    .sort((left, right) => {
      if (left.assignment && right.assignment) {
        return left.assignment.slotIndex - right.assignment.slotIndex || left.row.player_name.localeCompare(right.row.player_name);
      }
      if (left.assignment) return -1;
      if (right.assignment) return 1;
      return (
        (right.score ?? -Infinity) - (left.score ?? -Infinity) ||
        (right.row.points_per_game ?? -Infinity) - (left.row.points_per_game ?? -Infinity) ||
        left.row.player_name.localeCompare(right.row.player_name)
      );
    });
}

function buildPositionStrengthRows(
  starters: OptimalLineupDisplayRow[],
  bench: OptimalLineupDisplayRow[]
): PositionStrengthRow[] {
  return POSITION_STRENGTH_GROUPS.map((group) => {
    const positionStarters = starters.filter((entry) => entry.assignment?.label === group.label);
    const catcherTandem = group.token === "C"
      ? [...positionStarters].sort(compareOptimalHitterQuality)
      : [];
    const backupCandidates = bench
      .filter((entry) => expandedPositionTokens(entry.row.positions).has(group.token))
      .sort(compareOptimalHitterQuality);
    const backupEntry = group.token === "C" ? catcherTandem[1] || null : backupCandidates[0] || null;
    const starterPpg = group.token === "C"
      ? catcherTandemMetric(positionStarters, (entry) => entry.row.points_per_game)
      : averageMetric(positionStarters.map((entry) => entry.row.points_per_game));
    const starterWrcPlus = group.token === "C"
      ? catcherTandemMetric(positionStarters, (entry) => entry.row.wrc_plus)
      : averageMetric(positionStarters.map((entry) => entry.row.wrc_plus));
    const starterScore = group.token === "C"
      ? hitterQualityScore({ points_per_game: starterPpg, wrc_plus: starterWrcPlus })
      : averageMetric(positionStarters.map((entry) => entry.score));
    const starterPpgValues = positionStarters
      .map((entry) => finiteNumber(entry.row.points_per_game))
      .filter((value): value is number => value !== null);
    const weakestStarterPpg = group.token === "C"
      ? finiteNumber(catcherTandem[0]?.row.points_per_game)
      : starterPpgValues.length ? Math.min(...starterPpgValues) : null;
    const backupPpg = finiteNumber(backupEntry?.row.points_per_game);
    const backupDropoff =
      weakestStarterPpg !== null && backupPpg !== null ? weakestStarterPpg - backupPpg : null;
    const backupScore = backupEntry?.score ?? null;
    const depthScore =
      backupScore === null ? null : clampNumber(backupScore - Math.max(backupDropoff ?? 0, 0) * 12, 0, 100);
    const orderedStarters = group.token === "C"
      ? catcherTandem
      : [...positionStarters].sort(compareOptimalHitterQuality);
    const depthBaselinePpg = group.token === "C"
      ? finiteNumber(catcherTandem[catcherTandem.length - 1]?.row.points_per_game)
      : weakestStarterPpg;
    const playerRows: PositionMapPlayerRow[] = [
      ...orderedStarters.map((entry, index): PositionMapPlayerRow => ({
        dropoff: null,
        entry,
        role: group.token === "C" && index === 1 ? "Tandem" : "Starter"
      })),
      ...backupCandidates.slice(0, 3).map((entry, index): PositionMapPlayerRow => {
        const entryPpg = finiteNumber(entry.row.points_per_game);
        return {
          dropoff: depthBaselinePpg !== null && entryPpg !== null ? depthBaselinePpg - entryPpg : null,
          entry,
          role: `Depth ${index + 1}` as `Depth ${1 | 2 | 3}`
        };
      })
    ];
    return {
      position: group.label,
      players: playerRows,
      starterScore,
      starterTier:
        group.token === "C" && positionStarters.length < 2
          ? "weak"
          : positionStarters.length ? strengthTier(starterScore) : "weak",
      depthScore,
      depthTier: depthTier(backupEntry?.row || null, depthScore)
    };
  });
}

function compareOptimalHitterQuality(left: OptimalLineupDisplayRow, right: OptimalLineupDisplayRow) {
  return (
    (right.row.points_per_game ?? -Infinity) - (left.row.points_per_game ?? -Infinity) ||
    (right.score ?? -Infinity) - (left.score ?? -Infinity) ||
    left.row.player_name.localeCompare(right.row.player_name)
  );
}

function catcherTandemMetric(
  catchers: OptimalLineupDisplayRow[],
  getter: (entry: OptimalLineupDisplayRow) => number | null | undefined
) {
  const weighted = catchers
    .map((entry) => ({
      games: finiteNumber(entry.row.games),
      value: finiteNumber(getter(entry))
    }))
    .filter((entry): entry is { games: number; value: number } => entry.games !== null && entry.value !== null);
  const totalGames = sumMetric(weighted.map((entry) => entry.games));
  if (totalGames > 0) {
    return weighted.reduce((total, entry) => total + entry.value * entry.games, 0) / totalGames;
  }
  return averageMetric(catchers.map(getter));
}

function catcherTandemSeasonPoints(
  catchers: OptimalLineupDisplayRow[],
  referenceGames: number | null
) {
  const combinedPoints = sumMetric(catchers.map((entry) => entry.row.points));
  const combinedGames = sumMetric(catchers.map((entry) => entry.row.games));
  if (combinedGames <= 0 || referenceGames === null || combinedGames <= referenceGames) return combinedPoints;
  return combinedPoints * (referenceGames / combinedGames);
}

function bestCaseLineupRate(starters: OptimalLineupDisplayRow[]) {
  const catcherRows = starters.filter((entry) => entry.assignment?.label === "C");
  const nonCatcherTotal = sumMetric(
    starters
      .filter((entry) => entry.assignment?.label !== "C")
      .map((entry) => entry.row.points_per_game)
  );
  return nonCatcherTotal + (catcherTandemMetric(catcherRows, (entry) => entry.row.points_per_game) ?? 0);
}

function bestCaseLineupSeasonPoints(starters: OptimalLineupDisplayRow[]) {
  const catcherRows = starters.filter((entry) => entry.assignment?.label === "C");
  const nonCatcherRows = starters.filter((entry) => entry.assignment?.label !== "C");
  const referenceGames = maximumMetric(nonCatcherRows.map((entry) => entry.row.games));
  return (
    sumMetric(nonCatcherRows.map((entry) => entry.row.points)) +
    catcherTandemSeasonPoints(catcherRows, referenceGames)
  );
}

function bestCaseLineupAverageMetric(
  starters: OptimalLineupDisplayRow[],
  getter: (entry: OptimalLineupDisplayRow) => number | null | undefined
) {
  const catcherRows = starters.filter((entry) => entry.assignment?.label === "C");
  const positionValues = starters
    .filter((entry) => entry.assignment?.label !== "C")
    .map(getter);
  positionValues.push(catcherTandemMetric(catcherRows, getter));
  return averageMetric(positionValues);
}

function hitterQualityScore(row: Pick<OptimalLineupHitter, "points_per_game" | "wrc_plus">): number | null {
  const scores: number[] = [];
  const ppg = finiteNumber(row.points_per_game);
  const wrcPlus = finiteNumber(row.wrc_plus);
  if (ppg !== null) scores.push(clampNumber(50 + (ppg - 4.5) * 20, 0, 100));
  if (wrcPlus !== null) scores.push(clampNumber(50 + (wrcPlus - 100) * 0.7, 0, 100));
  return averageMetric(scores);
}

function strengthTier(score: number | null | undefined): StrengthTier {
  if (typeof score !== "number" || !Number.isFinite(score)) return "weak";
  if (score >= 65) return "strong";
  if (score < 40) return "weak";
  return "solid";
}

function strengthTierLabel(tier: StrengthTier) {
  return tier === "strong" ? "Strong" : tier === "weak" ? "Weak" : "Solid";
}

function depthTier(
  backup: OptimalLineupHitter | null,
  depthScore: number | null
): DepthTier {
  if (!backup) return "thin";
  if ((depthScore ?? -Infinity) >= 52) return "strong";
  if ((depthScore ?? -Infinity) >= 38) return "covered";
  return "thin";
}

function depthTierLabel(tier: DepthTier) {
  return tier === "strong" ? "Strong" : tier === "covered" ? "Covered" : "Thin";
}

function depthTone(tier: DepthTier): StrengthTier {
  return tier === "strong" ? "strong" : tier === "covered" ? "solid" : "weak";
}

function bestPositionBy(
  rows: PositionStrengthRow[],
  getter: (row: PositionStrengthRow) => number | null,
  direction: "min" | "max"
) {
  return rows.reduce<PositionStrengthRow | null>((best, row) => {
    const value = getter(row);
    if (!best) return row;
    const bestValue = getter(best);
    if (direction === "max") {
      if (value === null) return best;
      if (bestValue === null || value > bestValue) return row;
      return best;
    }
    const comparableValue = value ?? -Infinity;
    const comparableBest = bestValue ?? -Infinity;
    return comparableValue < comparableBest ? row : best;
  }, null);
}

function averageMetric(values: (number | null | undefined)[]) {
  const finiteValues = values
    .map((value) => finiteNumber(value))
    .filter((value): value is number => value !== null);
  return finiteValues.length ? finiteValues.reduce((total, value) => total + value, 0) / finiteValues.length : null;
}

function maximumMetric(values: (number | null | undefined)[]) {
  const finiteValues = values
    .map((value) => finiteNumber(value))
    .filter((value): value is number => value !== null);
  return finiteValues.length ? Math.max(...finiteValues) : null;
}

function sumMetric(values: (number | null | undefined)[]) {
  return values.reduce<number>((total, value) => total + (finiteNumber(value) ?? 0), 0);
}

function finiteNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampNumber(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
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

function lineupSlotEligible(row: Pick<LineupRecommendationRow, "positions">, slot: LineupSlot) {
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
): { code: "il" | "minors" | "susp"; label: string; title: string }[] {
  const cleanStatus = (status || "").trim();
  const availabilities: { code: "il" | "minors" | "susp"; label: string; title: string }[] = [];
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

  if (cleanStatus.toUpperCase().includes("SUSP")) {
    availabilities.push({
      code: "susp",
      label: "Susp",
      title: cleanStatus ? `Roster status: ${cleanStatus}` : "Suspended"
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
