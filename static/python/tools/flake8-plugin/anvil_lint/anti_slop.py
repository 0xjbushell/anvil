"""Anti-slop checkers for anvil-lint (ANV001-ANV009)."""

import ast
import io
import re
import textwrap
import tokenize
from collections.abc import Iterable
from pathlib import Path
from typing import Generator

Finding = tuple[int, int, str, type]
_DEFAULT_SOURCE_DIRS = ("src",)

_LOG_METHODS = {
    "debug",
    "info",
    "warning",
    "warn",
    "error",
    "exception",
    "critical",
    "fatal",
    "log",
}
_PLACEHOLDER_PHRASES = (
    "implement later",
    "add error handling",
    "placeholder",
    "fill in",
    "temporary",
    "stub",
    "not implemented",
    "will be implemented",
)
_PLACEHOLDER_PATTERNS = tuple(
    re.compile(rf"\b{re.escape(phrase)}\b") for phrase in _PLACEHOLDER_PHRASES
)
_EXEMPT_TEST_FILES = {
    "__init__.py",
    "__main__.py",
    "types.py",
    "errors.py",
    "constants.py",
    "enums.py",
}
_INTENTIONAL_SUPPRESSION_PHRASES = (
    "intentionally ignored",
    "intentionally ignore",
    "intentionally suppressed",
    "intentional suppression",
    "best effort",
    "nosec",
)


def check_anti_slop(
    tree: ast.AST,
    filename: str,
    source_dirs: Iterable[str] = _DEFAULT_SOURCE_DIRS,
) -> Generator[Finding, None, None]:
    """Run Python anti-slop checks ANV001-ANV007 and ANV009."""
    source = _read_source(filename)
    comments = _comments_by_line(source)

    yield from _check_no_log_and_continue(tree)
    yield from _check_no_error_obscuring(tree)
    yield from _check_placeholder_comments(source)
    yield from _check_no_pass_through_wrapper(tree)
    yield from _check_no_log_and_throw(tree)
    yield from _check_structured_logging(tree)
    yield from _check_require_test_files(filename, source_dirs)
    yield from _check_no_silent_error_swallow(tree, comments)


def _finding(node: ast.AST, code: str, message: str) -> Finding:
    return (
        getattr(node, "lineno", 1),
        getattr(node, "col_offset", 0),
        f"{code} {message}",
        type,
    )


def _line_finding(line: int, col: int, code: str, message: str) -> Finding:
    return (line, col, f"{code} {message}", type)


def _read_source(filename: str) -> str | None:
    try:
        path = Path(filename)
        if not path.is_file():
            return None
        return path.read_text(encoding="utf-8")
    except OSError:
        return None


def _comments_by_line(source: str | None) -> dict[int, list[str]]:
    comments: dict[int, list[str]] = {}
    if source is None:
        return comments

    dedented = textwrap.dedent(source)
    try:
        for token in tokenize.generate_tokens(io.StringIO(dedented).readline):
            if token.type == tokenize.COMMENT:
                comments.setdefault(token.start[0], []).append(token.string)
    except tokenize.TokenError:
        return comments
    return comments


def _check_no_log_and_continue(tree: ast.AST) -> Generator[Finding, None, None]:
    for handler in _except_handlers(tree):
        meaningful = [stmt for stmt in handler.body if not _is_empty_statement(stmt)]
        if meaningful and all(_is_logging_statement(stmt) for stmt in meaningful):
            yield _finding(
                handler,
                "ANV001",
                "except handler only logs or prints before continuing",
            )


def _check_no_error_obscuring(tree: ast.AST) -> Generator[Finding, None, None]:
    for handler in _except_handlers(tree):
        findings, _ = _check_error_obscuring_sequence(
            handler.body,
            logged_context=False,
            caught_name=handler.name,
        )
        yield from findings


def _check_placeholder_comments(source: str | None) -> Generator[Finding, None, None]:
    if source is None:
        return

    dedented = textwrap.dedent(source)
    try:
        tokens = tokenize.generate_tokens(io.StringIO(dedented).readline)
        for token in tokens:
            if token.type != tokenize.COMMENT:
                continue
            if _is_placeholder_comment(token.string):
                yield _line_finding(
                    token.start[0],
                    token.start[1],
                    "ANV003",
                    "placeholder or vague future-work comment needs actionable context",
                )
    except tokenize.TokenError:
        return


