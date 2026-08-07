# EF-58 Message Queue Implementation Plan

**Status**: Draft  
**Author**: EmotionFlow Software Architect  
**Created**: 2025-01-XX  
**Depends On**: EF-61 ADR (Conversation State Architecture)  
**Blocks**: EF-59 Session Persistence  

---

## 1. Current Implementation Gap

### 1.1 Current Message Sending Flow

```
User Input
    ↓
MultimodalInput.handleSend()
    ↓
ChatContext.sendMessage()
    ↓
withSendGuard() ──[sendingRef.current === true]──→ Queue Message (EM-53)
    ↓
sendMessageCore()
    ↓
chatStart() API ──→ SSE Stream ──→ Message Update
```

### 1.2 Current State Management

**ChatContext State:**
```typescript
// Core message state
messages: ChatMessage[]           // Current conversation messages
isLoading: boolean                // AI is generating response
isThinking: boolean               // AI is thinking (before generation)
chatPhase: ChatPhase              // Current phase (idle, thinking, generating, etc.)

// EM-53: Message queue (frontend only)
messageQueue: QueuedMessage[]     // Messages waiting to be sent
messageQueueRef: QueuedMessage[]  // Ref for async access

// Guard state
sendingRef: MutableRefObject<boolean>  // Prevents concurrent sends
```

**Backend State:**
```typescript
// In-memory session (server/src/index.ts)
interface Session {
  sessionId: string;
  userId: string;
  roleId: string;
  messages: { role: string; content: string }[];
  deepChunks: string[];
  deepDone: boolean;
  deepStreaming: boolean;
  // ... other fields
}

const sessions = new Map<string, Session>();  // In-memory only
```

### 1.3 Current Handling of Additional Messages During Generation

**Current Behavior (EM-53 Implementation):**

1. User sends message while `sendingRef.current === true`
2. Message is added to `messageQueue` (frontend only)
3. `sendMessage()` returns `false` (indicates message was queued, not sent)
4. Input box is cleared if message was queued
5. After current generation completes, `processNextInQueue()` is called
6. Queued message is sent automatically

**Gaps Identified:**

| Gap | Description | Impact |
|-----|-------------|--------|
| **No Backend Queue** | Queue exists only in frontend memory | Queue lost on refresh |
| **No Message Persistence** | Queued messages not saved | Messages lost on refresh |
| **No Queue Status Events** | Backend unaware of queue state | Cannot sync queue across devices |
| **No Retry on Failure** | If queued message fails, it's lost | Poor reliability |
| **No Queue Limit** | Unlimited queue growth | Potential memory issues |
| **No Reordering Protection** | Messages processed in order, but no guarantee | Race conditions possible |

### 1.4 Current SSE Event Handling

**Events Currently Handled:**
```typescript
// chatStart response (HTTP)
{
  sessionId: string;
  userTurn: number;
  reactionLayer?: string;
  companionLayer?: string;
  reactionTimeline: TimelineEvent[];
  companionTimeline: TimelineEvent[];
  // ...
}

// SSE events (chat/stream)
{ type: 'timeline', ... }      // Timeline metadata
{ type: 'companion', ... }     // Companion layer content
{ type: 'deep', ... }          // Deep layer content
```

**Missing Events (per EF-61 ADR):**
- `message.created` - Message persisted
- `message.queued` - Message queued for processing
- `generation.started` - Generation began
- `generation.progress` - Generation progress update
- `generation.completed` - Generation finished
- `generation.failed` - Generation failed
- `conversation.state_changed` - State transition
- `queue.position_updated` - Queue position changed

---

## 2. EF-58 Technical Design

### 2.1 Frontend Design

#### 2.1.1 Enhanced Message Queue State

```typescript
// New types
interface QueuedMessage {
  id: string;                    // Unique message ID
  text: string;                  // Message content
  options?: {
    audioUri?: string;
    emotion?: string;
  };
  timestamp: number;             // When message was created
  status: 'queued' | 'sending' | 'sent' | 'failed';
  retryCount: number;            // Number of retry attempts
  errorMessage?: string;         // Error message if failed
  conversationId: string;        // Target conversation
  sessionId?: string;            // Assigned when sending starts
}

interface MessageQueueState {
  messages: QueuedMessage[];     // Queue of pending messages
  currentProcessing?: string;    // ID of message currently being processed
  lastProcessedAt?: number;      // Timestamp of last processed message
}
```

