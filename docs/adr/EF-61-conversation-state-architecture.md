# ADR: EmotionFlow Conversation State and Response Architecture

- **Status**: Proposed
- **Date**: 2025-01-XX
- **Deciders**: EmotionFlow Engineering Team
- **Related Tickets**: EF-37, EF-38, EF-57, EF-58, EF-59

---

## Executive Summary

This Architecture Decision Record (ADR) establishes the technical foundation for EmotionFlow's Conversation Reliability initiative. It addresses three critical reliability gaps:

1. **Message Loss** (EF-37): Messages sent during AI generation are silently lost
2. **Session Loss** (EF-38): Browser refresh loses active conversation and all messages
3. **Response Layer Reliability**: Unclear contract between EmotionFlow's three response layers (Reaction, Companion, Deep)

This document defines the Conversation State Machine, Message Lifecycle, Message Queue Design, Session Persistence Model, and SSE Event Contract that will guide implementation in EF-58 and EF-59.

---

## 1. Current Architecture Analysis

### 1.1 Frontend Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        React Native / Expo                       │
├─────────────────────────────────────────────────────────────────┤
│  Screens                                                         │
│  ├── chat/index.tsx (Home + Chat view switching)                │
│  └── chat/components/                                           │
│      ├── MessageBubble.tsx                                      │
│      ├── MultimodalInput.tsx                                    │
│      └── ...                                                    │
├─────────────────────────────────────────────────────────────────┤
│  State Management                                                │
│  └── contexts/ChatContext.tsx                                   │
│      ├── messages: ChatMessage[]                                │
│      ├── sessions: ChatSession[]                                │
│      ├── isLoading / isThinking / chatPhase                     │
│      ├── messageQueue: QueuedMessage[] (EM-53)                  │
│      └── sendingRef (concurrency guard)                         │
├─────────────────────────────────────────────────────────────────┤
│  Persistence                                                     │
│  └── stores/sessionStore.ts                                     │
│      └── AsyncStorage (chat_sessions key)                       │
├─────────────────────────────────────────────────────────────────┤
│  API Client                                                      │
│  └── api/cozeApi.ts                                             │
│      ├── chatStart() → POST /api/v1/chat/start                  │
│      └── chatStream() → GET /api/v1/chat/stream (SSE)           │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Backend Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Express.js Server                         │
├─────────────────────────────────────────────────────────────────┤
│  API Endpoints                                                   │
│  ├── POST /api/v1/chat/start                                    │
│  │   ├── Emotion recognition (rule-based)                       │
│  │   ├── Event detection                                        │
│  │   ├── State detection + keyword extraction                   │
│  │   ├── EmotionFlow V3 Timeline generation                     │
│  │   │   ├── reactionTimeline: [{displayAt, text}]              │
│  │   │   └── companionTimeline: [{displayAt, text}]             │
│  │   └── Returns: sessionId, flowContext, timelines             │
│  │                                                               │
│  └── GET /api/v1/chat/stream?sessionId=xxx                      │
│      └── SSE stream from Alibaba DashScope (Deep layer)         │
├─────────────────────────────────────────────────────────────────┤
│  In-Memory State                                                 │
│  ├── conversationTurns: Map<conversationId, turnCount>          │
│  ├── neuralProfiles: Map<userId+roleId, profile>                │
│  └── sessionStore: Map<sessionId, ChatSession>                  │
└─────────────────────────────────────────────────────────────────┘
```

### 1.3 EmotionFlow Three-Layer Response Model

```
User Input
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│  Layer 1: Reaction (0-8s)                                     │
│  ├── Source: Local rule-based engine (zero LLM dependency)    │
│  ├── Purpose: Immediate emotional acknowledgment              │
│  ├── Format: Short empathetic sentences                       │
│  └── Timeline: Multiple segments with displayAt timestamps    │
├───────────────────────────────────────────────────────────────┤
│  Layer 2: Companion (8-30s)                                   │
│  ├── Source: Local rule-based engine                          │
│  ├── Purpose: Warm陪伴, deeper emotional connection           │
│  ├── Format: Longer supportive paragraphs                     │
│  └── Timeline: Chained segments after Reaction completes      │
├───────────────────────────────────────────────────────────────┤
│  Layer 3: Deep (30s+)                                         │
│  ├── Source: Alibaba DashScope LLM (via SSE)                  │
│  ├── Purpose: Professional psychological analysis             │
│  ├── Format: Structured response with cognitive patterns      │
│  └── Context: Receives flowContext from Layer 1+2             │
└───────────────────────────────────────────────────────────────┘
```

### 1.4 Current State Management Gaps

| Gap | Description | Impact |
|-----|-------------|--------|
| **No explicit state machine** | `chatPhase` is a loose enum without transition guards | Invalid transitions possible |
| **Volatile message state** | Messages only in React state, lost on refresh | Data loss |
| **No message persistence** | Messages not saved to AsyncStorage during streaming | Recovery impossible |
| **Queue without visibility** | EM-53 queue exists but no UI feedback | User uncertainty |
| **No SSE event contract** | Frontend parses ad-hoc JSON chunks | Fragile integration |
| **Backend state in-memory** | `conversationTurns`, `neuralProfiles` lost on restart | Inconsistency |

---

## 2. Conversation State Machine Design

### 2.1 State Diagram

```
                    ┌─────────────────────────────────────────────────────────────┐
                    │                                                             │
                    ▼                                                             │
