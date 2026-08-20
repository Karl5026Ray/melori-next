import type { DetailedHTMLProps, HTMLAttributes } from "react";

// @google/model-viewer registers a <model-viewer> custom element at import
// time; it has no React component wrapper, so JSX needs this intrinsic
// element typed explicitly or every usage fails TypeScript's JSX check.
type ModelViewerJSXAttributes = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  src?: string;
  alt?: string;
  ar?: boolean;
  "auto-rotate"?: boolean;
  "camera-controls"?: boolean;
  autoplay?: boolean;
  "disable-zoom"?: boolean;
  "interaction-prompt"?: string;
  loading?: "auto" | "lazy" | "eager";
  reveal?: "auto" | "interaction" | "manual";
};

// React 19's automatic JSX runtime resolves JSX.IntrinsicElements through
// `react/jsx-runtime`, which re-exports the JSX namespace from "react"
// itself — augmenting the old bare global `JSX` namespace has no effect
// under this project's config, so this augments the "react" module instead.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": ModelViewerJSXAttributes;
    }
  }
}

export {};