**State Changes:**
```typescript
// ChatContext additions
const [messageQueueState, setMessageQueueState] = useState<MessageQueueState>({
  messages: [],
  currentProcessing: undefined,
  lastProcessedAt: undefined,
});

// Refs for async access
const messageQueueStateRef = useRef<MessageQueueState>({
  messages: [],
  currentProcessing: undefined,
  lastProcessedAt: undefined,
});

// Persistence key
const STORAGE_KEY_MESSAGE_QUEUE = '@emotionflow:message_queue';
```

#### 2.1.2 Queue Management Functions

```typescript
// Add message to queue
const enqueueMessage = (message: Omit<QueuedMessage, 'id' | 'timestamp' | 'status' | 'retryCount'>): QueuedMessage => {
  const queuedMsg: QueuedMessage = {
    ...message,
    id: generateMessageId(),
    timestamp: Date.now(),
    status: 'queued',
    retryCount: 0,
  };
  
  messageQueueStateRef.current = {
    ...messageQueueStateRef.current,
    messages: [...messageQueueStateRef.current.messages, queuedMsg],
  };
  setMessageQueueState(messageQueueStateRef.current);
  
  // Persist to AsyncStorage
  persistMessageQueue();
  
  return queuedMsg;
};

// Remove message from queue
const dequeueMessage = (messageId: string): void => {
  messageQueueStateRef.current = {
    ...messageQueueStateRef.current,
    messages: messageQueueStateRef.current.messages.filter(m => m.id !== messageId),
    currentProcessing: messageQueueStateRef.current.currentProcessing === messageId 
      ? undefined 
      : messageQueueStateRef.current.currentProcessing,
  };
  setMessageQueueState(messageQueueStateRef.current);
  persistMessageQueue();
};

// Update message status
const updateMessageStatus = (messageId: string, status: QueuedMessage['status'], errorMessage?: string): void => {
  messageQueueStateRef.current = {
    ...messageQueueStateRef.current,
    messages: messageQueueStateRef.current.messages.map(m => 
      m.id === messageId 
        ? { ...m, status, errorMessage, retryCount: status === 'failed' ? m.retryCount + 1 : m.retryCount }
        : m
    ),
  };
  setMessageQueueState(messageQueueStateRef.current);
  persistMessageQueue();
};

// Process next message in queue
const processNextInQueue = async (): Promise<void> => {
  if (messageQueueStateRef.current.messages.length === 0 || sendingRef.current) {
    return;
  }
  
  const nextMessage = messageQueueStateRef.current.messages.find(m => m.status === 'queued');
  if (!nextMessage) return;
  
  // Mark as sending
  updateMessageStatus(nextMessage.id, 'sending');
  messageQueueStateRef.current = {
    ...messageQueueStateRef.current,
    currentProcessing: nextMessage.id,
  };
  setMessageQueueState(messageQueueStateRef.current);
  
  try {
    // Send message
    await sendMessageCore(nextMessage.text, {
      requestId: generateRequestId(),
      conversationId: nextMessage.conversationId,
      sessionId: nextMessage.sessionId || generateSessionId(),
      roleId: currentRole.id,
      message: nextMessage.text,
    }, false);
    
    // Mark as sent and remove from queue
    updateMessageStatus(nextMessage.id, 'sent');
    dequeueMessage(nextMessage.id);
    
    messageQueueStateRef.current = {
      ...messageQueueStateRef.current,
      lastProcessedAt: Date.now(),
      currentProcessing: undefined,
    };
    setMessageQueueState(messageQueueStateRef.current);
    
  } catch (error) {
    // Mark as failed
    updateMessageStatus(nextMessage.id, 'failed', error instanceof Error ? error.message : 'Unknown error');
    
    // Retry logic
    if (nextMessage.retryCount < MAX_RETRY_COUNT) {
      console.log(`[Queue] Message ${nextMessage.id} failed, will retry (attempt ${nextMessage.retryCount + 1})`);
      // Reset status to queued for retry
      updateMessageStatus(nextMessage.id, 'queued');
      
      // Schedule retry
      setTimeout(() => processNextInQueue(), RETRY_DELAY_MS);
    } else {
      console.error(`[Queue] Message ${nextMessage.id} failed after ${MAX_RETRY_COUNT} attempts`);
    }
  }
};
```

