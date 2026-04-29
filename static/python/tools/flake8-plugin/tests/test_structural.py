"""Tests for Python structural Flake8 rules."""

from pathlib import Path
from textwrap import dedent

import pytest

from anvil_lint.structural import check_structural
from conftest import FindingSummary, run_check_function


def run_structural(
    source: str,
    filename: str = "module.py",
    *,
    max_file_length: int = 350,
    max_function_length: int = 80,
) -> list[FindingSummary]:
    def check_with_thresholds(tree, filename):
        return check_structural(
            tree,
            filename,
            max_file_length=max_file_length,
            max_function_length=max_function_length,
        )

    return run_check_function(check_with_thresholds, source, filename=filename)


def run_structural_file(
    path: Path,
    source: str,
    *,
    max_file_length: int = 350,
    max_function_length: int = 80,
) -> list[FindingSummary]:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(source, encoding="utf-8")
    return run_structural(
        source,
        filename=str(path),
        max_file_length=max_file_length,
        max_function_length=max_function_length,
    )


def codes(findings: list[FindingSummary]) -> set[str]:
    return {message.split()[0] for _, _, message in findings}


def assert_has_code(findings: list[FindingSummary], code: str) -> None:
    assert code in codes(findings), findings


def assert_lacks_code(findings: list[FindingSummary], code: str) -> None:
    assert code not in codes(findings), findings


def lines(count: int) -> str:
    return "\n".join(f"value_{index} = {index}" for index in range(count)) + "\n"


def function_source(
    body_lines: int,
    *,
    name: str = "process",
    async_: bool = False,
    decorated: bool = False,
) -> str:
    prefix = "async " if async_ else ""
    decorators = "@trace\n" if decorated else ""
    body = "\n".join(f"    value_{index} = {index}" for index in range(body_lines))
    return f"{decorators}{prefix}def {name}():\n{body}\n"


class TestANV101MaxFileLength:
    def test_valid_file_at_default_threshold_is_allowed(self, tmp_path: Path) -> None:
        findings = run_structural_file(tmp_path / "exact.py", lines(350))

        assert_lacks_code(findings, "ANV101")

    def test_valid_configured_threshold_allows_equal_length(
        self, tmp_path: Path
    ) -> None:
        findings = run_structural_file(
            tmp_path / "configured.py",
            lines(3),
            max_file_length=3,
        )

        assert_lacks_code(findings, "ANV101")

    def test_valid_missing_filename_does_not_crash(self, tmp_path: Path) -> None:
        findings = run_structural(
            "x = 1\n",
            filename=str(tmp_path / "missing.py"),
        )

        assert_lacks_code(findings, "ANV101")

    def test_invalid_file_over_default_threshold_is_flagged(
        self, tmp_path: Path
    ) -> None:
        findings = run_structural_file(tmp_path / "too_long.py", lines(351))

        assert_has_code(findings, "ANV101")
        assert any("exceeds 350 lines" in message for _, _, message in findings)

    def test_invalid_file_over_configured_threshold_is_flagged(
        self, tmp_path: Path
    ) -> None:
        findings = run_structural_file(
            tmp_path / "configured_long.py",
            lines(4),
            max_file_length=3,
        )

        assert_has_code(findings, "ANV101")

    def test_invalid_finding_uses_file_start_location(self, tmp_path: Path) -> None:
        findings = run_structural_file(tmp_path / "location.py", lines(351))

        assert any(
            line == 1 and col == 0 and message.startswith("ANV101")
            for line, col, message in findings
        )


class TestANV102MaxFunctionLength:
    def test_valid_function_at_default_threshold_is_allowed(self) -> None:
        findings = run_structural(function_source(80), filename="process.py")

        assert_lacks_code(findings, "ANV102")

    def test_valid_decorated_async_function_at_threshold_is_allowed(self) -> None:
        source = "def trace(fn):\n    return fn\n\n" + function_source(
            80,
            name="load",
            async_=True,
            decorated=True,
        )

        findings = run_structural(source, filename="load.py")

        assert_lacks_code(findings, "ANV102")

    def test_valid_configured_threshold_allows_equal_body_length(self) -> None:
        findings = run_structural(
            function_source(3),
            filename="process.py",
            max_function_length=3,
        )

        assert_lacks_code(findings, "ANV102")

    def test_invalid_function_over_default_threshold_is_flagged(self) -> None:
        findings = run_structural(function_source(81), filename="process.py")

        assert_has_code(findings, "ANV102")
        assert any("function 'process' is 81 lines" in message for _, _, message in findings)

    def test_invalid_decorated_async_function_over_threshold_is_flagged(self) -> None:
        source = "def trace(fn):\n    return fn\n\n" + function_source(
            81,
            name="load",
            async_=True,
            decorated=True,
        )

        findings = run_structural(source, filename="load.py")

        assert_has_code(findings, "ANV102")

    def test_invalid_function_over_configured_threshold_is_flagged(self) -> None:
        findings = run_structural(
            function_source(4),
            filename="process.py",
            max_function_length=3,
        )

        assert_has_code(findings, "ANV102")


