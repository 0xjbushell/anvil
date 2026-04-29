"""Tests for Python anti-slop Flake8 rules."""

from pathlib import Path

import pytest

from anvil_lint.anti_slop import check_anti_slop
from conftest import FindingSummary, run_check_function


def run_anti_slop(
    source: str,
    filename: str = "test.py",
    source_dirs: tuple[str, ...] | None = None,
) -> list[FindingSummary]:
    if source_dirs is None:
        return run_check_function(check_anti_slop, source, filename=filename)

    def check_with_source_dirs(tree, filename):
        return check_anti_slop(tree, filename, source_dirs=source_dirs)

    return run_check_function(check_with_source_dirs, source, filename=filename)


def run_anti_slop_file(
    path: Path,
    source: str,
    source_dirs: tuple[str, ...] | None = None,
) -> list[FindingSummary]:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(source, encoding="utf-8")
    return run_anti_slop(source, filename=str(path), source_dirs=source_dirs)


def codes(findings: list[FindingSummary]) -> set[str]:
    return {message.split()[0] for _, _, message in findings}


def assert_has_code(findings: list[FindingSummary], code: str) -> None:
    assert code in codes(findings), findings


def assert_lacks_code(findings: list[FindingSummary], code: str) -> None:
    assert code not in codes(findings), findings


class TestANV001NoLogAndContinue:
    @pytest.mark.parametrize(
        "source",
        [
            """
            import logging

            def load():
                try:
                    return read()
                except ValueError:
                    logging.error("failed", exc_info=True)
                    raise
            """,
            """
            import logging

            def load(default_value):
                try:
                    return read()
                except OSError:
                    logging.warning("retrying")
                    return default_value
            """,
            """
            import logging

            def load():
                try:
                    return read()
                except Exception:
                    logging.error("unexpected")
                    cleanup()
            """,
        ],
    )
    def test_valid_except_blocks_do_more_than_log(self, source: str) -> None:
        assert_lacks_code(run_anti_slop(source), "ANV001")

    @pytest.mark.parametrize(
        "source",
        [
            """
            import logging

            def load():
                try:
                    return read()
                except ValueError as exc:
                    logging.error(exc)
            """,
            """
            def load():
                try:
                    return read()
                except Exception as exc:
                    print(f"Error: {exc}")
            """,
            """
            def load():
                try:
                    return read()
                except KeyError:
                    logger.warning("key not found")
            """,
        ],
    )
    def test_invalid_except_blocks_only_log(self, source: str) -> None:
        assert_has_code(run_anti_slop(source), "ANV001")


class TestANV002NoErrorObscuring:
    @pytest.mark.parametrize(
        "source",
        [
            """
            def parse():
                try:
                    return read()
                except ValueError as exc:
                    raise AppError("invalid input") from exc
            """,
            """
            import logging

            def parse():
                try:
                    return read()
                except OSError:
                    logging.error("io issue")
                    return fallback()
            """,
            """
            import logging

            def parse():
                try:
                    return read()
                except OSError:
                    logging.error("io issue", exc_info=True)
                    return None
            """,
            """
            def parse():
                try:
                    return read()
                except LookupError:
                    return compute_default()
            """,
            """
            def parse():
                try:
                    return read()
                except OSError as exc:
                    logger.error("io issue: %s", exc)
                    return None
            """,
        ],
    )
    def test_valid_preserves_context_or_returns_computed_value(self, source: str) -> None:
        assert_lacks_code(run_anti_slop(source), "ANV002")

    @pytest.mark.parametrize(
        "source",
        [
            """
            def parse():
                try:
                    return read()
                except ValueError:
                    return None
            """,
            """
            def parse():
                try:
                    return read()
                except Exception as exc:
                    raise Exception("something went wrong")
            """,
            """
            def parse():
                try:
                    return read()
                except KeyError:
                    return {}
            """,
            """
            def parse():
                try:
                    return read()
                except Exception:
                    return 0
            """,
            """
            import logging

            def parse():
                try:
                    return read()
                except OSError:
                    return None
                    logging.error("io issue", exc_info=True)
            """,
            """
            import logging

            def parse(debug):
                try:
                    return read()
                except OSError:
                    if debug:
                        logging.exception("io issue")
                    return None
            """,
            """
            import logging

            def parse():
                try:
                    return read()
                except OSError:
                    logging.error("io issue")
                    return None
            """,
            """
            import logging

            def parse():
                try:
                    return read()
                except OSError:
                    try:
                        cleanup()
                    except Exception:
                        logging.exception("cleanup failed")
                    return None
            """,
        ],
    )
    def test_invalid_discards_original_error_context(self, source: str) -> None:
        assert_has_code(run_anti_slop(source), "ANV002")


