export class RequestError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "RequestError";
  }
}

export function requestErrorStatus(error: unknown) {
  return error instanceof RequestError ? error.status : 400;
}
