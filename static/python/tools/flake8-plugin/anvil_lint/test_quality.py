"""Test quality checkers for anvil-lint (ANV201-ANV204)."""

import ast
from pathlib import Path
from typing import Generator

Finding = tuple[int, int, str, type]

_ASSERT_EQUAL_METHODS = {"assertEqual", "assertEquals", "assert_equal"}
_NESTED_SCOPE_NODES = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)


def check_test_quality(
    tree: ast.AST,
    filename: str,
) -> Generator[Finding, None, None]:
    """Run Python test-quality checks ANV201-ANV204."""
    yield from _check_no_empty_tests(tree)
    yield from _check_no_tautological_assertions(tree)
    yield from _check_no_disabled_tests_without_reason(tree)
    yield from _check_require_error_path_tests(tree, filename)


def _finding(node: ast.AST, code: str, message: str) -> Finding:
    return (
        getattr(node, "lineno", 1),
        getattr(node, "col_offset", 0),
        f"{code} {message}",
        type,
    )


def _line_finding(line: int, col: int, code: str, message: str) -> Finding:
    return (line, col, f"{code} {message}", type)


def _check_no_empty_tests(tree: ast.AST) -> Generator[Finding, None, None]:
    for test in _test_functions(tree):
        if not _test_body_has_required_assertion(test):
            yield _finding(
                test,
                "ANV201",
                f"test function '{test.name}' has no assertion or error expectation",
            )


def _check_no_tautological_assertions(tree: ast.AST) -> Generator[Finding, None, None]:
    for node in ast.walk(tree):
        if isinstance(node, ast.Assert) and _is_tautological_assert(node):
            yield _finding(node, "ANV202", "assertion is tautological")
        elif isinstance(node, ast.Call) and _is_tautological_unittest_assert(node):
            yield _finding(node, "ANV202", "unittest assertion compares identical values")


def _check_no_disabled_tests_without_reason(
    tree: ast.AST,
) -> Generator[Finding, None, None]:
    for node in _test_functions_and_classes(tree):
        for decorator in node.decorator_list:
            if _is_disabled_test_without_reason(decorator):
                yield _finding(
                    decorator,
                    "ANV203",
                    "disabled test needs a non-empty reason",
                )


def _check_require_error_path_tests(
    tree: ast.AST, filename: str
) -> Generator[Finding, None, None]:
    source_trees = [
        source_tree
        for source_path in _mapped_source_paths(filename)
        if source_path.is_file() and (source_tree := _parse_file(source_path)) is not None
    ]
    if not any(_has_try_with_except_handler(source_tree) for source_tree in source_trees):
        return
    if _tree_has_error_path_expectation(tree):
        return
    yield _line_finding(
        1,
        0,
        "ANV204",
        "source error handling needs a pytest.raises or assertRaises test",
    )


def _test_functions(tree: ast.AST) -> Generator[ast.FunctionDef | ast.AsyncFunctionDef, None, None]:
    for node in ast.walk(tree):
        if _is_test_function(node):
            yield node


def _test_functions_and_classes(
    tree: ast.AST,
) -> Generator[ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef, None, None]:
    for node in ast.walk(tree):
        if _is_test_function(node):
            yield node
        elif _is_test_class(node):
            yield node


def _is_test_function(node: ast.AST) -> bool:
    return isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef) and node.name.startswith(
        "test_"
    )


def _is_test_class(node: ast.AST) -> bool:
    return isinstance(node, ast.ClassDef) and node.name.startswith("Test")


def _test_body_has_required_assertion(
    test: ast.FunctionDef | ast.AsyncFunctionDef,
) -> bool:
    return any(
        isinstance(node, ast.Assert)
        or _is_pytest_raises_or_warns_context(node)
        or _is_pytest_direct_call(node, {"raises", "warns"})
        or _is_unittest_assert_call(node)
        for node in _walk_without_nested_scopes(test)
        if node is not test
    )


def _tree_has_error_path_expectation(tree: ast.AST) -> bool:
    return any(
        _is_pytest_raises_expectation(node)
        or _is_unittest_assert_raises_context_or_call(node)
        for node in ast.walk(tree)
    )


def _walk_without_nested_scopes(root: ast.AST) -> Generator[ast.AST, None, None]:
    stack = list(reversed(list(ast.iter_child_nodes(root))))
    while stack:
        node = stack.pop()
        yield node
        if isinstance(node, _NESTED_SCOPE_NODES):
            continue
        stack.extend(reversed(list(ast.iter_child_nodes(node))))


def _is_tautological_assert(node: ast.Assert) -> bool:
    test = node.test
    if _is_truthy_literal(test):
        return True
    if not isinstance(test, ast.Compare) or len(test.ops) != 1 or len(test.comparators) != 1:
        return False
    if not isinstance(test.ops[0], ast.Eq | ast.Is):
        return False
    return _same_constant(test.left, test.comparators[0]) or _same_name(
        test.left, test.comparators[0]
    )


def _is_tautological_unittest_assert(call: ast.Call) -> bool:
    if not _is_named_method_call(call, _ASSERT_EQUAL_METHODS) or len(call.args) < 2:
        return False
    return _same_constant(call.args[0], call.args[1])


def _is_truthy_literal(node: ast.AST) -> bool:
    if isinstance(node, ast.Constant):
        return bool(node.value)
    if isinstance(node, ast.Tuple | ast.List | ast.Set):
        return bool(node.elts)
    if isinstance(node, ast.Dict):
        return bool(node.keys)
    return False