class TestANV003NoPlaceholderComments:
    @pytest.mark.parametrize(
        "source",
        [
            """
            # TODO(PROJ-456): add retry coverage
            def load():
                return read()
            """,
            """
            # FIXME #789: race in concurrent access
            def load():
                return read()
            """,
            """
            # TODO(OPS-789): add timeout handling
            def load():
                return read()
            """,
            """
            # Contemporary browsers require this adapter.
            def load():
                return read()
            """,
        ],
    )
    def test_valid_comments_have_actionable_references(
        self, tmp_path: Path, source: str
    ) -> None:
        findings = run_anti_slop_file(tmp_path / "src" / "loader.py", source)
        assert_lacks_code(findings, "ANV003")

    @pytest.mark.parametrize(
        "source",
        [
            """
            # TODO: implement later
            def load():
                return read()
            """,
            """
            def load():
                return read()  # FIXME
            """,
            """
            # placeholder for error handling
            def load():
                return read()
            """,
            """
            # temporary workaround
            def load():
                return read()
            """,
            """
            # HACK: bypass validation for now
            def load():
                return read()
            """,
            """
            # HACK(OPS-789): Compatibility shim for legacy importer
            def load():
                return read()
            """,
        ],
    )
    def test_invalid_comments_are_vague_future_work(
        self, tmp_path: Path, source: str
    ) -> None:
        findings = run_anti_slop_file(tmp_path / "src" / "loader.py", source)
        assert_has_code(findings, "ANV003")


class TestANV004NoPassThroughWrapper:
    @pytest.mark.parametrize(
        "source",
        [
            """
            def process(data):
                validated = validate(data)
                return transform(validated)
            """,
            """
            def create_user(name, email):
                return User(name=name, email=email)
            """,
            """
            def greet(name):
                return f"Hello, {name}"
            """,
            """
            def process(data):
                return do_process(normalize(data))
            """,
        ],
    )
    def test_valid_functions_add_behavior_or_change_arguments(self, source: str) -> None:
        assert_lacks_code(run_anti_slop(source), "ANV004")

    @pytest.mark.parametrize(
        "source",
        [
            """
            def process(data):
                return do_process(data)
            """,
            """
            def fetch_user(user_id, include_roles):
                return _fetch_user(user_id, include_roles)
            """,
            """
            async def load_user(user_id):
                return await_user(user_id)
            """,
        ],
    )
    def test_invalid_functions_only_delegate_same_arguments(self, source: str) -> None:
        assert_has_code(run_anti_slop(source), "ANV004")


