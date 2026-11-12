export const STORAGE_KEY: string;
export const LEGACY_STORAGE_KEY: string;
export const DEMO_NUMBER: string;
export const CHAT_INPUT: string;
export const CANDIDATE: string;
/** Historical v1 identities, retained unchanged during migration. New patterns receive new IDs. */
export const PATTERN_ID: string;
export const PRACTICE_ID: string;
export const PRACTICE_TEXT: string;
export type Decision = 'candidate' | 'confirmed' | 'uncertain' | 'rejected';
export type JourneySource = 'synthetic' | 'dev-api-test';
export interface DevUnderstandingOrigin { input: string; requestId: string }
export interface PatternClue { schemaVersion: 1; demoSource: JourneySource; origin?: DevUnderstandingOrigin; accountId: string; patternId: string; clueId: string; kind: 'situation' | 'thought' | 'feeling' | 'behavior' | 'exception'; fact: string; source?: string | null; userConfirmed?: boolean | null }
export interface Pattern { schemaVersion: 1; demoSource: JourneySource; origin?: DevUnderstandingOrigin; accountId: string; patternId: string; name: string; currentUnderstanding: string; decision: Decision; clues: PatternClue[]; version: number; createdAt: string; updatedAt: string }
/** Independent practice suggestion provenance; never inferred from the pattern understanding origin. */
export interface PracticeCandidateOrigin { kind: 'ai-suggestion'; sessionId: string; devConversationId: string; requestId: string }
export interface Practice { candidateOrigin?: PracticeCandidateOrigin; demoSource?: JourneySource; origin?: DevUnderstandingOrigin; accountId: string; patternId: string; practiceId: string; name: string; ifCue: string; thenAction: string; confirmed: true; paused: boolean; version: number }
export interface RecordPayload { occurred: boolean; action: 'agreed' | 'other' | 'none' | null; feeling: 'helped' | 'unchanged' | 'worse' | 'not_recorded' | null; note?: string }
/** Exact confirmed practice text captured by the repository when the record is first saved. Absent on older records. */
export interface PracticeSnapshot { ifCue: string; thenAction: string }
export interface PracticeRecord extends RecordPayload { practiceSnapshot?: PracticeSnapshot; schemaVersion: 1; demoSource: JourneySource; accountId: string; patternId: string; practiceId: string; practiceVersion: number; recordId: string; operationId: string; createdAt: string }
export interface PathEntry { schemaVersion: 1; demoSource: JourneySource; origin?: DevUnderstandingOrigin; accountId: string; patternId: string; entryId: string; type: 'event' | 'correction' | 'practice' | 'exception'; fact: string; source: string; userConfirmed: true; linked: boolean; version: number; createdAt: string; recordId?: string; oldUnderstanding?: string; currentUnderstanding?: string; explanation?: string; feeling?: string }
export interface PatternState { pattern: Pattern; practice: Practice | null; records: PracticeRecord[]; path: PathEntry[] }
export interface Snapshot { schemaVersion: 2; revision: number; accountId: string | null; session: string | null; patterns: PatternState[]; activePracticePatternId: string | null }
export interface SyncStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export function canSavePracticeSuggestionTarget(pattern: Pattern): boolean;
export interface DemoRepository {
 snapshot(): Snapshot;
 getPattern(accountId: string, patternId: string): PatternState;
 /** Discard the pending login challenge on cancel/navigation; never writes storage. */
 cancelCode(): void;
 requestCode(number: string): string;
 login(code: string): Snapshot;
 logout(): Snapshot;
 /** Explicitly creates a new, locally confirmed synthetic pattern. Never edits an existing one. */
 createPattern(accountId: string, text: string): Snapshot;
 /** Local confirmation only; this does not attest an upstream provider/model. Creation requires version 0 and no patternId; correction requires the selected patternId and its current version. */
 confirmDevUnderstanding(accountId: string, payload: DevUnderstandingOrigin & { text: string; relation: 'create-new' | 'correct-current' }, expectedVersion: number, patternId?: string): Snapshot;
 /** Save edited discovery text without endorsing it. New content is candidate; changed confirmed content becomes candidate. Rejected/uncertain judgments are preserved. */
 saveDevDiscovery(accountId: string, payload: DevUnderstandingOrigin & { text: string; relation: 'create-new' | 'correct-current' }, expectedVersion: number, patternId?: string): Snapshot;
 /** Without explicit decision, materially changed confirmed text becomes candidate; rejected/uncertain stay. Name-only or unchanged text keeps judgment. Explicit decision applies to supplied text. */
 updatePattern(accountId: string, patternId: string, patch: Partial<Pick<Pattern, 'name' | 'currentUnderstanding' | 'decision'>>, expectedVersion: number): Snapshot;
 /** New practices are saved paused. Edits preserve this practice's activation state and never modify another practice. */
 savePractice(accountId: string, patternId: string, patch: Pick<Practice, 'ifCue' | 'thenAction'> & { candidateOrigin?: PracticeCandidateOrigin }, expectedVersion: number): Snapshot;
 pausePractice(accountId: string, patternId: string, expectedVersion: number): Snapshot;
 /** Fails if another pattern's practice is active. Pause it explicitly before activating this one. */
 activatePractice(accountId: string, patternId: string, expectedVersion: number): Snapshot;
 saveRecord(accountId: string, patternId: string, payload: RecordPayload, expectedPracticeVersion: number, operationId: string): Snapshot;
 updatePath(accountId: string, patternId: string, entryId: string, patch: Partial<Pick<PathEntry, 'linked' | 'explanation' | 'feeling'>>, expectedVersion: number): Snapshot;
}
/** Synchronous, single-active-tab demo. Migrates v1 on the first successful write only, retaining v1 unchanged. Failed writes preserve saved state. V1 changes after migration fail closed. LocalStorage is not a cross-tab lock/CAS; rollback requires preserving v2. */
export function createDemoRepository(storage: SyncStorage, options?: { now?: () => number; random?: () => number }): DemoRepository;