class TestANV103TypesFileOrganization:
    @pytest.mark.parametrize(
        ("filename", "source"),
        [
            (
                "types.py",
                """
                from typing import TypeAlias

                UserId: TypeAlias = int
                """,
            ),
            (
                "types.py",
                """
                from dataclasses import dataclass

                @dataclass
                class User:
                    name: str
                """,
            ),
            (
                "types.py",
                """
                def _build_user():
                    return object()
                """,
            ),
            (
                "user.py",
                """
                from typing import TypedDict

                class _User(TypedDict):
                    name: str
                """,
            ),
            (
                "user.py",
                """
                from typing import Protocol

                __all__ = ["build"]

                class UserPort(Protocol):
                    def load(self) -> str: ...

                def build():
                    return "ok"
                """,
            ),
            (
                "user.py",
                """
                from .types import User
                from .types import UserId as PublicUserId
                """,
            ),
            (
                "user.py",
                """
                from .types import User

                __all__ = ("User",)
                """,
            ),
        ],
    )
    def test_valid_type_organization_is_allowed(self, filename: str, source: str) -> None:
        assert_lacks_code(run_structural(source, filename=filename), "ANV103")

    @pytest.mark.parametrize(
        ("filename", "source", "name"),
        [
            (
                "models.py",
                """
                from typing import TypedDict

                class User(TypedDict):
                    name: str
                """,
                "User",
            ),
            (
                "ports.py",
                """
                from typing import Protocol

                class UserPort(Protocol):
                    def load(self) -> str: ...
                """,
                "UserPort",
            ),
            (
                "records.py",
                """
                from typing import NamedTuple

                class UserRecord(NamedTuple):
                    name: str
                """,
                "UserRecord",
            ),
            (
                "aliases.py",
                """
                from typing import TypeAlias

                UserId: TypeAlias = int
                """,
                "UserId",
            ),
            (
                "models.py",
                """
                import dataclasses

                @dataclasses.dataclass
                class User:
                    name: str
                """,
                "User",
            ),
            (
                "types.py",
                """
                def build_user():
                    return object()
                """,
                "build_user",
            ),
            (
                "types.py",
                """
                class User:
                    pass
                """,
                "User",
            ),
            (
                "types.py",
                """
                DEFAULT_USER = "guest"
                """,
                "DEFAULT_USER",
            ),
        ],
    )
    def test_invalid_type_organization_is_flagged(
        self, filename: str, source: str, name: str
    ) -> None:
        findings = run_structural(source, filename=filename)

        assert_has_code(findings, "ANV103")
        assert any(name in message for _, _, message in findings)


class TestANV104ErrorsFileOrganization:
    @pytest.mark.parametrize(
        ("filename", "source"),
        [
            (
                "errors.py",
                """
                class AppError(Exception):
                    pass
                """,
            ),
            (
                "errors.py",
                """
                def _build_error():
                    return "error"
                """,
            ),
            (
                "service.py",
                """
                class _AppError(Exception):
                    pass
                """,
            ),
            (
                "service.py",
                """
                from .errors import AppError
                from .errors import DatabaseError as PublicDatabaseError
                """,
            ),
            (
                "service.py",
                """
                from .errors import AppError

                __all__ = ["AppError"]
                """,
            ),
            (
                "errors.py",
                """
                class DatabaseError(my.errors.AppError):
                    pass
                """,
            ),
        ],
    )
    def test_valid_error_organization_is_allowed(self, filename: str, source: str) -> None:
        assert_lacks_code(run_structural(source, filename=filename), "ANV104")

    @pytest.mark.parametrize(
        ("filename", "source", "name"),
        [
            (
                "service.py",
                """
                class AppError(Exception):
                    pass
                """,
                "AppError",
            ),
            (
                "repository.py",
                """
                class DatabaseFailure(DomainError):
                    pass
                """,
                "DatabaseFailure",
            ),
            (
                "client.py",
                """
                class ApiFailure(my.errors.ApiError):
                    pass
                """,
                "ApiFailure",
            ),
            (
                "errors.py",
                """
                def build_error():
                    return "error"
                """,
                "build_error",
            ),
            (
                "errors.py",
                """
                class Result:
                    pass
                """,
                "Result",
            ),
            (
                "errors.py",
                """
                DEFAULT_MESSAGE = "failed"
                """,
                "DEFAULT_MESSAGE",
            ),
        ],
    )
    def test_invalid_error_organization_is_flagged(
        self, filename: str, source: str, name: str
    ) -> None:
        findings = run_structural(source, filename=filename)

        assert_has_code(findings, "ANV104")
        assert any(name in message for _, _, message in findings)


