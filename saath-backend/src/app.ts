import express from 'express';
import type { AuthUser } from './types/domain.js';
import cors from 'cors'; import helmet from 'helmet'; import rateLimit from 'express-rate-limit'; import multer from 'multer';
import jwt from 'jsonwebtoken';
import { z } from 'zod'; import { randomUUID } from 'node:crypto';
import { corsOrigins, env } from './config/env.js'; import { store, id, supabase, supabaseSelect, supabaseInsert } from './db/store.js'; import { AppError, asyncRoute, fail, ok, requestId } from './utils/http.js'; import { normalizeEmail, normalizePhone, notificationProvider, deliverToContact } from './services/notifications.js';
import { syncSurvivorNotifications } from './services/case-notifications.js';
import { generateEscalation, latestEscalation, getEscalatedMessage as getEscalatedReminder, nextEscalationStage } from './services/escalation.js'; import { requireAuth, requireRoles, signUser, type AuthedRequest } from './middleware/auth.js'; import { analyzeText, analyzeVoice, detectCrisisLanguage } from './services/ml.js'; import { respondToTaara } from './services/taara/index.js'; import { findEligibleCase, syncCaseStage } from './services/case/case.service.js';
import { trackCheckinCompletion, trackFollowUpResponse, computeEngagementTrend } from './services/engagement.js';
import { recomputeBaseline, generateDistressScore, generateRecoveryScore } from './services/distress-engine.js';
import { logCrisisEvent, updateCrisisEventOutcome, computeCrisisResponseMetrics, buildConversationLogEntry, minimize, MINIMIZATION_SCHEMA, type CrisisAuditEntry } from './services/audit-policy.js';
import { moderatePost } from './services/moderation.js';
import { computeDistressStatistics, computeRecoveryStatistics, computeOperationalMetrics, generateAdminReport, buildAdminAggregatePayload } from './services/admin-stats.js';
import { getScopedAdminDataset, resolveAdminScope } from './services/admin-scope.js';
import { rankInterventions, shouldEscalateToCounsellor, type InterventionOutcomeRecord } from './services/interventions.js';
import { getSupportRecommendations, getRecommendationsForRisk } from './services/recommendations.js';
import { generateSahayakReply } from './services/sahayak.js';
import { evaluateCheckInFreshness } from './services/checkin-freshness.js';

const app=express(); app.use(helmet()); app.use(cors({origin:(origin,cb)=>!origin||corsOrigins.includes(origin)?cb(null,true):cb(new Error('CORS denied'))})); app.use(express.json({limit:'1mb'})); app.use(requestId); app.use(rateLimit({windowMs:60_000,max:120,standardHeaders:true,legacyHeaders:false}));
const body=(schema:z.ZodTypeAny)=>(req:AuthedRequest,_res:express.Response,next:express.NextFunction)=>{const parsed=schema.safeParse(req.body); if(!parsed.success) return next(new AppError(400,'VALIDATION_ERROR','Request validation failed',parsed.error.flatten())); req.body=parsed.data; next();};
const record=(key:string,value:any)=>{const arr=store.records.get(key)||[]; arr.push(value); store.records.set(key,arr); return value;};
const ensureUserRecord=(user: { id: string; role: 'SURVIVOR'|'COUNSELLOR'|'DISTRICT_ADMIN'|'STATE_ADMIN'|'NATIONAL_ADMIN'; victimToken?: string; phone?: string; name?: string; district?: string; state?: string; }) => {
  const existing = store.users.get(user.id) ?? { ...user, createdAt: new Date().toISOString() };
  store.users.set(user.id, existing);
  return existing;
};
const severityFromAlert = (source: string, crisis = false, requestedSupport = false) => {
  if (crisis || source === 'taara') return { priority: 'P1', severity: 'urgent' };
  if (requestedSupport) return { priority: 'P2', severity: 'support_request' };
  return { priority: 'P3', severity: 'watch' };
};
const recordAlert = (payload: { victimToken?: string; caseReference?: string; reason: string; source?: string; priority?: string; severity?: string; crisis?: boolean; requestedSupport?: boolean; channel?: string; status?: string; confidence?: number; metadata?: Record<string, unknown> }) => {
  const now = new Date().toISOString();
  const defaultSeverity = severityFromAlert(payload.source ?? 'manual', payload.crisis ?? false, payload.requestedSupport ?? false);
  const normalized = {
    ...payload,
    priority: payload.priority ?? defaultSeverity.priority,
    severity: payload.severity ?? defaultSeverity.severity,
    status: payload.status ?? 'NEW',
    createdAt: now,
    updatedAt: now,
    count: 1,
  };
  const existing = (store.records.get('alerts:all') || []).find((alert: any) => {
    if (!alert || !payload.victimToken) return false;
    const sameVictim = alert.victimToken === payload.victimToken;
    const sameReason = alert.reason === payload.reason;
    const withinWindow = Date.now() - new Date(alert.createdAt).getTime() < 15 * 60 * 1000;
    return sameVictim && sameReason && withinWindow && ['NEW','ACKNOWLEDGED','ASSIGNED'].includes(alert.status);
  });
  if (existing) {
    existing.count = (existing.count ?? 1) + 1;
    existing.priority = existing.priority || normalized.priority;
    existing.severity = existing.severity || normalized.severity;
    existing.updatedAt = now;
    existing.lastTriggeredAt = now;
    existing.confidence = payload.confidence ?? existing.confidence;
    existing.occurrenceCount = (existing.occurrenceCount ?? existing.count ?? 1) + 1;
    existing.count = existing.occurrenceCount;
    existing.lastSeenAt = now;
    record('audit:alerts', { id: id(), alertId: existing.id, action: 'alert_updated', actor: 'system', details: { reason: 'deduplicated equivalent alert' }, createdAt: now });
    return existing;
  }
  const created = record('alerts:all', { id: id(), ...normalized, caseReference: payload.caseReference ?? payload.victimToken, victimToken: payload.victimToken ?? payload.caseReference, createdAt: now, updatedAt: now });
  record('audit:alerts', { id: id(), alertId: created.id, action: 'alert_created', actor: 'system', details: { source: payload.source ?? 'manual' }, createdAt: now });
  if (payload.crisis) {
    // N08 — every crisis-triggering alert gets its own audit trail entry, kept separate
    // from the generic alerts:all audit so it can be retained longer (see RETENTION_POLICY_DAYS).
    notifySafeCircleOnCrisis(payload.victimToken, created.id).catch(() => {});
    logCrisisEvent(record, id, { alertId: created.id, victimToken: payload.victimToken, source: (payload.source as CrisisAuditEntry['source']) ?? 'manual' });
  }
  return created;
};

/**
 * Evaluates real survivor check-in freshness across cases and flags counsellor attention items.
 * Deduplicates against any active/unresolved STALE_CHECKIN alert for that case.
 */
function evaluateStaleCheckInsForStore() {
  const allAlerts = store.records.get('alerts:all') || [];
  for (const c of store.cases) {
    if (!c.victimToken) continue;

    // Find linked user ID
    const linkedUser = [...store.users.entries()].find(([, user]) => user?.victimToken === c.victimToken)?.[0];
    const userKey = linkedUser ? `checkins:${linkedUser}` : `checkins:${c.victimToken}`;
    const directUserObservations = store.records.get(userKey) || [];
    const directTokenObservations = store.records.get(`checkins:${c.victimToken}`) || [];
    const allSurvivorCheckIns = [...directUserObservations, ...directTokenObservations].filter(Boolean);

    // Find latest REAL survivor check-in (never counsellor actions)
    let latestCheckInAt: string | null = null;
    for (const chk of allSurvivorCheckIns) {
      const ts = chk.createdAt ?? chk.timestamp;
      if (ts && (!latestCheckInAt || new Date(ts).getTime() > new Date(latestCheckInAt).getTime())) {
        latestCheckInAt = ts;
      }
    }

    const evaluation = evaluateCheckInFreshness({
      victimToken: c.victimToken,
      riskLevel: c.riskLevel,
      lastCheckInAt: latestCheckInAt,
    });

    if (evaluation.shouldFlagCounsellor) {
      // Check if there is already an unresolved STALE_CHECKIN alert for this victimToken
      const hasUnresolvedAlert = allAlerts.some((a: any) =>
        a &&
        a.victimToken === c.victimToken &&
        (a.source === 'stale_checkin' || a.metadata?.category === 'STALE_CHECKIN') &&
        ['NEW', 'ACKNOWLEDGED', 'ASSIGNED'].includes(a.status)
      );

      if (!hasUnresolvedAlert) {
        recordAlert({
          victimToken: c.victimToken,
          caseReference: c.docket ?? c.victimToken,
          reason: evaluation.reason,
          source: 'stale_checkin',
          priority: evaluation.priority ?? (evaluation.riskLevel === 'CRITICAL' ? 'P1' : evaluation.riskLevel === 'HIGH' ? 'P2' : 'P3'),
          severity: evaluation.riskLevel === 'CRITICAL' ? 'urgent' : evaluation.riskLevel === 'HIGH' ? 'support_request' : 'watch',
          crisis: evaluation.riskLevel === 'CRITICAL',
          requestedSupport: evaluation.riskLevel === 'HIGH',
          metadata: {
            category: 'STALE_CHECKIN',
            status: evaluation.status,
            riskLevel: evaluation.riskLevel,
            thresholdHours: evaluation.thresholdHours,
            elapsedHours: evaluation.elapsedHours,
            lastCheckInAt: evaluation.lastCheckInAt,
          },
        });
      }
    }
  }
}

/**
 * When a survivor submits a new valid check-in, naturally resolve non-critical STALE_CHECKIN alerts.
 * (Critical human-review alerts require conscious human acknowledgement/resolution per safety policy).
 */
function resolveStaleCheckInAlertOnNewCheckIn(victimToken?: string) {
  if (!victimToken) return;
  const allAlerts = store.records.get('alerts:all') || [];
  const now = new Date().toISOString();
  for (const alert of allAlerts) {
    if (
      alert &&
      alert.victimToken === victimToken &&
      (alert.source === 'stale_checkin' || alert.metadata?.category === 'STALE_CHECKIN') &&
      ['NEW', 'ACKNOWLEDGED', 'ASSIGNED'].includes(alert.status) &&
      !alert.crisis // Non-critical stale check-ins clear naturally
    ) {
      alert.status = 'RESOLVED';
      alert.updatedAt = now;
      alert.resolvedAt = now;
      record('audit:alerts', { id: id(), alertId: alert.id, action: 'resolved', actor: 'system', details: 'Auto-resolved after new valid survivor check-in.', createdAt: now });
    }
  }
}

const notifySafeCircleOnCrisis = async (victimToken: string | undefined, alertId: string) => {
  if (!victimToken) return;
  const userId = [...store.users.entries()].find(([, user]) => user?.victimToken === victimToken)?.[0];
  if (!userId) return;
  const contacts = (store.records.get(`safe:${userId}`) || []).filter((c: any) => c.consentToContact);
  const message = `This is a message from SAATH on behalf of your friend. They are going through a difficult moment — please reach out or be with them.`;
  for (const contact of contacts) {
    const results = await deliverToContact(contact, 'SAATH: your friend needs you', message);
    record('safe_circle_events', { id: id(), contactId: contact.id, victimToken, trigger: 'crisis_alert', alertId, auto: true, channels: results, createdAt: new Date().toISOString() });
  }
};
const recordAudit = (actor: string, action: string, target: string, details?: Record<string, unknown>) => record('audit:alerts', { id: id(), actor, action, target, details: details ?? {}, createdAt: new Date().toISOString() });

/**
 * H07 — Baseline update trigger. Called after every new check-in
 * observation (mood, text, voice, ivrs). Recomputes the baseline from
 * scratch off the full observation history each time — cheap at demo
 * scale, and it guarantees the baseline is never stale relative to the
 * observation that just triggered it.
 */
async function updateBaseline(userId: string) {
  const observations = store.records.get(`checkins:${userId}`) || [];
  const baseline = recomputeBaseline(observations);
  if (baseline) record(`baseline:${userId}`, baseline);
}

type ConsentType = 'wellbeing_monitoring'|'text_analysis'|'voice_analysis'|'behavioural_signals';
const activeConsent = (userId:string, type:ConsentType) => [...(store.records.get(`consent:${userId}`) || [])].reverse().find((item:any) => item.consentType === type)?.state === 'GRANTED';
const requireConsent = (type:ConsentType) => (req:AuthedRequest,_res:express.Response,next:express.NextFunction) => {
  const monitoring = store.records.get(`monitoring:${req.user!.id}`)?.at(-1);
  if (!activeConsent(req.user!.id, type) || monitoring?.state === 'paused' || monitoring?.state === 'stopped') return next(new AppError(403,'CONSENT_REQUIRED',`Active ${type} consent is required for this processing.`));
  next();
};
const requireMonitoringConsent=requireConsent('wellbeing_monitoring');
app.get('/',(_req,res)=>ok(res,{service:'saath-backend',status:'ok',api:'/api/v1',health:'/health'}));
app.get('/health',(_req,res)=>ok(res,{status:'ok',service:'saath-backend',dataMode:env.DATA_MODE,syntheticCaseAdapter:true}));
app.get('/health/dependencies',asyncRoute(async(_req,res)=>ok(res,{supabase:env.DATA_MODE==='supabase'?'configured':'not_configured',ml_service:env.ML_SERVICE_URL?'configured':'not_configured',notifications:'not_configured'})));
// Dev-only backdoor — kept for admin roles (district/state/national demo access),
// but COUNSELLOR is no longer issuable here: counsellors must authenticate via
// /api/v1/auth/counsellor-login against the real synthetic-counsellors roster.
app.post('/api/v1/auth/staff-token',body(z.object({
  role: z.enum(['DISTRICT_ADMIN','STATE_ADMIN','NATIONAL_ADMIN']),
  staffId: z.string().min(2),
  district: z.string().optional(),
  state: z.string().optional(),
})),asyncRoute(async(req,res)=>{
  if(env.NODE_ENV!=='test'&&!env.ALLOW_DEV_STAFF_TOKEN) throw new AppError(403,'STAFF_TOKEN_DISABLED','Development staff tokens are disabled.');
  const userPayload: AuthUser = {
    id: req.body.staffId,
    role: req.body.role,
    ...(req.body.district ? { district: req.body.district } : req.body.role === 'DISTRICT_ADMIN' ? { district: 'South Delhi' } : {}),
    ...(req.body.state ? { state: req.body.state } : req.body.role !== 'NATIONAL_ADMIN' ? { state: 'Delhi' } : {}),
  };
  const accessToken = signUser(userPayload);
  return ok(res, { accessToken, tokenType: 'Bearer', user: userPayload });
}));

app.get('/api/v1/admin/me', requireAuth, requireRoles('DISTRICT_ADMIN','STATE_ADMIN','NATIONAL_ADMIN'), asyncRoute(async(req: AuthedRequest, res) => {
  const scopeInfo = resolveAdminScope(req.user!);
  return ok(res, {
    id: req.user!.id,
    ...scopeInfo,
  });
}));

// Real counsellor login — verifies email + password against the
// synthetic-counsellors roster loaded into the store. The signed token's
// `id` is the counsellor_id (e.g. "C001"), which is exactly what each case's
// assignedCounsellorId is set to, so case-ownership checks line up directly.
app.post('/api/v1/auth/counsellor-login',body(z.object({email:z.string().email(),password:z.string().min(1)})),asyncRoute(async(req,res)=>{
  const email = req.body.email.trim().toLowerCase();
  const counsellor = store.counsellors.find((c) => c.email.toLowerCase() === email);
  if (!counsellor || counsellor.password !== req.body.password) throw new AppError(401,'INVALID_CREDENTIALS','Incorrect email or password.');
  if (counsellor.status && counsellor.status !== 'Active') throw new AppError(403,'ACCOUNT_INACTIVE','This counsellor account is not active.');
  counsellor.lastLogin = new Date().toISOString();
  const accessToken = signUser({ id: counsellor.id, role: 'COUNSELLOR', state: counsellor.state });
  const { password: _pw, ...safeCounsellor } = counsellor;
  return ok(res, { accessToken, tokenType: 'Bearer', user: { id: counsellor.id, role: 'COUNSELLOR' }, counsellor: safeCounsellor });
}));

