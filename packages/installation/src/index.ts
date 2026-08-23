/**
 * Zod schema + YAML loader producing a domain `Installation`.
 * The topology model does not know YAML exists.
 *
 * This entry point is browser-safe. File loading (`loadInstallationFile`)
 * lives behind the `@x32/installation/node` subpath so web bundles never
 * reach for `node:fs`.
 */

export { parseInstallationYaml } from "./parse";

export type { DeviceDocument, InstallationDocument } from "./schema";
export { installationDocumentSchema } from "./schema";
