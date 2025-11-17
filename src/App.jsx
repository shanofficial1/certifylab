// src/App.jsx
import React, { useState } from "react";
import CertificateBatchGenerator1 from "./CertificateBatchGenerator1";
import { AnnouncementModal } from "./components/AnnouncementModal";
import "./theme.css";
import "@/fonts.css";


export default function App() {
  const [showNotes, setShowNotes] = useState(true);
  return (
    <>
      <AnnouncementModal isOpen={showNotes} onClose={() => setShowNotes(false)} />
      <div style={{ position: "sticky", top: 0, zIndex: 50 }} />
      <CertificateBatchGenerator1 />
    </>
  );
}
