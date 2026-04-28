"""Flake8 plugin entry point for anvil custom lint rules."""

import ast
from collections.abc import Iterable
from typing import Generator

from anvil_lint.anti_slop import check_anti_slop
from anvil_lint.error_handling import check_error_handling
from anvil_lint.structural import check_structural
from anvil_lint.test_quality import check_test_quality

__all__ = ["AnvilChecker"]


_DEFAULT_SOURCE_DIRS = ("src",)


def _coerce_source_dirs(source_dirs: object) -> tuple[str, ...]:
    if source_dirs is None:
        return _DEFAULT_SOURCE_DIRS
    if isinstance(source_dirs, str):
        values = source_dirs.split(",")
    elif isinstance(source_dirs, Iterable):
        values = source_dirs
    else:
        values = (source_dirs,)

    normalized = tuple(str(value).strip() for value in values if str(value).strip())
    return normalized or _DEFAULT_SOURCE_DIRS


class AnvilChecker:
    """Anvil custom lint rules for Python projects."""

    name = "anvil-lint"
    version = "0.1.0"
    _source_dirs = _DEFAULT_SOURCE_DIRS

    @classmethod
    def add_options(cls, option_manager):
        option_manager.add_option(
            "--anvil-source-dir",
            default="src",
            parse_from_config=True,
            comma_separated_list=True,
            help="Source directories checked by ANV007 require-test-files.",
        )

    @classmethod
    def parse_options(cls, options) -> None:
        cls._source_dirs = _coerce_source_dirs(
            getattr(options, "anvil_source_dir", _DEFAULT_SOURCE_DIRS)
        )

    def __init__(self, tree: ast.AST, filename: str) -> None:
        self.tree = tree
        self.filename = filename

    def run(self) -> Generator[tuple[int, int, str, type], None, None]:
        yield from check_anti_slop(self.tree, self.filename, self._source_dirs)
        yield from check_error_handling(self.tree, self.filename)
        yield from check_structural(self.tree, self.filename)
        yield from check_test_quality(self.tree, self.filename)
