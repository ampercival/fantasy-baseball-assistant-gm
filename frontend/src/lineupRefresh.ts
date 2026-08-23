import type { LineupDateOption } from "./types";

export type LineupRefreshDependencies = {
  reloadDates: (preferredDate: string) => Promise<string>;
  reloadRecommendations: (date: string) => Promise<void>;
  requestCloudRefresh: (scope: string) => Promise<boolean>;
};

export function localIsoDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function buildLineupDatesQuery(startDate: string, days = 10) {
  return new URLSearchParams({
    start_date: startDate,
    days: String(days)
  }).toString();
}

export function preferredLineupDate(
  dates: LineupDateOption[],
  selectedDate: string,
  visitorLocalDate: string
) {
  if (selectedDate && dates.some((option) => option.date === selectedDate)) return selectedDate;
  return (
    dates.find((option) => option.date === visitorLocalDate)?.date ||
    dates.find((option) => option.probable_starter_count > 0)?.date ||
    dates[0]?.date ||
    ""
  );
}

// A changed date already triggers the workspace's date effect. An unchanged date does not,
// so explicitly reload that recommendation after the worker has completed and dates are fresh.
export async function refreshLineupProbables(
  selectedDate: string,
  dependencies: LineupRefreshDependencies
) {
  const completed = await dependencies.requestCloudRefresh("lineup");
  if (!completed) return selectedDate;

  const nextDate = await dependencies.reloadDates(selectedDate);
  if (nextDate && nextDate === selectedDate) {
    await dependencies.reloadRecommendations(nextDate);
  }
  return nextDate;
}
