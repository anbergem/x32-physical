/**
 * Zod schema + YAML loader producing a domain `Installation`, plus the
 * comment-preserving edit layer (issue #27): typed operations, the document
 * repository seam, and the write pipeline both the bridge and the web app run.
 * The topology model does not know YAML exists.
 *
 * This entry point is browser-safe. File loading (`loadInstallationFile`) and
 * the disk-backed repository live behind the `@x32/installation/node` subpath
 * and in the bridge respectively, so web bundles never reach for `node:fs`.
 */

export { parseInstallationYaml } from "./parse";

export type { DeviceDocument, InstallationDocument } from "./schema";
export { installationDocumentSchema } from "./schema";

export type {
  AddConnectionOperation,
  AddDeviceOperation,
  ConnectionEnd,
  DeviceFieldEdit,
  InstallationOperation,
  RemoveConnectionOperation,
  RemoveDeviceOperation,
  SetDeviceGroupOperation,
  SetDeviceFieldOperation,
  SetDeviceLabelOperation,
  SetSocketAnnotationOperation,
} from "./operations";
export {
  applyOperation,
  describeOperation,
  INSTALLATION_OPERATION_KINDS,
  parseInstallationOperation,
} from "./operations";

export type {
  InstallationFileState,
  InstallationRepository,
} from "./repository";
export {
  InMemoryInstallationRepository,
  InstallationVersionConflictError,
  installationFileState,
  installationVersion,
} from "./repository";

export type { InstallationEditResult } from "./edit";
export {
  applyInstallationEdit,
  editInstallationText,
  STALE_BASE_VERSION_REASON,
} from "./edit";
