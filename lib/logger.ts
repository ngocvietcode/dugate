// lib/logger.ts
// Enterprise structured logger for high-audit banking environments.
// Outputs JSON logs or formatted text depending on environment.

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogContext {
  correlationId?: string;
  operationId?: string;
  apiKeyId?: string;
  service?: string;
  [key: string]: unknown;
}

export class Logger {
  private baseContext: LogContext;
  private minLevel: LogLevel;
  private isJson: boolean;

  private static levels: Record<LogLevel, number> = {
    DEBUG: 10,
    INFO: 20,
    WARN: 30,
    ERROR: 40,
  };

  /**
   * Initializes a logger with a given base context.
   */
  constructor(context: LogContext = {}) {
    this.baseContext = context;
    
    // Set min level from env, default to INFO
    const envLevel = (process.env.LOG_LEVEL || 'INFO').toUpperCase() as LogLevel;
    this.minLevel = Logger.levels[envLevel] !== undefined ? envLevel : 'INFO';
    
    // Default to JSON logging in production environments (or if explicitly set)
    this.isJson = process.env.NODE_ENV === 'production' || process.env.LOG_FORMAT === 'json';
  }

  /**
   * Creates a child logger inheriting current context.
   */
  public child(extraContext: LogContext): Logger {
    return new Logger({ ...this.baseContext, ...extraContext });
  }

  private shouldLog(level: LogLevel): boolean {
    return Logger.levels[level] >= Logger.levels[this.minLevel];
  }

  private write(level: LogLevel, message: string, meta?: Record<string, unknown>, error?: unknown) {
    if (!this.shouldLog(level)) return;

    const timestamp = new Date().toISOString();
    const payload: Record<string, unknown> = {
      timestamp,
      level,
      message,
      ...this.baseContext,
      ...meta,
    };

    if (error) {
      if (error instanceof Error) {
        payload.error = {
          message: error.message,
          name: error.name,
          stack: error.stack,
        };
      } else {
        payload.error = String(error);
      }
    }

    if (this.isJson) {
      const output = JSON.stringify(payload);
      if (level === 'ERROR' || level === 'WARN') {
        console.error(output);
      } else {
        console.log(output);
      }
    } else {
      // Formatted text output for local development
      const corr = this.baseContext.correlationId ? `[${this.baseContext.correlationId}] ` : '';
      const prefix = `${timestamp} [${level}] ${corr}`;
      
      const extraCtx = { ...this.baseContext };
      delete extraCtx.correlationId;
      
      const metaStr = Object.keys(extraCtx).length > 0 || meta ? ` | Meta: ${JSON.stringify({ ...extraCtx, ...meta })}` : '';
      const errStr = error ? `\n    Error: ${error instanceof Error ? error.stack : String(error)}` : '';
      
      const output = `${prefix}${message}${metaStr}${errStr}`;
      
      if (level === 'ERROR' || level === 'WARN') {
        console.error(output);
      } else {
        console.log(output);
      }
    }
  }

  public debug(message: string, meta?: Record<string, unknown>) {
    this.write('DEBUG', message, meta);
  }

  public info(message: string, meta?: Record<string, unknown>) {
    this.write('INFO', message, meta);
  }

  public warn(message: string, meta?: Record<string, unknown>, error?: unknown) {
    this.write('WARN', message, meta, error);
  }

  public error(message: string, meta?: Record<string, unknown>, error?: unknown) {
    this.write('ERROR', message, meta, error);
  }
}
