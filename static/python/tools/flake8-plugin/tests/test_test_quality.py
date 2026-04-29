"""Tests for Python test-quality Flake8 rules."""

from pathlib import Path
from textwrap import dedent

import pytest

from anvil_lint.test_quality import check_test_quality
from conftest import FindingSummary, run_check_function


def run_test_quality(
    source: str,
    filename: str = "tests/test_example.py",
) -> list[FindingSummary]:
    return run_check_function(check_test_quality, source, filename=filename)


def run_test_quality_file(path: Path, source: str) -> list[FindingSummary]:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dedent(source), encoding="utf-8")
    return run_test_quality(source, filename=str(path))


def codes(findings: list[FindingSummary]) -> set[str]:
    return {message.split()[0] for _, _, message in findings}


def assert_has_code(findings: list[FindingSummary], code: str) -> None:
    assert code in codes(findings), findings


def assert_lacks_code(findings: list[FindingSummary], code: str) -> None:
    assert code not in codes(findings), findings


class TestANV201NoEmptyTests:
    @pytest.mark.parametrize(
        "source",
        [
            """
            def test_assert_statement():
                assert result
            """,
            """
            def test_raises_context():
                with pytest.raises(ValueError):
                    parse("")
            """,
            """
            async def test_warns_context():
                with pytest.warns(UserWarning):
                    await load()
            """,
            """
            class TestService(unittest.TestCase):
                def test_unittest_assert_method(self):
                    self.assertEqual(status, 200)
            """,
        ],
    )
    def test_valid_test_with_required_assertion_pattern_is_allowed(
        self, source: str
    ) -> None:
        assert_lacks_code(run_test_quality(source), "ANV201")

    @pytest.mark.parametrize(
        "source",
        [
            """
            def test_empty_function():
                pass
            """,
            """
            async def test_async_without_assertion():
                await load()
            """,
            """
            class TestService(unittest.TestCase):
                def test_unittest_method_without_assertion(self):
                    result = service()
            """,
            """
            def test_nested_helper_assertion_only():
                def helper():
                    assert value
            """,
        ],
    )
    def test_invalid_test_without_required_assertion_pattern_is_flagged(
        self, source: str
    ) -> None:
        assert_has_code(run_test_quality(source), "ANV201")


class TestANV202NoTautologicalAssertions:
    @pytest.mark.parametrize(
        "source",
        [
            """
            def test_boolean_result():
                assert value
            """,
            """
            def test_expected_value():
                assert result == expected
            """,
            """
            def test_not_none():
                assert value is not None
            """,
            """
            class TestStatus(unittest.TestCase):
                def test_status(self):
                    self.assertEqual(status, 200)
            """,
        ],
    )
    def test_valid_non_tautological_assertion_is_allowed(self, source: str) -> None:
        assert_lacks_code(run_test_quality(source), "ANV202")

    @pytest.mark.parametrize(
        "source",
        [
            """
            def test_truthy_literal():
                assert True
            """,
            """
            def test_identical_numbers():
                assert 1 == 1
            """,
            """
            def test_identical_strings():
                assert "a" == "a"
            """,
            """
            def test_same_name():
                assert value == value
            """,
            """
            def test_same_identity():
                assert value is value
            """,
            """
            class TestMath(unittest.TestCase):
                def test_identical_constants(self):
                    self.assertEqual(1, 1)
                    self.assertEquals("a", "a")
                    self.assert_equal(True, True)
            """,
        ],
    )
    def test_invalid_tautological_assertion_is_flagged(self, source: str) -> None:
        assert_has_code(run_test_quality(source), "ANV202")


