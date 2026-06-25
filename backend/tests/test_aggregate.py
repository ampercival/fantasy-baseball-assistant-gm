from app.aggregate import append_grouped_entry, build_group_rank_lookup, effective_entry, ordered_tags


def entry(player_key: str, player_name: str, rank: int, source_id: str, source_tag: str) -> dict:
    return {
        "player_key": player_key,
        "player_name": player_name,
        "rank": rank,
        "source_id": source_id,
        "source_tag": source_tag,
        "team": None,
        "positions": None,
        "age": None,
    }


def test_group_rank_lookup_ranks_each_source_tag_independently():
    grouped = {
        "player_one": [
            entry("player_one", "Player One", 1, "updated_a", "Updated"),
            entry("player_one", "Player One", 2, "preseason_a", "Old/Pre-season"),
        ],
        "player_two": [
            entry("player_two", "Player Two", 2, "updated_a", "Updated"),
            entry("player_two", "Player Two", 1, "preseason_a", "Old/Pre-season"),
        ],
    }

    lookup = build_group_rank_lookup(grouped, {"updated_a": 2, "preseason_a": 2})

    assert lookup["Updated"]["player_one"]["aggregate_rank"] == 1
    assert lookup["Updated"]["player_two"]["aggregate_rank"] == 2
    assert lookup["Old/Pre-season"]["player_two"]["aggregate_rank"] == 1
    assert lookup["Old/Pre-season"]["player_one"]["aggregate_rank"] == 2


def test_ordered_tags_uses_ranking_cycle_order_before_unknown_tags():
    assert ordered_tags({"Extra", "Old/Pre-season", "Continuous"}) == [
        "Continuous",
        "Old/Pre-season",
        "Extra",
    ]


def test_effective_entry_applies_source_specific_name_correction():
    raw = {
        "player_key": "garrett crochett",
        "player_name": "Garrett Crochett",
        "corrected_player_key": "garrett crochet",
        "corrected_name": "Garrett Crochet",
    }

    corrected = effective_entry(raw)

    assert corrected["player_key"] == "garrett crochet"
    assert corrected["player_name"] == "Garrett Crochet"
    assert corrected["raw_player_name"] == "Garrett Crochett"
    assert corrected["name_corrected"] is True


def test_append_grouped_entry_keeps_one_rank_per_source_after_correction_merge():
    grouped = {}
    append_grouped_entry(grouped, {"player_key": "garrett crochet", "source_id": "source", "rank": 14})
    append_grouped_entry(grouped, {"player_key": "garrett crochet", "source_id": "source", "rank": 12})
    append_grouped_entry(grouped, {"player_key": "garrett crochet", "source_id": "other", "rank": 20})

    assert len(grouped["garrett crochet"]) == 2
    assert grouped["garrett crochet"][0]["rank"] == 12
