// src/CertificateBatchGenerator1.jsx
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
import logo from "@/assets/logo.png";
import "./theme.css"; // <-- import theme

// Utility: file -> dataURL
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
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full || "000000", 16) || 0;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return { r: r / 255, g: g / 255, b: b / 255 };
};

// For tokenizing description placeholders for PDF
function tokenizeWithPlaceholders(text, replacements, fontRegular, fontBold, size, boldPlaceholders) {
  const placeholderRegex = /\{([^\}]+)\}/g;
  const parts = [];
  let lastIndex = 0;
  let m;
  while ((m = placeholderRegex.exec(text)) !== null) {
    if (m.index > lastIndex) parts.push({ type: "text", value: text.slice(lastIndex, m.index) });
    parts.push({ type: "placeholder", value: m[1] });
    lastIndex = placeholderRegex.lastIndex;
  }
  if (lastIndex < text.length) parts.push({ type: "text", value: text.slice(lastIndex) });
  const tokens = [];
  for (const p of parts) {
    if (p.type === "text") {
      const rawTokens = p.value.split(/(\s+)/);
      for (const t of rawTokens) {
        if (!t) continue;
        const isSpace = /^\s+$/.test(t);
        tokens.push({ text: t, font: fontRegular, isSpace });
      }
    } else {
      const repl = replacements[p.value] ?? `{${p.value}}`;
      tokens.push({ text: repl, font: boldPlaceholders ? fontBold : fontRegular, isSpace: false });
    }
  }
  for (const tok of tokens) tok.width = tok.font.widthOfTextAtSize(tok.text, size);
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
  const { x, y, size, lineHeight, maxWidth, color, justify, align } = opts;
  let cursorY = y;
  for (let li = 0; li < lines.length; li++) {
    const { items, width } = lines[li];
    const isLastLine = li === lines.length - 1;
    let cursorX;
    if (align === "center") cursorX = x - width / 2;
    else if (align === "right") cursorX = x - width;
    else cursorX = x;
    let extraPerSpace = 0;
    if (justify && !isLastLine && width < maxWidth) {
      const spaces = items.filter((t) => t.isSpace);
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

// canvas helpers for preview (simpler)
function canvasTokens(text, replacements, boldPlaceholders) {
  const rawParts = text.split(/(\{[^\}]+\})/g);
  const tokens = [];
  for (const r of rawParts) {
    if (!r) continue;
    const m = r.match(/^\{([^\}]+)\}$/);
    if (m) {
      const key = m[1];
      const val = replacements[key] ?? `{${key}}`;
      tokens.push({ text: val, isSpace: false, isBold: !!boldPlaceholders });
    } else {
      const parts = r.split(/(\s+)/);
      for (const p of parts) {
        if (!p) continue;
        const isSpace = /^\s+$/.test(p);
        tokens.push({ text: p, isSpace, isBold: false });
      }
    }
  }
  return tokens;
}