┌─────────┐    ┌─────────┐    ┌─────────────────────┐    ┌──────────────────┐   │
│  IDLE   │───▶│ SENDING │───▶│ GENERATING_REACTION │───▶│GENERATING_COMPANION│  │
└─────────┘    └─────────┘    └─────────────────────┘    └──────────────────┘   │
      ▲              │                    │                         │            │
      │              │                    │                         │            │
      │              ▼                    │                         ▼            │
      │         ┌─────────┐              │                   ┌─────────────┐     │
      │         │ FAILED  │              │                   │GENERATING_DEEP│────┘
      │         └─────────┘              │                   └─────────────┘
      │              ▲                    │                         │
      │              │                    │                         │
      │              └────────────────────┼─────────────────────────┘
      │                                   │
      │                              ┌─────────┐
      └──────────────────────────────│COMPLETED│
                                     └─────────┘
```

### 2.2 State Definitions

| State | Entry Condition | Exit Condition | Frontend Behavior | Backend Behavior |
|-------|-----------------|----------------|-------------------|------------------|
| **IDLE** | Initial state; after COMPLETED/FAILED | User sends message | Input enabled, no loading indicator | None |
| **SENDING** | User triggers send | chatStart request sent or failed | Input disabled, loading indicator | Validate request, create session |
| **GENERATING_REACTION** | chatStart succeeded | First Reaction segment displayed | Render Reaction text with typewriter | Generate reactionTimeline |
| **GENERATING_COMPANION** | Reaction timeline progressing | Companion segments displaying | Render Companion text | Generate companionTimeline |
| **GENERATING_DEEP** | Deep SSE stream started | SSE stream completed | Render Deep text paragraph by paragraph | Stream LLM response via SSE |
| **COMPLETED** | All layers finished | User sends new message or timeout | Enable input, persist messages | Mark session complete |
| **FAILED** | Any layer fails | User retries | Show error, enable retry button | Log error, preserve context |

### 2.3 State Transitions

```typescript
// State transition table
const TRANSITIONS: Record<ConversationState, ConversationState[]> = {
  IDLE: ['SENDING'],
  SENDING: ['GENERATING_REACTION', 'FAILED'],
  GENERATING_REACTION: ['GENERATING_COMPANION', 'GENERATING_DEEP', 'FAILED'],
  GENERATING_COMPANION: ['GENERATING_DEEP', 'COMPLETED', 'FAILED'],
  GENERATING_DEEP: ['COMPLETED', 'FAILED'],
  COMPLETED: ['IDLE', 'SENDING'],
  FAILED: ['IDLE', 'SENDING'],
};

// Transition guard
function canTransition(from: ConversationState, to: ConversationState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}
```

### 2.4 State Persistence

```typescript
interface ConversationStateSnapshot {
  state: ConversationState;
  sessionId: string;
  conversationId: string;
  roleId: string;
  lastUserMessage: string;
  timestamp: number;
  // For recovery
  completedLayers: ('reaction' | 'companion' | 'deep')[];
  failedLayer?: 'reaction' | 'companion' | 'deep';
}
```

---

## 3. Message Lifecycle Design

### 3.1 Message States

```
┌─────────┐    ┌─────────┐    ┌────────────┐    ┌───────────┐
│ CREATED │───▶│ QUEUED  │───▶│ PROCESSING │───▶│ COMPLETED │
└─────────┘    └─────────┘    └────────────┘    └───────────┘
                    │               │
                    │               ▼
                    │          ┌─────────┐
                    └─────────▶│ FAILED  │
                               └─────────┘
```

### 3.2 Message State Definitions

| State | Description | Persistence |
|-------|-------------|-------------|
| **CREATED** | User typed message, not yet sent | Not persisted |
| **QUEUED** | Message queued for processing (during generation) | Persisted immediately |
| **PROCESSING** | Message being processed by backend | Status updated |
| **COMPLETED** | Full response received and rendered | Final state persisted |
| **FAILED** | Processing failed | Error state persisted |

### 3.3 Message Entity Model

```typescript
interface Message {
  // Identity
  id: string;                    // Client-generated UUID
  messageId?: string;            // Server-assigned after persistence
  conversationId: string;        // Links to conversation
  
