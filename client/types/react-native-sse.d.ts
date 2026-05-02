/**
 * react-native-sse 类型定义
 * 文档参考：https://github.com/binaryminds/react-native-sse
 */

declare module 'react-native-sse' {
  export interface EventSourceOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeout?: number;
    timeoutBeforeConnection?: number;
    withCredentials?: boolean;
    debug?: boolean;
    pollingInterval?: number;
    lineEndingCharacter?: string;
  }

  export interface MessageEvent {
    type: string;
    data: string;
    lastEventId?: string;
  }

  export interface ErrorEvent {
    type: string;
    message?: string;
    data?: string;
  }

  export interface OpenEvent {
    type: string;
  }

  export interface CloseEvent {
    type: string;
  }

  export interface EventSource {
    addEventListener(
      type: 'message',
      handler: (event: MessageEvent) => void
    ): void;
    addEventListener(
      type: 'error',
      handler: (event: ErrorEvent) => void
    ): void;
    addEventListener(
      type: 'open',
      handler: (event: OpenEvent) => void
    ): void;
    addEventListener(
      type: 'close',
      handler: (event: CloseEvent) => void
    ): void;
    removeEventListener(type: string, handler: (...args: any[]) => void): void;
    close(): void;
    CONNECTING: number;
    OPEN: number;
    CLOSED: number;
    status: number;
  }

  interface EventSourceConstructor {
    new (url: string, options?: EventSourceOptions): EventSource;
  }

  const EventSource: EventSourceConstructor;
  export default EventSource;
}
