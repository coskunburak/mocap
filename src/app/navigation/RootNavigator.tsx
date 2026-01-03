import React from "react";
import { routes } from "./routes";

let createBottomTabNavigator: typeof import("@react-navigation/bottom-tabs").createBottomTabNavigator;
try {
  createBottomTabNavigator = require("@react-navigation/bottom-tabs").createBottomTabNavigator;
  // eslint-disable-next-line no-console
  console.log("[Entry] bottom-tabs loaded");
} catch (e) {
  // eslint-disable-next-line no-console
  console.error("[Entry] bottom-tabs failed to load", e);
  throw e;
}

let NavigationContainer: typeof import("@react-navigation/native").NavigationContainer;
try {
  NavigationContainer = require("@react-navigation/native").NavigationContainer;
  // eslint-disable-next-line no-console
  console.log("[Entry] navigation native loaded");
} catch (e) {
  // eslint-disable-next-line no-console
  console.error("[Entry] navigation native failed to load", e);
  throw e;
}

let CaptureScreen: typeof import("../../features/capture/screens/CaptureScreen").default;
try {
  CaptureScreen = require("../../features/capture/screens/CaptureScreen").default;
  // eslint-disable-next-line no-console
  console.log("[Entry] CaptureScreen loaded");
} catch (e) {
  // eslint-disable-next-line no-console
  console.error("[Entry] CaptureScreen failed to load", e);
  throw e;
}

let ProjectsListScreen: typeof import("../../features/projects/screens/ProjectsListScreen").default;
try {
  ProjectsListScreen = require("../../features/projects/screens/ProjectsListScreen").default;
  // eslint-disable-next-line no-console
  console.log("[Entry] ProjectsListScreen loaded");
} catch (e) {
  // eslint-disable-next-line no-console
  console.error("[Entry] ProjectsListScreen failed to load", e);
  throw e;
}

let ExportsListScreen: typeof import("../../features/exports/screens/ExportsListScreen").default;
try {
  ExportsListScreen = require("../../features/exports/screens/ExportsListScreen").default;
  // eslint-disable-next-line no-console
  console.log("[Entry] ExportsListScreen loaded");
} catch (e) {
  // eslint-disable-next-line no-console
  console.error("[Entry] ExportsListScreen failed to load", e);
  throw e;
}

const Tab = createBottomTabNavigator();

export default function RootNavigator() {
  return (
    <NavigationContainer>
      <Tab.Navigator screenOptions={{ headerShown: true }}>
        <Tab.Screen name={routes.Capture} component={CaptureScreen} />
        <Tab.Screen name={routes.Projects} component={ProjectsListScreen} />
        <Tab.Screen name={routes.Exports} component={ExportsListScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