#### 2.1.3 Send Behavior Changes

**Current `sendMessage` Flow:**
```typescript
const sendMessage = async (userMessage: string, options?: {...}): Promise<boolean> => {
  if (!userMessage.trim() || !currentRole) return false;
  
  // EM-53: If sending, queue message
  if (sendingRef.current) {
    enqueueMessage({
      text: userMessage,
      options,
      conversationId: conversationIdRef.current || conversationId,
    });
    return false;
  }
  
  // Send immediately
  // ...
};
```

**Enhanced `sendMessage` Flow:**
```typescript
const sendMessage = async (userMessage: string, options?: {...}): Promise<boolean> => {
  if (!userMessage.trim() || !currentRole) return false;
  
  // Check if we should queue
  const shouldQueue = sendingRef.current || 
                      messageQueueStateRef.current.messages.length > 0 ||
                      chatPhase !== 'idle';
  
  if (shouldQueue) {
    const queuedMsg = enqueueMessage({
      text: userMessage,
      options,
      conversationId: conversationIdRef.current || conversationId,
    });
    
    // Clear input if content matches
    if (inputText.trim() === userMessage) {
      setInputText('');
    }
    
    // Return true to indicate message was accepted (queued)
    return true;
  }
  
  // Send immediately
  // ...
};
```

#### 2.1.4 Queued Message UI State

**New Component: `QueuedMessageIndicator`**
```typescript
interface QueuedMessageIndicatorProps {
  queue: QueuedMessage[];
  currentProcessing?: string;
  onRetry?: (messageId: string) => void;
  onCancel?: (messageId: string) => void;
}

// Shows:
// - Number of messages in queue
// - Current processing message
// - Failed messages with retry button
// - Cancel button for each queued message
```

**UI States:**
```
┌─────────────────────────────────────────┐
│ [Queue: 2 messages]                     │
│                                         │
│ ● Processing: "How are you?"            │
│ ○ Queued: "Tell me more"                │
│ ✗ Failed: "What happened?" [Retry]      │
└─────────────────────────────────────────┘
```

### 2.2 Backend Design

#### 2.2.1 Queue Processing Strategy

**Current Backend State:**
```typescript
// In-memory session
const sessions = new Map<string, Session>();

interface Session {
  sessionId: string;
  userId: string;
  roleId: string;
  messages: { role: string; content: string }[];
  // ... other fields
}
```

**Enhanced Backend State:**
```typescript
interface Session {
  sessionId: string;
  userId: string;
  roleId: string;
  conversationId: string;        // Link to conversation
  
  // Message queue
  messageQueue: BackendQueuedMessage[];
  currentProcessing?: string;
  
  // Conversation state
  state: ConversationState;
  
  // Existing fields
  messages: { role: string; content: string }[];
  deepChunks: string[];
  deepDone: boolean;
  // ...
}

interface BackendQueuedMessage {
  id: string;
  content: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  createdAt: number;
  processedAt?: number;
  requestId: string;             // For idempotency
  retryCount: number;
}

type ConversationState = 
  | 'idle'
  | 'sending'
  | 'generating_reaction'
  | 'generating_companion'
  | 'generating_deep'
  | 'completed'
  | 'failed';
```

#### 2.2.2 API Changes

**New Endpoint: POST /api/v1/chat/queue**

```typescript
// Request
interface QueueMessageRequest {
  conversationId: string;
  content: string;
  roleId: string;
  requestId: string;             // For idempotency
  options?: {
    audioUri?: string;
    emotion?: string;
  };
}

// Response
interface QueueMessageResponse {
  messageId: string;
  status: 'queued' | 'processing';
  position: number;              // Position in queue
  estimatedWaitTime?: number;    // Estimated wait time in ms
}
```

**New Endpoint: GET /api/v1/chat/queue/:conversationId**

```typescript
// Response
interface GetQueueResponse {
  conversationId: string;
  queue: BackendQueuedMessage[];
  currentProcessing?: string;
  state: ConversationState;
}
```

**New Endpoint: DELETE /api/v1/chat/queue/:conversationId/:messageId**

```typescript
// Cancel a queued message
// Response: 204 No Content
```

**Enhanced chat/start:**
```typescript
// Add queue status to response
interface ChatStartResponse {
  sessionId: string;
  // ... existing fields
  
  // New fields
  queueStatus?: {
    position: number;
    totalQueued: number;
  };
}
```

