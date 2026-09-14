import { describe, expect, it, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { store } from '../src/db/store.js';
import * as ml from '../src/services/ml.js';
import * as geminiEscalation from '../src/services/geminiEscalation.js';
import * as sahayakService from '../src/services/sahayak.js';

import { env } from '../src/config/env.js';

const docket = 'NHAA-RJ-2026-004821';

const connect = async () => {
  const response = await request(app).post('/api/v1/cases/connect').send({ reference_id: docket });
  return {
    token: response.body.data.accessToken as string,
    user: response.body.data.user,
    caseRecord: response.body.data.case,
  };
};

describe('Sahayak Pipeline & Dashboard Integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (env as any).GEMINI_API_KEY = 'test-gemini-key';
    store.users.clear();
    store.records.clear();
    store.blocklist.clear();
  });

  it('persists check-ins from Sahayak chat, calls escalation prediction, updates case record, and returns to counsellor dashboard', async () => {
    // 1. Mock ML analysis (from Render /ml/analyze-text)
    vi.spyOn(ml, 'analyzeText').mockResolvedValue({
      distressScore: 62,
      recoveryScore: 40,
      confidence: 0.85,
      escalationProbability: 0.65,
      modelName: 'saath-text-fusion-pipeline',
      modelVersion: '1.0.0',
      pipelineVersion: 'ml-api-analyze-text-v2',
      signals: {
        sentiment: 'negative',
        emotion: 'fear',
        themes: ['court stress', 'sleep disturbance'],
      },
      contributingFactors: [
        { factor: 'court_stress', direction: 'increased_distress', weight: 0.7 },
        { factor: 'sleep_disturbance', direction: 'increased_distress', weight: 0.6 },
      ],
      crisis: false,
      insufficientEvidence: false,
      status: 'available',
    });

    // 2. Mock 20-feature escalation prediction (Gemini escalation)
    vi.spyOn(geminiEscalation, 'predictEscalation').mockResolvedValue(
      JSON.stringify({
        escalation_probability: 68,
        risk_level: 'HIGH',
        confidence: 0.82,
        time_horizon: '7 days',
        contributing_factors: ['Court stress from upcoming hearing', 'Persistent sleep disruption'],
        early_warning_signals: ['Rising distress trajectory'],
        recommended_followup: 'Schedule counsellor check-in within 48 hours',
      })
    );

    // 3. Connect survivor session
    const { token, user } = await connect();

    // 4. Send Sahayak message
    const sahayakResponse = await request(app)
      .post('/api/v1/ai/sahayak')
      .set('Authorization', `Bearer ${token}`)
      .send({
        message: 'I am really struggling to sleep because of the upcoming hearing.',
      });

    expect(sahayakResponse.status).toBe(200);
    expect(sahayakResponse.body.data.reply).toBeDefined();
    expect(typeof sahayakResponse.body.data.reply).toBe('string');
    // Verify it doesn't end with the old repetitive canned template
    expect(sahayakResponse.body.data.reply).not.toContain('Would you like to share whether this feels connected to your case, a recent check-in, or something happening today?');

    // 5. Verify check-in was persisted into store.records under checkins:${userId}
    const checkIns = store.records.get(`checkins:${user.id}`) ?? [];
    expect(checkIns.length).toBe(1);
    expect(checkIns[0].type).toBe('sahayak_chat');
    expect(checkIns[0].ml.distressScore).toBe(62);

    // 6. Verify caseRecord in store.cases was updated with risk level and distress
    const matchedCase = store.cases.find((c) => c.docket === docket);
    expect(matchedCase?.riskLevel).toBe('HIGH');
    expect(matchedCase?.currentDistressScore).toBe(62);
    expect(matchedCase?.predicted7dScore).toBe(68);

    // 7. Verify sahayak:assessments has rich prediction for dashboards
    const assessments = store.records.get('sahayak:assessments') ?? [];
    expect(assessments.length).toBe(1);
    expect(assessments[0].prediction.risk_level).toBe('HIGH');
    expect(assessments[0].prediction.escalation_probability).toBe(68);
    expect(assessments[0].prediction.time_horizon).toBe('7 days');
    expect(assessments[0].prediction.modelName).toBe('gemini-escalation-20f');

    // 8. Verify Counsellor/Admin API receives the prediction
    // Staff token for admin/counsellor
    const staffRes = await request(app)
      .post('/api/v1/auth/staff-token')
      .send({ role: 'DISTRICT_ADMIN', staffId: 'admin-001' });
    const staffToken = staffRes.body.data.accessToken;

    const sahayakAssessmentsRes = await request(app)
      .get('/api/v1/counsellor/sahayak-assessments')
      .set('Authorization', `Bearer ${staffToken}`);
    expect(sahayakAssessmentsRes.status).toBe(200);
    expect(sahayakAssessmentsRes.body.data.length).toBe(1);
    expect(sahayakAssessmentsRes.body.data[0].prediction.risk_level).toBe('HIGH');

    // 9. Verify case escalation API returns the stored prediction
    const caseEscalationRes = await request(app)
      .get(`/api/v1/cases/${docket}/escalation`)
      .set('Authorization', `Bearer ${staffToken}`);
    expect(caseEscalationRes.status).toBe(200);
    expect(caseEscalationRes.body.data.status).toBe('available');
    expect(caseEscalationRes.body.data.result.risk_level).toBe('HIGH');
    expect(caseEscalationRes.body.data.result.escalation_probability).toBe(68);
  });

  it('preserves crisis safety response and records alert on danger keywords', async () => {
    vi.spyOn(ml, 'analyzeText').mockResolvedValue({
      distressScore: 90,
      recoveryScore: 10,
      confidence: 0.95,
      escalationProbability: 0.95,
      modelName: 'saath-text-fusion-pipeline',
      modelVersion: '1.0.0',
      pipelineVersion: 'ml-api-analyze-text-v2',
      signals: {},
      contributingFactors: [],
      crisis: true,
      insufficientEvidence: false,
      status: 'available',
    });

    const { token } = await connect();

    const response = await request(app)
      .post('/api/v1/ai/sahayak')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'I cannot go on anymore, I want to hurt myself.' });

    expect(response.status).toBe(200);
    expect(response.body.data.reply).toContain('safety matters right now more than anything else');
    const alerts = store.records.get('alerts:all') ?? [];
    expect(alerts.some((a: any) => a.crisis)).toBe(true);
  });

  it('handles safety clarifications and short replies in context without abruptly introducing case stage', async () => {
    // 1. Normal case-related stress message
    const caseStressReply = await sahayakService.generateSahayakReply({
      message: 'I am really stressed about court and my next hearing.',
      history: [],
      caseDetails: { stage: 'Investigation', daysUntilHearing: 10 },
    });
    expect(caseStressReply).toMatch(/(hearing|court|case|in 10 days)/i);
    expect(caseStressReply).not.toMatch(/^(I understand|That sounds difficult)/i);

    // 2. Explicit self-harm message (via pipeline endpoint)
    vi.spyOn(ml, 'analyzeText').mockResolvedValueOnce({
      distressScore: 90,
      recoveryScore: 10,
      confidence: 0.95,
      escalationProbability: 0.95,
      modelName: 'saath-text-fusion-pipeline',
      modelVersion: '1.0.0',
      pipelineVersion: 'ml-api-analyze-text-v2',
      signals: {},
      contributingFactors: [],
      crisis: true,
      insufficientEvidence: false,
      status: 'available',
    });
    const { token } = await connect();
    const crisisRes = await request(app)
      .post('/api/v1/ai/sahayak')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'I want to hurt myself.' });
    expect(crisisRes.status).toBe(200);
    expect(crisisRes.body.data.reply).toContain('safety matters right now more than anything else');
    expect(crisisRes.body.data.reply).toContain('Safe Circle');

    // 3. User clarifying they are not in immediate danger
    const conversationAfterCrisis = [
      { role: 'user' as const, text: 'I want to hurt myself.' },
      { role: 'assistant' as const, text: crisisRes.body.data.reply },
    ];
    const clarificationReply = await sahayakService.generateSahayakReply({
      message: 'I am not in immediate danger',
      history: conversationAfterCrisis,
      caseDetails: { stage: 'Investigation', docket: 'NHAA-RJ-2026-004821' },
    });
    // Should acknowledge the clarification and relief warmly
    expect(clarificationReply).toMatch(/(clarifying|letting me know|glad.*not in immediate danger|safe)/i);
    // Should NOT repeat emergency numbers, hospital, or safety disclaimers
    expect(clarificationReply).not.toContain('hospital');
    expect(clarificationReply).not.toContain('emergency number');
    // Offers gentle next steps (talk about what's weighing or case help)
    expect(clarificationReply).toMatch(/(weighing|case)/i);

    // 4. User replying "okay" after a safety response
    const replyAfterSafety = await sahayakService.generateSahayakReply({
      message: 'okay',
      history: conversationAfterCrisis,
      caseDetails: { stage: 'Investigation' },
    });
    // Should stay in conversational context (checking in / taking things slowly)
    expect(replyAfterSafety).toMatch(/(feeling|moment|slowly|checking in|right here)/i);
    // Must NOT abruptly blurt out case stage
    expect(replyAfterSafety).not.toContain('Your case is currently at the Investigation stage');

    // 5. Short replies using previous conversation context
    const conversationWithOffer = [
      ...conversationAfterCrisis,
      { role: 'user' as const, text: 'I am not in immediate danger' },
      { role: 'assistant' as const, text: clarificationReply },
    ];
    // User replies "yes" to "Would you like to talk about what has been weighing on you..."
    const followUpReply = await sahayakService.generateSahayakReply({
      message: 'yes',
      history: conversationWithOffer,
      caseDetails: { stage: 'Investigation' },
    });
    expect(followUpReply).toMatch(/(heaviest|weighing|share|right here|listening)/i);
    expect(followUpReply).not.toContain('Your case is currently at the Investigation stage');

    // User replies "no" to general offer
    const noReply = await sahayakService.generateSahayakReply({
      message: 'no',
      history: conversationWithOffer,
      caseDetails: { stage: 'Investigation' },
    });
    expect(noReply).toMatch(/(okay|ready|pressure|right here)/i);
    expect(noReply).not.toContain('Your case is currently at the Investigation stage');
  });

  it('generates varied replies without repetitive opening phrases and avoids asking questions on every turn', async () => {
    // Test sequential conversation turns
    const conversation: Array<{ role: 'user' | 'assistant'; text: string }> = [];

    // Turn 1: Sleep difficulty
    const reply1 = await sahayakService.generateSahayakReply({
      message: 'I cannot sleep at night.',
      history: conversation,
      caseDetails: { stage: 'Investigation', daysUntilHearing: 14 },
    });

    // Verify reply 1 does not start with canned openers
    expect(reply1).not.toMatch(/^(I understand|Thank you for sharing|That sounds difficult|I hear you|I'm so sorry|It sounds like)/i);
    conversation.push({ role: 'user', text: 'I cannot sleep at night.' });
    conversation.push({ role: 'assistant', text: reply1 });

    // Turn 2: Continuing the conversation
    const reply2 = await sahayakService.generateSahayakReply({
      message: 'My mind just keeps racing about what happened.',
      history: conversation,
      caseDetails: { stage: 'Investigation', daysUntilHearing: 14 },
    });

    // Verify reply 2 does not repeat canned openers and does not repeat reply1
    expect(reply2).not.toMatch(/^(I understand|Thank you for sharing|That sounds difficult|I hear you|I'm so sorry|It sounds like)/i);
    expect(reply2).not.toBe(reply1);

    // Turn 3: Expressing fatigue
    conversation.push({ role: 'user', text: 'My mind just keeps racing about what happened.' });
    conversation.push({ role: 'assistant', text: reply2 });

    const reply3 = await sahayakService.generateSahayakReply({
      message: 'I just feel so exhausted during the day.',
      history: conversation,
      caseDetails: { stage: 'Investigation', daysUntilHearing: 14 },
    });

    expect(reply3).not.toMatch(/^(I understand|Thank you for sharing|That sounds difficult|I hear you|I'm so sorry|It sounds like)/i);
    expect(reply3).not.toBe(reply2);

    // Verify that across the three turns, not every reply ends in a question
    const questionsCount = [reply1, reply2, reply3].filter((r) => r.includes('?')).length;
    expect(questionsCount).toBeLessThanOrEqual(2);
  });

  it('accurately answers factual questions about connected synthetic case NHAA-RJ-2026-004821 without guessing', async () => {
    // Mock ML analysis for text checks
    vi.spyOn(ml, 'analyzeText').mockResolvedValue({
      distressScore: 50,
      recoveryScore: 50,
      confidence: 0.8,
      escalationProbability: 0.3,
      modelName: 'saath-text-fusion-pipeline',
      modelVersion: '1.0.0',
      pipelineVersion: 'ml-api-analyze-text-v2',
      signals: {},
      contributingFactors: [],
      crisis: false,
      insufficientEvidence: false,
      status: 'available',
    });

    // 1. Connect session for docket NHAA-RJ-2026-004821
    const { token, caseRecord } = await connect();
    expect(caseRecord.docket).toBe('NHAA-RJ-2026-004821');

    // Helper to send question to Sahayak endpoint
    const askSahayak = async (message: string) => {
      const res = await request(app)
        .post('/api/v1/ai/sahayak')
        .set('Authorization', `Bearer ${token}`)
        .send({ message });
      expect(res.status).toBe(200);
      return res.body.data.reply as string;
    };

    // Question 1: What is my case number?
    const q1Reply = await askSahayak('What is my case number?');
    expect(q1Reply).toContain('NHAA-RJ-2026-004821');
    // Ensure no internal technical details exposed
    expect(q1Reply).not.toMatch(/(distressScore|escalationProbability|gemini|render|modelVersion)/i);

    // Question 2: Which state and district is my case from?
    const q2Reply = await askSahayak('Which state and district is my case from?');
    expect(q2Reply).toContain('Rajasthan');
    expect(q2Reply).toContain('Jaipur');

    // Question 3: What type of case do I have?
    const q3Reply = await askSahayak('What type of case do I have?');
    expect(q3Reply).toContain('Caste-based Violence');

    // Question 4: What stage is my case currently in?
    const q4Reply = await askSahayak('What stage is my case currently in?');
    expect(q4Reply).toContain('Investigation');

    // Question 5: What language have I selected?
    const q5Reply = await askSahayak('What language have I selected?');
    expect(q5Reply).toContain('Hindi');

    // Question 6: Who is my assigned counsellor?
    const q6Reply = await askSahayak('Who is my assigned counsellor?');
    expect(q6Reply).toContain('Ravi Kumar');

    // Question 7: What support or services are currently active for me?
    const q7Reply = await askSahayak('What support or services are currently active for me?');
    expect(q7Reply).toMatch(/Counsellor/i);
    expect(q7Reply).toMatch(/Legal Aid/i);
    expect(q7Reply).toMatch(/Protection/i);
    expect(q7Reply).toMatch(/Financial Relief/i);

    // Verify unavailable field handling (does not invent info)
    const replyMissingField = await sahayakService.generateSahayakReply({
      message: 'Who is my assigned counsellor?',
      caseDetails: {
        docket: 'TEST-001',
        // assignedCounsellorName omitted
      },
    });
    expect(replyMissingField).toContain('do not have an assigned counsellor');
  }, 30000);

  it('updates lastActive dynamically on meaningful survivor activity and does NOT update on counsellor case view', async () => {
    // 1. Log in as Counsellor Ravi Kumar (counsellor-002)
    const counsellorLoginRes = await request(app)
      .post('/api/v1/auth/counsellor-login')
      .send({ email: 'ravi@saath.com', password: 'saath123' });
    expect(counsellorLoginRes.status).toBe(200);
    const counsellorToken = counsellorLoginRes.body.data.accessToken;

    // 2. Fetch initial counsellor cases
    const initialCasesRes = await request(app)
      .get('/api/v1/counsellor/cases')
      .set('Authorization', `Bearer ${counsellorToken}`);
    expect(initialCasesRes.status).toBe(200);
    const targetCase = initialCasesRes.body.data.find((c: any) => c.docket === docket);
    expect(targetCase).toBeDefined();
    const initialLastActive = targetCase.lastActive; // Initial lastActive (e.g. null or prior seeded activity)

    // 3. Counsellor opens the case — verify lastActive does NOT change
    const viewCaseRes = await request(app)
      .get(`/api/v1/counsellor/cases/${targetCase.id}`)
      .set('Authorization', `Bearer ${counsellorToken}`);
    expect(viewCaseRes.status).toBe(200);
    expect(viewCaseRes.body.data.case.lastActive).toBe(initialLastActive);

    // 4. Survivor logs in and performs a real mood check-in
    const { token: survivorToken, user: survivorUser } = await connect();
    await request(app)
      .post('/api/v1/consents')
      .set('Authorization', `Bearer ${survivorToken}`)
      .send({ consent_type: 'wellbeing_monitoring', granted: true, version: '1.0' });

    vi.spyOn(ml, 'analyzeText').mockResolvedValue({
      distressScore: 45,
      recoveryScore: 55,
      confidence: 0.8,
      escalationProbability: 0.2,
      modelName: 'mock',
      modelVersion: '1.0',
      pipelineVersion: '1.0',
      signals: {},
      contributingFactors: [],
      crisis: false,
      insufficientEvidence: false,
      status: 'available',
    });

    const checkInRes = await request(app)
      .post('/api/v1/check-ins/mood')
      .set('Authorization', `Bearer ${survivorToken}`)
      .send({
        mood: 4,
        sleep: 4,
        perceivedSafety: 4,
        socialConnectedness: 4,
      });
    expect(checkInRes.status).toBe(201);
    const checkInCreatedAt = checkInRes.body.data.createdAt;
    expect(checkInCreatedAt).toBeDefined();

    // 5. Counsellor fetches cases again — lastActive MUST now update to reflect the checkIn!
    const afterCheckInCasesRes = await request(app)
      .get('/api/v1/counsellor/cases')
      .set('Authorization', `Bearer ${counsellorToken}`);
    const updatedCase = afterCheckInCasesRes.body.data.find((c: any) => c.docket === docket);
    expect(new Date(updatedCase.lastActive).getTime()).toBeGreaterThanOrEqual(new Date(checkInCreatedAt).getTime());
    expect(Math.abs(new Date(updatedCase.lastActive).getTime() - new Date(checkInCreatedAt).getTime())).toBeLessThanOrEqual(1000);
    expect(updatedCase.lastActive).not.toBe(initialLastActive);

    // 6. Survivor completes an intervention / Feel Better exercise
    const startInterventionRes = await request(app)
      .post('/api/v1/interventions')
      .set('Authorization', `Bearer ${survivorToken}`)
      .send({ type: 'breathe', caseId: targetCase.id });
    expect(startInterventionRes.status).toBe(201);
    const interventionId = startInterventionRes.body.data.id;

    // Small delay to ensure timestamp progression
    await new Promise((r) => setTimeout(r, 10));

    const completeInterventionRes = await request(app)
      .post(`/api/v1/interventions/${interventionId}/complete`)
      .set('Authorization', `Bearer ${survivorToken}`)
      .send({});
    expect(completeInterventionRes.status).toBe(200);
    const completedAt = completeInterventionRes.body.data.completedAt;
    expect(completedAt).toBeDefined();

    // 7. Counsellor fetches cases again — lastActive MUST now update to the intervention completion timestamp!
    const afterInterventionCasesRes = await request(app)
      .get('/api/v1/counsellor/cases')
      .set('Authorization', `Bearer ${counsellorToken}`);
    const updatedCaseAfterIntervention = afterInterventionCasesRes.body.data.find((c: any) => c.docket === docket);
    expect(updatedCaseAfterIntervention.lastActive).toBe(completedAt);
    expect(new Date(updatedCaseAfterIntervention.lastActive).getTime()).toBeGreaterThanOrEqual(new Date(checkInCreatedAt).getTime());

    // 8. Counsellor reviews the case again — verify lastActive remains the survivor's activity timestamp, NOT updated to now
    const viewCaseAgainRes = await request(app)
      .get(`/api/v1/counsellor/cases/${targetCase.id}`)
      .set('Authorization', `Bearer ${counsellorToken}`);
    expect(viewCaseAgainRes.body.data.case.lastActive).toBe(completedAt);
  });
});

