import type { Language } from "./enums";

export interface GreetingOptions {
  language?: Language;
}

export interface GreetingResult {
  greeting: string;
  language: Language;
  name: string;
  timestamp: Date;
}
