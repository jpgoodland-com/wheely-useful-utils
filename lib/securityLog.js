/**
 * Structured security events, one JSON object per line on stderr. CloudWatch
 * metric filters in terraform/monitoring.tf count them by `securityEvent`, so
 * keep the event names in sync. Never log credentials or identifiers typed by
 * the user; the client IP is kept with the 7-day log retention.
 */
export function logSecurityEvent(securityEvent, fields = {}) {
  console.warn(JSON.stringify({ securityEvent, ...fields, at: new Date().toISOString() }))
}