app.get('/api/v1/counsellor/me',requireAuth,requireRoles('COUNSELLOR'),asyncRoute(async(req:AuthedRequest,res)=>{
  const counsellor = store.counsellors.find((c) => c.id === req.user!.id);
  if (!counsellor) throw new AppError(404,'COUNSELLOR_NOT_FOUND','Counsellor profile not found.');
  const assignedCases = store.cases.filter((c) => c.assignedCounsellorId === counsellor.id);
  const { password: _pw, ...safeCounsellor } = counsellor;
  return ok(res, { ...safeCounsellor, casesAssigned: assignedCases.length });
}));
const safeCase = (c: any) => minimize({ ...c, reference_id:c.docket, docket_id:c.docket, docket:c.docket, isSynthetic:true }, MINIMIZATION_SCHEMA.survivorCaseView);
// Resolves assignedCounsellorId → the actual counsellor record (name/specialisation/phone).
// Same logic as GET /api/v1/cases/:id — needed here too because connect-by-docket and
// /cases/verify previously returned the raw case (only assignedCounsellorId, no resolved
// counsellor object), so the survivor UI always showed "Counsellor not yet assigned"
// even when a counsellor WAS assigned in the data.
const withResolvedCounsellor = (c: any) => {
  const assignedCounsellor = c.assignedCounsellorId
    ? store.counsellors.find((x) => x.id === c.assignedCounsellorId)
    : undefined;
  return {
    ...c,
    assignedCounsellor: assignedCounsellor
      ? { name: assignedCounsellor.name, specialisation: assignedCounsellor.specialisation, phone: assignedCounsellor.phone }
      : null,
    supportRecommendations: getSupportRecommendations(c),
  };
};
const connectCaseByDocket = async (req: { body: { reference_id?: string; docket?: string } }, res: express.Response) => {
  const docket = (req.body.reference_id ?? req.body.docket ?? '').trim();
  const found = await findEligibleCase(docket);
  const user = { id: `docket-${found.id}`, role: 'SURVIVOR' as const, victimToken: found.victimToken, district: found.district, state: found.state };
  ensureUserRecord(user);
  const accessToken = signUser(user);
  record(`user:${user.id}:cases`, found.id);
  syncSurvivorNotifications(user.id, found, store);
  return ok(res, { case: safeCase(withResolvedCounsellor(found)), accessToken, tokenType: 'Bearer', user:{id:user.id,role:user.role,victimToken:user.victimToken} });
};
const caseReferenceSchema = z.object({ reference_id:z.string().min(3).optional(), docket:z.string().min(3).optional() }).refine(x=>Boolean(x.reference_id ?? x.docket), 'reference_id is required');
app.post('/api/v1/cases/connect-by-docket', body(caseReferenceSchema), asyncRoute(async (req, res) => connectCaseByDocket(req as any, res)));
app.post('/api/v1/cases/connect', body(caseReferenceSchema), asyncRoute(async (req, res) => connectCaseByDocket(req as any, res)));
app.post('/api/v1/cases/verify', body(caseReferenceSchema), asyncRoute(async (req,res)=>{ const docket=(req.body.reference_id??req.body.docket).trim(); const found=await findEligibleCase(docket); return ok(res,{eligible:true,case:safeCase(withResolvedCounsellor(found))}); }));
app.post('/api/v1/auth/refresh', asyncRoute(async (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required.');
  const decoded = jwt.verify(token, env.JWT_SECRET, { ignoreExpiration: true }) as any;
  const now = Date.now();
  const expiredAtMs = decoded?.exp ? decoded.exp * 1000 : now;
  if (decoded?.jti && store.blocklist.has(decoded.jti)) throw new AppError(401, 'TOKEN_REVOKED', 'This session has been logged out.');
  if (expiredAtMs && now > expiredAtMs + 60_000) throw new AppError(401, 'TOKEN_EXPIRED', 'The token is too old to refresh.');
  const refreshed = signUser({ id: decoded.id, role: decoded.role, victimToken: decoded.victimToken, district: decoded.district, state: decoded.state, jti: decoded.jti ?? randomUUID() });
  return ok(res, { accessToken: refreshed, tokenType: 'Bearer' });
}));
app.post('/api/v1/auth/logout', asyncRoute(async (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (token) {
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET, { ignoreExpiration: true }) as any;
      if (decoded?.jti) store.blocklist.add(decoded.jti);
    } catch { /* ignore invalid token */ }
  }
  return ok(res, { loggedOut: true, clientSideOnly: true, note: 'JWT logout is implemented as a local token blocklist; the frontend should also discard the token.' });
}));
app.get('/api/v1/cases/:id',requireAuth,asyncRoute(async(req:AuthedRequest,res)=>{
  const c=store.cases.find(x=>x.id===req.params.id||x.victimToken===req.params.id||x.docket===req.params.id); 
  if(!c) throw new AppError(404,'CASE_NOT_FOUND','Case not found.'); 
  if(req.user!.role==='SURVIVOR'&&req.user!.victimToken!==c.victimToken&&!(store.records.get(`user:${req.user!.id}:cases`)||[]).includes(c.id)) throw new AppError(403,'FORBIDDEN','You can only access your own case.'); 
  return ok(res, withResolvedCounsellor(c));
}));
app.get('/api/v1/cases/:id/escalation',requireAuth,requireRoles('COUNSELLOR','DISTRICT_ADMIN','STATE_ADMIN','NATIONAL_ADMIN'),asyncRoute(async(req,res)=>{
  const c=store.cases.find(x=>x.id===req.params.id||x.victimToken===req.params.id||x.docket===req.params.id);
  if(!c) throw new AppError(404,'CASE_NOT_FOUND','Case not found.');
  const linkedUser=[...store.users.entries()].find(([,user])=>user?.victimToken===c.victimToken)?.[0];
  const userEntry=linkedUser?`checkins:${linkedUser}`:[...store.records.entries()].find(([key,values])=>key.startsWith('checkins:')&&values.some((value:any)=>value.victimToken===c.victimToken))?.[0];
  const userId=userEntry?.replace('checkins:','') || linkedUser || c.victimToken;
  const existing = latestEscalation(userId);
  if (existing && existing.status === 'available') return ok(res, existing);
  return ok(res, await generateEscalation(userId, c.victimToken));
}));
function getObservationsForTarget(userId?: string, victimToken?: string, caseId?: string): any[] {
  const gathered: any[] = [];
  const seenIds = new Set<string>();

  const keysToTry: string[] = [];
  if (userId) keysToTry.push(`checkins:${userId}`);
  if (victimToken) keysToTry.push(`checkins:${victimToken}`);
  if (caseId) keysToTry.push(`checkins:${caseId}`);

  for (const key of keysToTry) {
    const list = store.records.get(key) || [];
    for (const item of list) {
      if (item && item.id && !seenIds.has(item.id)) {
        seenIds.add(item.id);
        gathered.push(item);
      }
    }
  }

  for (const [k, list] of store.records.entries()) {
    if (k.startsWith('checkins:')) {
      for (const item of list) {
        if (
          item &&
          item.id &&
          !seenIds.has(item.id) &&
          ((victimToken && item.victimToken === victimToken) || (caseId && item.caseId === caseId))
        ) {
          seenIds.add(item.id);
          gathered.push(item);
        }
      }
    }
  }

  return gathered.sort((a, b) => {
    const tA = new Date(a.createdAt || a.timestamp || 0).getTime();
    const tB = new Date(b.createdAt || b.timestamp || 0).getTime();
    return tA - tB;
  });
}

function computeMonitoringTrends(observations: any[], baselineRecord?: any | null) {
  const sorted = [...observations].sort((a, b) => {
    const tA = new Date(a.createdAt || a.timestamp || 0).getTime();
    const tB = new Date(b.createdAt || b.timestamp || 0).getTime();
    return tA - tB;
  });

  const distressTrend: Array<{ date: string; score: number }> = [];
  const recoveryTrend: Array<{ date: string; score: number }> = [];
  const records: any[] = [];

  for (const o of sorted) {
    const date = o.createdAt || o.timestamp || new Date().toISOString();
    const dScore = typeof o.ml?.distressScore === 'number'
      ? o.ml.distressScore
      : typeof o.distressScore === 'number'
        ? o.distressScore
        : typeof o.mood === 'number'
          ? Math.round(100 - o.mood * 20)
          : null;

    const rScore = typeof o.ml?.recoveryScore === 'number'
      ? o.ml.recoveryScore
      : typeof o.recoveryScore === 'number'
        ? o.recoveryScore
        : typeof o.mood === 'number'
          ? Math.round(o.mood * 20)
          : null;

    if (dScore !== null) {
      distressTrend.push({ date, score: dScore });
    }
    if (rScore !== null) {
      recoveryTrend.push({ date, score: rScore });
    }

    records.push({
      createdAt: date,
      timestamp: date,
      distressScore: dScore ?? 50,
      recoveryScore: rScore ?? 50,
      confidence: o.ml?.confidence ?? 0.8,
      contributingFactors: o.ml?.contributingFactors ?? [],
      indicators: o.ml?.indicators ?? [],
    });
  }

  if (distressTrend.length < 2) {
    const singleConf = sorted.length > 0 && typeof sorted[0].ml?.confidence === 'number' ? sorted[0].ml.confidence : 0;
    return {
      distressTrend,
      recoveryTrend,
      baselineComparison: 'insufficient evidence' as const,
      change: 0,
      confidence: Number(singleConf.toFixed(2)),
      recentObservations: sorted.slice(-5),
      records,
    };
  }

  const firstScore = distressTrend[0].score;
  const latestScore = distressTrend[distressTrend.length - 1].score;
  const change = latestScore - firstScore;

  let baselineComparison: 'improving' | 'stable' | 'worsening' | 'insufficient evidence' = 'stable';
  if (baselineRecord && typeof baselineRecord.mean === 'number') {
    const deviation = latestScore - baselineRecord.mean;
    if (deviation <= -8) baselineComparison = 'improving';
    else if (deviation >= 8) baselineComparison = 'worsening';
    else baselineComparison = 'stable';
  } else {
    if (change <= -8) baselineComparison = 'improving';
    else if (change >= 8) baselineComparison = 'worsening';
    else baselineComparison = 'stable';
  }

  const avgConfidence = sorted.reduce((acc, o) => acc + (typeof o.ml?.confidence === 'number' ? o.ml.confidence : 0.8), 0) / (sorted.length || 1);

  return {
    distressTrend,
    recoveryTrend,
    baselineComparison,
    change,
    confidence: Number(avgConfidence.toFixed(2)),
    recentObservations: sorted.slice(-5),
    records,
  };
}

const VALID_WORKFLOW_STATES = ['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED'] as const;
type WorkflowState = typeof VALID_WORKFLOW_STATES[number];

app.get('/api/v1/cases/:id/timeline', requireAuth, asyncRoute(async (req: AuthedRequest, res) => {
  const caseId = req.params.id;
  const caseRecord = store.cases.find(c => c.id === caseId || c.docket === caseId || c.victimToken === caseId);
  if (!caseRecord) throw new AppError(404, 'CASE_NOT_FOUND', 'Case not found.');

  const events: TimelineEvent[] = [];

  // Stored timeline events
  const storedEvents = store.timelines.filter(t => t.caseId === caseRecord.id || t.victimToken === caseRecord.victimToken);
  events.push(...storedEvents);

  // Registration & docket dates
  if (caseRecord.registrationDate && !events.some(e => e.label.includes('Case registered'))) {
    events.push({
      id: id(),
      caseId: caseRecord.id,
      date: caseRecord.registrationDate,
      type: 'case',
      label: 'Case registered with Support & Safety Registry',
    });
  }
  if (caseRecord.incidentDate && !events.some(e => e.label.includes('Incident date'))) {
    events.push({
      id: id(),
      caseId: caseRecord.id,
      date: caseRecord.incidentDate,
      type: 'case',
      label: 'Incident date recorded in docket',
    });
  }

  // Stage & FIR status
  if (caseRecord.firStatus === 'Registered' && !events.some(e => e.label.includes('FIR registered'))) {
    events.push({
      id: id(),
      caseId: caseRecord.id,
      date: caseRecord.registrationDate,
      type: 'legal',
      label: 'FIR registered with district police authorities',
    });
  }
  if (caseRecord.currentStage && !events.some(e => e.label.includes(`Stage: ${caseRecord.currentStage}`))) {
    events.push({
      id: id(),
      caseId: caseRecord.id,
      date: caseRecord.registrationDate,
      type: 'legal',
      label: `Current procedural stage: ${caseRecord.currentStage}`,
    });
  }

  // Hearing schedule
  if (caseRecord.nextHearingDate) {
    events.push({
      id: id(),
      caseId: caseRecord.id,
      date: caseRecord.nextHearingDate,
      type: 'legal',
      label: `Scheduled Court Hearing (${caseRecord.courtName || 'Special Fast Track Court'})`,
    });
  }

  // Real survivor check-ins
  const observations = getObservationsForTarget(undefined, caseRecord.victimToken, caseRecord.id);
  for (const obs of observations) {
    const dScore = typeof obs.ml?.distressScore === 'number' ? obs.ml.distressScore : obs.distressScore;
    events.push({
      id: obs.id || id(),
      caseId: caseRecord.id,
      date: obs.createdAt || obs.timestamp || new Date().toISOString(),
      type: 'checkin',
      label: `Survivor check-in (${obs.type || 'wellness'})${typeof dScore === 'number' ? ` — SVI distress: ${dScore}/100` : ''}`,
    });
  }

  // Case alerts
  const alerts = (store.records.get('alerts:all') || []).filter(
    (a: any) => a && (a.victimToken === caseRecord.victimToken || a.caseReference === caseRecord.docket)
  );
  for (const a of alerts) {
    events.push({
      id: a.id,
      caseId: caseRecord.id,
      date: a.createdAt,
      type: 'alert',
      label: `Alert [${a.priority || 'P3'}]: ${a.reason || 'Safety notification logged'}`,
    });
  }

  // Follow-ups
  const followUps = (store.records.get('follow_ups') || []).filter(
    (f: any) => f && (f.victimToken === caseRecord.victimToken || f.caseId === caseRecord.id || f.docket === caseRecord.docket)
  );
  for (const f of followUps) {
    events.push({
      id: f.id,
      caseId: caseRecord.id,
      date: f.date || f.createdAt,
      type: 'followup',
      label: `Counsellor follow-up session (${f.status || 'SCHEDULED'})`,
    });
  }

  const seenIds = new Set<string>();
  const uniqueEvents = events.filter(e => {
    if (!e || !e.id || seenIds.has(e.id)) return false;
    seenIds.add(e.id);
    return true;
  });

  uniqueEvents.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return ok(res, uniqueEvents);
}));

app.get('/api/v1/cases/:id/recommendations', requireAuth, asyncRoute(async (req: AuthedRequest, res) => {
  const caseId = req.params.id;
  const caseRecord = store.cases.find(c => c.id === caseId || c.docket === caseId || c.victimToken === caseId);
  if (!caseRecord) throw new AppError(404, 'CASE_NOT_FOUND', 'Case not found.');
  const supportRecommendations = getSupportRecommendations(caseRecord);
  return ok(res, {
    caseId: caseRecord.id,
    docket: caseRecord.docket,
    victimToken: caseRecord.victimToken,
    riskLevel: caseRecord.riskLevel ?? 'LOW',
    legalAidStatus: caseRecord.legalAidStatus,
    protectionStatus: caseRecord.protectionStatus,
    supportRecommendations,
  });
}));

app.get('/api/v1/cases/:id/freshness', requireAuth, requireRoles('COUNSELLOR','DISTRICT_ADMIN','STATE_ADMIN','NATIONAL_ADMIN'), asyncRoute(async (req: AuthedRequest, res) => {
  const caseId = req.params.id;
  const caseRecord = store.cases.find(c => c.id === caseId || c.docket === caseId || c.victimToken === caseId);
  if (!caseRecord) throw new AppError(404, 'CASE_NOT_FOUND', 'Case not found.');

  const linkedUser = [...store.users.entries()].find(([, user]) => user?.victimToken === caseRecord.victimToken)?.[0];
  const userKey = linkedUser ? `checkins:${linkedUser}` : `checkins:${caseRecord.victimToken}`;
  const directUserObservations = store.records.get(userKey) || [];
  const directTokenObservations = store.records.get(`checkins:${caseRecord.victimToken}`) || [];
  const allSurvivorCheckIns = [...directUserObservations, ...directTokenObservations].filter(Boolean);

  let lastCheckInAt: string | null = null;
  for (const chk of allSurvivorCheckIns) {
    const ts = chk.createdAt ?? chk.timestamp;
    if (ts && (!lastCheckInAt || new Date(ts).getTime() > new Date(lastCheckInAt).getTime())) {
      lastCheckInAt = ts;
    }
  }

  const evaluation = evaluateCheckInFreshness({
    victimToken: caseRecord.victimToken,
    riskLevel: caseRecord.riskLevel,
    lastCheckInAt,
  });

  return ok(res, {
    caseId: caseRecord.id,
    docket: caseRecord.docket,
    victimToken: caseRecord.victimToken,
    ...evaluation,
  });
}));

app.post('/api/v1/cases/:id/stage',requireAuth,requireRoles('COUNSELLOR','DISTRICT_ADMIN','STATE_ADMIN','NATIONAL_ADMIN'),body(z.object({stage:z.string().min(1)})),asyncRoute(async(req:AuthedRequest,res)=>{const caseId=String(req.params.id); const newStage=String(req.body.stage); const updated=await syncCaseStage(caseId,newStage); return ok(res,updated,200);}));