  // Content
  role: 'user' | 'assistant';
  content: string;
  
  // Response layers (for assistant messages)
  layers?: {
    reaction?: LayerContent;
    companion?: LayerContent;
    deep?: LayerContent;
  };
  
  // Lifecycle
  status: MessageStatus;
  timestamp: number;             // Creation time
  completedAt?: number;          // When all layers finished
  
  // Metadata
  requestId?: string;            // For idempotent retry
  error?: string;                // Error message if failed
  
  // Streaming state (not persisted)
  isStreaming?: boolean;
  streamProgress?: number;       // 0-100
}

interface LayerContent {
  text: string;
  displayAt?: number;            // Timeline offset in seconds
  completed: boolean;
}

type MessageStatus = 'created' | 'queued' | 'processing' | 'completed' | 'failed';
```

### 3.4 Message Lifecycle Flow

```
User Action: Send Message
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 1. CREATE user message                                          │
│    - Generate client-side ID                                    │
│    - Set status = 'created'                                     │
│    - Add to local messages array                                │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. PERSIST to AsyncStorage                                      │
│    - Save message with status = 'queued' (if during generation) │
│    - OR status = 'processing' (if immediate send)               │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. SEND to backend                                              │
│    - POST /api/v1/chat/start                                    │
│    - Include requestId for idempotency                          │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. RECEIVE Reaction layer                                       │
│    - Update message.layers.reaction                             │
│    - Render with typewriter effect                              │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. RECEIVE Companion layer                                      │
│    - Update message.layers.companion                            │
│    - Render after Reaction completes                            │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. RECEIVE Deep layer (SSE stream)                              │
│    - Update message.layers.deep progressively                   │
│    - Render paragraph by paragraph                              │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 7. COMPLETE                                                     │
│    - Set status = 'completed'                                   │
│    - Set completedAt = Date.now()                               │
│    - Persist final state to AsyncStorage                        │
└─────────────────────────────────────────────────────────────────┘
```

### 3.5 Duplicate Prevention

```typescript
// Idempotency key generation
function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${crypto.randomUUID()}`;
}

// Backend deduplication
async function handleChatStart(request: ChatStartRequest) {
  const { requestId, conversationId } = request;
  
  // Check if this request was already processed
  const existing = await getMessageByRequestId(requestId);
  if (existing) {
    // Return cached response
    return existing.cachedResponse;
  }
  
  // Process new request
  const response = await processMessage(request);
  
  // Cache response for idempotent retry
  await cacheResponse(requestId, response);
  
  return response;
}
```

### 3.6 Failure Recovery

```typescript
// On app startup, check for incomplete messages
async function recoverIncompleteMessages() {
  const sessions = await getChatSessions();
  
  for (const session of sessions) {
    for (const message of session.messages) {
      if (message.status === 'processing') {
        // Mark as failed (user can retry)
        message.status = 'failed';
        message.error = 'Interrupted by app restart';
      }
    }
  }
  
  await saveChatSessions(sessions);
}
```

---

## 4. Message Queue Design

### 4.1 Queue Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Message Queue                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐      │
│  │ Msg 1   │───▶│ Msg 2   │───▶│ Msg 3   │───▶│ Msg 4   │      │
│  │(queued) │    │(queued) │    │(queued) │    │(queued) │      │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘      │
│       ▲                                                         │
│       │                                                         │
│  ┌────┴────┐                                                    │
│  │Current  │◀── Currently being processed                       │
│  │Message  │                                                    │
│  └─────────┘                                                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Queue State

```typescript
interface MessageQueue {
  // Queue items
  items: QueuedMessage[];
  
  // Current processing state
  currentMessageId: string | null;
  isProcessing: boolean;
  
  // Queue metadata
  createdAt: number;
  lastUpdatedAt: number;
}

interface QueuedMessage {
  id: string;
  text: string;
  options?: {
    audioUri?: string;
    emotion?: string;
  };
  timestamp: number;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  errorMessage?: string;
}
```

### 4.3 Queue Behavior

```typescript
// When user sends message during generation
async function sendMessage(text: string): Promise<boolean> {
  // Check if currently processing
  if (isProcessing) {
    // Add to queue
    const queuedMessage: QueuedMessage = {
      id: generateId(),
      text,
      timestamp: Date.now(),
      status: 'queued',
    };
    
    queue.items.push(queuedMessage);
    
    // Persist queue
    await persistQueue();
    
    // Return false to indicate message was queued (not sent immediately)
    return false;
  }
  
  // Send immediately
  return await sendImmediate(text);
}

// When current message completes
async function onCurrentMessageCompleted() {
  // Check queue for next message
  const nextMessage = queue.items.find(m => m.status === 'queued');
  
  if (nextMessage) {
    // Update status
    nextMessage.status = 'processing';
    queue.currentMessageId = nextMessage.id;
    
    // Clear input if it still contains the queued text
    if (inputText.trim() === nextMessage.text) {
      setInputText('');
    }
    
    // Process next message
    await processMessage(nextMessage);
  } else {
    // Queue empty, return to idle
    queue.isProcessing = false;
    queue.currentMessageId = null;
  }
}
```

