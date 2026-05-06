export const routes = {
  Capture: "Capture",
  MultiViewSetup: "MultiViewSetup",
  ReviewHub: "ReviewHub",
  Projects: "Projects",
  ProjectDetail: "ProjectDetail",
  Review: "Review",
  Exports: "Exports",
  Export: "Export",
} as const;

export type RouteName = (typeof routes)[keyof typeof routes];
