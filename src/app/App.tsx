import React from "react";

let AppProviders: typeof import("./providers/AppProviders").default;
try {
  AppProviders = require("./providers/AppProviders").default;
  // eslint-disable-next-line no-console
  console.log("[Entry] AppProviders module loaded");
} catch (e) {
  // eslint-disable-next-line no-console
  console.error("[Entry] AppProviders module failed to load", e);
  throw e;
}

let RootNavigator: typeof import("./navigation/RootNavigator").default;
try {
  RootNavigator = require("./navigation/RootNavigator").default;
  // eslint-disable-next-line no-console
  console.log("[Entry] RootNavigator module loaded");
} catch (e) {
  // eslint-disable-next-line no-console
  console.error("[Entry] RootNavigator module failed to load", e);
  throw e;
}

export default function AppRoot() {
  return (
    <AppProviders>
      <RootNavigator />
    </AppProviders>
  );
}
