import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** what to show instead of the children once one of them has thrown */
  fallback: ReactNode;
  children: ReactNode;
}

/** Keeps a crash in the 3D scene or in drawing one run from unmounting the whole page. Reset it by changing its key. */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("live demo: a view failed", error, info.componentStack);
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
