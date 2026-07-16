export interface DomainEvent<TPayload extends object = Record<string, unknown>> {
  readonly eventId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly occurredAt: string;
  readonly source: string;
  readonly correlationId?: string;
  readonly payload: TPayload;
}

export interface EventPublisher {
  publish(routingKey: string, event: DomainEvent): Promise<void>;
}

export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');
