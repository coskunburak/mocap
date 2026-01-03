
import React from "react";
import ErrorBoundary from "./ErrorBoundary";

export default function AppProviders({ children }: { children: React.ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}
