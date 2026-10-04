import React, { useEffect, useState } from "react";
import { compressImageForUpload } from "./image-compression.js";
import {
  AlertCircle, BadgeCheck, Box, Camera, CheckCircle2, ChevronRight,
  CircleHelp, ClipboardList, Clock3, FileImage, ImagePlus, LoaderCircle,
  PackageCheck, RefreshCw, ShieldAlert, TriangleAlert, Upload,
} from "lucide-react";

const ORGANIZATIONS = ["org_demo_alpha", "org_demo_bravo"];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

async function requestJson(url, orgId, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "x-org-id": orgId, ...options.headers },
  });
  let payload;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status}).`);
  return payload;
}

function tone(status) {
  if (status === "PASS" || status === "SEAL") return "pass";
  if (status === "FAIL" || status === "STOP_AND_FIX") return "fail";
  if (status === "GOOD") return "pass";
  if (status === "POOR") return "review";
  if (["UNCERTAIN", "REVIEW", "PENDING"].includes(status)) return "review";
  return "neutral";
}

function StatusTag({ status }) {
  return <span className={`status-tag tone-${tone(status)}`}>{status || "UNKNOWN"}</span>;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function lineStatus(check, sku) {
  return check?.lines?.find((line) => line.sku === sku)?.status || check?.status || "UNCERTAIN";
}

function inspectionFindings(inspection) {
  const expected = Array.isArray(inspection?.expectedItems) ? inspection.expectedItems : [];
  const detected = Array.isArray(inspection?.detectedItems) ? inspection.detectedItems : [];
  const expectedSkus = new Set(expected.map((item) => item.sku));
  return {
    missing: expected.filter((item) => lineStatus(inspection.checks?.presence, item.sku) === "FAIL"),
    wrong: expected.filter((item) => lineStatus(inspection.checks?.quantity, item.sku) === "FAIL"),
    extra: inspection.checks?.extra_items?.status === "FAIL" ? detected.filter((item) => !expectedSkus.has(item.sku)) : [],
  };
}

function InlineAlert({ kind = "error", children }) {
  const Icon = kind === "success" ? CheckCircle2 : kind === "error" ? AlertCircle : CircleHelp;
  return <div className={`inline-alert alert-${kind}`} role={kind === "error" ? "alert" : "status"}><Icon size={16} /><span>{children}</span></div>;
}

function CheckCard({ title, check, icon: Icon }) {
  return (
    <article className="check-card">
      <div className="check-heading"><span className="check-icon"><Icon size={16} /></span><strong>{title}</strong><StatusTag status={check?.status} /></div>
      <p>{check?.reason || "No check details were returned."}</p>
    </article>
  );
}

function FindingList({ title, items, empty }) {
  return (
    <article className="finding-card">
      <h4>{title}</h4>
      {items.length ? items.map((item) => <div className="finding-row" key={item.sku}><span>{item.sku}</span><span>{item.quantity} {item.quantity === 1 ? "unit" : "units"}</span></div>) : <p>{empty}</p>}
    </article>
  );
}

function ResultPanel({ inspection, orgId }) {
  const [captureUrl, setCaptureUrl] = useState("");
  const [captureLoading, setCaptureLoading] = useState(true);
  const [captureError, setCaptureError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    setCaptureUrl("");
    setCaptureError("");
    setCaptureLoading(true);
    fetch(`/api/inspections/${encodeURIComponent(inspection.id)}/capture`, {
      headers: { "x-org-id": orgId },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("The saved inspection photo could not be loaded.");
        return response.blob();
      })
      .then((image) => {
        objectUrl = URL.createObjectURL(image);
        setCaptureUrl(objectUrl);
      })
      .catch((error) => {
        if (error.name !== "AbortError") setCaptureError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCaptureLoading(false);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [inspection.id, orgId]);

  const decision = inspection.finalDecision || "REVIEW";
  const pending = inspection.modelStatus === "PENDING";
  const decisionMeta = {
    SEAL: ["Ready to seal", BadgeCheck],
    STOP_AND_FIX: ["Stop and fix", ShieldAlert],
    REVIEW: ["Review required", CircleHelp],
  }[decision] || ["Review required", CircleHelp];
  const [decisionTitle, DecisionIcon] = decisionMeta;
  const expected = Array.isArray(inspection.expectedItems) ? inspection.expectedItems : [];
  const detected = Array.isArray(inspection.detectedItems) ? inspection.detectedItems : [];
  const uncertain = Array.isArray(inspection.uncertainItems) ? inspection.uncertainItems : [];
  const evidence = Array.isArray(inspection.evidence) ? inspection.evidence : [];
  const findings = inspectionFindings(inspection);
  const extraCheck = inspection.checks?.extra_items;
  const providerLabel = inspection.modelProvider === "mock"
    ? "Mock Vision Scenario · not image inference"
    : inspection.modelProvider === "gemini"
      ? `Gemini Vision · ${pending ? "analysis pending" : "image inference"}`
      : inspection.modelProvider === "openai"
        ? `OpenAI Vision · ${pending ? "analysis pending" : "image inference"}`
        : inspection.modelProvider || "Provider unknown";

  return (
    <section className="result-panel" aria-label="Inspection details">
      <div className="result-meta">
        <span><Box size={14} /> {inspection.unitId || "Unknown unit"}</span>
        <span>Order {inspection.orderId || "—"}</span>
        <span>{formatDate(inspection.createdAt)}</span>
        <span className="provider-chip">{providerLabel}</span>
      </div>

      <section className="detail-section" aria-labelledby="photo-heading">
        <h3 id="photo-heading" className="detail-heading">A. Inspection Photo</h3>
        {captureLoading ? <p className="muted-copy">Loading saved photo…</p> : captureError ? <InlineAlert>{captureError}</InlineAlert> : (
          <img className="inspection-photo" src={captureUrl} alt={`Saved open-box photo for ${inspection.unitId}`} />
        )}
      </section>

      <section className="detail-section" aria-labelledby="expected-heading">
        <h3 id="expected-heading" className="detail-heading">B. Expected Items</h3>
        {expected.length ? <div className="table-wrap"><table>
          <thead><tr><th>SKU</th><th>Item name</th><th>Expected quantity</th></tr></thead>
          <tbody>{expected.map((item) => <tr key={item.sku}><td><strong>{item.sku}</strong></td><td>{item.name || item.sku}</td><td>{item.quantity}</td></tr>)}</tbody>
        </table></div> : <p className="muted-copy">No expected order lines were included.</p>}
      </section>

      <section className="detail-section" aria-labelledby="detected-heading">
        <h3 id="detected-heading" className="detail-heading">C. Detected Items <span className="demo-disclaimer">{providerLabel}</span></h3>
        {detected.length ? <div className="table-wrap"><table>
          <thead><tr><th>SKU</th><th>Item name</th><th>Observed quantity</th><th>Confidence</th></tr></thead>
          <tbody>{detected.map((item, index) => <tr key={`${item.sku}-${index}`}><td><strong>{item.sku}</strong></td><td>{item.name || item.sku}</td><td>{item.quantity}</td><td>{Number.isFinite(item.confidence) ? `${Math.round(item.confidence * 100)}%` : "—"}</td></tr>)}</tbody>
        </table></div> : <p className="muted-copy">No items were returned as detected.</p>}
      </section>

      <section className="detail-section" aria-labelledby="checks-heading">
        <h3 id="checks-heading" className="detail-heading">D. Verification Checks</h3>
        {expected.length ? <div className="table-wrap"><table>
          <thead><tr><th>SKU</th><th>Expected</th><th>Observed</th><th>Presence</th><th>Quantity</th></tr></thead>
          <tbody>{expected.map((item) => {
            const presenceLine = inspection.checks?.presence?.lines?.find((line) => line.sku === item.sku);
            const quantityLine = inspection.checks?.quantity?.lines?.find((line) => line.sku === item.sku);
            const observed = detected.filter((row) => row.sku === item.sku).reduce((sum, row) => sum + row.quantity, 0);
            const expectedQuantity = quantityLine?.expectedQuantity ?? item.quantity;
            const observedQuantity = quantityLine?.observedQuantity ?? observed;
            return <tr key={item.sku}>
              <td><strong>{item.sku}</strong></td><td>{expectedQuantity}</td><td>{observedQuantity}</td>
              <td><StatusTag status={presenceLine?.status || inspection.checks?.presence?.status} /></td>
              <td><StatusTag status={quantityLine?.status || inspection.checks?.quantity?.status} /></td>
            </tr>;
          })}</tbody>
        </table></div> : <p className="muted-copy">No per-item checks were returned.</p>}
        <div className="extra-check"><CheckCard title="Extra items" check={extraCheck} icon={TriangleAlert} /></div>
      </section>

      <section className="detail-section" aria-labelledby="decision-heading">
        <h3 id="decision-heading" className="detail-heading">E. Final Decision</h3>
        <div className={`decision-banner decision-${tone(decision)}`}>
          <DecisionIcon className="decision-icon" size={23} />
          <div className="decision-copy"><span className="micro-label">Pack decision</span><h2>{decisionTitle}</h2>
            {pending && <p className="pending-note"><Clock3 size={14} /> Analysis is pending. This pack requires review.</p>}
          </div>
          <div className="decision-tags"><StatusTag status={decision} /><StatusTag status={inspection.modelStatus} /></div>
        </div>
      </section>

      <section className="detail-section" aria-labelledby="evidence-heading">
        <h3 id="evidence-heading" className="detail-heading">F. Evidence / Reason</h3>
        <p className="inspection-reason">{inspection.reason || "No rationale was returned."}</p>
        {evidence.length ? <ul className="evidence-list">{evidence.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : <p className="muted-copy">No evidence details were returned.</p>}
      </section>

      {(uncertain.length > 0 || inspection.imageQuality === "POOR") && <section className="detail-section uncertainty-section" aria-labelledby="uncertainty-heading">
        <h3 id="uncertainty-heading" className="detail-heading">G. Uncertainty</h3>
        <p>Image quality: <StatusTag status={inspection.imageQuality} /></p>
        {uncertain.length ? <ul className="evidence-list">{uncertain.map((item, index) => <li key={`${index}-${item.reason}`}>
          {item.possibleSkus?.length ? `Possible SKU(s): ${item.possibleSkus.join(", ")}. ` : ""}{item.reason}
        </li>)}</ul> : <p className="muted-copy">The vision response did not include uncertain item details.</p>}
      </section>}

      <div className="finding-grid" aria-label="Packing exceptions">
        <FindingList title="Missing items" items={findings.missing} empty="No confirmed missing items." />
        <FindingList title="Wrong quantities" items={findings.wrong} empty="No confirmed quantity mismatch." />
        <FindingList title="Extra items" items={findings.extra} empty="No confirmed extra items." />
      </div>
    </section>
  );
}

function App() {
  const [orgId, setOrgId] = useState(ORGANIZATIONS[0]);
  const [orders, setOrders] = useState([]);
  const [unitId, setUnitId] = useState("");
  const [image, setImage] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [history, setHistory] = useState([]);
  const [inspection, setInspection] = useState(null);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [openingId, setOpeningId] = useState("");
  const [ordersError, setOrdersError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [formError, setFormError] = useState("");
  const [fileError, setFileError] = useState("");
  const [apiError, setApiError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const selectedOrder = orders.find((order) => order.unitId === unitId) || null;

  useEffect(() => {
    if (!image) { setPreviewUrl(""); return undefined; }
    const url = URL.createObjectURL(image);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  useEffect(() => {
    const controller = new AbortController();
    setOrdersLoading(true);
    setHistoryLoading(true);
    setOrdersError(""); setHistoryError(""); setApiError(""); setSavedMessage("");
    setOrders([]); setHistory([]); setInspection(null); setImage(null); setUnitId(""); setFormError("");
    requestJson("/api/orders", orgId, { signal: controller.signal })
      .then((rows) => setOrders(Array.isArray(rows) ? rows : []))
      .catch((error) => { if (error.name !== "AbortError") setOrdersError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setOrdersLoading(false); });
    requestJson("/api/inspections", orgId, { signal: controller.signal })
      .then((rows) => setHistory(Array.isArray(rows) ? rows : []))
      .catch((error) => { if (error.name !== "AbortError") setHistoryError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [orgId]);

  function handleImageChange(event) {
    const file = event.target.files?.[0] || null;
    setFileError(""); setFormError(""); setApiError(""); setSavedMessage("");
    if (!file) { setImage(null); return; }
    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
      setImage(null); setFileError("Choose a JPG, PNG, or WEBP image."); event.target.value = ""; return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImage(null); setFileError("Image exceeds the 8 MB upload limit."); event.target.value = ""; return;
    }
    setImage(file); setInspection(null);
  }

  async function reloadHistory() {
    setHistoryLoading(true); setHistoryError("");
    try {
      const rows = await requestJson("/api/inspections", orgId);
      setHistory(Array.isArray(rows) ? rows : []);
    } catch (error) { setHistoryError(error.message); }
    finally { setHistoryLoading(false); }
  }

  async function handleSubmit(event) {
    event.preventDefault(); setFormError(""); setApiError(""); setSavedMessage("");
    if (!selectedOrder) { setFormError("Select an order before submitting an inspection."); return; }
    if (!image) { setFormError("Choose an open-box photo before submitting."); return; }
    setSubmitting(true);
    try {
      const compressedImage = await compressImageForUpload(image);
      const formData = new FormData();
      formData.append("unitId", selectedOrder.unitId);
      formData.append("image", compressedImage.blob, compressedImage.filename);
      const result = await requestJson("/api/analyze", orgId, { method: "POST", body: formData });
      setInspection(result); setSavedMessage("Inspection saved to history.");
      try {
        const rows = await requestJson("/api/inspections", orgId);
        setHistory(Array.isArray(rows) ? rows : []);
      } catch (error) { setHistoryError(error.message); }
    } catch (error) { setApiError(error.message); }
    finally { setSubmitting(false); }
  }

  async function openInspection(id) {
    setOpeningId(id); setApiError(""); setSavedMessage("");
    try { setInspection(await requestJson(`/api/inspections/${encodeURIComponent(id)}`, orgId)); }
    catch (error) { setApiError(error.message); }
    finally { setOpeningId(""); }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><Box size={19} /></span><span><strong>Pack Manager</strong><small>Outbound inspection</small></span></div>
        <div className="tenant-control"><label htmlFor="organization">Organization</label><select id="organization" value={orgId} onChange={(event) => setOrgId(event.target.value)}>{ORGANIZATIONS.map((id) => <option key={id}>{id}</option>)}</select><span className="demo-label">Demo tenant</span></div>
      </header>

      <main className="workspace">
        <div className="page-heading"><div><div className="eyebrow"><span className="live-dot" /> PACK STATION <span>/</span> OUTBOUND</div><h1>Inspect a pack</h1></div><div className="connection-state"><span /> API workspace</div></div>
        <div className="workspace-grid">
          <section className="primary-column" aria-label="New inspection">
            <form className="work-panel" onSubmit={handleSubmit} noValidate>
              <div className="panel-heading"><span className="step-index">01</span><div><h2>Order and photo</h2><p>Select the outbound unit and attach its open-box image.</p></div></div>
              <div className="field-group">
                <label className="field-label" htmlFor="order-select">Order / unit</label>
                <div className="select-wrap"><select id="order-select" value={unitId} disabled={ordersLoading || !orders.length} onChange={(event) => { setUnitId(event.target.value); setInspection(null); setFormError(""); setApiError(""); }}>
                  <option value="">{ordersLoading ? "Loading orders…" : orders.length ? "Select a unit or order" : "No orders available"}</option>
                  {orders.map((order) => <option key={`${order.orgId}-${order.unitId}`} value={order.unitId}>{order.unitId} · {order.orderId} · {order.channel}</option>)}
                </select>{ordersLoading && <LoaderCircle className="select-spinner spin" size={16} />}</div>
                {ordersError && <InlineAlert>{ordersError}</InlineAlert>}
                {!ordersLoading && !ordersError && !orders.length && <InlineAlert kind="neutral">No orders were returned for this organization.</InlineAlert>}
              </div>

              {selectedOrder && <div className="order-lines">
                <div className="subsection-heading"><h3>Expected order lines</h3><span>{selectedOrder.expectedItems?.length || 0} lines</span></div>
                {selectedOrder.expectedItems?.length ? <div className="table-wrap"><table>
                  <thead><tr><th>SKU</th><th>Item name</th><th>Expected qty.</th></tr></thead>
                  <tbody>{selectedOrder.expectedItems.map((item) => <tr key={item.sku}><td><strong>{item.sku}</strong></td><td>{item.name || item.sku}</td><td><span className="quantity-number">{item.quantity}</span></td></tr>)}</tbody>
                </table></div> : <p className="muted-copy">This order has no expected item lines.</p>}
              </div>}

              <div className="field-group photo-field">
                <div className="subsection-heading"><label className="field-label" htmlFor="pack-photo">Open-box photo</label><span>JPG, PNG, WEBP · max 8 MB</span></div>
                <input className="visually-hidden" id="pack-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImageChange} />
                <label className={`upload-zone ${image ? "has-image" : ""}`} htmlFor="pack-photo">
                  {previewUrl ? <><img src={previewUrl} alt="Selected open-box preview" /><span className="upload-file-info"><FileImage size={17} /><span><strong>{image.name}</strong><small>{(image.size / 1024 / 1024).toFixed(2)} MB</small></span><b>Replace</b></span></> : <><span className="upload-icon"><ImagePlus size={21} /></span><strong>Choose a photo</strong><span className="upload-subcopy">Open box, contents visible</span><span className="upload-action"><Upload size={14} /> Browse files</span></>}
                </label>
                {fileError && <InlineAlert>{fileError}</InlineAlert>}
              </div>

              {formError && <InlineAlert>{formError}</InlineAlert>}
              {apiError && <InlineAlert>{apiError}</InlineAlert>}
              {savedMessage && <InlineAlert kind="success">{savedMessage}</InlineAlert>}
              <div className="form-footer"><span className="privacy-note"><ShieldAlert size={14} /> Image is stored with the inspection record.</span><button className="submit-button" type="submit" disabled={submitting}>{submitting ? <><LoaderCircle className="spin" size={16} /> Analyzing…</> : <><Camera size={16} /> Analyze pack</>}</button></div>
            </form>
            {inspection && <ResultPanel inspection={inspection} orgId={orgId} />}
          </section>

          <aside className="history-panel" aria-labelledby="history-title">
            <div className="history-heading"><div><span className="micro-label">Records</span><h2 id="history-title">Inspection history</h2></div><button className="icon-button" type="button" title="Reload history" aria-label="Reload history" onClick={reloadHistory}><RefreshCw size={15} /></button></div>
            <p className="history-caption">Latest saved inspections for {orgId}.</p>
            {historyError && <div className="history-error"><InlineAlert>{historyError}</InlineAlert></div>}
            {historyLoading ? <div className="history-loading"><LoaderCircle className="spin" size={17} /> Loading records</div> : history.length ? <div className="history-list">
              {history.map((record) => <button className={`history-item ${inspection?.id === record.id ? "active" : ""}`} type="button" key={record.id} onClick={() => openInspection(record.id)} disabled={openingId === record.id}>
                <span className={`history-dot tone-${tone(record.finalDecision)}`} /><span className="history-main"><strong>{record.unitId} <i>·</i> {record.orderId}</strong><small>{formatDate(record.createdAt)}</small></span>
                <span className="history-tags"><StatusTag status={record.finalDecision} />{record.modelStatus === "PENDING" && <StatusTag status="PENDING" />}</span>
                {openingId === record.id ? <LoaderCircle className="spin" size={15} /> : <ChevronRight size={15} />}
              </button>)}
            </div> : !historyError ? <div className="history-empty"><span><ClipboardList size={21} /></span><strong>No inspections yet</strong><p>Saved pack checks will appear here.</p></div> : null}
            <div className="history-footer"><span><Clock3 size={14} /> Most recent first</span><span>{history.length} records</span></div>
          </aside>
        </div>
        <footer className="workspace-footer"><span>Pack Manager <i>·</i> Operator station</span><span>DEMO TENANT SELECTOR</span></footer>
      </main>
    </div>
  );
}

export default App;