// Protection Request & Status Workflow
app.post('/api/v1/cases/:id/protection-request', requireAuth, body(z.object({
  reason: z.string().min(1).max(2000),
  priority: z.enum(['URGENT', 'HIGH', 'ROUTINE']).default('HIGH'),
  threatDetails: z.string().max(2000).optional(),
})), asyncRoute(async (req: AuthedRequest, res) => {
  const caseId = req.params.id;
  const caseRecord = store.cases.find(c => c.id === caseId || c.docket === caseId || c.victimToken === caseId);
  if (!caseRecord) throw new AppError(404, 'CASE_NOT_FOUND', 'Case not found.');

  const now = new Date().toISOString();
  const requestId = id();
  const newRequest = {
    id: requestId,
    caseId: caseRecord.id,
    docket: caseRecord.docket,
    victimToken: caseRecord.victimToken,
    type: 'PROTECTION',
    reason: req.body.reason,
    priority: req.body.priority,
    threatDetails: req.body.threatDetails,
    status: 'REQUESTED' as WorkflowState,
    requestedBy: req.user!.id,
    requestedRole: req.user!.role,
    history: [{ status: 'REQUESTED', changedBy: req.user!.id, timestamp: now, note: req.body.reason }],
    createdAt: now,
    updatedAt: now,
  };

  caseRecord.protectionStatus = 'REQUESTED';
  caseRecord.protectionRequested = true;
  record('protection:requests', newRequest);
  record(`protection:requests:${caseRecord.id}`, newRequest);

  store.timelines.push({
    id: id(),
    caseId: caseRecord.id,
    date: now,
    type: 'protection',
    label: `Witness protection requested (${req.body.priority} priority): ${req.body.reason.slice(0, 80)}`,
  });

  record('audit:cases', {
    id: id(),
    caseId: caseRecord.id,
    action: 'protection_requested',
    actor: req.user!.id,
    details: { reason: req.body.reason, priority: req.body.priority },
    createdAt: now,
  });

  return ok(res, newRequest, 201);
}));

app.post('/api/v1/cases/:id/relocation-request', requireAuth, body(z.object({
  reason: z.string().min(1).max(2000),
  priority: z.enum(['URGENT', 'HIGH', 'ROUTINE']).default('HIGH'),
  targetDistrict: z.string().max(100).optional(),
  targetState: z.string().max(100).optional(),
})), asyncRoute(async (req: AuthedRequest, res) => {
  const caseId = req.params.id;
  const caseRecord = store.cases.find(c => c.id === caseId || c.docket === caseId || c.victimToken === caseId);
  if (!caseRecord) throw new AppError(404, 'CASE_NOT_FOUND', 'Case not found.');

  const now = new Date().toISOString();
  const requestId = id();
  const newRequest = {
    id: requestId,
    caseId: caseRecord.id,
    docket: caseRecord.docket,
    victimToken: caseRecord.victimToken,
    type: 'RELOCATION',
    reason: req.body.reason,
    priority: req.body.priority,
    targetDistrict: req.body.targetDistrict,
    targetState: req.body.targetState,
    status: 'REQUESTED' as WorkflowState,
    requestedBy: req.user!.id,
    requestedRole: req.user!.role,
    history: [{ status: 'REQUESTED', changedBy: req.user!.id, timestamp: now, note: req.body.reason }],
    createdAt: now,
    updatedAt: now,
  };

  caseRecord.relocationStatus = 'REQUESTED';
  caseRecord.relocationRequested = true;
  record('relocation:requests', newRequest);
  record(`relocation:requests:${caseRecord.id}`, newRequest);

  store.timelines.push({
    id: id(),
    caseId: caseRecord.id,
    date: now,
    type: 'relocation',
    label: `Safe relocation requested (${req.body.priority} priority): ${req.body.reason.slice(0, 80)}`,
  });

  record('audit:cases', {
    id: id(),
    caseId: caseRecord.id,
    action: 'relocation_requested',
    actor: req.user!.id,
    details: { reason: req.body.reason, priority: req.body.priority },
    createdAt: now,
  });

  return ok(res, newRequest, 201);
}));

app.post('/api/v1/cases/:id/protection-status', requireAuth, requireRoles('COUNSELLOR', 'DISTRICT_ADMIN', 'STATE_ADMIN', 'NATIONAL_ADMIN'), body(z.object({
  status: z.enum(VALID_WORKFLOW_STATES),
  notes: z.string().max(2000).optional(),
  assignedOfficial: z.string().max(200).optional(),
  officialContact: z.string().max(100).optional(),
})), asyncRoute(async (req: AuthedRequest, res) => {
  const caseId = req.params.id;
  const caseRecord = store.cases.find(c => c.id === caseId || c.docket === caseId || c.victimToken === caseId);
  if (!caseRecord) throw new AppError(404, 'CASE_NOT_FOUND', 'Case not found.');

  const now = new Date().toISOString();
  const previousStatus = caseRecord.protectionStatus;
  caseRecord.protectionStatus = req.body.status;
  if (req.body.assignedOfficial) {
    caseRecord.protectionOfficerAssigned = req.body.assignedOfficial;
  }

  const allRequests = store.records.get(`protection:requests:${caseRecord.id}`) || store.records.get('protection:requests') || [];
  const latestReq = allRequests.find((r: any) => r.caseId === caseRecord.id || r.victimToken === caseRecord.victimToken);
  if (latestReq) {
    latestReq.status = req.body.status;
    latestReq.assignedOfficial = req.body.assignedOfficial ?? latestReq.assignedOfficial;
    latestReq.updatedAt = now;
    latestReq.history = latestReq.history || [];
    latestReq.history.push({
      status: req.body.status,
      changedBy: req.user!.id,
      role: req.user!.role,
      timestamp: now,
      note: req.body.notes ?? `Protection status updated from ${previousStatus} to ${req.body.status}`,
    });
  }

  store.timelines.push({
    id: id(),
    caseId: caseRecord.id,
    date: now,
    type: 'protection',
    label: `Protection status: ${req.body.status}${req.body.assignedOfficial ? ` (Official: ${req.body.assignedOfficial})` : ''}`,
  });

  record('audit:cases', {
    id: id(),
    caseId: caseRecord.id,
    action: 'protection_status_updated',
    actor: req.user!.id,
    details: { previousStatus, newStatus: req.body.status, notes: req.body.notes, assignedOfficial: req.body.assignedOfficial },
    createdAt: now,
  });

  return ok(res, {
    caseId: caseRecord.id,
    protectionStatus: caseRecord.protectionStatus,
    protectionOfficerAssigned: caseRecord.protectionOfficerAssigned,
    updatedAt: now,
    request: latestReq ?? null,
  });
}));

app.post('/api/v1/cases/:id/relocation-status', requireAuth, requireRoles('COUNSELLOR', 'DISTRICT_ADMIN', 'STATE_ADMIN', 'NATIONAL_ADMIN'), body(z.object({
  status: z.enum(VALID_WORKFLOW_STATES),
  notes: z.string().max(2000).optional(),
  assignedOfficial: z.string().max(200).optional(),
  targetSafeLocation: z.string().max(200).optional(),
})), asyncRoute(async (req: AuthedRequest, res) => {
  const caseId = req.params.id;
  const caseRecord = store.cases.find(c => c.id === caseId || c.docket === caseId || c.victimToken === caseId);
  if (!caseRecord) throw new AppError(404, 'CASE_NOT_FOUND', 'Case not found.');

  const now = new Date().toISOString();
  const previousStatus = caseRecord.relocationStatus;
  caseRecord.relocationStatus = req.body.status;

  const allRequests = store.records.get(`relocation:requests:${caseRecord.id}`) || store.records.get('relocation:requests') || [];
  const latestReq = allRequests.find((r: any) => r.caseId === caseRecord.id || r.victimToken === caseRecord.victimToken);
  if (latestReq) {
    latestReq.status = req.body.status;
    latestReq.assignedOfficial = req.body.assignedOfficial ?? latestReq.assignedOfficial;
    latestReq.targetSafeLocation = req.body.targetSafeLocation ?? latestReq.targetSafeLocation;
    latestReq.updatedAt = now;
    latestReq.history = latestReq.history || [];
    latestReq.history.push({
      status: req.body.status,
      changedBy: req.user!.id,
      role: req.user!.role,
      timestamp: now,
      note: req.body.notes ?? `Relocation status updated from ${previousStatus} to ${req.body.status}`,
    });
  }

  store.timelines.push({
    id: id(),
    caseId: caseRecord.id,
    date: now,
    type: 'relocation',
    label: `Relocation status: ${req.body.status}${req.body.assignedOfficial ? ` (Assigned: ${req.body.assignedOfficial})` : ''}`,
  });

  record('audit:cases', {
    id: id(),
    caseId: caseRecord.id,
    action: 'relocation_status_updated',
    actor: req.user!.id,
    details: { previousStatus, newStatus: req.body.status, notes: req.body.notes, assignedOfficial: req.body.assignedOfficial },
    createdAt: now,
  });

  return ok(res, {
    caseId: caseRecord.id,
    relocationStatus: caseRecord.relocationStatus,
    updatedAt: now,
    request: latestReq ?? null,
  });
}));

app.get('/api/v1/cases/:id/protection-requests', requireAuth, asyncRoute(async (req: AuthedRequest, res) => {
  const caseId = req.params.id;
  const caseRecord = store.cases.find(c => c.id === caseId || c.docket === caseId || c.victimToken === caseId);
  if (!caseRecord) throw new AppError(404, 'CASE_NOT_FOUND', 'Case not found.');
  const requests = (store.records.get(`protection:requests:${caseRecord.id}`) || store.records.get('protection:requests') || [])
    .filter((r: any) => r.caseId === caseRecord.id || r.victimToken === caseRecord.victimToken);
  return ok(res, requests);
}));

app.get('/api/v1/cases/:id/relocation-requests', requireAuth, asyncRoute(async (req: AuthedRequest, res) => {
  const caseId = req.params.id;
  const caseRecord = store.cases.find(c => c.id === caseId || c.docket === caseId || c.victimToken === caseId);
  if (!caseRecord) throw new AppError(404, 'CASE_NOT_FOUND', 'Case not found.');
  const requests = (store.records.get(`relocation:requests:${caseRecord.id}`) || store.records.get('relocation:requests') || [])
    .filter((r: any) => r.caseId === caseRecord.id || r.victimToken === caseRecord.victimToken);
  return ok(res, requests);
}));

const consentSchema=z.union([
  z.object({consent_type:z.enum(['wellbeing_monitoring','text_analysis','voice_analysis','behavioural_signals']),granted:z.boolean(),version:z.string().min(1).max(80).default('1.0')}),
  z.object({monitoring:z.boolean(),voice:z.boolean().default(false),text:z.boolean().default(false),behavioural:z.boolean().default(false),version:z.string().min(1).max(80).default('1.0')})
]);
app.post('/api/v1/consents',requireAuth,body(consentSchema),asyncRoute(async(req:AuthedRequest,res)=>{const now=new Date().toISOString(); const selections='consent_type' in req.body ? [{type:req.body.consent_type,granted:req.body.granted}] : [{type:'wellbeing_monitoring',granted:req.body.monitoring},{type:'text_analysis',granted:req.body.text},{type:'voice_analysis',granted:req.body.voice},{type:'behavioural_signals',granted:req.body.behavioural}]; const records=selections.map(({type,granted})=>record(`consent:${req.user!.id}`,{id:id(),userId:req.user!.id,consentType:type,consentVersion:req.body.version,state:granted?'GRANTED':'REVOKED',grantedAt:granted?now:null,revokedAt:granted?null:now,createdAt:now})); return ok(res,records,201)}));
app.get('/api/v1/consents',requireAuth,asyncRoute(async(req:AuthedRequest,res)=>ok(res,store.records.get(`consent:${req.user!.id}`)||[])));
// Automated Monitoring Scheduler
app.post('/api/v1/monitoring/process-due', requireAuth, asyncRoute(async (req: AuthedRequest, res) => {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const processedCases: any[] = [];
  const dueCases: any[] = [];
  const overdueCases: any[] = [];
  const remindersSent: any[] = [];

  for (const caseRecord of store.cases) {
    if (!caseRecord.victimToken) continue;

    const linkedUser = [...store.users.entries()].find(([, user]) => user?.victimToken === caseRecord.victimToken)?.[0];
    const targetUserId = linkedUser || `docket-${caseRecord.id}`;
    const observations = getObservationsForTarget(targetUserId, caseRecord.victimToken, caseRecord.id);

    let lastCheckInAt: string = caseRecord.registrationDate || nowIso;
    for (const obs of observations) {
      const ts = obs.createdAt || obs.timestamp;
      if (ts && new Date(ts).getTime() > new Date(lastCheckInAt).getTime()) {
        lastCheckInAt = ts;
      }
    }

    const daysSinceLastCheckin = Math.max(0, Math.floor((nowMs - new Date(lastCheckInAt).getTime()) / 86_400_000));

    let cadenceDays = 7;
    const freq = (caseRecord.followupFrequency || '').toLowerCase();
    const risk = caseRecord.riskLevel || 'LOW';
    if (freq.includes('daily') || risk === 'CRITICAL' || risk === 'HIGH') {
      cadenceDays = 1;
    } else if (freq.includes('3') || risk === 'MODERATE') {
      cadenceDays = 3;
    } else {
      cadenceDays = 7;
    }

    const isDue = daysSinceLastCheckin >= cadenceDays;
    const daysOverdue = Math.max(0, daysSinceLastCheckin - cadenceDays);

    const caseSummary = {
      caseId: caseRecord.id,
      docket: caseRecord.docket,
      victimToken: caseRecord.victimToken,
      riskLevel: risk,
      cadenceDays,
      daysSinceLastCheckin,
      lastCheckInAt,
      isDue,
      daysOverdue,
    };
    processedCases.push(caseSummary);

    if (isDue) {
      dueCases.push(caseSummary);
    }
    if (daysOverdue > 0) {
      overdueCases.push(caseSummary);
    }

    if (isDue) {
      const existingReminders = store.records.get(`notifications:reminders:${targetUserId}`) || [];
      const hasRecentReminder = existingReminders.some((r: any) => {
        const rTime = new Date(r.createdAt || 0).getTime();
        return nowMs - rTime < 24 * 60 * 60 * 1000;
      });

      if (!hasRecentReminder) {
        const escalated = nextEscalationStage(daysOverdue, existingReminders);
        const reminderRecord = record(`notifications:reminders:${targetUserId}`, {
          id: id(),
          type: 'checkin',
          caseId: caseRecord.id,
          victimToken: caseRecord.victimToken,
          daysSinceLastCheckin,
          daysOverdue,
          message: escalated.message,
          tone: escalated.tone,
          createdAt: nowIso,
          status: 'sent',
        });

        record(`notifications:${targetUserId}`, {
          id: id(),
          title: 'Gentle Wellbeing Check-in',
          message: escalated.message,
          type: 'reminder',
          createdAt: nowIso,
          read: false,
        });

        record('monitoring:events', {
          id: id(),
          caseId: caseRecord.id,
          victimToken: caseRecord.victimToken,
          event: 'reminder_sent',
          tone: escalated.tone,
          daysOverdue,
          createdAt: nowIso,
        });

        recordAudit(targetUserId, 'monitoring_reminder_processed', reminderRecord.id, {
          caseId: caseRecord.id,
          daysOverdue,
          tone: escalated.tone,
        });

        remindersSent.push({
          caseId: caseRecord.id,
          docket: caseRecord.docket,
          victimToken: caseRecord.victimToken,
          tone: escalated.tone,
          message: escalated.message,
          daysOverdue,
        });
      }
    }
  }

  evaluateStaleCheckInsForStore();

  return ok(res, {
    processedCount: processedCases.length,
    dueCasesCount: dueCases.length,
    overdueCasesCount: overdueCases.length,
    remindersSentCount: remindersSent.length,
    remindersSent,
    overdueCases,
  });
}));

app.post('/api/v1/monitoring/:action',requireAuth,body(z.object({reason:z.string().max(500).optional()})),asyncRoute(async(req:AuthedRequest,res)=>{const action=String(req.params.action); if(!['pause','resume','stop'].includes(action)) throw new AppError(404,'NOT_FOUND','Monitoring action not found.'); return ok(res,record(`monitoring:${req.user!.id}`,{state:action==='pause'?'paused':action==='stop'?'stopped':'active',reason:req.body.reason,createdAt:new Date().toISOString()}));}));
const checkinSchema=z.object({victimToken:z.string().optional(),mood:z.number().int().min(1).max(5).optional(),sleep:z.number().int().min(1).max(5).optional(),fear:z.number().int().min(1).max(5).optional(),intrusion:z.number().int().min(1).max(5).optional(),avoidance:z.number().int().min(1).max(5).optional(),perceivedSafety:z.number().int().min(1).max(5).optional(),dailyFunctioning:z.number().int().min(1).max(5).optional(),socialConnectedness:z.number().int().min(1).max(5).optional(),text:z.string().max(10000).optional(),language:z.string().default('en')});
app.post('/api/v1/check-ins/mood',requireAuth,requireMonitoringConsent,body(checkinSchema.extend({mood:z.number().int().min(1).max(5),sleep:z.number().int().min(1).max(5),perceivedSafety:z.number().int().min(1).max(5),socialConnectedness:z.number().int().min(1).max(5)})),asyncRoute(async(req:AuthedRequest,res)=>{const now=new Date().toISOString(); const summary=`Structured check-in: mood ${req.body.mood}/5, sleep ${req.body.sleep}/5, fear ${req.body.fear??'not answered'}/5, unwanted memories ${req.body.intrusion??'not answered'}/5, safety ${req.body.perceivedSafety}/5, social connection ${req.body.socialConnectedness}/5.`; const ml=await analyzeText({victimToken:req.user!.victimToken||'unknown',text:summary}); const result=record(`checkins:${req.user!.id}`,{id:id(),type:'mood',...req.body,ml,createdAt:now,analyticalState:ml.confidence<.5?'insufficient_evidence':'scored'}); if(ml.crisis) recordAlert({victimToken:req.user!.victimToken,caseReference:req.user!.victimToken,reason:'Structured check-in requires human review.',source:'checkin',crisis:true,confidence:ml.confidence}); 
  trackCheckinCompletion(record, id, { userId: req.user!.id, victimToken: req.user!.victimToken, channel: 'mood', createdAt: now });
  await updateBaseline(req.user!.id);
  resolveStaleCheckInAlertOnNewCheckIn(req.user!.victimToken);
  return ok(res,result,201)}));
