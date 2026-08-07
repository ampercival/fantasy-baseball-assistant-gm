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
        url="https://pitcherlist.com/2026-top-400-dynasty-rankings-v4-0/",
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
        id="rotoballer_points_overall_2026",
        name="RotoBaller Rankings",
        short_name="RB Pts",
        ranking_type="Overall points-league rankings",
        url="https://www.rotoballer.com/fantasy-baseball-rankings/440514#!/rankings?spreadsheet=points&league=Overall",
        scraper="import_only",
        access="js_gated",
        notes="JS-gated interactive rankings tool. Use the site's CSV export button and import the file here.",
        default_tag="Continuous",
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
        url="https://benrosenerfantasybaseballhelp.substack.com/p/fantasy-baseball-dynasty-top-700-e80",
        scraper="ben_rosener_datawrapper",
        access="public",
        notes="Public Substack post with an embedded Datawrapper ranking table; rank is derived from row order.",
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
)

SOURCE_BY_ID = {source.id: source for source in SOURCES}


def get_source(source_id: str) -> RankingSource:
    try:
        return SOURCE_BY_ID[source_id]
    except KeyError as exc:
        raise KeyError(f"Unknown source: {source_id}") from exc
