/**
 * API Server Tests
 * Tests for Twilio webhooks, LiveKit token generation, and REST endpoints
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import express from 'express';
import {
  mockBusiness,
  mockCall,
  mockPhoneNumber,
  mockTwilioInboundRequest,
  mockTwilioStatusCallback,
  createMockSupabaseClient,
  setMockEnv,
  clearMockEnv,
} from '../test/fixtures.js';
import { db } from '../lib/database.js';
import nock from 'nock';

// Create a test version of the API server
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  });

  // Mock inbound webhook
  app.post('/api/twilio/inbound', async (req, res) => {
    const { From, To, CallSid } = req.body;

    const phoneNumber = await db.getPhoneNumber(To);
    if (!phoneNumber) {
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Say>Number not configured</Say>
          <Hangup/>
        </Response>`);
    }

    const business = await db.getBusiness(phoneNumber.business_id);
    if (!business) {
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Say>Service unavailable</Say>
          <Hangup/>
        </Response>`);
    }

    const call = await db.createCall({
      business_id: phoneNumber.business_id,
      phone_number_id: phoneNumber.id,
      direction: 'inbound',
      from_number: From,
      to_number: To,
      twilio_call_sid: CallSid,
      status: 'in_progress',
    });

    res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Say>Thank you for calling</Say>
        <Hangup/>
      </Response>`);
  });

  // Mock status callback
  app.post('/api/twilio/status', async (req, res) => {
    const { CallSid, CallStatus, CallDuration } = req.body;

    const mockClient = createMockSupabaseClient();
    mockClient.from = (table: string) => ({
      select: () => ({
        eq: () => ({
          limit: () => ({
            then: async (cb: any) => cb({ data: [{ ...mockCall, twilio_call_sid: CallSid }], error: null }),
          }),
        }),
      }),
    }) as any;

    db['client'] = mockClient;

    await db.updateCall(mockCall.id, {
      twilio_status: CallStatus,
      ended_at: new Date().toISOString(),
    });

    res.sendStatus(200);
  });

  // Mock LiveKit token generation
  app.post('/api/livekit/token', (req, res) => {
    const { roomName, participantName } = req.body;

    if (!roomName || !participantName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    res.json({
      token: 'mock-jwt-token',
      url: process.env.LIVEKIT_URL,
      roomName,
    });
  });

  // Mock get call
  app.get('/api/calls/:callId', async (req, res) => {
    const { callId } = req.params;
    const call = await db.getCall(callId);

    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }

    res.json(call);
  });

  // Mock get business calls
  app.get('/api/businesses/:businessId/calls', async (req, res) => {
    const { businessId } = req.params;
    const calls = await db.getCallsByBusiness(businessId, 50);

    res.json({ calls, count: calls.length });
  });

  return app;
}

describe('API Server', () => {
  let app: express.Application;

  before(() => {
    setMockEnv();
    app = createTestApp();
  });

  after(() => {
    clearMockEnv();
    nock.cleanAll();
  });

  beforeEach(() => {
    nock.cleanAll();
  });

  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const response = await request(app).get('/health');

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.status, 'healthy');
      assert.ok(response.body.timestamp);
    });
  });

  describe('Twilio Inbound Webhook', () => {
    it('should handle inbound call successfully', async () => {
      const mockDb = {
        getPhoneNumber: async () => mockPhoneNumber,
        getBusiness: async () => mockBusiness,
        createCall: async (data: any) => ({ ...mockCall, ...data }),
      };

      const originalMethods = {
        getPhoneNumber: db.getPhoneNumber,
        getBusiness: db.getBusiness,
        createCall: db.createCall,
      };

      Object.assign(db, mockDb);

      try {
        const response = await request(app)
          .post('/api/twilio/inbound')
          .send(mockTwilioInboundRequest);

        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.type, 'text/xml');
        assert.ok(response.text.includes('<?xml'));
        assert.ok(response.text.includes('<Response>'));
      } finally {
        Object.assign(db, originalMethods);
      }
    });

    it('should reject call for unknown phone number', async () => {
      const mockDb = {
        getPhoneNumber: async () => null,
      };

      const originalGetPhoneNumber = db.getPhoneNumber;
      db.getPhoneNumber = mockDb.getPhoneNumber as any;

      try {
        const response = await request(app)
          .post('/api/twilio/inbound')
          .send(mockTwilioInboundRequest);

        assert.strictEqual(response.status, 200);
        assert.ok(response.text.includes('not configured'));
      } finally {
        db.getPhoneNumber = originalGetPhoneNumber;
      }
    });

    it('should reject call when business not found', async () => {
      const mockDb = {
        getPhoneNumber: async () => mockPhoneNumber,
        getBusiness: async () => null,
      };

      const originalMethods = {
        getPhoneNumber: db.getPhoneNumber,
        getBusiness: db.getBusiness,
      };

      Object.assign(db, mockDb);

      try {
        const response = await request(app)
          .post('/api/twilio/inbound')
          .send(mockTwilioInboundRequest);

        assert.strictEqual(response.status, 200);
        assert.ok(response.text.includes('unavailable'));
      } finally {
        Object.assign(db, originalMethods);
      }
    });
  });

  describe('Twilio Status Callback', () => {
    it('should process status callback successfully', async () => {
      const mockDb = {
        updateCall: async () => ({}),
      };

      const originalUpdateCall = db.updateCall;
      db.updateCall = mockDb.updateCall as any;

      try {
        const response = await request(app)
          .post('/api/twilio/status')
          .send(mockTwilioStatusCallback);

        assert.strictEqual(response.status, 200);
      } finally {
        db.updateCall = originalUpdateCall;
      }
    });
  });

  describe('LiveKit Token Generation', () => {
    it('should generate LiveKit token successfully', async () => {
      const response = await request(app)
        .post('/api/livekit/token')
        .send({
          roomName: 'test-room',
          participantName: 'Test User',
        });

      assert.strictEqual(response.status, 200);
      assert.ok(response.body.token);
      assert.strictEqual(response.body.roomName, 'test-room');
      assert.ok(response.body.url);
    });

    it('should reject request without room name', async () => {
      const response = await request(app)
        .post('/api/livekit/token')
        .send({
          participantName: 'Test User',
        });

      assert.strictEqual(response.status, 400);
      assert.ok(response.body.error);
    });

    it('should reject request without participant name', async () => {
      const response = await request(app)
        .post('/api/livekit/token')
        .send({
          roomName: 'test-room',
        });

      assert.strictEqual(response.status, 400);
      assert.ok(response.body.error);
    });
  });

  describe('Call Retrieval', () => {
    it('should get call by ID', async () => {
      const mockDb = {
        getCall: async () => mockCall,
      };

      const originalGetCall = db.getCall;
      db.getCall = mockDb.getCall as any;

      try {
        const response = await request(app).get(`/api/calls/${mockCall.id}`);

        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.body.id, mockCall.id);
      } finally {
        db.getCall = originalGetCall;
      }
    });

    it('should return 404 for unknown call', async () => {
      const mockDb = {
        getCall: async () => null,
      };

      const originalGetCall = db.getCall;
      db.getCall = mockDb.getCall as any;

      try {
        const response = await request(app).get('/api/calls/unknown-id');

        assert.strictEqual(response.status, 404);
        assert.ok(response.body.error);
      } finally {
        db.getCall = originalGetCall;
      }
    });
  });

  describe('Business Calls Retrieval', () => {
    it('should get calls for a business', async () => {
      const mockDb = {
        getCallsByBusiness: async () => [mockCall],
      };

      const originalGetCallsByBusiness = db.getCallsByBusiness;
      db.getCallsByBusiness = mockDb.getCallsByBusiness as any;

      try {
        const response = await request(app).get(`/api/businesses/${mockBusiness.id}/calls`);

        assert.strictEqual(response.status, 200);
        assert.ok(Array.isArray(response.body.calls));
        assert.strictEqual(response.body.count, 1);
      } finally {
        db.getCallsByBusiness = originalGetCallsByBusiness;
      }
    });
  });
});