app.post('/api/v1/check-ins/quick-mood',requireAuth,requireMonitoringConsent,body(z.object({mood:z.number().int().min(1).max(5),label:z.string().min(1).max(80)})),asyncRoute(async(req:AuthedRequest,res)=>{const now=new Date().toISOString(); const ml=await analyzeText({victimToken:req.user!.victimToken||'unknown',text:`Quick wellbeing check-in: the survivor selected mood "${req.body.label}" (${req.body.mood}/5).`}); const result=record(`checkins:${req.user!.id}`,{id:id(),type:'quick_mood',mood:req.body.mood,label:req.body.label,ml,createdAt:now,analyticalState:ml.confidence<.5?'insufficient_evidence':'scored'}); 
  trackCheckinCompletion(record, id, { userId: req.user!.id, victimToken: req.user!.victimToken, channel: 'quick_mood', createdAt: now });
  await updateBaseline(req.user!.id);
  resolveStaleCheckInAlertOnNewCheckIn(req.user!.victimToken);
  return ok(res,result,201)}));
app.post('/api/v1/check-ins/text',requireAuth,requireConsent('text_analysis'),body(checkinSchema.extend({text:z.string().trim().min(1).max(10000)})),asyncRoute(async(req:AuthedRequest,res)=>{const now=new Date().toISOString(); const ml=await analyzeText({victimToken:req.user!.victimToken||'unknown',text:req.body.text,language:req.body.language}); const result=record(`checkins:${req.user!.id}`,{id:id(),type:'text',victimToken:req.user!.victimToken,textSubmitted:true,ml,createdAt:now,analyticalState:ml.status==='unavailable'||ml.insufficientEvidence?'insufficient_evidence':'scored'}); if(ml.crisis) recordAlert({victimToken:req.user!.victimToken,caseReference:req.user!.victimToken,reason:'Crisis safety screening requires human review.',source:'text',crisis:true,confidence:ml.confidence}); 
  trackCheckinCompletion(record, id, { userId: req.user!.id, victimToken: req.user!.victimToken, channel: 'text', createdAt: now });
  await updateBaseline(req.user!.id);
  resolveStaleCheckInAlertOnNewCheckIn(req.user!.victimToken);
  return ok(res,result,201); }));
app.get('/api/v1/monitoring/baseline',requireAuth,asyncRoute(async(req:AuthedRequest,res)=>{
  const queryToken = req.query.victimToken ? String(req.query.victimToken) : undefined;
  const targetUser = queryToken ? [...store.users.values()].find(u => u.victimToken === queryToken) : undefined;
  const targetId = targetUser?.id ?? req.user!.id;
  const targetToken = queryToken ?? req.user!.victimToken;

  const observations = getObservationsForTarget(targetId, targetToken);
  const baseline = store.records.get(`baseline:${targetId}`)?.at(-1) ?? recomputeBaseline(observations);
  return ok(res, {
    baseline: baseline?.mean ?? null,
    observationCount: baseline?.count ?? observations.length,
    range: baseline ? { min: baseline.min, max: baseline.max } : null,
    updatedAt: baseline?.updatedAt ?? null,
    insufficientEvidence: !baseline,
  });
}));
app.get('/api/v1/monitoring/distress',requireAuth,asyncRoute(async(req:AuthedRequest,res)=>{
  const queryToken = req.query.victimToken ? String(req.query.victimToken) : undefined;
  const queryCaseId = req.query.caseId ? String(req.query.caseId) : undefined;
  const targetUser = queryToken ? [...store.users.values()].find(u => u.victimToken === queryToken) : undefined;
  const targetId = targetUser?.id ?? req.user!.id;
  const targetToken = queryToken ?? req.user!.victimToken;

  const observations = getObservationsForTarget(targetId, targetToken, queryCaseId);
  const baseline = store.records.get(`baseline:${targetId}`)?.at(-1) ?? recomputeBaseline(observations);
  const result = generateDistressScore(observations, baseline);
  const records = observations.map(o => ({
    createdAt: o.createdAt || o.timestamp || new Date().toISOString(),
    distressScore: typeof o.ml?.distressScore === 'number' ? o.ml.distressScore : (typeof o.distressScore === 'number' ? o.distressScore : (o.mood ? Math.round(100 - o.mood * 20) : 50)),
    recoveryScore: typeof o.ml?.recoveryScore === 'number' ? o.ml.recoveryScore : (typeof o.recoveryScore === 'number' ? o.recoveryScore : (o.mood ? Math.round(o.mood * 20) : 50)),
    confidence: o.ml?.confidence ?? 0.8,
    contributingFactors: o.ml?.contributingFactors ?? [],
  }));
  return ok(res, { ...result, records, state: result.insufficientEvidence ? 'insufficient_evidence' : 'scored', summary: observations.length ? 'observed' : 'no_data' });
}));
app.get('/api/v1/monitoring/recovery',requireAuth,asyncRoute(async(req:AuthedRequest,res)=>{
  const queryToken = req.query.victimToken ? String(req.query.victimToken) : undefined;
  const queryCaseId = req.query.caseId ? String(req.query.caseId) : undefined;
  const targetUser = queryToken ? [...store.users.values()].find(u => u.victimToken === queryToken) : undefined;
  const targetId = targetUser?.id ?? req.user!.id;
  const targetToken = queryToken ?? req.user!.victimToken;

  const observations = getObservationsForTarget(targetId, targetToken, queryCaseId);
  const baseline = store.records.get(`baseline:${targetId}`)?.at(-1) ?? recomputeBaseline(observations);
  const result = generateRecoveryScore(observations, baseline);
  return ok(res, { ...result, state: result.insufficientEvidence ? 'insufficient_evidence' : 'scored', summary: observations.length ? 'observed' : 'no_data' });
}));
app.get('/api/v1/monitoring/trends',requireAuth,asyncRoute(async(req:AuthedRequest,res)=>{
  const queryToken = req.query.victimToken ? String(req.query.victimToken) : undefined;
  const queryCaseId = req.query.caseId ? String(req.query.caseId) : undefined;
  const targetUser = queryToken ? [...store.users.values()].find(u => u.victimToken === queryToken) : undefined;
  const targetId = targetUser?.id ?? req.user!.id;
  const targetToken = queryToken ?? req.user!.victimToken;

  const observations = getObservationsForTarget(targetId, targetToken, queryCaseId);
  const baseline = store.records.get(`baseline:${targetId}`)?.at(-1) ?? recomputeBaseline(observations);
  const trendResult = computeMonitoringTrends(observations, baseline);
  return ok(res, trendResult);
}));

app.get('/api/v1/alerts',requireAuth,asyncRoute(async(req:AuthedRequest,res)=>{
  evaluateStaleCheckInsForStore();
  const allAlerts = store.records.get('alerts:all') || [];
  for (const user of store.users.values()) {
    if (!user.victimToken) continue;
    const latestMonitoring = store.records.get(`monitoring:${user.id}`)?.at(-1);
    if (!latestMonitoring || !['paused', 'stopped'].includes(latestMonitoring.state)) continue;
    const offForHours = (Date.now() - new Date(latestMonitoring.createdAt).getTime()) / 3_600_000;
    if (offForHours >= 24) recordAlert({ victimToken: user.victimToken, caseReference: user.victimToken, reason: `Monitoring has been ${latestMonitoring.state} for more than 24 hours.`, source: 'monitoring', requestedSupport: true, metadata: { state: latestMonitoring.state, offForHours: Math.round(offForHours) } });
  }
  let filtered = allAlerts;
  if (req.user!.role === 'SURVIVOR') {
    filtered = allAlerts.filter((a:any) => a.victimToken === req.user!.victimToken);
  } else if (req.user!.role === 'COUNSELLOR') {
    const myCases = store.cases.filter(c => c.assignedCounsellorId === req.user!.id);
    const myTokens = new Set(myCases.map(c => c.victimToken));
    const myDockets = new Set(myCases.map(c => c.docket));
    const myIds = new Set(myCases.map(c => c.id));
    filtered = allAlerts.filter((a: any) => myTokens.has(a.victimToken) || myDockets.has(a.caseReference) || myIds.has(a.caseReference) || (a.victimToken && myTokens.has(a.victimToken)));
  }
  return ok(res, filtered);
}));

app.post('/api/v1/notifications/sms/webhook', body(z.object({ From: z.string().min(8), Body: z.string().min(1) })), asyncRoute(async (req, res) => {
  // D12 — SMS check-in/follow-up: an inbound SMS reply is captured as a real check-in
  // (routed through the same text-analysis pipeline as an app-based text check-in), not
  // just logged as an unstructured message.
  const phone = normalizePhone(req.body.From);
  const matchedCase = store.cases.find(c => c.registeredPhone === phone);
  const saved = record('checkins:sms', { id: id(), phone, message: req.body.Body.trim(), caseId: matchedCase?.id ?? null, matched: !!matchedCase, source: 'sms_reply', analyticalState: 'insufficient_evidence', createdAt: new Date().toISOString() });
  if (matchedCase) {
    const ml = await analyzeText({ victimToken: matchedCase.victimToken, text: req.body.Body.trim() });
    record(`checkins:${matchedCase.victimToken}`, { id: id(), type: 'sms_reply', victimToken: matchedCase.victimToken, message: req.body.Body.trim(), ml, createdAt: new Date().toISOString(), analyticalState: ml.confidence < .5 ? 'insufficient_evidence' : 'scored' });
    if (ml.crisis) recordAlert({ victimToken: matchedCase.victimToken, caseReference: matchedCase.victimToken, reason: 'SMS check-in requires human review.', source: 'checkin', crisis: true, confidence: ml.confidence });
    trackCheckinCompletion(record, id, { userId: matchedCase.victimToken, victimToken: matchedCase.victimToken, channel: 'sms' });
    await updateBaseline(matchedCase.victimToken);
  }
  return ok(res, { status: 'captured', matched: saved.matched }, 202);
}));

app.post('/api/v1/alerts/:id/acknowledge',requireAuth,asyncRoute(async(req:AuthedRequest,res)=>{
  const alerts = store.records.get('alerts:all') || [];
  const alert = alerts.find((a:any) => a.id === req.params.id);
  if(!alert) throw new AppError(404,'ALERT_NOT_FOUND','Alert not found.');
  alert.status = 'ACKNOWLEDGED';
  alert.updatedAt = new Date().toISOString();
  if (alert.crisis) updateCrisisEventOutcome(store.records.get('audit:crisis') || [], alert.id, { acknowledgedAt: alert.updatedAt });
  return ok(res, alert);
}));
app.post('/api/v1/alerts/:id/assign',requireAuth,asyncRoute(async(req:AuthedRequest,res)=>{
  const alerts = store.records.get('alerts:all') || [];
  const alert = alerts.find((a:any) => a.id === req.params.id);
  if(!alert) throw new AppError(404,'ALERT_NOT_FOUND','Alert not found.');
  alert.status = 'ASSIGNED';
  alert.updatedAt = new Date().toISOString();
  return ok(res, alert);
}));
app.post('/api/v1/alerts/:id/resolve',requireAuth,asyncRoute(async(req:AuthedRequest,res)=>{
  const alerts = store.records.get('alerts:all') || [];
  const alert = alerts.find((a:any) => a.id === req.params.id);
  if(!alert) throw new AppError(404,'ALERT_NOT_FOUND','Alert not found.');
  if(alert.crisis && req.user!.role === 'SURVIVOR') throw new AppError(403,'FORBIDDEN','Only staff can resolve crisis alerts.');
  alert.status = 'RESOLVED';
  alert.updatedAt = new Date().toISOString();
  record('audit:alerts', { id: id(), alertId: alert.id, action: 'resolved', actor: req.user!.id, details: 'Alert resolved.', createdAt: alert.updatedAt });
  if (alert.crisis) updateCrisisEventOutcome(store.records.get('audit:crisis') || [], alert.id, { resolvedAt: alert.updatedAt, outcome: 'human_review_completed' });
  return ok(res, alert);
}));
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:env.UPLOAD_MAX_BYTES},fileFilter:(_req,file,cb)=>{if(!['audio/mpeg','audio/wav','audio/webm','audio/mp4'].includes(file.mimetype)) return cb(new AppError(400,'INVALID_AUDIO_MIME','Only MPEG, WAV, WebM, or MP4 audio is accepted.')); cb(null,true);}});
// Separate multer instance for image uploads (Hope Vault photos) — the `upload`
// instance above only accepts audio mimetypes, which was silently rejecting
// every photo before it ever reached the hope-vault route handler.
const uploadImage=multer({storage:multer.memoryStorage(),limits:{fileSize:env.UPLOAD_MAX_BYTES},fileFilter:(_req,file,cb)=>{if(!['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif'].includes(file.mimetype)) return cb(new AppError(400,'INVALID_IMAGE_MIME','Only JPEG, PNG, WebP, GIF, or HEIC images are accepted.')); cb(null,true);}});

app.post('/api/v1/ai/taara',requireAuth,requireMonitoringConsent,body(z.object({message:z.string().min(1).max(4000),caseId:z.string().optional()})),asyncRoute(async(req:AuthedRequest,res)=>{
  const directCrisis = detectCrisisLanguage(req.body.message);
  const taaraResult = directCrisis ? null : await respondToTaara({
    victimToken:req.user!.victimToken||'unknown',
    message:req.body.message,
    caseId: req.body.caseId
  });
  const analysis = taaraResult?.analysis ?? { confidence: 0, crisis: true };
  const generated = taaraResult?.reply ?? { reply: 'I am glad you told me. Your safety matters. Are you in immediate danger right now? Please contact local emergency services or a trusted person who can stay with you, and consider reaching out to your counsellor.', suggestedAction: 'Immediate human support', provider: 'safety-policy', model: 'rule-based-crisis-v1' };
  const crisis = directCrisis || analysis.crisis;
  const safetyState=crisis?'urgent_support':analysis.confidence<.5?'uncertain':'supportive';
  const alert=crisis?recordAlert({victimToken:req.user!.victimToken,caseReference:req.user!.victimToken,reason:'TAARA message requires human review.',source:'taara',crisis:true,confidence:analysis.confidence}):undefined;
  const reply = crisis && !analysis.crisis ? 'I am glad you told me. Your safety matters. Are you in immediate danger right now? Please contact local emergency services or a trusted person who can stay with you, and consider reaching out to your counsellor.' : generated.reply;
  // E19 — Conversation logging policy: only policy-allowed metadata is persisted
  // (see RETENTION_POLICY_DAYS in services/audit-policy.ts); the raw message text
  // itself is never written to the store.
  const logEntry = buildConversationLogEntry(id, { victimToken: req.user!.victimToken, safetyState, confidence: analysis.confidence, modelVersion: generated.model });
  record('taara:conversations', logEntry);
  record(`taara:conversations:${req.user!.id}`, logEntry);
  return ok(res,{reply,safetyState,suggestedAction:crisis?'Immediate human support':generated.suggestedAction,crisis_detected:crisis,priority:alert?.priority,human_review_required:crisis,analysis:{confidence:analysis.confidence,provider:crisis?'safety-policy':generated.provider,model:crisis?'rule-based-crisis-v1':generated.model}});
}));

