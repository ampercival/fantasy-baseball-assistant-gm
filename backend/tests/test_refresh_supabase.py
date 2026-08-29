from __future__ import annotations

import contextlib
import io
import unittest
from unittest.mock import patch

import refresh_supabase


class RefreshSupabaseTests(unittest.TestCase):
    def test_refresh_sources_returns_reported_error_count(self) -> None:
        response = {
            "results": [
                {"status": "success", "source_id": "good", "row_count": 10},
                {"status": "error", "source_id": "bad", "message": "blocked"},
                {"status": "skipped", "source_id": "manual"},
            ]
        }
        with patch.object(refresh_supabase, "update_all", return_value=response):
            with contextlib.redirect_stdout(io.StringIO()):
                failures = refresh_supabase.refresh_sources(False)
        self.assertEqual(failures, 1)

    def test_main_returns_partial_failure_exit_code(self) -> None:
        with (
            patch.object(refresh_supabase, "init_db"),
            patch.object(refresh_supabase, "refresh_sources", return_value=1),
            patch.object(refresh_supabase, "refresh_leagues", return_value=0),
            patch.object(refresh_supabase, "refresh_lineup_cache", return_value=0),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            result = refresh_supabase.main(["--skip-platform"])
        self.assertEqual(result, refresh_supabase.EXIT_PARTIAL_FAILURE)

    def test_main_returns_success_when_every_stage_succeeds(self) -> None:
        with (
            patch.object(refresh_supabase, "init_db"),
            patch.object(refresh_supabase, "refresh_sources", return_value=0),
            patch.object(refresh_supabase, "refresh_leagues", return_value=0),
            patch.object(refresh_supabase, "refresh_lineup_cache", return_value=0),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            result = refresh_supabase.main(["--skip-platform"])
        self.assertEqual(result, refresh_supabase.EXIT_SUCCESS)


if __name__ == "__main__":
    unittest.main()
