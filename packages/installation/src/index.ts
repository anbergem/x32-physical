import { PACKAGE_NAME as DOMAIN } from "@x32/domain";

/**
 * Zod schema + YAML loader producing a domain `Installation`.
 * The topology model does not know YAML exists.
 *
 * Scaffolding placeholder — replaced in plan step 3.
 */
export const PACKAGE_NAME = "@x32/installation" as const;

/** Proves the workspace dependency edge resolves at typecheck time. */
export const UPSTREAM_PACKAGES = [DOMAIN] as const;
