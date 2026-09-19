export class CloudClient {
  constructor({ apiUrl, agentId, agentKey, timeoutMs = 5000 }) {
    this.apiUrl = String(apiUrl).replace(/\/$/, '');
    this.agentId = agentId;
    this.agentKey = agentKey;
    this.timeoutMs = Number(timeoutMs) || 5000;
  }

  headers(extra = {}) {
    return {
      'content-type': 'application/json',
      'x-agent-id': this.agentId,
      'x-agent-key': this.agentKey,
      ...extra
    };
  }

  async call(path, options = {}) {
    const response = await fetch(this.apiUrl + path, {
      ...options,
      headers: this.headers(options.headers),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
    if (!response.ok) {
      const error = new Error(body.error || `API respondeu ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return body;
  }

  sync() {
    return this.call('/api/access/agent/sync');
  }

  sendEvents(events) {
    return this.call('/api/access/agent/events', {
      method: 'POST',
      body: JSON.stringify({ events })
    });
  }
}
