// src/AnnouncementModal.jsx
import React, { useEffect, useRef } from "react";

/**
 * AnnouncementModal - modern, themed full-screen modal
 * Exports:
 *   - named export: AnnouncementModal
 *   - default export: AnnouncementModal
 *
 * Props:
 *  - isOpen: boolean
 *  - onClose: function
 */
export function AnnouncementModal({ isOpen, onClose }) {
  const modalRef = useRef(null);
  const firstButtonRef = useRef(null);

  // keyboard: Escape to close, Tab trap to first button
  useEffect(() => {
    if (!isOpen) return;

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab") {
        // keep focus inside modal (simple trap: always move focus to first button)
        const active = document.activeElement;
        const inModal = modalRef.current?.contains(active);
        if (!inModal) {
          e.preventDefault();
          firstButtonRef.current?.focus();
        }
      }
    };

    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // prevent background scroll

    // focus first actionable item
    setTimeout(() => firstButtonRef.current?.focus(), 0);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, onClose]);

  // click outside to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (ev) => {
      if (modalRef.current && !modalRef.current.contains(ev.target)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      <style>{`
        .ann-overlay {
          position: fixed;
          inset: 0;
          background: rgba(6,8,12,0.55);
          backdrop-filter: blur(10px) saturate(120%);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          animation: ann-fade .18s ease-out;
        }

        @keyframes ann-fade {
          from { opacity: 0; transform: translateY(6px) scale(0.995); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        .ann-card {
          width: min(980px, 96%);
          max-height: calc(100vh - 48px);
          overflow: auto;
          border-radius: 14px;
          padding: 22px;
          box-shadow: 0 18px 40px rgba(0,0,0,0.55);
          border: 1px solid var(--theme-border);
          background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01));
          color: var(--theme-text);
          position: relative;
          transition: transform 150ms ease;
        }

        .ann-header {
          display:flex;
          gap:12px;
          align-items:center;
          margin-bottom: 8px;
        }
        .ann-icon {
          width:44px;
          height:44px;
          border-radius:10px;
          display:flex;
          align-items:center;
          justify-content:center;
          border: 1px solid rgba(255,255,255,0.03);
          flex-shrink:0;
        }
        .ann-title {
          font-size:18px;
          font-weight:700;
          color:var(--theme-text);
        }
        .ann-sub {
          font-size:13px;
          color:rgba(255,255,255,0.85);
        }

        .ann-body {
          margin-top: 8px;
          font-size:14px;
          color: var(--theme-text);
          line-height:1.45;
        }

        .ann-notes {
          margin-top:14px;
          padding:12px;
          border-radius:10px;
          background: rgba(255,255,255,0.02);
          border: 1px solid var(--theme-border);
          color: var(--theme-text);
        }
        .ann-notes ul { margin:0; padding-left:18px; }
        .ann-note-title { font-weight:600; margin-bottom:8px; }

        .ann-actions {
          display:flex;
          gap:10px;
          justify-content:flex-end;
          margin-top:16px;
        }

        .ann-btn {
          background: rgba(255,255,255,0.06);
          color: var(--theme-text);
          border: 1px solid rgba(255,255,255,0.06);
          padding: 8px 14px;
          border-radius: 10px;
          cursor: pointer;
          font-weight:600;
        }
        .ann-btn.primary {
          background: linear-gradient(90deg, rgba(255,255,255,0.08), rgba(255,255,255,0.06));
          border: 1px solid rgba(255,255,255,0.08);
        }
        .ann-btn:focus { outline: 2px solid rgba(255,255,255,0.08); outline-offset: 2px; }

        .ann-close {
          position:absolute;
          right:12px;
          top:10px;
          width:36px;
          height:36px;
          border-radius:8px;
          border: none;
          background: transparent;
          color: var(--theme-text);
          font-size:20px;
          cursor:pointer;
        }

        @media (max-width:640px) {
          .ann-card { padding:16px; border-radius:10px; }
          .ann-title { font-size:16px; }
          .ann-sub { font-size:12px; }
        }
      `}</style>

      <div className="ann-overlay" role="dialog" aria-modal="true" aria-labelledby="ann-title">
        <div className="ann-card modal-theme" ref={modalRef}>
          <button className="ann-close" aria-label="Close announcement" onClick={onClose}>×</button>

          <div className="ann-header">
            <div className="ann-icon" aria-hidden>
              {/* subtle info SVG */}
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M12 2a10 10 0 100 20 10 10 0 000-20z" stroke="currentColor" strokeWidth="0.6" opacity="0.9"></path>
                <path d="M11 10h2v5h-2zM11 7h2v1h-2z" fill="currentColor"></path>
              </svg>
            </div>

            <div style={{ flex: 1 }}>
              <div id="ann-title" className="ann-title">Important:  Export & Preview notes</div>
              <div className="ann-sub">Read these tips to ensure high-quality certificate exports and correct preview behavior.</div>
            </div>
          </div>

          <div className="ann-body">
            Please read the following before generating certificates. These recommendations help keep exported PDFs sharp and positions accurate.
          </div>

          <div className="ann-notes" role="note" aria-label="Important notes">
          <div className="ann-note-title">Notes:</div>

<ul style={{
  listStyleType: "disc",
  paddingLeft: "20px",
  marginTop: "6px",
  lineHeight: "1.55",
  color: "var(--theme-text)"
}}>
  <li>Upload a high-resolution image (PNG/JPG). Exports will embed the original image with full clarity.</li>
  <li>Preview uses browser fonts; custom font preview requires FontFace support (so uploaded fonts may look slightly different in preview).</li>
  <li>Click on the left preview to set anchor position for the selected item. Use arrow keys to move (Shift + arrows = 10px).</li>
</ul>
            </div>

          <div className="ann-actions">
            <button className="ann-btn primary" onClick={onClose}>Ok, got it</button>
          </div>
        </div>
      </div>
    </>
  );
}

// also provide default export so both import styles work
export default AnnouncementModal;
