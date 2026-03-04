type SpanOptions = {
  name: string;
  op: string;
};

type MetricOptions = {
  attributes?: Record<string, string | number | boolean>;
};

// No-op telemetry shim while observability is disabled.
export function startSpan<T>(_options: SpanOptions, callback: () => Promise<T>): Promise<T>;
export function startSpan<T>(_options: SpanOptions, callback: () => T): T;
export function startSpan<T>(_options: SpanOptions, callback: () => T | Promise<T>): T | Promise<T> {
  return callback();
}

export function setUser(_user: { id?: string }): void {}

export const metrics = {
  count(_name: string, _value: number, _options?: MetricOptions): void {},
};
