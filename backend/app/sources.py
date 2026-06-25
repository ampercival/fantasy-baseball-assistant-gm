from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


ScraperKind = Literal[
    "html_table",
    "fantasypros_ecr",
    "fantrax_roto",
    "fantrax_points",
    "fanranked_dynasty",
    "harry_knows_ball",
    "dynatyze_mlb_rankings",
    "ben_rosener_datawrapper",
    "import_only",
]
AccessKind = Literal["public", "subscription", "js_gated", "manual"]
SourceTag = Literal["Continuous", "Updated", "Old/Pre-season"]

SOURCE_TAGS: tuple[SourceTag, ...] = ("Continuous", "Updated", "Old/Pre-season")
DEFAULT_SOURCE_TAG: SourceTag = "Updated"


@dataclass(frozen=True)
class RankingSource:
    id: str
    name: str
    short_name: str
    ranking_type: str
    url: str
    scraper: ScraperKind
    access: AccessKind
    notes: str
    default_tag: SourceTag = DEFAULT_SOURCE_TAG

    @property
    def can_update(self) -> bool:
        return self.scraper != "import_only"


SOURCES: tuple[RankingSource, ...] = (
    RankingSource(
        id="pitcher_list_2026_top_400",
        name="Pitcher List",
        short_name="PL",
        ranking_type="Top 400 dynasty overall",
        url="https://pitcherlist.com/2026-top-400-dynasty-rankings-v2-0/",
        scraper="html_table",
        access="public",
        notes="Public HTML table with mixed MLB players and prospects.",
    ),
    RankingSource(
        id="tdg_2026_obp_top_500",
        name="The Dynasty Guru",
        short_name="TDG OBP",
        ranking_type="Top 500 OBP leagues",
        url="https://thedynastyguru.com/2026/03/13/the-dynasty-guru-top-500-obp-leagues/",
        scraper="html_table",
        access="public",
        notes="Public OBP-format dynasty table.",
    ),
    RankingSource(
        id="tdg_2026_points_top_500",
        name="The Dynasty Guru",
        short_name="TDG Pts",
        ranking_type="Top 500 points leagues",
        url="https://thedynastyguru.com/2026/03/12/the-dynasty-guru-top-500-for-points-leagues/",
        scraper="html_table",
        access="public",
        notes="Public points-format dynasty table.",
    ),
    RankingSource(
        id="baseball_america_2026_top_500",
        name="Baseball America",
        short_name="BA",
        ranking_type="Top 500 fantasy baseball dynasty rankings",
        url="https://www.baseballamerica.com/stories/top-500-fantasy-baseball-dynasty-rankings-for-2026/",
        scraper="html_table",
        access="public",
        notes="Public table at time of implementation; access may change.",
    ),
    RankingSource(
        id="fantasypros_2026_dynasty_ecr",
        name="FantasyPros",
        short_name="FP",
        ranking_type="Keeper/Dynasty expert consensus rankings",
        url="https://www.fantasypros.com/mlb/rankings/dynasty-overall.php",
        scraper="fantasypros_ecr",
        access="public",
        notes="ECR payload embedded in the page HTML.",
    ),
    RankingSource(
        id="rotoballer_eric_cross_2026_may_top_200",
        name="RotoBaller / Eric Cross",
        short_name="RB",
        ranking_type="Top 200 dynasty rankings, May 2026",
        url="https://www.rotoballer.com/top-200-fantasy-baseball-dynasty-rankings-may-2026-update/1867770",
        scraper="html_table",
        access="public",
        notes="Public article table; full Top 500 is separate paid content.",
    ),
    RankingSource(
        id="nbc_rotoworld_2026_top_500",
        name="Rotoworld / NBC Sports",
        short_name="NBC",
        ranking_type="Top 500 dynasty rankings",
        url="https://www.nbcsports.com/fantasy/baseball/news/fantasy-baseball-dynasty-rankings-shohei-ohtani-reigns-roman-anthony-skyrockets-konnor-griffin-headlines-next-wave",
        scraper="html_table",
        access="public",
        notes="Public Rotoworld dynasty table with MLB players and prospects.",
    ),
    RankingSource(
        id="espn_2026_top_300",
        name="ESPN",
        short_name="ESPN",
        ranking_type="Top 300 dynasty rankings",
        url="https://www.espn.com/fantasy/baseball/story/_/id/29312971/fantasy-baseball-dynasty-rankings-top-300-players-2026-beyond",
        scraper="html_table",
        access="public",
        notes="Public top 300 all-player dynasty rankings.",
    ),
    RankingSource(
        id="fanranked_dynasty",
        name="FanRanked",
        short_name="FR",
        ranking_type="Dynasty rankings",
        url="https://www.fanranked.com/rankings",
        scraper="fanranked_dynasty",
        access="public",
        notes="Continuous public dynasty rankings from FanRanked's player API.",
        default_tag="Continuous",
    ),
    RankingSource(
        id="harry_knows_ball_dynasty",
        name="HarryKnowsBall",
        short_name="HKB",
        ranking_type="Crowdsourced dynasty baseball rankings",
        url="https://harryknowsball.com/rankings",
        scraper="harry_knows_ball",
        access="public",
        notes="Continuous crowdsourced all-player dynasty ranking table.",
        default_tag="Continuous",
    ),
    RankingSource(
        id="dynatyze_ottoneu_mlb_rankings",
        name="Dynatyze",
        short_name="DYN",
        ranking_type="MLB dynasty rankings, Ottoneu format",
        url="https://dynatyze.com/baseball/mlb-rankings?format=ottoneu",
        scraper="dynatyze_mlb_rankings",
        access="public",
        notes="Continuous public Ottoneu-format dynasty rankings; current page exposes the public top 150 list.",
        default_tag="Continuous",
    ),
    RankingSource(
        id="ben_rosener_2026_dynasty_top_700",
        name="Ben Rosener",
        short_name="BR",
        ranking_type="Fantasy Baseball Dynasty Top 700 rankings and trade value chart",
        url="https://benrosenerfantasybaseballhelp.substack.com/p/fantasy-baseball-dynasty-top-700-705",
        scraper="ben_rosener_datawrapper",
        access="public",
        notes="Public Substack post with an embedded Datawrapper ranking table; rank is derived from row order.",
    ),
    RankingSource(
        id="rotowire_2026_top_500",
        name="RotoWire",
        short_name="RW",
        ranking_type="Top 500 fantasy baseball dynasty rankings",
        url="https://www.rotowire.com/baseball/dynasty-rankings.php",
        scraper="import_only",
        access="subscription",
        notes="Unauthenticated table endpoint returns a short preview; import a subscriber export for the full board.",
    ),
    RankingSource(
        id="baseball_prospectus_2026_top_500",
        name="Baseball Prospectus",
        short_name="BP",
        ranking_type="Top 500 dynasty rankings",
        url="https://www.baseballprospectus.com/fantasy/article/105520/top-500-dynasty-rankings-march-2026/",
        scraper="import_only",
        access="subscription",
        notes="Premium BP article; import an authorized export.",
    ),
    RankingSource(
        id="fantrax_2026_top_500",
        name="FantraxHQ",
        short_name="FTX R",
        ranking_type="Top 500 Roto dynasty rankings",
        url="https://fantraxhq.com/fantasy-baseball-dynasty-rankings/",
        scraper="fantrax_roto",
        access="public",
        notes="Public table with separate Roto and Points rank columns.",
    ),
    RankingSource(
        id="fantrax_2026_top_500_points",
        name="FantraxHQ",
        short_name="FTX P",
        ranking_type="Top 500 Points dynasty rankings",
        url="https://fantraxhq.com/fantasy-baseball-dynasty-rankings/",
        scraper="fantrax_points",
        access="public",
        notes="Public table with separate Roto and Points rank columns.",
    ),
    RankingSource(
        id="dynasty_dugout_2026_top_500",
        name="The Dynasty Dugout",
        short_name="DD",
        ranking_type="Top 500 dynasty rankings",
        url="https://www.thedynastydugout.com/p/2026-dynasty-fantasy-baseball-rankings-may-top-500",
        scraper="import_only",
        access="subscription",
        notes="Substack-based source; import authorized ranking data.",
    ),
    RankingSource(
        id="sportsethos_ak_2026_top_300",
        name="SportsEthos / AK",
        short_name="SE",
        ranking_type="AK Dynasty 300",
        url="https://sportsethos.com/top-posts/akdynasty300-top-300-overall-2026-draft-guide/",
        scraper="import_only",
        access="manual",
        notes="The public page currently exposes only a top-50 preview; import the full authorized board.",
    ),
)

SOURCE_BY_ID = {source.id: source for source in SOURCES}


def get_source(source_id: str) -> RankingSource:
    try:
        return SOURCE_BY_ID[source_id]
    except KeyError as exc:
        raise KeyError(f"Unknown source: {source_id}") from exc
