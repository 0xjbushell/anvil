"""Structural checkers for anvil-lint (ANV101-ANV108)."""

import ast
import re
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Generator

Finding = tuple[int, int, str, type]

_ORG_FILES = {"types.py", "errors.py", "constants.py", "enums.py", "__init__.py"}
_TYPE_FILE = "types.py"
_ERRORS_FILE = "errors.py"
_CONSTANTS_FILE = "constants.py"
_ENUMS_FILE = "enums.py"
_DEFAULT_MAX_FILE_LENGTH = 350
_DEFAULT_MAX_FUNCTION_LENGTH = 80
_ENUM_BASES = {"Enum", "IntEnum", "StrEnum", "Flag", "IntFlag"}
_EXCEPTION_NAME_RE = re.compile(r"(Error|Exception|Failure)$")


def check_structural(
    tree: ast.AST,
    filename: str,
    max_file_length: int = _DEFAULT_MAX_FILE_LENGTH,
    max_function_length: int = _DEFAULT_MAX_FUNCTION_LENGTH,
) -> Generator[Finding, None, None]:
    """Run Python structural checks ANV101-ANV108."""
    path = Path(filename)
    exported = _exported_names(tree)
    declarations = _module_declarations(tree, exported)

    yield from _check_max_file_length(filename, max_file_length)
    yield from _check_max_function_length(tree, max_function_length)
    yield from _check_types_file_organization(path, declarations)
    yield from _check_errors_file_organization(path, declarations)
    yield from _check_constants_file_organization(path, declarations)
    yield from _check_enums_file_organization(path, declarations)
    yield from _check_filename_match_export(path, declarations)
    yield from _check_no_exported_lambda_assignments(tree, exported)


@dataclass(frozen=True)
class _Declaration:
    name: str
    node: ast.AST
    kind: str


def _finding(node: ast.AST, code: str, message: str) -> Finding:
    return (
        getattr(node, "lineno", 1),
        getattr(node, "col_offset", 0),
        f"{code} {message}",
        type,
    )


def _line_finding(line: int, col: int, code: str, message: str) -> Finding:
    return (line, col, f"{code} {message}", type)


def _check_max_file_length(
    filename: str, max_file_length: int
) -> Generator[Finding, None, None]:
    source = _read_source(filename)
    if source is None:
        return

    line_count = len(source.splitlines())
    if line_count > max_file_length:
        yield _line_finding(
            1,
            0,
            "ANV101",
            f"file is {line_count} lines and exceeds {max_file_length} lines",
        )


def _check_max_function_length(
    tree: ast.AST, max_function_length: int
) -> Generator[Finding, None, None]:
    for node in ast.walk(tree):
        if not isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
            continue
        body_length = _body_line_count(node.body)
        if body_length > max_function_length:
            yield _finding(
                node,
                "ANV102",
                f"function '{node.name}' is {body_length} lines "
                f"and exceeds {max_function_length} lines",
            )


def _check_types_file_organization(
    path: Path, declarations: list[_Declaration]
) -> Generator[Finding, None, None]:
    if path.name == _TYPE_FILE:
        for declaration in declarations:
            if declaration.kind != "type":
                yield _finding(
                    declaration.node,
                    "ANV103",
                    f"exported non-type '{declaration.name}' should not live "
                    "in types.py",
                )
        return

    for declaration in declarations:
        if declaration.kind == "type":
            yield _finding(
                declaration.node,
                "ANV103",
                f"exported type '{declaration.name}' should live in types.py",
            )


def _check_errors_file_organization(
    path: Path, declarations: list[_Declaration]
) -> Generator[Finding, None, None]:
    if path.name == _ERRORS_FILE:
        for declaration in declarations:
            if declaration.kind != "error":
                yield _finding(
                    declaration.node,
                    "ANV104",
                    f"exported non-error '{declaration.name}' should not live "
                    "in errors.py",
                )
        return

    for declaration in declarations:
        if declaration.kind == "error":
            yield _finding(
                declaration.node,
                "ANV104",
                f"exported error '{declaration.name}' should live in errors.py",
            )


