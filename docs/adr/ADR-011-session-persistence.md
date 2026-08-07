# ADR-011: Session Persistence Architecture

**Status**: Accepted  
**Date**: 2024  
**Jira**: EF-61, EF-38  

## Context

Users expect their conversation history to persist across browser refreshes. The initial implementation stored all data in React state, causing complete data loss on refresh. A persistence layer is required.

## Decision

Implement a **hybrid persistence architecture**:
- **Primary**: Backend database (Supabase + Drizzle) as source of truth
- **Cache**: AsyncStorage as local read cache for instant UI

### Storage Layers

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Backend Database (Source of Truth)                │
│  ───────────────────────────────────────────                │
│  • conversations table: metadata, state, timestamps         │
│  • messages table: full message history                     │
│  • Survives: server restart, device change, reinstall       │
│  • Latency: Network round-trip required                     │
└─────────────────────────────────────────────────────────────┘
                          ▲
                          │ Write-through
                          │
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: AsyncStorage (Local Cache)                        │
│  ───────────────────────────────────────                    │
│  • ef59_conversation_{id}: conversation metadata            │
│  • ef59_messages_{id}: message array                        │
│  • Survives: browser refresh                                │
│  • Lost on: app reinstall, cache clear                      │
│  • Latency: Instant (local I/O)                             │
└─────────────────────────────────────────────────────────────┘
                          ▲
                          │ State binding
                          │
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: React State (Runtime)                             │
│  ─────────────────────────────────────                      │
│  • messages[]: current conversation messages                │
│  • currentSessionId: active session                         │
│  • messageQueue[]: pending messages                         │
│  • Survives: Nothing (lost on refresh)                      │
│  • Latency: Zero (in-memory)                                │
└─────────────────────────────────────────────────────────────┘
```

## Conversation Persistence

### Schema
```sql
conversations (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  role_id         TEXT NOT NULL,
  state           TEXT DEFAULT 'active',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  last_message_at INTEGER
)
```

### Lifecycle
```
1. User starts new conversation → POST /conversations
2. Backend creates row, returns id
3. Frontend stores id in AsyncStorage
4. Subsequent messages reference this conversation_id
```

## Message Persistence

### Schema
```sql
messages (
  id               TEXT PRIMARY KEY,
  conversation_id  TEXT REFERENCES conversations(id),
  role             TEXT CHECK (role IN ('user', 'assistant')),
  content          TEXT NOT NULL,
  status           TEXT DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  request_id       TEXT,  -- idempotency key
  timestamp        INTEGER NOT NULL
)
```

### Write-through Timing

| Message Type | When Persisted | Status |
|--------------|----------------|--------|
| User message | Immediately after send | `sent` |
| Assistant message | After `deepDone` (generation complete) | `sent` |
| Failed generation | After error detected | `failed` |

**Key Principle**: Only terminal states are persisted. No `generating` status in DB.

## Companion State Persistence

### Current Implementation
```typescript
// AsyncStorage keys
'current_role_id'     → Selected companion ID
'current_session_id'  → Current session ID
'conversation_id'     → Conversation ID (EM-43)
```

### On Refresh Recovery
```
1. Read AsyncStorage → get roleId, sessionId, conversationId
2. Load role definition from PSYCHOLOGIST_ROLES
3. Restore conversation context
```

## Refresh Recovery Behavior

### Normal Recovery
```
User refreshes browser
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 1: Read AsyncStorage cache (instant)                  │
│  → Render UI with cached messages                           │
│  → No loading spinner needed                                │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 2: Background sync (non-blocking)                     │
│  → GET /conversations/:id                                   │
│  → Compare backend messages vs cache                        │
│  → If different → update cache + UI                         │
└─────────────────────────────────────────────────────────────┘
```

### Interrupted Generation Recovery
```
If last message status === 'generating' (should not exist in DB):
  → This state should never be persisted
  → If detected in cache, mark as 'failed'
  → Show "Generation interrupted" indicator
  → Offer retry button
```

### Ghost Message Prevention
```
Problem: Refresh during streaming creates orphaned partial message

Solution:
1. Only persist completed messages (status='sent' or 'failed')
2. On recovery, check for incomplete messages
3. Mark incomplete as 'failed'
4. UI shows failed state, not partial content
```

## Alternatives Considered

### Alternative 1: Frontend-only (AsyncStorage)
**Rejected**: 
- Limited storage (~6MB on Android)
- No cross-device sync
- Lost on reinstall
- Single source of truth is fragile

### Alternative 2: Backend-only (No cache)
**Rejected**:
- Loading spinner on every refresh
- Poor UX for returning users
- Network dependency for basic functionality

### Alternative 3: IndexedDB
**Rejected**:
- Browser-only (not available in React Native)
- More complex API than AsyncStorage
- Limited cross-platform support

## Trade-offs

| Pro | Con |
|-----|-----|
| Instant UI from cache | Cache consistency complexity |
| Durable backend storage | Network dependency for sync |
| Cross-device potential | Additional API development |
| Offline-capable (read) | Write requires network |

## Consequences

### Positive
- Users never lose conversation history
- Instant UI on app start
- Foundation for cross-device sync
- Extensible for Memory/Prediction features

### Negative
- Cache invalidation complexity
- Potential for stale data display
- Additional API calls on every startup

## References

- EF-59: Session Persistence implementation
- EF-38: Browser refresh fix
- ADR-010: Conversation State Machine
