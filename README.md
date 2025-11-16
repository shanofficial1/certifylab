# 🔖 CertifyLab
Generate multiple personalized certificates in **one go** — with **live preview**, smart wrapping, and ZIP export.  
**Live:** https://certifylab.netlify.app/

---

## ✨ Features
- **Batch generation** from a single template
- **Dynamic placeholders**: `{name}` and `{team}` inside your description
- **Live, on-template preview** (updates as you type/adjust)
- **Smart word wrapping** with optional **justification**
- **Equal left/right padding** control
- **Click-to-position** the paragraph (set baseline Y on the template)
- **Bold placeholders** toggle for `{name}` / `{team}`
- **Custom fonts** (`.ttf`, `.otf`) for PDF output (optional)
- **ZIP export** → `Name.pdf` for each participant
- **Privacy-first**: No server, no DB — everything runs in your browser

> ⚠️ **Templates:** PNG/JPG images only (no PDF upload).

---

## 🧑‍💻 Tech Stack
- **React**, **Tailwind CSS**
- **pdf-lib** (PDF creation)
- **JSZip** (ZIP packaging)
- **FileSaver** (downloads)
- *(Optional)* **pdfjs-dist** for PDF template preview (disabled in this build)

---

## 🚀 Quick Start (Local)
```bash
git clone https://github.com/shanofficial1/certifylab.git
cd certifylab
npm install
npm run dev