def _check_constants_file_organization(
    path: Path, declarations: list[_Declaration]
) -> Generator[Finding, None, None]:
    if path.name == _CONSTANTS_FILE:
        for declaration in declarations:
            if declaration.kind != "constant":
                yield _finding(
                    declaration.node,
                    "ANV105",
                    f"exported non-constant '{declaration.name}' should not live "
                    "in constants.py",
                )
        return

    for declaration in declarations:
        if declaration.kind == "constant":
            yield _finding(
                declaration.node,
                "ANV105",
                f"exported constant '{declaration.name}' should live in constants.py",
            )


def _check_enums_file_organization(
    path: Path, declarations: list[_Declaration]
) -> Generator[Finding, None, None]:
    if path.name == _ENUMS_FILE:
        for declaration in declarations:
            if declaration.kind != "enum":
                yield _finding(
                    declaration.node,
                    "ANV106",
                    f"exported non-enum '{declaration.name}' should not live "
                    "in enums.py",
                )
        return

    for declaration in declarations:
        if declaration.kind == "enum":
            yield _finding(
                declaration.node,
                "ANV106",
                f"exported enum '{declaration.name}' should live in enums.py",
            )


def _check_filename_match_export(
    path: Path, declarations: list[_Declaration]
) -> Generator[Finding, None, None]:
    if path.name in _ORG_FILES or path.suffix != ".py" or len(declarations) != 1:
        return

    declaration = declarations[0]
    expected = path.stem
    if _normalize_export_name(expected) != _normalize_export_name(declaration.name):
        suggested = _filename_symbol_name(expected)
        yield _finding(
            declaration.node,
            "ANV107",
            f"single exported symbol '{declaration.name}' should match "
            f"filename '{expected}' ({suggested})",
        )


def _check_no_exported_lambda_assignments(
    tree: ast.AST, exported: set[str] | None
) -> Generator[Finding, None, None]:
    for statement in getattr(tree, "body", []):
        if isinstance(statement, ast.Assign) and isinstance(
            statement.value, ast.Lambda
        ):
            target_names = _assignment_target_names(statement.targets)
        elif isinstance(statement, ast.AnnAssign) and isinstance(
            statement.value, ast.Lambda
        ):
            target_names = _target_names(statement.target)
        else:
            continue

        for target in target_names:
            if _is_exported(target, exported):
                yield _finding(
                    statement,
                    "ANV108",
                    f"exported lambda assignment '{target}' should use def",
                )


def _module_declarations(
    tree: ast.AST, exported: set[str] | None
) -> list[_Declaration]:
    declarations: list[_Declaration] = []
    for statement in getattr(tree, "body", []):
        if isinstance(statement, ast.ClassDef):
            if not _is_exported(statement.name, exported):
                continue
            declarations.append(
                _Declaration(
                    statement.name, statement, _class_declaration_kind(statement)
                )
            )
        elif isinstance(statement, ast.FunctionDef | ast.AsyncFunctionDef):
            if _is_exported(statement.name, exported):
                declarations.append(_Declaration(statement.name, statement, "function"))
        elif isinstance(statement, ast.Assign):
            for name in _assignment_target_names(statement.targets):
                if name == "__all__" or not _is_exported(name, exported):
                    continue
                declarations.append(
                    _Declaration(
                        name, statement, _assignment_kind(name, statement.value)
                    )
                )
        elif isinstance(statement, ast.AnnAssign) and statement.value is not None:
            for name in _target_names(statement.target):
                if name == "__all__" or not _is_exported(name, exported):
                    continue
                declarations.append(
                    _Declaration(name, statement, _ann_assignment_kind(name, statement))
                )
    return declarations