### 4.4 Frontend State Requirements

| State | Purpose | Persistence |
|-------|---------|-------------|
| `messageQueue: QueuedMessage[]` | Queue of pending messages | AsyncStorage |
| `currentMessageId: string \| null` | Currently processing message | AsyncStorage |
| `isProcessing: boolean` | Whether queue is active | AsyncStorage |
| `queuePosition: number` | Position in queue for UI feedback | Derived |

### 4.5 Backend API Changes

```typescript
// New endpoint: Get queue status
GET /api/v1/conversations/:conversationId/queue

Response:
{
  "conversationId": "conv_xxx",
  "queueLength": 3,
  "currentMessageId": "msg_xxx",
  "estimatedWaitTime": 15000  // ms
}

// Modified endpoint: Send message with queue awareness
POST /api/v1/chat/start
{
  "roleId": "su_shi",
  "message": "Hello",
  "conversationId": "conv_xxx",
  "requestId": "req_xxx",
  "queuePosition": 2  // New: client sends queue position
}
```

### 4.6 Database Requirements

```sql
-- Message queue table (future: when migrating to database)
CREATE TABLE message_queue (
  id VARCHAR(36) PRIMARY KEY,
  conversation_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  content TEXT NOT NULL,
  status ENUM('queued', 'processing', 'completed', 'failed'),
  queue_position INT NOT NULL,
  request_id VARCHAR(64) UNIQUE,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  error_message TEXT,
  
  INDEX idx_conversation_status (conversation_id, status),
  INDEX idx_queue_position (conversation_id, queue_position)
);
```

---

## 5. Session Persistence Design

### 5.1 Data Model

```typescript
// Conversation entity
interface Conversation {
  // Identity
  conversationId: string;        // Client-generated, stable across sessions
  serverConversationId?: string; // Server-assigned (future)
  userId: string;
  
  // Configuration
  roleId: string;
  companionId?: string;          // For future multi-companion support
  
  // State
  state: ConversationState;
  turnCount: number;
  
  // Messages
  messages: Message[];
  
  // Metadata
  createdAt: number;
  updatedAt: number;
  lastActiveAt: number;
  
  // Context for recovery
  flowContext?: FlowContext;     // Last known emotional context
  neuralProfile?: NeuralProfile; // User's neural adaptation state
}

// Message entity (as defined in Section 3)
interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  layers?: {
    reaction?: LayerContent;
    companion?: LayerContent;
    deep?: LayerContent;
  };
  status: MessageStatus;
  timestamp: number;
  completedAt?: number;
  requestId?: string;
  error?: string;
}
```

### 5.2 Storage Schema

```typescript
// AsyncStorage keys
const STORAGE_KEYS = {
  // Conversation list (index)
  CONVERSATIONS_INDEX: 'conversations_index',
  
  // Individual conversation data
  CONVERSATION_DATA: (id: string) => `conversation_${id}`,
  
  // Current active conversation
  CURRENT_CONVERSATION_ID: 'current_conversation_id',
  
  // Current role
  CURRENT_ROLE_ID: 'current_role_id',
  
  // Message queue
  MESSAGE_QUEUE: (conversationId: string) => `queue_${conversationId}`,
  
  // User preferences
  USER_PREFERENCES: 'user_preferences',
};

// Index structure
interface ConversationsIndex {
  conversationIds: string[];     // Ordered by lastActiveAt
  lastUpdated: number;
}
```

### 5.3 Persistence Strategy

```typescript
// Write strategy: Debounced writes to avoid excessive I/O
class PersistenceManager {
  private writeTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly DEBOUNCE_MS = 500;
  
  async saveConversation(conversation: Conversation) {
    const key = STORAGE_KEYS.CONVERSATION_DATA(conversation.conversationId);
    
    // Debounce writes
    const existingTimer = this.writeTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    const timer = setTimeout(async () => {
      await AsyncStorage.setItem(key, JSON.stringify(conversation));
      this.writeTimers.delete(key);
    }, this.DEBOUNCE_MS);
    
    this.writeTimers.set(key, timer);
  }
  
  // Critical writes bypass debounce
  async saveConversationCritical(conversation: Conversation) {
    const key = STORAGE_KEYS.CONVERSATION_DATA(conversation.conversationId);
    await AsyncStorage.setItem(key, JSON.stringify(conversation));
  }
}
```