class TestANV203NoDisabledTestsWithoutReason:
    @pytest.mark.parametrize(
        "source",
        [
            """
            @pytest.mark.skip(reason="blocked by upstream service")
            def test_skipped_with_reason():
                assert True
            """,
            """
            @pytest.mark.skip("requires service")
            def test_skipped_with_positional_reason():
                assert True
            """,
            """
            @pytest.mark.skipif(IS_WINDOWS, reason="POSIX-only behavior")
            def test_skipif_with_reason():
                assert True
            """,
            """
            @pytest.mark.skipif(IS_WINDOWS, "POSIX-only behavior")
            def test_skipif_with_positional_reason():
                assert True
            """,
            """
            @unittest.skip("requires live credentials")
            def test_unittest_skip_with_reason():
                assert True
            """,
            """
            @pytest.mark.skip(reason="blocked by upstream service")
            class TestService:
                def test_service(self):
                    assert True
            """,
        ],
    )
    def test_valid_disabled_test_with_reason_is_allowed(self, source: str) -> None:
        assert_lacks_code(run_test_quality(source), "ANV203")

    @pytest.mark.parametrize(
        "source",
        [
            """
            @pytest.mark.skip
            def test_bare_pytest_skip():
                assert True
            """,
            """
            @pytest.mark.skip()
            def test_empty_pytest_skip_call():
                assert True
            """,
            """
            @pytest.mark.skipif(IS_WINDOWS)
            def test_pytest_skipif_without_reason():
                assert True
            """,
            """
            @pytest.mark.skip(reason="")
            def test_pytest_skip_empty_reason():
                assert True
            """,
            """
            @unittest.skip()
            def test_unittest_skip_without_reason():
                assert True
            """,
            """
            @unittest.skip("")
            def test_unittest_skip_empty_reason():
                assert True
            """,
            """
            @pytest.mark.skip
            class TestBroken:
                def test_case(self):
                    assert True
            """,
            """
            @unittest.skip()
            class TestBroken:
                def test_case(self):
                    assert True
            """,
        ],
    )
    def test_invalid_disabled_test_without_reason_is_flagged(
        self, source: str
    ) -> None:
        assert_has_code(run_test_quality(source), "ANV203")


