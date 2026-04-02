import React from "react";
import { ZoomPane } from "./ZoomPane";

interface DocumentContent {
  type: "html" | "text";
  data: string;
}

/**
 * Document viewer for md, docx, txt, json, csv.
 * HTML content (md/docx) is rendered as rich markup; text (txt/json/csv)
 * is rendered as pre-formatted monospace. Both support zoom and pan.
 */
export function DocumentViewer({ content }: { content: DocumentContent }) {
  const inner =
    content.type === "html" ? (
      <div
        className="doc-modal__markup doc-modal__markup--rich"
        dangerouslySetInnerHTML={{ __html: content.data }}
      />
    ) : (
      <pre className="doc-modal__text whitespace-pre-wrap text-[15px] leading-7 text-[#111827]">
        {content.data}
      </pre>
    );

  return (
    <ZoomPane
      baseWidth={1100}
      maxScale={4}
      pageClassName="rounded-[28px] bg-white px-6 py-8 text-[#111827] shadow-2xl"
    >
      {inner}
    </ZoomPane>
  );
}
