import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MICA_PACKAGE_NAME = "@aliceshimada/mica";

function readMicaPackageVersion(): string {
  let directory = path.dirname(fileURLToPath(import.meta.url));

  while (true) {
    const packagePath = path.join(directory, "package.json");
    if (existsSync(packagePath)) {
      const metadata = JSON.parse(readFileSync(packagePath, "utf8")) as {
        name?: unknown;
        version?: unknown;
      };
      if (metadata.name === MICA_PACKAGE_NAME && typeof metadata.version === "string") {
        return metadata.version;
      }
    }

    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error(`Cannot find package.json for ${MICA_PACKAGE_NAME}`);
    }
    directory = parent;
  }
}

export const MICA_PACKAGE_VERSION = readMicaPackageVersion();
