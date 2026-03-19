export interface TokenSigner<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  sign(payload: TPayload, ttl: number): string;
  verify(token: string): TPayload | null;
}