def _check_no_pass_through_wrapper(tree: ast.AST) -> Generator[Finding, None, None]:
    for node in ast.walk(tree):
        if not isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
            continue
        if len(node.body) != 1 or not isinstance(node.body[0], ast.Return):
            continue
        returned_value = node.body[0].value
        if isinstance(returned_value, ast.Await):
            returned_value = returned_value.value
        if not isinstance(returned_value, ast.Call):
            continue
        if returned_value.keywords or _looks_like_constructor(returned_value.func):
            continue
        param_names = _simple_positional_parameter_names(node)
        if (
            param_names is None
            or len(returned_value.args) != len(param_names)
            or not param_names
        ):
            continue
        if all(
            isinstance(arg, ast.Name) and arg.id == name
            for arg, name in zip(returned_value.args, param_names)
        ):
            yield _finding(
                node,
                "ANV004",
                "function is only a pass-through wrapper with identical arguments",
            )


def _check_no_log_and_throw(tree: ast.AST) -> Generator[Finding, None, None]:
    for handler in _except_handlers(tree):
        if _sequence_logs_then_raises(handler.body):
            yield _finding(
                handler,
                "ANV005",
                "except handler both logs and raises the same error path",
            )


def _check_structured_logging(tree: ast.AST) -> Generator[Finding, None, None]:
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        if _is_print_call(node):
            yield _finding(node, "ANV006", "print() is not structured logging")
            continue
        if _is_logger_like_call(node) and node.args and _is_string_formatting(node.args[0]):
            yield _finding(
                node,
                "ANV006",
                "logger call formats strings instead of using structured fields or parameters",
            )


def _check_require_test_files(
    filename: str, source_dirs: Iterable[str]
) -> Generator[Finding, None, None]:
    path = Path(filename)
    if path.suffix != ".py" or path.name in _EXEMPT_TEST_FILES:
        return

    source_match = _source_file_match(path, source_dirs)
    if source_match is None:
        return

    root_parts, relative_parts = source_match
    root = Path(*root_parts) if root_parts else Path(".")
    source_relative = Path(*relative_parts)
    test_relative = source_relative.with_name(f"test_{source_relative.name}")
    expected_test = root / "tests" / test_relative

    if not expected_test.is_file():
        yield _line_finding(
            1,
            0,
            "ANV007",
            f"source file under configured source directory needs mirrored test file at {expected_test.as_posix()}",
        )


def _check_no_silent_error_swallow(
    tree: ast.AST, comments: dict[int, list[str]]
) -> Generator[Finding, None, None]:
    for handler in _except_handlers(tree):
        meaningful = [stmt for stmt in handler.body if not _is_empty_statement(stmt)]
        if meaningful:
            continue
        if _has_intentional_suppression_comment(handler, comments):
            continue
        yield _finding(
            handler,
            "ANV009",
            "except handler silently swallows errors without handling or intentional comment",
        )


def _except_handlers(tree: ast.AST) -> Iterable[ast.ExceptHandler]:
    for node in ast.walk(tree):
        if isinstance(node, ast.ExceptHandler):
            yield node


def _is_empty_statement(stmt: ast.stmt) -> bool:
    return isinstance(stmt, ast.Pass) or (
        isinstance(stmt, ast.Expr)
        and isinstance(stmt.value, ast.Constant)
        and stmt.value.value is Ellipsis
    )


def _is_logging_statement(stmt: ast.stmt) -> bool:
    return (
        isinstance(stmt, ast.Expr)
        and isinstance(stmt.value, ast.Call)
        and _is_logging_or_print_call(stmt.value)
    )


def _sequence_logs_then_raises(statements: list[ast.stmt]) -> bool:
    matched, _ = _analyze_log_raise_sequence(statements, logged=False)
    return matched


def _check_error_obscuring_sequence(
    statements: list[ast.stmt],
    logged_context: bool,
    caught_name: str | None,
) -> tuple[list[Finding], set[bool]]:
    findings: list[Finding] = []
    states = {logged_context}
    for stmt in statements:
        next_states: set[bool] = set()
        for state in states:
            statement_findings, exits = _check_error_obscuring_statement(
                stmt,
                state,
                caught_name,
            )
            findings.extend(statement_findings)
            next_states.update(exits)
        states = next_states
        if not states:
            break
    return findings, states


