import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import JSZip from "jszip";
import { saveAs } from "file-saver";

// ----------------- utils -----------------
const fileToDataURL = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const sanitizeFilename = (s) =>
  (s || "certificate")
    .replace(/[\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "certificate";

const hexToRgb01 = (hex) => {
  const h = (hex || "#000000").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c)=>c+c).join("") : h;
  const n = parseInt(full || "000000", 16) || 0;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return { r: r / 255, g: g / 255, b: b / 255 };
};

// Optional PDF first page to PNG (preview background)
const usePdfJs = () => {
  const [pdfjs, setPdfjs] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const mod = await import("pdfjs-dist");
        const workerSrc = await import("pdfjs-dist/build/pdf.worker.min.mjs");
        mod.GlobalWorkerOptions.workerSrc = workerSrc;
        setPdfjs(mod);
      } catch {
        console.warn("pdfjs-dist not available; PDF preview disabled.");
      }
    })();
  }, []);
  return pdfjs;
};

async function pdfFirstPageToDataUrl(pdfjs, dataUrl) {
  if (!pdfjs) throw new Error("pdfjs not ready");
  const loadingTask = pdfjs.getDocument({ url: dataUrl });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL("image/png");
}

// --------- Word wrap + (optional) justification for placeholders ----------
function tokenizeWithPlaceholders(text, nameValue, teamValue, fontRegular, fontBold, size, boldPlaceholders) {
  const rawTokens = text.split(/(\{name\}|\{team\})/g);
  const tokens = [];
  for (const t of rawTokens) {
    if (!t) continue;
    if (t === "{name}") {
      const content = nameValue;
      tokens.push({ text: content, font: boldPlaceholders ? fontBold : fontRegular, isSpace: false });
    } else if (t === "{team}") {
      const content = teamValue;
      tokens.push({ text: content, font: boldPlaceholders ? fontBold : fontRegular, isSpace: false });
    } else {
      const parts = t.split(/(\s+)/);
      for (const p of parts) {
        if (p === "") continue;
        const isSpace = /^\s+$/.test(p);
        tokens.push({ text: p, font: fontRegular, isSpace });
      }
    }
  }
  for (const tok of tokens) {
    tok.width = tok.font.widthOfTextAtSize(tok.text, size);
  }
  return tokens;
}

function layoutLines(tokens, maxWidth) {
  const lines = [];
  let line = [];
  let w = 0;
  for (const tok of tokens) {
    const tokWidth = tok.width;
    if (w + tokWidth > maxWidth && line.length > 0 && !tok.isSpace) {
      if (line.length && line[line.length - 1].isSpace) {
        w -= line[line.length - 1].width;
        line.pop();
      }
      lines.push({ items: line, width: w });
      line = [];
      w = 0;
    }
    line.push(tok);
    w += tokWidth;
  }
  if (line.length) {
    if (line[line.length - 1].isSpace) {
      w -= line[line.length - 1].width;
      line.pop();
    }
    lines.push({ items: line, width: w });
  }
  return lines;
}

function drawLines(page, lines, opts) {
  const { x, y, size, lineHeight, maxWidth, color, justify } = opts;
  let cursorY = y;
  for (let li = 0; li < lines.length; li++) {
    const { items, width } = lines[li];
    const isLastLine = li === lines.length - 1;
    let cursorX = x;

    let extraPerSpace = 0;
    if (justify && !isLastLine && width < maxWidth) {
      const spaces = items.filter(t => t.isSpace);
      const room = maxWidth - width;
      if (spaces.length > 0) extraPerSpace = room / spaces.length;
    }

    for (const tok of items) {
      page.drawText(tok.text, { x: cursorX, y: cursorY, size, font: tok.font, color });
      cursorX += tok.isSpace && extraPerSpace > 0 ? tok.width + extraPerSpace : tok.width;
    }
    cursorY -= lineHeight;
  }
}

