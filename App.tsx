import React from "react";

let AppRoot: typeof import("./src/app/App").default;
try {
  AppRoot = require("./src/app/App").default;
  // eslint-disable-next-line no-console
  console.log("[Entry] AppRoot module loaded");
} catch (e) {
  // eslint-disable-next-line no-console
  console.error("[Entry] AppRoot module failed to load", e);
  throw e;
}

export default function App() {
  // eslint-disable-next-line no-console
  console.log("[Entry] App.tsx render");
  return <AppRoot />;
}
