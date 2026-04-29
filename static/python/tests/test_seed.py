"""Tests for greeting operations."""

from typing import cast

import pytest

from seed import DEFAULT_LANGUAGE, MAX_NAME_LENGTH, Language, SeedError, greet


def test_greet_returns_default_english_greeting() -> None:
    assert greet("Alice") == {
        "message": "Hello, Alice!",
        "name": "Alice",
        "language": DEFAULT_LANGUAGE.value,
    }


def test_greet_returns_spanish_greeting() -> None:
    result = greet("Carlos", Language.SPANISH)

    assert result["message"] == "Hola, Carlos!"
    assert result["language"] == Language.SPANISH.value


def test_greet_returns_french_greeting() -> None:
    result = greet("Marie", Language.FRENCH)

    assert result["message"] == "Bonjour, Marie!"
    assert result["language"] == Language.FRENCH.value


def test_greet_trims_surrounding_whitespace() -> None:
    result = greet("  Ada  ")

    assert result["name"] == "Ada"
    assert result["message"] == "Hello, Ada!"


def test_greet_accepts_name_at_max_length() -> None:
    name = "A" * MAX_NAME_LENGTH

    assert greet(name)["name"] == name


def test_greet_rejects_empty_name() -> None:
    with pytest.raises(SeedError):
        greet("")


def test_greet_rejects_whitespace_name() -> None:
    with pytest.raises(SeedError):
        greet("   ")


def test_greet_rejects_overlong_name() -> None:
    with pytest.raises(SeedError):
        greet("A" * (MAX_NAME_LENGTH + 1))


def test_greet_rejects_unknown_language() -> None:
    unknown_language = cast(Language, "Klingon")

    with pytest.raises(SeedError):
        greet("Ada", unknown_language)