class TestANV005NoLogAndThrow:
    @pytest.mark.parametrize(
        "source",
        [
            """
            def load():
                try:
                    return read()
                except ValueError as exc:
                    raise AppError("invalid") from exc
            """,
            """
            import logging

            def load(default):
                try:
                    return read()
                except OSError:
                    logging.error("failed", exc_info=True)
                    return default
            """,
            """
            import logging

            def load():
                try:
                    return read()
                except Exception:
                    cleanup()
                    raise
            """,
            """
            import logging

            def load():
                try:
                    return read()
                except OSError:
                    try:
                        cleanup()
                    except Exception:
                        logging.exception("cleanup failed")
                    raise
            """,
        ],
    )
    def test_valid_except_blocks_do_not_both_log_and_raise(self, source: str) -> None:
        assert_lacks_code(run_anti_slop(source), "ANV005")

    @pytest.mark.parametrize(
        "source",
        [
            """
            import logging

            def load():
                try:
                    return read()
                except ValueError as exc:
                    logging.error(f"Validation failed: {exc}")
                    raise
            """,
            """
            def load():
                try:
                    return read()
                except Exception as exc:
                    logger.warning("unexpected error")
                    raise RuntimeError("failed") from exc
            """,
            """
            def load():
                try:
                    return read()
                except OSError:
                    log.exception("read failed")
                    raise
            """,
        ],
    )
    def test_invalid_except_blocks_log_and_raise(self, source: str) -> None:
        assert_has_code(run_anti_slop(source), "ANV005")


class TestANV006RequireStructuredLogging:
    @pytest.mark.parametrize(
        "source",
        [
            """
            import logging

            def record(name):
                logging.info("user logged in", extra={"user": name})
            """,
            """
            import logging

            def record(name):
                logging.info("user %s logged in", name)
            """,
            """
            import structlog

            def record(name):
                structlog.get_logger().info("user logged in", user=name)
            """,
            """
            import logging

            def record():
                logging.info("static message")
            """,
        ],
    )
    def test_valid_logging_uses_parameters_or_static_messages(self, source: str) -> None:
        assert_lacks_code(run_anti_slop(source), "ANV006")

    @pytest.mark.parametrize(
        "source",
        [
            """
            def record(name):
                print(f"user {name} logged in")
            """,
            """
            import logging

            def record(name):
                logging.info(f"user {name} logged in")
            """,
            """
            import logging

            def record(name):
                logging.info("user " + name + " logged in")
            """,
            """
            import logging

            def record(name):
                logging.info("user {}".format(name))
            """,
            """
            import logging

            def record(name):
                logging.info("user %s logged in" % name)
            """,
        ],
    )
    def test_invalid_logging_formats_strings_or_prints(self, source: str) -> None:
        assert_has_code(run_anti_slop(source), "ANV006")


