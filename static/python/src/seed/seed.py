"""Greeting service with validation and structured logging."""

import logging

from .constants import DEFAULT_LANGUAGE, MAX_NAME_LENGTH
from .enums import Language
from .errors import SeedError
from .types import SeedResult

logger = logging.getLogger(__name__)


def greet(name: str, language: Language = DEFAULT_LANGUAGE) -> SeedResult:
    """Generate a greeting for a validated name."""
    validated_name = _validate_name(name)
    validated_language = _validate_language(language)
    message = _build_greeting(validated_name, validated_language)

    logger.info(
        "greeting generated",
        extra={
            "language": validated_language.value,
            "message_length": len(message),
            "name": validated_name,
        },
    )

    return {
        "message": message,
        "name": validated_name,
        "language": validated_language.value,
    }


def _validate_name(name: str) -> str:
    trimmed_name = name.strip()

    if not trimmed_name:
        raise SeedError("name must not be empty")

    if len(trimmed_name) > MAX_NAME_LENGTH:
        raise SeedError(f"name exceeds maximum length of {MAX_NAME_LENGTH}")

    return trimmed_name


def _validate_language(language: Language) -> Language:
    if not isinstance(language, Language):
        raise SeedError("unsupported language")

    return language


def _build_greeting(name: str, language: Language) -> str:
    greetings = {
        Language.ENGLISH: f"Hello, {name}!",
        Language.SPANISH: f"Hola, {name}!",
        Language.FRENCH: f"Bonjour, {name}!",
    }
    return greetings[language]
