/**
 * LSP Document Manager
 *
 * Manages open documents and their analysis results.
 * Implements debouncing to avoid excessive re-parsing during rapid typing.
 */

import type { TextDocument } from "npm:vscode-languageserver-textdocument@1.0.11";
import { analyzeDocument, type AnalysisResult } from "./analysis.ts";

/** Debounce delay in milliseconds */
const DEBOUNCE_MS = 200;

/**
 * State for each open document
 */
interface DocumentState {
  /** The text document */
  document: TextDocument;
  /** Latest analysis result (may be from before most recent edit) */
  analysis: AnalysisResult | null;
  /** Timer ID for pending analysis */
  pendingAnalysis: ReturnType<typeof setTimeout> | null;
  /** Version of document when analysis was last run */
  analyzedVersion: number;
}

/**
 * Callback type for analysis completion
 */
export type AnalysisCallback = (uri: string, result: AnalysisResult) => void;

/**
 * Document Manager
 *
 * Tracks open documents and manages their analysis lifecycle.
 * Automatically debounces analysis to prevent excessive parsing.
 */
export class DocumentManager {
  private documents = new Map<string, DocumentState>();
  private onAnalysisComplete?: AnalysisCallback;

  /**
   * Set callback to be notified when analysis completes
   */
  setAnalysisCallback(callback: AnalysisCallback): void {
    this.onAnalysisComplete = callback;
  }

  /**
   * Called when a document is opened
   */
  open(document: TextDocument): void {
    this.documents.set(document.uri, {
      document,
      analysis: null,
      pendingAnalysis: null,
      analyzedVersion: -1,
    });
    this.scheduleAnalysis(document.uri);
  }

  /**
   * Called when a document is changed
   */
  update(document: TextDocument): void {
    const state = this.documents.get(document.uri);
    if (state) {
      state.document = document;
      this.scheduleAnalysis(document.uri);
    } else {
      // Document wasn't tracked, open it
      this.open(document);
    }
  }

  /**
   * Called when a document is closed
   */
  close(uri: string): void {
    const state = this.documents.get(uri);
    if (state?.pendingAnalysis) {
      clearTimeout(state.pendingAnalysis);
    }
    this.documents.delete(uri);
  }

  /**
   * Get the latest analysis result for a document
   */
  getAnalysis(uri: string): AnalysisResult | null {
    return this.documents.get(uri)?.analysis ?? null;
  }

  /**
   * Get the text document for a URI
   */
  getDocument(uri: string): TextDocument | null {
    return this.documents.get(uri)?.document ?? null;
  }

  /**
   * Get all tracked document URIs
   */
  getAllUris(): string[] {
    return Array.from(this.documents.keys());
  }

  /**
   * Schedule analysis after debounce period
   */
  private scheduleAnalysis(uri: string): void {
    const state = this.documents.get(uri);
    if (!state) return;

    // Cancel existing pending analysis
    if (state.pendingAnalysis) {
      clearTimeout(state.pendingAnalysis);
    }

    // Schedule new analysis
    state.pendingAnalysis = setTimeout(() => {
      this.runAnalysis(uri);
    }, DEBOUNCE_MS);
  }

  /**
   * Run analysis on a document
   */
  private runAnalysis(uri: string): void {
    const state = this.documents.get(uri);
    if (!state) return;

    state.pendingAnalysis = null;

    // Skip if already analyzed this version
    if (state.analyzedVersion === state.document.version) {
      return;
    }

    // Get file path from URI
    const filePath = uriToFilePath(uri);

    // Run analysis
    const text = state.document.getText();
    state.analysis = analyzeDocument(text, filePath);
    state.analyzedVersion = state.document.version;

    // Notify callback
    if (this.onAnalysisComplete) {
      this.onAnalysisComplete(uri, state.analysis);
    }
  }
}

/**
 * Convert a file:// URI to a local file path
 */
export function uriToFilePath(uri: string): string {
  if (uri.startsWith("file://")) {
    // Handle Windows paths (file:///C:/...)
    const path = uri.slice(7);
    if (path.match(/^\/[A-Za-z]:/)) {
      return path.slice(1); // Remove leading slash for Windows
    }
    return path;
  }
  return uri;
}

/**
 * Convert a local file path to a file:// URI
 */
export function filePathToUri(filePath: string): string {
  // Handle Windows paths
  if (filePath.match(/^[A-Za-z]:/)) {
    return `file:///${filePath.replace(/\\/g, "/")}`;
  }
  return `file://${filePath}`;
}
