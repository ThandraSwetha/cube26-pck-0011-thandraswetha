function parseJson(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function mapInspection(row) {
  return {
    id: row.id,
    orgId: row.org_id,
    unitId: row.unit_id,
    orderId: row.order_id,
    createdAt: row.created_at,
    modelStatus: row.model_status,
    modelProvider: row.model_provider,
    imageQuality: row.image_quality,
    uncertainItems: parseJson(row.uncertain_items),
    expectedItems: parseJson(row.expected_items),
    detectedItems: parseJson(row.detected_items),
    checks: parseJson(row.checks),
    finalDecision: row.final_decision,
    reason: row.reason,
    evidence: parseJson(row.evidence),
  };
}

async function saveInspection(storage, inspection, capture) {
  await storage.withTenant(inspection.orgId, async ({ query }) => {
    await query(
      `INSERT INTO inspections (
        id, org_id, unit_id, order_id, created_at, model_status, model_provider,
        image_quality, uncertain_items, expected_items, detected_items, checks,
        final_decision, reason, evidence
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13, $14, $15::jsonb)` ,
      [
        inspection.id, inspection.orgId, inspection.unitId, inspection.orderId, inspection.createdAt,
        inspection.modelStatus, inspection.modelProvider, inspection.imageQuality,
        JSON.stringify(inspection.uncertainItems), JSON.stringify(inspection.expectedItems),
        JSON.stringify(inspection.detectedItems), JSON.stringify(inspection.checks), inspection.finalDecision,
        inspection.reason, JSON.stringify(inspection.evidence),
      ],
    );
    await query(
      `INSERT INTO captures (
        id, org_id, inspection_id, content_sha256, original_name, mime_type, image_base64, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [capture.id, inspection.orgId, inspection.id, capture.sha256, capture.name, capture.mimeType, capture.base64, inspection.createdAt],
    );
  });
}

async function listInspections(storage, orgId) {
  return storage.withTenant(orgId, async ({ query }) => {
    const result = await query("SELECT * FROM inspections ORDER BY created_at DESC LIMIT 100");
    return result.rows.map(mapInspection);
  });
}

async function getInspection(storage, orgId, inspectionId) {
  return storage.withTenant(orgId, async ({ query }) => {
    const result = await query("SELECT * FROM inspections WHERE id = $1", [inspectionId]);
    return result.rows[0] ? mapInspection(result.rows[0]) : null;
  });
}

async function getCapture(storage, orgId, inspectionId) {
  return storage.withTenant(orgId, async ({ query }) => {
    const result = await query(
      "SELECT original_name, mime_type, image_base64 FROM captures WHERE inspection_id = $1",
      [inspectionId],
    );
    return result.rows[0] ?? null;
  });
}

export { getCapture, getInspection, listInspections, saveInspection };