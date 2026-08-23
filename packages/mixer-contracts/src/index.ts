import { PACKAGE_NAME as DOMAIN } from "@x32/domain";

/**
 * `MixerClient` interface, snapshot/event types and `MockMixerClient`.
 * Depends on domain types only — never the reverse.
 *
 * Scaffolding placeholder — replaced in plan step 4.
 */
export const PACKAGE_NAME = "@x32/mixer-contracts" as const;

/** Proves the workspace dependency edge resolves at typecheck time. */
export const UPSTREAM_PACKAGES = [DOMAIN] as const;
