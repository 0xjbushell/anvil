"""Structural checkers for anvil-lint (ANV010-ANV017)."""

import ast
from typing import Generator


def check_structural(
    tree: ast.AST,
    filename: str,
) -> Generator[tuple[int, int, str, type], None, None]:
    """Run all structural checks. Populated by TIX-000046."""
    yield from ()