// ----------------- component -----------------
export default function CertificateBatchGenerator() {
  const pdfjs = usePdfJs();

  const [templateDataUrl, setTemplateDataUrl] = useState("");
  const [templateNatural, setTemplateNatural] = useState({ w: 0, h: 0 });

  // Data: names & teams (paired by index)
  const [namesText, setNamesText] = useState("");
  const [teamsText, setTeamsText] = useState("");

  // Paragraph (contains {name} + {team})
  const [description, setDescription] = useState(
    "This certificate is proudly awarded to {name} of Team {team} in recognition of outstanding collaboration, innovation, and creativity during the NASA Space Apps Challenge – Kannur 2025, held on October 4–5. Your impactful contribution and remarkable problem-solving skills played a key role in your team being honored as a Local Winner, demonstrating commendable dedication, ingenuity, and teamwork throughout the event."
  );

  // Paragraph rendering controls
  const [descY, setDescY] = useState(0);                 // baseline (px from bottom)
  const [descFontSize, setDescFontSize] = useState(18);  // 1–100 px
  const [descFontColor, setDescFontColor] = useState("#111111");
  const [descFontFamily, setDescFontFamily] = useState("Helvetica"); // Helvetica | Times | Courier | Custom
  const [paddingPx, setPaddingPx] = useState(80);        // equal left/right padding
  const [boldPlaceholders, setBoldPlaceholders] = useState(true);
  const [justify, setJustify] = useState(true);          // "text-justify: auto"

  const [customFontFile, setCustomFontFile] = useState(null);
  const imgRef = useRef(null);

  // Upload template
  const onTemplateChange = async (file) => {
    if (!file) return;
    const dataUrl = await fileToDataURL(file);
    let finalDataUrl = dataUrl;
    if (file.type === "application/pdf") {
      if (!pdfjs) {
        alert("Loading PDF engine… choose the file again in a moment.");
        return;
      }
      finalDataUrl = await pdfFirstPageToDataUrl(pdfjs, dataUrl);
    }
    setTemplateDataUrl(finalDataUrl);
  };

  // Track natural size
  useEffect(() => {
    if (!templateDataUrl) return;
    const img = new Image();
    img.onload = () => setTemplateNatural({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = templateDataUrl;
  }, [templateDataUrl]);

  // Click to set paragraph baseline Y
  const handlePreviewClick = (e) => {
    if (!imgRef.current || !templateNatural.h) return;
    const rect = imgRef.current.getBoundingClientRect();
    const scaleY = templateNatural.h / rect.height;
    const yTop = (e.clientY - rect.top) * scaleY;
    setDescY(Math.round(templateNatural.h - yTop));
  };

  const names = useMemo(
    () => namesText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
    [namesText]
  );
  const teams = useMemo(
    () => teamsText.split(/\r?\n/).map((s) => s.trim()),
    [teamsText]
  );

  // ----------------- Generate -----------------
  const generateAll = async () => {
    if (!templateDataUrl) return alert("Upload a certificate template first.");
    if (names.length === 0) {
      alert("Please paste at least one name (one per line).");
      return;
    }
    if (teams.length && teams.length !== names.length) {
      const ok = confirm(`Teams count (${teams.length}) != names count (${names.length}). Missing teams will be blank. Continue?`);
      if (!ok) return;
    }

    const zip = new JSZip();
    const imgBytes = await fetch(templateDataUrl).then((r) => r.arrayBuffer());
    const customFontBytes = customFontFile ? await customFontFile.arrayBuffer() : null;

    for (let i = 0; i < names.length; i++) {
      const rawName = names[i];
      const team = teams[i] ?? "";

      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([templateNatural.w, templateNatural.h]);

      // background
      let bg;
      if (templateDataUrl.startsWith("data:image/png") || templateDataUrl.includes("image/png")) {
        bg = await pdfDoc.embedPng(imgBytes);
      } else {
        bg = await pdfDoc.embedJpg(imgBytes);
      }
      page.drawImage(bg, { x: 0, y: 0, width: templateNatural.w, height: templateNatural.h });

      // description font (independent)
      let descFontReg, descFontBold;
      if (customFontBytes && descFontFamily === "Custom") {
        descFontReg = await pdfDoc.embedFont(customFontBytes, { subset: true });
        descFontBold = descFontReg; // single file
      } else {
        if (descFontFamily === "Times") {
          descFontReg = await pdfDoc.embedFont(StandardFonts.TimesRoman);
          descFontBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
        } else if (descFontFamily === "Courier") {
          descFontReg = await pdfDoc.embedFont(StandardFonts.Courier);
          descFontBold = await pdfDoc.embedFont(StandardFonts.CourierBold);
        } else {
          descFontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);
          descFontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        }
      }

      // Build tokens, wrap, and optionally justify
      const color = hexToRgb01(descFontColor);
      const leftX = paddingPx; // equal left/right padding
      const contentWidth = Math.max(50, templateNatural.w - 2 * paddingPx);
      const lineHeight = descFontSize * 1.35;

      const tokens = tokenizeWithPlaceholders(
        description,
        rawName,
        team,
        descFontReg,
        descFontBold,
        descFontSize,
        boldPlaceholders
      );

      const lines = layoutLines(tokens, contentWidth);

      drawLines(page, lines, {
        x: leftX,
        y: descY,
        size: descFontSize,
        lineHeight,
        maxWidth: contentWidth,
        color: rgb(color.r, color.g, color.b),
        justify, // full-justify all but last line
      });

      const bytes = await pdfDoc.save();
      const fname = `${sanitizeFilename(rawName)}.pdf`;
      zip.file(fname, bytes);
    }

    const blob = await zip.generateAsync({ type: "blob" });
    saveAs(blob, "certificates.zip");
  };

  // ----------------- UI -----------------
  return (
    <>
      {/* NAVBAR */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur border-b">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-slate-900"></div>
            <span className="text-xl font-semibold tracking-tight">CertiFlow</span>
          </div>
        </div>
      </header>

      <main className="min-h-screen w-full p-6 md:p-10 bg-gradient-to-b from-slate-50 to-white">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Card 1: Template + paragraph settings */}
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-2xl">1) Upload Template & Paragraph Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                <div>
                  <Label>Template (PNG/JPG)</Label>
                  <Input type="file" accept="image/png,image/jpeg,application/pdf"
                    onChange={(e) => onTemplateChange(e.target.files?.[0])} />
                </div>
                <div>
                  <Label>Optional Custom Font (.ttf/.otf)</Label>
                  <Input type="file" accept="font/ttf,font/otf,.ttf,.otf"
                    onChange={(e) => setCustomFontFile(e.target.files?.[0] || null)} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label>Paragraph Font Size</Label>
                  <Input type="number" min={1} max={100}
                    value={descFontSize} onChange={(e)=>setDescFontSize(parseInt(e.target.value||0))} />
                </div>
                <div>
                  <Label>Paragraph Color</Label>
                  <Input type="color" value={descFontColor} onChange={(e) => setDescFontColor(e.target.value)} />
                </div>
                <div>
                  <Label>Paragraph Font Family</Label>
                  <select className="block w-full border rounded-lg p-2"
                          value={descFontFamily}
                          onChange={(e)=>setDescFontFamily(e.target.value)}>
                    <option value="Helvetica">Helvetica</option>
                    <option value="Times">Times</option>
                    <option value="Courier">Courier</option>
                    <option value="Custom">Custom (uploaded)</option>
                  </select>
                </div>

                <div>
                  <Label>Paragraph Baseline Y (px from bottom)</Label>
                  <Input type="number" value={descY} onChange={(e)=>setDescY(parseInt(e.target.value||0))} />
                </div>

                <div className="md:col-span-2">
                  <Label>Equal Left/Right Padding (px)</Label>
                  <Slider value={[paddingPx]} onValueChange={(v)=>setPaddingPx(v[0])} min={0} max={300} step={1} />
                  <div className="text-sm text-slate-500 mt-1">{paddingPx}px</div>
                </div>

                <div className="flex items-center gap-3">
                  <Switch checked={boldPlaceholders} onCheckedChange={setBoldPlaceholders} id="boldph" />
                  <Label htmlFor="boldph">Bold {`{name}`}/{`{team}`}</Label>
                </div>

                <div className="flex items-center gap-3">
                  <Switch checked={justify} onCheckedChange={setJustify} id="justify" />
                  <Label htmlFor="justify">Justify (auto)</Label>
                </div>
              </div>

              {/* Click template to set paragraph Y */}
              <div className="rounded-xl overflow-hidden border bg-white">
                {templateDataUrl ? (
                  <div className="relative">
                    <img
                      ref={imgRef}
                      src={templateDataUrl}
                      onClick={handlePreviewClick}
                      alt="template preview"
                      className="w-full h-auto cursor-crosshair select-none"
                    />
                    {templateNatural.h > 0 && (
                      <div
                        className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                        style={{
                          left: "50%",
                          top: `${(1 - descY / templateNatural.h) * 100}%`,
                        }}
                      >
                        <div className="w-4 h-4 bg-black/70 rounded-full border border-white" />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-10 text-center text-slate-500">
                    Upload template, then click on the image to set paragraph baseline Y.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Card 2: Data + paragraph text */}
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-2xl">2) People & Description → Export</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Names (one per line)</Label>
                  <Textarea
                    placeholder={`e.g.\nAkash Gopalan\nShan`}
                    value={namesText}
                    onChange={(e)=>setNamesText(e.target.value)}
                    className="min-h-[140px]"
                  />
                </div>
                <div>
                  <Label>Teams (one per line, index must match Names)</Label>
                  <Textarea
                    placeholder={`e.g.\nEXO HACKERS\nAstusu`}
                    value={teamsText}
                    onChange={(e)=>setTeamsText(e.target.value)}
                    className="min-h-[140px]"
                  />
                </div>
              </div>

              <div>
                <Label>Description (use {`{name}`} and {`{team}`})</Label>
                <Textarea
                  value={description}
                  onChange={(e)=>setDescription(e.target.value)}
                  className="min-h-[160px]"
                />
              </div>

              <div className="flex flex-wrap gap-3 pt-2">
                <Button onClick={generateAll} className="px-6 py-6 text-lg rounded-2xl">Generate ZIP</Button>
                <div className="text-sm text-slate-500 self-center">
                  Output: <code>certificates.zip</code> with <code>Name.pdf</code> per line.
                </div>
              </div>

              <div className="text-sm text-slate-500 pt-4 border-t">
                <p className="mb-2 font-medium">Notes</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>For best quality, export your Canva template as a high-resolution PNG (300 DPI).</li>
                  <li>If you upload a PDF, only the first page is used as background.</li>
                  <li>Click the template to set paragraph Y quickly.</li>
                  <li>Justify spreads spaces to align edges (last line not justified).</li>
                  <li>Everything runs locally in your browser.</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  );
}
