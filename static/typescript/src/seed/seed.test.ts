import { describe, expect, it } from "vitest";

import { MAX_NAME_LENGTH } from "./constants";
import { Language } from "./enums";
import { GreetingError } from "./errors";
import { isSupportedLanguage, seed } from "./seed";

describe("seed", () => {
  it("should return a greeting in the default language", () => {
    const result = seed("Alice");

    expect(result.greeting).toBe("Hello, Alice!");
    expect(result.name).toBe("Alice");
    expect(result.language).toBe(Language.English);
  });

  it("should return a greeting in the specified language", () => {
    const result = seed("Carlos", { language: Language.Spanish });

    expect(result.greeting).toBe("Hola, Carlos!");
    expect(result.language).toBe(Language.Spanish);
  });

  it("should include a timestamp in the result", () => {
    const before = Date.now();
    const result = seed("Bob");
    const after = Date.now();

    expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.timestamp.getTime()).toBeLessThanOrEqual(after);
  });

  it("should throw GreetingError for empty names", () => {
    expect(() => seed("")).toThrow(GreetingError);
  });

  it("should throw GreetingError for names exceeding the maximum length", () => {
    const longName = "a".repeat(MAX_NAME_LENGTH + 1);

    expect(() => seed(longName)).toThrow(GreetingError);
  });

  it("should throw GreetingError for names with surrounding whitespace", () => {
    expect(() => seed(" Alice")).toThrow(GreetingError);
  });

  it("should throw GreetingError for unsupported languages", () => {
    const options = { language: "zz" as Language };

    expect(() => seed("Alice", options)).toThrow(GreetingError);
  });

  it("should accept boundary-length names", () => {
    const maxName = "a".repeat(MAX_NAME_LENGTH);
    const result = seed(maxName);

    expect(result.name).toBe(maxName);
  });

  it("should identify supported languages", () => {
    expect(isSupportedLanguage(Language.French)).toBe(true);
    expect(isSupportedLanguage("zz")).toBe(false);
  });
});
