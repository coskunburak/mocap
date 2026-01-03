import { registerRootComponent } from "expo";

let App: typeof import("./App").default;
try {
  App = require("./App").default;
  // eslint-disable-next-line no-console
  console.log("[Entry] App module loaded");
} catch (e) {
  // eslint-disable-next-line no-console
  console.error("[Entry] App module failed to load", e);
  throw e;
}

// eslint-disable-next-line no-console
console.log("[Entry] index.ts loaded");

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
