# ADR-013: Smart Fox First Response Strategy

**Status**: Accepted  
**Date**: 2024  
**Jira**: EF-61, EF-57  

## Context

Smart Fox (聪明狐狸, `clever-fox`) is EmotionFlow's primary AI companion persona. The first response experience is critical for user engagement and trust. The initial implementation used generic first-round templates that suppressed Smart Fox's distinctive personality.

## Decision

Adopt the **"Receive → Reflect → Invite"** principle for Smart Fox's first response strategy.

### Core Principle

```
Receive → Reflect → Invite
```

| Step | Description | Example |
|------|-------------|---------|
| **Receive** | Acknowledge user's specific content | "你说的「加班到很晚」，我听到了。" |
| **Reflect** | Mirror back the emotional tone | "听起来挺累的。" |
| **Invite** | Open a gentle question | "能多说说吗？" |

### Anti-Pattern (Avoid)

```
Analyze → Explain → Fix
```

| Step | Description | Why Avoid |
|------|-------------|-----------|
| **Analyze** | Show thinking process | Breaks trust, feels clinical |
| **Explain** | Give psychological interpretation | Premature, user not ready |
| **Fix** | Offer solutions/advice | User didn't ask for help |

## First Two Rounds Rules

### Must Follow
1. Respond to user's specific content and emotion first
2. Be like a real person listening carefully
3. Ask at most one natural question per turn
4. Keep responses short, natural, conversational

### Explicitly Forbidden
- ❌ Visible analysis process ("I notice your thinking pattern is...")
- ❌ Unconfirmed deep psychological conclusions ("The reason you feel this way is...")
- ❌ Unsolicited tasks, exercises, or action suggestions ("You could try...")
- ❌ Psychological diagnoses

## Implementation

### Reaction Layer (0-8s)

```typescript
// server/src/flows/firstTwoRoundsReaction.ts
export function getFirstTwoRoundsReactionTimeline(
  signal: SignalExtraction,
  message: string
): TimelineSegment[] {
  const keyword = signal.keyword ?? message.slice(0, 8);
  
  return [
    { startAt: 0, endAt: 2000, text: '嗯。' },
    { startAt: 2000, endAt: 4000, text: `「${keyword}」这件事，你提到了。` },
    { startAt: 4000, endAt: 6000, text: '我在听。' },
    { startAt: 6000, endAt: 8000, text: '不急，慢慢说。' },
  ];
}
```

### Companion Layer (10-85s)

```typescript
export function getFirstTwoRoundsCompanionTimeline(
  signal: SignalExtraction,
  message: string
): TimelineSegment[] {
  const keyword = signal.keyword ?? '这件事';
  const emotion = signal.feelingHint ?? '你说的';
  
  return [
    { startAt: 10000, endAt: 20000, text: `你说的「${keyword}」，我记住了。` },
    { startAt: 20000, endAt: 32000, text: `${emotion}。` },
    // ... more segments
  ];
}
```

### Deep Prompt Injection

```typescript
// server/src/flows/firstTwoRoundsRules.ts
export const FIRST_TWO_ROUNDS_RULES = `
## 【高优先级】前两轮对话行为覆盖规则

当前是用户与你的第 {userTurn} 轮对话（前两轮）。

### 必须遵守
1. 先回应用户刚刚表达的具体内容和情绪
2. 像一个真实的人在认真听
3. 每次最多自然地提出一个问题
4. 保持简短、自然、口语化

### 明确禁止
- ❌ 不展示可见的分析过程
- ❌ 不给出未经确认的深层心理结论
- ❌ 不提供用户未要求的任务、练习或行动建议
- ❌ 不下心理诊断
`;
```

## Smart Fox Personality (Preserved)

Despite restraint rules, Smart Fox's core personality is maintained:

| Trait | Expression in First Response |
|-------|------------------------------|
| 敏锐但克制 | Acknowledges specifically, doesn't over-analyze |
| 梳理混乱 | References user's words, helps them see structure |
| 不说教 | Uses "我们看看" instead of "你应该" |
| 陪伴优先 | "我陪你看看" over "让我帮你解决" |

## Alternatives Considered

### Alternative 1: Full Analysis from Round 1
**Rejected**:
- Overwhelming for new users
- Breaks trust before established
- Feels clinical/robotic

### Alternative 2: Generic Empathy Only
**Rejected**:
- Loses Smart Fox's distinctive personality
- No differentiation from other personas
- Users can't identify the companion

### Alternative 3: No Special First Round Rules
**Rejected**:
- LLM tends to over-analyze in early rounds
- Users feel "diagnosed" before being heard
- Violates therapeutic best practices

## Trade-offs

| Pro | Con |
|-----|-----|
| Natural first impression | Less "impressive" initially |
| Builds trust gradually | May feel slow for power users |
| Therapeutically sound | Requires careful prompt engineering |
| Persona preserved | Template maintenance overhead |

## Consequences

### Positive
- Users feel heard before being analyzed
- Trust builds naturally over conversation
- Smart Fox's personality shines through restraint
- Aligns with therapeutic best practices

### Negative
- First response may feel "simple"
- Requires careful balance in template design
- LLM may still slip into analysis mode

## Testing

| Scenario | Expected |
|----------|----------|
| First message, no keywords | Generic acknowledgment |
| First message with emotion | Emotion reflected back |
| First message with event | Event acknowledged specifically |
| Second message | Continues restraint pattern |
| Third message | Normal deep analysis resumes |

## References

- EF-57: Smart Fox First Response Experience
- ADR-012: Response Layer Architecture
- ADR-010: Conversation State Machine
