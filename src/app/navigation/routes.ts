export const routes = {
  Capture: "Capture",
  MultiViewSetup: "MultiViewSetup",
  ReviewHub: "ReviewHub",
  Projects: "Projects",
  ProjectDetail: "ProjectDetail",
  Review: "Review",
  UploadProgress: "UploadProgress",
  ProcessingStatus: "ProcessingStatus",
  Exports: "Exports",
  Export: "Export",
  ExportResult: "ExportResult",
} as const;

export type RouteName = (typeof routes)[keyof typeof routes];
