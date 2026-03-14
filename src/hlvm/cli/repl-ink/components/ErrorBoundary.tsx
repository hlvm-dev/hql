/**
 * React Error Boundary for conversation rendering.
 *
 * Catches rendering crashes in child components so the REPL continues
 * operating instead of crashing entirely.
 */

import React from "react";
import { Text } from "ink";

interface ErrorBoundaryProps {
  fallback?: React.ReactNode;
  children?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class RenderErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  declare props: ErrorBoundaryProps;
  declare state: ErrorBoundaryState;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <Text color="red">
          Render error: {this.state.error?.message ?? "Unknown error"}
        </Text>
      );
    }
    return this.props.children;
  }
}
