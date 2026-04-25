"""Anti-slop checkers for anvil-lint (ANV001-ANV009)."""

import ast
from typing import Generator


def check_anti_slop(
    tree: ast.AST,
    filename: str,
) -> Generator[tuple[int, int, str, type], None, None]:
    """Run all anti-slop checks. Populated by TIX-000045."""
    yield from ()
