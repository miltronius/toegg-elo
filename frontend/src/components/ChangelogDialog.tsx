import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  inlineTokens,
  type ChangelogEntry,
  type Release,
} from "../lib/changelog";
import { DATE_LOCALE } from "../lib/i18n";

interface ChangelogDialogProps {
  releases: Release[];
  /** Scrolled to and highlighted; unknown versions are simply ignored. */
  focusVersion: string | null;
  onClose: () => void;
}

const formatDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString(DATE_LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

function InlineText({ text }: { text: string }) {
  return (
    <>
      {inlineTokens(text).map((token, i) =>
        token.kind === "code" ? (
          <code key={i}>{token.text}</code>
        ) : token.kind === "link" ? (
          <a key={i} href={token.href} target="_blank" rel="noreferrer">
            {token.text}
          </a>
        ) : (
          <span key={i}>{token.text}</span>
        ),
      )}
    </>
  );
}

function Entry({ entry }: { entry: ChangelogEntry }) {
  const { t } = useTranslation();
  return (
    <li className="changelog-entry">
      <InlineText text={entry.summary} />
      {entry.prUrl && (
        <>
          {" "}
          <a
            className="changelog-pr"
            href={entry.prUrl}
            target="_blank"
            rel="noreferrer"
          >
            #{entry.prNumber}
          </a>
        </>
      )}
      {entry.details && (
        <details className="changelog-details">
          <summary>{t("changelog.details")}</summary>
          <p className="whitespace-pre-line">
            <InlineText text={entry.details} />
          </p>
        </details>
      )}
    </li>
  );
}

/**
 * The in-app changelog, opened from the version chip in the header or from a
 * release banner. Reads the CHANGELOG.md bundled into this build (see
 * lib/appChangelog.ts). Entries are English only by design; only the chrome
 * is translated. A `modal-panel`, so Win95 gives it a title bar for free.
 */
export function ChangelogDialog({
  releases,
  focusVersion,
  onClose,
}: ChangelogDialogProps) {
  const { t } = useTranslation();
  const focusRef = useRef<HTMLElement>(null);

  useEffect(() => {
    // jsdom has no scrollIntoView.
    focusRef.current?.scrollIntoView?.({ block: "start" });
  }, [focusVersion]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      data-testid="changelog-backdrop"
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="changelog-title"
        className="modal-panel bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4 gap-3">
          <h2 id="changelog-title" className="text-xl font-bold">
            {t("changelog.title")}
          </h2>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            aria-label={t("changelog.close")}
          >
            ✕
          </button>
        </div>

        {releases.length === 0 ? (
          <p className="text-text-light">{t("changelog.empty")}</p>
        ) : (
          releases.map((release) => {
            const focused = release.version === focusVersion;
            return (
              <section
                key={release.version}
                ref={focused ? focusRef : undefined}
                className={`changelog-release${focused ? " changelog-release--focus" : ""}`}
              >
                <h3 className="changelog-version">
                  v{release.version}
                  {release.date && (
                    <span className="changelog-date">
                      {formatDate(release.date)}
                    </span>
                  )}
                </h3>
                {release.sections.map((section, i) => (
                  <div key={i}>
                    {(section.kind !== "other" || section.title) && (
                      <h4 className="changelog-kind">
                        {section.kind === "other"
                          ? section.title
                          : t(`changelog.kinds.${section.kind}`)}
                      </h4>
                    )}
                    <ul className="changelog-entries">
                      {section.entries.map((entry, j) => (
                        <Entry key={j} entry={entry} />
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