function measureAndLayoutCanvas(ctx, baseFont, boldFont, tokens, maxWidth) {
  for (const tok of tokens) {
    ctx.font = tok.isBold ? boldFont : baseFont;
    tok.width = ctx.measureText(tok.text).width;
  }
  const lines = [];
  let line = [];
  let w = 0;
  for (const tok of tokens) {
    if (w + tok.width > maxWidth && line.length > 0 && !tok.isSpace) {
      if (line.length && line[line.length - 1].isSpace) {
        w -= line[line.length - 1].width;
        line.pop();
      }
      lines.push({ items: line, width: w });
      line = [];
      w = 0;
    }
    line.push(tok);
    w += tok.width;
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
function drawCanvasParagraph(ctx, lines, opts) {
  const { x, y, lineHeightPx, maxWidth, color, baseFont, boldFont, justify, align } = opts;
  ctx.fillStyle = color;
  let cursorY = y;
  for (let li = 0; li < lines.length; li++) {
    const { items, width } = lines[li];
    const isLast = li === lines.length - 1;
    let startX;
    if (align === "center") startX = x - width / 2;
    else if (align === "right") startX = x - width;
    else startX = x;
    let extraPerSpace = 0;
    if (justify && !isLast && width < maxWidth) {
      const spaces = items.filter((t) => t.isSpace);
      const room = maxWidth - width;
      if (spaces.length > 0) extraPerSpace = room / spaces.length;
    }
    let cursorX = startX;
    for (const tok of items) {
      ctx.font = tok.isBold ? boldFont : baseFont;
      ctx.fillText(tok.text, cursorX, cursorY);
      cursorX += tok.width + (tok.isSpace ? extraPerSpace : 0);
    }
    cursorY += lineHeightPx;
  }
}

export default function CertificateBatchGenerator1() {
  // Template & preview
  const [templateDataUrl, setTemplateDataUrl] = useState("");
  const [templateNatural, setTemplateNatural] = useState({ w: 0, h: 0 });
  const [templateBytes, setTemplateBytes] = useState(null);


  // new — add after other useState declarations
const [positionsInitialized, setPositionsInitialized] = useState(false);


// new — add after templateNatural useEffect or after templateNatural state declarations
useEffect(() => {
  if (!templateNatural.w || !templateNatural.h) return;
  if (positionsInitialized) return;

  // center X is template width / 2
  const centerX = Math.round(templateNatural.w / 2);
  // reasonable vertical spacing: start around 45% down the page and gap 48px
  const startY = Math.round(templateNatural.h * 0.45);

  setDynamicFields(prev => {
    return prev.map((f, i) => ({
      ...f,
      // if user already set a custom position (non-zero), keep it.
      position: {
        x: f.position?.x && f.position.x !== 0 ? f.position.x : centerX,
        y: f.position?.y && f.position.y !== 0 ? f.position.y : Math.max(40, startY - i * 48)
      },
      // also set default paddingX to centerX to help alignment calculations
      paddingX: f.paddingX ?? centerX,
      // center align by default
      align: f.align ?? "center"
    }));
  });

  setDescSettings(s => ({
    ...s,
    position: {
      x: s.position?.x && s.position.x !== 0 ? s.position.x : centerX,
      y: s.position?.y && s.position.y !== 0 ? s.position.y : Math.round(templateNatural.h * 0.6)
    },
    paddingX: s.paddingX ?? Math.round(templateNatural.w * 0.1),
    align: s.align ?? "center"
  }));

  setPositionsInitialized(true);
}, [templateNatural, positionsInitialized]);


  // dynamic fields
  const [dynamicCount, setDynamicCount] = useState(2);
  const [dynamicFields, setDynamicFields] = useState([
    { id: "field1", label: "Field 1", valuesText: "", fontSize: 48, color: "#00000", fontFamily: "Helvetica", position: { x: 400, y: 300 }, paddingX: 0, bold: true, justify: false, visible: true, align: "center" },
    { id: "field2", label: "Field 2", valuesText: "", fontSize: 20, color: "#00000", fontFamily: "Helvetica", position: { x: 400, y: 260 }, paddingX: 0, bold: true, justify: false, visible: true, align: "center" },
  ]);

  // description
  const [description, setDescription] = useState("This certificate is proudly awarded to {field1} of Team {field2} in recognition of outstanding collaboration and creativity.");
  const [descSettings, setDescSettings] = useState({ fontSize: 18, color: "#000000", fontFamily: "Helvetica", position: { x: 400, y: 200 }, paddingX: 80, bold: false, justify: true, align: "center" });

  // images
  const [images, setImages] = useState([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState(-1);

  // UI & preview
  const [previewIndex, setPreviewIndex] = useState(0);
  const [selectedFieldIndex, setSelectedFieldIndex] = useState(0);
  const [selectMode, setSelectMode] = useState("field"); // "field"/"description"/"image"
  const previewCanvasRef = useRef(null);
  const imgRef = useRef(null);

  // generate
  const [isGenerating, setIsGenerating] = useState(false);
  const progress = useRef({ current: 0, total: 0 });

  // ensure dynamicFields length
  useEffect(() => {
    setDynamicFields(prev => {
      const arr = [...prev];
      if (dynamicCount > arr.length) {
        for (let i = arr.length; i < dynamicCount; i++) {
          arr.push({ id: `field${i + 1}`, label: `Field ${i + 1}`, valuesText: "", fontSize: 28, color: "#000000", fontFamily: "Helvetica", position: { x: 400, y: 200 - i * 32 }, paddingX: 0, bold: false, justify: false, visible: true, align: "left" });
        }
      } else if (dynamicCount < arr.length) {
        arr.splice(dynamicCount);
      }
      return arr;
    });
    if (selectedFieldIndex >= dynamicCount) setSelectedFieldIndex(Math.max(0, dynamicCount - 1));
  }, [dynamicCount]);

  // rows from Field1
  const rows = useMemo(() => {
    const f = dynamicFields[0];
    if (!f) return [];
    return f.valuesText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  }, [dynamicFields]);

  // template upload (PNG/JPG only)
  const onTemplateChange = async (file) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/jpg"].includes(file.type)) {
      alert("Template must be PNG or JPG/JPEG.");
      return;
    }
    const dataUrl = await fileToDataURL(file);
    const arr = await fetch(dataUrl).then(r => r.arrayBuffer());
    setTemplateDataUrl(dataUrl);
    setTemplateBytes(arr);
  };

  useEffect(() => {
    if (!templateDataUrl) return;
    const img = new Image();
    img.onload = () => setTemplateNatural({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = templateDataUrl;
  }, [templateDataUrl]);

  // add image/logo
  const addImageFile = async (file) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/jpg"].includes(file.type)) {
      alert("Only PNG/JPG allowed for logos.");
      return;
    }
    const dataUrl = await fileToDataURL(file);
    const arr = await fetch(dataUrl).then(r => r.arrayBuffer());
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
    setImages(prev => {
      const next = [...prev, { id: `img${Date.now()}`, name: file.name, dataUrl, bytes: arr, w: img.naturalWidth, h: img.naturalHeight, x: templateNatural.w ? Math.round(templateNatural.w/2) : 400, y: templateNatural.h ? Math.round(templateNatural.h/2) : 200, scale: 1, visible: true }];
      setSelectedImageIndex(next.length - 1);
      return next;
    });
  };

  // keyboard nudging
  useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      const step = e.shiftKey ? 10 : 1;
      let dx = 0, dy = 0;
      if (e.key === "ArrowLeft") dx = -step;
      else if (e.key === "ArrowRight") dx = step;
      else if (e.key === "ArrowUp") dy = step;
      else if (e.key === "ArrowDown") dy = -step;
      if (dx === 0 && dy === 0) return;
      if (selectMode === "image" && selectedImageIndex >= 0) {
        e.preventDefault();
        setImages(prev => { const c = [...prev]; const it = {...c[selectedImageIndex]}; it.x = Math.round((it.x||0)+dx); it.y = Math.round((it.y||0)+dy); c[selectedImageIndex]=it; return c; });
      } else if (selectMode === "field") {
        e.preventDefault();
        setDynamicFields(prev => { const c = [...prev]; const it = {...c[selectedFieldIndex]}; it.position = { x: Math.round((it.position?.x||0)+dx), y: Math.round((it.position?.y||0)+dy) }; c[selectedFieldIndex]=it; return c; });
      } else if (selectMode === "description") {
        e.preventDefault();
        setDescSettings(s => ({ ...s, position: { x: Math.round((s.position?.x||0)+dx), y: Math.round((s.position?.y||0)+dy) } }));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectMode, selectedImageIndex, selectedFieldIndex]);

  // preview canvas drawing
  useEffect(() => {
    if (!templateDataUrl || !templateNatural.w || !templateNatural.h) return;
    if (!imgRef.current || !previewCanvasRef.current) return;
    const imgEl = imgRef.current;
    const canvas = previewCanvasRef.current;
    const rect = imgEl.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width));
    canvas.height = Math.max(1, Math.floor(rect.height));
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0,0,canvas.width,canvas.height);

    const previewRowIndex = Math.max(0, Math.min(previewIndex, Math.max(0, rows.length-1)));
    const repl = {};
    for (let i=0;i<dynamicFields.length;i++) {
      const lines = dynamicFields[i].valuesText.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
      repl[`field${i+1}`] = lines[previewRowIndex] ?? lines[0] ?? `{field${i+1}}`;
    }
    const scale = rect.width / templateNatural.w;

    // draw images
    for (let ii=0; ii<images.length; ii++) {
      const im = images[ii];
      if (!im || !im.visible) continue;
      const drawW = (im.w * (im.scale || 1)) * scale;
      const drawH = (im.h * (im.scale || 1)) * scale;
      const screenX = (im.x || 0) * scale - drawW / 2;
      const screenY = (templateNatural.h - (im.y || 0)) * scale - drawH / 2;
      const tmp = new Image();
      tmp.src = im.dataUrl;
      if (tmp.complete) ctx.drawImage(tmp, Math.round(screenX), Math.round(screenY), Math.round(drawW), Math.round(drawH));
      else tmp.onload = () => ctx.drawImage(tmp, Math.round(screenX), Math.round(screenY), Math.round(drawW), Math.round(drawH));
      if (ii === selectedImageIndex) { ctx.save(); ctx.strokeStyle = "#ff3b3b"; ctx.lineWidth = 2; ctx.strokeRect(Math.round(screenX)-2, Math.round(screenY)-2, Math.round(drawW)+4, Math.round(drawH)+4); ctx.restore(); }
    }

    // draw fields
    for (let fi=0; fi<dynamicFields.length; fi++) {
      const f = dynamicFields[fi];
      if (!f.visible) continue;
      const textVal = repl[`field${fi+1}`];
      const fam = f.fontFamily === "Times" ? "Times New Roman" : f.fontFamily === "Courier" ? "Courier New" : "Helvetica";
      const baseFont = `${f.fontSize * scale}px ${fam}`;
      const boldFont = `bold ${f.fontSize * scale}px ${fam}`;
      const tokens = canvasTokens(textVal, repl, f.bold);
      const maxWidth = Math.max(10, (templateNatural.w - 2*(f.paddingX||0)) * scale);
      const linesLayout = measureAndLayoutCanvas(ctx, baseFont, boldFont, tokens, maxWidth);
      const screenX = (f.position.x || f.paddingX || 0) * scale;
      const screenY = (templateNatural.h - (f.position.y || 0)) * scale;
      const lineHeightPx = f.fontSize * 1.35 * scale;
      drawCanvasParagraph(ctx, linesLayout, { x: screenX, y: screenY, lineHeightPx, maxWidth, color: f.color, baseFont, boldFont, justify: f.justify, align: f.align || "left" });
    }

    // draw description
    if (description) {
      const fam = descSettings.fontFamily === "Times" ? "Times New Roman" : descSettings.fontFamily === "Courier" ? "Courier New" : "Helvetica";
      const baseFont = `${descSettings.fontSize * scale}px ${fam}`;
      const boldFont = `bold ${descSettings.fontSize * scale}px ${fam}`;
      const tokens = canvasTokens(description, repl, descSettings.bold);
      const maxWidth = Math.max(10, (templateNatural.w - 2*(descSettings.paddingX || 0)) * scale);
      const linesLayout = measureAndLayoutCanvas(ctx, baseFont, boldFont, tokens, maxWidth);
      const screenX = (descSettings.position.x || descSettings.paddingX || 0) * scale;
      const screenY = (templateNatural.h - (descSettings.position.y || 0)) * scale;
      const lineHeightPx = descSettings.fontSize * 1.35 * scale;
      drawCanvasParagraph(ctx, linesLayout, { x: screenX, y: screenY, lineHeightPx, maxWidth, color: descSettings.color, baseFont, boldFont, justify: descSettings.justify, align: descSettings.align || "center" });
    }

  }, [templateDataUrl, templateNatural.w, templateNatural.h, images, dynamicFields, description, descSettings, previewIndex, selectedImageIndex, selectedFieldIndex]);

  // handle preview click
  const handlePreviewClick = (e) => {
    if (!imgRef.current || !templateNatural.h) return;
    const rect = imgRef.current.getBoundingClientRect();
    const scaleX = templateNatural.w / rect.width;
    const x = (e.clientX - rect.left) * scaleX;
    const yTop = (e.clientY - rect.top) * (templateNatural.h / rect.height);
    const y = Math.round(templateNatural.h - yTop);

    if (selectMode === "image" && selectedImageIndex >= 0) {
      setImages(prev => { const copy = [...prev]; copy[selectedImageIndex] = { ...copy[selectedImageIndex], x: Math.round(x), y }; return copy; });
      return;
    }
    if (selectMode === "field") {
      setDynamicFields(prev => { const copy = [...prev]; const cur = { ...copy[selectedFieldIndex] }; cur.position = { x: Math.round(x), y }; copy[selectedFieldIndex] = cur; return copy; });
      return;
    }
    if (selectMode === "description") {
      setDescSettings(s => ({ ...s, position: { x: Math.round(x), y } })); return;
    }
  };

  const updateDynamicField = (idx, patch) => {
    setDynamicFields(prev => { const copy = [...prev]; copy[idx] = { ...copy[idx], ...patch }; return copy; });
  };

  // generate function (creates PDF per row and zips)
  const generateAll = async () => {
    if (!templateDataUrl || !templateBytes) return alert("Upload a PNG/JPG template first.");
    if (!rows || rows.length === 0) return alert("Please provide at least one entry in Field 1.");
    setIsGenerating(true);
    progress.current = { current: 0, total: rows.length };
    const zip = new JSZip();
    const imgArrBuf = templateBytes;

    for (let r=0; r<rows.length; r++) {
      const record = {};
      for (let fi=0; fi<dynamicFields.length; fi++) {
        const lines = dynamicFields[fi].valuesText.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
        record[`field${fi+1}`] = lines[r] ?? lines[0] ?? "";
      }

      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([templateNatural.w, templateNatural.h]);

      let bg;
      if (templateDataUrl.startsWith("data:image/png") || templateDataUrl.includes("image/png")) bg = await pdfDoc.embedPng(imgArrBuf);
      else bg = await pdfDoc.embedJpg(imgArrBuf);
      page.drawImage(bg, { x:0, y:0, width: templateNatural.w, height: templateNatural.h });

      // logos
      for (let ii=0; ii<images.length; ii++) {
        const im = images[ii];
        if (!im || !im.visible) continue;
        const drawW = (im.w * (im.scale || 1));
        const drawH = (im.h * (im.scale || 1));
        const xPDF = (im.x || 0) - drawW / 2;
        const yPDF = (im.y || 0) - drawH / 2;
        let embedded;
        if (im.dataUrl.startsWith("data:image/png") || im.dataUrl.includes("image/png")) embedded = await pdfDoc.embedPng(im.bytes);
        else embedded = await pdfDoc.embedJpg(im.bytes);
        page.drawImage(embedded, { x: xPDF, y: yPDF, width: drawW, height: drawH });
      }

      // embed fonts and draw fields
      const embedFontsForFamily = async (family) => {
        if (family === "Times") return [await pdfDoc.embedFont(StandardFonts.TimesRoman), await pdfDoc.embedFont(StandardFonts.TimesRomanBold)];
        if (family === "Courier") return [await pdfDoc.embedFont(StandardFonts.Courier), await pdfDoc.embedFont(StandardFonts.CourierBold)];
        return [await pdfDoc.embedFont(StandardFonts.Helvetica), await pdfDoc.embedFont(StandardFonts.HelveticaBold)];
      };

      const fieldFonts = [];
      for (const f of dynamicFields) fieldFonts.push(await embedFontsForFamily(f.fontFamily));
      const descFonts = await embedFontsForFamily(descSettings.fontFamily);

      for (let fi=0; fi<dynamicFields.length; fi++) {
        const f = dynamicFields[fi];
        if (!f.visible) continue;
        const [fontReg, fontBold] = fieldFonts[fi];
        const text = record[`field${fi+1}`] ?? "";
        const col = hexToRgb01(f.color);
        const leftX = f.position.x ?? f.paddingX ?? 0;
        const contentWidth = Math.max(10, templateNatural.w - 2*(f.paddingX || 0));
        const lineHeight = f.fontSize * 1.35;

        const tokens = tokenizeWithPlaceholders(text, {}, fontReg, fontBold, f.fontSize, f.bold);
        // if single-line, compute width
        const textWidth = (f.bold ? fontBold : fontReg).widthOfTextAtSize(text, f.fontSize);
        if (textWidth <= contentWidth) {
          let x = leftX;
          if (f.align === "center") x = leftX - textWidth / 2;
          if (f.align === "right") x = leftX - textWidth;
          page.drawText(text, { x, y: f.position.y ?? Math.floor(templateNatural.h/2), size: f.fontSize, font: f.bold ? fontBold : fontReg, color: rgb(col.r, col.g, col.b) });
        } else {
          // wrap
          const parts = text.split(/(\s+)/).map(p => ({ text: p, font: f.bold ? fontBold : fontReg, isSpace: /^\s+$/.test(p) }));
          for (const p of parts) p.width = p.font.widthOfTextAtSize(p.text, f.fontSize);
          const lines = layoutLines(parts, contentWidth);
const renderX =
  align === "center"
    ? templateNatural.w / 2
    : align === "right"
    ? templateNatural.w - paddingPx
    : paddingPx;

drawLines(page, lines, {
  x: renderX,
  y: descY,
  align,
  size: descFontSize,
  lineHeight,
  maxWidth: contentWidth,
  color: rgb(color.r, color.g, color.b),
  justify,
});
        }
      }

      // description
      const colorDesc = hexToRgb01(descSettings.color);
      const leftXDesc = descSettings.position.x ?? descSettings.paddingX ?? 0;
      const contentWidthDesc = Math.max(10, templateNatural.w - 2*(descSettings.paddingX || 0));
      const lineHeightDesc = descSettings.fontSize * 1.35;
      const tokensDesc = tokenizeWithPlaceholders(description || "", record, descFonts[0], descFonts[1], descSettings.fontSize, descSettings.bold);
      const linesDesc = layoutLines(tokensDesc, contentWidthDesc);
const renderX =
  align === "center"
    ? templateNatural.w / 2
    : align === "right"
    ? templateNatural.w - paddingPx
    : paddingPx;

drawLines(page, lines, {
  x: renderX,
  y: descY,
  align,
  size: descFontSize,
  lineHeight,
  maxWidth: contentWidth,
  color: rgb(color.r, color.g, color.b),
  justify,
});

      const bytes = await pdfDoc.save();
      const fname = `${sanitizeFilename(record.field1 || `certificate-${r+1}`)}.pdf`;
      zip.file(fname, bytes);
      progress.current.current = r + 1;
    }

    const blob = await zip.generateAsync({ type: "blob" });
    saveAs(blob, "certificates.zip");
    setIsGenerating(false);
    progress.current = { current: 0, total: 0 };
  };

  // UI markup (theme classes used)
  return (
    <>
      <header className="sticky top-0 z-50 navbar-theme" style={{ borderBottom: "1px solid var(--theme-border)" }}>
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div style={{ fontWeight: 700 , padding : 10}} className="text-theme">CertifyLab v1</div>
          </div>
          <div className="text-sm text-theme-muted">All processing runs locally in your browser — no uploads.</div>
        </div>
      </header>

      <main className="min-h-screen bg-theme">
        <div className="max-w-7xl mx-auto flex gap-6 p-6" style={{ alignItems: "flex-start" }}>
          {/* left preview (70%) */}
          <div style={{ width: "70%", position: "sticky", top: 24 }}>
            <div className="card-theme">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontWeight: 600 }}>Template Preview</div>
                <div className="text-theme-muted" style={{ fontSize: 13 }}>Click to set position. Use arrow keys to nudge selected item.</div>
              </div>

              <div className="card-theme" style={{ borderRadius: 10, overflow: "hidden", background: "var(--theme-bg)" }}>
                {templateDataUrl ? (
                  <div style={{ position: "relative" }}>
                    <img ref={imgRef} src={templateDataUrl} alt="template" className="w-full h-auto block" onClick={handlePreviewClick} />
                    <canvas ref={previewCanvasRef} className="absolute left-0 top-0 pointer-events-none" style={{ width: "100%", height: "100%" }} />
                  </div>
                ) : (
                  <div style={{ padding: 40, textAlign: "center", color: "var(--theme-text)" }}>Upload a high-resolution PNG/JPG template</div>
                )}
              </div>

              <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="text-theme-muted " style={{ fontSize: 12 }}>Upload template</span>
                  <Input type="file" accept="image/png,image/jpeg" onChange={(e) => onTemplateChange(e.target.files?.[0])} />
                </label>
                <div style={{ marginLeft: "auto", fontSize: 13, color: "var(--theme-text)" }}>Export preserves original image clarity.</div>
              </div>
            </div>
          </div>

          {/* right controls (30%) */}
          <div style={{ width: "30%", maxHeight: "80vh", overflowY: "auto" }} className="scroll-style overflow-auto">
            {/* images card */}
            <Card className="card-theme mb-4">
              <CardHeader><CardTitle className="text-xl">Images / Logos</CardTitle></CardHeader>
              <CardContent>
                <Label>Upload PNG / JPG (logo) </Label>
                <Input type="file" accept="image/png,image/jpeg" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; await addImageFile(f); e.target.value = ""; }} />
                <div style={{ marginTop: 10 }}>
                  {images.length === 0 && <div className="text-theme-muted">No images uploaded</div>}
                  {images.map((im, idx) => (
                    <div key={im.id} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, border: "1px solid rgba(255,255,255,0.03)", padding: 8, borderRadius: 8 }}>
                      <img src={im.dataUrl} alt={im.name} style={{ width: 48, height: 48, objectFit: "contain" }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600 }}>{im.name}</div>
                        <div style={{ fontSize: 12, color: "var(--theme-text)" }}>Scale: {(im.scale||1).toFixed(2)}</div>
                        <input type="range" min="0.1" max="3" step="0.05" value={im.scale || 1} onChange={(e) => setImages(prev => { const c=[...prev]; c[idx]={...c[idx], scale: parseFloat(e.target.value)}; return c; })} />
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <button className={`btn-theme`} onClick={() => { setSelectedImageIndex(idx); setSelectMode("image"); }}>Select</button>
                        <button className="btn-theme" onClick={() => { setImages(prev => prev.filter((_,i)=>i!==idx)); setSelectedImageIndex(-1); }}>Delete</button>
                        <label style={{ fontSize: 12 }}><input type="checkbox" checked={im.visible} onChange={(e)=> setImages(prev => { const c=[...prev]; c[idx]={...c[idx], visible: e.target.checked}; return c; })} /> Visible</label>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: "var(--theme-text)" }}>Tip: Select image then click preview for anchor. Use arrow keys to nudge (Shift+arrow = 10px).</div>
              </CardContent>
            </Card>

            {/* dynamic fields */}
            <Card className="card-theme mb-4">
              <CardHeader><CardTitle className="text-xl">Dynamic Values</CardTitle></CardHeader>
              <CardContent>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                  <Label>Number of fields</Label>
                  <Input type="number" min={1} max={12} value={dynamicCount} onChange={(e) => setDynamicCount(Math.max(1, Math.min(12, parseInt(e.target.value||1))))} style={{ width: 80 }} />
                  <div style={{ marginLeft: "auto", fontSize: 12 }} className="text-theme-muted">Select a field then click preview to set position</div>
                </div>

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  {dynamicFields.map((f, idx) => <button key={f.id} onClick={() => { setSelectedFieldIndex(idx); setSelectMode("field"); }} className={`btn-theme`} style={{ background: selectedFieldIndex===idx && selectMode==="field" ? "rgba(255,255,255,0.12)" : undefined }}>{f.label}</button>)}
                  <button onClick={() => { setSelectMode("description"); }} className="btn-theme">Description</button>
                </div>

                {dynamicFields.map((f, idx) => (
                  <div key={f.id} style={{ border: "1px solid rgba(255,255,255,0.03)", padding: 10, borderRadius: 8, marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontWeight: 700 }}>{f.label}</div>
                      <div style={{ fontSize: 12 }} className="text-theme-muted">{selectedFieldIndex===idx && selectMode==="field" ? "Selected" : ""}</div>
                    </div>

                    <div style={{ marginTop: 8 }}>
                      <Label>Values (one per line)</Label>
                      <Textarea value={f.valuesText} onChange={(e) => updateDynamicField(idx, { valuesText: e.target.value })} className="min-h-[80px]" />
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                      <div>
                        <Label>Font Size</Label>
                        <Input type="number" min={6} max={200} value={f.fontSize} onChange={(e) => updateDynamicField(idx, { fontSize: parseInt(e.target.value||0) })} />
                      </div>
                      <div>
                        <Label>Color</Label>
                        <Input type="color" value={f.color} onChange={(e) => updateDynamicField(idx, { color: e.target.value })} />
                      </div>
                      <div>
                        <Label>Font Family</Label>
                        <select value={f.fontFamily} onChange={(e) => updateDynamicField(idx, { fontFamily: e.target.value })} style={{ width: "100%", padding: 8, borderRadius: 8 }}>
                          <option value="Helvetica">Helvetica</option>
                          <option value="Times">Times</option>
                          <option value="Courier">Courier</option>
                          <option value="Custom">Custom</option>
                        </select>
                      </div>
                      <div>
                        <Label>Align</Label>
                        <select value={f.align} onChange={(e) => updateDynamicField(idx, { align: e.target.value })} style={{ width: "100%", padding: 8, borderRadius: 8 }}>
                          <option value="left">Left</option>
                          <option value="center">Center</option>
                          <option value="right">Right</option>
                        </select>
                      </div>
                      <div>
                        <Label>Baseline Y (px)</Label>
                        <Input type="number" value={f.position.y ?? 0} onChange={(e) => updateDynamicField(idx, { position: { x: f.position.x ?? f.paddingX ?? 0, y: parseInt(e.target.value||0) } })} />
                      </div>
                      <div>
                        <Label>Padding X (px)</Label>
                        <Input type="number" value={f.paddingX} onChange={(e) => updateDynamicField(idx, { paddingX: parseInt(e.target.value||0) })} />
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                      <Switch checked={f.bold} onCheckedChange={(v) => updateDynamicField(idx, { bold: v })} id={`bold-${idx}`} />
                      <Label htmlFor={`bold-${idx}`}>Bold</Label>

                      <Switch checked={f.justify} onCheckedChange={(v) => updateDynamicField(idx, { justify: v })} id={`justify-${idx}`} />
                      <Label htmlFor={`justify-${idx}`}>Justify</Label>

                      <Switch checked={f.visible} onCheckedChange={(v) => updateDynamicField(idx, { visible: v })} id={`vis-${idx}`} />
                      <Label htmlFor={`vis-${idx}`}>Visible</Label>

                    </div>
                      <div style={{ margin: 8}}>
                        <Button onClick={() => { setSelectedFieldIndex(idx); setSelectMode("field"); alert("Now click the preview to set this field position."); }} className="btn-theme ">Set Position</Button>
                      </div>
                      
                  </div>
                ))}

              </CardContent>
            </Card>

            {/* description card */}
            <Card className="card-theme mb-4">
              <CardHeader><CardTitle className="text-xl">Description</CardTitle></CardHeader>
              <CardContent>
                <Label>Description (use {`{field1}`}, {`{field2}`})</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-[120px]" />

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                  <div>
                    <Label>Font Size</Label>
                    <Input type="number" value={descSettings.fontSize} onChange={(e) => setDescSettings(s => ({ ...s, fontSize: parseInt(e.target.value||0) }))} />
                  </div>
                  <div>
                    <Label>Color</Label>
                    <Input type="color" value={descSettings.color} onChange={(e) => setDescSettings(s => ({ ...s, color: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Font Family</Label>
                    <select value={descSettings.fontFamily} onChange={(e) => setDescSettings(s => ({ ...s, fontFamily: e.target.value }))} style={{ width: "100%", padding: 8, borderRadius: 8 }}>
                      <option value="Helvetica">Helvetica</option>
                      <option value="Times">Times</option>
                      <option value="Courier">Courier</option>
                      <option value="Custom">Custom</option>
                    </select>
                  </div>
                  <div>
                    <Label>Align</Label>
                    <select value={descSettings.align} onChange={(e) => setDescSettings(s => ({ ...s, align: e.target.value }))} style={{ width: "100%", padding: 8, borderRadius: 8 }}>
                      <option value="left">Left</option>
                      <option value="center">Center</option>
                      <option value="right">Right</option>
                    </select>
                  </div>
                  <div>
                    <Label>Baseline Y (px)</Label>
                    <Input type="number" value={descSettings.position.y ?? 0} onChange={(e) => setDescSettings(s => ({ ...s, position: { x: s.position.x ?? s.paddingX ?? 0, y: parseInt(e.target.value||0) } }))} />
                  </div>
                  <div>
                    <Label>Padding X (px)</Label>
                    <Input type="number" value={descSettings.paddingX} onChange={(e) => setDescSettings(s => ({ ...s, paddingX: parseInt(e.target.value||0) }))} />
                  </div>
                </div>

                <div style={{ marginTop: 8 }}>
                  <Switch checked={descSettings.bold} onCheckedChange={(v) => setDescSettings(s => ({ ...s, bold: v }))} id="desc-bold" />
                  <Label htmlFor="desc-bold">Bold placeholders</Label>
                  <Switch checked={descSettings.justify} onCheckedChange={(v) => setDescSettings(s => ({ ...s, justify: v }))} id="desc-justify" />
                  <Label htmlFor="desc-justify">Justify</Label>
                </div>

                <div style={{ marginTop: 8 }}>
                  <Button onClick={() => { setSelectMode("description"); alert("Now click preview to set description position."); }} className="btn-theme">Set Description Position</Button>
                </div>
              </CardContent>
            </Card>

            {/* preview & generate */}
            <Card className="card-theme mb-8">
              <CardHeader><CardTitle className="text-xl">Preview & Generate</CardTitle></CardHeader>
              <CardContent>
                <div style={{ marginBottom: 8 }}>
                  <Label>Preview row index</Label>
                  <Input type="number" min={0} max={Math.max(0, rows.length-1)} value={previewIndex} onChange={(e) => setPreviewIndex(Math.max(0, parseInt(e.target.value||0)))} />
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
  <Button
    onClick={() => {
      updateDynamicField(0, { valuesText: "Arjun Nair\nSneha S Kumar\nRahul Menon\nDiya Jose\nNaveen Raj" });
      if (dynamicFields[1]) updateDynamicField(1, { valuesText: "Alpha Tech\nQuantum Sparks\nCode Titans\nNebula Crew\nPixel Forge" });
    }}
    className="btn-theme"
  >
    Fill demo data
  </Button>

  <div style={{ marginLeft: "auto" }} className="text-theme-muted">
    {isGenerating ? `Generating ${progress.current.current}/${progress.current.total}` : "Ready"}
  </div>
</div>


                <div style={{ marginBottom: 8 }}>
                  <Button onClick={generateAll} className="btn-theme" disabled={isGenerating}>{isGenerating ? "Generating..." : "Generate ZIP"}</Button>
                </div>

               
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </>
  );
}
