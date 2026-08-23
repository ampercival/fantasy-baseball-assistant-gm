import { expect, test } from "vitest";
import {
  buildLineupDatesQuery,
  localIsoDate,
  preferredLineupDate,
  refreshLineupProbables
} from "../src/lineupRefresh";
import type { LineupDateOption } from "../src/types";

function dateOption(date: string, probableStarterCount = 0): LineupDateOption {
  return {
    date,
    game_count: 15,
    probable_starter_count: probableStarterCount
  };
}

test("formats the visitor's local calendar date without converting through UTC", () => {
  class VisitorDate extends Date {
    override getFullYear() { return 2026; }
    override getMonth() { return 7; }
    override getDate() { return 23; }
    override toISOString() { return "2026-08-24T02:45:00.000Z"; }
  }

  expect(localIsoDate(new VisitorDate("2026-08-24T02:45:00.000Z"))).toBe("2026-08-23");
});

test("sends an explicit visitor-local start_date with the lineup date window", () => {
  const params = new URLSearchParams(buildLineupDatesQuery("2026-08-23", 10));

  expect(params.get("start_date")).toBe("2026-08-23");
  expect(params.get("days")).toBe("10");
});

test("preserves the selected date when it remains in the refreshed window", () => {
  const dates = [dateOption("2026-08-23", 30), dateOption("2026-08-24", 20)];

  expect(preferredLineupDate(dates, "2026-08-24", "2026-08-23")).toBe("2026-08-24");
});

test("falls back to the local date, then the first date with probables", () => {
  const dates = [dateOption("2026-08-23"), dateOption("2026-08-24", 20)];

  expect(preferredLineupDate(dates, "2026-08-22", "2026-08-23")).toBe("2026-08-23");
  expect(preferredLineupDate(dates, "2026-08-22", "2026-08-22")).toBe("2026-08-24");
});

test("waits for the lineup cloud refresh before reloading an unchanged selected date", async () => {
  const events: string[] = [];

  const nextDate = await refreshLineupProbables("2026-08-24", {
    requestCloudRefresh: async (scope) => {
      events.push(`request:${scope}`);
      await Promise.resolve();
      events.push("request:complete");
      return true;
    },
    reloadDates: async (preferredDate) => {
      events.push(`dates:${preferredDate}`);
      return preferredDate;
    },
    reloadRecommendations: async (date) => {
      events.push(`recommendations:${date}`);
    }
  });

  expect(nextDate).toBe("2026-08-24");
  expect(events).toEqual([
    "request:lineup",
    "request:complete",
    "dates:2026-08-24",
    "recommendations:2026-08-24"
  ]);
});

test("does not claim fresh lineup data when the queued refresh did not complete", async () => {
  let reloadCount = 0;

  const nextDate = await refreshLineupProbables("2026-08-24", {
    requestCloudRefresh: async () => false,
    reloadDates: async () => {
      reloadCount += 1;
      return "2026-08-24";
    },
    reloadRecommendations: async () => {
      reloadCount += 1;
    }
  });

  expect(nextDate).toBe("2026-08-24");
  expect(reloadCount).toBe(0);
});