#### 2.2.3 Request Idempotency

**Problem:** Network issues may cause duplicate requests.

**Solution:** Use `requestId` for idempotency.

```typescript
// Backend
const processedRequests = new Map<string, { response: any; timestamp: number }>();

app.post('/api/v1/chat/start', async (req, res) => {
  const { requestId } = req.body;
  
  // Check if already processed
  const existing = processedRequests.get(requestId);
  if (existing) {
    console.log(`[Idempotency] Request ${requestId} already processed, returning cached response`);
    return res.json(existing.response);
  }
  
  // Process request
  // ...
  
  // Cache response
  processedRequests.set(requestId, { response, timestamp: Date.now() });
  
  // Clean up old entries (older than 5 minutes)
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  for (const [key, value] of processedRequests.entries()) {
    if (value.timestamp < fiveMinutesAgo) {
      processedRequests.delete(key);
    }
  }
});
```

### 2.3 Data Design

#### 2.3.1 Temporary Runtime State

**Frontend (AsyncStorage):**
```typescript
// Storage keys
const STORAGE_KEYS = {
  MESSAGE_QUEUE: '@emotionflow:message_queue',
  CURRENT_CONVERSATION_ID: '@emotionflow:current_conversation_id',
  CURRENT_SESSION_ID: '@emotionflow:current_session_id',
  CURRENT_ROLE_ID: '@emotionflow:current_role_id',
};

// Message queue structure
interface PersistedMessageQueue {
  version: number;
  conversationId: string;
  messages: QueuedMessage[];
  lastUpdatedAt: number;
}
```

**Backend (In-Memory):**
```typescript
// Session state (already exists, enhanced)
const sessions = new Map<string, Session>();

// Request idempotency cache
const processedRequests = new Map<string, { response: any; timestamp: number }>();

// Queue processing lock
const processingLocks = new Map<string, boolean>();  // conversationId -> isProcessing
```

#### 2.3.2 Persistence Boundary

| Data | Frontend | Backend | Database |
|------|----------|---------|----------|
| Queued messages (pending) | AsyncStorage | In-memory | - |
| Queued messages (processing) | AsyncStorage | In-memory | - |
| Sent messages | AsyncStorage | In-memory | Future: DB |
| Conversation state | AsyncStorage | In-memory | Future: DB |
| Request idempotency cache | - | In-memory (5min TTL) | - |

**Key Decision:** Queue state is persisted on frontend only. Backend queue is transient and rebuilt from frontend requests.

**Rationale:**
1. Backend sessions are already in-memory and lost on restart
2. Frontend is the source of truth for user intent
3. Database persistence is deferred to EF-59

---

## 3. Implementation Files Impact

### 3.1 Frontend Files

| File | Changes | Description |
|------|---------|-------------|
| `client/screens/chat/contexts/ChatContext.tsx` | **Major** | Enhanced queue state, queue management functions, send behavior changes |
| `client/screens/chat/components/QueuedMessageIndicator.tsx` | **New** | UI component for queue status |
| `client/screens/chat/components/MultimodalInput.tsx` | **Minor** | Integration with queue indicator |
| `client/screens/chat/components/MessageBubble.tsx` | **Minor** | Show queued message status |
| `client/screens/chat/stores/sessionStore.ts` | **Minor** | Add queue persistence functions |
| `client/screens/chat/types/index.ts` | **Minor** | Add queue-related types |
| `client/screens/chat/__tests__/ef58-message-queue.test.tsx` | **New** | Unit tests for queue logic |
| `client/screens/chat/__tests__/ef58-queue-integration.test.tsx` | **New** | Integration tests |

### 3.2 Backend Files

| File | Changes | Description |
|------|---------|-------------|
| `server/src/index.ts` | **Major** | New queue endpoints, enhanced session state, idempotency |
| `server/src/types.ts` | **New** | Queue-related types |
| `server/src/utils/idempotency.ts` | **New** | Request idempotency utility |
| `server/src/__tests__/ef58-queue.test.ts` | **New** | Backend queue tests |

### 3.3 Tests

| Test File | Scenarios |
|-----------|-----------|
| `ef58-message-queue.test.tsx` | Queue state management, enqueue/dequeue, status updates |
| `ef58-queue-integration.test.tsx` | Send during generation, rapid sends, queue processing |
| `ef58-queue-persistence.test.tsx` | Queue persistence to AsyncStorage, recovery after refresh |
| `ef58-idempotency.test.ts` | Duplicate request handling, cache cleanup |

