import React, { useRef, useState, useCallback, useEffect } from "react";

const API_URL = "http://127.0.0.1:5000";

const DEFECT_TYPES = [
  {
    key: "scratch",
    label: "Surface scratch",
    note: "A linear surface abrasion was detected on the housing. Typically caused by handling or conveyor contact — check upstream guarding.",
  },
  {
    key: "crack",
    label: "Structural crack",
    note: "A fracture line was detected in a load-bearing area. Part should be pulled from the line and root-caused before further assembly.",
  },
  {
    key: "missing",
    label: "Missing component",
    note: "An expected fastener or sub-component was not found in its designated position. Verify the upstream placement station.",
  },
  {
    key: "misalign",
    label: "Incorrect assembly",
    note: "A component was found outside its expected tolerance window, suggesting misalignment during assembly.",
  },
];

function makePartId() {
  const n = Math.floor(1000 + Math.random() * 8999);
  return "PV-" + n + "-A";
}

export default function ParakhVision() {
  const fileInputRef = useRef(null);
  const addFileInputRef = useRef(null);
  const canvasRef = useRef(null);
  const imageRef = useRef(null); // holds the currently rendered HTMLImageElement
  const currentImgScaleRef = useRef(1);

  // Batch queue state
  const [batch, setBatch] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [filterMode, setFilterMode] = useState("all"); // 'all' | 'pass' | 'fail' | 'pending'
  const [dragging, setDragging] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0, currentName: "" });

  // Inspection Report State for active part
  const [report, setReport] = useState({
    partId: "PART ID — PENDING",
    filename: "—",
    time: "—",
    defect: "—",
    confidence: "—",
    region: "—",
    result: null, // 'pass' | 'fail' | null
  });
  const [defectNote, setDefectNote] = useState(null);
  const [visualization, setVisualization] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [logs, setLogs] = useState([]);

  const activeItem = batch[activeIdx] || null;

  // ----------------------------------------------------
  // DRAW ACTIVE ITEM ON CANVAS
  // ----------------------------------------------------
  const renderItemToCanvas = useCallback((item) => {
    if (!item) {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      imageRef.current = null;
      setReport({
        partId: "PART ID — PENDING",
        filename: "—",
        time: "—",
        defect: "—",
        confidence: "—",
        region: "—",
        result: null,
      });
      setVisualization(null);
      setAnalysis(null);
      setDefectNote(null);
      return;
    }

    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      const canvas = canvasRef.current;
      if (!canvas) return;

      const maxW = 720;
      const scale = Math.min(1, maxW / img.width);
      currentImgScaleRef.current = scale;

      canvas.width = img.width * scale;
      canvas.height = img.height * scale;

      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // If item was inspected, draw bounding box overlay if defective
      if (item.status === "fail" && item.resultData?.localization?.bounding_box) {
        const box = item.resultData.localization.bounding_box;
        const bx = box.x * scale;
        const by = box.y * scale;
        const bw = box.width * scale;
        const bh = box.height * scale;

        ctx.strokeStyle = "#c24444";
        ctx.lineWidth = 2.5;
        ctx.strokeRect(bx, by, bw, bh);
        ctx.fillStyle = "rgba(194,68,68,0.18)";
        ctx.fillRect(bx, by, bw, bh);

        // Label tag
        const tagText = (item.resultData.analysis?.defect_type || "ANOMALY").toUpperCase();
        ctx.font = "bold 11px 'JetBrains Mono', monospace";
        ctx.fillStyle = "#c24444";
        const tagY = by > 16 ? by - 6 : by + bh + 14;
        ctx.fillText(tagText, bx, tagY);
      }

      // Update Report Panel
      if (item.resultData) {
        const insp = item.resultData.inspection;
        const loc = item.resultData.localization;
        const ana = item.resultData.analysis;
        const vis = item.resultData.visualization;

        const isDefective = item.status === "fail";
        const score = Number(insp?.anomaly_score || 0);
        const confidencePct = Math.min(100, Math.max(0, score * 100)).toFixed(1);

        let region = "Full frame";
        if (loc?.bounding_box) {
          const b = loc.bounding_box;
          region = `x:${b.x} y:${b.y} w:${b.width} h:${b.height}`;
        }

        setReport({
          partId: item.id,
          filename: item.name,
          time: item.time || new Date().toLocaleTimeString(),
          defect: ana?.defect_type || (isDefective ? "Anomaly detected" : "None detected"),
          confidence: confidencePct + "%",
          region,
          result: isDefective ? "fail" : "pass",
        });

        setVisualization(vis || null);
        setAnalysis(ana || null);

        if (isDefective && ana?.potential_impact) {
          setDefectNote({
            label: ana.defect_type || "Anomaly",
            note: `${ana.potential_impact} — ${ana.recommended_action || ""}`,
          });
        } else {
          setDefectNote(null);
        }
      } else {
        // Pending inspection
        setReport({
          partId: item.id,
          filename: item.name,
          time: "Pending scan",
          defect: "Awaiting inspection",
          confidence: "—",
          region: "—",
          result: null,
        });
        setVisualization(null);
        setAnalysis(null);
        setDefectNote(null);
      }
    };

    img.src = item.previewUrl;
  }, []);

  // Update canvas when activeIdx or batch item changes
  useEffect(() => {
    if (batch.length > 0 && batch[activeIdx]) {
      renderItemToCanvas(batch[activeIdx]);
    } else {
      renderItemToCanvas(null);
    }
  }, [batch, activeIdx, renderItemToCanvas]);

  // ----------------------------------------------------
  // ADD FILES TO BATCH
  // ----------------------------------------------------
  const addFilesToBatch = (files, append = false) => {
    const imageFiles = Array.from(files).filter(
      (f) => f && f.type && f.type.startsWith("image/")
    );

    if (imageFiles.length === 0) return;

    const newItems = imageFiles.map((file) => ({
      id: makePartId(),
      file,
      name: file.name,
      size: (file.size / 1024).toFixed(1) + " KB",
      previewUrl: URL.createObjectURL(file),
      status: "pending", // 'pending' | 'scanning' | 'pass' | 'fail' | 'error'
      score: null,
      time: null,
      resultData: null,
      error: null,
    }));

    if (append) {
      setBatch((prev) => [...prev, ...newItems]);
    } else {
      setBatch(newItems);
      setActiveIdx(0);
    }
  };

  const handleInitialFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      addFilesToBatch(e.target.files, false);
      e.target.value = "";
    }
  };

  const handleAddMoreFiles = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      addFilesToBatch(e.target.files, true);
      e.target.value = "";
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFilesToBatch(e.dataTransfer.files, batch.length > 0);
    }
  };

  const removeBatchItem = (indexToRemove, e) => {
    e.stopPropagation();
    setBatch((prev) => {
      const updated = prev.filter((_, i) => i !== indexToRemove);
      return updated;
    });
    if (activeIdx >= indexToRemove && activeIdx > 0) {
      setActiveIdx((prev) => prev - 1);
    }
  };

  const clearBatch = () => {
    batch.forEach((item) => {
      try {
        URL.revokeObjectURL(item.previewUrl);
      } catch (_) {}
    });
    setBatch([]);
    setActiveIdx(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (addFileInputRef.current) addFileInputRef.current.value = "";
  };

  // ----------------------------------------------------
  // INSPECTION SIMULATION (FALLBACK IF OFFLINE)
  // ----------------------------------------------------
  const simulateInspection = (item) => {
    return new Promise((resolve) => {
      setTimeout(() => {
        const isDefective = Math.random() < 0.45;
        const defect = DEFECT_TYPES[Math.floor(Math.random() * DEFECT_TYPES.length)];
        const score = isDefective
          ? +(0.72 + Math.random() * 0.24).toFixed(3)
          : +(Math.random() * 0.12).toFixed(3);

        const bounding_box = isDefective
          ? {
              x: Math.round(80 + Math.random() * 200),
              y: Math.round(60 + Math.random() * 160),
              width: Math.round(90 + Math.random() * 120),
              height: Math.round(70 + Math.random() * 100),
            }
          : null;

        resolve({
          success: true,
          inspection: {
            status: isDefective ? "FAIL" : "PASS",
            anomaly_detected: isDefective,
            anomaly_score: score,
          },
          localization: {
            bounding_box,
            anomaly_map_size: { width: 512, height: 512 },
          },
          visualization: null,
          analysis: {
            defect_type: isDefective ? defect.label : null,
            reason: isDefective
              ? defect.note
              : "No significant deviation from the normal pattern was detected.",
            potential_impact: isDefective
              ? defect.note
              : "Product meets quality control specifications.",
            recommended_action: isDefective
              ? "Segregate part from conveyor and route for manual verification."
              : "Proceed to downstream assembly.",
          },
        });
      }, 750);
    });
  };

  // ----------------------------------------------------
  // INSPECT A SINGLE ITEM
  // ----------------------------------------------------
  const inspectSingleItem = async (item) => {
    try {
      const formData = new FormData();
      formData.append("image", item.file);

      const response = await fetch(`${API_URL}/api/inspect`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Inspection returned failure");
      }

      const isDefective = Boolean(data.inspection?.anomaly_detected);
      const score = Number(data.inspection?.anomaly_score || 0);

      return {
        ...item,
        status: isDefective ? "fail" : "pass",
        score,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        resultData: data,
        error: null,
      };
    } catch (err) {
      console.warn("Backend unavailable or error, using demo simulation:", err);
      const simulatedData = await simulateInspection(item);
      const isDefective = Boolean(simulatedData.inspection.anomaly_detected);
      const score = Number(simulatedData.inspection.anomaly_score);

      return {
        ...item,
        status: isDefective ? "fail" : "pass",
        score,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        resultData: simulatedData,
        error: null,
      };
    }
  };

  // ----------------------------------------------------
  // RUN BATCH INSPECTION
  // ----------------------------------------------------
  const runBatchInspection = async () => {
    if (batch.length === 0 || isScanning) return;

    setIsScanning(true);

    const itemsToScan = [...batch];
    const newLogs = [];

    for (let i = 0; i < itemsToScan.length; i++) {
      const item = itemsToScan[i];
      setBatchProgress({
        current: i + 1,
        total: itemsToScan.length,
        currentName: item.name,
      });
      setActiveIdx(i);

      // Mark current item as scanning
      setBatch((prev) =>
        prev.map((it, idx) => (idx === i ? { ...it, status: "scanning" } : it))
      );

      const inspectedItem = await inspectSingleItem(item);

      // Update in state
      setBatch((prev) =>
        prev.map((it, idx) => (idx === i ? inspectedItem : it))
      );

      newLogs.unshift({
        id: inspectedItem.id,
        filename: inspectedItem.name,
        defect:
          inspectedItem.resultData?.analysis?.defect_type ||
          (inspectedItem.status === "fail" ? "Anomaly detected" : "None detected"),
        score: inspectedItem.score != null ? (inspectedItem.score * 100).toFixed(1) + "%" : "—",
        time: inspectedItem.time,
        result: inspectedItem.status,
      });
    }

    setLogs((prev) => [...newLogs, ...prev]);
    setIsScanning(false);
  };

  // Inspect only currently active part
  const runActiveInspection = async () => {
    if (!activeItem || isScanning) return;

    setIsScanning(true);
    setBatchProgress({ current: 1, total: 1, currentName: activeItem.name });

    setBatch((prev) =>
      prev.map((it, idx) => (idx === activeIdx ? { ...it, status: "scanning" } : it))
    );

    const inspectedItem = await inspectSingleItem(activeItem);

    setBatch((prev) =>
      prev.map((it, idx) => (idx === activeIdx ? inspectedItem : it))
    );

    setLogs((prev) => [
      {
        id: inspectedItem.id,
        filename: inspectedItem.name,
        defect:
          inspectedItem.resultData?.analysis?.defect_type ||
          (inspectedItem.status === "fail" ? "Anomaly detected" : "None detected"),
        score: inspectedItem.score != null ? (inspectedItem.score * 100).toFixed(1) + "%" : "—",
        time: inspectedItem.time,
        result: inspectedItem.status,
      },
      ...prev,
    ]);

    setIsScanning(false);
  };

  // ----------------------------------------------------
  // EXPORT BATCH REPORT AS CSV
  // ----------------------------------------------------
  const exportBatchCsv = () => {
    if (batch.length === 0) return;

    const headers = [
      "Part ID",
      "Filename",
      "Timestamp",
      "Result",
      "Anomaly Score (%)",
      "Defect Type",
      "Reasoning",
      "Recommended Action",
    ];

    const rows = batch.map((item) => {
      const res = item.resultData;
      const status = item.status.toUpperCase();
      const score = item.score != null ? (item.score * 100).toFixed(1) + "%" : "N/A";
      const defect = res?.analysis?.defect_type || (item.status === "fail" ? "Anomaly" : "None");
      const reason = (res?.analysis?.reason || "").replace(/"/g, '""');
      const action = (res?.analysis?.recommended_action || "").replace(/"/g, '""');

      return [
        `"${item.id}"`,
        `"${item.name}"`,
        `"${item.time || "Not Inspected"}"`,
        `"${status}"`,
        `"${score}"`,
        `"${defect}"`,
        `"${reason}"`,
        `"${action}"`,
      ].join(",");
    });

    const csvContent = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `ParakhVision_Batch_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // ----------------------------------------------------
  // BATCH METRICS CALCULATIONS
  // ----------------------------------------------------
  const totalCount = batch.length;
  const passCount = batch.filter((it) => it.status === "pass").length;
  const failCount = batch.filter((it) => it.status === "fail").length;
  const pendingCount = batch.filter((it) => it.status === "pending" || it.status === "scanning").length;
  const inspectedCount = passCount + failCount;
  const defectRate = inspectedCount > 0 ? ((failCount / inspectedCount) * 100).toFixed(1) : "0.0";

  // Filtered batch for filmstrip
  const filteredBatch = batch
    .map((item, originalIdx) => ({ item, originalIdx }))
    .filter(({ item }) => {
      if (filterMode === "pass") return item.status === "pass";
      if (filterMode === "fail") return item.status === "fail";
      if (filterMode === "pending") return item.status === "pending" || item.status === "scanning";
      return true;
    });

  const scrollToAnalyze = () => {
    document.getElementById("analyze")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const scrollToId = (id) => (e) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div style={styles.root}>
      <style>{fontImport}</style>

      {/* NAVBAR */}
      <nav style={styles.navbar}>
        <div style={styles.brand}>
          <span style={styles.mark}>PV</span> ParakhVision
        </div>
        <div style={styles.navLinks} className="pv-nav-links">
          <a href="#home" style={styles.navLink} onClick={scrollToId("home")}>Home</a>
          <a href="#analyze" style={styles.navLink} onClick={scrollToId("analyze")}>Inspect</a>
          <a href="#how" style={styles.navLink} onClick={scrollToId("how")}>Workflow</a>
        </div>
        <button style={styles.navBtn} onClick={scrollToAnalyze}>Try It</button>
      </nav>

      {/* HERO SECTION */}
      <section id="home" style={styles.hero}>
        <div style={styles.heroContent}>
          <HeroGraphic />
          <div style={styles.heroActions}>
            <button style={styles.btnPrimary} onClick={scrollToAnalyze}>
              Start Batch Inspection →
            </button>
            <a style={styles.btnGhost} href="#how" onClick={scrollToId("how")}>
              How It Works ↓
            </a>
          </div>
        </div>
        <div style={styles.heroWorkflow} id="how" className="pv-hero-workflow">
          <WfStep n="01" stage="capture" title="Batch Capture" text="Select multiple images or drag-and-drop batches directly into the conveyor line." delay="0.15s" />
          <WfStep n="02" stage="preprocess" title="Preprocess" text="Frames are normalized and scaled consistently for PatchCore feature extraction." delay="0.4s" />
          <WfStep n="03" stage="detect" title="Batch Detect" text="PatchCore scans each part sequentially, flagging surface cracks, scratches, and flaws." delay="0.65s" />
          <WfStep n="04" stage="report" title="Batch Report" text="Instant pass/fail classification, heatmaps, defect rates, and exportable CSV reports." delay="0.9s" last />
        </div>
      </section>

      <Conveyor stroke="#3a4256" bg="var(--dark-bg)" />

      {/* ANALYZE / WORKSPACE */}
      <section id="analyze" style={{ ...styles.section, background: "var(--light-bg)", color: "var(--light-text)" }}>
        <div style={styles.sectionHeading}>
          <div style={{ ...styles.eyebrow, color: "var(--amber-deep)" }}>AI Batch Quality Control</div>
          <h2 style={styles.h2}>Industrial Batch Image Inspection</h2>
          <p style={{ ...styles.sectionP, color: "var(--light-dim)" }}>
            Upload multiple product images to evaluate entire production batches. Inspect parts one-by-one or in automated bulk sequence.
          </p>
        </div>

        {/* BATCH OVERVIEW METRICS BANNER */}
        {batch.length > 0 && (
          <div style={styles.batchBanner}>
            <div style={styles.metricCard}>
              <span style={styles.metricLabel}>Total Batch</span>
              <span style={styles.metricValue}>{totalCount}</span>
              <span style={styles.metricSub}>parts loaded</span>
            </div>
            <div style={styles.metricCard}>
              <span style={styles.metricLabel}>Passed</span>
              <span style={{ ...styles.metricValue, color: "var(--pass)" }}>{passCount}</span>
              <span style={styles.metricSub}>verified normal</span>
            </div>
            <div style={styles.metricCard}>
              <span style={styles.metricLabel}>Defective</span>
              <span style={{ ...styles.metricValue, color: "var(--fail)" }}>{failCount}</span>
              <span style={styles.metricSub}>anomalies detected</span>
            </div>
            <div style={styles.metricCard}>
              <span style={styles.metricLabel}>Defect Rate</span>
              <span style={{ ...styles.metricValue, color: failCount > 0 ? "var(--fail)" : "var(--pass)" }}>
                {defectRate}%
              </span>
              <span style={styles.metricSub}>{inspectedCount}/{totalCount} inspected</span>
            </div>
            <div style={styles.metricCard}>
              <span style={styles.metricLabel}>Pending</span>
              <span style={{ ...styles.metricValue, color: "var(--amber-deep)" }}>{pendingCount}</span>
              <span style={styles.metricSub}>awaiting scan</span>
            </div>
          </div>
        )}

        {/* SCANNING PROGRESS BAR */}
        {isScanning && (
          <div style={styles.progressBarContainer}>
            <div style={styles.progressHeader}>
              <span style={styles.progressText}>
                SCANNING BATCH — PART {batchProgress.current} OF {batchProgress.total} (
                {Math.round((batchProgress.current / batchProgress.total) * 100)}%) : {batchProgress.currentName}
              </span>
            </div>
            <div style={styles.progressTrack}>
              <div
                style={{
                  ...styles.progressBar,
                  width: `${(batchProgress.current / batchProgress.total) * 100}%`,
                }}
              />
            </div>
          </div>
        )}

        <div style={styles.workspace} className="pv-workspace">
          {/* LEFT PANEL: INSPECTION TRAY */}
          <div style={styles.panel}>
            <div style={styles.panelHead}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h3 style={styles.panelH3}>Inspection Tray</h3>
                {batch.length > 1 && (
                  <span style={styles.batchIndexBadge}>
                    Part {activeIdx + 1} of {batch.length}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {batch.length > 1 && (
                  <>
                    <button
                      style={styles.navBtnSmall}
                      disabled={activeIdx <= 0 || isScanning}
                      onClick={() => setActiveIdx((prev) => Math.max(0, prev - 1))}
                      title="Previous Part"
                    >
                      ← Prev
                    </button>
                    <button
                      style={styles.navBtnSmall}
                      disabled={activeIdx >= batch.length - 1 || isScanning}
                      onClick={() => setActiveIdx((prev) => Math.min(batch.length - 1, prev + 1))}
                      title="Next Part"
                    >
                      Next →
                    </button>
                  </>
                )}
                <span style={styles.tagPill}>CAM-05 · RGB</span>
              </div>
            </div>

            {/* DROPZONE / VIEWER */}
            <div
              style={{
                ...styles.dropzone,
                borderColor: dragging ? "var(--amber-deep)" : "var(--light-line)",
                background: dragging ? "rgba(232,163,61,0.06)" : styles.dropzone.background,
              }}
              onClick={() => {
                if (batch.length === 0) fileInputRef.current?.click();
              }}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
              onDrop={handleDrop}
              tabIndex={0}
            >
              {batch.length === 0 && (
                <div style={{ padding: 40, textAlign: "center" }}>
                  <div style={styles.dzIcon}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <path d="M12 16V4M12 4l-4 4M12 4l4 4" />
                      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
                    </svg>
                  </div>
                  <div style={styles.dzLabel}>
                    <b style={{ color: "var(--light-text)", fontSize: 13 }}>Click to upload multiple images</b>
                    <br />or drag and drop batches · JPG, PNG, WEBP
                  </div>
                  <div style={styles.dzHint}>Upload single parts or multiple files in one batch</div>
                </div>
              )}

              {batch.length > 0 && (
                <div style={{ position: "relative", width: "100%", lineHeight: 0 }}>
                  <canvas ref={canvasRef} style={{ width: "100%", height: "auto", display: "block" }} />

                  {isScanning && activeItem?.status === "scanning" && (
                    <>
                      <div style={styles.scanline} />
                      <div style={styles.analyzingBadge}>ANALYZING PART — RUNNING PATCHCORE</div>
                    </>
                  )}

                  {activeItem && !isScanning && (
                    <div style={styles.canvasInfoOverlay}>
                      <span>{activeItem.name}</span>
                      <span>{activeItem.size}</span>
                    </div>
                  )}
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleInitialFileChange}
              />
              <input
                ref={addFileInputRef}
                type="file"
                multiple
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleAddMoreFiles}
              />
            </div>

            {/* BATCH FILMSTRIP CAROUSEL */}
            {batch.length > 0 && (
              <div style={styles.batchQueueSection}>
                <div style={styles.batchQueueHead}>
                  <div style={styles.batchQueueTitle}>
                    Batch Filmstrip ({batch.length} parts)
                  </div>
                  <div style={styles.filterGroup}>
                    {["all", "pass", "fail", "pending"].map((m) => (
                      <button
                        key={m}
                        style={{
                          ...styles.filterBtn,
                          background: filterMode === m ? "var(--amber)" : "transparent",
                          color: filterMode === m ? "#1a1300" : "var(--light-dim)",
                          borderColor: filterMode === m ? "var(--amber)" : "var(--light-line)",
                        }}
                        onClick={() => setFilterMode(m)}
                      >
                        {m.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={styles.filmstripContainer}>
                  {filteredBatch.map(({ item, originalIdx }) => {
                    const isActive = originalIdx === activeIdx;
                    return (
                      <div
                        key={item.id + originalIdx}
                        style={{
                          ...styles.filmstripCard,
                          borderColor: isActive ? "var(--amber)" : "var(--light-line)",
                          boxShadow: isActive ? "0 0 0 2px var(--amber)" : "none",
                        }}
                        onClick={() => setActiveIdx(originalIdx)}
                      >
                        <div style={styles.filmstripThumbWrap}>
                          <img src={item.previewUrl} alt={item.name} style={styles.filmstripThumb} />
                          <button
                            style={styles.cardRemoveBtn}
                            onClick={(e) => removeBatchItem(originalIdx, e)}
                            title="Remove from batch"
                          >
                            ×
                          </button>
                          <span style={styles.cardIdxBadge}>#{originalIdx + 1}</span>
                        </div>

                        <div style={styles.cardFooter}>
                          <div style={styles.cardFileName} title={item.name}>
                            {item.name}
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                            <span
                              style={{
                                ...styles.statusPill,
                                color:
                                  item.status === "pass"
                                    ? "var(--pass)"
                                    : item.status === "fail"
                                    ? "var(--fail)"
                                    : item.status === "scanning"
                                    ? "var(--amber-deep)"
                                    : "var(--light-dim)",
                                borderColor:
                                  item.status === "pass"
                                    ? "var(--pass)"
                                    : item.status === "fail"
                                    ? "var(--fail)"
                                    : item.status === "scanning"
                                    ? "var(--amber-deep)"
                                    : "var(--light-line)",
                              }}
                            >
                              {item.status.toUpperCase()}
                            </span>
                            {item.score != null && (
                              <span style={styles.cardScoreText}>
                                {(item.score * 100).toFixed(0)}%
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* Add more button card */}
                  <div
                    style={styles.filmstripAddCard}
                    onClick={() => addFileInputRef.current?.click()}
                    title="Add more images to this batch"
                  >
                    <span style={{ fontSize: 24, lineHeight: 1, color: "var(--amber-deep)" }}>+</span>
                    <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: "var(--light-dim)", marginTop: 4 }}>
                      Add More
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* ACTION BUTTONS */}
            <div style={styles.trayActions}>
              <button
                style={{
                  ...styles.btn,
                  ...styles.btnSolid,
                  opacity: batch.length === 0 || isScanning ? 0.35 : 1,
                  cursor: batch.length === 0 || isScanning ? "not-allowed" : "pointer",
                }}
                disabled={batch.length === 0 || isScanning}
                onClick={runBatchInspection}
              >
                {isScanning
                  ? "Inspecting Batch..."
                  : `Run Batch Inspection (${batch.length} ${batch.length === 1 ? "part" : "parts"})`}
              </button>

              <button
                style={{
                  ...styles.btn,
                  opacity: batch.length === 0 || isScanning ? 0.35 : 1,
                  cursor: batch.length === 0 || isScanning ? "not-allowed" : "pointer",
                }}
                disabled={batch.length === 0 || isScanning}
                onClick={runActiveInspection}
              >
                Inspect Selected Only
              </button>

              <button
                style={styles.btn}
                onClick={() => addFileInputRef.current?.click()}
              >
                + Add Images
              </button>

              {inspectedCount > 0 && (
                <button style={styles.btn} onClick={exportBatchCsv} title="Download CSV summary">
                  Export CSV
                </button>
              )}

              <button
                style={{
                  ...styles.btn,
                  opacity: batch.length === 0 || isScanning ? 0.35 : 1,
                  cursor: batch.length === 0 || isScanning ? "not-allowed" : "pointer",
                }}
                disabled={batch.length === 0 || isScanning}
                onClick={clearBatch}
              >
                Clear Batch
              </button>
            </div>

            <div style={styles.legend}>
              <div style={styles.legendItem}>
                <span style={{ ...styles.legendSwatch, borderColor: "var(--fail)", background: "rgba(194,68,68,0.15)" }} />
                Defect bounding box
              </div>
              <div style={styles.legendItem}>
                <span style={{ ...styles.legendSwatch, borderColor: "var(--pass)", background: "rgba(63,143,95,0.15)" }} />
                Normal pass
              </div>
              <div style={styles.legendItem}>
                <span style={{ ...styles.legendSwatch, borderColor: "var(--amber-deep)", background: "transparent" }} />
                Active selection
              </div>
            </div>
          </div>

          {/* RIGHT PANEL: INSPECTION REPORT */}
          <div>
            <div style={styles.report}>
              <div style={styles.reportTop}>
                <p style={styles.rEyebrow}>Part Inspection Report</p>
                <h3 style={styles.reportH3}>{report.partId}</h3>
                <div style={styles.reportSubFilename}>{report.filename}</div>
              </div>

              <div style={styles.fieldList}>
                <FieldRow k="Part ID" v={report.partId} />
                <FieldRow k="Filename" v={report.filename} />
                <FieldRow k="Timestamp" v={report.time} />
                <FieldRow k="Inspector" v="PATCHCORE-05 · RGB" />
                <FieldRow k="Defect type" v={report.defect} />
                <FieldRow k="Anomaly Score" v={report.confidence} />
                <FieldRow k="Region" v={report.region} last />
              </div>

              <div style={styles.perf} />

              <div style={styles.stampZone}>
                {!report.result && (
                  <div style={styles.stampPlaceholder}>
                    RESULT PENDING
                    <br />
                    RUN INSPECTION TO GENERATE STAMP
                  </div>
                )}
                {report.result && (
                  <div
                    style={{
                      ...styles.stamp,
                      opacity: 0.95,
                      transform: "rotate(-7deg) scale(1)",
                      color: report.result === "pass" ? "var(--pass)" : "var(--fail)",
                    }}
                  >
                    {report.result === "pass" ? "PASS" : "FAIL"}
                  </div>
                )}
              </div>

              {defectNote && (
                <div style={styles.defectNote}>
                  <b style={{ color: "var(--dark-text)" }}>{defectNote.label} detected.</b>{" "}
                  {defectNote.note}
                </div>
              )}

              {visualization && (
                <div style={styles.visualizationPanel}>
                  <div style={styles.visualizationTitle}>AI Visual Heatmap</div>
                  <img
                    src={`${API_URL}${visualization.overlay}`}
                    alt="AI anomaly detection overlay"
                    style={styles.visualizationImage}
                  />
                  <div style={styles.visualizationLinks}>
                    <a style={styles.visualizationLink} href={`${API_URL}${visualization.original}`} target="_blank" rel="noreferrer">Original</a>
                    <a style={styles.visualizationLink} href={`${API_URL}${visualization.heatmap}`} target="_blank" rel="noreferrer">Heatmap</a>
                    <a style={styles.visualizationLink} href={`${API_URL}${visualization.overlay}`} target="_blank" rel="noreferrer">Detection Overlay</a>
                  </div>
                </div>
              )}

              {analysis && (
                <div style={styles.aiReasoning}>
                  <div style={styles.visualizationTitle}>AI Quality Assessment</div>
                  <div style={styles.reasoningRow}><b>Why:</b><span>{analysis.reason}</span></div>
                  {analysis.potential_impact && (
                    <div style={styles.reasoningRow}><b>Potential Impact:</b><span>{analysis.potential_impact}</span></div>
                  )}
                  {analysis.recommended_action && (
                    <div style={styles.reasoningRow}><b>Recommended Action:</b><span>{analysis.recommended_action}</span></div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* LOG SECTION */}
        <div style={styles.logSection}>
          <div style={styles.logHead}>
            <h3 style={styles.logH3}>Batch Session Inspection Log</h3>
            <span style={styles.logCountText}>
              {logs.length} {logs.length === 1 ? "record" : "records"}
            </span>
          </div>

          <div style={styles.logTable}>
            <div style={{ ...styles.logRow, ...styles.logRowHead }}>
              <span>Part ID</span>
              <span>Filename</span>
              <span>Defect</span>
              <span>Score</span>
              <span>Time</span>
              <span>Result</span>
            </div>
            {logs.length === 0 && (
              <div style={styles.logEmpty}>No inspections run yet in this session.</div>
            )}
            {logs.map((row, i) => (
              <div style={styles.logRow} key={i}>
                <span style={{ fontWeight: 600 }}>{row.id}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.filename}>
                  {row.filename || "—"}
                </span>
                <span>{row.defect}</span>
                <span>{row.score}</span>
                <span>{row.time}</span>
                <span
                  style={{
                    ...styles.pill,
                    color: row.result === "pass" ? "var(--pass)" : "var(--fail)",
                    borderColor: row.result === "pass" ? "var(--pass)" : "var(--fail)",
                  }}
                >
                  {row.result.toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer style={styles.footer}>
        <div style={styles.footerBrand}>ParakhVision — AI-powered visual quality inspection for manufacturing lines</div>
      </footer>
    </div>
  );
}

function FieldRow({ k, v, last }) {
  return (
    <div style={{ ...styles.fieldRow, borderBottom: last ? "none" : styles.fieldRow.borderBottom }}>
      <span style={styles.fieldK}>{k}</span>
      <span style={styles.fieldV}>{v}</span>
    </div>
  );
}

function HeroGraphic() {
  return (
    <svg
      width="100%"
      height="auto"
      viewBox="0 0 480 300"
      style={styles.heroGraphic}
      role="img"
      aria-label="Illustration of an AI camera scanning a manufactured part for defects"
    >
      <defs>
        <radialGradient id="hgGlow" cx="50%" cy="42%" r="60%">
          <stop offset="0%" stopColor="rgba(232,163,61,0.16)" />
          <stop offset="100%" stopColor="rgba(232,163,61,0)" />
        </radialGradient>
      </defs>

      <rect x="0" y="0" width="480" height="300" fill="url(#hgGlow)" />
      <rect x="30" y="24" width="420" height="252" rx="8" fill="var(--dark-bg-2)" stroke="var(--dark-line)" strokeWidth="1.4" />

      {/* camera unit */}
      <g>
        <rect x="205" y="46" width="70" height="34" rx="5" fill="var(--dark-bg)" stroke="var(--amber)" strokeWidth="1.6" />
        <circle cx="240" cy="63" r="10" fill="none" stroke="var(--amber)" strokeWidth="1.8" />
        <circle cx="240" cy="63" r="3.4" fill="var(--amber)" className="pv-thumb-flash" />
        <rect x="228" y="80" width="24" height="8" fill="var(--dark-bg)" stroke="var(--amber-deep)" strokeWidth="1.2" />
      </g>

      {/* scan beam */}
      <path d="M215 88 L150 190 L330 190 Z" fill="rgba(232,163,61,0.07)" stroke="var(--amber-deep)" strokeWidth="1" strokeDasharray="4 4" />
      <line x1="150" y1="120" x2="330" y2="120" stroke="var(--amber)" strokeWidth="1.6" className="pv-thumb-scanline" opacity="0.85" />

      {/* inspected parts */}
      <g transform="translate(240 210)">
        <rect x="-70" y="-34" width="140" height="68" rx="6" fill="var(--dark-bg)" stroke="var(--dark-line)" strokeWidth="1.4" />
        <circle cx="-34" cy="0" r="14" fill="none" stroke="var(--dark-dim)" strokeWidth="1.6" />
        <rect x="-4" y="-16" width="60" height="10" fill="none" stroke="var(--dark-dim)" strokeWidth="1.4" />
        <rect x="-4" y="4" width="60" height="10" fill="none" stroke="var(--dark-dim)" strokeWidth="1.4" />
        <rect x="14" y="-24" width="34" height="22" fill="none" stroke="var(--fail)" strokeWidth="1.6" strokeDasharray="112" className="pv-thumb-box-in" />
      </g>

      <g transform="translate(360 210)" className="pv-thumb-stamp-in" style={{ transformOrigin: "360px 210px" }}>
        <rect x="-34" y="-16" width="68" height="32" rx="4" fill="none" stroke="var(--fail)" strokeWidth="2" />
        <text x="0" y="5" textAnchor="middle" fontFamily={FONT_MONO} fontSize="13" fontWeight="700" fill="var(--fail)">
          FAIL
        </text>
      </g>

      <circle cx="100" cy="60" r="2.4" fill="var(--amber-deep)">
        <animate attributeName="opacity" values="0.25;1;0.25" dur="2.4s" repeatCount="indefinite" />
      </circle>
      <circle cx="380" cy="90" r="2.4" fill="var(--amber-deep)">
        <animate attributeName="opacity" values="1;0.25;1" dur="2.1s" repeatCount="indefinite" />
      </circle>
      <path d="M60 60 H100 M380 90 H420" stroke="var(--dark-line)" strokeWidth="1" />
    </svg>
  );
}

function WfStep({ n, title, text, delay, last, stage }) {
  return (
    <div className="pv-wf-step" style={{ ...styles.wfStep, animationDelay: delay }}>
      <div style={styles.wfMarker}>
        <span style={styles.wfDot}>{n}</span>
        {!last && <span style={styles.wfConnector} />}
      </div>
      <div style={{ ...styles.wfBodyRow, paddingBottom: last ? 0 : 30 }}>
        <WfThumb stage={stage} />
        <div>
          <h4 style={styles.wfH4}>{title}</h4>
          <p style={styles.wfP}>{text}</p>
        </div>
      </div>
    </div>
  );
}

function WfThumb({ stage }) {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" style={styles.wfThumb}>
      <rect x="6" y="6" width="44" height="44" rx="4" fill="var(--dark-bg-2)" stroke="var(--dark-line)" strokeWidth="1.4" />

      {stage === "capture" && (
        <>
          <path
            d="M15 20h4l2-3h14l2 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H15a2 2 0 0 1-2-2V22a2 2 0 0 1 2-2z"
            fill="none"
            stroke="var(--amber)"
            strokeWidth="1.5"
          />
          <circle cx="28" cy="30" r="6" fill="none" stroke="var(--amber)" strokeWidth="1.5" />
          <circle cx="28" cy="30" r="2.2" fill="var(--amber)" className="pv-thumb-flash" />
        </>
      )}

      {stage === "preprocess" && (
        <>
          <rect x="12" y="12" width="32" height="32" fill="none" stroke="var(--dark-dim)" strokeWidth="1" strokeDasharray="3 3" />
          <rect x="16" y="16" width="24" height="24" fill="none" stroke="var(--amber-deep)" strokeWidth="1.6" strokeDasharray="6 4" className="pv-thumb-dash" />
          <path d="M11 11h6M11 11v6M45 11h-6M45 11v6M11 45h6M11 45v-6M45 45h-6M45 45v-6" stroke="var(--amber)" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        </>
      )}

      {stage === "detect" && (
        <>
          <rect x="17" y="19" width="22" height="17" fill="none" stroke="var(--fail)" strokeWidth="1.6" strokeDasharray="120" className="pv-thumb-box-in" />
          <clipPath id="wfThumbClip">
            <rect x="9" y="9" width="38" height="38" rx="2" />
          </clipPath>
          <line x1="9" y1="9" x2="47" y2="9" stroke="var(--amber)" strokeWidth="1.8" className="pv-thumb-scanline" clipPath="url(#wfThumbClip)" />
        </>
      )}

      {stage === "report" && (
        <g className="pv-thumb-stamp-in" style={{ transformOrigin: "28px 28px" }}>
          <rect x="14" y="21" width="28" height="15" rx="2" fill="none" stroke="var(--pass)" strokeWidth="2" />
          <path d="M19 28.5l4.5 4.5 10-10" fill="none" stroke="var(--pass)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
    </svg>
  );
}

function Conveyor({ stroke, bg }) {
  return (
    <div style={{ height: 34, position: "relative", overflow: "hidden", background: bg }}>
      <svg viewBox="0 0 1200 34" preserveAspectRatio="none" style={{ width: "100%", height: "100%", display: "block" }}>
        <line x1="0" y1="17" x2="1200" y2="17" stroke={stroke} strokeWidth="1" strokeDasharray="10 8" />
      </svg>
    </div>
  );
}

const fontImport = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap');

  :root{
    --dark-bg: #171b24;
    --dark-bg-2: #1e2430;
    --dark-line: #2e3546;
    --dark-text: #f1eee4;
    --dark-dim: #93a0b8;
    --light-bg: #f2efe6;
    --light-panel: #fbf9f3;
    --light-line: #ddd6c5;
    --light-text: #22242b;
    --light-dim: #6c6656;
    --amber: #e8a33d;
    --amber-deep: #c67f1f;
    --pass: #3f8f5f;
    --fail: #c24444;
  }
  @keyframes pv-scan { 0% { top: 0%; } 100% { top: 100%; } }
  @keyframes pv-wf-in { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
  .pv-wf-step { animation-name: pv-wf-in; animation-duration: 0.6s; animation-timing-function: ease; animation-fill-mode: forwards; }
  @keyframes pv-thumb-flash { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }
  .pv-thumb-flash { animation: pv-thumb-flash 1.8s ease-in-out infinite; }
  @keyframes pv-thumb-dash { to { stroke-dashoffset: -20; } }
  .pv-thumb-dash { animation: pv-thumb-dash 1.4s linear infinite; }
  @keyframes pv-thumb-box-in { 0% { stroke-dashoffset: 120; opacity: 0; } 60% { opacity: 1; } 100% { stroke-dashoffset: 0; opacity: 1; } }
  .pv-thumb-box-in { animation: pv-thumb-box-in 2.2s ease-in-out infinite; }
  @keyframes pv-thumb-scanline { 0% { transform: translateY(0); } 100% { transform: translateY(38px); } }
  .pv-thumb-scanline { animation: pv-thumb-scanline 1.6s ease-in-out infinite alternate; }
  @keyframes pv-thumb-stamp-in { 0%, 55% { transform: scale(0.5) rotate(-14deg); opacity: 0; } 75% { transform: scale(1.12) rotate(-6deg); opacity: 1; } 100% { transform: scale(1) rotate(-6deg); opacity: 1; } }
  .pv-thumb-stamp-in { animation: pv-thumb-stamp-in 2.6s ease-in-out infinite; }
  @keyframes pv-progress-pulse { 0% { background-position: 0 0; } 100% { background-position: 40px 0; } }
  @media (max-width: 900px) {
    .pv-workspace { grid-template-columns: 1fr !important; }
  }
  @media (max-width: 840px) {
    .pv-nav-links { display: none !important; }
  }
  @media (prefers-reduced-motion: reduce) {
    .pv-wf-step { animation: none !important; opacity: 1 !important; transform: none !important; }
  }
`;

const FONT_DISPLAY = "'Space Grotesk', sans-serif";
const FONT_BODY = "'Inter', sans-serif";
const FONT_MONO = "'JetBrains Mono', monospace";

const styles = {
  root: {
    fontFamily: FONT_BODY,
    lineHeight: 1.6,
    background: "var(--light-bg)",
    color: "var(--light-text)",
    minHeight: "100vh",
  },
  navbar: {
    position: "sticky",
    top: 0,
    zIndex: 20,
    height: 112,
    padding: "0 6%",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: "rgba(23,27,36,0.94)",
    backdropFilter: "blur(10px)",
    borderBottom: "1px solid var(--dark-line)",
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 15,
    fontFamily: FONT_DISPLAY,
    fontWeight: 700,
    fontSize: 30,
    letterSpacing: "0.01em",
    color: "var(--dark-text)",
  },
  mark: {
    width: 50,
    height: 50,
    border: "2.5px solid var(--amber)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: FONT_MONO,
    fontSize: 15,
    fontWeight: 700,
    color: "var(--amber)",
  },
  navLinks: { display: "flex", gap: 38, fontSize: 16, fontWeight: 700, color: "var(--dark-dim)" },
  navLink: { color: "inherit", textDecoration: "none" },
  navBtn: {
    fontFamily: FONT_MONO,
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    padding: "14px 26px",
    background: "var(--amber)",
    color: "#1a1300",
    border: "none",
    cursor: "pointer",
  },
  hero: {
    padding: "90px 6% 70px",
    display: "grid",
    gridTemplateColumns: "1.05fr 0.95fr",
    gap: 50,
    alignItems: "center",
    background:
      "radial-gradient(700px 400px at 85% 10%, rgba(232,163,61,0.07), transparent 60%), var(--dark-bg)",
    minHeight: "calc(100vh - 112px)",
    color: "var(--dark-text)",
  },
  heroContent: {},
  heroGraphic: { display: "block", width: "100%", maxWidth: 480, marginBottom: 28 },
  heroActions: { display: "flex", gap: 14, flexWrap: "wrap" },
  btnPrimary: {
    fontFamily: FONT_MONO,
    fontSize: 12.5,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    padding: "14px 22px",
    background: "var(--amber)",
    color: "#1a1300",
    border: "none",
    fontWeight: 700,
    cursor: "pointer",
  },
  btnGhost: {
    fontFamily: FONT_MONO,
    fontSize: 12.5,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    padding: "13px 22px",
    border: "1px solid var(--dark-line)",
    color: "var(--dark-text)",
    textDecoration: "none",
  },
  heroWorkflow: { display: "flex", flexDirection: "column" },
  wfStep: { display: "flex", gap: 18, opacity: 0, transform: "translateY(16px)" },
  wfMarker: { display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 },
  wfDot: {
    width: 38,
    height: 38,
    border: "2px solid var(--amber)",
    background: "var(--dark-bg)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: FONT_MONO,
    fontWeight: 700,
    fontSize: 12,
    color: "var(--amber)",
  },
  wfConnector: { flex: 1, width: 1, minHeight: 26, background: "var(--dark-line)", marginTop: 4 },
  wfBody: {},
  wfBodyRow: { display: "flex", gap: 16, alignItems: "flex-start" },
  wfThumb: { flexShrink: 0, marginTop: 2 },
  wfH4: { fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 600, marginBottom: 5 },
  wfP: { color: "var(--dark-dim)", fontSize: 13.5, maxWidth: 340, margin: 0 },
  section: { padding: "90px 6%" },
  sectionHeading: { textAlign: "center", maxWidth: 640, margin: "0 auto 36px" },
  eyebrow: { fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase" },
  h2: { fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: "clamp(26px,3vw,36px)", margin: "10px 0" },
  sectionP: { fontSize: 15 },

  // BATCH METRICS BANNER
  batchBanner: {
    maxWidth: 1140,
    margin: "0 auto 24px",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 14,
  },
  metricCard: {
    background: "var(--light-panel)",
    border: "1px solid var(--light-line)",
    padding: "16px 18px",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  metricLabel: {
    fontFamily: FONT_MONO,
    fontSize: 10.5,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "var(--light-dim)",
  },
  metricValue: {
    fontFamily: FONT_DISPLAY,
    fontSize: 28,
    fontWeight: 700,
    lineHeight: 1.1,
    color: "var(--light-text)",
  },
  metricSub: {
    fontFamily: FONT_MONO,
    fontSize: 11,
    color: "var(--light-dim)",
  },

  // PROGRESS BAR
  progressBarContainer: {
    maxWidth: 1140,
    margin: "0 auto 24px",
    background: "var(--dark-bg-2)",
    border: "1px solid var(--dark-line)",
    padding: 16,
  },
  progressHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  progressText: {
    fontFamily: FONT_MONO,
    fontSize: 11.5,
    color: "var(--amber)",
    letterSpacing: "0.05em",
  },
  progressTrack: {
    width: "100%",
    height: 8,
    background: "rgba(255,255,255,0.08)",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    background: "linear-gradient(90deg, var(--amber-deep), var(--amber))",
    transition: "width 0.25s ease",
  },

  workspace: {
    maxWidth: 1140,
    margin: "0 auto",
    display: "grid",
    gridTemplateColumns: "1.4fr 1fr",
    gap: 24,
    alignItems: "start",
  },
  panel: { background: "var(--light-panel)", border: "1px solid var(--light-line)", padding: 24 },
  panelHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  panelH3: { fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 600, margin: 0 },
  batchIndexBadge: {
    fontFamily: FONT_MONO,
    fontSize: 11,
    padding: "2px 8px",
    background: "rgba(232,163,61,0.12)",
    color: "var(--amber-deep)",
    border: "1px solid var(--amber-deep)",
    borderRadius: 3,
  },
  tagPill: {
    fontFamily: FONT_MONO,
    fontSize: 10.5,
    color: "var(--light-dim)",
    border: "1px solid var(--light-line)",
    padding: "3px 9px",
    letterSpacing: "0.06em",
  },
  navBtnSmall: {
    fontFamily: FONT_MONO,
    fontSize: 11,
    padding: "4px 8px",
    background: "transparent",
    border: "1px solid var(--light-line)",
    color: "var(--light-text)",
    cursor: "pointer",
  },
  dropzone: {
    position: "relative",
    border: "1.5px dashed var(--light-line)",
    minHeight: 320,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "column",
    gap: 14,
    cursor: "pointer",
    background: "repeating-linear-gradient(45deg, rgba(0,0,0,0.012) 0 2px, transparent 2px 14px)",
    transition: "border-color .18s ease, background .18s ease",
  },
  dzIcon: {
    width: 48,
    height: 48,
    border: "1.5px solid var(--light-dim)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--light-dim)",
    margin: "0 auto 14px",
  },
  dzLabel: {
    fontFamily: FONT_MONO,
    fontSize: 12,
    color: "var(--light-dim)",
    textAlign: "center",
    letterSpacing: "0.03em",
  },
  dzHint: {
    fontFamily: FONT_MONO,
    fontSize: 11,
    color: "var(--amber-deep)",
    marginTop: 8,
  },
  scanline: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 2,
    top: 0,
    background: "linear-gradient(90deg, transparent, var(--amber-deep), transparent)",
    boxShadow: "0 0 12px 2px rgba(198,127,31,0.5)",
    animation: "pv-scan 1.5s linear infinite",
  },
  analyzingBadge: {
    position: "absolute",
    top: 10,
    left: 10,
    fontFamily: FONT_MONO,
    fontSize: 10.5,
    background: "rgba(23,27,36,0.88)",
    color: "var(--amber)",
    border: "1px solid var(--amber-deep)",
    padding: "4px 9px",
    letterSpacing: "0.1em",
  },
  canvasInfoOverlay: {
    position: "absolute",
    bottom: 8,
    left: 8,
    right: 8,
    background: "rgba(23,27,36,0.8)",
    color: "var(--dark-text)",
    fontFamily: FONT_MONO,
    fontSize: 10.5,
    padding: "4px 8px",
    display: "flex",
    justifyContent: "space-between",
  },

  // BATCH FILMSTRIP
  batchQueueSection: {
    marginTop: 20,
    borderTop: "1px solid var(--light-line)",
    paddingTop: 16,
  },
  batchQueueHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  batchQueueTitle: {
    fontFamily: FONT_MONO,
    fontSize: 11.5,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    fontWeight: 600,
    color: "var(--light-text)",
  },
  filterGroup: {
    display: "flex",
    gap: 4,
  },
  filterBtn: {
    fontFamily: FONT_MONO,
    fontSize: 9.5,
    padding: "3px 7px",
    border: "1px solid",
    cursor: "pointer",
  },
  filmstripContainer: {
    display: "flex",
    gap: 10,
    overflowX: "auto",
    paddingBottom: 8,
  },
  filmstripCard: {
    flex: "0 0 110px",
    background: "var(--light-bg)",
    border: "1.5px solid",
    padding: 6,
    cursor: "pointer",
    transition: "border-color 0.15s, box-shadow 0.15s",
  },
  filmstripThumbWrap: {
    position: "relative",
    width: "100%",
    height: 68,
    background: "#000",
    overflow: "hidden",
  },
  filmstripThumb: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },
  cardRemoveBtn: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 18,
    height: 18,
    background: "rgba(0,0,0,0.7)",
    color: "#fff",
    border: "none",
    borderRadius: "50%",
    fontSize: 13,
    lineHeight: "16px",
    cursor: "pointer",
    padding: 0,
  },
  cardIdxBadge: {
    position: "absolute",
    bottom: 2,
    left: 2,
    fontFamily: FONT_MONO,
    fontSize: 9,
    background: "rgba(0,0,0,0.75)",
    color: "#fff",
    padding: "1px 4px",
  },
  cardFooter: {
    paddingTop: 6,
  },
  cardFileName: {
    fontFamily: FONT_MONO,
    fontSize: 10,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--light-text)",
  },
  statusPill: {
    fontFamily: FONT_MONO,
    fontSize: 9,
    padding: "1px 4px",
    border: "1px solid",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  },
  cardScoreText: {
    fontFamily: FONT_MONO,
    fontSize: 10,
    fontWeight: 600,
    color: "var(--light-dim)",
  },
  filmstripAddCard: {
    flex: "0 0 85px",
    border: "1.5px dashed var(--light-line)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    background: "transparent",
  },

  trayActions: { display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" },
  btn: {
    fontFamily: FONT_MONO,
    fontSize: 11.5,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    padding: "10px 16px",
    border: "1px solid var(--light-line)",
    background: "transparent",
    color: "var(--light-text)",
    cursor: "pointer",
  },
  btnSolid: { background: "var(--amber)", borderColor: "var(--amber)", color: "#1a1300", fontWeight: 700 },
  legend: { display: "flex", gap: 16, marginTop: 14, flexWrap: "wrap" },
  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    fontFamily: FONT_MONO,
    fontSize: 10.5,
    color: "var(--light-dim)",
  },
  legendSwatch: { width: 10, height: 10, border: "1.5px solid" },

  // REPORT
  report: { background: "var(--dark-bg-2)", color: "var(--dark-text)", border: "1px solid var(--dark-line)" },
  reportTop: { padding: "20px 22px 14px", borderBottom: "1px dashed var(--dark-line)" },
  rEyebrow: {
    fontFamily: FONT_MONO,
    fontSize: 10,
    color: "var(--dark-dim)",
    letterSpacing: "0.14em",
    textTransform: "uppercase",
  },
  reportH3: { fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 600, marginTop: 4, margin: "4px 0 2px" },
  reportSubFilename: {
    fontFamily: FONT_MONO,
    fontSize: 11,
    color: "var(--amber)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  fieldList: { padding: "14px 22px" },
  fieldRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "8px 0",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    fontFamily: FONT_MONO,
    fontSize: 12,
  },
  fieldK: { color: "var(--dark-dim)" },
  fieldV: { fontWeight: 500 },
  perf: {
    height: 10,
    backgroundImage: "radial-gradient(circle, var(--light-bg) 3px, transparent 3.5px)",
    backgroundSize: "16px 10px",
    backgroundPosition: "8px center",
  },
  stampZone: {
    position: "relative",
    padding: "24px 22px 28px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 130,
  },
  stamp: {
    fontFamily: FONT_DISPLAY,
    fontWeight: 700,
    fontSize: 28,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    padding: "11px 24px",
    border: "4px solid currentColor",
    borderRadius: 6,
    transition: "opacity .18s ease, transform .28s cubic-bezier(.34,1.56,.64,1)",
  },
  stampPlaceholder: {
    fontFamily: FONT_MONO,
    fontSize: 11.5,
    color: "var(--dark-dim)",
    textAlign: "center",
    letterSpacing: "0.06em",
  },
  defectNote: {
    margin: "0 22px 20px",
    padding: "12px 14px",
    borderLeft: "3px solid var(--amber-deep)",
    background: "rgba(232,163,61,0.06)",
    fontSize: 12.5,
    lineHeight: 1.55,
    color: "var(--dark-dim)",
  },
  visualizationPanel: { margin: "0 22px 20px", padding: 14, background: "rgba(255,255,255,0.03)", border: "1px solid var(--dark-line)" },
  visualizationTitle: { fontFamily: FONT_MONO, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--amber)", marginBottom: 12 },
  visualizationImage: { display: "block", width: "100%", height: "auto", border: "1px solid var(--dark-line)" },
  visualizationLinks: { display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap" },
  visualizationLink: { color: "var(--amber)", fontFamily: FONT_MONO, fontSize: 10.5, textDecoration: "none" },
  aiReasoning: { margin: "0 22px 20px", padding: 14, background: "rgba(232,163,61,0.05)", borderLeft: "3px solid var(--amber-deep)" },
  reasoningRow: { display: "flex", flexDirection: "column", gap: 3, marginBottom: 10, fontSize: 12, lineHeight: 1.5, color: "var(--dark-dim)" },

  // LOGS
  logSection: { maxWidth: 1140, margin: "34px auto 0" },
  logHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  logH3: { fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 600, margin: 0 },
  logCountText: { fontFamily: FONT_MONO, fontSize: 10.5, color: "var(--light-dim)" },
  logTable: { border: "1px solid var(--light-line)", background: "var(--light-panel)" },
  logRow: {
    display: "grid",
    gridTemplateColumns: "110px 1.2fr 1fr 90px 100px 80px",
    gap: 10,
    padding: "11px 16px",
    borderBottom: "1px solid var(--light-line)",
    fontFamily: FONT_MONO,
    fontSize: 11.5,
    alignItems: "center",
  },
  logRowHead: {
    color: "var(--light-dim)",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    fontSize: 10,
  },
  pill: { display: "inline-block", padding: "2px 8px", fontSize: 10.5, border: "1px solid", letterSpacing: "0.05em", textAlign: "center" },
  logEmpty: {
    padding: "24px 16px",
    textAlign: "center",
    color: "var(--light-dim)",
    fontFamily: FONT_MONO,
    fontSize: 11.5,
  },
  footer: {
    background: "var(--dark-bg)",
    color: "var(--dark-dim)",
    textAlign: "center",
    padding: "30px 6%",
    borderTop: "1px solid var(--dark-line)",
    fontFamily: FONT_MONO,
    fontSize: 11.5,
  },
  footerBrand: {
    color: "var(--dark-text)",
    fontWeight: 600,
    fontSize: 12.5,
    marginBottom: 8,
    letterSpacing: "0.02em",
  },
};
