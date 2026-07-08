import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import App from "./App";
import { setupAutoReloadOnUpdate } from "./utils/pwaUpdate";
import "./index.css";

setupAutoReloadOnUpdate();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
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
  </React.StrictMode>
);
