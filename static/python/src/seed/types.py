"""Type definitions for greeting operations."""

from typing import TypedDict


class SeedResult(TypedDict):
    """Result returned after generating a greeting."""

    message: str
    name: str
    language: str
