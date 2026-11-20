export class SchemaValidationError extends Error {
  constructor(label, errors = []) {
    super(`${label} is invalid${errors.length ? `: ${errors.map((error) => `${error.instanceLocation || '$'} ${error.error}`).join('; ')}` : ''}`);
    this.name = 'SchemaValidationError';
    this.errors = errors;
  }
}
