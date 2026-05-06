import React from "react";
import { Text, View } from "react-native";
import { NavigationContainer, type Theme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import CaptureScreen from "../../features/capture/screens/CaptureScreen";
import MultiViewSetupScreen from "../../features/capture/screens/MultiViewSetupScreen";
import ExportScreen from "../../features/exports/screens/ExportScreen";
import ExportsListScreen from "../../features/exports/screens/ExportsListScreen";
import ProjectDetailScreen from "../../features/projects/screens/ProjectDetailScreen";
import ProjectsListScreen from "../../features/projects/screens/ProjectsListScreen";
import ReviewHubScreen from "../../features/review/screens/ReviewHubScreen";
import TakeReviewScreen from "../../features/review/screens/TakeReviewScreen";
import { colors, radii, spacing, typography } from "../../ui/theme";
import { routes } from "./routes";

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const TAB_LABELS: Record<string, string> = {
  [routes.Capture]: "Capture",
  [routes.ReviewHub]: "Review",
  [routes.Projects]: "Projects",
  [routes.Exports]: "Exports",
};

const navigationTheme: Theme = {
  dark: true,
  colors: {
    primary: colors.accent,
    background: colors.background,
    card: colors.surface,
    text: colors.textPrimary,
    border: colors.border,
    notification: colors.danger,
  },
  fonts: {
    regular: {
      fontFamily: typography.families.body ?? "System",
      fontWeight: "500",
    },
    medium: {
      fontFamily: typography.families.body ?? "System",
      fontWeight: "600",
    },
    bold: {
      fontFamily: typography.families.display ?? "System",
      fontWeight: "700",
    },
    heavy: {
      fontFamily: typography.families.display ?? "System",
      fontWeight: "800",
    },
  },
};

function TabLabel({ label, focused }: { label: string; focused: boolean }) {
  return (
    <View style={{ alignItems: "center", gap: 6 }}>
      <Text
        style={[
          typography.label.sm,
          {
            color: focused ? colors.textPrimary : colors.textMuted,
            letterSpacing: 1.2,
          },
        ]}
      >
        {label}
      </Text>
      <View
        style={{
          width: focused ? 26 : 10,
          height: 4,
          borderRadius: radii.pill,
          backgroundColor: focused ? colors.accent : colors.line,
        }}
      />
    </View>
  );
}

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarStyle:
          route.name === routes.Capture
            ? { display: "none" }
            : {
                position: "absolute",
                left: spacing.md,
                right: spacing.md,
                bottom: spacing.sm,
                height: 62,
                paddingTop: 6,
                paddingBottom: 8,
                paddingHorizontal: spacing.xs,
                borderRadius: radii.pill,
                borderTopWidth: 0,
                backgroundColor: "rgba(0,0,0,0.88)",
                shadowColor: colors.black,
                shadowOpacity: 0.34,
                shadowRadius: 18,
                shadowOffset: { width: 0, height: 10 },
                elevation: 14,
              },
        tabBarItemStyle: {
          borderRadius: radii.pill,
        },
        tabBarLabel: ({ focused }) => (
          <TabLabel label={TAB_LABELS[route.name] ?? route.name} focused={focused} />
        ),
      })}
    >
      <Tab.Screen name={routes.Capture} component={CaptureScreen} />
      <Tab.Screen name={routes.ReviewHub} component={ReviewHubScreen} />
      <Tab.Screen name={routes.Projects} component={ProjectsListScreen} />
      <Tab.Screen name={routes.Exports} component={ExportsListScreen} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Tabs" component={Tabs} />
        <Stack.Screen
          name={routes.ProjectDetail}
          component={ProjectDetailScreen}
        />
        <Stack.Screen name={routes.Review} component={TakeReviewScreen} />
        <Stack.Screen name={routes.Export} component={ExportScreen} />
        <Stack.Screen
          name={routes.MultiViewSetup}
          component={MultiViewSetupScreen}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
