# ⭐ CertiFlow
Generate multiple personalized certificates in **one click** — completely **offline** and **in your browser**.

CertiFlow lets you upload a certificate template, paste lists of names & teams, customize the description text using placeholders, and export **Name.pdf** certificates in bulk — packaged neatly in a single ZIP file.

No server. No cloud. **Your files never leave your device.**

---

## 🚀 Features

| Feature | Description |
|--------|-------------|
| **Batch Generation** | Create 10, 50, or even 500 certificates in one run. |
| **Dynamic Text Replacement** | Use `{name}` and `{team}` placeholders in the certificate description. |
| **Smart Text Wrapping** | Auto-wrap and **justified paragraph** formatting with equal side padding. |
| **Click Positioning** | Click directly on the template to set where the text should appear. |
| **Custom Fonts** | Upload `.ttf` / `.otf` fonts to match your design. |
| **Offline Processing** | Everything runs in the browser. Zero uploads. Zero privacy risk. |
| **ZIP Export** | Outputs `certificates.zip` containing `Name.pdf` files. |

---

## 🧑‍💻 Tech Stack

| Purpose | Tool |
|--------|------|
| UI Layout | React + Tailwind CSS |
| PDF Rendering | `pdf-lib` |
| ZIP Packaging | `JSZip` |
| File Download | `file-saver` |
| Template Preview (optional) | `pdfjs-dist` |

---

## 📦 Installation & Run

```bash
git clone https://github.com/shanofficial1/CertiFlow.git
cd CertiFlow
npm install
npm run dev
