import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import * as Sentry from "@sentry/react";
import App from "./App";
import { setupAutoReloadOnUpdate } from "./utils/pwaUpdate";
import { initSentry } from "./utils/sentry";
import "./index.css";

setupAutoReloadOnUpdate();
initSentry();

function ErrorFallback() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center px-4">
      <div className="text-6xl mb-4">🏏</div>
      <h1 className="text-3xl font-bold text-gray-900 mb-2">Bowled out!</h1>
      <p className="text-gray-500 mb-6">Something went wrong. Try reloading the page.</p>
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
            style: { fontFamily: "Inter, sans-serif", fontSize: "14px" },
            success: { iconTheme: { primary: "#16a34a", secondary: "#fff" } },
          }}
        />
      </BrowserRouter>
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);
