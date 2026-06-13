"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[ErrorBoundary] Uncaught error:", error);
    console.error("[ErrorBoundary] Component stack:", errorInfo.componentStack);
  }

  private handleGoHome = () => {
    // Clear session and navigate home
    if (typeof window !== "undefined") {
      sessionStorage.clear();
      window.location.href = "/";
    }
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="page-container flex-center flex-col gap-lg" style={{ justifyContent: "center" }}>
          <div className="section flex-col flex-center gap-md" style={{ textAlign: "center" }}>
            <div style={{ fontSize: "4rem", marginBottom: "0.5rem" }}>💥</div>
            <h1 className="title-lg">Something went wrong</h1>
            <p className="text-body text-muted" style={{ maxWidth: "360px" }}>
              An unexpected error occurred. Don&apos;t worry — your game data is
              safe in the cloud.
            </p>
            {this.state.error && (
              <details
                style={{
                  marginTop: "0.5rem",
                  padding: "12px",
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-color)",
                  width: "100%",
                  maxWidth: "400px",
                  textAlign: "left",
                }}
              >
                <summary
                  className="text-sm text-muted"
                  style={{ cursor: "pointer" }}
                >
                  Error details
                </summary>
                <pre
                  className="text-xs"
                  style={{
                    marginTop: "8px",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    color: "var(--accent-red)",
                  }}
                >
                  {this.state.error.message}
                </pre>
              </details>
            )}
            <button
              onClick={this.handleGoHome}
              className="btn btn--primary btn--full"
              style={{ maxWidth: "300px", marginTop: "1rem" }}
            >
              Go Back to Home
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
