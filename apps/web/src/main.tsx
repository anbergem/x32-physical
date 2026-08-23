import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";

const container = document.getElementById("root");
if (container === null) {
  throw new Error('Missing mount point: no element with id "root"');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
