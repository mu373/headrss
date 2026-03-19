export type AppEnv = {
  Bindings: {
    DB: D1Database;
    TOKEN_KEY: string;
    CREDENTIAL_KEY: string;
    INGEST_API_KEY: string;
    FETCH_API_KEY: string;
    ADMIN_API_KEY: string;
  };
  Variables: {
    userId: number;
    appPasswordId: number;
    passwordVersion: number;
  };
};
