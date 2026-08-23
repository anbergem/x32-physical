import { PACKAGE_NAME as DOMAIN } from "@x32/domain";
import { PACKAGE_NAME as INSTALLATION } from "@x32/installation";
import { PACKAGE_NAME as MIXER_CONTRACTS } from "@x32/mixer-contracts";
import { PACKAGE_NAME as PROTOCOL } from "@x32/protocol";

// Scaffolding placeholder — replaced by the schematic layout in plan step 6.
// The package list is rendered so the Vite build actually pulls the workspace
// packages in by source; it goes away with the rest of this component.
const WIRED_PACKAGES = [DOMAIN, INSTALLATION, MIXER_CONTRACTS, PROTOCOL];

export function App() {
  return (
    <main>
      <h1>X32 Physical Routing Visualizer</h1>
      <p>Wired packages: {WIRED_PACKAGES.join(", ")}</p>
    </main>
  );
}