app.post('/api/v1/ai/sahayak',requireAuth,body(z.object({message:z.string().min(1).max(4000),caseId:z.string().optional(),conversation:z.array(z.object({role:z.enum(['user','assistant']),text:z.string().max(1000)})).max(8).optional()})),asyncRoute(async(req:AuthedRequest,res)=>{
  const caseRecord = req.body.caseId
    ? store.cases.find((item) => item.id === req.body.caseId || item.docket === req.body.caseId || item.victimToken === req.body.caseId)
    : store.cases.find((item) => item.victimToken === req.user!.victimToken);
  const victimToken = req.user!.victimToken || caseRecord?.victimToken;
  const userId = req.user!.id;
  const checkIns = store.records.get(`checkins:${userId}`) || [];
  const latest = checkIns.at(-1);

  // Step 1: Run text through the Render ML pipeline (rule-based SAATH fusion).
  console.log(`[Sahayak] checkIns count: ${checkIns.length} | ML_SERVICE_URL set: ${Boolean(env.ML_SERVICE_URL)}`);
  const mlAnalysis = await analyzeText({ victimToken: victimToken || 'unknown', text: req.body.message, language: 'en' });
  console.log(`[Sahayak] ML analysis complete — status: ${mlAnalysis.status ?? 'n/a'} | crisis: ${mlAnalysis.crisis} | insufficientEvidence: ${Boolean(mlAnalysis.insufficientEvidence)}`);

  // Step 2: Crisis short-circuit (N04/E11). If the ML pipeline or local crisis rules
  // flagged this message, fire alert and return approved response immediately.
  if (mlAnalysis.crisis) {
    recordAlert({ victimToken: victimToken || 'unknown', caseReference: victimToken || 'unknown', reason: 'Sahayak ML pipeline detected crisis language.', source: 'sahayak', crisis: true, confidence: mlAnalysis.confidence });
    return ok(res, {
      reply: "I hear how much pain you're carrying right now, and I'm really glad you reached out. Your safety matters right now more than anything else, and you don't have to carry this alone. If you feel at risk of hurting yourself or are in immediate danger, please contact your local emergency services or go to your nearest hospital. A counsellor from your Safe Circle has also been alerted to check in on you. I'm right here with you—would you like to take a slow breath together, or talk about what has been feeling heaviest?",
      supportAvailable: true,
    });
  }

  // Precompute case context for reply and assessments
  const daysUntilHearing = caseRecord?.nextHearingDate ? Math.max(0, Math.ceil((new Date(caseRecord.nextHearingDate).getTime() - Date.now()) / 86_400_000)) : null;
  const assignedCounsellor = caseRecord?.assignedCounsellorId
    ? store.counsellors.find((c) => c.id === caseRecord.assignedCounsellorId)
    : undefined;

  const activeServices: string[] = [];
  if (caseRecord?.counsellorAssigned === 'Assigned' || caseRecord?.assignedCounsellorId) {
    activeServices.push(`Assigned Counsellor${assignedCounsellor ? ` (${assignedCounsellor.name})` : ''}`);
  }
  if (caseRecord?.legalAidStatus === 'Assigned') {
    activeServices.push('Legal Aid Assigned');
  }
  if (caseRecord?.protectionOfficerAssigned || (caseRecord?.protectionStatus && caseRecord.protectionStatus !== 'Not requested')) {
    activeServices.push(`Protection Services (${caseRecord.protectionStatus || 'Assigned'})`);
  }
  if (caseRecord?.financialReliefEligible || (caseRecord?.compensationStatus && caseRecord.compensationStatus !== 'Not eligible')) {
    activeServices.push(`Financial Relief (${caseRecord.compensationStatus || 'Eligible'})`);
  }
  if (caseRecord?.rehabilitationStatus && caseRecord.rehabilitationStatus !== 'Not Started') {
    activeServices.push(`Rehabilitation (${caseRecord.rehabilitationStatus})`);
  }

  // Step 3: Concurrently trigger the escalation pipeline in the background so the conversational reply is not delayed.
  // All side-effects (check-in persistence, baseline update, case risk update, assessments, alerts) are preserved.
  const escalationPipelinePromise = (async () => {
    try {
      const escalationState = await generateEscalation(userId, victimToken, mlAnalysis);
      const escalationResult = escalationState.status === 'available' ? escalationState.result : null;

      const escalationPct = escalationResult?.escalation_probability ?? (mlAnalysis.escalationProbability !== null ? Math.round(mlAnalysis.escalationProbability * 100) : 20);
      const riskLevel = escalationResult?.risk_level ?? (escalationPct >= 75 ? 'CRITICAL' : escalationPct >= 50 ? 'HIGH' : escalationPct >= 25 ? 'MODERATE' : 'LOW');

      // Persist check-in observation so longitudinal history accumulates correctly.
      const checkinRecord = {
        id: id(),
        type: 'sahayak_chat',
        victimToken,
        textSubmitted: true,
        ml: mlAnalysis,
        createdAt: new Date().toISOString(),
        analyticalState: mlAnalysis.status === 'unavailable' || mlAnalysis.insufficientEvidence ? 'insufficient_evidence' : 'scored',
      };
      record(`checkins:${userId}`, checkinRecord);
      trackCheckinCompletion(record, id, { userId, victimToken, channel: 'sahayak' });
      await updateBaseline(userId);

      // Update case record in store.cases so counsellor/admin caseloads reflect real scores.
      if (caseRecord) {
        caseRecord.riskLevel = riskLevel;
        if (typeof mlAnalysis.distressScore === 'number') {
          caseRecord.currentDistressScore = mlAnalysis.distressScore;
        }
        if (escalationPct !== null) {
          caseRecord.predicted7dScore = escalationPct;
        }
      }

      // Persist rich assessment for counsellor and admin dashboards.
      record('sahayak:assessments', {
        id: id(),
        victimToken,
        caseId: caseRecord?.id,
        signals: {
          caseStage: caseRecord?.currentStage,
          currentDistressScore: mlAnalysis.distressScore ?? latest?.ml?.distressScore,
          previousDistressScore: latest?.ml?.distressScore,
          distressChange: (typeof mlAnalysis.distressScore === 'number' && typeof latest?.ml?.distressScore === 'number') ? mlAnalysis.distressScore - latest.ml.distressScore : undefined,
          mlStatus: mlAnalysis.status,
          sentiment: mlAnalysis.signals?.sentiment as string | undefined,
          emotion: mlAnalysis.signals?.emotion as string | undefined,
          daysUntilHearing,
        },
        prediction: {
          escalation_probability: escalationPct,
          risk_level: riskLevel,
          confidence: escalationResult?.confidence ?? mlAnalysis.confidence,
          time_horizon: '7 days',
          contributing_factors: escalationResult?.contributing_factors ?? mlAnalysis.contributingFactors.map(f => f.factor),
          early_warning_signals: escalationResult?.early_warning_signals ?? [],
          recommended_followup: escalationResult?.recommended_followup ?? 'Continue monitoring via check-ins',
          warnings: [],
          modelName: escalationResult ? 'gemini-escalation-20f' : 'saath-text-fusion-pipeline',
          modelVersion: '1.0.0',
          insufficientEvidence: mlAnalysis.insufficientEvidence ?? false,
        },
        createdAt: new Date().toISOString(),
      });

      if (escalationPct >= 75) {
        recordAlert({
          victimToken: victimToken || 'unknown',
          caseReference: victimToken || 'unknown',
          reason: 'Sahayak analysis indicates elevated escalation risk.',
          source: 'sahayak',
          requestedSupport: true,
          confidence: escalationResult?.confidence ?? mlAnalysis.confidence,
          metadata: { riskLevel },
        });
      }
    } catch (err) {
      console.error('[Sahayak] Background escalation processing failed:', err instanceof Error ? err.stack || err.message : String(err));
    }
  })();

  // Step 4: Generate supportive, case-specific, non-repetitive conversational reply immediately once ML inputs are available.
  const reply = await generateSahayakReply({
    message: req.body.message,
    caseDetails: caseRecord ? {
      docket: caseRecord.docket,
      state: caseRecord.state,
      district: caseRecord.district,
      city: caseRecord.city,
      category: caseRecord.caseCategory,
      stage: caseRecord.currentStage,
      preferredLanguage: caseRecord.preferredLanguage,
      assignedCounsellorName: assignedCounsellor?.name,
      assignedCounsellorSpecialisation: assignedCounsellor?.specialisation,
      daysUntilHearing: daysUntilHearing ?? undefined,
      nextHearingDate: caseRecord.nextHearingDate,
      counsellingStatus: caseRecord.counsellorAssigned ? 'assigned' : 'pending',
      legalAidStatus: caseRecord.legalAidStatus,
      protectionStatus: caseRecord.protectionStatus,
      protectionOfficerAssigned: caseRecord.protectionOfficerAssigned,
      financialReliefStatus: caseRecord.compensationStatus,
      financialReliefEligible: caseRecord.financialReliefEligible,
      approvedAmount: caseRecord.compensationAmountApproved,
      disbursedAmount: caseRecord.compensationAmountReceived,
      pendingAmount: caseRecord.pendingAmount,
      rehabilitationStatus: caseRecord.rehabilitationStatus,
      activeServices,
    } : undefined,
    recentCheckIns: checkIns.slice(-3).map((c: any) => ({
      type: c.type,
      mood: c.mood,
      createdAt: c.createdAt,
    })),
    history: req.body.conversation,
    mlAnalysis,
    contributingFactors: mlAnalysis.contributingFactors.map(f => f.factor),
  });

  // Step 5: Return conversational reply to the client immediately.
  ok(res, { reply, supportAvailable: true });

  // Step 6: Await the background escalation pipeline to ensure completion without blocking the client response.
  await escalationPipelinePromise;
}));


app.get('/api/v1/counsellor/sahayak-assessments',requireAuth,requireRoles('COUNSELLOR','DISTRICT_ADMIN','STATE_ADMIN','NATIONAL_ADMIN'),asyncRoute(async(_req,res)=>ok(res,store.records.get('sahayak:assessments')||[])));

// AI-01 — POST /ai/analyze-text: internal ML-service contract route (BE-2 caller).
// Previously `analyzeText()` was only ever called *inline* from inside other routes
// (check-ins/mood, check-ins/text, TAARA) — there was no standalone endpoint matching
// the API contract. This wraps the same function as its own route so any internal
// caller can run NLP analysis on a text signal without going through a check-in.
app.post('/api/v1/ai/analyze-text', requireAuth, body(z.object({ text: z.string().min(1).max(4000), caseId: z.string().optional(), language: z.string().optional() })), asyncRoute(async (req: AuthedRequest, res) => {
  const caseRecord = req.body.caseId ? store.cases.find((c) => c.id === req.body.caseId) : undefined;
  // B17 — the ML pipeline only ever receives a pseudonymous token, never name/phone/docket.
  const mlInput = minimize({ victimToken: caseRecord?.victimToken ?? req.user!.victimToken ?? 'unknown', text: req.body.text, language: req.body.language }, MINIMIZATION_SCHEMA.mlPipelineInput);
  const analysis = await analyzeText(mlInput as { victimToken: string; text: string; language?: string });
  const signalId = id();
  record('text_signals', { id: signalId, victimToken: mlInput.victimToken, analysis, createdAt: new Date().toISOString() });
  return ok(res, {
    signalId,
    status: analysis.status ?? (analysis.insufficientEvidence ? 'unavailable' : 'available'),
    sentiment: analysis.signals?.sentiment ?? (analysis.distressScore !== null ? (analysis.distressScore >= 60 ? 'negative' : analysis.distressScore <= 30 ? 'positive' : 'neutral') : null),
    emotion: analysis.signals?.emotion ?? null,
    themes: analysis.signals?.themes ?? analysis.contributingFactors.map((f) => f.factor),
    distressScore: analysis.distressScore,
    recoveryScore: analysis.recoveryScore,
    confidence: analysis.confidence,
    crisis: analysis.crisis,
    indicators: analysis.indicators ?? [],
  });
}));

// AI-02 — POST /ai/analyze-voice: internal ML-service contract route (BE-2 caller).
// Same situation as AI-01 — `analyzeVoice()` existed but only as an inline call inside
// POST /check-ins/voice. This exposes it directly. The contract lists the request body
// as {audioRef, caseId}, but there is no audio-storage layer to resolve an audioRef
// against in this codebase (no S3/blob store) — so, consistent with how CHK-03 already
// works, this accepts a direct multipart audio upload instead of a reference string.
// That is a deliberate, documented deviation from the contract's literal body shape,
// not a stub: the route performs a real transcription + analysis end to end.
app.post('/api/v1/ai/analyze-voice', requireAuth, upload.single('audio'), asyncRoute(async (req: AuthedRequest, res) => {
  if (!req.file) throw new AppError(400, 'AUDIO_REQUIRED', 'A supported audio file is required.');
  const caseRecord = req.body.caseId ? store.cases.find((c) => c.id === req.body.caseId) : undefined;
  try {
    const voice = await analyzeVoice({ victimToken: caseRecord?.victimToken ?? req.user!.victimToken ?? 'unknown', audio: req.file.buffer, mimeType: req.file.mimetype, language: (req.body as { language?: string }).language });
    const signalId = id();
    record('voice_signals', { id: signalId, victimToken: caseRecord?.victimToken ?? req.user!.victimToken, transcriptAvailable: true, analysis: voice.analysis, createdAt: new Date().toISOString() });
    return ok(res, { signalId, transcript: voice.transcript, features: voice.analysis.signals, status: voice.analysis.status, distressScore: voice.analysis.distressScore, confidence: voice.analysis.confidence, crisis: voice.analysis.crisis, indicators: voice.analysis.indicators ?? [] });
  } catch {
    throw new AppError(503, 'VOICE_ANALYSIS_UNAVAILABLE', 'Voice transcription is temporarily unavailable.');
  }
}));

// AI-04 — POST /ai/crisis-screen: internal ML-service contract route (BE-2 internal
// caller only — never exposed to a survivor-facing client directly). Previously crisis
// detection only existed as a side-effect boolean (`analysis.crisis`) inside the output
// of analyzeText, with no standalone screening endpoint. This is P0 safety-critical per
// the contract, so it is deliberately conservative: it flags crisis on EITHER the ML
// model's crisis boolean OR a direct regex match, and never suppresses a flag raised by
// either signal (see the "false negative risk" error case noted in the contract).
app.post('/api/v1/ai/crisis-screen', requireAuth, body(z.object({ text: z.string().min(1).max(4000) })), asyncRoute(async (req: AuthedRequest, res) => {
  const analysis = await analyzeText({ victimToken: req.user!.victimToken ?? 'unknown', text: req.body.text });
  const flags: string[] = [];
  const crisis = analysis.crisis || detectCrisisLanguage(req.body.text);
  if (crisis) flags.push('crisis_language_detected');
  if (analysis.insufficientEvidence) flags.push('low_confidence_analysis');
  for (const factor of analysis.contributingFactors) {
    if (factor.direction === 'increased_distress' && factor.weight >= 0.7) flags.push(`high_weight_factor:${factor.factor}`);
  }
  const riskLevel = crisis ? 'critical' : analysis.distressScore !== null && analysis.distressScore >= 70 ? 'elevated' : 'none';
  if (crisis) recordAlert({ victimToken: req.user!.victimToken, caseReference: req.user!.victimToken, reason: 'Crisis screen flagged this message for human review.', source: 'checkin', crisis: true, confidence: analysis.confidence });
  return ok(res, { riskLevel, flags, confidence: analysis.confidence, crisis, response: crisis ? 'Your safety matters. Please contact immediate human support or a trusted person who can stay with you. A counsellor has been notified for human review.' : null, humanReviewRequired: crisis });
}));
app.post('/api/v1/check-ins/voice',requireAuth,requireConsent('voice_analysis'),upload.single('audio'),asyncRoute(async(req:AuthedRequest,res)=>{if(!req.file) throw new AppError(400,'AUDIO_REQUIRED','A supported audio file is required.'); try { const voice=await analyzeVoice({victimToken:req.user!.victimToken||'unknown',audio:req.file.buffer,mimeType:req.file.mimetype,language:(req.body as {language?:string}).language}); const result=record(`checkins:${req.user!.id}`,{id:id(),type:'voice',victimToken:req.user!.victimToken,transcript:voice.transcript,transcriptAvailable:true,ml:voice.analysis,rawAudioRetained:false,createdAt:new Date().toISOString(),analyticalState:voice.analysis.status==='unavailable'||voice.analysis.insufficientEvidence?'insufficient_evidence':'scored'}); if(voice.analysis.crisis) recordAlert({victimToken:req.user!.victimToken,caseReference:req.user!.victimToken,reason:'Voice check-in requires human review.',source:'voice',crisis:true,confidence:voice.analysis.confidence}); trackCheckinCompletion(record, id, { userId: req.user!.id, victimToken: req.user!.victimToken, channel: 'voice' }); await updateBaseline(req.user!.id); resolveStaleCheckInAlertOnNewCheckIn(req.user!.victimToken); return ok(res,{...result,transcript:voice.transcript},201); } catch { throw new AppError(503,'VOICE_ANALYSIS_UNAVAILABLE','Voice transcription is temporarily unavailable. Please try a text check-in.'); }}));


