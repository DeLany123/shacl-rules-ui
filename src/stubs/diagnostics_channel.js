// Browser no-op stub for node:diagnostics_channel (used by lru-cache and others)

const noopChannel = (name) => ({
  subscribe() {},
  unsubscribe() {},
  publish() { return false; },
  hasSubscribers: false,
  name,
  // Node 19.9+ TracingChannel methods
  bindStore() {},
  unbindStore() {},
  runStores() {},
});

export function channel(name) {
  return noopChannel(name);
}
export function subscribe() {}
export function unsubscribe() {}
export function hasSubscribers() { return false; }

// tracingChannel() returns a TracingChannel which is a group of 5 channels
export function tracingChannel(namePrefix) {
  return {
    start:     noopChannel(`tracing:${namePrefix}:start`),
    end:       noopChannel(`tracing:${namePrefix}:end`),
    asyncStart: noopChannel(`tracing:${namePrefix}:asyncStart`),
    asyncEnd:   noopChannel(`tracing:${namePrefix}:asyncEnd`),
    error:     noopChannel(`tracing:${namePrefix}:error`),
    subscribe() {},
    unsubscribe() {},
    hasSubscribers: false,
    traceSync() {},
    tracePromise() {},
    traceCallback() {},
  };
}

export default { channel, subscribe, unsubscribe, hasSubscribers, tracingChannel };