---

## 4. Risk Analysis

### 4.1 Duplicate Message

**Risk:** User sends same message multiple times due to network issues or UI bugs.

**Mitigation:**
1. **Frontend:** Generate unique `messageId` for each message
2. **Backend:** Use `requestId` for idempotency (5-minute cache)
3. **Deduplication:** Check for duplicate content within 2-second window

```typescript
// Frontend deduplication
const isDuplicate = (content: string, timestamp: number): boolean => {
  const recentMessages = messages.filter(m => 
    m.timestamp > timestamp - 2000 && m.content === content
  );
  return recentMessages.length > 0;
};
```

### 4.2 Race Condition

**Risk:** Multiple messages processed simultaneously, causing state corruption.

**Mitigation:**
1. **Frontend:** Use `sendingRef` to prevent concurrent sends
2. **Backend:** Use `processingLocks` per conversation
3. **Atomic Updates:** Use functional state updates

```typescript
// Backend lock
const processingLocks = new Map<string, boolean>();

const processWithLock = async (conversationId: string, fn: () => Promise<void>) => {
  if (processingLocks.get(conversationId)) {
    throw new Error('Conversation is already being processed');
  }
  
  processingLocks.set(conversationId, true);
  try {
    await fn();
  } finally {
    processingLocks.set(conversationId, false);
  }
};
```

### 4.3 SSE Reconnect

**Risk:** SSE connection drops during generation, causing message loss.

**Mitigation:**
1. **Frontend:** Detect SSE disconnection and attempt reconnect
2. **Backend:** Maintain session state for reconnection
3. **Message Recovery:** On reconnect, fetch current state from backend

```typescript
// Frontend SSE reconnection
const handleSSEError = async (sessionId: string) => {
  console.log('[SSE] Connection lost, attempting reconnect');
  
  // Wait before reconnect
  await delay(1000);
  
  // Fetch current state
  const state = await fetchConversationState(sessionId);
  
  // Restore state
  restoreConversationState(state);
};
```

### 4.4 Context Ordering

**Risk:** Messages processed out of order, causing conversation context issues.

**Mitigation:**
1. **FIFO Queue:** Strict first-in-first-out processing
2. **Sequence Numbers:** Assign sequence number to each message
3. **Backend Validation:** Verify message order before processing

```typescript
interface QueuedMessage {
  // ... existing fields
  sequenceNumber: number;  // Monotonically increasing
}

// Backend validation
const validateMessageOrder = (session: Session, message: QueuedMessage): boolean => {
  const lastProcessed = session.messages[session.messages.length - 1];
  if (!lastProcessed) return true;
  
  return message.sequenceNumber > lastProcessed.sequenceNumber;
};
```

### 4.5 Queue Overflow

**Risk:** Unlimited queue growth causes memory issues.

**Mitigation:**
1. **Queue Limit:** Maximum 10 messages in queue
2. **User Notification:** Warn user when queue is full
3. **Auto-Reject:** Reject new messages when queue is full

```typescript
const MAX_QUEUE_SIZE = 10;

const enqueueMessage = (message: QueuedMessage): boolean => {
  if (messageQueueStateRef.current.messages.length >= MAX_QUEUE_SIZE) {
    console.warn('[Queue] Queue is full, rejecting message');
    return false;
  }
  // ... enqueue logic
  return true;
};
```

---

## 5. Test Strategy

### 5.1 Scenario 1: AI Generating + User Sends Message

**Objective:** Verify message is queued and processed after generation completes.

**Steps:**
1. Send initial message, wait for AI to start generating
2. Send second message while AI is generating
3. Verify second message is added to queue
4. Wait for first generation to complete
5. Verify second message is automatically processed
6. Verify both messages appear in conversation

**Expected:**
- Second message shows "Queued" status
- After first generation completes, second message is sent
- Both messages appear in correct order
- Input box is cleared after message is queued

