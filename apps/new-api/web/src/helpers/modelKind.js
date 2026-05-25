/**
 * Detect display kind for a pricing model based on param_pricing structure.
 * @param {Object} model - Pricing model from /api/pricing
 * @returns {'image' | 'video' | 'chat'}
 */
export const getModelKind = (model) => {
  const pp = model?.param_pricing;
  if (!pp) return 'chat';
  if (pp.billing_mode === 'fixed_by_image_spec') return 'image';
  if (
    Array.isArray(pp.results) &&
    pp.results.length > 0 &&
    pp.results[0].duration_seconds > 0
  )
    return 'video';
  return 'chat';
};

/**
 * Build a ready-to-copy curl example for a pricing model.
 * @param {Object} model - Pricing model
 * @param {string} baseUrl - API base URL
 * @returns {string}
 */
export const buildCurlExample = (model, baseUrl) => {
  const kind = getModelKind(model);
  const name = model.model_name;
  const host = baseUrl || window.location.origin;

  if (kind === 'image') {
    return `curl -X POST ${host}/v1/images/generations \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${name}","prompt":"A beautiful landscape","n":1,"size":"1024x1024"}'`;
  }

  if (kind === 'video') {
    return `curl -X POST ${host}/v1/videos \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${name}","prompt":"A scenic video","duration":5}'`;
  }

  return `curl -X POST ${host}/v1/chat/completions \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${name}","messages":[{"role":"user","content":"Hello"}],"stream":false}'`;
};
