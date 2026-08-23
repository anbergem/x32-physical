import { PACKAGE_NAME as DOMAIN } from "@x32/domain";
import { PACKAGE_NAME as MIXER_CONTRACTS } from "@x32/mixer-contracts";
import { PACKAGE_NAME as PROTOCOL } from "@x32/protocol";

// Scaffolding placeholder — replaced by the schematic layout in plan step 6.
// The package list is rendered so the Vite build actually pulls the remaining
// placeholder packages in by source; it goes away with the rest of this
// component. `@x32/installation` is no longer a placeholder and is absent by
// design: the web app takes schema *types* only from it (architecture.md §2).
const WIRED_PACKAGES = [DOMAIN, MIXER_CONTRACTS, PROTOCOL];

export function App() {
  return (
    <main>
      <h1>X32 Physical Routing Visualizer</h1>
      <p>Wired packages: {WIRED_PACKAGES.join(", ")}</p>
    </main>
  );
}