**Test Code:**
```typescript
test('Scenario 1: Queue message during generation', async () => {
  const { result } = renderHook(() => useChat(), { wrapper });
  
  // Send first message
  await act(async () => {
    await result.current.sendMessage('First message');
  });
  
  // Wait for generation to start
  await waitFor(() => {
    expect(result.current.isLoading).toBe(true);
  });
  
  // Send second message during generation
  let queueResult: boolean;
  await act(async () => {
    queueResult = await result.current.sendMessage('Second message');
  });
  
  // Verify message was queued
  expect(queueResult).toBe(true);
  expect(result.current.messageQueueState.messages).toHaveLength(1);
  expect(result.current.messageQueueState.messages[0].text).toBe('Second message');
  
  // Wait for first generation to complete
  await waitFor(() => {
    expect(result.current.isLoading).toBe(false);
  }, { timeout: 10000 });
  
  // Wait for queue to be processed
  await waitFor(() => {
    expect(result.current.messageQueueState.messages).toHaveLength(0);
  }, { timeout: 5000 });
  
  // Verify both messages in conversation
  const userMessages = result.current.messages.filter(m => m.role === 'user');
  expect(userMessages).toHaveLength(2);
  expect(userMessages[0].content).toBe('First message');
  expect(userMessages[1].content).toBe('Second message');
});
```

### 5.2 Scenario 2: Rapid Multiple Sends

**Objective:** Verify queue handles rapid sends correctly.

**Steps:**
1. Send 5 messages in rapid succession (within 100ms)
2. Verify all messages are queued
3. Verify messages are processed in order
4. Verify no messages are lost or duplicated

**Expected:**
- All 5 messages appear in queue
- Messages are processed in FIFO order
- No duplicate messages in conversation
- No messages lost

**Test Code:**
```typescript
test('Scenario 2: Rapid multiple sends', async () => {
  const { result } = renderHook(() => useChat(), { wrapper });
  
  // Send first message to start generation
  await act(async () => {
    await result.current.sendMessage('First message');
  });
  
  // Rapidly send 4 more messages
  const messages = ['Second', 'Third', 'Fourth', 'Fifth'];
  await act(async () => {
    for (const msg of messages) {
      await result.current.sendMessage(msg);
    }
  });
  
  // Verify all messages queued
  expect(result.current.messageQueueState.messages).toHaveLength(4);
  
  // Wait for all to be processed
  await waitFor(() => {
    expect(result.current.messageQueueState.messages).toHaveLength(0);
  }, { timeout: 30000 });
  
  // Verify all messages in conversation in order
  const userMessages = result.current.messages.filter(m => m.role === 'user');
  expect(userMessages).toHaveLength(5);
  expect(userMessages.map(m => m.content)).toEqual([
    'First message', 'Second', 'Third', 'Fourth', 'Fifth'
  ]);
});
```

### 5.3 Scenario 3: Network Interruption

**Objective:** Verify queue survives network interruption and recovers.

**Steps:**
1. Send message, wait for generation to start
2. Simulate network interruption
3. Send another message (should be queued)
4. Restore network
5. Verify queued message is processed
6. Verify no messages lost

**Expected:**
- Queued message persists during network interruption
- After network restore, message is processed
- No messages lost

**Test Code:**
```typescript
test('Scenario 3: Network interruption recovery', async () => {
  const { result } = renderHook(() => useChat(), { wrapper });
  
  // Send first message
  await act(async () => {
    await result.current.sendMessage('First message');
  });
  
  // Simulate network interruption
  mockNetworkError = true;
  
  // Send second message (will fail)
  await act(async () => {
    await result.current.sendMessage('Second message');
  });
  
  // Verify message is queued with failed status
  expect(result.current.messageQueueState.messages).toHaveLength(1);
  expect(result.current.messageQueueState.messages[0].status).toBe('failed');
  
  // Restore network
  mockNetworkError = false;
  
  // Trigger retry
  await act(async () => {
    await result.current.retryQueuedMessage(result.current.messageQueueState.messages[0].id);
  });
  
  // Verify message is processed
  await waitFor(() => {
    expect(result.current.messageQueueState.messages).toHaveLength(0);
  }, { timeout: 10000 });
  
  // Verify both messages in conversation
  const userMessages = result.current.messages.filter(m => m.role === 'user');
  expect(userMessages).toHaveLength(2);
});
```

### 5.4 Scenario 4: Refresh During Generation

**Objective:** Verify queue persists after page refresh.

**Steps:**
1. Send message, wait for generation to start
2. Send another message (queued)
3. Simulate page refresh (unmount and remount provider)
4. Verify queued message is restored from AsyncStorage
5. Verify queued message is processed

