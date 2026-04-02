import React from "react";
import { ZoomPane } from "./ZoomPane";

/**
 * Spreadsheet viewer for xlsx files. Renders the HTML table generated from
 * the workbook with zoom/pan support. All sticky positioning is explicitly
 * suppressed so headers scroll naturally with the content.
 */
export function SpreadsheetViewer({ html }: { html: string }) {
  return (
    <ZoomPane baseWidth={1200} maxScale={4}>
      {/* Suppress any sticky/fixed positioning on table headers/rows */}
      <style>{`
        .spreadsheet-viewer th,
        .spreadsheet-viewer td,
        .spreadsheet-viewer tr,
        .spreadsheet-viewer thead {
          position: static !important;
        }
      `}</style>
      <div
        className="spreadsheet-viewer rounded-[22px] bg-white p-4 shadow-2xl"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </ZoomPane>
  );
}
