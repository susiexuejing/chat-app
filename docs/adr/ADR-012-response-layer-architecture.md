# ADR-012: Response Layer Architecture

**Status**: Accepted  
**Date**: 2024  
**Jira**: EF-61  

## Context

EmotionFlow's AI response system involves multiple layers of processing: immediate reaction, companion presence, and deep analysis. The architecture must balance responsiveness (instant feedback) with depth (meaningful AI response).

## Decision

Implement a **three-layer response architecture** where:
1. Backend generates all response layers
2. Frontend consumes response events
3. Frontend does NOT compose AI logic

### Response Layers

```
User sends message
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Reaction (0-8s)                                   │
│  ─────────────────────────────                              │
│  Purpose: Immediate acknowledgment                            │
│  Source: Local engine (zero LLM dependency)                 │
│  Content: Short, natural responses                          │
│  Timeline: [0s, 2s, 4s, 6s, 8s] segments                   │
│                                                             │
│  Example: "嗯。", "这句话有东西。", "你说的我听到了。"        │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: Companion (10-85s)                                │
│  ─────────────────────────────                              │
│  Purpose: Sustained presence during deep processing         │
│  Source: Local engine (template-based)                      │
│  Content: Longer, reflective statements                     │
│  Timeline: [10s, 20s, 32s, 45s, 58s, 72s, 85s]             │
│                                                             │
│  Example: "我陪你看看。", "不急，我们慢慢理。"                │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: Deep Response (3s buffer → streaming)             │
│  ────────────────────────────────────────                   │
│  Purpose: Meaningful AI analysis and response               │
│  Source: LLM (DashScope qwen-max)                           │
│  Content: Full conversational response                      │
│  Delivery: SSE stream after deepReadyAt                     │
│                                                             │
│  Example: "你说的这些，我听到了。能多说说那件事吗？"          │
└─────────────────────────────────────────────────────────────┘
```

## Layer Responsibilities

### Reaction Layer
- **Timing**: 0-8 seconds
- **Source**: `localReactionEngine.ts` + `personalityEngine.ts`
- **Logic**: Signal extraction → template matching → personality adjustment
- **Zero LLM**: Deterministic, instant response
- **Purpose**: User feels heard immediately

### Companion Layer
- **Timing**: 10-85 seconds (overlaps with deep generation)
- **Source**: Same local engine, different templates
- **Logic**: Same signal-based matching, companion-focused templates
- **Purpose**: Maintains presence while deep response generates

### Deep Response Layer
- **Timing**: Starts after 3s buffer, streams to completion
- **Source**: LLM via DashScope API
- **Logic**: Full system prompt + conversation history + memory
- **Purpose**: Delivers meaningful AI response

## Frontend Consumption Model

### What Frontend Receives

```typescript
// From chatStart response
{
  sessionId: string,
  reactionTimeline: TimelineSegment[],  // Pre-computed
  companionTimeline: TimelineSegment[], // Pre-computed
  deepReadyAt: number,                  // Timestamp
  flowContext: FlowContext              // Analysis data
}

// From SSE stream (chatStream)
{
  type: 'text' | 'thinking' | 'deep_analysis' | 'memory_update' | 'done',
  data: string | object
}
```

### What Frontend Does
```
✅ Consumes timeline segments for typing effect
✅ Renders streamed text incrementally
✅ Updates UI state based on events
✅ Handles error/retry scenarios

❌ Does NOT generate AI content
❌ Does NOT modify system prompts
❌ Does NOT compose response logic
❌ Does NOT perform signal extraction
```

## Event Types

| Event | Source | Frontend Action |
|-------|--------|-----------------|
| `reaction` | Local engine | Render typing effect |
| `companion` | Local engine | Render typing effect |
| `text` | SSE stream | Append to message |
| `thinking` | SSE stream | Show thinking indicator |
| `deep_analysis` | SSE stream | Store analysis data |
| `memory_update` | SSE stream | Update memory state |
| `done` | SSE stream | Mark message complete |

## Alternatives Considered

### Alternative 1: Single-layer Response
**Rejected**:
- Long wait time before any feedback
- Poor user experience (feels like "loading")
- No sense of presence during generation

### Alternative 2: Frontend-composed Response
**Rejected**:
- Frontend should not contain AI logic
- Harder to test and maintain
- Breaks separation of concerns
- Difficult to iterate on AI behavior

### Alternative 3: WebSocket Instead of SSE
**Rejected**:
- SSE is simpler for unidirectional streaming
- Better browser compatibility
- Easier to debug (HTTP-based)
- Sufficient for current use case

## Trade-offs

| Pro | Con |
|-----|-----|
| Instant user feedback | Complex timeline coordination |
| Clear separation of concerns | Multiple data sources to manage |
| Testable layers independently | Timeline synchronization bugs possible |
| Flexible response composition | More code to maintain |

## Consequences

### Positive
- Users feel heard immediately (0-2s)
- Presence maintained during AI processing (10-85s)
- Deep response can be iterated independently
- Frontend remains a pure consumer

### Negative
- Timeline coordination complexity
- Potential for timeline desync
- More state to manage in ChatContext

## Implementation Notes

### Backend Timeline Generation
```typescript
// server/src/flows/localReactionEngine.ts
export function generateReactionTimeline(
  signal: SignalExtraction,
  message: string,
  roleId: string,
  userTurn: number
): TimelineSegment[] {
  // First 2 rounds: use firstTwoRoundsReaction.ts
  // Subsequent rounds: use personality-based templates
}
```

### Frontend Timeline Consumption
```typescript
// client/screens/chat/contexts/ChatContext.tsx
// Schedule typing effect based on timeline segments
const scheduleTypingEffect = (segments: TimelineSegment[]) => {
  segments.forEach((segment, index) => {
    setTimeout(() => {
      // Append segment.text to current message
    }, segment.startAt);
  });
};
```

## References

- EF-57: Smart Fox First Response Strategy
- ADR-013: Smart Fox First Response Strategy
- ADR-010: Conversation State Machine
