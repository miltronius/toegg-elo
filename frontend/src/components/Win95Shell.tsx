import "@react95/core/themes/win95.css";

const FONT = '"MS Sans Serif", "Segoe UI", Arial, sans-serif';
const MAT = "#c3c7cb";
const SHADOW_OUT =
  "inset 0.5px 0.5px 0px 0.5px #ffffff, inset 0 0 0 1px #868a8e, 1px 0px 0 0px #000, 0px 1px 0 0px #000, 1px 1px 0 0px #000";

const titleBtnBase: React.CSSProperties = {
  width: "16px",
  height: "14px",
  padding: 0,
  background: MAT,
  border: "none",
  cursor: "pointer",
  fontSize: "9px",
  fontFamily: FONT,
  fontWeight: "bold",
  boxShadow: SHADOW_OUT,
  marginLeft: "2px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const taskBtnBase: React.CSSProperties = {
  height: "32px",
  padding: "0 10px",
  background: MAT,
  border: "none",
  boxShadow: SHADOW_OUT,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: "4px",
  fontFamily: FONT,
  fontSize: "12px",
};

export function Win95Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#008080",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        padding: "4px 4px 48px",
        fontFamily: FONT,
        boxSizing: "border-box",
      }}
    >
      {/* Window */}
      <div
        style={{
          width: "min(1600px, 99vw)",
          display: "flex",
          flexDirection: "column",
          background: MAT,
          boxShadow: SHADOW_OUT,
          padding: "2px",
        }}
      >
        {/* Title bar */}
        <div
          style={{
            background: "#000e7a",
            color: "#fefefe",
            height: "20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 4px 0 6px",
            marginBottom: "2px",
            userSelect: "none",
            cursor: "default",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: "12px", fontFamily: FONT }}>
            ⚽ TöggElo – Elo Tracker
          </span>
          <div style={{ display: "flex" }}>
            <button style={titleBtnBase}>_</button>
            <button style={titleBtnBase}>□</button>
            <button style={{ ...titleBtnBase, fontWeight: "bold" }}>✕</button>
          </div>
        </div>

        {/* Window content */}
        <div
          style={{
            overflow: "auto",
            maxHeight: "calc(100vh - 52px)",
            background: MAT,
          }}
        >
          {children}
        </div>
      </div>

      {/* Taskbar */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          height: "40px",
          background: MAT,
          boxShadow: "inset 0 2px 0 #ffffff",
          display: "flex",
          alignItems: "center",
          padding: "2px 4px",
          gap: "4px",
          zIndex: 9999,
          fontFamily: FONT,
        }}
      >
        <button style={{ ...taskBtnBase, fontWeight: "bold" }}>🪟 Start</button>
        <div
          style={{
            width: "2px",
            height: "28px",
            borderLeft: "1px solid #868a8e",
            borderRight: "1px solid #ffffff",
            margin: "0 2px",
          }}
        />
        <button
          style={{
            ...taskBtnBase,
            boxShadow:
              "inset 1px 1px 0 0 #868a8e, inset -0.5px -0.5px 0 0.5px #ffffff, inset 1px 1px 0 1px #000",
          }}
        >
          ⚽ TöggElo
        </button>
      </div>
    </div>
  );
}