class TestANV105ConstantsFileOrganization:
    @pytest.mark.parametrize(
        ("filename", "source"),
        [
            ("constants.py", "DEFAULT_TIMEOUT = 30\n"),
            ("constants.py", "_default_timeout = 30\n"),
            ("settings.py", "_DEFAULT_TIMEOUT = 30\n"),
            (
                "settings.py",
                """
                __all__ = ["build"]
                DEFAULT_TIMEOUT = 30

                def build():
                    return DEFAULT_TIMEOUT
                """,
            ),
            (
                "settings.py",
                """
                from .constants import DEFAULT_TIMEOUT

                __all__ = ["DEFAULT_TIMEOUT"]
                """,
            ),
            ("settings.py", "__all__ = []\n"),
        ],
    )
    def test_valid_constant_organization_is_allowed(
        self, filename: str, source: str
    ) -> None:
        assert_lacks_code(run_structural(source, filename=filename), "ANV105")

    @pytest.mark.parametrize(
        ("filename", "source", "name"),
        [
            ("settings.py", "DEFAULT_TIMEOUT = 30\n", "DEFAULT_TIMEOUT"),
            (
                "settings.py",
                """
                RETRY_LIMIT: int = 3
                """,
                "RETRY_LIMIT",
            ),
            (
                "settings.py",
                """
                __all__ = ["PUBLIC_SETTING"]
                PUBLIC_SETTING = "enabled"
                PRIVATE_SETTING = "hidden"
                """,
                "PUBLIC_SETTING",
            ),
            ("constants.py", "default_timeout = 30\n", "default_timeout"),
            (
                "constants.py",
                """
                def default_timeout():
                    return 30
                """,
                "default_timeout",
            ),
            (
                "constants.py",
                """
                class Settings:
                    pass
                """,
                "Settings",
            ),
        ],
    )
    def test_invalid_constant_organization_is_flagged(
        self, filename: str, source: str, name: str
    ) -> None:
        findings = run_structural(source, filename=filename)

        assert_has_code(findings, "ANV105")
        assert any(name in message for _, _, message in findings)

    def test_valid_test_support_constants_are_allowed(self) -> None:
        findings = run_structural(
            """
            PROJECT_ROOT = "/repo"
            SOURCE_ROOT = "/repo/src"
            """,
            filename="tests/conftest.py",
        )

        assert_lacks_code(findings, "ANV105")


class TestANV106EnumsFileOrganization:
    @pytest.mark.parametrize(
        ("filename", "source"),
        [
            (
                "enums.py",
                """
                from enum import Enum

                class Status(Enum):
                    ACTIVE = "active"
                """,
            ),
            (
                "enums.py",
                """
                from enum import Enum

                class Status(str, Enum):
                    ACTIVE = "active"
                """,
            ),
            (
                "enums.py",
                """
                import enum

                class Permission(enum.IntFlag):
                    READ = 1
                """,
            ),
            (
                "enums.py",
                """
                def _build_status():
                    return "active"
                """,
            ),
            (
                "status.py",
                """
                from enum import Enum

                class _Status(Enum):
                    ACTIVE = "active"
                """,
            ),
            (
                "status.py",
                """
                from .enums import Status
                from .enums import Permission as PublicPermission
                """,
            ),
            (
                "status.py",
                """
                from .enums import Status

                __all__ = ["Status"]
                """,
            ),
        ],
    )
    def test_valid_enum_organization_is_allowed(self, filename: str, source: str) -> None:
        assert_lacks_code(run_structural(source, filename=filename), "ANV106")

    @pytest.mark.parametrize(
        ("filename", "source", "name"),
        [
            (
                "status.py",
                """
                from enum import Enum

                class Status(Enum):
                    ACTIVE = "active"
                """,
                "Status",
            ),
            (
                "priority.py",
                """
                from enum import IntEnum

                class Priority(IntEnum):
                    LOW = 1
                """,
                "Priority",
            ),
            (
                "mode.py",
                """
                from enum import StrEnum

                class Mode(StrEnum):
                    READ = "read"
                """,
                "Mode",
            ),
            (
                "permission.py",
                """
                from enum import Flag

                class Permission(Flag):
                    READ = 1
                """,
                "Permission",
            ),
            (
                "permission.py",
                """
                import enum

                class Permission(enum.IntFlag):
                    READ = 1
                """,
                "Permission",
            ),
            (
                "enums.py",
                """
                def build_status():
                    return "active"
                """,
                "build_status",
            ),
            (
                "enums.py",
                """
                class Status:
                    ACTIVE = "active"
                """,
                "Status",
            ),
            ("enums.py", "DEFAULT_STATUS = 'active'\n", "DEFAULT_STATUS"),
        ],
    )
    def test_invalid_enum_organization_is_flagged(
        self, filename: str, source: str, name: str
    ) -> None:
        findings = run_structural(source, filename=filename)

        assert_has_code(findings, "ANV106")
        assert any(name in message for _, _, message in findings)


