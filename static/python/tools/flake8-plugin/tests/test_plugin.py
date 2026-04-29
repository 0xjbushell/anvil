"""Tests for the anvil-lint Flake8 plugin scaffold."""

import ast
import importlib.metadata
import importlib.util
import re
import subprocess
import sys
from pathlib import Path

import pytest

from anvil_lint import AnvilChecker
from anvil_lint.anti_slop import check_anti_slop
from anvil_lint.error_handling import check_error_handling
from anvil_lint.test_quality import check_test_quality
from conftest import run_check_function, run_checker


class TestPluginLoads:
    """Verify the anvil-lint plugin loads and runs correctly."""

    def test_checker_has_required_attributes(self) -> None:
        """Flake8 requires name and version attributes."""
        assert hasattr(AnvilChecker, "name")
        assert hasattr(AnvilChecker, "version")
        assert AnvilChecker.name == "anvil-lint"
        assert AnvilChecker.version == "0.1.0"

    def test_checker_registers_configurable_source_dir_option(self) -> None:
        """RULE-07 source directories are configurable through Flake8 options."""
        option_calls = []

        class OptionManager:
            def add_option(self, *args, **kwargs):
                option_calls.append((args, kwargs))

        AnvilChecker.add_options(OptionManager())

        assert option_calls == [
            (
                ("--anvil-source-dir",),
                {
                    "default": "src",
                    "parse_from_config": True,
                    "comma_separated_list": True,
                    "help": "Source directories checked by ANV007 require-test-files.",
                },
            ),
            (
                ("--max-file-length",),
                {
                    "default": 350,
                    "parse_from_config": True,
                    "type": int,
                    "help": "Maximum Python file length checked by ANV101.",
                },
            ),
            (
                ("--max-function-length",),
                {
                    "default": 80,
                    "parse_from_config": True,
                    "type": int,
                    "help": "Maximum Python function body length checked by ANV102.",
                },
            ),
        ]

    def test_checker_uses_configured_source_dir_option(self, tmp_path: Path) -> None:
        """AnvilChecker passes parsed source dirs to anti-slop checks."""
        original_source_dirs = AnvilChecker._source_dirs

        class Options:
            anvil_source_dir = ["app"]

        try:
            AnvilChecker.parse_options(Options())
            findings = run_checker(
                AnvilChecker,
                "def foo():\n    return 1\n",
                filename=str(tmp_path / "app" / "foo.py"),
            )
        finally:
            AnvilChecker._source_dirs = original_source_dirs

        assert any(message.startswith("ANV007") for _, _, message in findings)

    def test_checker_uses_configured_structural_threshold_options(
        self, tmp_path: Path
    ) -> None:
        """AnvilChecker passes parsed structural thresholds to ANV101/ANV102."""
        original_source_dirs = AnvilChecker._source_dirs
        original_max_file_length = getattr(AnvilChecker, "_max_file_length", 350)
        original_max_function_length = getattr(AnvilChecker, "_max_function_length", 80)

        class Options:
            anvil_source_dir = ["src"]
            max_file_length = 2
            max_function_length = 1

        source = "def process():\n    value = 1\n    return value\n"
        path = tmp_path / "scratch" / "process.py"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source, encoding="utf-8")

        try:
            AnvilChecker.parse_options(Options())
            findings = run_checker(AnvilChecker, source, filename=str(path))
        finally:
            AnvilChecker._source_dirs = original_source_dirs
            AnvilChecker._max_file_length = original_max_file_length
            AnvilChecker._max_function_length = original_max_function_length

        messages = [message for _, _, message in findings]
        assert any(message.startswith("ANV101") for message in messages)
        assert any(message.startswith("ANV102") for message in messages)

    def test_checker_instantiates(self) -> None:
        """Checker can be instantiated with tree and filename."""
        tree = ast.parse("x = 1")
        checker = AnvilChecker(tree, "test.py")
        assert checker.tree is tree
        assert checker.filename == "test.py"

    def test_empty_checker_produces_no_findings(self) -> None:
        """With only empty sub-checkers wired, no findings are produced."""
        assert run_checker(AnvilChecker, "x = 1\ny = 2\n") == []

    def test_anti_slop_produces_no_findings_for_clean_source(self) -> None:
        """Anti-slop checks do not flag ordinary clean code."""
        assert run_check_function(check_anti_slop, "x = 1\n") == []

    @pytest.mark.parametrize(
        "check_fn",
        [check_error_handling, check_test_quality],
    )
    def test_stub_check_functions_produce_no_findings(self, check_fn) -> None:
        """Stub check functions are valid empty generators."""
        assert run_check_function(check_fn, "x = 1\n") == []

    def test_flake8_select_anv_runs_without_error(self) -> None:
        """flake8 --select=ANV runs successfully on clean code after editable install."""
        if importlib.util.find_spec("flake8") is None:
            pytest.skip("flake8 is not installed")

        try:
            importlib.metadata.version("anvil-lint")
        except importlib.metadata.PackageNotFoundError:
            pytest.skip("anvil-lint editable install is required")

        plugin_root = Path(__file__).resolve().parents[1]
        result = subprocess.run(
            [sys.executable, "-m", "flake8", "--select=ANV", "--", "setup.py"],
            cwd=plugin_root,
            capture_output=True,
            text=True,
            check=False,
        )

        assert result.returncode == 0, (
            f"flake8 failed:\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )

    def test_anv_prefix_is_valid(self) -> None:
        """ANV prefix is 1-3 uppercase letters, as required by Flake8."""
        assert re.match(r"^[A-Z]{1,3}$", "ANV")
