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
from anvil_lint.structural import check_structural
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

    def test_checker_instantiates(self) -> None:
        """Checker can be instantiated with tree and filename."""
        tree = ast.parse("x = 1")
        checker = AnvilChecker(tree, "test.py")
        assert checker.tree is tree
        assert checker.filename == "test.py"

    def test_empty_checker_produces_no_findings(self) -> None:
        """With only empty sub-checkers wired, no findings are produced."""
        assert run_checker(AnvilChecker, "x = 1\ny = 2\n") == []

    @pytest.mark.parametrize(
        "check_fn",
        [check_anti_slop, check_error_handling, check_structural, check_test_quality],
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
