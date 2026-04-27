import { Language } from "./enums";

export const MAX_NAME_LENGTH = 100;
export const MIN_NAME_LENGTH = 1;
export const DEFAULT_LANGUAGE = Language.English;

export const GREETINGS: Record<Language, string> = {
  [Language.English]: "Hello",
  [Language.Spanish]: "Hola",
  [Language.French]: "Bonjour",
  [Language.German]: "Hallo",
};
