"use client";

import { X } from "lucide-react";
import type { CaptureErrorInfo } from "@/lib/mediaCapture";

// Visible, dismissible, non-modal replacement for the `alert()` calls that used
// to report a blocked camera/microphone. alert() is invisible to screen readers
// as a live region, blocks the page, cannot be styled, and — the actual bug —
// dismissing it left the user with no idea how to un-block the permission.
//
// Rendered as an assertive live region so the failure is announced, and it
// carries the per-browser recovery steps from formatCaptureError().
export function MediaPermissionNotice({
  info,
  onDismiss,
  testId = "media-permission-notice",
  className = "",
}: {
  info: CaptureErrorInfo;
  onDismiss?: () => void;
  testId?: string;
  className?: string;
}) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid={testId}
      data-error-kind={info.kind}
      className={`rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-left ${className}`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p
            className="text-sm font-semibold text-red-200"
            data-testid={`${testId}-title`}
          >
            {info.title}
          </p>
          <p className="mt-1 text-sm text-red-100/80" data-testid={`${testId}-message`}>
            {info.message}
          </p>
          {info.steps.length > 0 && (
            <ul
              className="mt-2 list-disc space-y-1 pl-5 text-xs text-red-100/70"
              data-testid={`${testId}-steps`}
            >
              {info.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          )}
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            data-testid={`${testId}-dismiss`}
            className="shrink-0 rounded-full p-1 text-red-200/80 transition hover:bg-red-500/20 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