class TestANV007RequireTestFiles:
    @pytest.mark.parametrize(
        ("source_path", "test_path"),
        [
            ("src/foo.py", "tests/test_foo.py"),
            ("src/pkg/foo.py", "tests/pkg/test_foo.py"),
            ("src/pkg/nested/foo.py", "tests/pkg/nested/test_foo.py"),
        ],
    )
    def test_valid_source_files_have_matching_tests(
        self, tmp_path: Path, source_path: str, test_path: str
    ) -> None:
        (tmp_path / test_path).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / test_path).write_text("def test_foo():\n    assert True\n")

        findings = run_anti_slop_file(
            tmp_path / source_path,
            """
            def foo():
                return 1
            """,
        )

        assert_lacks_code(findings, "ANV007")

    @pytest.mark.parametrize(
        "source_path",
        [
            "src/__init__.py",
            "src/__main__.py",
            "src/types.py",
            "src/pkg/errors.py",
            "src/pkg/constants.py",
            "src/pkg/enums.py",
        ],
    )
    def test_valid_exempt_files_do_not_require_tests(
        self, tmp_path: Path, source_path: str
    ) -> None:
        findings = run_anti_slop_file(
            tmp_path / source_path,
            """
            VALUE = 1
            """,
        )

        assert_lacks_code(findings, "ANV007")

    def test_valid_non_source_files_do_not_require_tests(self, tmp_path: Path) -> None:
        findings = run_anti_slop_file(
            tmp_path / "scripts" / "foo.py",
            """
            def foo():
                return 1
            """,
        )

        assert_lacks_code(findings, "ANV007")

    def test_valid_configured_source_dir_uses_matching_tests(
        self, tmp_path: Path
    ) -> None:
        (tmp_path / "tests").mkdir()
        (tmp_path / "tests" / "test_foo.py").write_text(
            "def test_foo():\n    assert True\n",
            encoding="utf-8",
        )

        findings = run_anti_slop_file(
            tmp_path / "app" / "foo.py",
            """
            def foo():
                return 1
            """,
            source_dirs=("app",),
        )

        assert_lacks_code(findings, "ANV007")

    def test_valid_package_main_source_accepts_flat_module_test(
        self, tmp_path: Path
    ) -> None:
        (tmp_path / "tests").mkdir()
        (tmp_path / "tests" / "test_seed.py").write_text(
            "def test_seed():\n    assert True\n",
            encoding="utf-8",
        )

        findings = run_anti_slop_file(
            tmp_path / "src" / "seed" / "seed.py",
            """
            def greet():
                return "hello"
            """,
        )

        assert_lacks_code(findings, "ANV007")

    def test_invalid_configured_source_dir_without_test_is_flagged(
        self, tmp_path: Path
    ) -> None:
        findings = run_anti_slop_file(
            tmp_path / "app" / "foo.py",
            """
            def foo():
                return 1
            """,
            source_dirs=("app",),
        )

        assert_has_code(findings, "ANV007")

    @pytest.mark.parametrize(
        "source_path",
        [
            "src/foo.py",
            "src/pkg/foo.py",
            "src/pkg/nested/foo.py",
        ],
    )
    def test_invalid_source_files_without_tests_are_flagged(
        self, tmp_path: Path, source_path: str
    ) -> None:
        findings = run_anti_slop_file(
            tmp_path / source_path,
            """
            def foo():
                return 1
            """,
        )

        assert_has_code(findings, "ANV007")

    def test_invalid_nested_source_does_not_accept_flat_test(
        self, tmp_path: Path
    ) -> None:
        (tmp_path / "tests").mkdir()
        (tmp_path / "tests" / "test_foo.py").write_text(
            "def test_foo():\n    assert True\n",
            encoding="utf-8",
        )

        findings = run_anti_slop_file(
            tmp_path / "src" / "pkg" / "foo.py",
            """
            def foo():
                return 1
            """,
        )

        assert_has_code(findings, "ANV007")


class TestANV009NoSilentErrorSwallow:
    @pytest.mark.parametrize(
        "source",
        [
            """
            def cleanup():
                try:
                    remove()
                except FileNotFoundError:
                    record_missing_file()
            """,
            """
            import logging

            def cleanup():
                try:
                    remove()
                except OSError:
                    logging.info("cleanup skipped")
            """,
            """
            def cleanup():
                try:
                    remove()
                except OSError:
                    raise
            """,
        ],
    )
    def test_valid_except_blocks_have_handling(self, source: str) -> None:
        assert_lacks_code(run_anti_slop(source), "ANV009")

    def test_valid_intentional_suppression_comment_is_allowed(
        self, tmp_path: Path
    ) -> None:
        findings = run_anti_slop_file(
            tmp_path / "src" / "cleanup.py",
            """
            def cleanup():
                try:
                    remove()
                except FileNotFoundError:
                    # intentionally ignored because removal is best effort
                    pass
            """,
        )

        assert_lacks_code(findings, "ANV009")

    @pytest.mark.parametrize(
        "source",
        [
            """
            def cleanup():
                try:
                    remove()
                except FileNotFoundError:
                    pass
            """,
            """
            def cleanup():
                try:
                    remove()
                except Exception:
                    ...
            """,
            """
            def cleanup():
                try:
                    remove()
                except:
                    pass
            """,
            """
            def cleanup():
                try:
                    remove()
                except OSError:
                    # ignore
                    pass
            """,
        ],
    )
    def test_invalid_except_blocks_silently_swallow_errors(self, source: str) -> None:
        assert_has_code(run_anti_slop(source), "ANV009")