// ...existing code...
const ivrsSchema = z.object({ language: z.string().default('en'), responses: z.record(z.string()).default({}), requestCounsellorCall: z.boolean().default(false), provider: z.string().optional() });
app.post('/api/v1/check-ins/ivrs', requireAuth, body(ivrsSchema), asyncRoute(async (req: AuthedRequest, res) => {
  const summary = Object.entries(req.body.responses).map(([question, answer]) => `${question}: ${answer}`).join('; ') || 'No responses recorded.';
  const ml = await analyzeText({ victimToken: req.user!.victimToken || 'unknown', text: summary, language: req.body.language });

  const result = record(`checkins:${req.user!.id}`, {
    id: id(),
    type: 'ivrs',
    victimToken: req.user!.victimToken,
    responses: req.body.responses,
    requestCounsellorCall: req.body.requestCounsellorCall,
    ml,
    createdAt: new Date().toISOString(),
    analyticalState: ml.status === 'unavailable' || ml.insufficientEvidence ? 'insufficient_evidence' : 'scored'
  });

  if (ml.crisis) recordAlert({ victimToken: req.user!.victimToken, caseReference: req.user!.victimToken, reason: 'IVRS check-in requires human review.', source: 'checkin', crisis: true, confidence: ml.confidence });
  if (req.body.requestCounsellorCall) recordAlert({ victimToken: req.user!.victimToken, caseReference: req.user!.victimToken, reason: 'Survivor requested a counsellor phone call via IVRS check-in.', source: 'checkin', crisis: false, requestedSupport: true, confidence: ml.confidence });
  trackCheckinCompletion(record, id, { userId: req.user!.id, victimToken: req.user!.victimToken, channel: 'ivrs' });
  await updateBaseline(req.user!.id);
  resolveStaleCheckInAlertOnNewCheckIn(req.user!.victimToken);

  return ok(res, result, 201);
}));
app.post('/api/v1/check-ins/ivrs/webhook',body(z.object({phone:z.string(),sessionId:z.string(),responses:z.record(z.string())})),asyncRoute(async(req,res)=>ok(res,{accepted:true,mode:'simulated',sessionId:req.body.sessionId},202)));
app.get('/api/v1/check-ins/history',requireAuth,asyncRoute(async(req:AuthedRequest,res)=>ok(res,store.records.get(`checkins:${req.user!.id}`)||[])));
app.get('/api/v1/monitoring/:kind',requireAuth,asyncRoute(async(req:AuthedRequest,res)=>{
  // Silence is not a crisis signal; missing check-ins must remain insufficient evidence rather than escalating automatically.
  const records = store.records.get(`checkins:${req.user!.id}`) || [];
  return ok(res,{kind:req.params.kind,state:'insufficient_evidence',score:null,confidence:null,factors:[],modelVersion:'not_available',victimToken:req.user!.victimToken,records,summary: records.length ? 'observed' : 'no_data'});
}));
app.post('/api/v1/alerts/:id/:action',requireAuth,requireRoles('COUNSELLOR','DISTRICT_ADMIN','STATE_ADMIN','NATIONAL_ADMIN'),body(z.object({note:z.string().max(1000).optional(),assigneeId:z.string().optional()})),asyncRoute(async(req:AuthedRequest,res)=>{const alerts=(store.records.get('alerts:all')||[]); const alert=alerts.find((x:any)=>x.id===req.params.id); if(!alert) throw new AppError(404,'ALERT_NOT_FOUND','Alert not found.'); const action=req.params.action; const now=new Date().toISOString(); if(action==='resolve'){ alert.status='RESOLVED'; alert.resolvedAt=now; } else if(action==='acknowledge'){ alert.status='ACKNOWLEDGED'; alert.acknowledgedAt=now; alert.firstAcknowledgedAt ??= now; } else if(action==='assign'){ if(!req.body.assigneeId) throw new AppError(400,'ASSIGNEE_REQUIRED','An assignee is required.'); alert.status='ASSIGNED'; alert.assigneeId=req.body.assigneeId; alert.firstAssignedAt ??= now; } else { throw new AppError(400,'INVALID_ACTION','Unsupported alert action.'); } alert.updatedAt=now; recordAudit(req.user!.id, `alert_${action}d`, alert.id, { note: req.body.note, assigneeId: req.body.assigneeId ?? null });
  if (alert.crisis) {
    // N08/N09 — keep the dedicated crisis audit trail in sync with the alert lifecycle
    // so response-time metrics (N09) can be computed later.
    const crisisEntries: CrisisAuditEntry[] = store.records.get('audit:crisis') || [];
    if (action === 'acknowledge') updateCrisisEventOutcome(crisisEntries, alert.id, { acknowledgedAt: now });
    if (action === 'resolve') updateCrisisEventOutcome(crisisEntries, alert.id, { resolvedAt: now, outcome: 'human_review_completed', notes: req.body.note });
  }
  return ok(res,alert);}));
// Computes distinct timestamps for survivor activity, counsellor reviews, and counsellor contacts.
// LAST ACTIVE: Only meaningful survivor-initiated activity (check-ins, TAARA messages, Feel Better/interventions, follow-up responses).
// LAST REVIEWED: When a counsellor actively reviewed the case (audit log or alert resolution/acknowledgement).
// LAST COUNSELLOR CONTACT: When a counsellor actually contacted/scheduled a follow-up with the survivor.
const computeCaseTimestamps = (c: any) => {
  const token = c.victimToken;
  const docket = c.docket;
  const caseId = c.id;

  // 1. Gather all survivor-initiated activity timestamps
  const survivorActivityTimestamps: number[] = [];

  // Check-ins (mood, text, voice, ivrs, sahayak_chat, quick_mood)
  for (const [key, values] of store.records.entries()) {
    if (key.startsWith('checkins:')) {
      for (const item of values) {
        if (item.victimToken === token || item.caseId === caseId) {
          const t = new Date(item.createdAt || item.timestamp).getTime();
          if (!isNaN(t)) survivorActivityTimestamps.push(t);
        }
      }
    }
    // Engagement signals (checkin_completed, intervention_completed, followup_response)
    if (key.startsWith('engagement:')) {
      for (const item of values) {
        if (item.victimToken === token || item.metadata?.victimToken === token) {
          const t = new Date(item.createdAt).getTime();
          if (!isNaN(t)) survivorActivityTimestamps.push(t);
        }
      }
    }
    // TAARA conversations
    if (key.startsWith('taara:conversations')) {
      for (const item of values) {
        if (item.victimToken === token) {
          const t = new Date(item.createdAt || item.timestamp).getTime();
          if (!isNaN(t)) survivorActivityTimestamps.push(t);
        }
      }
    }
    // Interventions completed/started/feedback
    if (key.startsWith('interventions:')) {
      for (const item of values) {
        if (item.victimToken === token || item.caseId === caseId) {
          const t = new Date(item.completedAt || item.startedAt || item.feedback?.submittedAt || item.createdAt).getTime();
          if (!isNaN(t)) survivorActivityTimestamps.push(t);
        }
      }
    }
    // Hope vault uploads
    if (key.startsWith('hope:')) {
      for (const item of values) {
        if (item.victim_token === token) {
          const t = new Date(item.created_at || item.createdAt).getTime();
          if (!isNaN(t)) survivorActivityTimestamps.push(t);
        }
      }
    }
  }

  // Follow-up responses/reschedules initiated by survivor
  const allFollowUps = store.records.get('follow_ups') || [];
  for (const f of allFollowUps) {
    if (f.victimToken === token || f.caseId === caseId || f.docket === docket) {
      if (f.initiatedBy === 'SURVIVOR' || f.rescheduleRequestedAt || f.acceptedAt) {
        const t = new Date(f.rescheduleRequestedAt || f.acceptedAt || f.createdAt).getTime();
        if (!isNaN(t)) survivorActivityTimestamps.push(t);
      }
    }
  }

  // Calculate newest survivor activity
  let lastActive: string | null = null;
  if (survivorActivityTimestamps.length > 0) {
    const maxTime = Math.max(...survivorActivityTimestamps);
    lastActive = new Date(maxTime).toISOString();
  }

  // 2. Counsellor Review timestamp (from audit logs or acknowledged alerts)
  const reviewTimestamps: number[] = [];
  const alertAudits = store.records.get('audit:alerts') || [];
  const allAlerts = store.records.get('alerts:all') || [];
  for (const a of allAlerts) {
    if (a.victimToken === token || a.caseReference === docket) {
      if (a.acknowledgedAt) {
        const t = new Date(a.acknowledgedAt).getTime();
        if (!isNaN(t)) reviewTimestamps.push(t);
      }
      if (a.resolvedAt) {
        const t = new Date(a.resolvedAt).getTime();
        if (!isNaN(t)) reviewTimestamps.push(t);
      }
    }
  }
  const lastReviewedAt = reviewTimestamps.length > 0 ? new Date(Math.max(...reviewTimestamps)).toISOString() : null;

  // 3. Counsellor Contact timestamp (from follow-ups scheduled or completed by counsellor)
  const contactTimestamps: number[] = [];
  for (const f of allFollowUps) {
    if (f.victimToken === token || f.caseId === caseId || f.docket === docket) {
      if (f.createdBy && f.status !== 'CANCELLED') {
        const t = new Date(f.createdAt || f.date).getTime();
        if (!isNaN(t)) contactTimestamps.push(t);
      }
    }
  }
  const lastCounsellorContactAt = contactTimestamps.length > 0 ? new Date(Math.max(...contactTimestamps)).toISOString() : null;

  return {
    ...c,
    lastActive,
    lastReviewedAt,
    lastCounsellorContactAt,
  };
};

// Filtered to only the cases assigned to the authenticated counsellor —
// enriched with dynamic survivor lastActive, lastReviewedAt, and lastCounsellorContactAt.
app.get('/api/v1/counsellor/cases',requireAuth,requireRoles('COUNSELLOR'),asyncRoute(async(req:AuthedRequest,res)=>{
  const assigned = store.cases.filter(c=>c.assignedCounsellorId===req.user!.id);
  const enriched = assigned.map(computeCaseTimestamps);
  return ok(res, enriched);
}));
app.get('/api/v1/counsellor/cases/:id',requireAuth,requireRoles('COUNSELLOR'),asyncRoute(async(req:AuthedRequest,res)=>{
  const c=store.cases.find(x=>x.id===req.params.id||x.victimToken===req.params.id||x.docket===req.params.id); 
  if(!c) throw new AppError(404,'CASE_NOT_FOUND','Case not found.'); 
  if(c.assignedCounsellorId!==req.user!.id) throw new AppError(403,'FORBIDDEN','This case is not assigned to you.'); 
  return ok(res,{case:computeCaseTimestamps(c),view:'summary',timeline:store.timelines.filter(x=>x.caseId===c.id)});
}));
app.get('/api/v1/counsellor/cases/:id/:view',requireAuth,requireRoles('COUNSELLOR'),asyncRoute(async(req:AuthedRequest,res)=>{
  const c=store.cases.find(x=>x.id===req.params.id||x.victimToken===req.params.id||x.docket===req.params.id); 
  if(!c) throw new AppError(404,'CASE_NOT_FOUND','Case not found.'); 
  if(c.assignedCounsellorId!==req.user!.id) throw new AppError(403,'FORBIDDEN','This case is not assigned to you.'); 
  return ok(res,{case:computeCaseTimestamps(c),view:String(req.params.view),timeline:store.timelines.filter(x=>x.caseId===c.id)});
}));  
app.get('/api/v1/counsellor/voice-checkins',requireAuth,requireRoles('COUNSELLOR'),asyncRoute(async(req:AuthedRequest,res)=>{
  const myVictimTokens=new Set(store.cases.filter(c=>c.assignedCounsellorId===req.user!.id).map(c=>c.victimToken));
  const caseByToken=new Map(store.cases.map(c=>[c.victimToken,c]));
  const items=[...store.records.entries()]
    .flatMap(([key,values])=>values
      .filter((value:any)=>(value.type==='voice'||value.type==='ivrs')&&myVictimTokens.has(value.victimToken))
      .map((value:any)=>{
        const caseRecord=caseByToken.get(value.victimToken);
        return {
          id:value.id,
          submittedBy:key.replace('checkins:',''),
          victimToken:value.victimToken,
          survivorName:caseRecord?.survivorName??'Unknown survivor',
          docket:caseRecord?.docket,
          createdAt:value.createdAt,
          analyticalState:value.analyticalState,
          channel:value.type,
          requestCounsellorCall:!!value.requestCounsellorCall,
          transcript:value.type==='ivrs'?`[Phone check-in] ${Object.entries(value.responses||{}).map(([q,a])=>`${q}: ${a}`).join('; ')}${value.requestCounsellorCall?' — counsellor call requested':''}`:(value.transcript ?? value.ml?.signals?.voiceFeatures?.transcript),
          analysis:value.ml,
          signals:value.ml?.signals ?? value.signals,
        };
      }))
    .sort((a:any,b:any)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());
  return ok(res,items);
}));
// CNS-03 — POST /counsellor/interventions: dedicated contract route (was previously
// only reachable via the generic /counsellor/:resource catch-all below). Registered
// BEFORE that catch-all so Express matches this specific path first.
app.post('/api/v1/counsellor/interventions', requireAuth, requireRoles('COUNSELLOR'), body(z.object({ caseId: z.string().min(1), type: z.string().min(1), notes: z.string().max(2000).optional() })), asyncRoute(async (req: AuthedRequest, res) => {
  const caseRecord = store.cases.find((c) => c.id === req.body.caseId);
  if (!caseRecord) throw new AppError(404, 'CASE_NOT_FOUND', 'Case not found.');
  const created = record(`interventions:${caseRecord.victimToken}`, { id: id(), type: req.body.type, notes: req.body.notes, status: 'ASSIGNED', assignedBy: req.user!.id, caseId: req.body.caseId, createdAt: new Date().toISOString() });
  recordAudit(req.user!.id, 'counsellor_intervention_logged', created.id, { caseId: req.body.caseId, type: req.body.type });
  return ok(res, { interventionId: created.id }, 201);
}));

// GET /api/v1/counsellor/follow-ups: get all follow-ups scoped to counsellor's assigned cases
app.get('/api/v1/counsellor/follow-ups', requireAuth, requireRoles('COUNSELLOR'), asyncRoute(async (req: AuthedRequest, res) => {
  const myCases = store.cases.filter(c => c.assignedCounsellorId === req.user!.id);
  const myTokens = new Set(myCases.map(c => c.victimToken));
  const myIds = new Set(myCases.map(c => c.id));
  const caseMap = new Map(store.cases.map(c => [c.id, c]));
  const caseByToken = new Map(store.cases.map(c => [c.victimToken, c]));

  const allFollowUps = store.records.get('follow_ups') || [];
  const scoped = allFollowUps
    .filter((f: any) => f.createdBy === req.user!.id || myTokens.has(f.victimToken) || myIds.has(f.caseId))
    .map((f: any) => {
      const c = caseMap.get(f.caseId) || caseByToken.get(f.victimToken);
      return {
        ...f,
        survivorName: f.survivorName ?? c?.survivorName ?? 'Assigned survivor',
        docket: f.docket ?? c?.docket ?? 'Docket',
        currentStage: c?.currentStage,
        riskLevel: c?.riskLevel,
        contactPhone: c?.registeredPhone,
      };
    })
    .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return ok(res, scoped);
}));

// CNS-04 — POST /counsellor/follow-ups: create counsellor-initiated follow-up
app.post('/api/v1/counsellor/follow-ups', requireAuth, requireRoles('COUNSELLOR'), body(z.object({
  caseId: z.string().min(1),
  date: z.string().datetime(),
  notes: z.string().max(2000).optional(),
  privateNotes: z.string().max(2000).optional(),
  survivorNotes: z.string().max(2000).optional(),
  status: z.enum(['SCHEDULED', 'PROPOSED', 'CONFIRMED']).default('PROPOSED'),
})), asyncRoute(async (req: AuthedRequest, res) => {
  const caseRecord = store.cases.find((c) => c.id === req.body.caseId || c.victimToken === req.body.caseId);
  if (!caseRecord) throw new AppError(404, 'CASE_NOT_FOUND', 'Case not found.');
  const now = new Date().toISOString();
  const created = record('follow_ups', {
    id: id(),
    caseId: caseRecord.id,
    victimToken: caseRecord.victimToken,
    survivorName: caseRecord.survivorName,
    docket: caseRecord.docket,
    date: req.body.date,
    notes: req.body.notes,
    privateNotes: req.body.privateNotes,
    survivorNotes: req.body.survivorNotes || req.body.notes,
    createdBy: req.user!.id,
    status: req.body.status ?? 'PROPOSED',
    initiatedBy: 'COUNSELLOR',
    createdAt: now,
    updatedAt: now,
  });
  recordAudit(req.user!.id, 'followup_created', created.id, { caseId: caseRecord.id, date: req.body.date, status: created.status });
  return ok(res, { followUpId: created.id, followUp: created }, 201);
}));

// PATCH /api/v1/counsellor/follow-ups/:id: update follow-up state, notes, or schedule
app.patch('/api/v1/counsellor/follow-ups/:id', requireAuth, requireRoles('COUNSELLOR'), body(z.object({
  status: z.enum(['SCHEDULED', 'REQUESTED', 'PROPOSED', 'ACCEPTED', 'RESCHEDULE_REQUESTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED']).optional(),
  date: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
  privateNotes: z.string().max(2000).optional(),
  survivorNotes: z.string().max(2000).optional(),
})), asyncRoute(async (req: AuthedRequest, res) => {
  const allFollowUps = store.records.get('follow_ups') || [];
  const followUp = allFollowUps.find((f: any) => f.id === req.params.id);
  if (!followUp) throw new AppError(404, 'FOLLOW_UP_NOT_FOUND', 'Follow-up not found.');

  const now = new Date().toISOString();
  if (req.body.status) followUp.status = req.body.status;
  if (req.body.date) followUp.date = req.body.date;
  if (req.body.notes !== undefined) followUp.notes = req.body.notes;
  if (req.body.privateNotes !== undefined) followUp.privateNotes = req.body.privateNotes;
  if (req.body.survivorNotes !== undefined) followUp.survivorNotes = req.body.survivorNotes;
  followUp.updatedAt = now;

  recordAudit(req.user!.id, 'followup_updated', followUp.id, { changes: req.body });
  return ok(res, followUp);
}));

