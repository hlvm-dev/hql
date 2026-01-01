import { globalLogger as logger } from "../../logger.ts";
import { getErrorMessage } from "../../common/utils.ts";

export async function getNpmLatestVersion(
  name: string,
): Promise<string | null> {
  try {
    logger.debug &&
      logger.debug(`Fetching latest version for NPM package: ${name}`);

    const resp = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(name)}`,
    );
    if (!resp.ok) {
      if (resp.body) await resp.body.cancel();
      logger.debug &&
        logger.debug(`NPM registry returned status: ${resp.status}`);
      return null;
    }

    const data = await resp.json();

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
    logger.debug && logger.debug(`Error fetching NPM version: ${getErrorMessage(err)}`);
    return null;
  }
}

export async function getJsrLatestVersion(
  scope: string,
  name: string,
): Promise<string | null> {
  try {
    logger.debug &&
      logger.debug(
        `Fetching latest version for JSR package: @${scope}/${name}`,
      );

    const resp = await fetch(
      `https://jsr.io/api/packages/${encodeURIComponent(scope)}/${
        encodeURIComponent(name)
      }`,
    );
    if (!resp.ok) {
      if (resp.body) await resp.body.cancel();
      logger.debug &&
        logger.debug(`JSR registry returned status: ${resp.status}`);
      return null;
    }

    const data: { versions?: { version: string }[] } = await resp.json();

    if (data && Array.isArray(data.versions) && data.versions.length > 0) {
      const versions = data.versions.map((v) => v.version);
      versions.sort((a: string, b: string) =>
        a.localeCompare(b, undefined, { numeric: true })
      );
      const latestVersion = versions[versions.length - 1] || null;
      logger.debug &&
        logger.debug(`Found JSR latest version: ${latestVersion}`);
      return latestVersion;
    }

    logger.debug &&
      logger.debug(`No versions found for JSR package: @${scope}/${name}`);
    return null;
  } catch (err) {
    logger.debug && logger.debug(`Error fetching JSR version: ${getErrorMessage(err)}`);
    return null;
  }
}
