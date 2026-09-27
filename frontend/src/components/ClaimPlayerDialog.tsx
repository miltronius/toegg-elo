import { useState } from "react";
import { createPortal } from "react-dom";
import { Trans, useTranslation } from "react-i18next";
import { linkErrorKey } from "../lib/playerLinking";

interface ClaimPlayerDialogProps {
  playerName: string;
  /** Performs the claim. A rejection keeps the dialog open with the reason. */
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

/**
 * Confirms a self-claim. Deliberately a second step: a claim can't be undone
 * by the claimer, so a misclick on "This is me" must not be enough. Carries
 * `modal-panel`, so the Win95 theme styles it with no markup of its own.
 *
 * Portalled to <body>: it opens from inside PlayerDetail's `.modal-panel`,
 * whose children Win95 gives side margins, which would shrink this overlay.
 * React events still bubble through the component tree, so PlayerDetail's
 * stopPropagation still keeps clicks here from closing it.
 */
export function ClaimPlayerDialog({
  playerName,
  onConfirm,
  onClose,
}: ClaimPlayerDialogProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(t(linkErrorKey(e) ?? "linking.unknownError"));
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
      onClick={onClose}
    >
      <div
        className="modal-panel bg-white rounded-xl shadow-2xl w-full max-w-md p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="claim-player-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="claim-player-title" className="text-xl font-bold mb-3">
          {t("linking.claimTitle")}
        </h2>
        <p className="mb-4">
          <Trans
            i18nKey="linking.claimBody"
            values={{ name: playerName }}
            components={{ b: <b /> }}
          />
        </p>
        {error && (
          <div
            role="alert"
            className="bg-error-light text-error px-4 py-3 rounded-md text-sm border-l-4 border-error mb-4"
          >
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            {t("linking.cancel")}
          </button>
          <button className="btn-primary" onClick={confirm} disabled={busy}>
            {busy ? t("linking.claiming") : t("linking.claimConfirm")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
