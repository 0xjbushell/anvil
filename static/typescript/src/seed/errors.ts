export class GreetingError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "GreetingError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