**Expected:**
- Queued message persists in AsyncStorage
- After refresh, message is restored
- Message is processed after generation completes

**Test Code:**
```typescript
test('Scenario 4: Queue persists after refresh', async () => {
  // First render
  const { result: result1, unmount } = renderHook(() => useChat(), { wrapper });
  
  // Send first message
  await act(async () => {
    await result1.current.sendMessage('First message');
  });
  
  // Send second message (queued)
  await act(async () => {
    await result1.current.sendMessage('Second message');
  });
  
  // Verify message is queued
  expect(result1.current.messageQueueState.messages).toHaveLength(1);
  
  // Simulate refresh
  unmount();
  
  // Second render (simulates refresh)
  const { result: result2 } = renderHook(() => useChat(), { wrapper });
  
  // Verify queue is restored
  await waitFor(() => {
    expect(result2.current.messageQueueState.messages).toHaveLength(1);
    expect(result2.current.messageQueueState.messages[0].text).toBe('Second message');
  });
});
```

---

## 6. Implementation Phases

### Phase 1: Frontend Queue Enhancement (2 days)

1. Enhance `QueuedMessage` type with status and retry fields
2. Implement `MessageQueueState` management
3. Add queue persistence to AsyncStorage
4. Implement retry logic with exponential backoff
5. Add queue limit (10 messages)

### Phase 2: Queue UI (1 day)

1. Create `QueuedMessageIndicator` component
2. Integrate with `MultimodalInput`
3. Add retry/cancel actions
4. Add queue status to `MessageBubble`

### Phase 3: Backend Queue API (2 days)

1. Add queue endpoints (`POST /chat/queue`, `GET /chat/queue/:id`, `DELETE /chat/queue/:id/:msgId`)
2. Implement request idempotency
3. Add queue processing lock
4. Enhance session state with queue

### Phase 4: Integration & Testing (2 days)

1. Frontend-backend integration
2. End-to-end testing
3. Performance testing (rapid sends)
4. Network interruption testing

### Phase 5: Documentation & Review (1 day)

1. Update API documentation
2. Create user guide for queue feature
3. Code review
4. Performance review

---

## 7. Success Criteria

| Criteria | Measurement |
|----------|-------------|
| No message loss during generation | 100% of queued messages are processed |
| Queue persistence across refresh | Queue restored from AsyncStorage |
| No duplicate messages | Idempotency prevents duplicates |
| Queue processing order | FIFO order maintained |
| Network interruption recovery | Failed messages can be retried |
| UI responsiveness | Queue indicator updates in real-time |
| Performance | Queue handles 10+ messages without degradation |

---

## 8. Open Questions

1. **Queue Size Limit:** Should we limit queue size? (Proposed: 10 messages)
2. **Retry Strategy:** How many retries? What backoff? (Proposed: 3 retries, exponential backoff)
3. **Queue Timeout:** Should queued messages expire? (Proposed: No, persist until processed or cancelled)
4. **Cross-Device Sync:** Should queue sync across devices? (Proposed: No, defer to future)
5. **Backend Queue Persistence:** Should backend persist queue to database? (Proposed: No, defer to EF-59)

---

## 9. Dependencies

| Dependency | Status | Notes |
|------------|--------|-------|
| EF-61 ADR | ✅ Complete | Architecture design approved |
| EM-53 Basic Queue | ✅ Complete | Basic queue implemented |
| EM-54 Persistence | ✅ Complete | Session persistence implemented |
| EF-59 Session Persistence | ⏳ Pending | Database persistence (future) |
| EF-57 Smart Fox Response | ⏳ Pending | Enhanced response system (future) |

---

## 10. Appendix

### A. Related Jira Tickets

- **EF-37**: Chat: Message sent during AI generation is silently lost
- **EF-58**: Message Queue Implementation
- **EF-59**: Session Persistence
- **EF-61**: Conversation State Architecture ADR

### B. Related EM Tickets

- **EM-43**: Runtime Contract (TTL, idempotency, validation)
- **EM-53**: Message queue during generation
- **EM-54**: Session persistence across refresh

### C. References

- [EF-61 ADR: Conversation State Architecture](./EF-61-conversation-state-architecture.md)
- [React Native AsyncStorage](https://react-native-async-storage.github.io/async-storage/)
- [Expo Router](https://docs.expo.dev/router/introduction/)