// GET /api/v1/survivor/follow-ups: get survivor's own follow-up proposals & sessions
app.get('/api/v1/survivor/follow-ups', requireAuth, asyncRoute(async (req: AuthedRequest, res) => {
  const allFollowUps = store.records.get('follow_ups') || [];
  const myFollowUps = allFollowUps.filter((f: any) => f.victimToken === req.user!.victimToken);
  return ok(res, myFollowUps);
}));

// POST /api/v1/follow-ups/:id/survivor-action: survivor accepts or proposes reschedule
app.post('/api/v1/follow-ups/:id/survivor-action', requireAuth, body(z.object({
  action: z.enum(['accept', 'reschedule']),
  proposedDate: z.string().datetime().optional(),
  notes: z.string().max(1000).optional(),
})), asyncRoute(async (req: AuthedRequest, res) => {
  const allFollowUps = store.records.get('follow_ups') || [];
  const followUp = allFollowUps.find((f: any) => f.id === req.params.id);
  if (!followUp) throw new AppError(404, 'FOLLOW_UP_NOT_FOUND', 'Follow-up not found.');

  const now = new Date().toISOString();
  if (req.body.action === 'accept') {
    followUp.status = 'CONFIRMED';
    followUp.acceptedAt = now;
  } else if (req.body.action === 'reschedule') {
    followUp.status = 'RESCHEDULE_REQUESTED';
    followUp.proposedDate = req.body.proposedDate;
    followUp.rescheduledReason = req.body.notes;
    followUp.rescheduleRequestedAt = now;
  }
  followUp.updatedAt = now;
  recordAudit(req.user!.id, `followup_${req.body.action}ed`, followUp.id, { action: req.body.action, proposedDate: req.body.proposedDate });
  return ok(res, followUp);
}));

app.post('/api/v1/counsellor/:resource',requireAuth,requireRoles('COUNSELLOR'),body(z.record(z.unknown())),asyncRoute(async(req:AuthedRequest,res)=>ok(res,record(`counsellor:${req.params.resource}`,{id:id(),actor:req.user!.id,...req.body,createdAt:new Date().toISOString()}),201)));
import { getInterventionRecommendations } from './services/interventions.js';
import { TimelineEvent } from './types/domain.js';
// ...existing code...
app.get('/api/v1/interventions/recommendations', requireAuth, asyncRoute(async (req: AuthedRequest, res) => {
  const caseId = (store.records.get(`user:${req.user!.id}:cases`) || [])[0];
  const caseRecord = store.cases.find(c => c.id === caseId);
  if (!caseRecord) {
    return ok(res, [
      { type: 'breathe', label: 'Breathing space', reason: 'A gentle rhythm to help your body soften.', priority: 3 },
      { type: 'ground', label: 'Grounding exercise', reason: 'Notice what is around you.', priority: 3 },
      { type: 'listening', label: 'Talk to a counsellor', reason: 'Soft audio spaces.', priority: 3 },
      { type: 'psychoeducation', label: 'Understand what you are feeling', reason: 'Small, plain-language guides.', priority: 3 }
    ]);
  }
  return ok(res, getInterventionRecommendations(caseRecord));
}));
// N09 — Crisis response tracking: dedicated crisis-only response-time metric.
app.get('/api/v1/admin/crisis-metrics', requireAuth, requireRoles('COUNSELLOR', 'DISTRICT_ADMIN', 'STATE_ADMIN', 'NATIONAL_ADMIN'), asyncRoute(async (_req, res) => ok(res, computeCrisisResponseMetrics(store.records.get('audit:crisis') || []))));


app.post('/api/v1/ai/recommend',requireAuth,body(z.object({context:z.string().optional()})),asyncRoute(async(req:AuthedRequest,res)=>{
  // K01 — Intervention engine backend: rank the catalogue using case context,
  // the latest distress/recovery signal, and recent intervention outcomes,
  // instead of returning the same static list to everyone.
  const caseId = (store.records.get(`user:${req.user!.id}:cases`) || [])[0];
  const caseRecord = store.cases.find(c => c.id === caseId) ?? null;
  const observations = store.records.get(`checkins:${req.user!.id}`) || [];
  const latestAnalysis = observations.at(-1)?.ml ?? null;
  const recentInterventions = (store.records.get(`interventions:${req.user!.id}`) || []).slice(-5);
  const ranked = rankInterventions({ caseRecord, latestAnalysis, recentInterventions });
  return ok(res, ranked);
}));
app.post('/api/v1/interventions',requireAuth,body(z.object({type:z.string(),caseId:z.string().optional(),metadata:z.record(z.unknown()).optional()})),asyncRoute(async(req:AuthedRequest,res)=>{const now=new Date().toISOString(); return ok(res,record(`interventions:${req.user!.id}`,{id:id(),...req.body,status:'RECOMMENDED',recommendedAt:now,createdAt:now}),201)}));
app.post('/api/v1/interventions/:id/feedback',requireAuth,body(z.object({completed:z.boolean(),rating:z.number().min(1).max(5).optional(),note:z.string().max(1000).optional()})),asyncRoute(async(req:AuthedRequest,res)=>{
  const now = new Date().toISOString();
  const userInterventions = store.records.get(`interventions:${req.user!.id}`) || [];
  const target = userInterventions.find((i: any) => i.id === req.params.id);
  const feedback = { completed: req.body.completed, rating: req.body.rating, note: req.body.note, submittedAt: now };
  if (target) target.feedback = feedback;
  // K13 — Counsellor escalation from intervention: look at the last few outcomes
  // (not just this single one) to decide whether self-help content isn't enough
  // right now and a counsellor should be looped in directly.
  const recentOutcomes: InterventionOutcomeRecord[] = userInterventions.map((i: any) => ({ type: i.type, status: i.status, createdAt: i.createdAt, feedback: i.feedback }));
  const escalation = shouldEscalateToCounsellor(recentOutcomes);
  if (escalation.escalate) {
    recordAlert({ victimToken: req.user!.victimToken, caseReference: req.user!.victimToken, reason: escalation.reason ?? 'Intervention pattern requires counsellor follow-up.', source: 'intervention', requestedSupport: true, confidence: 0.6 });
  }
  return ok(res, { id: req.params.id, ...feedback, escalatedToCounsellor: escalation.escalate });
}));
app.post('/api/v1/interventions/:id/:action',requireAuth,body(z.object({}).passthrough()),asyncRoute(async(req:AuthedRequest,res)=>{const action=String(req.params.action); if(!['start','complete','skip'].includes(action)) throw new AppError(400,'INVALID_ACTION','Unsupported intervention action.'); const all=[...store.records.entries()].flatMap(([key, values])=>values.map((value:any)=>({key,value}))); const found=all.find(x=>x.key===`interventions:${req.user!.id}`&&x.value.id===req.params.id); if(!found) throw new AppError(404,'INTERVENTION_NOT_FOUND','Intervention not found.'); const now=new Date().toISOString(); Object.assign(found.value,action==='start'?{status:'STARTED',startedAt:now}:action==='complete'?{status:'COMPLETED',completedAt:now}:{status:'SKIPPED',skippedAt:now});
  if (action === 'skip') {
    const userInterventions = store.records.get(`interventions:${req.user!.id}`) || [];
    const recentOutcomes: InterventionOutcomeRecord[] = userInterventions.map((i: any) => ({ type: i.type, status: i.status, createdAt: i.createdAt, feedback: i.feedback }));
    const escalation = shouldEscalateToCounsellor(recentOutcomes);
    if (escalation.escalate) recordAlert({ victimToken: req.user!.victimToken, caseReference: req.user!.victimToken, reason: escalation.reason ?? 'Intervention pattern requires counsellor follow-up.', source: 'intervention', requestedSupport: true, confidence: 0.6 });
  }
  return ok(res,found.value);}));
app.get('/api/v1/hope-vault', requireAuth, asyncRoute(async (req: AuthedRequest, res) => {
  if (env.DATA_MODE === 'supabase' && supabase) {
    const data = await supabaseSelect('hope_vault', { victim_token: req.user!.victimToken });
    return ok(res, data);
  }
  return ok(res, store.records.get(`hope:${req.user!.id}`) || []);
}));

app.post('/api/v1/hope-vault', requireAuth, uploadImage.single('photo'), asyncRoute(async (req: AuthedRequest, res) => {
  const { type, title, content } = req.body;
  const now = new Date().toISOString();
  const itemData: any = { 
    id: id(), 
    victim_token: req.user!.victimToken, 
    type, 
    title, 
    content, 
    created_at: now 
  };

  if (type === 'photo' && req.file) {
    if (env.DATA_MODE === 'supabase' && supabase) {
      const { data, error } = await supabase.storage.from('hope-vault-photos').upload(`${req.user!.victimToken}/${id()}`, req.file.buffer, { contentType: req.file.mimetype });
      if (error) throw error;
      const { data: urlData } = supabase.storage.from('hope-vault-photos').getPublicUrl(data.path);
      itemData.image_url = urlData.publicUrl;
    } else {
      // In-memory demo mode has no file storage / static file server, so the photo
      // itself is embedded directly as a base64 data URL — it round-trips through
      // localStorage and the API response with no extra moving parts.
      itemData.image_url = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    }
  }

  if (env.DATA_MODE === 'supabase' && supabase) {
    const data = await supabaseInsert('hope_vault', itemData);
    return ok(res, data, 201);
  }
  
  record(`hope:${req.user!.id}`, itemData);
  return ok(res, itemData, 201);
}));

app.patch('/api/v1/hope-vault/:id', requireAuth, body(z.object({ title: z.string().min(1).optional(), content: z.string().optional() })), asyncRoute(async (req: AuthedRequest, res) => {
  if (env.DATA_MODE === 'supabase' && supabase) {
    const { data, error } = await supabase.from('hope_vault').update(req.body).eq('id', req.params.id).eq('victim_token', req.user!.victimToken).select().single();
    if (error) throw error;
    return ok(res, data);
  }
  const items = store.records.get(`hope:${req.user!.id}`) || [];
  const item = items.find((x: any) => x.id === req.params.id);
  if (!item) throw new AppError(404, 'NOT_FOUND', 'Item not found.');
  if (req.body.title !== undefined) item.title = req.body.title;
  if (req.body.content !== undefined) item.content = req.body.content;
  item.updated_at = new Date().toISOString();
  return ok(res, item);
}));

app.delete('/api/v1/hope-vault/:id', requireAuth, asyncRoute(async (req: AuthedRequest, res) => {
  if (env.DATA_MODE === 'supabase' && supabase) {
    const { error } = await supabase.from('hope_vault').delete().eq('id', req.params.id).eq('victim_token', req.user!.victimToken);
    if (error) throw error;
    return ok(res, { deleted: req.params.id });
  }
  const items = store.records.get(`hope:${req.user!.id}`) || [];
  const index = items.findIndex((x: any) => x.id === req.params.id);
  if (index === -1) throw new AppError(404, 'NOT_FOUND', 'Item not found.');
  items.splice(index, 1);
  return ok(res, { deleted: req.params.id });
}));
const safeCircleSchema = z.object({ name: z.string().min(1), relation: z.string().min(1), email: z.string().min(3), consentToContact: z.boolean() });
app.get('/api/v1/safe-circle', requireAuth, asyncRoute(async (req: AuthedRequest, res) => ok(res, store.records.get(`safe:${req.user!.id}`) || [])));
app.post('/api/v1/safe-circle', requireAuth, body(safeCircleSchema), asyncRoute(async (req: AuthedRequest, res) => {
  const contact = record(`safe:${req.user!.id}`, { id: id(), ...req.body, email: normalizeEmail(req.body.email) });
  const welcomeMessage = `Hi ${contact.name}, you've been added as a trusted ${String(contact.relation).toLowerCase()} on SAATH. You'll only hear from us again if they're going through a difficult moment and the app detects a genuine crisis signal.`;
  const results = await deliverToContact(contact, "You've been added to someone's SAATH Safe Circle", welcomeMessage);
  console.log(`[safe-circle] welcome email to ${contact.email}:`, JSON.stringify(results));
  record('safe_circle_events', { id: id(), contactId: contact.id, victimToken: req.user!.victimToken, trigger: 'contact_added', channels: results, createdAt: new Date().toISOString() });
  return ok(res, contact, 201);
}));
app.delete('/api/v1/safe-circle/:id', requireAuth, asyncRoute(async (req: AuthedRequest, res) => {
  const key = `safe:${req.user!.id}`;
  const contacts = store.records.get(key) || [];
  const index = contacts.findIndex((c: any) => c.id === req.params.id);
  if (index === -1) throw new AppError(404, 'NOT_FOUND', 'Contact not found.');
  contacts.splice(index, 1);
  store.records.set(key, contacts);
  return ok(res, { deleted: req.params.id });
}));
app.get('/api/v1/support/resources', requireAuth, asyncRoute(async (req: AuthedRequest, res) => {
  const category = req.query.category as string;
  const caseId = (store.records.get(`user:${req.user!.id}:cases`) || [])[0];
  const caseRecord = store.cases.find(c => c.id === caseId);
  const location = caseRecord ? `${caseRecord.city}, ${caseRecord.state}` : 'Jaipur, Rajasthan';

  if (!env.GOOGLE_PLACES_API_KEY) {
    return ok(res, [{ id: 'resource-1', name: 'Sakhi Counselling Centre', serviceType: 'Counselling', state: 'Rajasthan', district: 'Jaipur', language: 'English/Hindi', phone: '+9118000001122', availability: 'Open today', description: 'Trauma-informed counselling.' }]);
  }

  const query = category ? `${category} near ${location}` : `support services near ${location}`;
  const response = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${env.GOOGLE_PLACES_API_KEY}`);
  const data = await response.json();

  const resources = (data.results || []).map((place: any) => ({
    id: place.place_id,
    name: place.name,
    serviceType: category || 'General',
    state: location.split(',')[1]?.trim() || 'Unknown',
    district: location.split(',')[0]?.trim() || 'Unknown',
    phone: 'Phone not listed',
    availability: 'Open',
    description: place.formatted_address
  }));

  return ok(res, resources);
}));
app.get('/api/v1/community/posts',optionalCommunity,asyncRoute(async(_req,res)=>ok(res,store.records.get('community')||[])));
const safeCircleNotifySchema = z.object({ trigger: z.enum(['survivor_requested', 'crisis_alert']) });
app.post('/api/v1/safe-circle/:id/notify', requireAuth, body(safeCircleNotifySchema), asyncRoute(async (req: AuthedRequest, res) => {
  // M06 — Safe Circle notification: only fires under two explicitly defined
  // conditions, never as a side-effect of an unrelated action.
  //   1. 'survivor_requested' — the survivor tapped "notify" themselves.
  //   2. 'crisis_alert' — there is an open, unresolved crisis alert for this
  //      survivor, so the notification is corroborated by a real safety signal
  //      rather than trusted purely on the caller's say-so.
  const contacts = store.records.get(`safe:${req.user!.id}`) || [];
  const contact = contacts.find((c: any) => c.id === req.params.id);
  if (!contact || !contact.consentToContact) throw new AppError(404, 'CONTACT_NOT_FOUND', 'Contact not found or consent not given.');

  if (req.body.trigger === 'crisis_alert') {
    const alerts = store.records.get('alerts:all') || [];
    const hasOpenCrisisAlert = alerts.some((a: any) => a.victimToken === req.user!.victimToken && a.crisis && a.status !== 'RESOLVED');
    if (!hasOpenCrisisAlert) throw new AppError(409, 'CONDITION_NOT_MET', 'No open crisis alert exists for this survivor; notification condition not met.');
  }

    const message = `This is a message from SAATH on behalf of your friend. They wanted you to know they're thinking of you.`;
  const results = await deliverToContact(contact, 'SAATH: a message from your friend', message);
  record('safe_circle_events', { id: id(), contactId: contact.id, victimToken: req.user!.victimToken, trigger: req.body.trigger, channels: results, createdAt: new Date().toISOString() });
  recordAudit(req.user!.id, 'safe_circle_notify', contact.id, { channels: results, trigger: req.body.trigger });
  return ok(res, { status: 'sent', trigger: req.body.trigger, channels: results });
}));