class TestANV107FilenameMatchExport:
    @pytest.mark.parametrize(
        ("filename", "source"),
        [
            (
                "user_service.py",
                """
                class UserService:
                    pass
                """,
            ),
            (
                "validate_user.py",
                """
                def validate_user():
                    return True
                """,
            ),
            (
                "helpers.py",
                """
                class User:
                    pass

                def build_user():
                    return User()
                """,
            ),
            ("constants.py", "DEFAULT_TIMEOUT = 30\n"),
            ("client.py", "from .service import UserService\n"),
            (
                "client.py",
                """
                from .service import UserService
                from .service import build_user
                """,
            ),
            (
                "types.py",
                """
                class User:
                    pass
                """,
            ),
            (
                "__init__.py",
                """
                class Package:
                    pass
                """,
            ),
        ],
    )
    def test_valid_filename_export_matches_or_is_exempt(
        self, filename: str, source: str
    ) -> None:
        assert_lacks_code(run_structural(source, filename=filename), "ANV107")

    @pytest.mark.parametrize(
        ("filename", "source", "expected"),
        [
            (
                "account.py",
                """
                class User:
                    pass
                """,
                "Account",
            ),
            (
                "load_user.py",
                """
                def fetch_user():
                    return object()
                """,
                "load_user",
            ),
            (
                "selected.py",
                """
                __all__ = ["User"]

                class User:
                    pass

                class Ignored:
                    pass
                """,
                "Selected",
            ),
        ],
    )
    def test_invalid_single_primary_export_mismatch_is_flagged(
        self, filename: str, source: str, expected: str
    ) -> None:
        findings = run_structural(source, filename=filename)

        assert_has_code(findings, "ANV107")
        assert any(expected in message for _, _, message in findings)


class TestANV108NoExportedFunctionExpressions:
    @pytest.mark.parametrize(
        ("filename", "source"),
        [
            ("helpers.py", "_process = lambda value: value\n"),
            (
                "helpers.py",
                """
                def outer():
                    inner = lambda value: value
                    return inner
                """,
            ),
            (
                "process.py",
                """
                def process(value):
                    return value
                """,
            ),
            (
                "helpers.py",
                """
                __all__ = ["process"]
                helper = lambda value: value

                def process(value):
                    return helper(value)
                """,
            ),
        ],
    )
    def test_valid_lambda_or_def_usage_is_allowed(
        self, filename: str, source: str
    ) -> None:
        assert_lacks_code(run_structural(source, filename=filename), "ANV108")

    @pytest.mark.parametrize(
        ("source", "name"),
        [
            ("process = lambda value: value\n", "process"),
            (
                """
                from collections.abc import Callable

                transform: Callable[[int], int] = lambda value: value + 1
                """,
                "transform",
            ),
            (
                """
                __all__ = ["selected"]
                selected = lambda value: value
                ignored = lambda value: value
                """,
                "selected",
            ),
            (
                """
                first = second = lambda value: value
                """,
                "first",
            ),
        ],
    )
    def test_invalid_exported_lambda_assignment_is_flagged(
        self, source: str, name: str
    ) -> None:
        findings = run_structural(dedent(source), filename=f"{name}.py")

        assert_has_code(findings, "ANV108")
        assert any(name in message for _, _, message in findings)
