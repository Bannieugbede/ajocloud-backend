import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect, type ChannelModel, type ConfirmChannel } from 'amqplib';
import type { Environment } from '../../config/env.schema.js';
import type { DomainEvent, EventPublisher } from './domain-event.js';

@Injectable()
export class RabbitMqService implements EventPublisher, OnModuleDestroy {
  private connection?: ChannelModel;
  private channel?: ConfirmChannel;
  private readonly url: string;
  private readonly exchange = 'ajocloud.events.v1';

  constructor(config: ConfigService<Environment, true>) {
    this.url = config.get('RABBITMQ_URL', { infer: true });
  }

  async ping(): Promise<boolean> {
    await this.ensureChannel();
    return true;
  }

  async publish(routingKey: string, event: DomainEvent): Promise<void> {
    const channel = await this.ensureChannel();
    channel.publish(this.exchange, routingKey, Buffer.from(JSON.stringify(event)), {
      persistent: true,
      contentType: 'application/json',
      messageId: event.eventId,
      correlationId: event.correlationId,
      timestamp: Date.parse(event.occurredAt),
      type: event.eventType,
    });
    await channel.waitForConfirms();
  }

  async onModuleDestroy(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
  }

  private async ensureChannel(): Promise<ConfirmChannel> {
    if (this.channel) return this.channel;
    this.connection = await connect(this.url);
    this.channel = await this.connection.createConfirmChannel();
    await this.channel.assertExchange(this.exchange, 'topic', { durable: true });
    return this.channel;
  }
}