def _check_error_obscuring_statement(
    stmt: ast.stmt,
    logged_context: bool,
    caught_name: str | None,
) -> tuple[list[Finding], set[bool]]:
    if isinstance(stmt, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
        return [], {logged_context}
    if isinstance(stmt, ast.If):
        body_findings, body_exits = _check_error_obscuring_sequence(
            stmt.body,
            logged_context,
            caught_name,
        )
        else_findings, else_exits = _check_error_obscuring_sequence(
            stmt.orelse,
            logged_context,
            caught_name,
        )
        if not stmt.orelse:
            else_exits.add(logged_context)
        return [*body_findings, *else_findings], body_exits | else_exits

    if isinstance(stmt, ast.Return):
        if _is_default_literal(stmt.value) and not logged_context:
            return [
                _finding(
                    stmt,
                    "ANV002",
                    "except handler returns a default literal and discards error context",
                )
            ], set()
        return [], set()
    if isinstance(stmt, ast.Raise):
        if _raises_unchained_generic_exception(stmt):
            return [
                _finding(
                    stmt,
                    "ANV002",
                    "except handler raises generic Exception without chaining context",
                )
            ], set()
        return [], set()
    if isinstance(stmt, ast.Break | ast.Continue):
        return [], set()

    return (
        [],
        {
            logged_context
            or _statement_contains_error_context_logging(stmt, caught_name)
        },
    )


def _analyze_log_raise_sequence(
    statements: list[ast.stmt],
    logged: bool,
) -> tuple[bool, set[bool]]:
    states = {logged}
    for stmt in statements:
        next_states: set[bool] = set()
        for state in states:
            matched, exits = _analyze_log_raise_statement(stmt, state)
            if matched:
                return True, set()
            next_states.update(exits)
        states = next_states
        if not states:
            break
    return False, states


def _analyze_log_raise_statement(
    stmt: ast.stmt,
    logged: bool,
) -> tuple[bool, set[bool]]:
    if isinstance(stmt, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
        return False, {logged}
    if isinstance(stmt, ast.If):
        body_matched, body_exits = _analyze_log_raise_sequence(stmt.body, logged)
        if body_matched:
            return True, set()
        else_matched, else_exits = _analyze_log_raise_sequence(stmt.orelse, logged)
        if else_matched:
            return True, set()
        if not stmt.orelse:
            else_exits.add(logged)
        return False, body_exits | else_exits

    has_logged = logged or _statement_contains_logging(stmt)
    if isinstance(stmt, ast.Raise):
        return has_logged, set()
    if isinstance(stmt, ast.Return | ast.Break | ast.Continue):
        return False, set()
    return False, {has_logged}


def _statement_contains_logging(stmt: ast.AST) -> bool:
    return isinstance(stmt, ast.stmt) and _is_logging_statement(stmt)


def _statement_contains_error_context_logging(
    stmt: ast.AST, caught_name: str | None
) -> bool:
    return (
        isinstance(stmt, ast.Expr)
        and isinstance(stmt.value, ast.Call)
        and _is_logger_like_call(stmt.value)
        and _logger_call_includes_error_context(stmt.value, caught_name)
    )


def _logger_call_includes_error_context(
    call: ast.Call, caught_name: str | None
) -> bool:
    if isinstance(call.func, ast.Attribute) and call.func.attr == "exception":
        return True
    if any(
        keyword.arg == "exc_info" and not _is_falsey_constant(keyword.value)
        for keyword in call.keywords
    ):
        return True
    if caught_name is None:
        return False
    expressions = [
        *call.args,
        *(keyword.value for keyword in call.keywords if keyword.arg is not None),
    ]
    return any(_expr_contains_name(expression, caught_name) for expression in expressions)


def _is_falsey_constant(value: ast.expr) -> bool:
    return isinstance(value, ast.Constant) and value.value in {False, None}


def _expr_contains_name(expression: ast.expr, name: str) -> bool:
    return any(
        isinstance(node, ast.Name) and node.id == name for node in ast.walk(expression)
    )


def _is_logging_or_print_call(call: ast.Call) -> bool:
    return _is_print_call(call) or _is_logger_like_call(call)


def _is_print_call(call: ast.Call) -> bool:
    return isinstance(call.func, ast.Name) and call.func.id == "print"


def _is_logger_like_call(call: ast.Call) -> bool:
    return (
        isinstance(call.func, ast.Attribute)
        and call.func.attr in _LOG_METHODS
        and _is_logger_receiver(call.func.value)
    )


def _is_logger_receiver(value: ast.expr) -> bool:
    if isinstance(value, ast.Name):
        return _is_logger_name(value.id)
    if isinstance(value, ast.Attribute):
        return _is_logger_name(value.attr) or _is_logger_receiver(value.value)
    if isinstance(value, ast.Call):
        return isinstance(value.func, ast.Attribute) and value.func.attr in {
            "getLogger",
            "get_logger",
        }
    return False


def _is_logger_name(name: str) -> bool:
    lower = name.lower()
    return lower in {"log", "logger", "logging"} or lower.endswith(
        ("_log", "_logger")
    )


def _is_default_literal(value: ast.expr | None) -> bool:
    if value is None:
        return True
    if isinstance(value, ast.Constant):
        return (
            value.value is None
            or value.value is False
            or value.value == 0
            or value.value == ""
        )
    if isinstance(value, ast.List):
        return not value.elts
    if isinstance(value, ast.Dict):
        return not value.keys
    return False


def _raises_unchained_generic_exception(stmt: ast.Raise) -> bool:
    if stmt.cause is not None:
        return False
    if isinstance(stmt.exc, ast.Name):
        return stmt.exc.id == "Exception"
    return (
        isinstance(stmt.exc, ast.Call)
        and isinstance(stmt.exc.func, ast.Name)
        and stmt.exc.func.id == "Exception"
    )


def _source_file_match(
    path: Path, source_dirs: Iterable[str]
) -> tuple[tuple[str, ...], tuple[str, ...]] | None:
    path_parts = path.parts
    for source_parts in _normalized_source_dir_parts(source_dirs):
        for start in range(len(path_parts) - len(source_parts), -1, -1):
            if tuple(path_parts[start : start + len(source_parts)]) != source_parts:
                continue
            relative_parts = path_parts[start + len(source_parts) :]
            if relative_parts:
                return tuple(path_parts[:start]), tuple(relative_parts)
    return None


def _normalized_source_dir_parts(
    source_dirs: Iterable[str],
) -> tuple[tuple[str, ...], ...]:
    source_values: Iterable[str]
    if isinstance(source_dirs, str):
        source_values = source_dirs.split(",")
    else:
        source_values = source_dirs

    normalized = []
    for source_dir in source_values:
        parts = tuple(
            part
            for part in re.split(r"[\\/]+", str(source_dir).strip().strip("/\\"))
            if part and part != "."
        )
        if parts:
            normalized.append(parts)

    if not normalized:
        return ((_DEFAULT_SOURCE_DIRS[0],),)
    return tuple(sorted(normalized, key=len, reverse=True))


def _is_placeholder_comment(comment: str) -> bool:
    body = comment.lstrip("# ").strip()
    upper = body.upper()
    lower = body.lower()

    if re.search(r"\bHACK\b", upper):
        return True
    if re.search(r"\bTODO\b", upper) and not re.search(r"\bTODO\([A-Z][A-Z0-9_-]*-\d+\)", upper):
        return True
    if re.search(r"\bFIXME\b", upper) and not _fixme_has_reference(body):
        return True
    return any(pattern.search(lower) for pattern in _PLACEHOLDER_PATTERNS)


def _fixme_has_reference(body: str) -> bool:
    after = re.split(r"\bFIXME\b", body, maxsplit=1, flags=re.IGNORECASE)
    if len(after) != 2:
        return False
    return bool(re.search(r"(\([^)]+\)|#\d+|[A-Z][A-Z0-9_-]*-\d+)", after[1]))


def _simple_positional_parameter_names(
    node: ast.FunctionDef | ast.AsyncFunctionDef,
) -> list[str] | None:
    args = node.args
    if args.vararg or args.kwarg or args.kwonlyargs:
        return None
    return [arg.arg for arg in (*args.posonlyargs, *args.args)]


def _looks_like_constructor(func: ast.expr) -> bool:
    if isinstance(func, ast.Name):
        return func.id[:1].isupper()
    if isinstance(func, ast.Attribute):
        return func.attr[:1].isupper()
    return False


def _is_string_formatting(value: ast.expr) -> bool:
    if isinstance(value, ast.JoinedStr):
        return True
    if isinstance(value, ast.BinOp) and isinstance(value.op, ast.Add | ast.Mod):
        return True
    return (
        isinstance(value, ast.Call)
        and isinstance(value.func, ast.Attribute)
        and value.func.attr == "format"
    )


def _has_intentional_suppression_comment(
    handler: ast.ExceptHandler, comments: dict[int, list[str]]
) -> bool:
    first_body_line = min(
        (getattr(stmt, "lineno", handler.lineno) for stmt in handler.body),
        default=handler.lineno,
    )
    for line in range(handler.lineno, first_body_line + 1):
        for comment in comments.get(line, []):
            lower = comment.lower()
            if any(phrase in lower for phrase in _INTENTIONAL_SUPPRESSION_PHRASES):
                return True
    return False
