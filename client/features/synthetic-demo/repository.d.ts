export const STORAGE_KEY: string;
export const DEMO_NUMBER: string;
export const CHAT_INPUT: string;
export const CANDIDATE: string;
export const PATTERN_ID: string;
export const PRACTICE_ID: string;
export const PRACTICE_TEXT: string;
export type Decision = 'candidate' | 'confirmed' | 'uncertain' | 'rejected';
export type JourneySource = 'synthetic' | 'dev-api-test';
export interface DevUnderstandingOrigin { input: string; requestId: string }
export interface Pattern { schemaVersion: 1; demoSource: JourneySource; origin?: DevUnderstandingOrigin; accountId: string; patternId: string; name: string; currentUnderstanding: string; decision: Decision; clues: []; version: number; createdAt: string; updatedAt: string }
export interface Practice { demoSource?: JourneySource; origin?: DevUnderstandingOrigin; accountId: string; patternId: string; practiceId: string; name: string; ifCue: string; thenAction: string; confirmed: true; paused: boolean; version: number }
export interface RecordPayload { occurred: boolean; action: 'agreed' | 'other' | 'none' | null; feeling: 'helped' | 'unchanged' | 'worse' | 'not_recorded' | null; note?: string }
export interface PracticeRecord extends RecordPayload { schemaVersion: 1; demoSource: JourneySource; accountId: string; patternId: string; practiceId: string; practiceVersion: number; recordId: string; operationId: string; createdAt: string }
export interface PathEntry { schemaVersion: 1; demoSource: JourneySource; origin?: DevUnderstandingOrigin; accountId: string; patternId: string; entryId: string; type: 'event' | 'correction' | 'practice' | 'exception'; fact: string; source: string; userConfirmed: true; linked: boolean; version: number; createdAt: string; recordId?: string; oldUnderstanding?: string; currentUnderstanding?: string; explanation?: string; feeling?: string }
export interface Snapshot { schemaVersion: 1; revision: number; accountId: string | null; session: string | null; pattern: Pattern | null; practice: Practice | null; records: PracticeRecord[]; path: PathEntry[] }
export interface SyncStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface DemoRepository {
 snapshot(): Snapshot;
 /** Discard the pending login challenge on cancel/navigation; never writes storage. */
 cancelCode(): void;
 requestCode(number: string): string;
 login(code: string): Snapshot;
 logout(): Snapshot;
 confirmPattern(text: string): Snapshot;
 /** Local confirmation only; this does not attest an upstream provider/model. */
 confirmDevUnderstanding(payload: DevUnderstandingOrigin & { text: string; relation?: 'correct-current' }, expectedVersion: number): Snapshot;
 updatePattern(patch: Partial<Pick<Pattern, 'name' | 'currentUnderstanding' | 'decision'>>, expectedVersion: number): Snapshot;
 savePractice(patch: Pick<Practice, 'ifCue' | 'thenAction'>, expectedVersion: number): Snapshot;
 pausePractice(expectedVersion: number): Snapshot;
 saveRecord(payload: RecordPayload, expectedPracticeVersion: number, operationId: string): Snapshot;
 updatePath(entryId: string, patch: Partial<Pick<PathEntry, 'linked' | 'explanation' | 'feeling'>>, expectedVersion: number): Snapshot;
}
/** Synchronous, single-active-tab demo. Throws readable errors. Failed writes leave saved state unchanged. */
export function createDemoRepository(storage: SyncStorage, options?: { now?: () => number; random?: () => number }): DemoRepository;
