import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type UIEvent } from "react";
import {
  Activity,
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  Home,
  Info,
  ArrowLeftRight,
  RefreshCcw,
  Search,
  ShoppingCart,
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
  LineupRecommendationGame,
  LineupRecommendationResponse,
  LineupRecommendationRow,
  LeagueMarketEntry,
  LineupUnavailablePlayer,
  OptimalLineupHitter,
  OptimalLineupResponse,
  PitcherUsageResponse,
  PitcherUsageRole,
  PitcherUsageRow,
  PlatformValueCurve,
  PlatformValueCurveResponse,
  PlayerNameCorrection,
  PlayerNameCorrectionResponse,
  RankingSource,
  SourceSettingsResponse,
  SourceTag,
  TeamUpdateResult,
  UpdateResult
} from "./types";
import { aggregatePlayersToCsv, downloadCsv } from "./exportCsv";
import { buildSourceQualityMetrics, SOURCE_QUALITY_TOP_RANK, type SourceQualityMetric } from "./sourceQuality";
import {
  analyzeTrade,
  buildTradeTotal,
  summarizeTradeSourceVerdict,
  tradePlayerValueRange,
  type TradeAvailabilityCode,
  type TradeMetricTotal,
  type TradePlayerRow,
  type TradeResult,
  type TradeRosterImpact,
  type TradeSourceNet,
  type TradeSourceNetRange,
  type TradeSourceValue,
  type TradeTotal
} from "./tradeAnalysis";
import {
  LINEUP_SLOTS,
  averageMetric,
  bestCaseLineupAverageMetric,
  bestCaseLineupSeasonPoints,
  bestPositionBy,
  buildOptimalLineupDisplayRows,
  buildPositionStrengthRows,
  depthTierLabel,
  depthTone,
  expandedPositionTokens,
  optimizeBestCaseLineup,
  strengthTier,
  strengthTierLabel,
  type LineupAssignment,
  type LineupOptimizerResult,
  type OptimalLineupDisplayRow,
  type PositionStrengthRow,
  type StrengthTier
} from "./optimalLineup";
import {
  effectivePitcherUsage,
  type HitterImpactMovement,
  type HitterPositionDelta,
  type HitterTradeImpact,
  type PitcherBucketSummary,
  type PitcherImpactBucket,
  type PitcherImpactMovement,
  type PitcherImpactPlayer,
  type PitcherTradeImpact
} from "./tradeImpact";
import type {
  TradeImpactDataDependencies,
  TradeImpactProposal,
  TradeImpactWarning
} from "./tradeImpactData";
import { useTradeImpactAnalysis } from "./useTradeImpactAnalysis";
import {
  estimatedLineupPoints,
  formatLineupCacheAge,
  lineupCacheAgeHours,
  lineupGames,
  lineupXfipConfidenceLabel,
  lineupXfipProvenanceLabel,
  matchupAssessmentForLineupRow,
  optimizeLineup,
  type DailyLineupOptimizerResult
} from "./dailyLineup";
import {
  buildLineupDatesQuery,
  localIsoDate,
  preferredLineupDate,
  refreshLineupProbables
} from "./lineupRefresh";

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
const MINOR_LEVEL_TOKENS = new Set(["A", "A+", "AA", "AAA", "CPX", "ROK"]);
// Must match the pinned row height in .grouped-rankings-table; the virtual window sizes its
// spacers from this, so a mismatch makes rows drift as you scroll.
const RANKING_ROW_HEIGHT = 56;
const RANKING_OVERSCAN_ROWS = 12;
const TRADE_ROW_HEIGHT = 56;
const TRADE_OVERSCAN_ROWS = 10;
const SORT_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

type ActiveTool = "home" | "rankings" | "sources" | "leagues" | "trade" | "lineup" | "optimal-lineup" | "pitchers" | "pickups";
type TradeTableMode = "core" | "full";
const TOOL_HASH_PATHS = {
  home: "#/home",
  rankings: "#/rankings",
  sources: "#/sources",
  leagues: "#/leagues",
  trade: "#/trade",
  lineup: "#/lineup",
  "optimal-lineup": "#/optimal-lineup",
  pitchers: "#/pitchers",
  pickups: "#/pickups"
} satisfies Record<ActiveTool, string>;
// Notifications. Errors are the reason this has variants: a failed scrape used to render
// identically to a saved preference, and the next success would quietly replace it.
type ToastVariant = "success" | "error" | "info";
type ToastMessage = { id: number; message: string; variant: ToastVariant };
type ToastFn = (message: string, variant?: ToastVariant) => void;
const TOAST_DISMISS_MS = 5000;
const MAX_VISIBLE_TOASTS = 3;
const LINEUP_SCHEDULE_STALE_HOURS = 24;

