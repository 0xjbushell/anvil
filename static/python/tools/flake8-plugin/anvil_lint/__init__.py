"""Flake8 plugin entry point for anvil custom lint rules."""

import ast
from typing import Generator

from anvil_lint.anti_slop import check_anti_slop
from anvil_lint.error_handling import check_error_handling
from anvil_lint.structural import check_structural
from anvil_lint.test_quality import check_test_quality

__all__ = ["AnvilChecker"]


class AnvilChecker:
    """Anvil custom lint rules for Python projects."""

    name = "anvil-lint"
    version = "0.1.0"

    def __init__(self, tree: ast.AST, filename: str) -> None:
        self.tree = tree
        self.filename = filename

    def run(self) -> Generator[tuple[int, int, str, type], None, None]:
        yield from check_anti_slop(self.tree, self.filename)
        yield from check_error_handling(self.tree, self.filename)
        yield from check_structural(self.tree, self.filename)
        yield from check_test_quality(self.tree, self.filename)
