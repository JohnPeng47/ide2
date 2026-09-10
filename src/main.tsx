import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { RefBufferProvider } from "./core/ref-buffer/RefBufferContext";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RefBufferProvider>
      <App />
    </RefBufferProvider>
  </StrictMode>
);
