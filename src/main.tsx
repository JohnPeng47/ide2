import { initializeTheme } from "./shared/theme/theme";
import { initializeColorOpacity } from "./shared/theme/colorOpacity";
import "./app/browserCrypto";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./app/styles/globals.css";

initializeTheme();
initializeColorOpacity();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
