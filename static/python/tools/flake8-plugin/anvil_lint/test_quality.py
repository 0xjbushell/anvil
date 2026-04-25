"""Test quality checkers for anvil-lint (ANV018-ANV021)."""

import ast
from typing import Generator


def check_test_quality(
    tree: ast.AST,
    filename: str,
) -> Generator[tuple[int, int, str, type], None, None]:
    """Run all test quality checks. Populated by TIX-000047."""
    yield from ()
