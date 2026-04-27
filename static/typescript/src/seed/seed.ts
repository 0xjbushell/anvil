import pino from "pino";

import { DEFAULT_LANGUAGE, GREETINGS, MAX_NAME_LENGTH, MIN_NAME_LENGTH } from "./constants";
import { Language } from "./enums";
import { GreetingError } from "./errors";
import type { GreetingOptions, GreetingResult } from "./types";

const logger = pino({
  name: "seed",
  level: process.env.NODE_ENV === "test" ? "silent" : "info",
});
const supportedLanguages = new Set<string>(Object.values(Language));

export function isSupportedLanguage(value: string): value is Language {
  return value.length > 0 && supportedLanguages.has(value);
}

function validateName(name: string): void {
  if (name.length < MIN_NAME_LENGTH) {
    throw new GreetingError("Name is too short", "INVALID_NAME");
  }

  if (name.length > MAX_NAME_LENGTH) {
    throw new GreetingError("Name exceeds maximum length", "NAME_TOO_LONG");
  }

  if (name.trim() !== name) {
    throw new GreetingError("Name must not have leading or trailing whitespace", "INVALID_FORMAT");
  }
}

function resolveGreeting(language: Language): string {
  if (!isSupportedLanguage(language)) {
    throw new GreetingError(`Unsupported language: ${language}`, "UNSUPPORTED_LANGUAGE");
  }

  const greeting = GREETINGS[language];
  if (!greeting) {
    throw new GreetingError(`Unsupported language: ${language}`, "UNSUPPORTED_LANGUAGE");
  }

  return greeting;
}

export function seed(name: string, options: GreetingOptions = {}): GreetingResult {
  const language = options.language ?? DEFAULT_LANGUAGE;
  validateName(name);

  const greeting = resolveGreeting(language);
  const result: GreetingResult = {
    greeting: `${greeting}, ${name}!`,
    language,
    name,
    timestamp: new Date(),
  };

  logger.info({ name, language }, "greeting generated");
  return result;
}