def _exported_names(tree: ast.AST) -> set[str] | None:
    for statement in getattr(tree, "body", []):
        if isinstance(statement, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "__all__"
            for target in statement.targets
        ):
            return _literal_string_names(statement.value)
        if (
            isinstance(statement, ast.AnnAssign)
            and isinstance(statement.target, ast.Name)
            and statement.target.id == "__all__"
            and statement.value is not None
        ):
            return _literal_string_names(statement.value)
    return None


def _literal_string_names(node: ast.AST) -> set[str]:
    if isinstance(node, ast.List | ast.Tuple | ast.Set):
        return {
            element.value
            for element in node.elts
            if isinstance(element, ast.Constant) and isinstance(element.value, str)
        }
    return set()


def _is_exported(name: str, exported: set[str] | None) -> bool:
    if exported is not None:
        return name in exported
    return not name.startswith("_")


def _class_declaration_kind(node: ast.ClassDef) -> str:
    if _is_enum_class(node):
        return "enum"
    if _is_exception_class(node):
        return "error"
    if _is_type_class(node):
        return "type"
    return "class"


def _assignment_kind(name: str, value: ast.AST | None = None) -> str:
    if _is_functional_type_definition(value):
        return "type"
    if _is_constant_name(name):
        return "constant"
    return "value"


def _ann_assignment_kind(name: str, node: ast.AnnAssign) -> str:
    if _terminal_name(node.annotation) == "TypeAlias":
        return "type"
    return _assignment_kind(name)


def _is_type_class(node: ast.ClassDef) -> bool:
    type_bases = {"TypedDict", "Protocol", "NamedTuple"}
    if any(_terminal_name(base) in type_bases for base in node.bases):
        return True
    return any(
        _terminal_name(decorator) == "dataclass" for decorator in node.decorator_list
    )


def _is_functional_type_definition(node: ast.AST | None) -> bool:
    return isinstance(node, ast.Call) and _terminal_name(node.func) in {
        "TypedDict",
        "NamedTuple",
    }


def _is_exception_class(node: ast.ClassDef) -> bool:
    if _EXCEPTION_NAME_RE.search(node.name):
        return True
    return any(
        base_name is not None and _EXCEPTION_NAME_RE.search(base_name)
        for base_name in (_terminal_name(base) for base in node.bases)
    )


def _is_enum_class(node: ast.ClassDef) -> bool:
    return any(_terminal_name(base) in _ENUM_BASES for base in node.bases)


def _is_constant_name(name: str) -> bool:
    return name.isupper() and any(character.isalpha() for character in name)


def _terminal_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    if isinstance(node, ast.Subscript):
        return _terminal_name(node.value)
    if isinstance(node, ast.Call):
        return _terminal_name(node.func)
    return None


def _assignment_target_names(targets: Iterable[ast.AST]) -> list[str]:
    names: list[str] = []
    for target in targets:
        names.extend(_target_names(target))
    return names


def _target_names(target: ast.AST) -> list[str]:
    if isinstance(target, ast.Name):
        return [target.id]
    if isinstance(target, ast.Tuple | ast.List):
        names: list[str] = []
        for element in target.elts:
            names.extend(_target_names(element))
        return names
    return []


def _body_line_count(body: list[ast.stmt]) -> int:
    if not body:
        return 0
    start = getattr(body[0], "lineno", 0)
    end = max(
        getattr(statement, "end_lineno", getattr(statement, "lineno", start))
        for statement in body
    )
    return max(0, end - start + 1)


def _normalize_export_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def _filename_symbol_name(stem: str) -> str:
    return "".join(
        part[:1].upper() + part[1:] for part in re.split(r"[_-]+", stem) if part
    )


def _read_source(filename: str) -> str | None:
    try:
        path = Path(filename)
        if not path.is_file():
            return None
        return path.read_text(encoding="utf-8")
    except OSError:
        return None
