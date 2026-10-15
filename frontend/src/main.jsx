import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import * as Sentry from "@sentry/react";
import App from "./App";
import { setupAutoReloadOnUpdate } from "./utils/pwaUpdate";
import { initSentry } from "./utils/sentry";
import "@fontsource/barlow-condensed/latin-700.css";
import "@fontsource/barlow-condensed/latin-800.css";
import "./index.css";

setupAutoReloadOnUpdate();
initSentry();

function ErrorFallback() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center px-4">
      <h1 className="text-3xl font-bold text-brand-ink mb-2">Bowled out!</h1>
      <p className="text-brand-muted mb-6">Something went wrong. Try reloading the page.</p>
      <button onClick={() => window.location.reload()} className="btn-primary">Reload</button>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      <BrowserRouter>
        <App />
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 3500,
            style: { fontSize: "15px", fontWeight: 600, color: "#0f172a" },
            success: { iconTheme: { primary: "#14632f", secondary: "#fff" } },
          }}
        />
      </BrowserRouter>
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);
