# ADR-010: Conversation State Machine

**Status**: Accepted  
**Date**: 2024  
**Jira**: EF-61  

## Context

EmotionFlow's conversation system involves multiple asynchronous operations: user input, message persistence, AI generation, and streaming. Without a clear state model, these operations can conflict (e.g., user sending a message during generation, or refreshing during streaming).

## Decision

Adopt a **state-driven conversation architecture** with explicit states and transitions.

### States

```
IDLE ─────────────────────────────────────────────────────────► IDLE
  │                                                              ▲
  │ user sends message                                           │
  ▼                                                              │
USER_INPUT                                                       │
  │                                                              │
  │ persist message                                              │
  ▼                                                              │
PERSISTING                                                       │
  │                                                              │
  │ start generation                                             │
  ▼                                                              │
GENERATING                                                       │
  │                                                              │
  │ stream starts                                                │
  ▼                                                              │
STREAMING                                                        │
  │                                                              │
  │ stream completes                                             │
  ▼                                                              │
COMPLETED ───────────────────────────────────────────────────────┘
  │
  │ error occurs (at any point)
  ▼
FAILED ─────────────────────────────────────────────────────────► IDLE (retry)
```

### State Definitions

| State | Description | Allowed Actions |
|-------|-------------|-----------------|
| `IDLE` | No active operation | User can send message |
| `USER_INPUT` | Message being validated/prepared | Queue or block new input |
| `PERSISTING` | Message being saved to backend | Wait |
| `GENERATING` | AI processing (pre-stream) | Queue new messages |
| `STREAMING` | SSE stream active | Queue new messages |
| `COMPLETED` | Response fully received | User can send next message |
| `FAILED` | Error occurred | Retry or discard |

## Event Lifecycle

### Normal Flow
```
1. User types message → IDLE → USER_INPUT
2. Message validated → USER_INPUT → PERSISTING
3. Message saved to DB → PERSISTING → GENERATING
4. chatStart returns → GENERATING → STREAMING
5. Deep response streamed → STREAMING → COMPLETED
6. COMPLETED → IDLE (ready for next message)
```

### User Input During Generation
```
Current state: GENERATING or STREAMING
User sends new message → Message enters queue
Queue item status: 'queued'
When state returns to IDLE → processNextInQueue()
```

## Queue vs Block Strategy

**Decision**: Queue strategy (not block)

| Strategy | Behavior | Choice |
|----------|----------|--------|
| Block | Reject new input during generation | ❌ Rejected |
| Queue | Accept input, process after completion | ✅ Selected |

**Rationale**:
- Users may have thoughts they don't want to lose
- Queue preserves user intent
- FIFO order maintains conversation coherence
- Queue persists to AsyncStorage (survives refresh)

## Alternatives Considered

### Alternative 1: Simple Boolean Flag
```typescript
const [isGenerating, setIsGenerating] = useState(false);
```
**Rejected**: No explicit state transitions, hard to test, no queue support.

### Alternative 2: Redux State Machine
**Rejected**: Overkill for current scope, adds dependency complexity.

### Alternative 3: Event Sourcing
**Rejected**: Useful for audit trail but unnecessary for MVP.

## Trade-offs

| Pro | Con |
|-----|-----|
| Explicit state transitions | More complex than boolean flags |
| Testable state machine | Requires state validation logic |
| Supports queue strategy | Queue adds persistence complexity |
| Clear error recovery paths | More states to handle in UI |

## Consequences

### Positive
- Predictable behavior under all conditions
- Clear recovery paths for errors
- Extensible for future states (e.g., `ANALYZING`, `MEMORY_UPDATE`)
- Testable without mocking async operations

### Negative
- Requires state validation on every transition
- UI must handle all states
- Queue persistence adds AsyncStorage I/O

## References

- EF-58: Queue implementation
- EF-59: Session persistence
- EF-38: Refresh recovery
