import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { RefBufferProvider } from "./shared/references/RefBufferContext";
import "./app/styles/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RefBufferProvider>
      <App />
    </RefBufferProvider>
  </StrictMode>
);
