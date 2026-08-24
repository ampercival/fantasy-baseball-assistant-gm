import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  isIlRosterStatus,
  LineupActionPill,
  LineupDataContext,
  LineupXfipValue
} from "../src/App";
import type {
  LineupRecommendationGame,
  LineupRecommendationResponse,
  LineupXfipConfidence
} from "../src/types";

const NOW = new Date("2026-08-22T16:00:00.000Z");

function response(overrides: Partial<LineupRecommendationResponse> = {}): LineupRecommendationResponse {
  return {
    league: {
      league_uid: "league-1",
      platform: "ottoneu",
      league_id: 1,
      league_name: "Test League",
      url: "https://example.com/league",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-08-22T15:00:00.000Z",
      my_team_uid: "team-1",
      team_count: 12,
      loaded_team_count: 12,
      rostered_player_count: 480
    },
    team_uid: "team-1",
    source: "home-worker cache; FanGraphs gap fill",
    cache_generated_at: "2026-08-22T15:00:00.000Z",
    reference_cache_fetched_at: "2026-08-22T14:00:00.000Z",
    reference_cache: {
      status: "fresh",
      is_fresh: true,
      fetched_at: "2026-08-22T14:00:00.000Z",
      age_hours: 2,
      max_age_hours: 20
    },
    reference_cache_persistence: {
      status: "persisted",
      attempted: true,
      pitcher_row_count: 2,
      offense_team_count: 30,
      message: "Saved live gap fills."
    },
    xfip_refresh: {
      row_count: 5,
      required_row_count: 5,
      cached_row_count: 3,
      live_row_count: 2,
      missing_row_count: 0,
      error_count: 0,
      cache_status: "fresh",
      source: "home-worker cache + FanGraphs player pages",
      message: "All probable starters have xFIP-."
    },
    date: "2026-08-22",
    game_count: 8,
    probable_starter_count: 16,
    pitcher_stats_count: 5,
    il_players: [],
    minor_league_players: [],
    suspended_players: [],
    pitcher_starts: [],
    rows: [],
    ...overrides
  };
}

function game(confidence: LineupXfipConfidence): LineupRecommendationGame {
  const missing = confidence === "missing";
  return {
    game_key: "TOR-1",
    game_number: 1,
    opponent_team: "BOS",
    opponent_name: "Boston Red Sox",
    opposing_pitcher_key: "pitcher-1",
    opposing_pitcher_name: "Pitcher One",
    opposing_pitcher_xfip_minus: missing ? null : 95,
    opposing_pitcher_xfip_provenance: missing ? "missing" : "live-fangraphs",
    opposing_pitcher_xfip_confidence: confidence,
    opposing_pitcher_xfip_source: missing ? null : "FanGraphs player page"
  };
}

describe("lineup rendered data state", () => {
  test("renders fresh cache, live coverage, and persistence counts", () => {
    const markup = renderToStaticMarkup(<LineupDataContext now={NOW} summary={response()} />);

    expect(markup).toContain("1h old");
    expect(markup).toContain("Fresh");
    expect(markup).toContain("3 Cache · 2 Live · 0 Missing");
    expect(markup).toContain("Persisted");
    expect(markup).toContain("Attempted · 2 pitcher · 30 offense");
    expect(markup).not.toContain('role="alert"');
  });

  test("renders stale and missing warnings with live fallback context", () => {
    const stale = response({
      cache_generated_at: "2026-08-21T10:00:00.000Z",
      reference_cache_fetched_at: "2026-08-21T19:00:00.000Z",
      reference_cache: {
        status: "stale",
        is_fresh: false,
        fetched_at: "2026-08-21T19:00:00.000Z",
        age_hours: 21,
        max_age_hours: 20
      },
      reference_cache_persistence: {
        status: "skipped-stale",
        attempted: false,
        pitcher_row_count: 0,
        offense_team_count: 0,
        message: "Original cache was stale."
      },
      xfip_refresh: {
        row_count: 1,
        required_row_count: 3,
        cached_row_count: 0,
        live_row_count: 1,
        missing_row_count: 2,
        error_count: 0,
        cache_status: "stale",
        source: "FanGraphs player pages",
        message: "Live fallback left two missing rows."
      }
    });
    const staleMarkup = renderToStaticMarkup(<LineupDataContext now={NOW} summary={stale} />);

    expect(staleMarkup).toContain("Stale cache");
    expect(staleMarkup).toContain("0 Cache · 1 Live · 2 Missing");
    expect(staleMarkup).toContain("Reference cache is stale");
    expect(staleMarkup).toContain("2 probable starters remain without xFIP-");
    expect(staleMarkup).toContain("Skipped Stale");
    expect(staleMarkup).toContain('role="alert"');

    const missing = response({
      cache_generated_at: null,
      reference_cache_fetched_at: null,
      reference_cache: {
        status: "missing",
        is_fresh: false,
        fetched_at: null,
        age_hours: null,
        max_age_hours: 20
      }
    });
    const missingMarkup = renderToStaticMarkup(<LineupDataContext now={NOW} summary={missing} />);

    expect(missingMarkup).toContain("Live / unknown");
    expect(missingMarkup).toContain("Reference cache is missing");
    expect(missingMarkup).toContain("time unavailable");
  });

  test("renders every confidence state in the compact xFIP source badge", () => {
    for (const [confidence, expected] of [
      ["high", "Live · High"],
      ["medium", "Live · Medium"],
      ["low", "Live · Low"],
      ["missing", "Missing"]
    ] as const) {
      expect(renderToStaticMarkup(<LineupXfipValue game={game(confidence)} />)).toContain(expected);
    }
  });

  test("uses Pending before optimization and keeps IL boundaries out of MiLB", () => {
    const pendingMarkup = renderToStaticMarkup(<LineupActionPill assignment={null} optimized={false} />);

    expect(pendingMarkup).toContain("Pending");
    expect(pendingMarkup).not.toContain("Optimize");
    expect(isIlRosterStatus("MiLB")).toBe(false);
    expect(isIlRosterStatus("15IL")).toBe(true);
    expect(isIlRosterStatus("60-Day IL")).toBe(true);
    expect(isIlRosterStatus("DL")).toBe(true);
  });
});
