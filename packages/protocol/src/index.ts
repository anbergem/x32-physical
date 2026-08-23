import { PACKAGE_NAME as DOMAIN } from "@x32/domain";
import { PACKAGE_NAME as MIXER_CONTRACTS } from "@x32/mixer-contracts";

/**
 * WebSocket message types shared between bridge and web app. No hand-duplicated
 * JSON shapes — the wire types reuse domain and mixer-contracts types.
 *
 * Scaffolding placeholder — replaced in plan step 9.
 */
export const PACKAGE_NAME = "@x32/protocol" as const;

/** Proves the workspace dependency edges resolve at typecheck time. */
export const UPSTREAM_PACKAGES = [DOMAIN, MIXER_CONTRACTS] as const;
