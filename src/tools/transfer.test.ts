/**
 * Transfer Tool Tests
 * Unit tests for human transfer and business hours functionality
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTransferToHumanTool, createBusinessHoursTool } from './transfer.js';
import {
  mockBusiness,
  mockCall,
  mockPhoneNumber,
  mockTransferParams,
  createMockSupabaseClient,
  setMockEnv,
  clearMockEnv,
} from '../test/fixtures.js';
import { db } from '../lib/database.js';
import nock from 'nock';

describe('Transfer Tools', () => {
  before(() => {
    setMockEnv();
  });

  after(() => {
    clearMockEnv();
    nock.cleanAll();
  });

  beforeEach(() => {
    nock.cleanAll();
  });

  describe('createTransferToHumanTool', () => {
    it('should create transfer tool with correct description', () => {
      const tool = createTransferToHumanTool({
        businessId: mockBusiness.id,
        callId: mockCall.id,
      });

      assert.ok(tool);
      assert.ok(tool.description.includes('Transfer the call'));
    });

    it('should initiate transfer with Twilio when call SID is available', async () => {
      // Mock Twilio API
      nock('https://api.twilio.com')
        .post(`/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Calls/${mockCall.twilio_call_sid}.json`)
        .reply(200, {
          sid: mockCall.twilio_call_sid,
          status: 'in-progress',
        });

      const mockClient = createMockSupabaseClient();
      mockClient.from = (table: string) => {
        if (table === 'phone_numbers') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({ data: mockPhoneNumber, error: null }),
              }),
            }),
          } as any;
        }
        return createMockSupabaseClient().from(table);
      };

      const mockDb = {
        getBusiness: async () => mockBusiness,
        getCall: async () => mockCall,
        updateCall: async (id: string, data: any) => {
          assert.strictEqual(data.transferred_to_human, true);
          assert.strictEqual(data.outcome, 'transferred');
          return { id, ...data };
        },
        logCallEvent: async () => {},
        client: mockClient,
      };

      const originalMethods = {
        getBusiness: db.getBusiness,
        getCall: db.getCall,
        updateCall: db.updateCall,
        logCallEvent: db.logCallEvent,
        client: db['client'],
      };

      Object.assign(db, mockDb);

      try {
        const tool = createTransferToHumanTool({
          businessId: mockBusiness.id,
          callId: mockCall.id,
          twilioCallSid: mockCall.twilio_call_sid,
        });

        const result = await tool.execute(mockTransferParams);

        assert.ok(result);
        assert.ok(result.includes('transferring'));
        assert.ok(result.includes(mockTransferParams.reason));
      } finally {
        Object.assign(db, originalMethods);
      }
    });

    it('should handle transfer without Twilio call SID', async () => {
      const mockClient = createMockSupabaseClient();
      mockClient.from = (table: string) => {
        if (table === 'phone_numbers') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({ data: mockPhoneNumber, error: null }),
              }),
            }),
          } as any;
        }
        return createMockSupabaseClient().from(table);
      };

      const mockDb = {
        getBusiness: async () => mockBusiness,
        getCall: async () => ({ ...mockCall, twilio_call_sid: null }),
        updateCall: async () => ({}),
        logCallEvent: async () => {},
        client: mockClient,
      };

      const originalMethods = {
        getBusiness: db.getBusiness,
        getCall: db.getCall,
        updateCall: db.updateCall,
        logCallEvent: db.logCallEvent,
        client: db['client'],
      };

      Object.assign(db, mockDb);

      try {
        const tool = createTransferToHumanTool({
          businessId: mockBusiness.id,
          callId: mockCall.id,
        });

        const result = await tool.execute(mockTransferParams);

        assert.ok(result.includes('connect you'));
      } finally {
        Object.assign(db, originalMethods);
      }
    });

    it('should handle missing transfer number gracefully', async () => {
      const phoneNumberWithoutForward = {
        ...mockPhoneNumber,
        forward_to: null,
      };

      const mockClient = createMockSupabaseClient();
      mockClient.from = (table: string) => {
        if (table === 'phone_numbers') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({ data: phoneNumberWithoutForward, error: null }),
              }),
            }),
          } as any;
        }
        return createMockSupabaseClient().from(table);
      };

      const mockDb = {
        getBusiness: async () => mockBusiness,
        getCall: async () => mockCall,
        updateCall: async () => ({}),
        logCallEvent: async () => {},
        client: mockClient,
      };

      const originalMethods = {
        getBusiness: db.getBusiness,
        getCall: db.getCall,
        updateCall: db.updateCall,
        logCallEvent: db.logCallEvent,
        client: db['client'],
      };

      Object.assign(db, mockDb);

      try {
        const tool = createTransferToHumanTool({
          businessId: mockBusiness.id,
          callId: mockCall.id,
        });

        const result = await tool.execute(mockTransferParams);

        assert.ok(result.includes('unable to complete the transfer'));
      } finally {
        Object.assign(db, originalMethods);
      }
    });

    it('should validate urgency levels', () => {
      const tool = createTransferToHumanTool({
        businessId: mockBusiness.id,
        callId: mockCall.id,
      });

      const shape = tool.parameters._def.shape();
      assert.ok('urgency' in shape);
      assert.ok(shape.urgency._def.values.includes('low'));
      assert.ok(shape.urgency._def.values.includes('medium'));
      assert.ok(shape.urgency._def.values.includes('high'));
    });
  });

  describe('createBusinessHoursTool', () => {
    it('should create business hours tool with correct description', () => {
      const tool = createBusinessHoursTool({
        businessId: mockBusiness.id,
        callId: mockCall.id,
      });

      assert.ok(tool);
      assert.ok(tool.description.includes('business is currently open'));
    });

    it('should check if business is open', async () => {
      const mockDb = {
        getBusiness: async () => mockBusiness,
      };

      const originalGetBusiness = db.getBusiness;
      db.getBusiness = mockDb.getBusiness as any;

      try {
        const tool = createBusinessHoursTool({
          businessId: mockBusiness.id,
          callId: mockCall.id,
        });

        const result = await tool.execute({});

        assert.ok(result);
        // Result should mention hours or being open/closed
        assert.ok(
          result.includes('open') ||
          result.includes('closed') ||
          result.includes('hours')
        );
      } finally {
        db.getBusiness = originalGetBusiness;
      }
    });

    it('should handle business without configured hours', async () => {
      const businessWithoutHours = {
        ...mockBusiness,
        business_hours: null,
      };

      const mockDb = {
        getBusiness: async () => businessWithoutHours,
      };

      const originalGetBusiness = db.getBusiness;
      db.getBusiness = mockDb.getBusiness as any;

      try {
        const tool = createBusinessHoursTool({
          businessId: mockBusiness.id,
          callId: mockCall.id,
        });

        const result = await tool.execute({});

        assert.ok(result.includes('Monday through Friday'));
      } finally {
        db.getBusiness = originalGetBusiness;
      }
    });

    it('should handle missing business gracefully', async () => {
      const mockDb = {
        getBusiness: async () => null,
      };

      const originalGetBusiness = db.getBusiness;
      db.getBusiness = mockDb.getBusiness as any;

      try {
        const tool = createBusinessHoursTool({
          businessId: 'invalid-id',
          callId: mockCall.id,
        });

        const result = await tool.execute({});

        // Should still provide a helpful response
        assert.ok(result.includes('help you'));
      } finally {
        db.getBusiness = originalGetBusiness;
      }
    });
  });
});
