"use strict";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSha256(value) {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function projectStructuredOutputReview(value) {
  if (value === undefined) return { review: null, issue: null };
  if (!isRecord(value)
    || value.version !== 1
    || value.blocking !== false
    || !isSha256(value.contractHash)
    || !isSha256(value.candidateHash)
    || typeof value.feedbackDelivered !== "boolean"
    || (value.status !== "observations_remaining" && value.status !== "no_remaining_observations")
    || !Array.isArray(value.observations)) {
    return { review: null, issue: { reason: "invalid_receipt", droppedObservationCount: 0 } };
  }

  const observations = [];
  let droppedObservationCount = 0;
  for (const raw of value.observations) {
    if (!isRecord(raw)
      || raw.code !== "model_authored_consistency"
      || typeof raw.message !== "string"
      || !raw.message.trim()
      || ("observationKey" in raw
        && (typeof raw.observationKey !== "string" || !raw.observationKey.trim()))) {
      droppedObservationCount += 1;
      continue;
    }
    observations.push({
      code: "model_authored_consistency",
      message: raw.message,
      ...(typeof raw.observationKey === "string" ? { observationKey: raw.observationKey } : {}),
    });
  }

  // Status is a projection of the receipt's observation rows, not an
  // independent verdict. Count malformed rows as still unresolved so damaged
  // evidence cannot make an outstanding observation appear cleared.
  const projectedStatus = value.observations.length > 0
    ? "observations_remaining"
    : "no_remaining_observations";
  const statusMismatch = value.status !== projectedStatus;

  return {
    review: {
      version: 1,
      blocking: false,
      contractHash: value.contractHash,
      candidateHash: value.candidateHash,
      feedbackDelivered: value.feedbackDelivered,
      status: projectedStatus,
      observations,
    },
    issue: droppedObservationCount > 0
      ? { reason: "invalid_observation_rows", droppedObservationCount }
      : statusMismatch
        ? { reason: "invalid_receipt", droppedObservationCount: 0 }
        : null,
  };
}

function normalizeStructuredOutputReview(value) {
  return projectStructuredOutputReview(value).review;
}

function normalizeStructuredOutputReviewProjectionIssue(value) {
  if (!isRecord(value)
    || (value.reason !== "invalid_receipt" && value.reason !== "invalid_observation_rows")
    || typeof value.droppedObservationCount !== "number"
    || !Number.isInteger(value.droppedObservationCount)
    || value.droppedObservationCount < 0
    || (value.reason === "invalid_receipt" && value.droppedObservationCount !== 0)
    || (value.reason === "invalid_observation_rows" && value.droppedObservationCount === 0)) {
    return null;
  }
  return {
    reason: value.reason,
    droppedObservationCount: value.droppedObservationCount,
  };
}

exports.projectStructuredOutputReview = projectStructuredOutputReview;
exports.normalizeStructuredOutputReview = normalizeStructuredOutputReview;
exports.normalizeStructuredOutputReviewProjectionIssue = normalizeStructuredOutputReviewProjectionIssue;