def _same_constant(left: ast.AST, right: ast.AST) -> bool:
    return (
        isinstance(left, ast.Constant)
        and isinstance(right, ast.Constant)
        and left.value == right.value
    )


def _same_name(left: ast.AST, right: ast.AST) -> bool:
    return isinstance(left, ast.Name) and isinstance(right, ast.Name) and left.id == right.id


def _is_disabled_test_without_reason(decorator: ast.AST) -> bool:
    if isinstance(decorator, ast.Attribute):
        return _qualified_name(decorator) == "pytest.mark.skip"
    if not isinstance(decorator, ast.Call):
        return False
    name = _qualified_name(decorator.func)
    if name in {"pytest.mark.skip", "pytest.mark.skipif"}:
        return not _has_pytest_skip_reason(decorator, name)
    if name == "unittest.skip":
        return not _has_non_empty_reason_arg(decorator)
    return False


def _has_pytest_skip_reason(call: ast.Call, name: str) -> bool:
    if _has_non_empty_keyword(call, "reason"):
        return True
    reason_args = call.args if name == "pytest.mark.skip" else call.args[1:]
    return any(_is_non_empty_string(arg) for arg in reason_args)


def _has_non_empty_keyword(call: ast.Call, keyword_name: str) -> bool:
    for keyword in call.keywords:
        if keyword.arg == keyword_name and _is_non_empty_string(keyword.value):
            return True
    return False


def _has_non_empty_reason_arg(call: ast.Call) -> bool:
    if call.args and _is_non_empty_string(call.args[0]):
        return True
    return _has_non_empty_keyword(call, "reason")


def _is_non_empty_string(node: ast.AST) -> bool:
    return isinstance(node, ast.Constant) and isinstance(node.value, str) and bool(
        node.value.strip()
    )


def _is_pytest_raises_or_warns_context(node: ast.AST) -> bool:
    return isinstance(node, ast.With | ast.AsyncWith) and any(
        _is_pytest_context_call(item.context_expr, {"raises", "warns"}) for item in node.items
    )


def _is_pytest_raises_expectation(node: ast.AST) -> bool:
    if isinstance(node, ast.With | ast.AsyncWith):
        return any(_is_pytest_context_call(item.context_expr, {"raises"}) for item in node.items)
    return _is_pytest_direct_call(node, {"raises"})


def _is_pytest_direct_call(node: ast.AST, methods: set[str]) -> bool:
    return (
        isinstance(node, ast.Call)
        and len(node.args) >= 2
        and isinstance(node.func, ast.Attribute)
        and node.func.attr in methods
        and _qualified_name(node.func.value) == "pytest"
    )


def _is_pytest_context_call(node: ast.AST, methods: set[str]) -> bool:
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr in methods
        and _qualified_name(node.func.value) == "pytest"
    )


def _is_unittest_assert_call(node: ast.AST) -> bool:
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "self"
        and node.func.attr.startswith("assert")
    )


def _is_unittest_assert_raises_context_or_call(node: ast.AST) -> bool:
    if isinstance(node, ast.With | ast.AsyncWith):
        return any(_is_assert_raises_call(item.context_expr) for item in node.items)
    return _is_assert_raises_call(node)


def _is_assert_raises_call(node: ast.AST) -> bool:
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "assertRaises"
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "self"
    )


def _is_named_method_call(call: ast.Call, names: set[str]) -> bool:
    return isinstance(call.func, ast.Attribute) and call.func.attr in names


def _mapped_source_paths(filename: str) -> list[Path]:
    path = Path(filename)
    if path.suffix != ".py" or not (
        path.name.startswith("test_") or path.name.endswith("_test.py")
    ):
        return []

    source_name = _source_filename_for_test(path.name)
    sibling_source = path.with_name(source_name)
    if "tests" not in path.parts:
        return [sibling_source]

    parts = path.parts
    tests_index = _last_part_index(parts, "tests")
    relative_parts = parts[tests_index + 1 :]
    if not relative_parts:
        return []

    root = Path(*parts[:tests_index]) if tests_index else Path(".")
    mirrored_source = root.joinpath("src", *relative_parts[:-1], source_name)
    if len(relative_parts) > 1:
        return [mirrored_source]

    flat_sources = [mirrored_source]
    src_root = root / "src"
    if src_root.is_dir():
        flat_sources.extend(sorted(src_root.glob(f"**/{source_name}")))
    flat_sources.extend(
        candidate
        for candidate in sorted(root.glob(f"**/{source_name}"))
        if _is_source_candidate(candidate, root)
    )
    return list(dict.fromkeys(flat_sources))


def _is_source_candidate(path: Path, root: Path) -> bool:
    try:
        relative = path.relative_to(root)
    except ValueError:
        return False
    return not any(
        part == "tests" or part == "__pycache__" or part.startswith(".")
        for part in relative.parts
    )


def _source_filename_for_test(name: str) -> str:
    if name.startswith("test_"):
        return name.removeprefix("test_")
    return f"{name.removesuffix('_test.py')}.py"


def _last_part_index(parts: tuple[str, ...], part: str) -> int | None:
    for index in range(len(parts) - 1, -1, -1):
        if parts[index] == part:
            return index
    return None


def _parse_file(path: Path) -> ast.AST | None:
    try:
        return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    except (OSError, SyntaxError):
        return None


def _has_try_with_except_handler(tree: ast.AST) -> bool:
    return any(isinstance(node, ast.Try) and node.handlers for node in ast.walk(tree))


def _qualified_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        parent = _qualified_name(node.value)
        if parent is None:
            return node.attr
        return f"{parent}.{node.attr}"
    return None