### 5.4 Recovery Flow

```
App Startup
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 1. Load conversations index                                     │
│    - Read CONVERSATIONS_INDEX from AsyncStorage                 │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Load current conversation ID                                 │
│    - Read CURRENT_CONVERSATION_ID                               │
│    - If null, show home screen                                  │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Load conversation data                                       │
│    - Read CONVERSATION_DATA(currentId)                          │
│    - Parse and validate                                         │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Recover incomplete messages                                  │
│    - Find messages with status = 'processing'                   │
│    - Mark as 'failed' with error message                        │
│    - User can retry manually                                    │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. Restore UI state                                             │
│    - Set currentRole from conversation.roleId                   │
│    - Set messages from conversation.messages                    │
│    - Set conversationState from conversation.state              │
│    - If state != IDLE and != COMPLETED, show recovery prompt    │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. Check message queue                                          │
│    - Load MESSAGE_QUEUE(currentId)                              │
│    - If queue not empty, show queue indicator                   │
│    - Do NOT auto-process (user may have left intentionally)     │
└─────────────────────────────────────────────────────────────────┘
```

### 5.5 "New Chat" Behavior

```typescript
function createNewChat() {
  // 1. Save current conversation (if any)
  if (currentConversation) {
    await persistenceManager.saveConversationCritical(currentConversation);
  }
  
  // 2. Create new conversation
  const newConversation: Conversation = {
    conversationId: generateConversationId(),
    userId: currentUserId,
    roleId: currentRole.id,
    state: 'IDLE',
    turnCount: 0,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastActiveAt: Date.now(),
  };
  
  // 3. Update index
  const index = await loadConversationsIndex();
  index.conversationIds.unshift(newConversation.conversationId);
  await saveConversationsIndex(index);
  
  // 4. Set as current
  await AsyncStorage.setItem(STORAGE_KEYS.CURRENT_CONVERSATION_ID, newConversation.conversationId);
  
  // 5. Update UI state
  setCurrentConversation(newConversation);
  setMessages([]);
  setConversationState('IDLE');
  
  // NOTE: Previous conversations are NOT deleted
  // They remain in the index and can be accessed via history
}
```

### 5.6 Database Schema (Future Migration)

```sql
-- Conversations table
CREATE TABLE conversations (
  conversation_id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  role_id VARCHAR(32) NOT NULL,
  state VARCHAR(32) NOT NULL DEFAULT 'IDLE',
  turn_count INT NOT NULL DEFAULT 0,
  flow_context JSONB,
  neural_profile JSONB,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  last_active_at BIGINT NOT NULL,
  
  INDEX idx_user_active (user_id, last_active_at DESC),
  INDEX idx_user_role (user_id, role_id)
);

-- Messages table
CREATE TABLE messages (
  message_id VARCHAR(36) PRIMARY KEY,
  conversation_id VARCHAR(36) NOT NULL,
  role ENUM('user', 'assistant') NOT NULL,
  content TEXT NOT NULL,
  layers JSONB,
  status ENUM('created', 'queued', 'processing', 'completed', 'failed') NOT NULL,
  timestamp BIGINT NOT NULL,
  completed_at BIGINT,
  request_id VARCHAR(64) UNIQUE,
  error TEXT,
  
  FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE,
  INDEX idx_conversation_time (conversation_id, timestamp),
  INDEX idx_status (status)
);
```

---

## 6. SSE Event Contract

### 6.1 Event Types

| Event | Direction | Purpose |
|-------|-----------|---------|
| `message.created` | Server → Client | New message created in conversation |
| `message.queued` | Server → Client | Message added to processing queue |
| `generation.started` | Server → Client | Layer generation began |
| `generation.progress` | Server → Client | Streaming content chunk |
| `generation.completed` | Server → Client | Layer generation finished |
| `generation.failed` | Server → Client | Layer generation failed |
| `conversation.state_changed` | Server → Client | Conversation state transition |
| `queue.position_updated` | Server → Client | Queue position changed |

### 6.2 Event Payloads

