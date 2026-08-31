/**
 * Detect the display kind for a pricing model.
 *
 * `model_kind` is the backend's canonical classification. The pricing
 * metadata is retained as a structural fallback for older catalog entries;
 * fixed-spec pricing is shared by image and video models, so the result
 * spec key/duration must be inspected before falling back to chat.
 *
 * @param {Object} model - Pricing model from /api/pricing
 * @returns {'image' | 'video' | 'chat'}
 */
export const getModelKind = (model) => {
  const declaredKind =
    typeof model?.model_kind === 'string'
      ? model.model_kind.trim().toLowerCase()
      : '';

  if (declaredKind === 'image' || declaredKind === 'video') {
    return declaredKind;
  }
  if (declaredKind === 'chat' || declaredKind === 'text') {
    return 'chat';
  }

  const pp = model?.param_pricing;
  if (!pp) return 'chat';
  if (pp.billing_mode === 'fixed_by_image_spec') return 'image';

  const results = Array.isArray(pp.results) ? pp.results : [];
  const hasVideoSpec = results.some(
    (result) =>
      Number(result?.duration_seconds) > 0 ||
      (typeof result?.spec_key === 'string' &&
        result.spec_key.trim().toLowerCase().startsWith('video:')),
  );
  if (hasVideoSpec) return 'video';

  const hasImageSpec = results.some(
    (result) =>
      typeof result?.spec_key === 'string' &&
      result.spec_key.trim().toLowerCase().startsWith('image:'),
  );
  if (hasImageSpec) return 'image';

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
