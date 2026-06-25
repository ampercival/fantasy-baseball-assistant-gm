import unittest

from app.ottoneu import parse_ottoneu_league, parse_ottoneu_league_url, parse_ottoneu_team, parse_ottoneu_team_url
from app.player_keys import normalize_player_key
from app.scrapers import (
    extract_fantasypros_source_date,
    extract_source_date,
    parse_csv_import,
    parse_dynatyze_mlb_rankings,
    parse_ben_rosener_datawrapper_csv,
    parse_fanranked_dynasty,
    parse_fantasypros_ecr,
    parse_harry_knows_ball_rankings,
    parse_html_rankings,
)


class ParserTests(unittest.TestCase):
    def test_html_table_parser_accepts_common_headers(self):
        html = """
        <table>
          <tr><th>MAY RANK</th><th>PLAYER</th><th>ORG</th><th>POS</th><th>AGE</th></tr>
          <tr><td>1</td><td>Shohei Ohtani</td><td>LAD</td><td>UT/P</td><td>31.6</td></tr>
          <tr><td>2</td><td>Juan Soto</td><td>NYM</td><td>OF</td><td>27.3</td></tr>
        </table>
        """
        entries = parse_html_rankings(html)
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[0].player_name, "Shohei Ohtani")
        self.assertEqual(entries[0].team, "LAD")
        self.assertEqual(entries[0].positions, "UT/P")

    def test_html_table_parser_accepts_source_rank_alias(self):
        html = """
        <table>
          <tr><th>Points</th><th>Roto</th><th>Player</th><th>Pos.</th><th>Team</th><th>Age</th></tr>
          <tr><td>2</td><td>1</td><td>Shohei Ohtani</td><td>DH/SP</td><td>LAD</td><td>31</td></tr>
          <tr><td>1</td><td>2</td><td>Bobby Witt Jr.</td><td>SS</td><td>KC</td><td>25</td></tr>
        </table>
        """
        roto_entries = parse_html_rankings(html, rank_header_aliases=("roto",))
        points_entries = parse_html_rankings(html, rank_header_aliases=("points",))
        self.assertEqual(roto_entries[0].rank, 1)
        self.assertEqual(roto_entries[0].player_name, "Shohei Ohtani")
        self.assertEqual(points_entries[0].rank, 1)
        self.assertEqual(points_entries[0].player_name, "Bobby Witt Jr.")

    def test_html_table_parser_accepts_eligible_position_header(self):
        html = """
        <table>
          <tr><th>Rank</th><th>Player</th><th>Team</th><th>Elig. Pos.</th><th>Age</th></tr>
          <tr><td>1</td><td>Shohei Ohtani</td><td>LAD</td><td>DH/SP</td><td>31</td></tr>
        </table>
        """
        entries = parse_html_rankings(html)
        self.assertEqual(entries[0].positions, "DH/SP")

    def test_fantasypros_payload_parser(self):
        html = """
        <script>
        var ecrData = {"players":[
          {"player_name":"Bobby Witt Jr.","player_team_id":"KC","player_positions":"SS","player_age":"26","rank_ecr":1}
        ]};
        </script>
        """
        entries = parse_fantasypros_ecr(html)
        self.assertEqual(entries[0].rank, 1)
        self.assertEqual(entries[0].player_name, "Bobby Witt Jr.")

    def test_fanranked_dynasty_parser_reads_api_payload(self):
        data = [
            {"name": "Shohei Ohtani DH", "team": "LAD", "positions": ["DH"], "age": 32, "dynastyRank": 2},
            {"name": "Bobby Witt Jr.", "team": "KC", "positions": ["SS", "3B"], "age": 26, "dynastyRank": 1},
            {"name": "Shohei Ohtani SP", "team": "LAD", "positions": ["SP"], "age": 32},
        ]
        entries = parse_fanranked_dynasty(data)
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[0].rank, 1)
        self.assertEqual(entries[0].player_name, "Bobby Witt Jr.")
        self.assertEqual(entries[1].player_name, "Shohei Ohtani")

    def test_harry_knows_ball_parser_reads_next_payload_and_skips_picks(self):
        html = """
        <script id="__NEXT_DATA__" type="application/json">
        {"props":{"pageProps":{"players":[
          {"rank":1,"name":"Shohei Ohtani","age":31.9,"positions":["SP","UT"],"team":"LAD","assetType":"PLAYER"},
          {"rank":2,"name":"2027 Early 1st","age":null,"positions":[],"team":null,"assetType":"PICK"}
        ]}}}
        </script>
        """
        entries = parse_harry_knows_ball_rankings(html)
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].player_name, "Shohei Ohtani")
        self.assertEqual(entries[0].positions, "SP/UT")

    def test_dynatyze_parser_reads_ssr_list_and_skips_picks(self):
        html = """
        <section id="mlb-rankings-ssr">
          <p>Updated <time dateTime="2026-06-19">June 19, 2026</time> · Top 150 ranked</p>
          <ol>
            <li>
              <span>1</span><a href="/baseball/players/1">Bobby Witt Jr.</a>
              <span>SS</span><span>KC</span><span>9,953</span>
            </li>
            <li>
              <span>128</span><a href="/baseball/players/136">2027 Early 1st</a>
              <span></span><span></span><span>4,000</span>
            </li>
            <li>
              <span>2</span><a href="/baseball/players/2">Shohei Ohtani</a>
              <span>TWP</span><span>LAD</span><span>9,953</span>
            </li>
          </ol>
        </section>
        """
        entries = parse_dynatyze_mlb_rankings(html)
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[0].rank, 1)
        self.assertEqual(entries[0].player_name, "Bobby Witt Jr.")
        self.assertEqual(entries[0].positions, "SS")
        self.assertEqual(entries[0].team, "KC")
        self.assertEqual(entries[1].player_name, "Shohei Ohtani")

    def test_ben_rosener_datawrapper_csv_parser_ranks_by_row_order(self):
        csv_text = """Dynasty,Trade Value
Shohei Ohtani,100
Bobby Witt Jr.,98
2027 Early 1st,55
Elly De La Cruz,95
"""
        entries = parse_ben_rosener_datawrapper_csv(csv_text)
        self.assertEqual(len(entries), 3)
        self.assertEqual(entries[0].rank, 1)
        self.assertEqual(entries[0].player_name, "Shohei Ohtani")
        self.assertEqual(entries[1].rank, 2)
        self.assertEqual(entries[1].player_name, "Bobby Witt Jr.")
        self.assertEqual(entries[2].rank, 4)
        self.assertEqual(entries[2].player_name, "Elly De La Cruz")

    def test_source_date_parser_prefers_article_modified_metadata(self):
        html = """
        <html><head>
          <meta property="article:published_time" content="2026-03-12T17:00:12+00:00">
          <meta property="article:modified_time" content="2026-03-13T12:33:53+00:00">
        </head><body></body></html>
        """
        source_date = extract_source_date(html)
        self.assertIsNotNone(source_date)
        self.assertEqual(source_date.value, "2026-03-13")
        self.assertEqual(source_date.kind, "updated")

    def test_source_date_parser_reads_json_ld_article_dates(self):
        html = """
        <script type="application/ld+json">
        {"@type":"Article","datePublished":"2026-05-29T11:22:02-04:00","dateModified":"2026-06-01T09:54:44-04:00"}
        </script>
        """
        source_date = extract_source_date(html)
        self.assertIsNotNone(source_date)
        self.assertEqual(source_date.value, "2026-06-01")
        self.assertEqual(source_date.kind, "updated")

    def test_fantasypros_source_date_parser_reads_timestamp(self):
        html = """
        <script>
        var ecrData = {"year":2026,"last_updated":"3/03","last_updated_ts":1772570830,"players":[]};
        </script>
        """
        source_date = extract_fantasypros_source_date(html)
        self.assertIsNotNone(source_date)
        self.assertEqual(source_date.value, "2026-03-03")
        self.assertEqual(source_date.kind, "updated")

    def test_source_date_parser_falls_back_to_visible_updated_text(self):
        html = "<main><p>Updated Fantasy Baseball Dynasty Rankings As Of June 19, 2026</p></main>"
        source_date = extract_source_date(html)
        self.assertIsNotNone(source_date)
        self.assertEqual(source_date.value, "2026-06-19")
        self.assertEqual(source_date.kind, "updated")

    def test_csv_import_accepts_name_alias(self):
        entries = parse_csv_import("ranking,name,org,pos\n1,Corbin Carroll,ARI,OF\n")
        self.assertEqual(entries[0].player_name, "Corbin Carroll")
        self.assertEqual(entries[0].team, "ARI")

    def test_player_key_removes_suffix_and_accents(self):
        self.assertEqual(normalize_player_key("Ronald Acuna Jr."), "ronald acuna")

    def test_player_key_applies_known_aliases(self):
        self.assertEqual(normalize_player_key("Leodalis De Vries"), "leo de vries")

    def test_ottoneu_team_parser_handles_roster_and_summary(self):
        html = """
        <html><head><title>Ottoneu Fantasy Baseball - team - Aspromonte - Uncle Charlie's Angels</title></head>
        <body>
          <select name="team"><option value="12519" selected>Uncle Charlie's Angels</option></select>
          <div class="page-header__primary">
            <div><h3>Roster</h3><h2>2 of 42</h2></div>
            <div><h3>Cap</h3><h2>$59 of $400</h2></div>
          </div>
          <div class="page-header__secondary">
            <h3>Percy0715</h3>
            <h4>Last Transaction</h4><h5>21 hours ago</h5>
            <h4>Salary Cap</h4><h5>$400 (base) + $5 (loans in) - $2 (loans out)</h5>
            <h4>Cap Used</h4><h5>$58 (salary) + $1 (cap penalties)</h5>
            <h4>Rank</h4><h5>9th</h5>
            <h4>Points</h4><h5>7406.1</h5>
          </div>
          <table id="hitters">
            <tr><th>Player</th><th>Salary</th><th>POS</th><th>G</th><th>PA</th><th>P/G</th><th>Pts</th></tr>
            <tr>
              <td><a href="/1900/players/23327">Ronald Acuña Jr.</a><span class="tinytext strong">ATL</span><span class="tinytext morered">10IL</span></td>
              <td>$55</td><td>OF</td><td>53</td><td>236</td><td>5.77</td><td>305.80</td>
            </tr>
            <tr>
              <td><a href="/1900/players/43949">Kyle Teel</a><span class="tinytext strong">CHW</span><span class="tinytext morered">60IL</span></td>
              <td>$4</td><td>C</td><td colspan="12">Not Available</td>
            </tr>
          </table>
          <table id="pitchers"><tr><th>Player</th><th>Salary</th><th>POS</th><th>G</th><th>GS</th><th>IP</th><th>P/IP</th><th>Pts</th></tr></table>
          <table id="cap_penalties"><tr><th>Player</th><th>Penalty</th><th>Cut Date</th></tr><tr><td>Chase Petty</td><td>$1</td><td>03/22/2026</td></tr></table>
        </body></html>
        """
        team = parse_ottoneu_team(html, "https://ottoneu.fangraphs.com/1900/team/12519", league_id=1900, team_id=12519)
        self.assertEqual(team.team_uid, "ottoneu:1900:12519")
        self.assertEqual(team.team_name, "Uncle Charlie's Angels")
        self.assertEqual(team.owner, "Percy0715")
        self.assertEqual(team.roster_count, 2)
        self.assertEqual(team.cap_used, 59)
        self.assertEqual(len(team.roster), 2)
        self.assertEqual(team.roster[0].ottoneu_player_id, 23327)
        self.assertEqual(team.roster[1].status, "60IL")
        self.assertEqual(team.penalties[0].player_name, "Chase Petty")

    def test_ottoneu_team_url_parser(self):
        self.assertEqual(parse_ottoneu_team_url("https://ottoneu.fangraphs.com/1900/team/12519"), (1900, 12519))

    def test_ottoneu_league_parser_handles_standings_links(self):
        html = """
        <html><head><title>Ottoneu Fantasy Baseball - home - Aspromonte</title></head>
        <body>
          <table class="trophy_case">
            <tr><th>Team</th><th>Pts</th><th>Chg</th></tr>
            <tr><td><a href="/1900/team/12373">Last Christmas</a></td><td>8802.2</td><td>25.3</td></tr>
            <tr><td><a href="/1900/team/12519">Uncle Charlie's Angels</a></td><td>7406.1</td><td>11.1</td></tr>
          </table>
        </body></html>
        """
        league = parse_ottoneu_league(html, "https://ottoneu.fangraphs.com/1900/home", league_id=1900)
        self.assertEqual(league.league_uid, "ottoneu:1900")
        self.assertEqual(league.league_name, "Aspromonte")
        self.assertEqual(len(league.teams), 2)
        self.assertEqual(league.teams[1].team_uid, "ottoneu:1900:12519")
        self.assertEqual(league.teams[1].standings_rank, 2)

    def test_ottoneu_league_url_parser(self):
        self.assertEqual(parse_ottoneu_league_url("https://ottoneu.fangraphs.com/1900/home"), 1900)


if __name__ == "__main__":
    unittest.main()