```typescript
// message.created
interface MessageCreatedEvent {
  type: 'message.created';
  payload: {
    messageId: string;
    conversationId: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
  };
}

// message.queued
interface MessageQueuedEvent {
  type: 'message.queued';
  payload: {
    messageId: string;
    conversationId: string;
    queuePosition: number;
    estimatedWaitMs: number;
  };
}

// generation.started
interface GenerationStartedEvent {
  type: 'generation.started';
  payload: {
    messageId: string;
    conversationId: string;
    layer: 'reaction' | 'companion' | 'deep';
    startedAt: number;
  };
}

// generation.progress
interface GenerationProgressEvent {
  type: 'generation.progress';
  payload: {
    messageId: string;
    conversationId: string;
    layer: 'reaction' | 'companion' | 'deep';
    content: string;           // Incremental content
    isComplete: boolean;       // True if this is the final chunk
    progress?: number;         // 0-100 (for deep layer)
  };
}

// generation.completed
interface GenerationCompletedEvent {
  type: 'generation.completed';
  payload: {
    messageId: string;
    conversationId: string;
    layer: 'reaction' | 'companion' | 'deep';
    completedAt: number;
    fullContent: string;       // Complete content for verification
  };
}

// generation.failed
interface GenerationFailedEvent {
  type: 'generation.failed';
  payload: {
    messageId: string;
    conversationId: string;
    layer: 'reaction' | 'companion' | 'deep';
    error: string;
    recoverable: boolean;      // Can user retry?
    failedAt: number;
  };
}

// conversation.state_changed
interface ConversationStateChangedEvent {
  type: 'conversation.state_changed';
  payload: {
    conversationId: string;
    previousState: ConversationState;
    currentState: ConversationState;
    changedAt: number;
  };
}

// queue.position_updated
interface QueuePositionUpdatedEvent {
  type: 'queue.position_updated';
  payload: {
    conversationId: string;
    queueLength: number;
    currentPosition: number;
  };
}
```

### 6.3 SSE Connection Management

```typescript
// Client-side SSE handler
class ConversationSSEClient {
  private eventSource: EventSource | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly RECONNECT_BASE_DELAY = 1000;
  
  connect(conversationId: string) {
    const url = `${BACKEND_URL}/api/v1/conversations/${conversationId}/events`;
    
    this.eventSource = new EventSource(url);
    
    // Register handlers for each event type
    this.eventSource.addEventListener('message.created', this.handleMessageCreated);
    this.eventSource.addEventListener('message.queued', this.handleMessageQueued);
    this.eventSource.addEventListener('generation.started', this.handleGenerationStarted);
    this.eventSource.addEventListener('generation.progress', this.handleGenerationProgress);
    this.eventSource.addEventListener('generation.completed', this.handleGenerationCompleted);
    this.eventSource.addEventListener('generation.failed', this.handleGenerationFailed);
    this.eventSource.addEventListener('conversation.state_changed', this.handleStateChanged);
    this.eventSource.addEventListener('queue.position_updated', this.handleQueueUpdated);
    
    // Connection lifecycle
    this.eventSource.onopen = () => {
      this.reconnectAttempts = 0;
    };
    
    this.eventSource.onerror = () => {
      this.handleReconnect();
    };
  }
  
  private handleReconnect() {
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      this.emit('connection_failed');
      return;
    }
    
    const delay = this.RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempts);
    setTimeout(() => {
      this.reconnectAttempts++;
      this.connect(this.currentConversationId);
    }, delay);
  }
  
  disconnect() {
    this.eventSource?.close();
    this.eventSource = null;
  }
}
```

### 6.4 Backend SSE Implementation

```typescript
// Server-side SSE endpoint
app.get('/api/v1/conversations/:conversationId/events', (req, res) => {
  const { conversationId } = req.params;
  
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Register client
  const client: SSEClient = { res, conversationId };
  sseManager.addClient(client);
  
  // Send initial state
  const conversation = getConversation(conversationId);
  sendEvent(client, {
    type: 'conversation.state_changed',
    payload: {
      conversationId,
      previousState: 'IDLE',
      currentState: conversation.state,
      changedAt: Date.now(),
    },
  });
  
  // Cleanup on disconnect
  req.on('close', () => {
    sseManager.removeClient(client);
  });
});

// Emit event to all clients subscribed to conversation
function emitToConversation(conversationId: string, event: SSEEvent) {
  const clients = sseManager.getClients(conversationId);
  for (const client of clients) {
    sendEvent(client, event);
  }
}
```

---

## 7. Architecture Decisions

### Decision 1: Queue User Messages During Generation

| Aspect | Details |
|--------|---------|
| **Context** | Users may send messages while AI is generating a response. Current behavior silently drops these messages. |
| **Decision** | Implement a client-side message queue. Messages are persisted immediately and processed sequentially after the current generation completes. |
| **Alternatives** | 1. **Disable input during generation** - Simpler but frustrating UX<br>2. **Cancel current generation** - Disruptive, wastes backend resources<br>3. **Parallel processing** - Complex, may confuse conversation flow |
| **Trade-offs** | + Better UX: users can continue expressing themselves<br>+ No message loss<br>+ Maintains conversation coherence<br>- Added complexity in state management<br>- Requires persistence layer<br>- Queue state must survive app restarts |
| **Consequences** | - Frontend needs queue state management<br>- Messages must be persisted before sending<br>- Backend needs idempotency support<br>- UI must show queue status |

---

