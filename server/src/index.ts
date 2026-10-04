import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { recognizeEmotion, recognizeEvent } from './flows/recognizer';
import type { EmotionTag, EventTag } from './flows/frontFlows';
import { detectUserState, extractKeywords } from './flows/stateDetector';
import { buildFrontFlowText } from './flows/frontFlowTemplates';
import { extractSignal } from './flows/signalExtractor';
import { neuralManager } from './flows/neuralProfileManager';
import type { NeuralProfile } from './flows/neuralProfileManager';
import {
  generateReactionTimeline,
  generateCompanionTimeline,
} from './flows/localReactionEngine';
import { analyzeFlow, recordChange, getChangeBlock, getChangeTrends } from './flows/index';
import type { FlowResult, FlowContext, FlowContextType, FlowContextStage, FlowContextRisk } from './flows/flowTypes';
import { loadProfile, generateLTUSummary, updateProfile } from './flows/longTermUnderstanding';
import { adjustWeights, getDefaultWeights, logWeightChange } from './flows/personalityEvolution';
import type { ResponseWeights } from './flows/evolutionTypes';
import { buildDeepSystemPrompt } from './flows/deepSystemPromptBuilder';
import { validateEf41DeepOutput } from './flows/ef41DeepCompositionValidator';
import { incrementConversationTurn, incrementConversationTurnIdempotent, getConversationTurn } from './flows/conversationTurns';
import conversationsRouter from './routes/conversations';
import anonymousSessionsRouter from './routes/anonymousSessions';
import {
  EF235_IDENTITY_WRITE_PROBE_PATH,
  ef235IdentityWriteProbeHandler,
} from './diagnostics/ef235IdentityWriteProbe';
import {
  EF235_IDENTITY_SCHEMA_REPAIR_PATH,
  ef235IdentitySchemaRepairHandler,
} from './diagnostics/ef235IdentitySchemaRepair';
import {
  EF235_IDENTITY_RUNTIME_CLASSIFICATION_PATH,
  ef235IdentityRuntimeClassificationHandler,
} from './diagnostics/ef235IdentityRuntimeClassification';
import {
  authenticateAnonymousRequest,
  EF75_WEB_ORIGIN,
  hasOwnerBindingRuntime,
  sendAnonymousFailure,
  verifyOwnedConversation,
} from './security/anonymousSession';
import { registerRuntimeOwnerBindingStore } from './storage/database/rds-owner-binding-store';
import { mapSafeStreamError, serializeStreamEvent, TurnEventSequencer } from './contracts/streamEvents';
import type { StreamEventType, StreamPayloadByType } from './contracts/streamEvents';
import { EF45_R2_PROBE_MARKER, writeEf118RuntimeAudit } from './observability/ef118RuntimeAudit';
import {
  ef45CategoryReader,
  isFixedEf45SyntheticProbe,
} from './observability/ef45CategoryReader';
import {
  bindEf45OneShotDiagnosticMarker,
  ef45OneShotDiagnosticArm,
  ef45OneShotDiagnosticFrontendTerminal,
  ef45OneShotDiagnosticReader,
  knownEf45OneShotDiagnosticMarker,
  markerForEf45OneShotDiagnosticSession,
  recordEf45OneShotDiagnosticCategory,
} from './observability/ef45OneShotDiagnostic';

// 调试：打印环境变量
console.log('DASHSCOPE_API_KEY:', process.env.DASHSCOPE_API_KEY ? 'SET' : 'NOT SET');
console.log('DASHSCOPE_API_KEY_DEEP:', process.env.DASHSCOPE_API_KEY_DEEP ? 'SET' : 'NOT SET');

export const app = express();
const port = process.env.PORT || 9091;

// The registration performs configuration validation only; the pool remains
// lazy and no database operation is issued during application startup.
registerRuntimeOwnerBindingStore();

// Middleware
app.use(cors({
  origin: (origin, callback) => callback(null, origin === EF75_WEB_ORIGIN),
  credentials: true,
  methods: ['GET', 'POST', 'HEAD', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-EF-CSRF', 'X-EF-Client', 'X-EF45-One-Shot-Marker'],
  exposedHeaders: ['X-EF45-One-Shot-Marker'],
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ============================================================
// 版本信息（构建时注入）
// ============================================================
const VERSION_INFO = {
  env: process.env.NODE_ENV || 'development',
  version: process.env.APP_VERSION || 'v2.1.2',
  gitCommit: process.env.GIT_COMMIT || '55dcaed',
  buildTime: process.env.BUILD_TIME || new Date().toISOString(),
  apiVersion: 'v1',
};

// ============================================================
// 健康检查 & 版本信息
// ============================================================
app.get('/api/v1/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/v1/version', (_req, res) => {
  res.json(VERSION_INFO);
});

// Fixed DEV-only host diagnostic. The handler accepts only a loopback,
// parameter-free request and returns a closed category receipt.
if (process.env.NODE_ENV === 'development') {
  app.post(EF235_IDENTITY_WRITE_PROBE_PATH, ef235IdentityWriteProbeHandler);
  app.post(EF235_IDENTITY_SCHEMA_REPAIR_PATH, ef235IdentitySchemaRepairHandler);
  app.post(EF235_IDENTITY_RUNTIME_CLASSIFICATION_PATH, ef235IdentityRuntimeClassificationHandler);
}

// Fixed DEV-only EF-45 diagnostic response. There are no caller-controlled
// filters, audit identifiers, or file locations.
app.get('/api/v1/diagnostics/ef45-category', ef45CategoryReader);
app.post('/api/v1/diagnostics/ef45-one-shot/arm', ef45OneShotDiagnosticArm);
app.get('/api/v1/diagnostics/ef45-one-shot', ef45OneShotDiagnosticReader);
app.post('/api/v1/diagnostics/ef45-one-shot/frontend-terminal', ef45OneShotDiagnosticFrontendTerminal);

// ============================================================
// EF-59: Conversation Persistence API
// ============================================================
app.use('/api/v1/anonymous-sessions', anonymousSessionsRouter);
app.use('/api/v1/conversations', conversationsRouter);

// ============================================================
// 环境变量
// ============================================================
const DASHSCOPE_BASE_URL = process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const API_KEY_LIGHT = process.env.DASHSCOPE_API_KEY || process.env.DASHSCOPE_API_KEY_LIGHT;
const API_KEY_DEEP = process.env.DASHSCOPE_API_KEY_DEEP;
