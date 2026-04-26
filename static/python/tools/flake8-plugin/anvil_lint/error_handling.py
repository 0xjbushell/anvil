"""Error handling checkers for anvil-lint (ANV022-ANV026)."""

import ast
from typing import Generator


def check_error_handling(
    tree: ast.AST,
    filename: str,
) -> Generator[tuple[int, int, str, type], None, None]:
    """Run all error handling checks. Populated by TIX-000048."""
    yield from ()