app.post('/api/v1/community/posts', requireAuth, body(z.object({ body: z.string().min(1).max(5000), language: z.string().default('en') })), asyncRoute(async (req: AuthedRequest, res) => {
  const { body, language } = req.body;
  const analysis = await analyzeText({ victimToken: req.user!.victimToken || 'unknown', text: body, language });
  // M11 — Community moderation pipeline: unsafe content is blocked BEFORE it ever reaches
  // the public 'community' list — GET /community/posts only ever reads from that list, so a
  // blocked or queued post is never visible to other survivors.
  const moderation = moderatePost(body, analysis);
  const postId = id();
  const now = new Date().toISOString();

  if (moderation.decision === 'blocked') {
    record('community_moderation', { id: id(), postId, authorToken: req.user!.victimToken, body, reason: moderation.reason, status: 'open', createdAt: now });
    throw new AppError(422, 'CONTENT_BLOCKED', moderation.reason);
  }

  if (moderation.decision === 'queued_for_review') {
    record('community_moderation', { id: id(), postId, authorToken: req.user!.victimToken, body, reason: moderation.reason, status: 'open', createdAt: now });
    if (analysis.crisis) recordAlert({ victimToken: req.user!.victimToken, caseReference: req.user!.victimToken, reason: 'Community post flagged for crisis language.', source: 'checkin', crisis: true, confidence: analysis.confidence });
    return ok(res, { id: postId, moderationStatus: 'pending', message: 'Your post is held for a quick review before it goes live.' }, 202);
  }

  const post = record('community', { id: postId, authorToken: req.user!.victimToken, body, moderationStatus: 'approved', createdAt: now });
  return ok(res, post, 201);
}));
app.get('/api/v1/community/moderation-queue', requireAuth, requireRoles('COUNSELLOR', 'DISTRICT_ADMIN'), asyncRoute(async (_req, res) => ok(res, (store.records.get('community_moderation') || []).filter((m: any) => m.status === 'open'))));
app.post('/api/v1/community/moderation-queue/:id/decision', requireAuth, requireRoles('COUNSELLOR', 'DISTRICT_ADMIN'), body(z.object({ decision: z.enum(['approve', 'reject']) })), asyncRoute(async (req: AuthedRequest, res) => {
  const queue = store.records.get('community_moderation') || [];
  const item = queue.find((m: any) => m.id === req.params.id);
  if (!item) throw new AppError(404, 'NOT_FOUND', 'Moderation item not found.');
  const now = new Date().toISOString();
  item.status = req.body.decision === 'approve' ? 'approved' : 'rejected';
  item.resolvedAt = now;
  item.resolvedBy = req.user!.id;
  if (req.body.decision === 'approve') {
    record('community', { id: item.postId, authorToken: item.authorToken, body: item.body, moderationStatus: 'approved', createdAt: now });
  }
  recordAudit(req.user!.id, `community_post_${req.body.decision}d`, item.postId, {});
  return ok(res, item);
}));
app.post('/api/v1/notifications/sms',requireAuth,body(z.object({phone:z.string().min(8),message:z.string().min(1).max(480)})),asyncRoute(async(req:AuthedRequest,res)=>{await notificationProvider.sendMessage(normalizePhone(req.body.phone),req.body.message); return ok(res,{status:'sent',channel:'sms'},202)}));
app.get('/api/v1/notifications', requireAuth, asyncRoute(async (req: AuthedRequest, res) => {
  if (req.user!.role === 'SURVIVOR') {
    const userCase = store.cases.find(
      (c) =>
        c.victimToken === req.user!.victimToken ||
        c.id === req.user!.id.replace('docket-', '') ||
        (store.records.get(`user:${req.user!.id}:cases`) || []).includes(c.id)
    );
    if (userCase) {
      const notifs = syncSurvivorNotifications(req.user!.id, userCase, store);
      return ok(res, notifs);
    }
  }
  return ok(res, store.records.get(`notifications:${req.user!.id}`) || []);
}));

const markSingleNotificationRead = (req: AuthedRequest, res: express.Response) => {
  const notifs: any[] = store.records.get(`notifications:${req.user!.id}`) || [];
  const targetId = req.params.id;
  const target = notifs.find((n) => n.id === targetId);
  if (target) {
    target.read = true;
  }
  store.records.set(`notifications:${req.user!.id}`, notifs);
  return ok(res, { id: targetId, read: true });
};

app.patch('/api/v1/notifications/:id/read', requireAuth, asyncRoute(async (req: AuthedRequest, res) => markSingleNotificationRead(req, res)));
app.post('/api/v1/notifications/:id/read', requireAuth, asyncRoute(async (req: AuthedRequest, res) => markSingleNotificationRead(req, res)));

const markAllNotificationsRead = (req: AuthedRequest, res: express.Response) => {
  const notifs: any[] = store.records.get(`notifications:${req.user!.id}`) || [];
  notifs.forEach((n) => {
    n.read = true;
  });
  store.records.set(`notifications:${req.user!.id}`, notifs);
  return ok(res, { markedAllRead: true, count: notifs.length });
};

app.post('/api/v1/notifications/mark-all-read', requireAuth, asyncRoute(async (req: AuthedRequest, res) => markAllNotificationsRead(req, res)));
app.patch('/api/v1/notifications/read-all', requireAuth, asyncRoute(async (req: AuthedRequest, res) => markAllNotificationsRead(req, res)));

// Shared helper for the three dedicated ADM routes and the generic /admin/:scope
// fallback below — pulls interventions once so each route doesn't repeat the scan.
const collectInterventions = () => [...store.records.entries()].flatMap(([key, values]) => key.startsWith('interventions:') ? values : []);

// ADM-01 — GET /admin/district: aggregated stats scoped to one district.
// A DISTRICT_ADMIN can only ever see their own assigned district from JWT session.
// STATE_ADMIN/NATIONAL_ADMIN may pass ?district= only if within their authorized scope.
app.get('/api/v1/admin/district', requireAuth, requireRoles('DISTRICT_ADMIN', 'STATE_ADMIN', 'NATIONAL_ADMIN'), asyncRoute(async (req: AuthedRequest, res) => {
  const scopeInfo = resolveAdminScope(req.user!);
  let targetDistrict = scopeInfo.district;
  if (req.user!.role === 'STATE_ADMIN') {
    const requestedDistrict = req.query.district ? String(req.query.district) : undefined;
    targetDistrict = requestedDistrict ?? scopeInfo.district ?? 'South Delhi';
  } else if (req.user!.role === 'NATIONAL_ADMIN') {
    targetDistrict = String(req.query.district ?? 'South Delhi');
  }
  
  if (!targetDistrict) throw new AppError(400, 'DISTRICT_REQUIRED', 'A district is required for this scope.');
  
  let cases = store.cases.filter((c: any) => (c.district || '').toLowerCase() === targetDistrict.toLowerCase());
  if (req.user!.role === 'STATE_ADMIN' && scopeInfo.state) {
    cases = cases.filter((c: any) => (c.state || '').toLowerCase() === scopeInfo.state!.toLowerCase());
  }
  
  const allowedTokens = new Set(cases.map(c => c.victimToken));
  const allAlerts = store.records.get('alerts:all') || [];
  const scopedAlerts = allAlerts.filter((a: any) => allowedTokens.has(a.victimToken));
  
  const payload = buildAdminAggregatePayload({ scope: `district:${targetDistrict}`, cases, alerts: scopedAlerts, interventions: collectInterventions() });
  return ok(res, minimize(payload, MINIMIZATION_SCHEMA.adminAggregateOutput));
}));

// ADM-02 — GET /admin/state: aggregated stats scoped to one state.
// A STATE_ADMIN can only ever see their own assigned state from JWT session.
// NATIONAL_ADMIN may pass ?state= to inspect any state.
app.get('/api/v1/admin/state', requireAuth, requireRoles('STATE_ADMIN', 'NATIONAL_ADMIN'), asyncRoute(async (req: AuthedRequest, res) => {
  const scopeInfo = resolveAdminScope(req.user!);
  const targetState = req.user!.role === 'STATE_ADMIN' ? scopeInfo.state : String(req.query.state ?? scopeInfo.state ?? 'Delhi');
  if (!targetState) throw new AppError(400, 'STATE_REQUIRED', 'A state is required for this scope.');
  
  const cases = store.cases.filter((c: any) => (c.state || '').toLowerCase() === targetState.toLowerCase());
  const allowedTokens = new Set(cases.map(c => c.victimToken));
  const allAlerts = store.records.get('alerts:all') || [];
  const scopedAlerts = allAlerts.filter((a: any) => allowedTokens.has(a.victimToken));
  
  const payload = buildAdminAggregatePayload({ scope: `state:${targetState}`, cases, alerts: scopedAlerts, interventions: collectInterventions() });
  return ok(res, minimize(payload, MINIMIZATION_SCHEMA.adminAggregateOutput));
}));

// ADM-03 — GET /admin/national: aggregated stats across every case, no district/state filter.
app.get('/api/v1/admin/national', requireAuth, requireRoles('NATIONAL_ADMIN'), asyncRoute(async (_req: AuthedRequest, res) => {
  const payload = buildAdminAggregatePayload({ scope: 'national', cases: store.cases, alerts: store.records.get('alerts:all') || [], interventions: collectInterventions() });
  return ok(res, minimize(payload, MINIMIZATION_SCHEMA.adminAggregateOutput));
}));

// ADM-04 — GET /admin/counsellors: roster of counsellors scoped strictly to admin jurisdiction.
app.get('/api/v1/admin/counsellors', requireAuth, requireRoles('DISTRICT_ADMIN', 'STATE_ADMIN', 'NATIONAL_ADMIN'), asyncRoute(async (req: AuthedRequest, res) => {
  const { counsellors } = getScopedAdminDataset(req.user!);
  const summaries = counsellors.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    specialisation: c.specialisation,
    state: c.state,
    status: c.status,
    casesAssigned: c.casesAssigned ?? 0,
  }));
  return ok(res, summaries);
}));

// ADM-05 — GET /admin/reports: comprehensive scoped report for Overview / Cases / Reports pages.
app.get('/api/v1/admin/reports', requireAuth, requireRoles('DISTRICT_ADMIN', 'STATE_ADMIN', 'NATIONAL_ADMIN'), asyncRoute(async (req: AuthedRequest, res) => {
  const { scope, cases, alerts, followUps } = getScopedAdminDataset(req.user!);
  const report = generateAdminReport({
    cases,
    alerts,
    followUps,
    scope: scope.scopeName,
    scopeTitle: scope.scopeTitle,
    scopeDistrict: scope.district,
    scopeState: scope.state,
  });
  return res.status(200).json(report);
}));

// ADM-06 — GET /admin/trends: scoped trend statistics.
app.get('/api/v1/admin/trends', requireAuth, requireRoles('DISTRICT_ADMIN', 'STATE_ADMIN', 'NATIONAL_ADMIN'), asyncRoute(async (req: AuthedRequest, res) => {
  const { cases, alerts } = getScopedAdminDataset(req.user!);
  const distress = computeDistressStatistics(cases);
  const recovery = computeRecoveryStatistics(cases);
  const operational = computeOperationalMetrics(alerts);
  return ok(res, {
    distressDistribution: distress.distressDistribution,
    recoveryTrend: recovery.recoveryTrend,
    avgResolutionTimeMs: operational.avgResolutionTimeMs,
  });
}));

// ADM-07 — GET /admin/distress-stats: scoped distress breakdown.
app.get('/api/v1/admin/distress-stats', requireAuth, requireRoles('DISTRICT_ADMIN', 'STATE_ADMIN', 'NATIONAL_ADMIN'), asyncRoute(async (req: AuthedRequest, res) => {
  const { cases } = getScopedAdminDataset(req.user!);
  return ok(res, computeDistressStatistics(cases));
}));

// ADM-08 — GET /admin/recovery-stats: scoped recovery breakdown.
app.get('/api/v1/admin/recovery-stats', requireAuth, requireRoles('DISTRICT_ADMIN', 'STATE_ADMIN', 'NATIONAL_ADMIN'), asyncRoute(async (req: AuthedRequest, res) => {
  const { cases } = getScopedAdminDataset(req.user!);
  return ok(res, computeRecoveryStatistics(cases));
}));

// ADM-09 — GET /admin/operational-metrics: scoped alert & response metrics.
app.get('/api/v1/admin/operational-metrics', requireAuth, requireRoles('DISTRICT_ADMIN', 'STATE_ADMIN', 'NATIONAL_ADMIN'), asyncRoute(async (req: AuthedRequest, res) => {
  const { alerts } = getScopedAdminDataset(req.user!);
  return ok(res, computeOperationalMetrics(alerts));
}));

// Generic fallback — strictly scoped according to user role and prevents tampering
app.get('/api/v1/admin/:scope',requireAuth,requireRoles('DISTRICT_ADMIN','STATE_ADMIN','NATIONAL_ADMIN'),asyncRoute(async(req: AuthedRequest,res)=>{
  const { scope, cases, alerts } = getScopedAdminDataset(req.user!);
  const payload = buildAdminAggregatePayload({ scope: scope.scopeName, cases, alerts, interventions: collectInterventions() });
  return ok(res, { ...minimize(payload, MINIMIZATION_SCHEMA.adminAggregateOutput), alertStats: payload.alertStats, interventionResponseStats: payload.interventionResponseStats, caseStageStats: payload.caseStageStats }); }));
app.post('/api/v1/notifications/reminder',requireAuth,body(z.object({type:z.enum(['checkin','followup','support']).default('checkin'),daysSinceLastCheckin:z.number().int().min(0).default(0),scheduledFor:z.string().datetime().optional()})),asyncRoute(async(req:AuthedRequest,res)=>{
  // D16 — Gentle reminder escalation: step forward through the tone ladder based on the
  // survivor's own reminder history, rather than jumping straight to a firm tone the first
  // time a long gap is observed.
  const history = store.records.get(`notifications:reminders:${req.user!.id}`) || [];
  const escalated = nextEscalationStage(req.body.daysSinceLastCheckin, history);
  return ok(res,record(`notifications:reminders:${req.user!.id}`,{id:id(),type:req.body.type,daysSinceLastCheckin:req.body.daysSinceLastCheckin,scheduledFor:req.body.scheduledFor,message:escalated.message,tone:escalated.tone,createdAt:new Date().toISOString(),status:'scheduled'}),201);
}));

// F28 — Follow-up response tracking: a survivor's response (or explicit non-response) to a
// counsellor-created follow-up is captured as its own engagement_signal, separate from the
// follow-up record itself.
app.post('/api/v1/follow-ups/:id/respond', requireAuth, body(z.object({ responded: z.boolean(), note: z.string().max(1000).optional() })), asyncRoute(async (req: AuthedRequest, res) => {
  const signal = trackFollowUpResponse(record, id, { userId: req.user!.id, victimToken: req.user!.victimToken, followUpId: String(req.params.id), responded: req.body.responded, metadata: { note: req.body.note } });
  recordAudit(req.user!.id, 'followup_responded', String(req.params.id), { responded: req.body.responded });
  return ok(res, signal, 201);
}));

// F29 — Engagement trend computation, surfaced to the survivor's own dashboard widget.
app.get('/api/v1/engagement/trend', requireAuth, asyncRoute(async (req: AuthedRequest, res) => {
  const signals = store.records.get(`engagement:${req.user!.id}`) || [];
  return ok(res, computeEngagementTrend(signals));
}));

app.post('/api/v1/notifications/taara-reengagement', requireAuth, asyncRoute(async (req: AuthedRequest, res) => {
  const lastInteraction = (store.records.get(`taara:conversations:${req.user!.id}`) || []).at(-1);
  const daysSince = lastInteraction ? (Date.now() - new Date(lastInteraction.createdAt).getTime()) / (1000 * 60 * 60 * 24) : 99;
  
  if (daysSince >= 3) {
    const message = "TAARA is here whenever you'd like to talk. No pressure, just a gentle reminder.";
    record(`notifications:${req.user!.id}`, { id: id(), title: "TAARA", message, createdAt: new Date().toISOString(), read: false });
    return ok(res, { status: 'sent' });
  }
  return ok(res, { status: 'not_needed' });
}));
import { getCaseAwareLegalContent, searchLegalKnowledgeBase } from './services/legal/index.js';

// LEG-01 — GET /legal/content: Case-contextualised, verified legal & rights framework.
app.get('/api/v1/legal/content', requireAuth, asyncRoute(async (req: AuthedRequest, res) => {
  const caseId = req.query.caseId ? String(req.query.caseId) : undefined;
  const matchedCase = caseId
    ? store.cases.find(c => c.id === caseId || c.docket === caseId || c.victimToken === caseId)
    : store.cases.find(c => c.victimToken === req.user!.victimToken);

  const payload = getCaseAwareLegalContent({
    caseRecord: matchedCase ?? null,
    language: String(req.query.language ?? 'en'),
  });

  return ok(res, payload);
}));

// LEG-02 — POST /legal/query: Verified retrieval first, safe plain-language guidance with official citations.
app.post('/api/v1/legal/query', requireAuth, body(z.object({ query: z.string().min(1).max(1000), caseId: z.string().optional() })), asyncRoute(async (req: AuthedRequest, res) => {
  const matchedCase = req.body.caseId
    ? store.cases.find(c => c.id === req.body.caseId || c.docket === req.body.caseId || c.victimToken === req.body.caseId)
    : store.cases.find(c => c.victimToken === req.user!.victimToken);

  const result = searchLegalKnowledgeBase(req.body.query, matchedCase ?? null);
  return ok(res, result);
}));

app.post('/api/v1/demo/reset',requireAuth,requireRoles('NATIONAL_ADMIN'),asyncRoute(async(_req,res)=>{if(env.NODE_ENV==='production') throw new AppError(404,'NOT_FOUND','Not found.'); store.records.clear(); store.users.clear(); store.blocklist.clear(); return ok(res,{reset:true,mode:'demo_only'});}));
function optionalCommunity(req:express.Request,_res:express.Response,next:express.NextFunction){next();}
app.use((err:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{if(err instanceof multer.MulterError&&err.code==='LIMIT_FILE_SIZE') return fail(res,new AppError(413,'AUDIO_TOO_LARGE',`Audio must be no larger than ${env.UPLOAD_MAX_BYTES} bytes.`)); return fail(res,err instanceof Error?err:new Error('Unknown error'));}); export { app };
