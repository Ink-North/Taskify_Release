import React from "react";

/* Generic modal */
export function Modal({
  children,
  onClose,
  title,
  actions,
  showClose = true,
  variant = "default",
}: React.PropsWithChildren<{
  onClose: () => void;
  title?: React.ReactNode;
  actions?: React.ReactNode;
  showClose?: boolean;
  variant?: "default" | "fullscreen";
}>) {
  const backdropClass =
    variant === "fullscreen" ? "modal-backdrop modal-backdrop--fullscreen" : "modal-backdrop";
  const panelClass =
    variant === "fullscreen" ? "modal-panel modal-panel--fullscreen" : "modal-panel";
  const headerClass =
    variant === "fullscreen"
      ? "modal-panel__header modal-panel__header--spaced"
      : "modal-panel__header";
  const bodyClass =
    variant === "fullscreen"
      ? "modal-panel__body modal-panel__body--fullscreen"
      : "modal-panel__body";

  return (
    <div className={backdropClass}>
      <div className={panelClass}>
        {(title || actions || showClose) && (
          <div className={headerClass}>
            {title && <div className="text-lg font-semibold text-primary">{title}</div>}
            {(actions || showClose) && (
              <div className="ml-auto flex items-center gap-2">
                {actions}
                {showClose && (
                  <button className="ghost-button button-sm pressable" onClick={onClose}>
                    Close
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        <div className={bodyClass}>{children}</div>
      </div>
    </div>
  );
}
