export interface TokenSignerLike<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  sign(payload: TPayload, ttl: number): string | Promise<string>;
  verify(token: string): TPayload | null | Promise<TPayload | null>;
}
