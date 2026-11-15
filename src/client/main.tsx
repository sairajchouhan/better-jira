/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/client/index.html`.
 */

import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "./App";
import { Tooltip } from "./components/tooltip";
import { ignoreBenignErrors } from "./lib/benign-errors";
import { handOverBootShell } from "./boot-shell";
import { AppError, ErrorBoundary } from "./components/error-boundary";

ignoreBenignErrors(window);

const elem = document.getElementById("root")!;
// Watching starts before the first render, so the shell goes as soon as the app paints its first screen.
handOverBootShell(elem);
const app = (
  <StrictMode>
    {/* A render error anywhere, boot included, shows what failed instead of an empty page or a stuck splash. */}
    <ErrorBoundary fallback={<AppError />}>
      {/* The page's one tooltip state: every title tooltip, hover card and edge tooltip below shares it. */}
      <Tooltip.Provider>
        <App />
      </Tooltip.Provider>
    </ErrorBoundary>
  </StrictMode>
);

// https://bun.com/docs/bundler/hot-reloading#import-meta-hot-data
type HotData = { root?: Root };
((import.meta.hot.data as HotData).root ??= createRoot(elem)).render(app);
