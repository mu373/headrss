import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_ENVIRONMENT_NAME = "default";
const ENVIRONMENT_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

interface ProfileState {
  environmentConfigDir: string;
  environmentName: string;
  environmentEnvFilePath: string;
  legacyTokenCachePath: string;
  tokenCachePath: string;
}

let profileState: ProfileState | undefined;

export function initProfile(cliEnvName?: string): void {
  const environmentName = resolveEnvironmentName(cliEnvName);
  const configHome = resolveConfigHome();
  const headrssConfigDir = join(configHome, "headrss");
  const environmentConfigDir = join(
    headrssConfigDir,
    "environments",
    environmentName,
  );

  profileState = {
    environmentConfigDir,
    environmentEnvFilePath: join(environmentConfigDir, "env"),
    environmentName,
    legacyTokenCachePath: join(headrssConfigDir, "token.json"),
    tokenCachePath: join(environmentConfigDir, "token.json"),
  };
}

export function getEnvironmentName(): string {
  return getProfileState().environmentName;
}

export function getEnvironmentConfigDir(): string {
  return getProfileState().environmentConfigDir;
}

export function getTokenCachePath(): string {
  return getProfileState().tokenCachePath;
}

export function getEnvironmentEnvFilePath(): string {
  return getProfileState().environmentEnvFilePath;
}

export function getLegacyTokenCachePath(): string {
  return getProfileState().legacyTokenCachePath;
}

function getProfileState(): ProfileState {
  if (profileState === undefined) {
    throw new Error("Profile is not initialized.");
  }

  return profileState;
}

function resolveEnvironmentName(cliEnvName?: string): string {
  const environmentName =
    cliEnvName ?? process.env.HEADRSS_ENV ?? DEFAULT_ENVIRONMENT_NAME;

  if (!ENVIRONMENT_NAME_PATTERN.test(environmentName)) {
    throw new Error(
      `Invalid environment name "${environmentName}". Expected only letters, numbers, "_" or "-".`,
    );
  }

  return environmentName;
}

function resolveConfigHome(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  if (xdgConfigHome !== undefined && xdgConfigHome.length > 0) {
    return xdgConfigHome;
  }

  return join(homedir(), ".config");
}
