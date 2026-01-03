export const routes = {
  Capture: "Capture",
  Projects: "Projects",
  Exports: "Exports",
} as const;

export type RouteName = (typeof routes)[keyof typeof routes];