### Decision 2: Client-Side Persistence with AsyncStorage

| Aspect | Details |
|--------|---------|
| **Context** | Conversation data must survive browser refresh. Backend currently stores state in-memory only. |
| **Decision** | Use AsyncStorage for client-side persistence. Migrate to database-backed storage in future phase. |
| **Alternatives** | 1. **Backend database immediately** - Requires backend changes, database setup<br>2. **IndexedDB** - Web-only, not cross-platform<br>3. **Backend session + client cache** - Complex synchronization |
| **Trade-offs** | + Quick to implement with existing infrastructure<br>+ Works across web and mobile<br>+ No backend changes required<br>- Limited storage capacity<br>- No cross-device sync<br>- Data loss if storage cleared |
| **Consequences** | - Frontend owns persistence responsibility<br>- Backend remains stateless for conversations<br>- Future migration to database will require data migration strategy |

---

### Decision 3: Explicit State Machine for Conversation Flow

| Aspect | Details |
|--------|---------|
| **Context** | Current `chatPhase` is a loose enum without transition guards. Invalid transitions can occur. |
| **Decision** | Implement an explicit state machine with defined transitions and guards. |
| **Alternatives** | 1. **Continue with loose enum** - Simpler but error-prone<br>2. **XState library** - More powerful but adds dependency<br>3. **Redux-based state** - Overkill for current scope |
| **Trade-offs** | + Prevents invalid state transitions<br>+ Makes state changes predictable<br>+ Easier to test and debug<br>+ Clear recovery paths<br>- Additional code complexity<br>- Requires discipline to maintain |
| **Consequences** | - All state changes go through transition function<br>- Invalid transitions logged and prevented<br>- State persistence includes machine state<br>- Recovery logic tied to state machine |

---

### Decision 4: Layered Response with Progressive Enhancement

| Aspect | Details |
|--------|---------|
| **Context** | EmotionFlow has three response layers (Reaction, Companion, Deep) with different latencies. |
| **Decision** | Each layer is independent and progressively enhances the response. Failure in one layer does not block others. |
| **Alternatives** | 1. **Synchronous all layers** - Simpler but slow<br>2. **Deep layer only** - Loses emotional immediacy<br>3. **Client-side fallback** - Less coherent experience |
| **Trade-offs** | + Fast initial response (Reaction is instant)<br>+ Graceful degradation<br>+ Each layer can fail independently<br>+ Better perceived performance<br>- Complex rendering logic<br>- Need to handle partial responses |
| **Consequences** | - Frontend renders layers as they arrive<br>- Each layer has independent completion status<br>- Failed layers marked but don't block<br>- Recovery can retry specific layers |

---

### Decision 5: Idempotent Request IDs for Retry Safety

| Aspect | Details |
|--------|---------|
| **Context** | Network failures may cause duplicate requests. Backend must not process the same message twice. |
| **Decision** | Client generates unique `requestId` for each message. Backend uses this for idempotency. |
| **Alternatives** | 1. **No idempotency** - Risk of duplicate messages<br>2. **Backend-generated IDs** - Requires extra round-trip<br>3. **Content hashing** - Fails for identical messages |
| **Trade-offs** | + Prevents duplicate processing<br>+ Enables safe retry<br>+ Client controls uniqueness scope<br>- Requires ID generation logic<br>- Backend must store request history |
| **Consequences** | - Client generates `req_${timestamp}_${uuid}` format IDs<br>- Backend caches responses by requestId<br>- Retry sends same requestId<br>- Cache expires after conversation timeout |

---

### Decision 6: No Auto-Process Queue on Recovery

| Aspect | Details |
|--------|---------|
| **Context** | When app restarts with queued messages, should they auto-process? |
| **Decision** | Do NOT auto-process queued messages on recovery. Show queue indicator and let user decide. |
| **Alternatives** | 1. **Auto-process all** - May process outdated messages<br>2. **Discard queue** - Loses user intent<br>3. **Process only first** - Arbitrary cutoff |
| **Trade-offs** | + User maintains control<br>- Prevents processing messages user no longer wants to send<br>+ Clear indication of pending state<br>- User must manually trigger processing |
| **Consequences** | - Queue state persisted but not auto-executed<br>- UI shows "X messages pending" indicator<br>- User can review and discard queued messages<br>- Processing starts only on explicit user action |

---

## 8. Implementation Impact

### 8.1 EF-58: Message Queue Implementation

#### Frontend Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `contexts/ChatContext.tsx` | Modify | Add queue state management, integrate with state machine |
| `stores/messageQueueStore.ts` | Create | Queue persistence logic |
| `components/QueueIndicator.tsx` | Create | UI component showing queue status |
| `components/MultimodalInput.tsx` | Modify | Show queue feedback, handle queued state |
| `types/index.ts` | Modify | Add queue-related types |
| `hooks/useMessageQueue.ts` | Create | Hook for queue operations |

