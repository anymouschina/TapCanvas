import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Connection, WorkflowClient } from '@temporalio/client'

@Injectable()
export class TemporalService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TemporalService.name)
  private connection: Connection | null = null
  private client: WorkflowClient | null = null

  async onModuleInit() {
    try {
      this.connection = await Connection.connect()
      this.client = new WorkflowClient({ connection: this.connection })
      this.logger.log('Connected to Temporal server')
    } catch (error) {
      this.logger.error('Failed to connect to Temporal server', error as Error)
    }
  }

  async onModuleDestroy() {
    if (this.connection) {
      await this.connection.close()
      this.logger.log('Temporal connection closed')
    }
  }

  get workflowClient(): WorkflowClient {
    if (!this.client) {
      throw new Error('Temporal client not initialized')
    }
    return this.client
  }
}