// Tools that render the two-column <main className="workspace"> layout. These own the
// viewport below the topbar and scroll inside their own columns; every other tool is a
// normal document-flow page that scrolls as a whole.
const WORKSPACE_TOOLS = new Set<ActiveTool>(["rankings", "sources", "lineup", "optimal-lineup"]);
type MyTeamUidsByLeague = Record<string, string>;
type PositionFilter = (typeof POSITION_FILTERS)[number];
type RosterTagFilter = (typeof ROSTER_TAG_FILTERS)[number];
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
  matchup: ReturnType<typeof matchupAssessmentForLineupRow>;
  row: LineupRecommendationRow;
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
const TRADE_IMPACT_DATA_DEPENDENCIES: TradeImpactDataDependencies = {
  fetchOptimalLineup,
  fetchPitcherPlan: async (leagueUid, teamUid) => {
    const response = await fetchPitcherPlan(leagueUid, teamUid);
    return normalizePitcherPlan(response.plan);
  },
  fetchPitcherUsage,
  optimalLineupCache: OPTIMAL_LINEUP_CACHE,
  pitcherUsageCache: PITCHER_USAGE_CACHE
};

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
  const initialRankingsView = useRef(rankingsViewFromHash(window.location.hash)).current;
  const [sources, setSources] = useState<RankingSource[]>([]);
  const [board, setBoard] = useState<AggregateBoard>(emptyBoard);
  const [sourceQualityBoard, setSourceQualityBoard] = useState<AggregateBoard>(emptyBoard);
  const [query, setQuery] = useState(initialRankingsView.query ?? "");
  const [tdgFormat, setTdgFormat] = useState<"obp" | "points">(initialRankingsView.tdgFormat ?? "points");
  const [fantraxFormat, setFantraxFormat] = useState<"roto" | "points">(initialRankingsView.fantraxFormat ?? "points");
  const [includedSourceTags, setIncludedSourceTags] = useState<SourceTag[]>(
    initialRankingsView.includedSourceTags ?? DEFAULT_INCLUDED_SOURCE_TAGS
  );
  const [minAge, setMinAge] = useState(initialRankingsView.minAge ?? "");
  const [maxAge, setMaxAge] = useState(initialRankingsView.maxAge ?? "");
  const [positionFilter, setPositionFilter] = useState<PositionFilter>(initialRankingsView.positionFilter ?? "all");
  const [rosterTagFilter, setRosterTagFilter] = useState<RosterTagFilter>(initialRankingsView.rosterTagFilter ?? "all");
  const [minSources, setMinSources] = useState(initialRankingsView.minSources ?? 1);
  const [rankingSort, setRankingSort] = useState<TableSort>(initialRankingsView.rankingSort ?? DEFAULT_RANKING_SORT);
  const [rankingsLoading, setRankingsLoading] = useState(true);
  const [busySource, setBusySource] = useState<string | null>(null);
  const [cloudRefreshBusy, setCloudRefreshBusy] = useState(false);
  const [leagues, setLeagues] = useState<FantasyLeague[]>([]);
  const [selectedLeagueUid, setSelectedLeagueUid] = useState(initialRankingsView.selectedLeagueUid ?? "");
  const [leagueRosterPlayers, setLeagueRosterPlayers] = useState<LeagueRosterPlayer[]>([]);
  const [leagueTradeBlockPlayers, setLeagueTradeBlockPlayers] = useState<LeagueTradeBlockPlayer[]>([]);
  const [leagueAvailablePlayerStats, setLeagueAvailablePlayerStats] = useState<LeagueAvailablePlayerStats[]>([]);
  const [leagueMarketEntries, setLeagueMarketEntries] = useState<LeagueMarketEntry[]>([]);
  const [leagueValueCurve, setLeagueValueCurve] = useState<LeagueValueCurve | null>(null);
  const [leagueOverlayEnabled, setLeagueOverlayEnabled] = useState(initialRankingsView.leagueOverlayEnabled ?? false);
  const [fantasyTeamFilter, setFantasyTeamFilter] = useState(initialRankingsView.fantasyTeamFilter ?? "all");
  const [leagueUrl, setLeagueUrl] = useState(DEFAULT_LEAGUE_URL);
  const [leaguesLoading, setLeaguesLoading] = useState(true);
  const [busyLeague, setBusyLeague] = useState<string | null>(null);
  const [teams, setTeams] = useState<FantasyTeam[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [busyTeam, setBusyTeam] = useState<string | null>(null);
  const [myTeamUidsByLeague, setMyTeamUidsByLeague] = useState<MyTeamUidsByLeague>(loadMyTeamUidsByLeague);
  const [busyMyTeamLeagueUid, setBusyMyTeamLeagueUid] = useState<string | null>(null);
  const myTeamPreferenceMigrationAttemptsRef = useRef(new Set<string>());
  const [tradeSideBTeamUid, setTradeSideBTeamUid] = useState("");
  const [tradeSideAPlayerKeys, setTradeSideAPlayerKeys] = useState<string[]>([]);
  const [tradeSideBPlayerKeys, setTradeSideBPlayerKeys] = useState<string[]>([]);
  const [tradeSideADropPlayerKeys, setTradeSideADropPlayerKeys] = useState<string[]>([]);
  const [tradeSideBDropPlayerKeys, setTradeSideBDropPlayerKeys] = useState<string[]>([]);
  const [tradeSideACash, setTradeSideACash] = useState("");
  const [tradeSideBCash, setTradeSideBCash] = useState("");
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastIdRef = useRef(0);
  const toastTimersRef = useRef(new Map<number, number>());

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  // Stable identity: LineupHelperWorkspace lists setToast in an effect's deps, so a new
  // function every render would re-run that effect forever.
  const setToast = useCallback<ToastFn>((message, variant = "success") => {
    if (!message) return;
    setToasts((current) => {
      // A repeat of what is already on top is noise, not a second event.
      if (current[current.length - 1]?.message === message) return current;
      return [...current, { id: ++toastIdRef.current, message, variant }].slice(-MAX_VISIBLE_TOASTS);
    });
  }, []);

  // Confirmations clear themselves; errors stay until dismissed, because they usually mean
  // something still needs doing. Timers are keyed by id so a new toast does not extend the
  // life of the ones already showing.
  useEffect(() => {
    const timers = toastTimersRef.current;
    for (const toast of toasts) {
      if (toast.variant === "error" || timers.has(toast.id)) continue;
      timers.set(
        toast.id,
        window.setTimeout(() => {
          timers.delete(toast.id);
          dismissToast(toast.id);
        }, TOAST_DISMISS_MS)
      );
    }
    for (const [id, timer] of timers) {
      if (!toasts.some((toast) => toast.id === id)) {
        window.clearTimeout(timer);
        timers.delete(id);
      }
    }
  }, [dismissToast, toasts]);

  useEffect(() => {
    const timers = toastTimersRef.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);
  const [importSourceId, setImportSourceId] = useState<string | null>(null);
  const [csvText, setCsvText] = useState("");
  const [playerNameCorrections, setPlayerNameCorrections] = useState<PlayerNameCorrection[]>([]);
  const [workspaceTeamUid, setWorkspaceTeamUid] = useState("");
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
      // Back/forward and hand-edited links change the hash without remounting, so the
      // rankings view has to be re-read here or the URL and the controls drift apart.
      if (toolFromHash(window.location.hash) === "rankings") {
        applyRankingsView(rankingsViewFromHash(window.location.hash));
      }
      syncToolFromHash(true);
    }

    syncToolFromHash(false);
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  // Push a parsed view onto the controls, resetting anything the link leaves out so a
  // bookmarked URL always produces the same board rather than merging with what was there.
  function applyRankingsView(view: Partial<RankingsViewState>) {
    setQuery(view.query ?? "");
    setMinAge(view.minAge ?? "");
    setMaxAge(view.maxAge ?? "");
    setPositionFilter(view.positionFilter ?? "all");
    setRosterTagFilter(view.rosterTagFilter ?? "all");
    setMinSources(view.minSources ?? 1);
    setTdgFormat(view.tdgFormat ?? "points");
    setFantraxFormat(view.fantraxFormat ?? "points");
    setIncludedSourceTags(view.includedSourceTags ?? DEFAULT_INCLUDED_SOURCE_TAGS);
    setRankingSort(view.rankingSort ?? DEFAULT_RANKING_SORT);
    setLeagueOverlayEnabled(view.leagueOverlayEnabled ?? false);
    setFantasyTeamFilter(view.fantasyTeamFilter ?? "all");
    if (view.selectedLeagueUid) setSelectedLeagueUid(view.selectedLeagueUid);
  }

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

  // Mirror the rankings view into the hash so a filtered board can be reloaded, linked or
  // kept in a tab. replaceState rather than assigning location.hash: typing in the search
  // box should not push a history entry per keystroke.
  useEffect(() => {
    if (activeTool !== "rankings") return;
    const queryString = rankingsViewToQuery({
      fantasyTeamFilter,
      fantraxFormat,
      includedSourceTags,
      leagueOverlayEnabled,
      maxAge,
      minAge,
      minSources,
      positionFilter,
      query,
      rankingSort,
      rosterTagFilter,
      selectedLeagueUid,
      tdgFormat
    });
    const nextHash = queryString ? `${TOOL_HASH_PATHS.rankings}?${queryString}` : TOOL_HASH_PATHS.rankings;
    if (window.location.hash !== nextHash) {
      window.history.replaceState(window.history.state, "", nextHash);
    }
  }, [
    activeTool,
    fantasyTeamFilter,
    fantraxFormat,
    includedSourceTags,
    leagueOverlayEnabled,
    maxAge,
    minAge,
    minSources,
    positionFilter,
    query,
    rankingSort,
    rosterTagFilter,
    selectedLeagueUid,
    tdgFormat
  ]);

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
    if (selectedLeagueUid && (leagueOverlayEnabled || activeTool === "trade" || activeTool === "pitchers" || activeTool === "pickups")) {
      refreshLeagueRosterMap(selectedLeagueUid);
    } else {
      setLeagueRosterPlayers([]);
      setLeagueTradeBlockPlayers([]);
      setLeagueAvailablePlayerStats([]);
      setLeagueMarketEntries([]);
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
    setLeagueMarketEntries(mapData.market_entries || []);
    setLeagueValueCurve(mapData.value_curve);
  }

  async function updateSource(sourceId: string) {
    setBusySource(sourceId);
    try {
      const result = await postJson<UpdateResult>(`/api/sources/${sourceId}/update`, {});
      setToast(result.message);
      await refreshRankings();
    } catch (error) {
      setToast(errorMessage(error), "error");
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
      setToast(errorMessage(error), "error");
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
        setToast("A refresh just ran — try again in a minute.", "info");
        // The returned request is already complete, so callers can safely reload its data.
        return true;
      }
      if (res.status === "already_queued") {
        setToast("A refresh is already in progress — waiting for it to finish…", "info");
      } else if (res.status === "queued") {
        setToast(`Refresh requested (${scope}). Waiting for your home worker…`, "info");
      } else {
        setToast("Refresh request submitted.", "info");
      }
      if (res.request?.id) {
        return await pollCloudRefresh(res.request.id);
      }
      return false;
    } catch (error) {
      setToast(errorMessage(error), "error");
      return false;
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
        return true;
      }
      if (status === "error") {
        setToast(`Refresh failed: ${rows[0]?.message ?? "unknown error"}.`, "error");
        return false;
      }
    }
    setToast("Refresh is taking longer than expected — is the worker running on your home PC?", "error");
    return false;
  }

  async function importCsv() {
    if (!importSourceId) return;
    setBusySource(importSourceId);
    try {
      const result = await saveSourceCsvImport(importSourceId, csvText);
      setToast(result.message);
      setCsvText("");
      setImportSourceId(null);
      await refreshRankings();
    } catch (error) {
      setToast(errorMessage(error), "error");
    } finally {
      setBusySource(null);
    }
  }

  async function updateSourceTag(sourceId: string, sourceTag: SourceTag) {
    setBusySource(`tag:${sourceId}`);
    try {
      await saveSourceTag(sourceId, sourceTag);
      setToast("Source tag updated.");
      await refreshRankings();
    } catch (error) {
      setToast(errorMessage(error), "error");
      await refreshRankings();
    } finally {
      setBusySource(null);
    }
  }

  async function updateSourceIncluded(sourceId: string, included: boolean) {
    setBusySource(`included:${sourceId}`);
    try {
      await saveSourceIncluded(sourceId, included);
      setToast(included ? "Source included in rankings." : "Source excluded from rankings.");
      await refreshRankings();
    } catch (error) {
      setToast(errorMessage(error), "error");
      await refreshRankings();
    } finally {
      setBusySource(null);
    }
  }

  async function savePlayerNameCorrection(sourceId: string, originalName: string, correctedName: string) {
    setBusySource(`correction:${sourceId}`);
    try {
      await savePlayerNameCorrectionRemote(sourceId, originalName, correctedName);
      setToast("Player name correction saved.");
      await refreshRankings();
    } catch (error) {
      setToast(errorMessage(error), "error");
      await refreshRankings();
    } finally {
      setBusySource(null);
    }
  }

  async function deletePlayerNameCorrection(correctionId: number) {
    setBusySource(`correction-delete:${correctionId}`);
    try {
      await deletePlayerNameCorrectionRemote(correctionId);
      setToast("Player name correction removed.");
      await refreshRankings();
    } catch (error) {
      setToast(errorMessage(error), "error");
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
      setToast(errorMessage(error), "error");
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
      setToast(errorMessage(error), "error");
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
      setToast(errorMessage(error), "error");
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
      setToast(errorMessage(error), "error");
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
      setToast(errorMessage(error), "error");
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
        setToast(`Could not save the team selection across devices: ${errorMessage(error)}`, "error");
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

  function exportRankingsCsv() {
    downloadCsv("dynasty-rankings-aggregate.csv", aggregatePlayersToCsv(board, visiblePlayers));
    setToast("Exported " + visiblePlayers.length.toLocaleString() + " filtered players.");
  }

  const importSource = sources.find((source) => source.id === importSourceId) || null;
  const activeTdgSourceId = tdgFormat === "obp" ? TDG_OBP_SOURCE_ID : TDG_POINTS_SOURCE_ID;
  const activeFantraxSourceId = fantraxFormat === "roto" ? FANTRAX_ROTO_SOURCE_ID : FANTRAX_POINTS_SOURCE_ID;
  const displayedSources = sources.filter((source) => {
    if (isTdgSource(source.id)) return source.id === activeTdgSourceId;
    if (isFantraxSource(source.id)) return source.id === activeFantraxSourceId;
    return true;
  });
  const activeSourceIds = new Set(board.sources.map((source) => source.id));
  const selectedLeague = leagues.find((league) => league.league_uid === selectedLeagueUid) || null;
  const selectedLeagueTeams = selectedLeague
    ? teams
        .filter((team) => team.league_id === selectedLeague.league_id)
        .sort((left, right) => (left.standings_rank || 999) - (right.standings_rank || 999) || left.team_name.localeCompare(right.team_name))
    : [];
  const selectedMyTeamUid = selectedLeague
    ? myTeamUidForLeague(selectedLeague.league_uid, selectedLeagueTeams, myTeamUidsByLeague)
    : "";
  // Which team the Lineup, Optimal and Pitchers screens are looking at. This lives here
  // rather than in each workspace so switching screens keeps the team you picked; it used
  // to be local state in all three, which silently reset you to your own team on every hop.
  const activeTeamUid = selectedLeagueTeams.some((team) => team.team_uid === workspaceTeamUid)
    ? workspaceTeamUid
    : selectedMyTeamUid || selectedLeagueTeams[0]?.team_uid || "";

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
            : activeTool === "pickups"
              ? "Auctions & Waivers"
            : activeTool === "lineup"
              ? "Lineup Helper"
              : "Leagues";

  return (
    <div className={`app-shell${WORKSPACE_TOOLS.has(activeTool) ? " app-shell-fixed" : ""}`}>
      <header className="topbar">
        <div className="topbar-title">
          <p className="eyebrow">Assistant GM</p>
          <h1>{pageTitle}</h1>
        </div>
        <div className="topbar-actions">
          <nav className="segmented tool-nav" aria-label="Assistant tools">
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
            <button aria-current={activeTool === "pickups" ? "page" : undefined} className={activeTool === "pickups" ? "active" : ""} onClick={() => navigateToTool("pickups")} type="button">
              <ShoppingCart size={15} />
              Pickups
            </button>
            <button aria-current={activeTool === "leagues" ? "page" : undefined} className={activeTool === "leagues" ? "active" : ""} onClick={() => navigateToTool("leagues")} type="button">
              <Users size={15} />
              Leagues
            </button>
          </nav>
          <div className="topbar-commands" aria-label="Page actions" key={activeTool} role="group">
          {activeTool === "rankings" ? (
            <button className="button ghost" disabled={rankingsLoading || !visiblePlayers.length} onClick={exportRankingsCsv} title="Download the currently filtered ranking rows as CSV." type="button">
              <Download size={18} />
              Export
            </button>
          ) : null}
          <button
            aria-busy={cloudRefreshBusy}
            className="button primary topbar-refresh"
            onClick={() => requestCloudRefresh("all")}
            disabled={cloudRefreshBusy}
            title="Ask your home machine to re-scrape everything and update the live site. Works from anywhere."
            type="button"
          >
            <RefreshCcw size={18} className={cloudRefreshBusy ? "spin" : ""} />
            {cloudRefreshBusy ? "Refreshing data..." : "Refresh data"}
          </button>
          </div>
        </div>
      </header>

      {activeTool === "home" ? (
        <HomeWorkspace
          board={board}
          busyLeague={busyLeague}
          busySource={busySource}
          leagues={leagues}
          localUpdatesAvailable={isLocalBackendAvailable()}
          onOpenRankings={() => navigateToTool("rankings")}
          onOpenSources={() => navigateToTool("sources")}
          onOpenLeagues={() => navigateToTool("leagues")}
          onOpenTrade={() => navigateToTool("trade")}
          onOpenLineup={() => navigateToTool("lineup")}
          onOpenOptimalLineup={() => navigateToTool("optimal-lineup")}
          onOpenPitchers={() => navigateToTool("pitchers")}
          onOpenPickups={() => navigateToTool("pickups")}
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
          rankingSort={rankingSort}
          setRankingSort={setRankingSort}
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
          loading={rankingsLoading}
          deletePlayerNameCorrection={deletePlayerNameCorrection}
          importCsvSource={(sourceId) => setImportSourceId(sourceId)}
          localUpdatesAvailable={isLocalBackendAvailable()}
          playerNameCorrections={playerNameCorrections}
          savePlayerNameCorrection={savePlayerNameCorrection}
          sources={sources}
          updateAllSources={updateAll}
          updateContinuousSources={updateContinuous}
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
          cloudRefreshBusy={cloudRefreshBusy}
          leagues={leagues}
          myTeamUid={selectedMyTeamUid}
          requestCloudRefresh={requestCloudRefresh}
          selectedLeague={selectedLeague}
          selectedLeagueTeams={selectedLeagueTeams}
          selectedLeagueUid={selectedLeagueUid}
          setSelectedLeagueUid={setSelectedLeagueUid}
          setTeamUid={setWorkspaceTeamUid}
          setToast={setToast}
          teamUid={activeTeamUid}
        />
      ) : activeTool === "optimal-lineup" ? (
        <OptimalLineupWorkspace
          leagues={leagues}
          myTeamUid={selectedMyTeamUid}
          selectedLeague={selectedLeague}
          selectedLeagueTeams={selectedLeagueTeams}
          selectedLeagueUid={selectedLeagueUid}
          setSelectedLeagueUid={setSelectedLeagueUid}
          setTeamUid={setWorkspaceTeamUid}
          setToast={setToast}
          teamUid={activeTeamUid}
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
          setTeamUid={setWorkspaceTeamUid}
          setToast={setToast}
          teamUid={activeTeamUid}
          toggleIncludedSourceTag={toggleIncludedSourceTag}
        />
      ) : activeTool === "pickups" ? (
        <PickupsWorkspace
          availableScoringValueByPlayerKey={availableScoringValueByPlayerKey}
          availableStatsByPlayerKey={availableStatsByPlayerKey}
          board={board}
          includedSourceTags={includedSourceTags}
          leagueMarketEntries={leagueMarketEntries}
          leagueValueCurve={leagueValueCurve}
          leagues={leagues}
          selectedLeague={selectedLeague}
          selectedLeagueUid={selectedLeagueUid}
          setSelectedLeagueUid={setSelectedLeagueUid}
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
              <button className="button ghost" onClick={() => downloadCsv("import-template.csv", CSV_IMPORT_TEMPLATE)}>
                <Download size={17} />
                Template
              </button>
              <button className="button primary" onClick={importCsv} disabled={!csvText.trim() || busySource !== null}>
                <Upload size={17} />
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      {toasts.length > 0 && (
        <div aria-live="polite" className="toast-stack">
          {toasts.map((toast) => (
            <div className={`toast ${toast.variant}`} key={toast.id} role={toast.variant === "error" ? "alert" : "status"}>
              {toast.variant === "error" ? (
                <AlertCircle size={17} />
              ) : toast.variant === "success" ? (
                <CheckCircle2 size={17} />
              ) : (
                <Info size={17} />
              )}
              <span>{toast.message}</span>
              <button
                aria-label={`Dismiss notification: ${toast.message}`}
                className="toast-close"
                onClick={() => dismissToast(toast.id)}
                type="button"
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type HomeCard = {
  description: string;
  icon: ReactNode;
  onOpen: () => void;
  state: string;
  title: string;
  warn?: boolean;
};

function HomeWorkspace({
  board,
  busyLeague,
  busySource,
  leagues,
  localUpdatesAvailable,
  onOpenRankings,
  onOpenSources,
  onOpenLeagues,
  onOpenTrade,
  onOpenLineup,
  onOpenOptimalLineup,
  onOpenPitchers,
  onOpenPickups,
  refreshLeagues,
  refreshRankings,
  sources,
  teams
}: {
  board: AggregateBoard;
  busyLeague: string | null;
  busySource: string | null;
  leagues: FantasyLeague[];
  localUpdatesAvailable: boolean;
  onOpenRankings: () => void;
  onOpenSources: () => void;
  onOpenLeagues: () => void;
  onOpenTrade: () => void;
  onOpenLineup: () => void;
  onOpenOptimalLineup: () => void;
  onOpenPitchers: () => void;
  onOpenPickups: () => void;
  refreshLeagues: () => void;
  refreshRankings: () => void;
  sources: RankingSource[];
  teams: FantasyTeam[];
}) {
  const loadedSourceCount = board.sources.length;
  const loadedLeagueCount = leagues.length;
  const loadedTeamCount = teams.length;
  const rosteredPlayerCount = leagues.reduce((total, league) => total + league.rostered_player_count, 0);
  const primaryLeague = leagues[0] || null;
  // Most recent successful scrape across sources: the one piece of state that tells you
  // whether the board you are about to open is current.
  const lastRefreshedAt = sources.reduce<string | null>((latest, source) => {
    if (!source.last_fetched_at) return latest;
    return !latest || source.last_fetched_at > latest ? source.last_fetched_at : latest;
  }, null);
  const staleSourceCount = sources.filter((source) => source.included && source.last_status === "error").length;

  const groups: { title: string; blurb: string; cards: HomeCard[] }[] = [
    {
      title: "Set today's lineup",
      blurb: "Who to start tonight, and which arms to run out.",
      cards: [
        {
          description: "Compare your hitters to today's probable starters and their xFIP-.",
          icon: <CalendarDays size={24} />,
          onOpen: onOpenLineup,
          state: primaryLeague ? `${rosteredPlayerCount.toLocaleString()} rostered players` : "Connect a league first",
          title: "Lineup Helper"
        },
        {
          description: "Best-case hitter lineup, with positional strength, weakness and bench depth.",
          icon: <Target size={24} />,
          onOpen: onOpenOptimalLineup,
          state: `${LINEUP_SLOTS.length} lineup slots`,
          title: "Optimal Lineup"
        },
        {
          description: "Split a staff into starters and relievers using current appearance usage.",
          icon: <Activity size={24} />,
          onOpen: onOpenPitchers,
          state: primaryLeague ? `${primaryLeague.league_name} staff` : "Connect a league first",
          title: "Pitchers"
        }
      ]
    },
    {
      title: "Build the roster",
      blurb: "Longer-horizon calls: who to target, who to move.",
      cards: [
        {
          description: "Aggregate public and imported dynasty rankings, then overlay league ownership.",
          icon: <Database size={24} />,
          onOpen: onOpenRankings,
          state: `${board.players.length.toLocaleString()} players from ${loadedSourceCount} sources`,
          title: "Dynasty Rankings"
        },
        {
          description: "Compare packages against another roster on dynasty and scoring value.",
          icon: <ArrowLeftRight size={24} />,
          onOpen: onOpenTrade,
          state: primaryLeague ? `${loadedTeamCount} teams to trade with` : "Connect a league first",
          title: "Trade Analyzer"
        },
        {
          description: "Price every live auction and waiver claim against what your league pays for that rank.",
          icon: <ShoppingCart size={24} />,
          onOpen: onOpenPickups,
          state: primaryLeague ? `${primaryLeague.league_name} market` : "Connect a league first",
          title: "Auctions & Waivers"
        }
      ]
    },
    {
      title: "Keep the data honest",
      blurb: "Where the numbers come from, and whether they are current.",
      cards: [
        {
          description: "Connect Ottoneu leagues, pick your team, and manage them in one place.",
          icon: <Users size={24} />,
          onOpen: onOpenLeagues,
          state: loadedLeagueCount
            ? `${loadedLeagueCount} ${loadedLeagueCount === 1 ? "league" : "leagues"}, ${loadedTeamCount} teams`
            : "No leagues connected",
          title: "Leagues"
        },
        {
          description: "Review ranking sources, open their sites, import, and assign cycle tags.",
          icon: <Tags size={24} />,
          onOpen: onOpenSources,
          state: staleSourceCount
            ? `${staleSourceCount} of ${sources.length} sources failing`
            : `${loadedSourceCount} of ${sources.length} sources loaded`,
          title: "Data Sources",
          warn: staleSourceCount > 0
        }
      ]
    }
  ];

  return (
    <main className="home-shell">
      <section className="home-hero">
        <p className="eyebrow">Assistant GM</p>
        <h2>{primaryLeague ? primaryLeague.league_name : "Fantasy baseball workspace"}</h2>
        <p className="home-hero-state">
          {lastRefreshedAt ? `Rankings last refreshed ${formatDate(lastRefreshedAt)}` : "No ranking data loaded yet"}
          {staleSourceCount ? ` - ${staleSourceCount} source${staleSourceCount === 1 ? "" : "s"} failing` : ""}
        </p>
      </section>

      {localUpdatesAvailable ? (
        <section className="home-actions">
          <button className="button ghost" onClick={refreshRankings} disabled={busySource !== null}>
            <RefreshCcw size={18} className={busySource === "all" ? "spin" : ""} />
            Refresh Rankings
          </button>
          <button className="button ghost" onClick={refreshLeagues} disabled={busyLeague !== null || !leagues.length}>
            <RefreshCcw size={18} className={busyLeague === "all" ? "spin" : ""} />
            Refresh Leagues
          </button>
        </section>
      ) : null}

      {groups.map((group) => (
        <section className="home-group" key={group.title}>
          <div className="home-group-heading">
            <h3>{group.title}</h3>
            <p>{group.blurb}</p>
          </div>
          <div className="door-grid">
            {group.cards.map((card) => (
              <button className="door-card" key={card.title} onClick={card.onOpen} type="button">
                <div className="door-icon">{card.icon}</div>
                <div>
                  <h3>{card.title}</h3>
                  <p>{card.description}</p>
                </div>
                <span className={`door-state${card.warn ? " warn" : ""}`}>{card.state}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
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
  rankingSort,
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
  setRankingSort,
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
  setRankingSort: (sort: TableSort) => void;
  setTdgFormat: (value: "obp" | "points") => void;
  rankingSort: TableSort;
  tdgFormat: "obp" | "points";
  toggleIncludedSourceTag: (sourceTag: SourceTag) => void;
  updateSource: (sourceId: string) => void;
  selectedLeagueUid: string;
  visiblePlayers: AggregatePlayer[];
}) {
  const groupedSources = useMemo(
    () =>
      SOURCE_TAGS.map((sourceTag) => ({
        source_tag: sourceTag,
        sources: board.sources.filter((source) => source.source_tag === sourceTag)
      })).filter((group) => group.sources.length > 0),
    [board.sources]
  );
  // The rank columns show every tag, but the plot charts only the tags currently selected,
  // matching the Trade and Pickups plots, which build from the allowed sources.
  const spreadSources = useMemo(
    () => board.sources.filter((source) => includedSourceTags.includes(source.source_tag)),
    [board.sources, includedSourceTags]
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
    10 +
    (leagueOverlayEnabled ? 1 : 0) +
    (showLeaguePositions ? 1 : 0) +
    (showRosterStatus ? 1 : 0) +
    (showFantasyValue ? 5 : 0) +
    groupedSources.reduce((total, group) => total + group.sources.length + 1, 0);
  // Distinguishes "your filters excluded everything" from "there is no data", so the empty
  // state can name the thing that would actually fix it.
  const rankingFiltersActive = Boolean(
    query.trim() || minAge || maxAge || positionFilter !== "all" || rosterTagFilter !== "all" || minSources > 1
  );

  return (
    <main className="workspace rankings-workspace">
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
                  aria-pressed={active}
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
          {/* The header renders in every state so the table does not appear from nothing
              once rows arrive; only the body swaps between skeleton, rows and empty. */}
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
                  <SortableHeader className="trade-spread-col" label="Range" rowSpan={2} sort={rankingSort} sortKey="spread" setSort={setRankingSort} title="Where each included source ranks this player. Dots are sources, coloured by tag; the diamond is the aggregate rank. Rank 1 is on the left, so a tight cluster means the sources agree." />
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
              {loading ? (
                <SkeletonRows columns={rankingColumnCount} rows={14} />
              ) : sortedVisiblePlayers.length ? (
                <>
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
                      spreadSources={spreadSources}
                    />
                  ))}
                  <TableSpacerRow colSpan={rankingColumnCount} height={rankingWindow.afterHeight} />
                </>
              ) : (
                <TableEmptyRow colSpan={rankingColumnCount}>
                  {rankingFiltersActive
                    ? "No players match these filters. Widen the age range, lower the source minimum, or clear the search."
                    : "No ranking rows loaded yet. Refresh your sources to build the board."}
                </TableEmptyRow>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function SourceManagerWorkspace({
  board,
  busySource,
  loading,
  deletePlayerNameCorrection,
  importCsvSource,
  localUpdatesAvailable,
  playerNameCorrections,
  savePlayerNameCorrection,
  sources,
  updateAllSources,
  updateContinuousSources,
  updateSource,
  updateSourceIncluded,
  updateSourceTag
}: {
  board: AggregateBoard;
  busySource: string | null;
  loading: boolean;
  deletePlayerNameCorrection: (correctionId: number) => void;
  importCsvSource: (sourceId: string) => void;
  localUpdatesAvailable: boolean;
  playerNameCorrections: PlayerNameCorrection[];
  savePlayerNameCorrection: (sourceId: string, originalName: string, correctedName: string) => void;
  sources: RankingSource[];
  updateAllSources: () => void;
  updateContinuousSources: () => void;
  updateSource: (sourceId: string) => void;
  updateSourceIncluded: (sourceId: string, included: boolean) => void;
  updateSourceTag: (sourceId: string, sourceTag: SourceTag) => void;
}) {
  const loadedSourceIds = new Set(board.sources.map((source) => source.id));
  // Which tags are judged against each other. Kept separate from the board's own tag filter
  // because these answer different questions: what to rank with, versus what to compare.
  const [scoredTags, setScoredTags] = useState<SourceTag[]>(DEFAULT_INCLUDED_SOURCE_TAGS);
  const sourceQualityById = useMemo(() => buildSourceQualityMetrics(board, scoredTags), [board, scoredTags]);
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
          {localUpdatesAvailable ? (
            <div aria-label="Bulk source updates" className="source-bulk-actions" role="group">
              <button className="button ghost" disabled={busySource !== null} onClick={updateContinuousSources} type="button">
                <RefreshCcw size={17} className={busySource === "continuous" ? "spin" : ""} />
                Continuous
              </button>
              <button className="button primary" disabled={busySource !== null} onClick={updateAllSources} type="button">
                <RefreshCcw size={17} className={busySource === "all" ? "spin" : ""} />
                All sources
              </button>
            </div>
          ) : null}
        </div>

        <div className="board-summary source-manager-summary">
          <Metric label="Sources" value={sources.length.toLocaleString()} />
          <Metric label="Included" value={includedSourceCount.toLocaleString()} />
          <Metric label="Loaded" value={loadedSourceIds.size.toLocaleString()} />
          <Metric label="Auto Update" value={autoUpdateCount.toLocaleString()} />
          <Metric label="Rows" value={totalRows.toLocaleString()} />
        </div>

        <div className="trade-source-controls">
          <span>Benchmark Quality Against</span>
          <div className="segmented tag-segmented" aria-label="Source tags compared when scoring quality">
            {SOURCE_TAGS.map((sourceTag) => {
              const active = scoredTags.includes(sourceTag);
              return (
                <button
                  key={sourceTag}
                  className={active ? "active" : ""}
                  onClick={() => setScoredTags(toggleKey(scoredTags, sourceTag) as SourceTag[])}
                  title={`${active ? "Stop scoring" : "Score"} ${sourceTag} sources against the other selected tags.`}
                  aria-label={`${active ? "Stop scoring" : "Score"} ${sourceTag} sources`}
                  aria-pressed={active}
                >
                  {sourceTag}
                </button>
              );
            })}
          </div>
          <span className="trade-filter-count">
            {scoredTags.length
              ? `${board.sources.filter((source) => scoredTags.includes(source.source_tag) && source.included).length} included sources as the benchmark`
              : "No tags selected"}
          </span>
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
                <th title={`Lower is better. Average rank distance from the other included sources in the selected tags, over pairs where at least one side ranks the player inside the top ${SOURCE_QUALITY_TOP_RANK}. A score of 30 means this source typically places a player about 30 spots from where the rest of your board does. Excluded sources are left out entirely. Ranks past ${SOURCE_QUALITY_TOP_RANK} count as one "outside" value, and a player the other source omits is not compared.`}>Quality</th>
                <th>Source Date</th>
                <th>Last Fetch</th>
                <th>Rows</th>
                <th>Access</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && !sources.length ? (
                <SkeletonRows columns={12} rows={8} />
              ) : !sources.length ? (
                <TableEmptyRow colSpan={12}>
                  No ranking sources are configured yet. Import a CSV or run an update to populate the board.
                </TableEmptyRow>
              ) : (
                sources.map((source) => {
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
                })
              )}
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
  if (!quality.isIncluded) return <span className="missing-rank">Not included</span>;
  if (!quality.inScoredTags) return <span className="missing-rank">Tag not scored</span>;
  // Included and in a selected tag, but the only such source, so there is nothing to
  // measure it against.
  if (quality.peerSourceCount === 0) {
    return <span className="missing-rank" title="This is the only included source in the selected tags, so there is nothing to compare it against.">Not included</span>;
  }
  if (!quality.comparisonCount) return <span className="missing-rank">No top 200 overlap</span>;

  // The comparison count is the score's sample size: a source overlapping on a handful of
  // players can post a flattering average that means very little.
  return (
    <div className="quality-cell">
      <strong title={`Average of ${quality.comparisonCount.toLocaleString()} rank comparisons against ${quality.peerSourceCount} other included ${quality.peerSourceCount === 1 ? "source" : "sources"}.`}>
        {formatQualityScore(quality.qualityScore)}
      </strong>
      <small>{quality.comparisonCount.toLocaleString()} cmp</small>
    </div>
  );
}

type CapProjection = {
  capSpace: number | null;
  currentLimit: number | null;
  currentUsed: number | null;
  knownSalaryChange: number;
  overCap: boolean;
  projectedLimit: number | null;
  projectedUsed: number | null;
  rosterCountChange: number;
  salaryChange: number | null;
  unknownSalaryCount: number;
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
  setTeamUid,
  setToast,
  teamUid,
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
  setTeamUid: (teamUid: string) => void;
  setToast: ToastFn;
  teamUid: string;
  toggleIncludedSourceTag: (sourceTag: SourceTag) => void;
}) {
  const myTeam = selectedLeagueTeams.find((team) => team.team_uid === myTeamUid) || null;
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
  const allowedSources = useMemo(
    () => board.sources.filter((source) => includedSourceTags.includes(source.source_tag)),
    [board.sources, includedSourceTags]
  );
  const tradeRows = useMemo(
    () =>
      buildTradeRows(
        selectedTeamUid,
        leagueRosterPlayers,
        boardPlayerByKey,
        leagueValueCurve,
        allowedSources,
        scoringValueByPlayerKey
      ).filter((row) => row.section === "pitcher"),
    [allowedSources, boardPlayerByKey, leagueRosterPlayers, leagueValueCurve, scoringValueByPlayerKey, selectedTeamUid]
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
        setToast(`Pitcher plan database sync failed: ${errorMessage(error)} Browser backup is still active.`, "error");
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
          setToast(`Pitcher plan database sync failed: ${errorMessage(error)} Browser backup is still active.`, "error");
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
      setToast("SP Bubble is full. Increase the Bubble slot count or remove a pitcher first.", "error");
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
                  aria-pressed={active}
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
                  <td>{formatTradeSalary(row.salary)}</td>
                  <td>{formatTradePoints(row)}</td>
                  <td title={row.usage.xfip_error || "FanGraphs season xFIP-"}>
                    {formatXfipMinus(row.usage.xfip_minus)}
                  </td>
                  <td>{formatRate(row)}</td>
                  <td>{formatFantasyValue(row.value)}</td>
                  <td>{formatFantasyValue(row.scoredValue)}</td>
                  <td><ValueMinusSalary value={row.value} salary={row.salary} /></td>
                  <td><ValueMinusSalary value={row.scoredValue} salary={row.salary} /></td>
                  <td>{formatFantasyValue(tradePlayerValueRange(row).minValue)}</td>
                  <td>{formatFantasyValue(tradePlayerValueRange(row).maxValue)}</td>
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

function PickupsWorkspace({
  availableScoringValueByPlayerKey,
  availableStatsByPlayerKey,
  board,
  includedSourceTags,
  leagueMarketEntries,
  leagueValueCurve,
  leagues,
  selectedLeague,
  selectedLeagueUid,
  setSelectedLeagueUid,
  toggleIncludedSourceTag
}: {
  availableScoringValueByPlayerKey: Map<string, ScoringValueMetric>;
  availableStatsByPlayerKey: Map<string, LeagueAvailablePlayerStats>;
  board: AggregateBoard;
  includedSourceTags: SourceTag[];
  leagueMarketEntries: LeagueMarketEntry[];
  leagueValueCurve: LeagueValueCurve | null;
  leagues: FantasyLeague[];
  selectedLeague: FantasyLeague | null;
  selectedLeagueUid: string;
  setSelectedLeagueUid: (leagueUid: string) => void;
  toggleIncludedSourceTag: (sourceTag: SourceTag) => void;
}) {
  const boardPlayerByKey = useMemo(() => new Map(board.players.map((player) => [player.player_key, player])), [board.players]);
  const allowedSources = useMemo(
    () => board.sources.filter((source) => includedSourceTags.includes(source.source_tag)),
    [board.sources, includedSourceTags]
  );
  const auctionRows = useMemo(
    () => buildPickupRows(leagueMarketEntries, "auction", boardPlayerByKey, leagueValueCurve, allowedSources, availableStatsByPlayerKey, availableScoringValueByPlayerKey),
    [allowedSources, availableScoringValueByPlayerKey, availableStatsByPlayerKey, boardPlayerByKey, leagueMarketEntries, leagueValueCurve]
  );
  const waiverRows = useMemo(
    () => buildPickupRows(leagueMarketEntries, "waiver", boardPlayerByKey, leagueValueCurve, allowedSources, availableStatsByPlayerKey, availableScoringValueByPlayerKey),
    [allowedSources, availableScoringValueByPlayerKey, availableStatsByPlayerKey, boardPlayerByKey, leagueMarketEntries, leagueValueCurve]
  );
  const leagueId = selectedLeague?.league_id ?? null;
  const fetchedAt = leagueMarketEntries[0]?.fetched_at || null;
  const bargainCount = [...auctionRows, ...waiverRows].filter((row) => (row.surplus ?? 0) > 0).length;

  return (
    <main className="pitchers-shell">
      <section className="pitchers-toolbar">
        <div>
          <p className="eyebrow">Available Now</p>
          <h2>{selectedLeague?.league_name || "No league selected"}</h2>
        </div>
        <div className="pitchers-selectors">
          <select
            className="select-control"
            value={selectedLeagueUid}
            onChange={(event) => setSelectedLeagueUid(event.target.value)}
            aria-label="Pickups league"
          >
            {leagues.map((league) => (
              <option key={league.league_uid} value={league.league_uid}>
                {league.league_name}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="pitchers-options">
        <p>
          Auctions and waivers as of the last league scrape. <strong>Value</strong> is what this league's own salary
          curve says a player of that dynasty rank is worth, so <strong>Surplus</strong> (value minus what you would
          pay) is the number to bid on. An unranked player has no modelled value and shows no surplus rather than a
          loss. Auction end times move faster than the 5am and noon refresh, so use Refresh data before bidding late.
        </p>
        <div className="trade-source-controls">
          <span>Allowed Sources</span>
          <div className="segmented tag-segmented" aria-label="Source tag groups used in pickup values">
            {SOURCE_TAGS.map((sourceTag) => {
              const active = includedSourceTags.includes(sourceTag);
              return (
                <button
                  key={sourceTag}
                  className={active ? "active" : ""}
                  onClick={() => toggleIncludedSourceTag(sourceTag)}
                  title={`${active ? "Remove" : "Include"} ${sourceTag} sources in pickup values.`}
                  aria-label={`${active ? "Remove" : "Include"} ${sourceTag} sources in pickup values`}
                  aria-pressed={active}
                >
                  {sourceTag}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="pitchers-summary" aria-label="Pickup summary">
        <Metric label="On Auction" value={auctionRows.length.toLocaleString()} />
        <Metric label="On Waivers" value={waiverRows.length.toLocaleString()} />
        <Metric label="Priced Below Value" value={bargainCount.toLocaleString()} />
        <Metric label="Last Scraped" value={formatDate(fetchedAt)} />
      </section>

      <PickupTable
        costLabel="Min Bid"
        deadlineLabel="Ends"
        emptyMessage="No auctions are running in this league right now."
        eyebrow="Current Auctions"
        leagueId={leagueId}
        rows={auctionRows}
        title="Bid by the deadline"
      />
      <PickupTable
        costLabel="Salary"
        deadlineLabel="Claim Deadline"
        emptyMessage="Nobody is on waivers in this league right now."
        eyebrow="Players on Waivers"
        leagueId={leagueId}
        rows={waiverRows}
        showCutBy
        title="Claim at the listed salary"
      />
    </main>
  );
}

// Mirrors the Trade Analyzer's player table so a pickup reads the same way a trade target
// does — same grouped Contract / Dynasty / Scoring columns and the same source spread plot —
// minus the give and drop checkboxes, which have no meaning for a player nobody owns.
function PickupTable({
  costLabel,
  deadlineLabel,
  emptyMessage,
  eyebrow,
  leagueId,
  rows,
  showCutBy = false,
  title
}: {
  costLabel: string;
  deadlineLabel: string;
  emptyMessage: string;
  eyebrow: string;
  leagueId: number | null;
  rows: PickupRow[];
  showCutBy?: boolean;
  title: string;
}) {
  // Surplus first: the whole point of the screen is what is underpriced right now.
  const [sort, setSort] = useState<TableSort>({ key: "dyDelta", direction: "desc" });
  const sortedRows = useMemo(() => sortTradeRows(rows, sort) as PickupRow[], [rows, sort]);
  const columnCount = showCutBy ? 13 : 12;

  return (
    <section className="optimal-section">
      <div className="optimal-section-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3>{title}</h3>
        </div>
        <strong>{rows.length}</strong>
      </div>
      <div
        aria-label={`${eyebrow} table; scroll horizontally for additional GM metrics`}
        className="trade-table-wrap"
        tabIndex={0}
      >
        <table className="trade-player-table full pickup">
          {/* table-layout is fixed and the first header row is all colspan group headers, so
              per-column widths have to come from here or every column ends up equal. */}
          <colgroup>
            <col style={{ width: "275px" }} />
            <col style={{ width: "92px" }} />
            {showCutBy ? <col style={{ width: "128px" }} /> : null}
            <col style={{ width: "142px" }} />
            <col style={{ width: "78px" }} />
            <col style={{ width: "86px" }} />
            <col style={{ width: "96px" }} />
            <col style={{ width: "190px" }} />
            <col style={{ width: "78px" }} />
            <col style={{ width: "86px" }} />
            <col style={{ width: "96px" }} />
            <col style={{ width: "90px" }} />
            <col style={{ width: "108px" }} />
          </colgroup>
          <thead>
            <tr>
              <SortableHeader className="player-col trade-player-col" label="Player" rowSpan={2} sort={sort} sortKey="player" setSort={setSort} />
              <th className="group-header" colSpan={showCutBy ? 3 : 2}>Cost</th>
              <th className="group-header" colSpan={4}>Dynasty</th>
              <th className="group-header" colSpan={5}>Scoring</th>
            </tr>
            <tr>
              <SortableHeader label={costLabel} sort={sort} sortKey="salary" setSort={setSort} defaultDirection="desc" />
              {showCutBy ? <th>Cut By</th> : null}
              <th className="pickup-deadline-col" title="Ottoneu shows this in the league's own timezone.">{deadlineLabel}</th>
              <SortableHeader label="Rank" sort={sort} sortKey="dyAgg" setSort={setSort} />
              <SortableHeader label="Value" sort={sort} sortKey="dyValue" setSort={setSort} defaultDirection="desc" />
              <SortableHeader label="Surplus" sort={sort} sortKey="dyDelta" setSort={setSort} defaultDirection="desc" title={`Dynasty value - ${costLabel.toLowerCase()}`} />
              <SortableHeader className="trade-spread-col" label="Spread" sort={sort} sortKey="spread" setSort={setSort} defaultDirection="desc" title="Dots are included sources; the diamond is aggregate consensus; the vertical tick is the cost." />
              <SortableHeader label="Rank" sort={sort} sortKey="scAgg" setSort={setSort} />
              <SortableHeader label="Value" sort={sort} sortKey="scValue" setSort={setSort} defaultDirection="desc" title="Scoring value from total-points rank fitted to the league salary curve." />
              <SortableHeader label="Surplus" sort={sort} sortKey="scDelta" setSort={setSort} defaultDirection="desc" title={`Scoring value - ${costLabel.toLowerCase()}`} />
              <SortableHeader label="Points" sort={sort} sortKey="points" setSort={setSort} defaultDirection="desc" />
              <SortableHeader label="P/G or P/IP" sort={sort} sortKey="rate" setSort={setSort} defaultDirection="desc" />
            </tr>
          </thead>
          <tbody>
            {sortedRows.length ? sortedRows.map((row) => (
              <tr key={`${row.market}:${row.player_key}`}>
                <td className="player-col trade-player-col">
                  <div className="trade-player-primary">
                    <strong>{row.player_name}</strong>
                    <RosterStatusBadge mlbTeam={row.mlbTeam} status={row.status} />
                    {leagueId && row.ottoneuPlayerId ? (
                      <a
                        className="pitcher-log-link"
                        href={`https://ottoneu.fangraphs.com/${leagueId}/players/${row.ottoneuPlayerId}`}
                        rel="noreferrer"
                        target="_blank"
                        title="Open the Ottoneu player page"
                      >
                        <ExternalLink size={13} />
                      </a>
                    ) : null}
                  </div>
                  <span className="trade-player-meta">
                    {row.positions || "-"} / Age {row.age ?? "-"} / {row.mlbTeam || "FA"}
                  </span>
                </td>
                <td>{formatMoney(row.cost)}</td>
                {showCutBy ? <td>{row.cutBy || "-"}</td> : null}
                <td className="pickup-deadline-col">{row.deadlineText || "-"}</td>
                <td>{row.aggregate_rank ? `#${row.aggregate_rank}` : "-"}</td>
                <td>{formatFantasyValue(row.value)}</td>
                <td><ValueMinusSalary value={row.value} salary={row.salary} /></td>
                <td className="trade-spread-col">
                  <TradePlayerSourceSpread row={row} />
                </td>
                <td>{row.scoringRank ? `#${row.scoringRank}` : "-"}</td>
                <td>{formatFantasyValue(row.scoredValue)}</td>
                <td><ValueMinusSalary value={row.scoredValue} salary={row.salary} /></td>
                <td>{formatTradePoints(row)}</td>
                <td>{formatRate(row)}</td>
              </tr>
            )) : (
              <tr>
                <td className="empty-table-cell" colSpan={columnCount}>{emptyMessage}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
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
  const allowedSources = useMemo(() => {
    return board.sources.filter((source) => includedSourceTags.includes(source.source_tag));
  }, [board.sources, includedSourceTags]);
  const boardPlayerByKey = useMemo(() => {
    return new Map(board.players.map((player) => [player.player_key, player]));
  }, [board.players]);
  const sideAPlayers = useMemo(() => {
    return buildTradeRows(myTeam?.team_uid || "", leagueRosterPlayers, boardPlayerByKey, leagueValueCurve, allowedSources, scoringValueByPlayerKey);
  }, [allowedSources, boardPlayerByKey, leagueRosterPlayers, leagueValueCurve, myTeam?.team_uid, scoringValueByPlayerKey]);
  const sideBPlayers = useMemo(() => {
    if (sideBIsAvailable) {
      return buildAvailableTradeRows(board.players, leagueRosterPlayers, leagueValueCurve, allowedSources, availableStatsByPlayerKey, availableScoringValueByPlayerKey);
    }
    if (sideBIsTradeBlock) {
      return buildTradeBlockRows(leagueTradeBlockPlayers, boardPlayerByKey, leagueValueCurve, allowedSources, scoringValueByPlayerKey);
    }
    return buildTradeRows(sideBTeam?.team_uid || "", leagueRosterPlayers, boardPlayerByKey, leagueValueCurve, allowedSources, scoringValueByPlayerKey);
  }, [allowedSources, availableScoringValueByPlayerKey, availableStatsByPlayerKey, board.players, boardPlayerByKey, leagueRosterPlayers, leagueTradeBlockPlayers, leagueValueCurve, scoringValueByPlayerKey, sideBIsAvailable, sideBIsTradeBlock, sideBTeam?.team_uid]);
  const sideACashValue = parseTradeCash(tradeSideACash);
  const sideBCashValue = parseTradeCash(tradeSideBCash);
  const sideASelectedRows = selectedTradeRows(sideAPlayers, tradeSideAPlayerKeys);
  const sideBSelectedRows = selectedTradeRows(sideBPlayers, tradeSideBPlayerKeys);
  const sideADropRows = selectedTradeRows(sideAPlayers, tradeSideADropPlayerKeys);
  const sideBDropRows = selectedTradeRows(sideBPlayers, tradeSideBDropPlayerKeys);
  const tradeImpactProposal = useMemo<TradeImpactProposal>(() => ({
    leagueUid: selectedLeagueUid,
    myDrops: sideADropRows,
    myTeamRows: sideAPlayers,
    myTeamUid: myTeam?.team_uid || "",
    partnerTeamUid: sideBIsAvailable
      ? AVAILABLE_TEAM_UID
      : sideBIsTradeBlock
        ? TRADE_BLOCK_TEAM_UID
        : sideBTeam?.team_uid || "",
    playersGiven: sideASelectedRows,
    playersReceived: sideBSelectedRows,
    season: new Date().getFullYear()
  }), [
    myTeam?.team_uid,
    selectedLeagueUid,
    sideADropRows,
    sideAPlayers,
    sideASelectedRows,
    sideBIsAvailable,
    sideBIsTradeBlock,
    sideBSelectedRows,
    sideBTeam?.team_uid
  ]);
  // Phase 10.3 binds this prepared controller to the visible action and inline result.
  // Proposal changes only update its fingerprint; owner-team requests remain user-triggered by run().
  const impactAnalysis = useTradeImpactAnalysis(tradeImpactProposal, TRADE_IMPACT_DATA_DEPENDENCIES);
  const tradeAnalysis = analyzeTrade({
    cashReceived: sideBCashValue,
    cashSent: sideACashValue,
    myDrops: sideADropRows,
    opponentDrops: sideBDropRows,
    playersGiven: sideASelectedRows,
    playersReceived: sideBSelectedRows
  });
  const sideATotal = tradeAnalysis.given;
  const sideBTotal = tradeAnalysis.received;
  const sideADropsNeeded = Math.max(0, sideBSelectedRows.length - sideASelectedRows.length);
  const sideBDropsNeeded = sideBUsesAggregateList ? 0 : Math.max(0, sideASelectedRows.length - sideBSelectedRows.length);
  const sideACapProjection = buildCapProjection(myTeam, tradeAnalysis.myRosterImpact);
  const sideBCapProjection = sideBUsesAggregateList
    ? emptyCapProjection()
    : buildCapProjection(sideBTeam, tradeAnalysis.opponentRosterImpact);
  const dynastyResult = tradeAnalysis.dynastyResult;
  const scoringResult = tradeAnalysis.scoringResult;
  const unresolvedImpactCuts = Math.max(0, sideADropsNeeded - sideADropRows.length);
  const impactPlayerSelectionCount = sideASelectedRows.length + sideBSelectedRows.length;
  const impactDisabledReason = !myTeam
    ? "Set My Team for this league before running Impact Analysis."
    : impactPlayerSelectionCount === 0
      ? "Select at least one player to evaluate lineup impact."
      : unresolvedImpactCuts > 0
        ? `Select ${unresolvedImpactCuts} more ${unresolvedImpactCuts === 1 ? "cut" : "cuts"} for your roster before running Impact Analysis.`
        : null;
  const impactLoading = impactAnalysis.state.status === "loading";
  const tradeHasAnySelection = Boolean(
    tradeSideAPlayerKeys.length ||
    tradeSideBPlayerKeys.length ||
    tradeSideADropPlayerKeys.length ||
    tradeSideBDropPlayerKeys.length ||
    sideACashValue ||
    sideBCashValue
  );

  function clearTrade() {
    impactAnalysis.reset();
    setTradeSideAPlayerKeys([]);
    setTradeSideBPlayerKeys([]);
    setTradeSideADropPlayerKeys([]);
    setTradeSideBDropPlayerKeys([]);
    setTradeSideACash("");
    setTradeSideBCash("");
  }

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
            <span>Your Team</span>
            <strong>{myTeam?.team_name || "-"}</strong>
          </div>
          <select
            className="select-control"
            value={sideBIsAvailable ? AVAILABLE_TEAM_UID : sideBIsTradeBlock ? TRADE_BLOCK_TEAM_UID : sideBTeam?.team_uid || ""}
            onChange={(event) => setTradeSideBTeamUid(event.target.value)}
            aria-label="Trade partner or target pool"
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
                aria-pressed={active}
              >
                {sourceTag}
              </button>
            );
          })}
        </div>
        <button className="button ghost trade-clear-button" disabled={!tradeHasAnySelection} onClick={clearTrade} type="button">
          <Trash2 size={15} />
          Clear Trade
        </button>
      </section>

      <section className="trade-side-grid">
        <TradeSidePanel
          allowCash={!sideBIsAvailable}
          allowSend={!sideBIsAvailable}
          capProjection={sideACapProjection}
          cashSent={tradeSideACash}
          dropRows={sideADropRows}
          dropsNeeded={sideADropsNeeded}
          rows={sideAPlayers}
          selectedDropPlayerKeys={tradeSideADropPlayerKeys}
          selectedPlayerKeys={tradeSideAPlayerKeys}
          selectedRows={sideASelectedRows}
          setCashSent={setTradeSideACash}
          setSelectedDropPlayerKeys={setTradeSideADropPlayerKeys}
          setSelectedPlayerKeys={setTradeSideAPlayerKeys}
          sideLabel="You Give"
          sendLabel="Give"
          teamName={myTeam?.team_name || "-"}
          total={sideATotal}
        />
        <TradeSidePanel
          allowCash={!sideBUsesAggregateList}
          allowDrop={!sideBUsesAggregateList}
          capProjection={sideBCapProjection}
          cashSent={tradeSideBCash}
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
          sideLabel={sideBIsAvailable ? "Available Pickups" : sideBIsTradeBlock ? "Trade Block Targets" : `You Get from ${sideBTeam?.team_name || "Trade Partner"}`}
          sendLabel="Get"
          teamName={sideBIsAvailable ? "Available" : sideBIsTradeBlock ? "League Trade Block" : sideBTeam?.team_name || "-"}
          total={sideBTotal}
        />
      </section>

      <TradeRosterMovesRequired
        myDropsNeeded={sideADropsNeeded}
        myDropRows={sideADropRows}
        onRemoveMyDrop={(playerKey) => setTradeSideADropPlayerKeys(tradeSideADropPlayerKeys.filter((key) => key !== playerKey))}
        onRemoveOpponentDrop={(playerKey) => setTradeSideBDropPlayerKeys(tradeSideBDropPlayerKeys.filter((key) => key !== playerKey))}
        opponentDropsNeeded={sideBDropsNeeded}
        opponentDropRows={sideBDropRows}
        opponentName={sideBTeam?.team_name || "Trade partner"}
        showOpponent={!sideBUsesAggregateList}
      />

      <section aria-busy={impactLoading} className="trade-result-panel">
        <div className="trade-result-heading">
          <div>
            <p className="eyebrow">Result</p>
            <h2>{combinedTradeLabel(dynastyResult, scoringResult)}</h2>
          </div>
          <div className="trade-result-actions">
            <span className={`trade-result-badge ${dynastyResult.close || scoringResult.close ? "close" : ""}`}>
              Dy. {tradeResultNetBadge(dynastyResult)} / Sc. {tradeResultNetBadge(scoringResult)}
            </span>
            <button
              aria-describedby={impactDisabledReason ? "trade-impact-disabled-reason" : undefined}
              className="button primary trade-impact-action"
              disabled={Boolean(impactDisabledReason) || impactLoading}
              onClick={() => void impactAnalysis.run()}
              type="button"
            >
              <Target size={16} />
              {impactLoading
                ? "Analyzing Impact..."
                : impactAnalysis.state.result
                  ? "Rerun Impact Analysis"
                  : "Impact Analysis"}
            </button>
            {impactDisabledReason && (
              <small className="trade-impact-disabled-reason" id="trade-impact-disabled-reason">
                {impactDisabledReason}
              </small>
            )}
          </div>
        </div>
        <div className="trade-perspective-grid">
          <TradePerspectiveCard label="Dynasty" result={dynastyResult} />
          <TradePerspectiveCard label="Scoring" result={scoringResult} />
        </div>
        <TradeLedger
          capProjection={sideACapProjection}
          cutsNeeded={sideADropsNeeded}
          cutsSelected={sideADropRows.length}
          given={sideATotal}
          received={sideBTotal}
        />
        <TradeSourceVerdict
          consensusComplete={dynastyResult.complete}
          consensusNet={dynastyResult.knownNetToYou}
          exchangedPlayerCount={sideATotal.count + sideBTotal.count}
          sourceNetRange={tradeAnalysis.dynastySourceNetRange}
          threshold={dynastyResult.threshold}
        />
        {impactLoading && (
          <div aria-live="polite" className="trade-impact-request-state loading" role="status">
            <RefreshCcw className="spin" size={17} />
            Loading cached lineups, pitcher usage, and your saved pitching plan...
          </div>
        )}
        {impactAnalysis.state.status === "error" && (
          <div aria-live="assertive" className="trade-impact-request-state error" role="alert">
            <AlertCircle size={17} />
            <span>
              <strong>Impact Analysis could not run.</strong>
              {impactAnalysis.state.error || "Request failed."}
            </span>
          </div>
        )}
        {impactAnalysis.state.result && (
          <>
            {impactAnalysis.state.stale && (
              <div aria-live="polite" className="trade-impact-stale shared" role="status">
                <AlertCircle size={17} />
                <span><strong>Proposal changed.</strong> These results describe the prior package. Rerun Impact Analysis.</span>
              </div>
            )}
            <TradeHitterImpactPanel
              dropPlayerKeys={tradeSideADropPlayerKeys}
              impact={impactAnalysis.state.result.hitterImpact}
              outgoingPlayerKeys={tradeSideAPlayerKeys}
              warnings={impactAnalysis.state.result.warnings}
            />
            <TradePitcherImpactPanel
              dropPlayerKeys={tradeSideADropPlayerKeys}
              impact={impactAnalysis.state.result.pitcherImpact}
              outgoingPlayerKeys={tradeSideAPlayerKeys}
              warnings={impactAnalysis.state.result.warnings}
            />
          </>
        )}
      </section>
    </main>
  );
}

function TradePerspectiveCard({
  label,
  result
}: {
  label: string;
  result: TradeResult;
}) {
  return (
    <div className="trade-perspective-card">
      <span>{label}</span>
      <strong>{result.label}</strong>
      <em>{result.badge}</em>
      <p>{result.copy}</p>
    </div>
  );
}

function TradeHitterImpactPanel({
  dropPlayerKeys,
  impact,
  outgoingPlayerKeys,
  warnings
}: {
  dropPlayerKeys: string[];
  impact: HitterTradeImpact;
  outgoingPlayerKeys: string[];
  warnings: TradeImpactWarning[];
}) {
  const dropKeys = new Set(dropPlayerKeys);
  const outgoingKeys = new Set(outgoingPlayerKeys);
  const hitterWarnings = warnings.filter((warning) =>
    warning.code === "available-hitter-limited" || warning.code === "missing-optimal-lineup-player"
  );
  const movements = uniqueHitterImpactMovements([
    ...impact.newStarters,
    ...impact.displacedStarters,
    ...impact.changedAssignments,
    ...impact.rosterExits,
    ...impact.rosterArrivals
  ]);
  const positionDeltas = impact.positionDeltas.filter((delta) => hitterPositionChanged(delta));
  const metricRows: Array<{
    after: number | null;
    before: number | null;
    delta: number | null;
    digits: number;
    label: string;
    positiveIsGood: boolean | null;
  }> = [
    {
      after: impact.after.summary.lineupPpg,
      before: impact.before.summary.lineupPpg,
      delta: impact.summaryDelta.lineupPpg,
      digits: 2,
      label: "12-position P/G",
      positiveIsGood: true
    },
    {
      after: impact.after.summary.filledSlots,
      before: impact.before.summary.filledSlots,
      delta: impact.summaryDelta.filledSlots,
      digits: 0,
      label: "Filled lineup slots",
      positiveIsGood: true
    },
    {
      after: impact.after.summary.lineupSeasonPoints,
      before: impact.before.summary.lineupSeasonPoints,
      delta: impact.summaryDelta.lineupSeasonPoints,
      digits: 1,
      label: "Lineup season points",
      positiveIsGood: true
    },
    {
      after: impact.after.summary.averageWrcPlus,
      before: impact.before.summary.averageWrcPlus,
      delta: impact.summaryDelta.averageWrcPlus,
      digits: 1,
      label: "Average wRC+",
      positiveIsGood: true
    },
    {
      after: impact.after.summary.averageStarterAge,
      before: impact.before.summary.averageStarterAge,
      delta: impact.summaryDelta.averageStarterAge,
      digits: 1,
      label: "Average starter age",
      positiveIsGood: null
    },
    {
      after: impact.after.summary.benchCount,
      before: impact.before.summary.benchCount,
      delta: impact.summaryDelta.benchCount,
      digits: 0,
      label: "Bench bats",
      positiveIsGood: null
    },
    {
      after: impact.after.summary.averageBenchPpg,
      before: impact.before.summary.averageBenchPpg,
      delta: impact.summaryDelta.averageBenchPpg,
      digits: 2,
      label: "Average bench P/G",
      positiveIsGood: true
    }
  ];

  return (
    <section aria-labelledby="trade-hitter-impact-heading" className="trade-hitter-impact">
      <div className="trade-impact-heading">
        <div>
          <p className="eyebrow">Hitter Lineup Impact</p>
          <h3 id="trade-hitter-impact-heading">{hitterImpactHeadline(impact)}</h3>
          <p>
            Same best-case optimizer as Optimal Lineup. Injured MLB hitters remain eligible; MiLB hitters do not.
          </p>
        </div>
        <a className="button ghost trade-impact-link" href="#/optimal-lineup">
          <ExternalLink size={15} />
          Open Optimal Lineup
        </a>
      </div>

      <div aria-label="Hitter lineup impact metrics" className="trade-impact-metric-wrap" tabIndex={0}>
        <table className="trade-impact-metric-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>Before</th>
              <th>After</th>
              <th>Delta</th>
            </tr>
          </thead>
          <tbody>
            {metricRows.map((metric) => (
              <tr key={metric.label}>
                <th scope="row">{metric.label}</th>
                <td data-label="Before">{formatImpactMetric(metric.before, metric.digits)}</td>
                <td data-label="After">{formatImpactMetric(metric.after, metric.digits)}</td>
                <td data-label="Delta">
                  <ImpactMetricDelta
                    digits={metric.digits}
                    positiveIsGood={metric.positiveIsGood}
                    value={metric.delta}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="trade-impact-position-summary" aria-label="Position strength summary">
        <TradeImpactPositionFact label="Strongest" before={impact.before.strongestPosition} after={impact.after.strongestPosition} />
        <TradeImpactPositionFact label="Weakest" before={impact.before.weakestPosition} after={impact.after.weakestPosition} />
        <TradeImpactPositionFact label="Deepest" before={impact.before.deepestPosition} after={impact.after.deepestPosition} />
        <TradeImpactPositionFact label="Thinnest" before={impact.before.thinnestPosition} after={impact.after.thinnestPosition} />
      </div>

      <div className="trade-impact-subsection">
        <div className="trade-impact-subheading">
          <div>
            <p className="eyebrow">Lineup Movement</p>
            <h4>Who starts, moves, or leaves</h4>
          </div>
          <span>{movements.length} change{movements.length === 1 ? "" : "s"}</span>
        </div>
        {movements.length ? (
          <div className="trade-impact-movement-grid">
            {movements.map((movement) => (
              <TradeHitterMovementCard
                dropKeys={dropKeys}
                key={`${movement.player.row.player_key}:${movement.beforeRole}:${movement.beforeSlot}:${movement.afterRole}:${movement.afterSlot}`}
                movement={movement}
                outgoingKeys={outgoingKeys}
              />
            ))}
          </div>
        ) : (
          <p className="trade-impact-empty">The optimized hitter lineup and bench assignments do not change.</p>
        )}
      </div>

      <div className="trade-impact-subsection">
        <div className="trade-impact-subheading">
          <div>
            <p className="eyebrow">Position Map</p>
            <h4>Starter quality and depth changes</h4>
          </div>
          <span>{positionDeltas.length} affected</span>
        </div>
        {positionDeltas.length ? (
          <div className="trade-impact-position-grid">
            {positionDeltas.map((delta) => <TradeHitterPositionDeltaCard delta={delta} key={delta.position} />)}
          </div>
        ) : (
          <p className="trade-impact-empty">No material starter-quality or depth score changes.</p>
        )}
      </div>

      {(hitterWarnings.length > 0 || impact.after.summary.limitedConfidenceCount > 0) && (
        <div className="trade-impact-warning" role="note">
          <Info size={17} />
          <div>
            <strong>Limited hitter data</strong>
            <ul>
              {hitterWarnings.map((warning) => <li key={`${warning.code}:${warning.playerKey}`}>{warning.message}</li>)}
            </ul>
          </div>
        </div>
      )}
      <p className="trade-impact-method-note">
        Catcher uses two lineup boxes sharing one 162-game cap, exactly as on Optimal Lineup. An unfilled slot remains visible in the filled-slot total rather than being estimated away.
      </p>
    </section>
  );
}

function TradeHitterMovementCard({
  dropKeys,
  movement,
  outgoingKeys
}: {
  dropKeys: Set<string>;
  movement: HitterImpactMovement;
  outgoingKeys: Set<string>;
}) {
  const playerKey = movement.player.row.player_key;
  const label = hitterMovementLabel(movement, outgoingKeys, dropKeys);
  return (
    <article className={`trade-impact-movement-card ${hitterMovementTone(movement)}`}>
      <div className="trade-impact-movement-card-heading">
        <div>
          <span>{label}</span>
          <strong>{movement.player.row.player_name}</strong>
        </div>
        <RosterStatusBadge mlbTeam={movement.player.row.mlb_team} status={movement.player.row.status} />
      </div>
      <div className="trade-impact-role-change">
        <span>{formatHitterImpactRole(movement.beforeRole, movement.beforeSlot)}</span>
        <ArrowLeftRight aria-hidden="true" size={15} />
        <strong>{formatHitterImpactRole(movement.afterRole, movement.afterSlot)}</strong>
      </div>
      <dl className="trade-impact-player-metrics">
        <div><dt>P/G</dt><dd>{formatImpactMetric(movement.player.row.points_per_game, 2)}</dd></div>
        <div><dt>wRC+</dt><dd>{formatImpactMetric(movement.player.row.wrc_plus, 1)}</dd></div>
        <div><dt>Age</dt><dd>{formatImpactMetric(movement.player.age, 1)}</dd></div>
      </dl>
      {movement.player.dataQuality === "ppg-only" && (
        <em>{typeof movement.player.row.points_per_game !== "number" || !Number.isFinite(movement.player.row.points_per_game) ? "Limited lineup data" : "P/G-only estimate"}</em>
      )}
      <span className="sr-only">Player key {playerKey}</span>
    </article>
  );
}

function TradeHitterPositionDeltaCard({ delta }: { delta: HitterPositionDelta }) {
  return (
    <article className="trade-impact-position-card">
      <strong>{delta.position}</strong>
      <div>
        <span>Starter</span>
        <b>{strengthTierLabel(delta.beforeStarterTier)} to {strengthTierLabel(delta.afterStarterTier)}</b>
        <ImpactMetricDelta digits={2} positiveIsGood={true} value={delta.starterScoreDelta} />
      </div>
      <div>
        <span>Depth</span>
        <b>{depthTierLabel(delta.beforeDepthTier)} to {depthTierLabel(delta.afterDepthTier)}</b>
        <ImpactMetricDelta digits={2} positiveIsGood={true} value={delta.depthScoreDelta} />
      </div>
    </article>
  );
}

function TradeImpactPositionFact({ label, before, after }: { label: string; before: string | null; after: string | null }) {
  const changed = before !== after;
  return (
    <div className={changed ? "changed" : ""}>
      <span>{label}</span>
      <strong>{before || "-"} {changed ? `to ${after || "-"}` : ""}</strong>
    </div>
  );
}

function ImpactMetricDelta({
  digits,
  positiveIsGood,
  prefix = "",
  value
}: {
  digits: number;
  positiveIsGood: boolean | null;
  prefix?: string;
  value: number | null;
}) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return <span className="trade-impact-delta missing">-</span>;
  }
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const quality = positiveIsGood === null || value === 0
    ? "neutral"
    : (value > 0) === positiveIsGood
      ? "positive"
      : "negative";
  const formatted = `${sign}${prefix}${Math.abs(value).toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  })}`;
  const interpretation = quality === "positive"
    ? "favorable change"
    : quality === "negative"
      ? "unfavorable change"
      : value === 0
        ? "no change"
        : "neutral change";
  return (
    <span aria-label={`${formatted}; ${interpretation}`} className={`trade-impact-delta ${quality}`}>
      {formatted}
    </span>
  );
}

function hitterImpactHeadline(impact: HitterTradeImpact) {
  const ppgDelta = impact.summaryDelta.lineupPpg;
  const starterChangeKeys = new Set([
    ...impact.newStarters.map((movement) => movement.player.row.player_key),
    ...impact.displacedStarters.map((movement) => movement.player.row.player_key),
    ...impact.changedAssignments.map((movement) => movement.player.row.player_key)
  ]);
  const direction = Math.abs(ppgDelta) < 0.005
    ? "Your optimal hitter lineup P/G is unchanged"
    : ppgDelta > 0
      ? `You gain ${Math.abs(ppgDelta).toFixed(2)} optimal lineup P/G`
      : `You lose ${Math.abs(ppgDelta).toFixed(2)} optimal lineup P/G`;
  const starterCopy = `${starterChangeKeys.size} starter ${starterChangeKeys.size === 1 ? "change" : "changes"}`;
  return `${direction} with ${starterCopy}.`;
}

function hitterMovementLabel(
  movement: HitterImpactMovement,
  outgoingKeys: Set<string>,
  dropKeys: Set<string>
) {
  const playerKey = movement.player.row.player_key;
  if (movement.afterRole === "off-roster") {
    if (dropKeys.has(playerKey)) return "Cut from roster";
    if (outgoingKeys.has(playerKey)) return "Given away";
    return "Leaves roster";
  }
  if (movement.beforeRole === "off-roster") {
    return movement.afterRole === "starter" ? "Incoming starter" : "Incoming depth";
  }
  if (movement.beforeRole === "bench" && movement.afterRole === "starter") return "Promoted to starter";
  if (movement.beforeRole === "starter" && movement.afterRole === "bench") return "Displaced to bench";
  if (movement.beforeSlot !== movement.afterSlot) return "Reassigned starter";
  return "Lineup change";
}

function hitterMovementTone(movement: HitterImpactMovement) {
  if (movement.afterRole === "starter" && movement.beforeRole !== "starter") return "positive";
  if (movement.beforeRole === "starter" && movement.afterRole !== "starter") return "negative";
  if (movement.afterRole === "off-roster") return "exit";
  return "neutral";
}

function formatHitterImpactRole(role: HitterImpactMovement["beforeRole"], slot: string | null) {
  if (role === "off-roster") return "Off roster";
  if (role === "bench") return "Bench";
  return slot ? `Starter - ${slot}` : "Starter";
}

function formatImpactMetric(value: number | null | undefined, digits: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  });
}

function uniqueHitterImpactMovements(movements: HitterImpactMovement[]) {
  const byIdentity = new Map<string, HitterImpactMovement>();
  for (const movement of movements) {
    const identity = [
      movement.player.row.player_key,
      movement.beforeRole,
      movement.beforeSlot || "",
      movement.afterRole,
      movement.afterSlot || ""
    ].join(":");
    byIdentity.set(identity, movement);
  }
  return [...byIdentity.values()].sort((left, right) => {
    const roleOrder = (movement: HitterImpactMovement) => {
      if (movement.afterRole === "starter" && movement.beforeRole !== "starter") return 0;
      if (movement.beforeRole === "starter" && movement.afterRole === "bench") return 1;
      if (movement.afterRole === "off-roster") return 2;
      return 3;
    };
    return roleOrder(left) - roleOrder(right) || left.player.row.player_name.localeCompare(right.player.row.player_name);
  });
}

function hitterPositionChanged(delta: HitterPositionDelta) {
  return (
    delta.beforeStarterTier !== delta.afterStarterTier ||
    delta.beforeDepthTier !== delta.afterDepthTier ||
    Math.abs(delta.starterScoreDelta || 0) >= 0.01 ||
    Math.abs(delta.depthScoreDelta || 0) >= 0.01
  );
}
function TradePitcherImpactPanel({
  dropPlayerKeys,
  impact,
  outgoingPlayerKeys,
  warnings
}: {
  dropPlayerKeys: string[];
  impact: PitcherTradeImpact;
  outgoingPlayerKeys: string[];
  warnings: TradeImpactWarning[];
}) {
  const bucketOrder: PitcherImpactBucket[] = ["SP", "BUBBLE", "RP"];
  const dropKeys = new Set(dropPlayerKeys);
  const outgoingKeys = new Set(outgoingPlayerKeys);
  const pitcherWarnings = warnings.filter((warning) =>
    warning.code === "available-pitcher-usage-unavailable" ||
    warning.code === "missing-pitcher-usage-player" ||
    warning.code === "pitcher-usage-unavailable"
  );
  const movements = uniquePitcherImpactMovements([
    ...impact.entersPlan,
    ...impact.bucketChanges,
    ...impact.leavesPlan,
    ...impact.rosterExits,
    ...impact.rosterArrivals
  ]);
  const warningItems = pitcherImpactWarningItems(impact, pitcherWarnings);

  return (
    <section aria-labelledby="trade-pitcher-impact-heading" className="trade-pitcher-impact">
      <div className="trade-impact-heading">
        <div>
          <p className="eyebrow">Pitching Plan Impact</p>
          <h3 id="trade-pitcher-impact-heading">{pitcherImpactHeadline(impact)}</h3>
          <p>
            Uses your saved targets and manual overrides. Effective usage follows manual override, observed FanGraphs role, then position eligibility.
          </p>
        </div>
        <a className="button ghost trade-impact-link" href="#/pitchers">
          <ExternalLink size={15} />
          Open Pitchers
        </a>
      </div>

      <div className="trade-pitcher-bucket-grid">
        {bucketOrder.map((bucket) => (
          <TradePitcherBucketCard
            after={impact.after.summaries[bucket]}
            before={impact.before.summaries[bucket]}
            bucket={bucket}
            key={bucket}
            players={impact.after.buckets[bucket]}
          />
        ))}
      </div>

      <div className="trade-impact-subsection">
        <div className="trade-impact-subheading">
          <div>
            <p className="eyebrow">Plan Movement</p>
            <h4>Who enters, shifts buckets, or leaves</h4>
          </div>
          <span>{movements.length} change{movements.length === 1 ? "" : "s"}</span>
        </div>
        {movements.length ? (
          <div className="trade-impact-movement-grid trade-pitcher-movement-grid">
            {movements.map((movement) => (
              <TradePitcherMovementCard
                dropKeys={dropKeys}
                key={`${movement.player.row.player_key}:${movement.beforeRoster}:${movement.beforeBucket}:${movement.afterRoster}:${movement.afterBucket}`}
                movement={movement}
                outgoingKeys={outgoingKeys}
              />
            ))}
          </div>
        ) : (
          <p className="trade-impact-empty">The Confirmed SP, SP Bubble, and RP assignments do not change.</p>
        )}
      </div>

      {warningItems.length > 0 && (
        <div className="trade-impact-warning" role="note">
          <Info size={17} />
          <div>
            <strong>Limited pitching data</strong>
            <ul>
              {warningItems.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </div>
        </div>
      )}
      <p className="trade-impact-method-note">
        Buckets are re-ranked from current scoring value, then P/IP, then dynasty value. This shows plan quality and displacement; it does not forecast weekly starts or matchups.
      </p>
    </section>
  );
}

function TradePitcherBucketCard({
  after,
  before,
  bucket,
  players
}: {
  after: PitcherBucketSummary;
  before: PitcherBucketSummary;
  bucket: PitcherImpactBucket;
  players: PitcherImpactPlayer[];
}) {
  const label = formatPitcherImpactBucket(bucket);
  const metricRows: Array<{
    after: string;
    before: string;
    delta: number | null;
    digits: number;
    label: string;
    prefix?: string;
  }> = [
    {
      after: `${after.count} / ${after.target}`,
      before: `${before.count} / ${before.target}`,
      delta: after.count - before.count,
      digits: 0,
      label: "Plan slots"
    },
    {
      after: formatPitcherImpactMetric(after.averagePip, 2),
      before: formatPitcherImpactMetric(before.averagePip, 2),
      delta: subtractImpactMetric(after.averagePip, before.averagePip),
      digits: 2,
      label: "Average P/IP"
    },
    {
      after: formatPitcherImpactMetric(after.seasonPoints, 1),
      before: formatPitcherImpactMetric(before.seasonPoints, 1),
      delta: after.seasonPoints - before.seasonPoints,
      digits: 1,
      label: "Season points"
    },
    {
      after: formatPitcherImpactMetric(after.scoringValue, 1, "$"),
      before: formatPitcherImpactMetric(before.scoringValue, 1, "$"),
      delta: after.scoringValue - before.scoringValue,
      digits: 1,
      label: "Scoring value",
      prefix: "$"
    },
    {
      after: formatPitcherImpactMetric(after.dynastyValue, 1, "$"),
      before: formatPitcherImpactMetric(before.dynastyValue, 1, "$"),
      delta: after.dynastyValue - before.dynastyValue,
      digits: 1,
      label: "Dynasty value",
      prefix: "$"
    }
  ];
  const dataNotes = pitcherBucketDataNotes(after);

  return (
    <article className={`trade-pitcher-bucket-card ${bucket.toLowerCase()}`}>
      <div className="trade-pitcher-bucket-heading">
        <div>
          <p className="eyebrow">{bucket === "SP" ? "Rotation" : bucket === "BUBBLE" ? "Decisions" : "Bullpen"}</p>
          <h4>{label}</h4>
        </div>
        <strong>{after.count} / {after.target}</strong>
      </div>
      <div aria-label={`${label} before after and delta metrics`} className="trade-pitcher-bucket-metric-wrap" tabIndex={0}>
        <table className="trade-pitcher-bucket-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>Before</th>
              <th>After</th>
              <th>Delta</th>
            </tr>
          </thead>
          <tbody>
            {metricRows.map((metric) => (
              <tr key={metric.label}>
                <th scope="row">{metric.label}</th>
                <td>{metric.before}</td>
                <td>{metric.after}</td>
                <td>
                  <ImpactMetricDelta
                    digits={metric.digits}
                    positiveIsGood={true}
                    prefix={metric.prefix}
                    value={metric.delta}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="trade-pitcher-after-plan">
        <span>After trade</span>
        {players.length ? (
          <ol>
            {players.map((player, index) => (
              <li key={player.row.player_key}>
                <span>{index + 1}</span>
                <strong>{player.row.player_name}</strong>
                <em>{pitcherImpactQualityBasis(player)}</em>
              </li>
            ))}
          </ol>
        ) : (
          <p>No pitcher fills this bucket.</p>
        )}
      </div>
      {dataNotes.length > 0 && (
        <p className="trade-pitcher-bucket-note">After trade: {dataNotes.join("; ")}.</p>
      )}
    </article>
  );
}

function TradePitcherMovementCard({
  dropKeys,
  movement,
  outgoingKeys
}: {
  dropKeys: Set<string>;
  movement: PitcherImpactMovement;
  outgoingKeys: Set<string>;
}) {
  const player = movement.player;
  const playerKey = player.row.player_key;
  const usage = effectivePitcherUsage(player);
  const label = pitcherImpactMovementLabel(movement, outgoingKeys, dropKeys);
  return (
    <article className={`trade-impact-movement-card trade-pitcher-movement-card ${pitcherImpactMovementTone(movement)}`}>
      <div className="trade-impact-movement-card-heading">
        <div>
          <span>{label}</span>
          <strong>{player.row.player_name}</strong>
        </div>
        <RosterStatusBadge mlbTeam={player.row.mlbTeam} status={player.row.status} />
      </div>
      <div className="trade-impact-role-change">
        <span>{formatPitcherImpactState(movement.beforeRoster, movement.beforeBucket)}</span>
        <ArrowLeftRight aria-hidden="true" size={15} />
        <strong>{formatPitcherImpactState(movement.afterRoster, movement.afterBucket)}</strong>
      </div>
      <dl className="trade-impact-player-metrics four">
        <div><dt>P/IP</dt><dd>{formatImpactMetric(player.row.pointsPerIp, 2)}</dd></div>
        <div><dt>Points</dt><dd>{formatImpactMetric(player.row.seasonPoints, 1)}</dd></div>
        <div><dt>Sc. Value</dt><dd>{formatPitcherImpactMetric(player.row.scoredValue, 1, "$")}</dd></div>
        <div><dt>Dy. Value</dt><dd>{formatPitcherImpactMetric(player.row.value, 1, "$")}</dd></div>
      </dl>
      <div className="trade-pitcher-usage-line">
        <span>Effective <strong>{formatPitcherImpactUsage(usage.role, usage.bucket)}</strong></span>
        <span>Observed <strong>{player.observedRole || "Unavailable"}</strong></span>
        <em className={usage.source}>{pitcherImpactUsageSourceLabel(usage.source)}</em>
      </div>
      <span className="sr-only">Player key {playerKey}</span>
    </article>
  );
}

function pitcherImpactHeadline(impact: PitcherTradeImpact) {
  const scoringDelta = (["SP", "BUBBLE", "RP"] as PitcherImpactBucket[])
    .reduce((total, bucket) => total + impact.summaryDelta[bucket].scoringValue, 0);
  const enteringCount = new Set(impact.entersPlan.map((movement) => movement.player.row.player_key)).size;
  const leavingCount = new Set([
    ...impact.leavesPlan.map((movement) => movement.player.row.player_key),
    ...impact.rosterExits
      .filter((movement) => movement.beforeBucket !== null)
      .map((movement) => movement.player.row.player_key)
  ]).size;
  const bucketChangeCount = new Set(impact.bucketChanges.map((movement) => movement.player.row.player_key)).size;
  const valueCopy = Math.abs(scoringDelta) < 0.05
    ? "Known planned scoring value is unchanged"
    : scoringDelta > 0
      ? `Known planned scoring value rises ${formatPitcherImpactMetric(Math.abs(scoringDelta), 1, "$")}`
      : `Known planned scoring value falls ${formatPitcherImpactMetric(Math.abs(scoringDelta), 1, "$")}`;
  const changes = [
    enteringCount ? `${enteringCount} pitcher${enteringCount === 1 ? " enters" : "s enter"}` : "",
    leavingCount ? `${leavingCount} ${leavingCount === 1 ? "leaves" : "leave"}` : "",
    bucketChangeCount ? `${bucketChangeCount} change${bucketChangeCount === 1 ? "s" : ""} buckets` : ""
  ].filter(Boolean);
  return changes.length
    ? `${valueCopy}; ${sentenceList(changes)}.`
    : `${valueCopy}; bucket assignments are unchanged.`;
}

function pitcherImpactMovementLabel(
  movement: PitcherImpactMovement,
  outgoingKeys: Set<string>,
  dropKeys: Set<string>
) {
  const playerKey = movement.player.row.player_key;
  if (!movement.afterRoster) {
    if (dropKeys.has(playerKey)) return "Cut from roster";
    if (outgoingKeys.has(playerKey)) return "Given away";
    return "Leaves roster";
  }
  if (!movement.beforeRoster) {
    return movement.afterBucket
      ? `Incoming ${formatPitcherImpactBucket(movement.afterBucket)}`
      : "Incoming depth";
  }
  if (movement.beforeBucket && movement.afterBucket && movement.beforeBucket !== movement.afterBucket) {
    return `Moves ${formatPitcherImpactBucket(movement.beforeBucket)} to ${formatPitcherImpactBucket(movement.afterBucket)}`;
  }
  if (!movement.beforeBucket && movement.afterBucket) {
    return `Enters ${formatPitcherImpactBucket(movement.afterBucket)}`;
  }
  if (movement.beforeBucket && !movement.afterBucket) {
    return `Displaced from ${formatPitcherImpactBucket(movement.beforeBucket)}`;
  }
  return "Pitching plan change";
}

function pitcherImpactMovementTone(movement: PitcherImpactMovement) {
  if (!movement.afterRoster) return "exit";
  if (!movement.beforeBucket && movement.afterBucket) return "positive";
  if (movement.beforeBucket && !movement.afterBucket) return "negative";
  return "neutral";
}

function formatPitcherImpactState(rostered: boolean, bucket: PitcherImpactBucket | null) {
  if (!rostered) return "Off roster";
  return bucket ? formatPitcherImpactBucket(bucket) : "Outside plan";
}

function formatPitcherImpactBucket(bucket: PitcherImpactBucket) {
  if (bucket === "SP") return "Confirmed SP";
  if (bucket === "BUBBLE") return "SP Bubble";
  return "RP";
}

function formatPitcherImpactUsage(role: PitcherUsageRole | null, bucket: "SP" | "RP" | null) {
  if (role) return role;
  return bucket ? `${bucket} eligibility` : "Unavailable";
}

function pitcherImpactUsageSourceLabel(source: ReturnType<typeof effectivePitcherUsage>["source"]) {
  if (source === "manual-override") return "Manual override";
  if (source === "observed") return "Observed usage";
  if (source === "eligibility-fallback") return "Eligibility fallback";
  return "Usage unavailable";
}

function pitcherImpactQualityBasis(player: PitcherImpactPlayer) {
  if (typeof player.row.scoredValue === "number" && Number.isFinite(player.row.scoredValue)) return "Scoring value";
  if (typeof player.row.pointsPerIp === "number" && Number.isFinite(player.row.pointsPerIp)) return "P/IP fallback";
  if (typeof player.row.value === "number" && Number.isFinite(player.row.value)) return "Dynasty fallback";
  return "No quality metric";
}

function pitcherBucketDataNotes(summary: PitcherBucketSummary) {
  const notes: string[] = [];
  if (summary.limitedUsageCount) notes.push(`${summary.limitedUsageCount} limited usage`);
  if (summary.qualityFallbackCount) notes.push(`${summary.qualityFallbackCount} quality fallback`);
  if (summary.seasonPointsMissingCount) notes.push(`${summary.seasonPointsMissingCount} points missing`);
  if (summary.scoringMissingCount) notes.push(`${summary.scoringMissingCount} scoring value missing`);
  if (summary.dynastyMissingCount) notes.push(`${summary.dynastyMissingCount} dynasty value missing`);
  return notes;
}

function pitcherImpactWarningItems(impact: PitcherTradeImpact, warnings: TradeImpactWarning[]) {
  const items = warnings.map((warning) => warning.message);
  if (impact.skippedMilbIncoming.length) {
    items.push(`${impact.skippedMilbIncoming.map((player) => player.row.player_name).join(", ")} ${impact.skippedMilbIncoming.length === 1 ? "is" : "are"} MiLB and excluded from the current MLB pitching plan.`);
  }
  if (impact.after.unclassified.length) {
    items.push(`${impact.after.unclassified.map((player) => player.row.player_name).join(", ")} could not be assigned because usable role and position eligibility are unavailable.`);
  }
  const afterSummaries = (["SP", "BUBBLE", "RP"] as PitcherImpactBucket[])
    .map((bucket) => impact.after.summaries[bucket]);
  const limitedUsageCount = afterSummaries.reduce((total, summary) => total + summary.limitedUsageCount, 0);
  const qualityFallbackCount = afterSummaries.reduce((total, summary) => total + summary.qualityFallbackCount, 0);
  const scoringMissingCount = afterSummaries.reduce((total, summary) => total + summary.scoringMissingCount, 0);
  if (limitedUsageCount) {
    items.push(`${limitedUsageCount} planned pitcher${limitedUsageCount === 1 ? " uses" : "s use"} eligibility or unavailable usage rather than an observed role.`);
  }
  if (qualityFallbackCount) {
    items.push(`${qualityFallbackCount} planned pitcher${qualityFallbackCount === 1 ? " is" : "s are"} ranked by P/IP or dynasty value because scoring value is unavailable.`);
  }
  if (scoringMissingCount) {
    items.push(`${scoringMissingCount} planned pitcher${scoringMissingCount === 1 ? " has" : "s have"} missing scoring value, so scoring totals are known-value totals.`);
  }
  return [...new Set(items)];
}

function formatPitcherImpactMetric(value: number | null | undefined, digits: number, prefix = "") {
  const formatted = formatImpactMetric(value, digits);
  return formatted === "-" ? formatted : `${prefix}${formatted}`;
}

function subtractImpactMetric(after: number | null, before: number | null) {
  if (typeof after !== "number" || !Number.isFinite(after) || typeof before !== "number" || !Number.isFinite(before)) {
    return null;
  }
  return after - before;
}

function sentenceList(parts: string[]) {
  if (parts.length <= 1) return parts[0] || "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function uniquePitcherImpactMovements(movements: PitcherImpactMovement[]) {
  const byIdentity = new Map<string, PitcherImpactMovement>();
  for (const movement of movements) {
    const identity = [
      movement.player.row.player_key,
      movement.beforeRoster,
      movement.beforeBucket || "",
      movement.afterRoster,
      movement.afterBucket || ""
    ].join(":");
    byIdentity.set(identity, movement);
  }
  return [...byIdentity.values()].sort((left, right) => {
    const movementOrder = (movement: PitcherImpactMovement) => {
      if (!movement.beforeBucket && movement.afterBucket) return 0;
      if (movement.beforeBucket && movement.afterBucket && movement.beforeBucket !== movement.afterBucket) return 1;
      if (movement.beforeBucket && !movement.afterBucket && movement.afterRoster) return 2;
      if (!movement.afterRoster) return 3;
      return 4;
    };
    return movementOrder(left) - movementOrder(right) || left.player.row.player_name.localeCompare(right.player.row.player_name);
  });
}
function TradePlayerSourceSpread({ row }: { row: TradePlayerRow }) {
  const range = tradePlayerValueRange(row);
  if (!row.sourceValues.length || range.minValue === null || range.maxValue === null) {
    return <span className="trade-spread-empty">No source values</span>;
  }
  const chartValues = [
    ...row.sourceValues.map((source) => source.value),
    ...(typeof row.value === "number" ? [row.value] : []),
    ...(typeof row.salary === "number" ? [row.salary] : [])
  ];
  const rawMin = Math.min(...chartValues);
  const rawMax = Math.max(...chartValues);
  const padding = Math.max(1, (rawMax - rawMin) * 0.08);
  const domainMin = rawMin - padding;
  const domainMax = rawMax + padding;
  const position = (value: number) => linearChartPercent(value, domainMin, domainMax);
  const summary = `${row.player_name} dynasty source range ${formatFantasyValue(range.minValue)} to ${formatFantasyValue(range.maxValue)} across ${row.sourceValues.length} sources. Aggregate consensus ${formatFantasyValue(row.value)}.${typeof row.salary === "number" ? ` Salary ${formatFantasyValue(row.salary)}.` : " Salary is not known."}`;

  return (
    <div className="trade-spread-cell">
      <div className="trade-spread-plot" aria-label={summary} role="img">
        <span className="trade-spread-axis" />
        <span
          className="trade-spread-range"
          style={{ left: `${position(range.minValue)}%`, width: `${Math.max(1, position(range.maxValue) - position(range.minValue))}%` }}
        />
        {row.sourceValues.map((source, index) => {
          const label = `${source.sourceName} (${source.shortName}): rank ${source.rank}, ${formatFantasyValue(source.value)}, ${source.sourceTag}, ${formatTradeSourceDate(source.sourceDate)}.`;
          return (
            <span
              aria-label={label}
              className={`trade-spread-source-dot source-tag-${sourceTagClass(source.sourceTag)}`}
              key={source.sourceId}
              role="img"
              style={{ left: `${position(source.value)}%`, top: `${7 + (index % 2) * 8}px` }}
              tabIndex={0}
              title={label}
            />
          );
        })}
        {typeof row.value === "number" && (
          <span
            aria-label={`Aggregate consensus dynasty value ${formatFantasyValue(row.value)}.`}
            className="trade-spread-consensus"
            role="img"
            style={{ left: `${position(row.value)}%` }}
            tabIndex={0}
            title={`Aggregate consensus - ${formatFantasyValue(row.value)}`}
          />
        )}
        {typeof row.salary === "number" && (
          <span
            aria-label={`Salary reference ${formatFantasyValue(row.salary)}.`}
            className="trade-spread-salary"
            role="img"
            style={{ left: `${position(row.salary)}%` }}
            tabIndex={0}
            title={`Salary - ${formatFantasyValue(row.salary)}`}
          />
        )}
      </div>
      <div className="trade-spread-meta">
        <span>{formatFantasyValue(range.minValue)} - {formatFantasyValue(range.maxValue)}</span>
        <small>{row.sourceValues.length} src</small>
      </div>
    </div>
  );
}

function linearChartPercent(value: number, domainMin: number, domainMax: number) {
  if (!Number.isFinite(value) || domainMax <= domainMin) return 50;
  return Math.max(3, Math.min(97, ((value - domainMin) / (domainMax - domainMin)) * 100));
}

function sourceTagClass(sourceTag: SourceTag) {
  return sourceTag.toLowerCase().replace(/[^a-z]+/g, "-").replace(/(^-|-$)/g, "");
}

function TradeSourceVerdict({
  consensusComplete,
  consensusNet,
  exchangedPlayerCount,
  sourceNetRange,
  threshold
}: {
  consensusComplete: boolean;
  consensusNet: number;
  exchangedPlayerCount: number;
  sourceNetRange: TradeSourceNetRange;
  threshold: number;
}) {
  const summary = summarizeTradeSourceVerdict(sourceNetRange, threshold);
  const sources = [...sourceNetRange.fullCoverageNets, ...sourceNetRange.partialCoverageNets];
  const plottedValues = sources.map((source) => Math.abs(source.netValue));
  if (consensusComplete && exchangedPlayerCount) plottedValues.push(Math.abs(consensusNet));
  const domain = Math.max(1, threshold * 1.2, ...plottedValues) * 1.1;
  const evenHalfWidth = Math.min(46, (threshold / domain) * 46);
  const hasFullCoverage = summary.fullCoverageCount > 0;
  const verdictTitle = exchangedPlayerCount === 0
    ? "No package source verdict yet"
    : hasFullCoverage
      ? `${summary.favorYouCount} favor you, ${summary.evenCount} even, ${summary.favorPartnerCount} favor the trade partner`
      : "No package source verdict is available";
  const officialRange = sourceNetRange.minNet === null || sourceNetRange.maxNet === null
    ? "No official full-coverage range"
    : `Official range ${formatSignedFantasyValue(sourceNetRange.minNet)} to ${formatSignedFantasyValue(sourceNetRange.maxNet)}`;

  return (
    <section className="trade-source-verdict" aria-label="Dynasty source verdict">
      <div className="trade-source-verdict-heading">
        <div>
          <p className="eyebrow">Dynasty Source Verdict</p>
          <h3>{verdictTitle}</h3>
        </div>
        <div className="trade-source-coverage">
          <strong>{summary.fullCoverageCount} full coverage</strong>
          <span>{summary.partialEstimateCount} partial {summary.partialEstimateCount === 1 ? "estimate" : "estimates"}</span>
        </div>
      </div>
      {exchangedPlayerCount === 0 ? (
        <p className="trade-source-empty">Select exchanged players to compare how the enabled dynasty sources value the package.</p>
      ) : (
        <>
          <div className="trade-source-chart" aria-label={`Centered net-to-you chart. ${verdictTitle}. ${officialRange}.`}>
            <div className="trade-source-even-zone" style={{ left: `${50 - evenHalfWidth}%`, width: `${evenHalfWidth * 2}%` }} />
            <div className="trade-source-zero-line" />
            {sources.map((source, index) => (
              <TradeSourceNetMarker
                domain={domain}
                index={index}
                key={source.sourceId}
                source={source}
              />
            ))}
            {consensusComplete && (
              <span
                aria-label={`Aggregate consensus: ${formatSignedFantasyValue(consensusNet)} net to you.`}
                className="trade-source-marker consensus"
                role="img"
                style={{ left: `${centeredChartPercent(consensusNet, domain)}%`, top: "15px" }}
                tabIndex={0}
                title={`Aggregate consensus - ${formatSignedFantasyValue(consensusNet)} net to you`}
              />
            )}
          </div>
          <div className="trade-source-axis" aria-hidden="true">
            <span>Favors trade partner</span>
            <strong>Even</strong>
            <span>Favors you</span>
          </div>
          <div className="trade-source-verdict-footer">
            <span>{officialRange}</span>
            <span>Consensus {consensusComplete ? formatSignedFantasyValue(consensusNet) : "incomplete"}</span>
          </div>
          <div className="trade-source-legend" aria-label="Source chart legend">
            <span><i className="source-legend-dot full" /> Full source</span>
            <span><i className="source-legend-dot partial" /> Partial estimate</span>
            <span><i className="source-legend-diamond" /> Consensus</span>
            <span className="trade-source-threshold">Even within {formatFantasyValue(threshold)}</span>
          </div>
        </>
      )}
    </section>
  );
}

function TradeSourceNetMarker({
  domain,
  index,
  source
}: {
  domain: number;
  index: number;
  source: TradeSourceNet;
}) {
  const missingCount = source.substitutedPlayerCount;
  const coverage = `covers ${source.coveredPlayerCount} of ${source.totalPlayerCount} exchanged players`;
  const substitution = missingCount
    ? ` ${missingCount} missing ${missingCount === 1 ? "player uses" : "players use"} aggregate consensus substitution.`
    : " Full package coverage.";
  const label = `${source.sourceName} (${source.shortName}): ${formatSignedFantasyValue(source.netValue)} net to you; ${coverage}.${substitution} ${source.sourceTag}; ${formatTradeSourceDate(source.sourceDate)}.`;
  return (
    <span
      aria-label={label}
      className={`trade-source-marker ${source.fullCoverage ? "full" : "partial"}`}
      role="img"
      style={{ left: `${centeredChartPercent(source.netValue, domain)}%`, top: `${32 + (index % 3) * 11}px` }}
      tabIndex={0}
      title={label}
    />
  );
}

function centeredChartPercent(value: number, domain: number) {
  if (!Number.isFinite(value) || domain <= 0) return 50;
  return Math.max(4, Math.min(96, 50 + (value / domain) * 46));
}

function TradeLedger({
  capProjection,
  cutsNeeded,
  cutsSelected,
  given,
  received
}: {
  capProjection: CapProjection;
  cutsNeeded: number;
  cutsSelected: number;
  given: TradeTotal;
  received: TradeTotal;
}) {
  const givenAverageAge = tradeAverageAge(given);
  const receivedAverageAge = tradeAverageAge(received);
  const ageNet = givenAverageAge === null || receivedAverageAge === null ? null : receivedAverageAge - givenAverageAge;
  const ageMissingCount = given.count - given.ageCount + received.count - received.ageCount;
  const salaryMissingCount = given.unknownSalaryCount + received.unknownSalaryCount;
  const pointsMissingCount = given.unknownSeasonPointsCount + received.unknownSeasonPointsCount;
  const cutsRemaining = Math.max(0, cutsNeeded - cutsSelected);

  return (
    <section className="trade-ledger">
      <div className="trade-ledger-heading">
        <div>
          <p className="eyebrow">Trade Ledger</p>
          <h3>Net to You</h3>
        </div>
        <span>Positive means more coming in; negative means more going out.</span>
      </div>
      <div aria-label="Trade ledger" className="trade-ledger-wrap" tabIndex={0}>
        <table className="trade-ledger-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>You Give</th>
              <th>You Get</th>
              <th>Net to You</th>
            </tr>
          </thead>
          <tbody>
            <TradeLedgerRow
              give={String(given.count)}
              get={String(received.count)}
              label="Players"
              net={<TradeLedgerNumberNet value={received.count - given.count} />}
            />
            <TradeLedgerRow
              give={formatTradeTotalSalary(given)}
              get={formatTradeTotalSalary(received)}
              label="Player Salary"
              net={<TradeLedgerMoneyNet note={salaryMissingCount ? `${salaryMissingCount} salary ${salaryMissingCount === 1 ? "is" : "values are"} TBD` : ""} value={received.salary - given.salary} />}
            />
            <TradeLedgerRow
              give={formatFantasyValue(given.cash)}
              get={formatFantasyValue(received.cash)}
              label="Cash"
              net={<TradeLedgerMoneyNet value={received.cash - given.cash} />}
            />
            <TradeLedgerRow
              give={formatTradeMetricPlayers(given.dynasty)}
              get={formatTradeMetricPlayers(received.dynasty)}
              label="Dynasty Value"
              net={<TradeLedgerMetricNet given={given.dynasty} received={received.dynasty} />}
            />
            <TradeLedgerRow
              give={formatTradeMetricSummary(given.dynastySurplus)}
              get={formatTradeMetricSummary(received.dynastySurplus)}
              label="Dynasty Surplus"
              net={<TradeLedgerMetricNet given={given.dynastySurplus} received={received.dynastySurplus} useKnownTotal />}
            />
            <TradeLedgerRow
              give={formatTradeMetricPlayers(given.scoring)}
              get={formatTradeMetricPlayers(received.scoring)}
              label="Scoring Value"
              net={<TradeLedgerMetricNet given={given.scoring} received={received.scoring} />}
            />
            <TradeLedgerRow
              give={formatTradeMetricSummary(given.scoringSurplus)}
              get={formatTradeMetricSummary(received.scoringSurplus)}
              label="Scoring Surplus"
              net={<TradeLedgerMetricNet given={given.scoringSurplus} received={received.scoringSurplus} useKnownTotal />}
            />
            <TradeLedgerRow
              give={formatTradeSeasonPointsTotal(given)}
              get={formatTradeSeasonPointsTotal(received)}
              label="Season Points"
              net={<TradeLedgerNumberNet note={pointsMissingCount ? `${pointsMissingCount} missing` : ""} suffix=" pts" value={received.seasonPoints - given.seasonPoints} />}
            />
            <TradeLedgerRow
              give={formatTradeAverageAge(given)}
              get={formatTradeAverageAge(received)}
              label="Average Age"
              net={<TradeLedgerNumberNet note={ageMissingCount ? `${ageMissingCount} age ${ageMissingCount === 1 ? "is" : "values are"} missing` : ""} suffix=" yrs" value={ageNet} />}
            />
            <TradeLedgerRow
              give={String(given.ilCount)}
              get={String(received.ilCount)}
              label="IL"
              net={<TradeLedgerNumberNet value={received.ilCount - given.ilCount} />}
            />
            <TradeLedgerRow
              give={String(given.milbCount)}
              get={String(received.milbCount)}
              label="MiLB"
              net={<TradeLedgerNumberNet value={received.milbCount - given.milbCount} />}
            />
          </tbody>
        </table>
      </div>
      <div className="trade-ledger-roster-summary" aria-label="Roster and cap consequences">
        <TradePackageMetric label="Roster Change" value={formatRosterCountChange(capProjection.rosterCountChange)} />
        <TradePackageMetric label="Projected Cap" value={formatProjectedCap(capProjection)} />
        <TradePackageMetric label="Cap Space" value={formatProjectedCapSpace(capProjection)} />
        <TradePackageMetric label="Salary Change" value={formatProjectedSalaryChange(capProjection)} />
        <TradePackageMetric
          label="Required Cuts"
          value={cutsNeeded ? `${cutsSelected}/${cutsNeeded} selected; ${cutsRemaining} remaining` : cutsSelected ? `${cutsSelected} optional selected` : "None"}
        />
      </div>
    </section>
  );
}

function TradeLedgerRow({
  give,
  get,
  label,
  net
}: {
  give: ReactNode;
  get: ReactNode;
  label: string;
  net: ReactNode;
}) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td data-label="You Give">{give}</td>
      <td data-label="You Get">{get}</td>
      <td className="trade-ledger-net" data-label="Net to You">{net}</td>
    </tr>
  );
}

function TradeLedgerMetricNet({
  given,
  received,
  useKnownTotal = false
}: {
  given: TradeMetricTotal;
  received: TradeMetricTotal;
  useKnownTotal?: boolean;
}) {
  const value = (useKnownTotal ? received.knownTotal : received.knownPlayerValue) - (useKnownTotal ? given.knownTotal : given.knownPlayerValue);
  const missingCount = given.missingCount + received.missingCount;
  const notApplicableCount = given.notApplicableCount + received.notApplicableCount;
  const qualifiers = [
    missingCount ? `${missingCount} missing` : "",
    notApplicableCount ? `${notApplicableCount} MiLB N/A` : ""
  ].filter(Boolean);
  return <TradeLedgerMoneyNet note={qualifiers.join("; ")} value={value} />;
}

function TradeLedgerMoneyNet({ note = "", value }: { note?: string; value: number }) {
  return (
    <span className="trade-ledger-net-value">
      {value === 0 ? <span className="signed-value neutral">$0</span> : <SignedValue value={value} />}
      {note && <small>{note}</small>}
    </span>
  );
}

function TradeLedgerNumberNet({
  note = "",
  suffix = "",
  value
}: {
  note?: string;
  suffix?: string;
  value: number | null;
}) {
  if (value === null || !Number.isFinite(value)) {
    return <span className="trade-ledger-net-value missing">-</span>;
  }
  const tone = value < 0 ? "negative" : value > 0 ? "positive" : "neutral";
  const sign = value > 0 ? "+" : "";
  return (
    <span className={`trade-ledger-net-value ${tone}`}>
      <strong>{sign}{formatDecimal(value)}{suffix}</strong>
      {note && <small>{note}</small>}
    </span>
  );
}

function TradeSidePanel({
  allowCash = true,
  allowDrop = true,
  allowSend = true,
  capProjection,
  cashSent,
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
  const [tableMode, setTableMode] = useState<TradeTableMode>("core");
  const [tradeSort, setTradeSort] = useState<TableSort>({ direction: "desc", key: "dyValue" });
  const remainingDropsNeeded = Math.max(0, dropsNeeded - dropRows.length);
  const selectedListTitle = sendLabel === "Give" ? "You Give" : "You Get";
  const tableColumnCount = tableMode === "core" ? 9 : 13;
  const showOwner = useMemo(() => new Set(rows.map((row) => row.ownerTeamUid).filter(Boolean)).size > 1, [rows]);
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
            {total.count} {sendLabel.toLowerCase()}, {allowDrop ? dropRows.length : 0} drop - {formatTradeTotalSalary(total)} salary - Dy. Val +/-{" "}
            <SignedValue value={completeTradeMetricValue(total.dynastySurplus)} />
          </span>
        </div>
        <div className="trade-side-value">
          <strong>{formatTradeMetricSummary(total.dynasty)}</strong>
          <span>Players {formatTradeMetricPlayers(total.dynasty)}</span>
          <span>Cash {formatFantasyValue(total.cash)}</span>
          <span>Dynasty {formatTradeMetricSummary(total.dynasty)}</span>
          <span>Sc. Val {formatTradeMetricSummary(total.scoring)}</span>
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
        <div className="segmented trade-table-mode" aria-label={`${sideLabel} table detail`}>
          <button aria-pressed={tableMode === "core"} className={tableMode === "core" ? "active" : ""} onClick={() => setTableMode("core")} type="button">
            Core
          </button>
          <button aria-pressed={tableMode === "full"} className={tableMode === "full" ? "active" : ""} onClick={() => setTableMode("full")} type="button">
            Full Stats
          </button>
        </div>
        <span className="trade-selection-count">
          {selectedRows.length} selected{allowDrop ? ` / ${dropRows.length} drops` : ""}
        </span>
        {allowDrop && dropsNeeded > 0 && (
          <span className={`drop-fit-badge ${remainingDropsNeeded ? "" : "complete"}`}>
            Taking on +{dropsNeeded} - {remainingDropsNeeded ? `drop ${remainingDropsNeeded} to fit` : "drops covered"}
          </span>
        )}
      </div>
      <div
        aria-label={`${sideLabel} player table; scroll horizontally for additional GM metrics`}
        className="trade-table-wrap"
        onScroll={tradeWindow.onScroll}
        tabIndex={0}
      >
        <table className={`trade-player-table ${tableMode === "core" ? "core" : "full"}`}>
          <thead>
            <tr>
              <th className="trade-action-col trade-give-col" rowSpan={2}>{sendLabel}</th>
              <th className="trade-action-col trade-drop-col" rowSpan={2}>Drop</th>
              <SortableHeader className="player-col trade-player-col" label="Player" rowSpan={2} sort={tradeSort} sortKey="player" setSort={setTradeSort} />
              <th className="group-header" colSpan={1}>Contract</th>
              <th className="group-header" colSpan={tableMode === "core" ? 3 : 4}>Dynasty</th>
              <th className="group-header" colSpan={tableMode === "core" ? 2 : 5}>Scoring</th>
            </tr>
            <tr>
              <SortableHeader label="Salary" sort={tradeSort} sortKey="salary" setSort={setTradeSort} defaultDirection="desc" />
              {tableMode === "full" && <SortableHeader label="Rank" sort={tradeSort} sortKey="dyAgg" setSort={setTradeSort} />}
              <SortableHeader label="Value" sort={tradeSort} sortKey="dyValue" setSort={setTradeSort} defaultDirection="desc" />
              <SortableHeader label="Surplus" sort={tradeSort} sortKey="dyDelta" setSort={setTradeSort} defaultDirection="desc" title="Dynasty value - salary" />
              <SortableHeader className="trade-spread-col" label="Spread" sort={tradeSort} sortKey="spread" setSort={setTradeSort} defaultDirection="desc" title="Dots are included sources; the diamond is aggregate consensus; the vertical tick is salary." />
              {tableMode === "full" && <SortableHeader label="Rank" sort={tradeSort} sortKey="scAgg" setSort={setTradeSort} />}
              <SortableHeader label="Value" sort={tradeSort} sortKey="scValue" setSort={setTradeSort} defaultDirection="desc" title="Scoring value from total-points rank fitted to the league salary curve." />
              <SortableHeader label="Surplus" sort={tradeSort} sortKey="scDelta" setSort={setTradeSort} defaultDirection="desc" title="Scoring value - salary" />
              {tableMode === "full" && <SortableHeader label="Points" sort={tradeSort} sortKey="points" setSort={setTradeSort} defaultDirection="desc" />}
              {tableMode === "full" && <SortableHeader label="P/G or P/IP" sort={tradeSort} sortKey="rate" setSort={setTradeSort} defaultDirection="desc" />}
            </tr>
          </thead>
          <tbody>
            {sortedRows.length ? (
              <>
                <TableSpacerRow colSpan={tableColumnCount} height={tradeWindow.beforeHeight} />
                {renderedRows.map((row) => {
              const selected = selectedPlayerKeySet.has(row.player_key);
              const dropSelected = selectedDropPlayerKeySet.has(row.player_key);
              return (
                <tr className={selected ? "selected" : dropSelected ? "drop-selected" : ""} key={row.player_key}>
                  <td className="trade-action-col trade-give-col">
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
                  <td className="trade-action-col trade-drop-col">
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
                  <td className="player-col trade-player-col">
                    <div className="trade-player-primary">
                      <strong>{row.player_name}</strong>
                      <RosterStatusBadge mlbTeam={row.mlbTeam} status={row.status} />
                    </div>
                    <span className="trade-player-meta">
                      {row.positions || "-"} / Age {row.age ?? "-"} / {row.mlbTeam || "FA"}{showOwner && row.ownerTeamName ? ` / ${row.ownerTeamName}` : ""}
                    </span>
                  </td>
                  <td>{formatTradeSalary(row.salary)}</td>
                  {tableMode === "full" && <td>{row.aggregate_rank ? `#${row.aggregate_rank}` : "-"}</td>}
                  <td>{formatFantasyValue(row.value)}</td>
                  <td><ValueMinusSalary value={row.value} salary={row.salary} /></td>
                  <td className="trade-spread-col">
                    <TradePlayerSourceSpread row={row} />
                  </td>
                  {tableMode === "full" && <td>{row.scoringRank ? `#${row.scoringRank}` : "-"}</td>}
                  <td>{formatFantasyValue(row.scoredValue)}</td>
                  <td><ValueMinusSalary value={row.scoredValue} salary={row.salary} /></td>
                  {tableMode === "full" && <td>{formatTradePoints(row)}</td>}
                  {tableMode === "full" && <td>{formatRate(row)}</td>}
                </tr>
              );
              })}
                <TableSpacerRow colSpan={tableColumnCount} height={tradeWindow.afterHeight} />
              </>
            ) : (
              <tr>
                <td className="empty-table-cell" colSpan={tableColumnCount}>No players match these filters.</td>
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
      <TradePackageTable
        emptyText="No players selected."
        onRemovePlayer={(playerKey) => setSelectedPlayerKeys(selectedPlayerKeys.filter((key) => key !== playerKey))}
        rows={selectedRows}
        title={selectedListTitle}
        total={total}
      />
    </article>
  );
}

function TradePackageTable({
  emptyText,
  onRemovePlayer,
  rows,
  title,
  total
}: {
  emptyText: string;
  onRemovePlayer: (playerKey: string) => void;
  rows: TradePlayerRow[];
  title: string;
  total: TradeTotal;
}) {
  return (
    <section className="trade-package">
      <div className="trade-package-heading">
        <span>{title}</span>
        <strong>{rows.length} {rows.length === 1 ? "player" : "players"}</strong>
      </div>
      {rows.length ? (
        <>
          <div aria-label={`${title} package table`} className="trade-package-wrap" tabIndex={0}>
            <table className="trade-package-table">
              <thead>
                <tr>
                  <th className="trade-package-player">Player</th>
                  <th>Salary</th>
                  <th>Dynasty Value</th>
                  <th>Dynasty Surplus</th>
                  <th>Dynasty Range</th>
                  <th>Scoring Value</th>
                  <th>Scoring Surplus</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const valueRange = tradePlayerValueRange(row);
                  return (
                    <tr key={row.player_key}>
                      <td className="trade-package-player">
                        <div className="trade-package-player-name">
                          <strong>{row.player_name}</strong>
                          <RosterStatusBadge mlbTeam={row.mlbTeam} status={row.status} />
                        </div>
                        <span>{row.positions || "-"} / Age {row.age ?? "-"}</span>
                      </td>
                      <td>{formatTradeSalary(row.salary)}</td>
                      <td>{formatFantasyValue(row.value)}</td>
                      <td><ValueMinusSalary value={row.value} salary={row.salary} /></td>
                      <td>{formatFantasyValue(valueRange.minValue)} - {formatFantasyValue(valueRange.maxValue)}</td>
                      <td>{formatFantasyValue(row.scoredValue)}</td>
                      <td><ValueMinusSalary value={row.scoredValue} salary={row.salary} /></td>
                      <td>
                        <button
                          aria-label={`Remove ${row.player_name} from ${title}`}
                          className="trade-package-remove"
                          onClick={() => onRemovePlayer(row.player_key)}
                          title={`Remove ${row.player_name}`}
                          type="button"
                        >
                          <X size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Package totals</th>
                  <td>{formatTradeTotalSalary(total)}</td>
                  <td>{formatTradeMetricPlayers(total.dynasty)}</td>
                  <td>{formatTradeMetricSummary(total.dynastySurplus)}</td>
                  <td><span className="not-additive" title="Individual source ranges are not additive.">Not additive</span></td>
                  <td>{formatTradeMetricPlayers(total.scoring)}</td>
                  <td>{formatTradeMetricSummary(total.scoringSurplus)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="trade-package-summary" aria-label={`${title} package composition`}>
            <TradePackageMetric label="Players" value={String(total.count)} />
            <TradePackageMetric label="Season Points" value={formatTradeSeasonPointsTotal(total)} />
            <TradePackageMetric label="Average Age" value={formatTradeAverageAge(total)} />
            <TradePackageMetric label="Hitters" value={String(total.hitterCount)} />
            <TradePackageMetric label="Pitchers" value={String(total.pitcherCount)} />
            <TradePackageMetric label="IL" value={String(total.ilCount)} />
            <TradePackageMetric label="MiLB" value={String(total.milbCount)} />
            <TradePackageMetric label="Suspended" value={String(total.suspendedCount)} />
          </div>
        </>
      ) : (
        <p className="trade-package-empty">{emptyText}</p>
      )}
    </section>
  );
}

function TradePackageMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TradeRosterMovesRequired({
  myDropsNeeded,
  myDropRows,
  onRemoveMyDrop,
  onRemoveOpponentDrop,
  opponentDropsNeeded,
  opponentDropRows,
  opponentName,
  showOpponent
}: {
  myDropsNeeded: number;
  myDropRows: TradePlayerRow[];
  onRemoveMyDrop: (playerKey: string) => void;
  onRemoveOpponentDrop: (playerKey: string) => void;
  opponentDropsNeeded: number;
  opponentDropRows: TradePlayerRow[];
  opponentName: string;
  showOpponent: boolean;
}) {
  const showMyMoves = myDropsNeeded > 0 || myDropRows.length > 0;
  const showOpponentMoves = showOpponent && (opponentDropsNeeded > 0 || opponentDropRows.length > 0);
  if (!showMyMoves && !showOpponentMoves) return null;

  return (
    <section className="trade-roster-moves">
      <div className="trade-roster-moves-heading">
        <div>
          <p className="eyebrow">Roster Moves Required</p>
          <h2>Cuts and roster feasibility</h2>
        </div>
        <strong>Outside trade fairness</strong>
      </div>
      <p className="trade-roster-moves-note">
        These cuts affect roster space, salary, and cap projections, but their value is not included in the dynasty or scoring fairness verdict.
      </p>
      <div className="trade-roster-moves-grid">
        {showMyMoves && (
          <TradeRosterMoveCard
            dropsNeeded={myDropsNeeded}
            dropRows={myDropRows}
            onRemoveDrop={onRemoveMyDrop}
            title="Your required cuts"
          />
        )}
        {showOpponentMoves && (
          <TradeRosterMoveCard
            dropsNeeded={opponentDropsNeeded}
            dropRows={opponentDropRows}
            onRemoveDrop={onRemoveOpponentDrop}
            title={`${opponentName} feasibility`}
          />
        )}
      </div>
    </section>
  );
}

function TradeRosterMoveCard({
  dropsNeeded,
  dropRows,
  onRemoveDrop,
  title
}: {
  dropsNeeded: number;
  dropRows: TradePlayerRow[];
  onRemoveDrop: (playerKey: string) => void;
  title: string;
}) {
  const dropTotal = useMemo(() => buildTradeTotal(dropRows), [dropRows]);
  const cutsRemaining = Math.max(0, dropsNeeded - dropRows.length);
  return (
    <article className="trade-roster-move-card">
      <div className="trade-roster-move-card-heading">
        <h3>{title}</h3>
        <div>
          <span>Required <strong>{dropsNeeded}</strong></span>
          <span>Selected <strong>{dropRows.length}</strong></span>
          <span>Remaining <strong>{cutsRemaining}</strong></span>
        </div>
      </div>
      {dropRows.length ? (
        <div aria-label={`${title} roster move table`} className="trade-roster-move-wrap" tabIndex={0}>
          <table className="trade-roster-move-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Salary Cleared</th>
                <th>Dynasty Lost</th>
                <th>Scoring Lost</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {dropRows.map((row) => (
                <tr key={row.player_key}>
                  <td>
                    <div className="trade-package-player-name">
                      <strong>{row.player_name}</strong>
                      <RosterStatusBadge mlbTeam={row.mlbTeam} status={row.status} />
                    </div>
                    <span>{row.positions || "-"} / Age {row.age ?? "-"}</span>
                  </td>
                  <td>{formatTradeSalary(row.salary)}</td>
                  <td>{formatFantasyValue(row.value)}</td>
                  <td>{formatFantasyValue(row.scoredValue)}</td>
                  <td>
                    <button
                      aria-label={`Remove ${row.player_name} from roster cuts`}
                      className="trade-package-remove"
                      onClick={() => onRemoveDrop(row.player_key)}
                      title={`Keep ${row.player_name}`}
                      type="button"
                    >
                      <X size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Value surrendered</th>
                <td>{formatTradeTotalSalary(dropTotal)}</td>
                <td>{formatTradeMetricPlayers(dropTotal.dynasty)}</td>
                <td>{formatTradeMetricPlayers(dropTotal.scoring)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <p className="trade-roster-move-empty">
          {cutsRemaining ? `Select ${cutsRemaining} ${cutsRemaining === 1 ? "cut" : "cuts"} from the roster table above.` : "No cuts selected."}
        </p>
      )}
    </article>
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

  if (capProjection.unknownSalaryCount) {
    return (
      <div className="trade-cap-summary">
        <div>
          <span>Current Cap</span>
          <strong>
            {formatMoney(capProjection.currentUsed)} of {formatMoney(capProjection.currentLimit)}
          </strong>
        </div>
        <div>
          <span>After Trade</span>
          <strong>Acquisition salary needed</strong>
        </div>
        <div className="trade-cap-space">
          <span>Cap Space</span>
          <strong>Pending {capProjection.unknownSalaryCount === 1 ? "bid" : `${capProjection.unknownSalaryCount} bids`}</strong>
        </div>
        <div>
          <span>Salary Change</span>
          <strong>{formatMoney(capProjection.knownSalaryChange)} known + {capProjection.unknownSalaryCount} TBD</strong>
        </div>
        <div>
          <span>Roster Change</span>
          <strong>{formatRosterCountChange(capProjection.rosterCountChange)}</strong>
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
      <div className="trade-cap-space">
        <span>Cap Space</span>
        <strong>{formatMoney(capProjection.capSpace)}</strong>
      </div>
      <div>
        <span>Salary Change</span>
        <strong><SignedValue value={capProjection.salaryChange} /></strong>
      </div>
      <div>
        <span>Roster Change</span>
        <strong>{formatRosterCountChange(capProjection.rosterCountChange)}</strong>
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
  setTeamUid,
  setToast,
  teamUid
}: {
  leagues: FantasyLeague[];
  myTeamUid: string;
  selectedLeague: FantasyLeague | null;
  selectedLeagueTeams: FantasyTeam[];
  selectedLeagueUid: string;
  setSelectedLeagueUid: (leagueUid: string) => void;
  setTeamUid: (teamUid: string) => void;
  setToast: ToastFn;
  teamUid: string;
}) {
  const myTeam = selectedLeagueTeams.find((team) => team.team_uid === myTeamUid) || null;
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

        <MetricRow
          className="optimal-lineup-summary"
          ready={rows.length > 0}
          metrics={[
            { label: "MLB hitters", value: rows.length.toLocaleString() },
            { label: "Filled slots", value: `${optimizer.starterCount}/${LINEUP_SLOTS.length}` },
            { label: "12-pos P/G", value: formatDecimal(optimizer.totalPoints) },
            { label: "Lineup Pts", value: formatDecimal(starterPoints) },
            { label: "Avg wRC+", value: formatWrcPlus(starterWrcPlus) },
            { label: "Bench bats", value: benchRows.length.toLocaleString() },
            { label: "Avg bench P/G", value: formatDecimal(benchPpg) },
            { label: "Strongest", value: strongestPosition?.position || "-" },
            { label: "Weakest", value: weakestPosition?.position || "-" },
            { label: "Deepest", value: deepestPosition?.position || "-" },
            { label: "Thinnest", value: thinnestPosition?.position || "-" }
          ]}
        />

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
  cloudRefreshBusy,
  leagues,
  myTeamUid,
  requestCloudRefresh,
  selectedLeague,
  selectedLeagueTeams,
  selectedLeagueUid,
  setSelectedLeagueUid,
  setTeamUid,
  setToast,
  teamUid
}: {
  cloudRefreshBusy: boolean;
  leagues: FantasyLeague[];
  myTeamUid: string;
  requestCloudRefresh: (scope: string) => Promise<boolean>;
  selectedLeague: FantasyLeague | null;
  selectedLeagueTeams: FantasyTeam[];
  selectedLeagueUid: string;
  setSelectedLeagueUid: (leagueUid: string) => void;
  setTeamUid: (teamUid: string) => void;
  setToast: ToastFn;
  teamUid: string;
}) {
  const myTeam = selectedLeagueTeams.find((team) => team.team_uid === myTeamUid) || null;
  const datesRequestedRef = useRef(false);
  const starterRequestRef = useRef(0);
  const [dateOptions, setDateOptions] = useState<LineupDateOption[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [rows, setRows] = useState<LineupRecommendationRow[]>([]);
  const [summary, setSummary] = useState<LineupRecommendationResponse | null>(null);
  const [lineupOptimizer, setLineupOptimizer] = useState<DailyLineupOptimizerResult | null>(null);
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
  const matchupCounts = useMemo(() => {
    return rows.reduce(
      (counts, row) => {
        const matchup = matchupAssessmentForLineupRow(row);
        counts[matchup.code] = (counts[matchup.code] || 0) + 1;
        return counts;
      },
      {} as Partial<Record<ReturnType<typeof matchupAssessmentForLineupRow>["code"], number>>
    );
  }, [rows]);

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
          setToast(`Pitcher plan database sync failed: ${errorMessage(error)} Using this browser's backup.`, "error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pitcherPlanStorageKey, selectedLeagueUid, selectedTeamUid, setToast]);

  // Dates are not league-specific, so pull them once when the screen opens. The ref keeps
  // StrictMode's double-invoke (and any re-render) from firing a second request.
  useEffect(() => {
    if (datesRequestedRef.current) return;
    datesRequestedRef.current = true;
    void fetchDates(false);
  }, []);

  // Whatever the date, team or league becomes, load the matching starter data for it.
  // This used to only clear the table and wait for a button press.
  useEffect(() => {
    setRows([]);
    setSummary(null);
    setLineupOptimizer(null);
    if (!selectedLeagueUid || !teamUid || !selectedDate) return;
    void getStarterData(false);
  }, [selectedDate, selectedLeagueUid, teamUid]);

  async function fetchDates(announce = true, requestedDate = selectedDate): Promise<string> {
    setBusy("dates");
    try {
      const visitorLocalDate = localIsoDate();
      const response = await fetchFunction<{ dates: LineupDateOption[] }>(
        "lineup-dates",
        buildLineupDatesQuery(visitorLocalDate, 10)
      );
      setDateOptions(response.dates);
      const nextDate = preferredLineupDate(response.dates, requestedDate, visitorLocalDate);
      setSelectedDate(nextDate);
      if (announce) setToast(response.dates.length ? "Available starter dates loaded." : "No starter dates found.", response.dates.length ? "success" : "info");
      else if (!response.dates.length) setToast("No starter dates found.", "info");
      return nextDate;
    } catch (error) {
      setToast(errorMessage(error), "error");
      return "";
    } finally {
      setBusy(null);
    }
  }

  async function getStarterData(announce = true, requestedDate = selectedDate) {
    if (!selectedLeagueUid || !teamUid || !requestedDate) return;
    // Changing the date twice quickly must not let the slower response win.
    const requestId = ++starterRequestRef.current;
    setBusy("starters");
    try {
      const params = new URLSearchParams({
        league_uid: selectedLeagueUid,
        team_uid: teamUid,
        date: requestedDate
      });
      const response = await fetchFunction<LineupRecommendationResponse>("lineup-recommendations", String(params));
      if (starterRequestRef.current !== requestId) return;
      setSummary(response);
      setRows(response.rows);
      setLineupOptimizer(null);
      if (announce) {
        setToast(
          `Starter data loaded for ${response.rows.length} active hitters and ${(response.pitcher_starts || []).length} probable pitchers on your team.`
        );
      }
    } catch (error) {
      if (starterRequestRef.current === requestId) setToast(errorMessage(error), "error");
    } finally {
      if (starterRequestRef.current === requestId) setBusy(null);
    }
  }

  async function refreshProbables() {
    await refreshLineupProbables(selectedDate, {
      requestCloudRefresh,
      reloadDates: (preferredDate) => fetchDates(false, preferredDate),
      reloadRecommendations: (date) => getStarterData(false, date)
    });
  }

  function optimizeSelectedLineup() {
    if (!rows.length) {
      setToast("Get starter data before optimizing the lineup.", "error");
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
      setToast(errorMessage(error), "error");
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
            return {
              ...item,
              always_start: alwaysStart,
              always_sit: nextAlwaysSit
            };
          })
        )
      );
      setLineupOptimizer(null);
      setToast(alwaysStart ? "Locked player saved. Re-run the optimizer to update slots." : "Locked player removed. Re-run the optimizer to update slots.");
    } catch (error) {
      setToast(errorMessage(error), "error");
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
            return {
              ...item,
              always_start: nextAlwaysStart,
              always_sit: alwaysSit
            };
          })
        )
      );
      setLineupOptimizer(null);
      setToast(alwaysSit ? "Sit preference saved. Re-run the optimizer to update slots." : "Sit preference removed. Re-run the optimizer to update slots.");
    } catch (error) {
      setToast(errorMessage(error), "error");
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
          <select className="select-control" value={selectedLeagueUid} onChange={(event) => setSelectedLeagueUid(event.target.value)} disabled={cloudRefreshBusy}>
            {leagues.map((league) => (
              <option key={league.league_uid} value={league.league_uid}>
                {league.league_name}
              </option>
            ))}
          </select>

          <label>Team</label>
          <select className="select-control" value={selectedTeam?.team_uid || ""} onChange={(event) => setTeamUid(event.target.value)} disabled={cloudRefreshBusy}>
            {selectedLeagueTeams.map((team) => (
              <option key={team.team_uid} value={team.team_uid}>
                {team.team_name}
              </option>
            ))}
          </select>

          <label>Date</label>
          <select
            className="select-control"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
            disabled={cloudRefreshBusy || !dateOptions.length}
          >
            {dateOptions.length ? (
              dateOptions.map((option) => (
                <option key={option.date} value={option.date}>
                  {formatPlainDate(option.date)} - {option.probable_starter_count}/{option.game_count * 2} starters
                </option>
              ))
            ) : (
              <option value="">{busy === "dates" ? "Loading dates..." : "No dates loaded"}</option>
            )}
          </select>

          {/* Queue the dedicated worker refresh, then reload both the date window and the
              recommendation response after the worker reports actual completion. */}
          <button
            aria-busy={cloudRefreshBusy || busy === "dates" || busy === "starters"}
            className="button ghost"
            type="button"
            onClick={refreshProbables}
            disabled={cloudRefreshBusy || busy !== null || !selectedLeagueUid || !teamUid || !selectedDate}
            title="Ask the home worker to refresh lineup data, wait for completion, then reload this date."
          >
            <RefreshCcw size={17} className={cloudRefreshBusy || busy === "dates" || busy === "starters" ? "spin" : ""} />
            {cloudRefreshBusy ? "Refreshing Probables..." : busy === "dates" || busy === "starters" ? "Reloading Probables..." : "Refresh Probables"}
          </button>

          <button
            className="button ghost"
            type="button"
            onClick={optimizeSelectedLineup}
            disabled={cloudRefreshBusy || busy !== null || !rows.length}
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
            <p className="lineup-action-help">
              Lock/Sit set constraints. <strong>Action</strong> is the optimizer's Start/Bench call. <strong>Matchup</strong> rates the probable pitchers and adjusts Est. Pts; it never replaces the action.
            </p>
          </div>
        </div>

        <MetricRow
          className="lineup-summary"
          ready={summary !== null}
          metrics={[
            { label: "Hitters", value: rows.length.toLocaleString() },
            { label: "Games", value: (summary?.game_count || 0).toLocaleString() },
            { label: "Probables", value: (summary?.probable_starter_count || 0).toLocaleString() },
            { label: "xFIP Cache", value: (summary?.xfip_refresh?.cached_row_count || 0).toLocaleString() },
            { label: "xFIP Live", value: (summary?.xfip_refresh?.live_row_count || 0).toLocaleString() },
            { label: "xFIP Missing", value: (summary?.xfip_refresh?.missing_row_count || 0).toLocaleString() },
            { label: "Starters", value: lineupOptimizer ? `${lineupOptimizer.starterCount}/${LINEUP_SLOTS.length}` : "-" },
            { label: "Opt Est Pts", value: lineupOptimizer ? formatDecimal(lineupOptimizer.totalPoints) : "-" },
            { label: "Favorable", value: (matchupCounts.favorable || 0).toLocaleString() },
            { label: "Tough", value: (matchupCounts.tough || 0).toLocaleString() },
            { label: "SP Start", value: pitcherDecisionCounts.start.toLocaleString() },
            { label: "SP Decide", value: pitcherDecisionCounts.decide.toLocaleString() }
          ]}
        />

        {summary && <LineupDataContext summary={summary} />}

        {lineupOptimizer?.missingSlotWarning && (
          <div className="lineup-notice danger" role="alert">
            {lineupOptimizer.missingSlotWarning}
          </div>
        )}

        {lineupOptimizer?.lockWarning && <div className="lineup-notice">{lineupOptimizer.lockWarning}</div>}

        {lineupOptimizer?.projectionWarning && <div className="lineup-notice">{lineupOptimizer.projectionWarning}</div>}

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
                  <th>Action</th>
                  <th className="player-col">Player</th>
                  <th>Pos</th>
                  <th>MLB</th>
                  <th>Salary</th>
                  <th>Pts</th>
                  <th>P/G</th>
                  <th title={`Sum of P/G multiplied by each scheduled game's xFIP- adjustment. Current factor: ${formatDecimal(xfipDeltaFactor)}.`}>Est. Pts</th>
                  <th>Opp</th>
                  <th className="player-col">Starter</th>
                  <th>xFIP-</th>
                  <th>Matchup</th>
                </tr>
              </thead>
              <tbody>
                {lineupDisplayRows.map(({ assignment, matchup, row }) => (
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
                      <LineupActionPill assignment={assignment} optimized={lineupOptimizer !== null} />
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
                    <td>
                      <LineupGameList row={row} render={(game) => game.opponent_team || "-"} />
                    </td>
                    <td className="player-col lineup-pitcher-cell">
                      <LineupGameList
                        row={row}
                        render={(game) => (
                          <>
                            <strong>{game.opposing_pitcher_name || "-"}</strong>
                            {game.opponent_name && <span>{game.opponent_name}</span>}
                          </>
                        )}
                      />
                    </td>
                    <td>
                      <LineupGameList
                        row={row}
                        render={(game) => <LineupXfipValue game={game} />}
                      />
                    </td>
                    <td>
                      <span className={`lineup-pill ${matchup.code}`}>{matchup.label}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-state">
              {busy === "dates"
                ? "Loading available dates..."
                : busy === "starters"
                  ? "Loading starter data..."
                  : !dateOptions.length
                    ? "No probable-starter dates are available right now."
                    : "No active hitters found for this team on this date."}
            </div>
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
                <th>Game</th>
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
                <tr className={`pitcher-decision-row ${row.decision}`} key={`${row.player_key}:${row.game_key || row.game_number}`}>
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
                  <td>{row.game_number ? `G${row.game_number}` : "-"}</td>
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
  requestCloudRefresh: (scope: string) => Promise<boolean>;
  refreshLeagueValueCurve: (leagueUid: string) => Promise<void>;
  selectedLeague: FantasyLeague | null;
  selectedLeagueTeams: FantasyTeam[];
  selectedLeagueUid: string;
  selectMyTeam: (leagueUid: string, teamUid: string) => void;
  setLeagueUrl: (url: string) => void;
  setToast: ToastFn;
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
      setToast(errorMessage(error), "error");
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
      setToast(errorMessage(error), "error");
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
      setToast(errorMessage(error), "error");
    } finally {
      setPlatformCurveLoading(false);
    }
  }

  async function updatePlatformCurve() {
    const sampleSize = Number(platformSampleSize);
    if (!Number.isInteger(sampleSize) || sampleSize < 1 || sampleSize > 500) {
      setToast("Sample size must be a whole number between 1 and 500.", "error");
      return;
    }
    setPlatformCurveLoading(true);
    try {
      const saved = await savePlatformValueCurveSettings(sampleSize);
      setPlatformData(saved);
      await requestCloudRefresh("platform");
      await refreshPlatformData();
    } catch (error) {
      setToast(errorMessage(error), "error");
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
// The same plot the Trade and Pickups tables use, drawn in ranks rather than dollars. The
// rankings board has no league salary curve unless a league is selected, and its neighbouring
// columns (Avg, Med, Spread) are all ranks, so ranks are the honest unit here.
//
// Rank 1 sits on the left, so a player the sources agree on shows a tight cluster and a
// contested one spreads wide.
function RankingSourceSpread({ player, sources }: { player: AggregatePlayer; sources: BoardSource[] }) {
  const ranked = sources.flatMap((source) => {
    const rank = player.source_ranks[source.id]?.rank;
    return typeof rank === "number" ? [{ rank, source }] : [];
  });
  if (!ranked.length) return <span className="trade-spread-empty">No source ranks</span>;

  const ranks = [...ranked.map((entry) => entry.rank), player.aggregate_rank];
  const rawMin = Math.min(...ranks);
  const rawMax = Math.max(...ranks);
  const padding = Math.max(1, (rawMax - rawMin) * 0.08);
  const position = (rank: number) => linearChartPercent(rank, rawMin - padding, rawMax + padding);
  const best = Math.min(...ranked.map((entry) => entry.rank));
  const worst = Math.max(...ranked.map((entry) => entry.rank));
  const summary = `${player.player_name} ranked #${best} to #${worst} across ${ranked.length} sources. Aggregate #${player.aggregate_rank}.`;

  return (
    <div className="trade-spread-cell">
      <div className="trade-spread-plot" aria-label={summary} role="img">
        <span className="trade-spread-axis" />
        <span
          className="trade-spread-range"
          style={{ left: `${position(best)}%`, width: `${Math.max(1, position(worst) - position(best))}%` }}
        />
        {ranked.map((entry, index) => {
          const label = `${entry.source.name} (${entry.source.short_name}): #${entry.rank}, ${entry.source.source_tag}.`;
          return (
            <span
              aria-label={label}
              className={`trade-spread-source-dot source-tag-${sourceTagClass(entry.source.source_tag)}`}
              key={entry.source.id}
              role="img"
              style={{ left: `${position(entry.rank)}%`, top: `${7 + (index % 2) * 8}px` }}
              tabIndex={0}
              title={label}
            />
          );
        })}
        <span
          aria-label={`Aggregate consensus rank ${player.aggregate_rank}.`}
          className="trade-spread-consensus"
          role="img"
          style={{ left: `${position(player.aggregate_rank)}%` }}
          tabIndex={0}
          title={`Aggregate consensus - #${player.aggregate_rank}`}
        />
      </div>
      <div className="trade-spread-meta">
        <span>#{best} - #{worst}</span>
        <small>{ranked.length} src</small>
      </div>
    </div>
  );
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
  showFantasyValue,
  spreadSources
}: {
  fantasyRoster: LeagueRosterPlayer | null;
  availableStats: LeagueAvailablePlayerStats | null;
  fantasyValue: number | null;
  groupedSources: { source_tag: SourceTag; sources: BoardSource[] }[];
  player: AggregatePlayer;
  scoringValue: ScoringValueMetric | null;
  spreadSources: BoardSource[];
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
      <td className="trade-spread-col">
        <RankingSourceSpread player={player} sources={spreadSources} />
      </td>
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

// A summary row that stays out of the way until it has something to say. Before `ready`
// only tiles marked `primary` render, so a screen you have not run yet does not spend a
// couple of hundred pixels of the fold on a grid of zeroes and dashes.
function MetricRow({
  className = "",
  metrics,
  ready
}: {
  className?: string;
  metrics: { label: string; value: string; primary?: boolean }[];
  ready: boolean;
}) {
  const shown = ready ? metrics : metrics.filter((metric) => metric.primary);
  if (!shown.length) return null;
  return (
    <div className={`board-summary ${className}`.trim()}>
      {shown.map((metric) => (
        <Metric key={metric.label} label={metric.label} value={metric.value} />
      ))}
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

// Placeholder rows at real row height, so a table does not appear out of a blank box and
// shove the page around once data lands.
function SkeletonRows({ columns, rows = 10 }: { columns: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <tr className="skeleton-row" key={rowIndex}>
          {Array.from({ length: Math.max(1, columns) }, (_, columnIndex) => (
            <td key={columnIndex}>
              <span className="skeleton-bar" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function TableEmptyRow({ children, colSpan }: { children: ReactNode; colSpan: number }) {
  return (
    <tr className="table-empty-row">
      <td colSpan={Math.max(1, colSpan)}>
        <div className="empty-state">{children}</div>
      </td>
    </tr>
  );
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

type TradeRowSeed = {
  playerKey: string;
  playerName: string;
  positions: string | null;
  status: string | null;
  ownerTeamName: string | null;
  ownerTeamUid: string | null;
  mlbTeam: string | null;
  section: "hitter" | "pitcher";
  salary: number | null;
  seasonPoints: number | null;
  pointsPerGame: number | null;
  pointsPerIp: number | null;
  ranking: AggregatePlayer | null;
  scoringValue: ScoringValueMetric | null;
};

function toTradeRow(
  seed: TradeRowSeed,
  leagueValueCurve: LeagueValueCurve | null,
  allowedSources: BoardSource[]
): TradePlayerRow {
  const value = seed.ranking && leagueValueCurve
    ? fittedFantasyValue(seed.ranking.aggregate_rank, leagueValueCurve)
    : null;
  const sourceValues: TradeSourceValue[] = seed.ranking && leagueValueCurve
    ? allowedSources.flatMap((source) => {
        const rank = seed.ranking?.source_ranks[source.id]?.rank;
        if (typeof rank !== "number") return [];
        return [{
          sourceId: source.id,
          sourceName: source.name,
          shortName: source.short_name,
          sourceTag: source.source_tag,
          sourceDate: source.source_date,
          rank,
          value: fittedFantasyValue(rank, leagueValueCurve)
        }];
      })
    : [];

  return {
    player_key: seed.playerKey,
    player_name: seed.playerName,
    positions: seed.positions,
    status: seed.status,
    ownerTeamName: seed.ownerTeamName,
    ownerTeamUid: seed.ownerTeamUid,
    mlbTeam: seed.mlbTeam,
    section: seed.section,
    age: seed.ranking?.age ?? null,
    salary: seed.salary,
    availabilityCodes: rosterAvailabilities(seed.mlbTeam, seed.status).map((availability) => availability.code),
    seasonPoints: seed.seasonPoints,
    pointsPerGame: seed.pointsPerGame,
    pointsPerIp: seed.pointsPerIp,
    aggregate_rank: seed.ranking?.aggregate_rank ?? null,
    scoringRank: seed.scoringValue?.rank ?? null,
    value,
    scoredValue: seed.scoringValue?.value ?? null,
    sourceValues
  };
}

function buildTradeRows(
  teamUid: string,
  rosterPlayers: LeagueRosterPlayer[],
  boardPlayerByKey: Map<string, AggregatePlayer>,
  leagueValueCurve: LeagueValueCurve | null,
  allowedSources: BoardSource[],
  scoringValueByPlayerKey: Map<string, ScoringValueMetric>
): TradePlayerRow[] {
  if (!teamUid) return [];
  return rosterPlayers
    .filter((player) => player.team_uid === teamUid)
    .map((player) => toTradeRow({
      playerKey: player.player_key,
      playerName: player.player_name,
      positions: player.positions,
      status: player.status,
      ownerTeamName: player.team_name,
      ownerTeamUid: player.team_uid,
      mlbTeam: player.mlb_team,
      section: player.section,
      salary: player.salary,
      seasonPoints: player.points,
      pointsPerGame: player.points_per_game,
      pointsPerIp: player.points_per_ip,
      ranking: boardPlayerByKey.get(player.player_key) || null,
      scoringValue: scoringValueByPlayerKey.get(player.player_key) || null
    }, leagueValueCurve, allowedSources))
    .sort((left, right) => {
      return (right.value || 0) - (left.value || 0) || (right.scoredValue || 0) - (left.scoredValue || 0) || (right.salary ?? 0) - (left.salary ?? 0) || left.player_name.localeCompare(right.player_name);
    });
}

function buildAvailableTradeRows(
  players: AggregatePlayer[],
  rosterPlayers: LeagueRosterPlayer[],
  leagueValueCurve: LeagueValueCurve | null,
  allowedSources: BoardSource[],
  availableStatsByPlayerKey: Map<string, LeagueAvailablePlayerStats>,
  availableScoringValueByPlayerKey: Map<string, ScoringValueMetric>
): TradePlayerRow[] {
  const rosteredPlayerKeys = new Set(rosterPlayers.map((player) => player.player_key));
  return players
    .filter((player) => !rosteredPlayerKeys.has(player.player_key))
    .map((player) => {
      const stats = availableStatsByPlayerKey.get(player.player_key) || null;
      return toTradeRow({
        playerKey: player.player_key,
        playerName: stats?.player_name || player.player_name,
        positions: stats?.positions || player.positions,
        status: stats?.status || null,
        ownerTeamName: null,
        ownerTeamUid: null,
        mlbTeam: stats?.mlb_team || player.team,
        section: stats?.section || playerSectionFromPositions(stats?.positions || player.positions),
        salary: null,
        seasonPoints: stats?.points ?? null,
        pointsPerGame: stats?.points_per_game ?? null,
        pointsPerIp: stats?.points_per_ip ?? null,
        ranking: player,
        scoringValue: availableScoringValueByPlayerKey.get(player.player_key) || null
      }, leagueValueCurve, allowedSources);
    })
    .sort((left, right) => {
      return (right.value || 0) - (left.value || 0) || (right.scoredValue || 0) - (left.scoredValue || 0) || left.player_name.localeCompare(right.player_name);
    });
}

// A player you can acquire right now, priced against what the league's own salary curve says
// their dynasty rank is worth. `surplus` is that value minus the cost, which is the number
// that actually answers "is this worth a bid".
type PickupRow = TradePlayerRow & {
  cost: number | null;
  cutBy: string | null;
  deadlineText: string | null;
  market: "auction" | "waiver";
  ottoneuPlayerId: number | null;
  surplus: number | null;
};

function buildPickupRows(
  entries: LeagueMarketEntry[],
  market: "auction" | "waiver",
  boardPlayerByKey: Map<string, AggregatePlayer>,
  leagueValueCurve: LeagueValueCurve | null,
  allowedSources: BoardSource[],
  availableStatsByPlayerKey: Map<string, LeagueAvailablePlayerStats>,
  availableScoringValueByPlayerKey: Map<string, ScoringValueMetric>
): PickupRow[] {
  return entries
    .filter((entry) => entry.market === market)
    .map((entry) => {
      const stats = availableStatsByPlayerKey.get(entry.player_key) || null;
      const ranking = boardPlayerByKey.get(entry.player_key) || null;
      const positions = entry.positions || stats?.positions || ranking?.positions || null;
      const row = toTradeRow({
        playerKey: entry.player_key,
        playerName: entry.player_name,
        positions,
        status: entry.status || stats?.status || null,
        ownerTeamName: null,
        ownerTeamUid: null,
        mlbTeam: entry.mlb_team || stats?.mlb_team || ranking?.team || null,
        section: stats?.section || playerSectionFromPositions(positions),
        salary: entry.amount,
        seasonPoints: stats?.points ?? null,
        pointsPerGame: stats?.points_per_game ?? null,
        pointsPerIp: stats?.points_per_ip ?? null,
        ranking,
        scoringValue: availableScoringValueByPlayerKey.get(entry.player_key) || null
      }, leagueValueCurve, allowedSources);
      return {
        ...row,
        cost: entry.amount,
        cutBy: entry.cut_by,
        deadlineText: entry.deadline_text,
        market: entry.market,
        ottoneuPlayerId: entry.ottoneu_player_id,
        // An unranked player has no modelled value, so surplus stays unknown rather than
        // reading as a loss equal to the asking price.
        surplus: row.value === null || entry.amount === null ? null : row.value - entry.amount
      };
    })
    .sort((left, right) => {
      if (left.surplus !== right.surplus) return (right.surplus ?? -Infinity) - (left.surplus ?? -Infinity);
      return (right.value || 0) - (left.value || 0) || left.player_name.localeCompare(right.player_name);
    });
}

function buildTradeBlockRows(
  players: LeagueTradeBlockPlayer[],
  boardPlayerByKey: Map<string, AggregatePlayer>,
  leagueValueCurve: LeagueValueCurve | null,
  allowedSources: BoardSource[],
  scoringValueByPlayerKey: Map<string, ScoringValueMetric>
): TradePlayerRow[] {
  return players
    .filter((player) => player.side === "have")
    .map((player) => toTradeRow({
      playerKey: player.player_key,
      playerName: player.player_name,
      positions: player.positions,
      status: player.status,
      ownerTeamName: player.team_name,
      ownerTeamUid: player.team_uid,
      mlbTeam: player.mlb_team,
      section: player.section,
      salary: player.salary,
      seasonPoints: player.points,
      pointsPerGame: player.points_per_game,
      pointsPerIp: player.points_per_ip,
      ranking: boardPlayerByKey.get(player.player_key) || null,
      scoringValue: scoringValueByPlayerKey.get(player.player_key) || null
    }, leagueValueCurve, allowedSources))
    .sort((left, right) => {
      return (right.value || 0) - (left.value || 0) || (right.scoredValue || 0) - (left.scoredValue || 0) || (right.salary ?? 0) - (left.salary ?? 0) || left.player_name.localeCompare(right.player_name);
    });
}

function playerSectionFromPositions(positions: string | null): "hitter" | "pitcher" {
  const tokens = expandedPositionTokens(positions);
  return tokens.has("P") && !tokens.has("UTI") ? "pitcher" : "hitter";
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
      return row.seasonPoints;
    case "rate":
      return row.pointsPerGame ?? row.pointsPerIp;
    case "dyValue":
      return row.value;
    case "scValue":
      return row.scoredValue;
    case "dyDelta":
      return typeof row.value === "number" && typeof row.salary === "number" ? row.value - row.salary : null;
    case "scDelta":
      return typeof row.scoredValue === "number" && typeof row.salary === "number" ? row.scoredValue - row.salary : null;
    case "dyMin":
      return tradePlayerValueRange(row).minValue;
    case "dyMax":
      return tradePlayerValueRange(row).maxValue;
    case "spread":
      return tradePlayerValueRange(row).spread;
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
  impact: TradeRosterImpact
): CapProjection {
  const currentUsed = typeof team?.last_cap_used === "number" ? team.last_cap_used : null;
  const currentLimit = typeof team?.last_cap_limit === "number" ? team.last_cap_limit : null;
  if (currentUsed === null || currentLimit === null) {
    return {
      currentLimit,
      currentUsed,
      capSpace: null,
      knownSalaryChange: impact.knownSalaryChange,
      overCap: false,
      projectedLimit: null,
      projectedUsed: null,
      rosterCountChange: impact.rosterCountChange,
      salaryChange: impact.salaryChange,
      unknownSalaryCount: impact.unknownSalaryCount
    };
  }

  const projectedLimit = currentLimit + impact.capLimitChange;
  if (impact.unknownSalaryCount) {
    return {
      capSpace: null,
      currentLimit,
      currentUsed,
      knownSalaryChange: impact.knownSalaryChange,
      overCap: false,
      projectedLimit,
      projectedUsed: null,
      rosterCountChange: impact.rosterCountChange,
      salaryChange: impact.salaryChange,
      unknownSalaryCount: impact.unknownSalaryCount
    };
  }

  const projectedUsed = currentUsed + impact.knownSalaryChange;
  return {
    capSpace: projectedLimit - projectedUsed,
    currentLimit,
    currentUsed,
    knownSalaryChange: impact.knownSalaryChange,
    overCap: projectedUsed > projectedLimit,
    projectedLimit,
    projectedUsed,
    rosterCountChange: impact.rosterCountChange,
    salaryChange: impact.salaryChange,
    unknownSalaryCount: impact.unknownSalaryCount
  };
}

function emptyCapProjection(): CapProjection {
  return {
    capSpace: null,
    currentLimit: null,
    currentUsed: null,
    knownSalaryChange: 0,
    overCap: false,
    projectedLimit: null,
    projectedUsed: null,
    rosterCountChange: 0,
    salaryChange: 0,
    unknownSalaryCount: 0
  };
}

function parseTradeCash(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function combinedTradeLabel(dynastyResult: TradeResult, scoringResult: TradeResult) {
  if (dynastyResult.label === "Select Players" && scoringResult.label === "Select Players") return "Build a Trade";
  if (!dynastyResult.complete || !scoringResult.complete) return "Incomplete Data";
  if (dynastyResult.winner === scoringResult.winner) {
    if (dynastyResult.winner === "You") return "Both Views Favor You";
    if (dynastyResult.winner === "Trade Partner") return "Both Views Favor Trade Partner";
    return "Trade Looks Even";
  }
  return "Split Result";
}

function tradeResultNetBadge(result: TradeResult) {
  if (result.label === "Select Players") return "Awaiting package";
  if (!result.complete) return `${result.missingCount} missing`;
  return `${result.knownNetToYou === 0 ? "$0" : formatValueDelta(result.knownNetToYou)} to you`;
}

function toggleKey(values: string[], key: string) {
  return values.includes(key) ? values.filter((value) => value !== key) : [...values, key];
}

function isLocalBackendAvailable() {
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
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

// Sources-screen writes that touch only the database (no scraping). Routing these through
// Edge Functions is what lets the deployed Pages build change them from anywhere — a relative
// /api POST there hits GitHub's static host, which answers 405.
async function saveSourceTag(sourceId: string, sourceTag: SourceTag) {
  try {
    return await fetchFunction<SourceSettingsResponse>("source-settings", "", "POST", {
      source_id: sourceId,
      source_tag: sourceTag
    });
  } catch (error) {
    if (!isLocalBackendAvailable()) throw error;
    return postJson<SourceSettingsResponse>(`/api/sources/${encodeURIComponent(sourceId)}/tag`, {
      source_tag: sourceTag
    });
  }
}

async function saveSourceIncluded(sourceId: string, included: boolean) {
  try {
    return await fetchFunction<SourceSettingsResponse>("source-settings", "", "POST", {
      included,
      source_id: sourceId
    });
  } catch (error) {
    if (!isLocalBackendAvailable()) throw error;
    return postJson<SourceSettingsResponse>(`/api/sources/${encodeURIComponent(sourceId)}/included`, { included });
  }
}

async function saveSourceCsvImport(sourceId: string, csvText: string) {
  try {
    return await fetchFunction<UpdateResult>("source-import", "", "POST", {
      csv_text: csvText,
      source_id: sourceId
    });
  } catch (error) {
    if (!isLocalBackendAvailable()) throw error;
    return postJson<UpdateResult>(`/api/sources/${encodeURIComponent(sourceId)}/import`, { csv_text: csvText });
  }
}

async function savePlayerNameCorrectionRemote(sourceId: string, originalName: string, correctedName: string) {
  const body = { corrected_name: correctedName, original_name: originalName, source_id: sourceId };
  try {
    return await fetchFunction<PlayerNameCorrectionResponse>("player-name-correction", "", "POST", body);
  } catch (error) {
    if (!isLocalBackendAvailable()) throw error;
    return postJson<PlayerNameCorrectionResponse>("/api/player-name-corrections", body);
  }
}

async function deletePlayerNameCorrectionRemote(correctionId: number) {
  try {
    return await fetchFunction<{ correction_id: number; status: "success" }>("player-name-correction", "", "POST", {
      action: "delete",
      correction_id: correctionId
    });
  } catch (error) {
    if (!isLocalBackendAvailable()) throw error;
    return deleteJson<{ correction_id: number; status: "success" }>(`/api/player-name-corrections/${correctionId}`);
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

// ── Bookmarkable rankings view ───────────────────────────────────────────────
// The hash carried only the tool, so a reload dropped every filter and a filtered
// board could not be linked or kept. Only non-default values are written, which keeps
// a default board at a bare "#/rankings".

type RankingsViewState = {
  fantasyTeamFilter: string;
  fantraxFormat: "roto" | "points";
  includedSourceTags: SourceTag[];
  leagueOverlayEnabled: boolean;
  maxAge: string;
  minAge: string;
  minSources: number;
  positionFilter: PositionFilter;
  query: string;
  rankingSort: TableSort;
  rosterTagFilter: RosterTagFilter;
  selectedLeagueUid: string;
  tdgFormat: "obp" | "points";
};

// Built in the browser rather than fetched from /api/import-template.csv, which the static
// Pages build cannot serve.
const CSV_IMPORT_TEMPLATE = "rank,player,team,position,age\n1,Shohei Ohtani,LAD,UT/P,31.6\n2,Juan Soto,NYM,OF,27.3\n";

const DEFAULT_INCLUDED_SOURCE_TAGS: SourceTag[] = ["Continuous", "Updated"];
const DEFAULT_RANKING_SORT: TableSort = { direction: "asc", key: "dyAgg" };

function sameTagSet(left: SourceTag[], right: SourceTag[]) {
  return left.length === right.length && left.every((tag) => right.includes(tag));
}

function rankingsViewToQuery(view: RankingsViewState): string {
  const params = new URLSearchParams();
  if (view.query.trim()) params.set("q", view.query.trim());
  if (view.minAge) params.set("minAge", view.minAge);
  if (view.maxAge) params.set("maxAge", view.maxAge);
  if (view.positionFilter !== "all") params.set("pos", view.positionFilter);
  if (view.minSources !== 1) params.set("src", String(view.minSources));
  if (view.tdgFormat !== "points") params.set("tdg", view.tdgFormat);
  if (view.fantraxFormat !== "points") params.set("ftx", view.fantraxFormat);
  if (!sameTagSet(view.includedSourceTags, DEFAULT_INCLUDED_SOURCE_TAGS)) {
    params.set("groups", view.includedSourceTags.join(","));
  }
  if (view.rankingSort.key !== DEFAULT_RANKING_SORT.key || view.rankingSort.direction !== DEFAULT_RANKING_SORT.direction) {
    params.set("sort", `${view.rankingSort.key}:${view.rankingSort.direction}`);
  }
  // Team and roster-tag filters only exist while the league overlay is on.
  if (view.leagueOverlayEnabled) {
    params.set("league", "1");
    if (view.selectedLeagueUid) params.set("lg", view.selectedLeagueUid);
    if (view.fantasyTeamFilter !== "all") params.set("team", view.fantasyTeamFilter);
    if (view.rosterTagFilter !== "all") params.set("tag", view.rosterTagFilter);
  }
  return params.toString();
}

function rankingsViewFromHash(hash: string): Partial<RankingsViewState> {
  const queryString = hash.split("?").slice(1).join("?");
  if (!queryString) return {};
  const params = new URLSearchParams(queryString);
  const view: Partial<RankingsViewState> = {};

  const query = params.get("q");
  if (query) view.query = query;
  const minAge = params.get("minAge");
  if (minAge) view.minAge = minAge;
  const maxAge = params.get("maxAge");
  if (maxAge) view.maxAge = maxAge;

  const position = params.get("pos");
  if (position && (POSITION_FILTERS as readonly string[]).includes(position)) {
    view.positionFilter = position as PositionFilter;
  }
  const rosterTag = params.get("tag");
  if (rosterTag && (ROSTER_TAG_FILTERS as readonly string[]).includes(rosterTag)) {
    view.rosterTagFilter = rosterTag as RosterTagFilter;
  }
  const minSources = Number(params.get("src"));
  if ([1, 2, 3, 4].includes(minSources)) view.minSources = minSources;

  const tdg = params.get("tdg");
  if (tdg === "obp" || tdg === "points") view.tdgFormat = tdg;
  const fantrax = params.get("ftx");
  if (fantrax === "roto" || fantrax === "points") view.fantraxFormat = fantrax;

  const groups = params.get("groups");
  if (groups !== null) {
    const tags = groups.split(",").filter((tag): tag is SourceTag => SOURCE_TAGS.includes(tag as SourceTag));
    view.includedSourceTags = tags;
  }

  const sort = params.get("sort");
  if (sort) {
    const [key, direction] = sort.split(":");
    if (key && (direction === "asc" || direction === "desc")) view.rankingSort = { direction, key };
  }

  if (params.get("league") === "1") {
    view.leagueOverlayEnabled = true;
    const leagueUid = params.get("lg");
    if (leagueUid) view.selectedLeagueUid = leagueUid;
    const team = params.get("team");
    if (team) view.fantasyTeamFilter = team;
  }
  return view;
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

function formatTradeSourceDate(value: string | null) {
  return value ? formatPlainDate(value) : "date unavailable";
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

function formatSignedFantasyValue(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return value > 0 ? `+${formatFantasyValue(value)}` : formatFantasyValue(value);
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

export function LineupXfipValue({ game }: { game: LineupRecommendationGame }) {
  const value = game.opposing_pitcher_xfip_minus;
  const provenanceLabel = lineupXfipProvenanceLabel(game.opposing_pitcher_xfip_provenance, value);
  const confidenceLabel = lineupXfipConfidenceLabel(game.opposing_pitcher_xfip_confidence);
  const sourceContext = provenanceLabel === "Missing" ? "Missing" : `${provenanceLabel} · ${confidenceLabel}`;
  const contextParts = [
    game.opposing_pitcher_xfip_source,
    confidenceLabel === "Missing" ? "Confidence unavailable" : `${confidenceLabel} confidence`
  ].filter(Boolean);
  return (
    <div className="lineup-xfip-value">
      {typeof value === "number" && Number.isFinite(value) ? (
        <span>{formatXfipMinus(value)}</span>
      ) : (
        <span className="lineup-estimated-xfip" title="No xFIP- found. Est. Pts uses neutral 100.">
          100 est.
        </span>
      )}
      <small
        className={`lineup-xfip-provenance ${provenanceLabel.toLowerCase()}`}
        title={contextParts.join(" · ") || "No xFIP- source is available."}
      >
        {sourceContext}
      </small>
    </div>
  );
}

export function LineupActionPill({
  assignment,
  optimized
}: {
  assignment: LineupAssignment | null;
  optimized: boolean;
}) {
  return (
    <span className={`lineup-slot-pill ${assignment ? "starter" : optimized ? "bench" : "pending"}`}>
      {assignment ? `Start · ${assignment.label}` : optimized ? "Bench" : "Pending"}
    </span>
  );
}

export function LineupDataContext({
  now = new Date(),
  summary
}: {
  now?: Date;
  summary: LineupRecommendationResponse;
}) {
  const slateAgeHours = lineupCacheAgeHours(summary.cache_generated_at, now);
  const referenceCache = summary.reference_cache;
  const referenceFetchedAt = summary.reference_cache_fetched_at || referenceCache?.fetched_at || null;
  const referenceAgeHours =
    typeof referenceCache?.age_hours === "number"
      ? referenceCache.age_hours
      : lineupCacheAgeHours(referenceFetchedAt, now);
  const xfipRefresh = summary.xfip_refresh;
  const persistence = summary.reference_cache_persistence;
  const warnings: string[] = [];

  if (slateAgeHours === null) {
    warnings.push("Slate cache time is missing; the schedule may be coming from a live fallback.");
  } else if (slateAgeHours > LINEUP_SCHEDULE_STALE_HOURS) {
    warnings.push(
      `Slate cache is ${formatLineupCacheAge(slateAgeHours)}; refresh probables before trusting the schedule.`
    );
  }
  if (!referenceCache || referenceCache.status === "missing") {
    warnings.push("Reference cache is missing; xFIP- uses live FanGraphs fallback where available.");
  } else if (!referenceCache.is_fresh || referenceCache.status === "stale") {
    warnings.push(
      `Reference cache is stale (${formatLineupCacheAge(referenceAgeHours)}; maximum ${formatLineupCacheLimit(referenceCache.max_age_hours)}).`
    );
  }
  if ((xfipRefresh?.missing_row_count || 0) > 0) {
    warnings.push(
      `${xfipRefresh.missing_row_count} probable starter${xfipRefresh.missing_row_count === 1 ? " remains" : "s remain"} without xFIP-.`
    );
  }
  if (persistence?.status === "failed" || persistence?.status === "race-lost") {
    warnings.push(
      persistence.status === "failed"
        ? "Live gap fills could not be saved for reuse."
        : "Live gap fills were not saved because the cache changed or aged out."
    );
  }

  const slateStatus =
    slateAgeHours === null
      ? "Live / unknown"
      : slateAgeHours > LINEUP_SCHEDULE_STALE_HOURS
        ? "Stale cache"
        : "Cache";
  const referenceStatus = referenceCache
    ? formatLineupDataStatus(referenceCache.status)
    : "Missing";
  const persistenceStatus = persistence ? formatLineupDataStatus(persistence.status) : "Not reported";

  return (
    <section className="lineup-data-context" aria-label="Lineup data freshness and sources">
      <div className="lineup-data-grid">
        <div className={`lineup-data-item ${slateAgeHours === null || slateAgeHours > LINEUP_SCHEDULE_STALE_HOURS ? "warning" : ""}`}>
          <span>Slate</span>
          <strong>{slateStatus}</strong>
          <small>
            {formatLineupCacheAge(slateAgeHours)} · {formatVisitorLocalTimestamp(summary.cache_generated_at)}
          </small>
        </div>
        <div className={`lineup-data-item ${!referenceCache?.is_fresh ? "warning" : ""}`}>
          <span>Reference</span>
          <strong>{referenceStatus}</strong>
          <small>
            {formatLineupCacheAge(referenceAgeHours)} / {formatLineupCacheLimit(referenceCache?.max_age_hours)} max · {formatVisitorLocalTimestamp(referenceFetchedAt)}
          </small>
        </div>
        <div className={`lineup-data-item ${(xfipRefresh?.missing_row_count || 0) > 0 ? "warning" : ""}`}>
          <span>xFIP coverage</span>
          <strong>
            {xfipRefresh?.cached_row_count || 0} Cache · {xfipRefresh?.live_row_count || 0} Live · {xfipRefresh?.missing_row_count || 0} Missing
          </strong>
          <small title={xfipRefresh?.message}>{formatLineupDataStatus(xfipRefresh?.cache_status)} · {xfipRefresh?.source || "Source unavailable"}</small>
        </div>
        <div className={`lineup-data-item ${persistence?.status === "failed" || persistence?.status === "race-lost" ? "warning" : ""}`}>
          <span>Gap-fill save</span>
          <strong>{persistenceStatus}</strong>
          <small title={persistence?.message || "This response predates persistence reporting."}>
            {persistence
              ? `${persistence.attempted ? "Attempted" : "No write"} · ${persistence.pitcher_row_count} pitcher · ${persistence.offense_team_count} offense`
              : "Rolling fallback response"}
          </small>
        </div>
      </div>
      <div className={`lineup-notice ${warnings.length ? "danger" : "success"}`} role={warnings.length ? "alert" : undefined}>
        {warnings.length
          ? warnings.join(" ")
          : xfipRefresh?.message || "Slate and reference data are fresh; every probable starter has xFIP-."}
      </div>
    </section>
  );
}

function formatLineupCacheLimit(maxAgeHours: number | null | undefined) {
  if (typeof maxAgeHours !== "number" || !Number.isFinite(maxAgeHours)) return "unknown";
  return `${maxAgeHours.toLocaleString(undefined, { maximumFractionDigits: 1 })}h`;
}

function formatLineupDataStatus(status: string | null | undefined) {
  if (!status) return "Unknown";
  return status
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatVisitorLocalTimestamp(value: string | null | undefined) {
  if (!value) return "time unavailable";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "time unavailable";
  return parsed.toLocaleString(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZoneName: "short"
  });
}

function LineupGameList({
  render,
  row
}: {
  render: (game: LineupRecommendationGame) => ReactNode;
  row: LineupRecommendationRow;
}) {
  const games = lineupGames(row);
  if (!games.length) return <>-</>;
  const showGameNumber = games.length > 1;
  return (
    <div className="lineup-game-list">
      {games.map((game, index) => (
        <div className="lineup-game-entry" key={game.game_key || `${row.player_key}:${index}`}>
          {showGameNumber ? <span className="lineup-game-number">G{game.game_number || index + 1}</span> : null}
          <div>{render(game)}</div>
        </div>
      ))}
    </div>
  );
}

function formatEstimatedLineupPoints(row: LineupRecommendationRow, factor: number = 1) {
  return formatDecimal(estimatedLineupPoints(row, factor));
}

function buildLineupDisplayRows(rows: LineupRecommendationRow[], optimizer: LineupOptimizerResult | null, factor: number = 1): LineupDisplayRow[] {
  return rows
    .map((row) => ({
      assignment: optimizer?.assignments.get(row.player_key) || null,
      estimatedPoints: estimatedLineupPoints(row, factor),
      matchup: matchupAssessmentForLineupRow(row),
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
        lineupMatchupSortOrder(left.matchup.code) - lineupMatchupSortOrder(right.matchup.code) ||
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
): { code: TradeAvailabilityCode; label: string; title: string }[] {
  const cleanStatus = (status || "").trim();
  const availabilities: { code: TradeAvailabilityCode; label: string; title: string }[] = [];
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

export function isIlRosterStatus(status: string) {
  return /(?:^|[^A-Z])(?:IL|DL)(?:$|[^A-Z])/.test(status.toUpperCase());
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

function formatTradePoints(row: Pick<TradePlayerRow, "seasonPoints">) {
  if (typeof row.seasonPoints !== "number") return "-";
  return formatDecimal(row.seasonPoints);
}

function formatTradeSalary(salary: number | null) {
  return salary === null ? "Bid TBD" : formatMoney(salary);
}

function formatTradeTotalSalary(total: Pick<TradeTotal, "salary" | "unknownSalaryCount">) {
  if (!total.unknownSalaryCount) return formatMoney(total.salary);
  if (!total.salary) return total.unknownSalaryCount === 1 ? "Bid TBD" : `${total.unknownSalaryCount} bids TBD`;
  return `${formatMoney(total.salary)} known + ${total.unknownSalaryCount} ${total.unknownSalaryCount === 1 ? "bid" : "bids"} TBD`;
}

function formatTradeSeasonPointsTotal(total: Pick<TradeTotal, "seasonPoints" | "unknownSeasonPointsCount">) {
  const known = `${formatDecimal(total.seasonPoints)} pts`;
  return total.unknownSeasonPointsCount ? `${known} + ${total.unknownSeasonPointsCount} missing` : known;
}

function formatTradeAverageAge(total: Pick<TradeTotal, "ageCount" | "ageSum" | "count">) {
  if (!total.ageCount) return "-";
  const average = formatDecimal(total.ageSum / total.ageCount);
  const missing = total.count - total.ageCount;
  return missing ? `${average} (${missing} missing)` : average;
}

function tradeAverageAge(total: Pick<TradeTotal, "ageCount" | "ageSum">) {
  return total.ageCount ? total.ageSum / total.ageCount : null;
}

function formatTradeMetricPlayers(metric: TradeMetricTotal) {
  return formatTradeMetricValue(metric.knownPlayerValue, metric.missingCount, metric.notApplicableCount);
}

function formatTradeMetricSummary(metric: TradeMetricTotal) {
  return formatTradeMetricValue(metric.knownTotal, metric.missingCount, metric.notApplicableCount);
}

function formatTradeMetricValue(value: number, missingCount: number, notApplicableCount: number) {
  const qualifiers: string[] = [];
  if (missingCount) qualifiers.push(`${missingCount} missing`);
  if (notApplicableCount) qualifiers.push(`${notApplicableCount} MiLB N/A`);
  return qualifiers.length ? `${formatFantasyValue(value)} known + ${qualifiers.join(" + ")}` : formatFantasyValue(value);
}

function completeTradeMetricValue(metric: TradeMetricTotal) {
  return metric.complete && !metric.notApplicableCount ? metric.knownTotal : null;
}

function formatRosterCountChange(value: number) {
  if (!value) return "No change";
  return `${value > 0 ? "+" : ""}${value} roster ${Math.abs(value) === 1 ? "spot" : "spots"}`;
}

function formatProjectedCap(capProjection: CapProjection) {
  if (capProjection.projectedLimit === null) return "No cap data";
  if (capProjection.projectedUsed === null) {
    return `Pending ${capProjection.unknownSalaryCount} ${capProjection.unknownSalaryCount === 1 ? "bid" : "bids"}`;
  }
  return `${formatMoney(capProjection.projectedUsed)} of ${formatMoney(capProjection.projectedLimit)}`;
}

function formatProjectedCapSpace(capProjection: CapProjection) {
  if (capProjection.capSpace !== null) return formatMoney(capProjection.capSpace);
  return capProjection.unknownSalaryCount ? "Pending bid" : "No cap data";
}

function formatProjectedSalaryChange(capProjection: CapProjection) {
  if (capProjection.salaryChange !== null) return capProjection.salaryChange === 0 ? "$0" : formatValueDelta(capProjection.salaryChange);
  const known = capProjection.knownSalaryChange === 0 ? "$0" : formatValueDelta(capProjection.knownSalaryChange);
  return `${known} known + ${capProjection.unknownSalaryCount} TBD`;
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
      lineupMatchupSortOrder(matchupAssessmentForLineupRow(left).code) -
        lineupMatchupSortOrder(matchupAssessmentForLineupRow(right).code) ||
      (right.salary || 0) - (left.salary || 0) ||
      left.player_name.localeCompare(right.player_name)
    );
  });
}

function lineupMatchupSortOrder(code: ReturnType<typeof matchupAssessmentForLineupRow>["code"]) {
  const order: Record<ReturnType<typeof matchupAssessmentForLineupRow>["code"], number> = {
    favorable: 0,
    neutral: 1,
    tough: 2,
    "no-xfip": 3,
    "no-probable": 4,
    "no-game": 5
  };
  return order[code] ?? 99;
}

function formatSigned(value: number | null | undefined) {
  if (typeof value !== "number") return "-";
  const formatted = value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return value > 0 ? `+${formatted}` : formatted;
}

export default App;
