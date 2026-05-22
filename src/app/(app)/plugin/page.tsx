"use client";

import { useState } from "react";

const MAC_CMD =
  "curl -fsSL https://footagestore.fraggell.com/install-panel.sh -o /tmp/fp-install.sh && bash /tmp/fp-install.sh && rm /tmp/fp-install.sh";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); document.body.removeChild(ta);
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={handleCopy} style={{ position:"absolute",top:10,right:10,background:"var(--color-surface-hover)",border:"1px solid var(--color-border)",borderRadius:5,color:copied?"#C60D60":"var(--color-muted)",fontSize:11,padding:"3px 8px",cursor:"pointer",fontFamily:"inherit",transition:"color 0.14s",whiteSpace:"nowrap" }}>
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

export default function PluginPage() {
  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="font-display text-2xl font-bold mb-1" style={{ color:"var(--color-fg)" }}>Premiere Pro Plugin</h1>
        <p className="text-sm" style={{ color:"var(--color-muted)" }}>Browse, scrub and import footage directly inside Adobe Premiere Pro. Install once — updates are delivered automatically inside the panel.</p>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(300px, 1fr))", gap:20, marginBottom:28 }}>

        {/* Mac */}
        <div style={{ background:"var(--color-surface)", border:"1px solid var(--color-border)", borderRadius:10, padding:24, display:"flex", flexDirection:"column", gap:18 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{color:'var(--color-fg)'}}>
              <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.029 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/>
            </svg>
            <div>
              <div style={{ fontWeight:600, fontSize:14, color:"var(--color-fg)" }}>macOS</div>
              <div style={{ fontSize:11, color:"var(--color-muted)", marginTop:1 }}>Mac editors</div>
            </div>
          </div>
          <ol style={{ fontSize:13, color:"var(--color-muted)", lineHeight:1.85, paddingLeft:18, margin:0 }}>
            <li>Close Adobe Premiere Pro</li>
            <li>Open Terminal</li>
            <li>Paste the command below and press Enter</li>
            <li>Enter your FootageStore email and password</li>
            <li>Open Premiere → <span style={{ color:"var(--color-fg)", fontWeight:500 }}>Window → Extensions → Fraggell Footage</span></li>
          </ol>
          <div style={{ background:"var(--color-bg)", borderRadius:7, padding:"13px 15px", position:"relative", border:"1px solid var(--color-border)" }}>
            <code style={{ fontFamily:"'Geist Mono','SF Mono',monospace", fontSize:11, color:"#86efac", wordBreak:"break-all", lineHeight:1.6, display:"block", paddingRight:48 }}>{MAC_CMD}</code>
            <CopyButton text={MAC_CMD} />
          </div>
          <p style={{ fontSize:12, color:"var(--color-muted)", margin:0, lineHeight:1.6 }}><strong style={{ color:"var(--color-muted)" }}>Updating?</strong> Run the same command again with Premiere closed, or use the update badge inside the panel.</p>
        </div>

        {/* Windows */}
        <div style={{ background:"var(--color-surface)", border:"1px solid var(--color-border)", borderRadius:10, padding:24, display:"flex", flexDirection:"column", gap:18 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{color:'var(--color-fg)'}}>
              <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/>
            </svg>
            <div>
              <div style={{ fontWeight:600, fontSize:14, color:"var(--color-fg)" }}>Windows</div>
              <div style={{ fontSize:11, color:"var(--color-muted)", marginTop:1 }}>Windows editors</div>
            </div>
          </div>
          <ol style={{ fontSize:13, color:"var(--color-muted)", lineHeight:1.85, paddingLeft:18, margin:0 }}>
            <li>Close Adobe Premiere Pro</li>
            <li>Click the download button below</li>
            <li>Double-click the downloaded <code style={{ background:"var(--color-bg)", border:"1px solid var(--color-border)", padding:"1px 5px", borderRadius:3, fontSize:11, color:"var(--color-muted)" }}>.bat</code> file</li>
            <li>Enter your FootageStore email and password</li>
            <li>Open Premiere → <span style={{ color:"var(--color-fg)", fontWeight:500 }}>Window → Extensions → Fraggell Footage</span></li>
          </ol>
          <a
            href="https://footagestore.fraggell.com/install-panel.bat"
            download="install-fraggell-footage-panel.bat"
            style={{ display:"inline-flex", alignItems:"center", gap:8, background:"#C60D60", color:"#fff", fontWeight:600, fontSize:13, padding:"10px 20px", borderRadius:7, textDecoration:"none", alignSelf:"flex-start" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Download installer (.bat)
          </a>
          <p style={{ fontSize:12, color:"var(--color-muted)", margin:0, lineHeight:1.6 }}><strong style={{ color:"var(--color-muted)" }}>Updating?</strong> Download and run the installer again with Premiere closed, or use the update badge inside the panel.</p>
        </div>
      </div>

      {/* Requirements */}
      <div style={{ background:"var(--color-surface)", border:"1px solid var(--color-border)", borderRadius:10, padding:"18px 22px", display:"flex", gap:48, flexWrap:"wrap" }}>
        <div>
          <p style={{ fontSize:11, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.08em", color:"var(--color-muted)", marginBottom:8 }}>Requirements</p>
          <div style={{ fontSize:13, color:"var(--color-muted)", lineHeight:1.9 }}>
            Adobe Premiere Pro CC 2020 (v14) or later<br/>
            Google Drive Desktop — signed in and connected<br/>
            Access to the Fraggell Editors Shared Drive
          </div>
        </div>
        <div>
          <p style={{ fontSize:11, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.08em", color:"var(--color-muted)", marginBottom:8 }}>Problems?</p>
          <div style={{ fontSize:13, color:"var(--color-muted)", lineHeight:1.9 }}>
            Use the bug report button (⚑) inside the panel<br/>
            or message Nick on Slack
          </div>
        </div>
      </div>
    </div>
  );
}
