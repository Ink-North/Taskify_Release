import React from "react";

interface DocumentContent {
  type: "html" | "text";
  data: string;
}

export function DocumentViewer({ content }: { content: DocumentContent }) {
  return (
    <div className="h-full overflow-auto rounded-[28px] bg-[#15161a] [touch-action:auto]">
      <div className="flex min-h-full items-start justify-center p-4">
        <div className="w-full max-w-4xl rounded-[28px] bg-white px-6 py-8 text-[#111827] shadow-2xl">
          {content.type === "html" ? (
            <div className="doc-modal__markup doc-modal__markup--rich" dangerouslySetInnerHTML={{ __html: content.data }} />
          ) : (
            <pre className="doc-modal__text whitespace-pre-wrap break-words text-[15px] leading-7 text-[#111827]">{content.data}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