#### Backend Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `src/index.ts` | Modify | Add requestId idempotency check |
| `src/services/requestCache.ts` | Create | Cache responses by requestId |
| `src/routes/queue.ts` | Create | Queue status endpoint |

#### Database Changes

```sql
-- Phase 1: AsyncStorage (no changes)
-- Phase 2: Database migration
CREATE TABLE request_cache (
  request_id VARCHAR(64) PRIMARY KEY,
  conversation_id VARCHAR(36) NOT NULL,
  response JSONB NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);
```

#### Testing Requirements

| Test Type | Coverage |
|-----------|----------|
| Unit | Queue operations (enqueue, dequeue, persist) |
| Unit | State machine transitions |
| Integration | Queue survives app restart |
| Integration | Idempotent retry with same requestId |
| E2E | Send during generation → verify queued → verify processed |

---

### EF-59: Session Persistence Implementation

#### Frontend Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `stores/sessionStore.ts` | Modify | Enhanced persistence with conversation model |
| `stores/persistenceManager.ts` | Create | Debounced write strategy |
| `contexts/ChatContext.tsx` | Modify | Integrate recovery flow on startup |
| `hooks/useSessionRecovery.ts` | Create | Recovery logic hook |
| `types/index.ts` | Modify | Add Conversation entity |

#### Backend Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `src/index.ts` | Modify | Add conversation endpoints |
| `src/routes/conversations.ts` | Create | CRUD for conversations |
| `src/services/conversationService.ts` | Create | Business logic |

#### Database Changes

```sql
-- See Section 5.6 for full schema
CREATE TABLE conversations (...);
CREATE TABLE messages (...);
```

#### Testing Requirements

| Test Type | Coverage |
|-----------|----------|
| Unit | Persistence operations |
| Unit | Recovery flow |
| Integration | Refresh preserves conversation |
| Integration | Incomplete messages marked as failed |
| E2E | Full conversation → refresh → verify restored |

---

### EF-57: Smart Fox Response Integration

#### Frontend Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `api/cozeApi.ts` | Modify | Add SSE event handling |
| `contexts/ChatContext.tsx` | Modify | Integrate with state machine events |
| `components/MessageBubble.tsx` | Modify | Render layered response |

#### Backend Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `src/services/sseManager.ts` | Create | SSE connection management |
| `src/routes/events.ts` | Create | SSE event endpoint |
| `src/services/emotionFlow.ts` | Modify | Emit events during generation |

#### Database Changes

```sql
-- Add event log for debugging
CREATE TABLE conversation_events (
  event_id VARCHAR(36) PRIMARY KEY,
  conversation_id VARCHAR(36) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  payload JSONB NOT NULL,
  created_at BIGINT NOT NULL,
  
  INDEX idx_conversation_events (conversation_id, created_at)
);
```

#### Testing Requirements

| Test Type | Coverage |
|-----------|----------|
| Unit | SSE event parsing |
| Unit | State machine integration |
| Integration | Event delivery on SSE |
| E2E | Full three-layer response flow |

---

## 9. Migration Strategy

### Phase 1: Foundation (Current)

- [x] EM-53: Message queue (client-side)
- [x] EM-54: Session persistence (AsyncStorage)
- [ ] EF-58: Enhanced message queue with state machine
- [ ] EF-59: Enhanced session persistence with recovery

### Phase 2: SSE Contract

- [ ] EF-57: Smart Fox response with SSE events
- [ ] Implement event contract (Section 6)
- [ ] Add SSE connection management

### Phase 3: Backend Persistence

- [ ] Migrate to database storage
- [ ] Implement conversation API
- [ ] Data migration from AsyncStorage

### Phase 4: Cross-Device Sync

- [ ] User authentication
- [ ] Cloud sync for conversations
- [ ] Conflict resolution strategy

---

## 10. Appendix

### A. Glossary

| Term | Definition |
|------|------------|
| **Reaction Layer** | Immediate emotional acknowledgment (0-8s), generated locally |
| **Companion Layer** | Warm陪伴 response (8-30s), generated locally |
| **Deep Layer** | Professional psychological analysis (30s+), generated by LLM |
| **FlowContext** | Structured emotional context passed to Deep layer |
| **NeuralProfile** | User's adaptation state for personalized responses |
| **ConversationState** | Explicit state machine state for conversation lifecycle |

### B. Related Documents

- [EM-43 Runtime Contract](./em43-runtime-contract.md)
- [EmotionFlow V3 Design](./emotionflow-v3-design.md)
- [AsyncStorage Best Practices](./async-storage-guide.md)

### C. Revision History

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2025-01-XX | 1.0 | EmotionFlow Team | Initial draft |
