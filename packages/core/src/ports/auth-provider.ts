export interface AuthValidationResult {
  userId: number;
  appPasswordId: number;
  passwordVersion: number;
}

export interface AuthProvider {
  validateCredentials(
    username: string,
    password: string,
  ): Promise<AuthValidationResult | null>;
  validatePasswordVersion(
    userId: number,
    appPasswordId: number,
    passwordVersion: number,
  ): Promise<boolean>;
}
