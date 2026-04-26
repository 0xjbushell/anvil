"""Shared test helpers for anvil-lint checker tests."""

import ast
import textwrap
from collections.abc import Callable
from typing import Generator, Protocol

Finding = tuple[int, int, str, type]
FindingSummary = tuple[int, int, str]


class CheckerClass(Protocol):
    def __init__(self, tree: ast.AST, filename: str) -> None:
        ...

    def run(self) -> Generator[Finding, None, None]:
        ...


def run_checker(
    checker_class: type[CheckerClass],
    source: str,
    filename: str = "test.py",
) -> list[FindingSummary]:
    """Run a Flake8 checker on source code and return line, column, and message."""
    tree = ast.parse(textwrap.dedent(source))
    checker = checker_class(tree, filename)
    return [(line, col, msg) for line, col, msg, _ in checker.run()]


def run_check_function(
    check_fn: Callable[[ast.AST, str], Generator[Finding, None, None]],
    source: str,
    filename: str = "test.py",
) -> list[FindingSummary]:
    """Run a standalone check function and return line, column, and message."""
    tree = ast.parse(textwrap.dedent(source))
    return [(line, col, msg) for line, col, msg, _ in check_fn(tree, filename)]
