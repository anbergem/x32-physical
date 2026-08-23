/**
 * Ambient declarations for the non-TS imports the Vite build understands.
 * Declared here rather than pulled from `vite/client` so the app's tsconfig
 * keeps `"types": []` and picks up no global type surface by accident.
 */

/** `import text from "./file.yaml?raw"` — Vite inlines the file as a string. */
declare module "*?raw" {
  const content: string;
  export default content;
}

/** Side-effect stylesheet imports. */
declare module "*.css";
