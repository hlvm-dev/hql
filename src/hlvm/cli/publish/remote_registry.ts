import { globalLogger as logger } from "../../../logger.ts";
import { getErrorMessage } from "../../../common/utils.ts";
import { http, HttpError } from "../../../common/http-client.ts";

interface NpmRegistryResponse {
  "dist-tags"?: { latest?: string };
  versions?: Record<string, unknown>;
}

export async function getNpmLatestVersion(
  name: string,
): Promise<string | null> {
  try {
    logger.debug &&
      logger.debug(`Fetching latest version for NPM package: ${name}`);

    // SSOT: use http client for external HTTP calls
    const data = await http.get<NpmRegistryResponse>(
      `https://registry.npmjs.org/${encodeURIComponent(name)}`,
    );

    if (data && data["dist-tags"] && data["dist-tags"].latest) {
      const version = data["dist-tags"].latest;
      logger.debug && logger.debug(`Found NPM latest version: ${version}`);
      return version;
    }

    if (data && data.versions && typeof data.versions === "object") {
      const versions = Object.keys(data.versions);
      versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const highestVersion = versions[versions.length - 1] || null;
      logger.debug &&
        logger.debug(`Found NPM highest version: ${highestVersion}`);
      return highestVersion;
    }

    logger.debug && logger.debug(`No versions found for NPM package: ${name}`);
    return null;
  } catch (err) {
    // Handle HTTP errors (e.g., 404 not found)
    if (err instanceof HttpError) {
      logger.debug && logger.debug(`NPM registry returned status: ${err.status}`);
      return null;
    }
    logger.debug && logger.debug(`Error fetching NPM version: ${getErrorMessage(err)}`);
    return null;
  }
}
