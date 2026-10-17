// An expected "no" with words a person can read. The route layer turns it into a response.
export type RefusalStatus = 400 | 401 | 403 | 404 | 409 | 410 | 413
export class Refusal extends Error {
  constructor(message: string, public status: RefusalStatus = 403) { super(message) }
}