class TestANV204RequireErrorPathTests:
    def test_valid_flat_test_covers_top_level_source_error_path(
        self, tmp_path: Path
    ) -> None:
        src = tmp_path / "src" / "parser.py"
        src.parent.mkdir(parents=True)
        src.write_text(
            "def parse(value):\n    try:\n        return int(value)\n    except ValueError:\n        return 0\n",
            encoding="utf-8",
        )

        findings = run_test_quality_file(
            tmp_path / "tests" / "test_parser.py",
            """
            def test_parse_rejects_invalid_input():
                with pytest.raises(ValueError):
                    parse("bad")
            """,
        )

        assert_lacks_code(findings, "ANV204")

    def test_valid_mirrored_test_covers_package_source_error_path(
        self, tmp_path: Path
    ) -> None:
        source = tmp_path / "src" / "pkg" / "parser.py"
        source.parent.mkdir(parents=True)
        source.write_text(
            "def parse(value):\n    try:\n        return int(value)\n    except ValueError:\n        return 0\n",
            encoding="utf-8",
        )

        findings = run_test_quality_file(
            tmp_path / "tests" / "pkg" / "test_parser.py",
            """
            class TestParser(unittest.TestCase):
                def test_parse_error(self):
                    with self.assertRaises(ValueError):
                        parse("bad")
            """,
        )

        assert_lacks_code(findings, "ANV204")

    def test_valid_flat_test_covers_package_source_with_direct_pytest_raises(
        self, tmp_path: Path
    ) -> None:
        source = tmp_path / "pkg" / "parser.py"
        source.parent.mkdir(parents=True)
        source.write_text(
            "def parse(value):\n    try:\n        return int(value)\n    except ValueError:\n        return 0\n",
            encoding="utf-8",
        )

        findings = run_test_quality_file(
            tmp_path / "tests" / "test_parser.py",
            """
            def test_parse_rejects_invalid_input():
                pytest.raises(ValueError, parse, "bad")
            """,
        )

        assert_lacks_code(findings, "ANV201")
        assert_lacks_code(findings, "ANV204")

    def test_invalid_bare_pytest_raises_call_is_not_error_path_coverage(
        self, tmp_path: Path
    ) -> None:
        source = tmp_path / "src" / "parser.py"
        source.parent.mkdir(parents=True)
        source.write_text(
            "def parse(value):\n    try:\n        return int(value)\n    except ValueError:\n        return 0\n",
            encoding="utf-8",
        )

        findings = run_test_quality_file(
            tmp_path / "tests" / "test_parser.py",
            """
            def test_parse_error():
                pytest.raises(ValueError)
            """,
        )

        assert_has_code(findings, "ANV201")
        assert_has_code(findings, "ANV204")

    def test_valid_missing_source_file_is_ignored(self, tmp_path: Path) -> None:
        findings = run_test_quality_file(
            tmp_path / "tests" / "test_missing.py",
            """
            def test_missing_source():
                assert True
            """,
        )

        assert_lacks_code(findings, "ANV204")

    def test_valid_source_without_except_handler_is_ignored(self, tmp_path: Path) -> None:
        src = tmp_path / "src" / "parser.py"
        src.parent.mkdir(parents=True)
        src.write_text("def parse(value):\n    return int(value)\n", encoding="utf-8")

        findings = run_test_quality_file(
            tmp_path / "tests" / "test_parser.py",
            """
            def test_parse_success():
                assert parse("1") == 1
            """,
        )

        assert_lacks_code(findings, "ANV204")

    @pytest.mark.parametrize(
        ("test_path", "source_path"),
        [
            ("tests/test_parser.py", "src/parser.py"),
            ("tests/pkg/test_parser.py", "src/pkg/parser.py"),
            ("tests/test_parser.py", "src/pkg/parser.py"),
            ("tests/test_parser.py", "pkg/parser.py"),
            ("src/pkg/test_parser.py", "src/pkg/parser.py"),
            ("pkg/test_parser.py", "pkg/parser.py"),
        ],
    )
    def test_invalid_source_with_except_requires_error_path_test(
        self, tmp_path: Path, test_path: str, source_path: str
    ) -> None:
        src = tmp_path / source_path
        src.parent.mkdir(parents=True)
        src.write_text(
            "def parse(value):\n    try:\n        return int(value)\n    except ValueError:\n        return 0\n",
            encoding="utf-8",
        )

        findings = run_test_quality_file(
            tmp_path / test_path,
            """
            def test_parse_success():
                assert parse("1") == 1
            """,
        )

        assert_has_code(findings, "ANV204")
        assert any(
            line == 1 and col == 0 and message.startswith("ANV204")
            for line, col, message in findings
        )

    def test_invalid_exception_name_assertion_is_not_error_path_coverage(
        self, tmp_path: Path
    ) -> None:
        source = tmp_path / "src" / "parser.py"
        source.parent.mkdir(parents=True)
        source.write_text(
            "def parse(value):\n    try:\n        return int(value)\n    except ValueError:\n        return 0\n",
            encoding="utf-8",
        )

        findings = run_test_quality_file(
            tmp_path / "tests" / "test_parser.py",
            """
            def test_parse_mentions_exception_name():
                assert ValueError.__name__ == "ValueError"
            """,
        )

        assert_has_code(findings, "ANV204")

    def test_invalid_flat_test_finds_package_source(self, tmp_path: Path) -> None:
        source = tmp_path / "pkg" / "seed.py"
        source.parent.mkdir(parents=True)
        source.write_text(
            "def greet(value):\n    try:\n        return value.strip()\n    except AttributeError:\n        return ''\n",
            encoding="utf-8",
        )

        findings = run_test_quality_file(
            tmp_path / "tests" / "test_seed.py",
            """
            def test_greet_success():
                assert greet(" alice ") == "alice"
            """,
        )

        assert_has_code(findings, "ANV204")

    def test_invalid_non_test_python_file_is_not_checked(self, tmp_path: Path) -> None:
        source = tmp_path / "src" / "parser.py"
        source.parent.mkdir(parents=True)
        source.write_text(
            "def parse(value):\n    try:\n        return int(value)\n    except ValueError:\n        return 0\n",
            encoding="utf-8",
        )

        findings = run_test_quality_file(
            tmp_path / "tests" / "parser_checks.py",
            """
            def test_parse_success():
                assert parse("1") == 1
            """,
        )

        assert_lacks_code(findings, "ANV204")
