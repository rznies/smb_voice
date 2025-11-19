/**
 * Lead Tool Tests
 * Unit tests for lead capture and lookup functionality
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createLeadCaptureTool, createLookupCustomerTool } from './lead.js';
import {
  mockBusiness,
  mockCall,
  mockLead,
  mockLeadParams,
  mockHubSpotContact,
  createMockSupabaseClient,
  setMockEnv,
  clearMockEnv,
} from '../test/fixtures.js';
import { db } from '../lib/database.js';
import nock from 'nock';

describe('Lead Tools', () => {
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

  describe('createLeadCaptureTool', () => {
    it('should create lead capture tool with correct description', () => {
      const tool = createLeadCaptureTool({
        businessId: mockBusiness.id,
        callId: mockCall.id,
      });

      assert.ok(tool);
      assert.ok(tool.description.includes('Capture customer information'));
    });

    it('should successfully capture a lead with email', async () => {
      const mockDb = {
        getBusiness: async () => mockBusiness,
        createLead: async (data: any) => ({
          id: 'new-lead-id',
          ...data,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
        updateLead: async () => ({}),
        logCallEvent: async () => {},
        updateCall: async () => ({}),
      };

      const originalMethods = {
        getBusiness: db.getBusiness,
        createLead: db.createLead,
        updateLead: db.updateLead,
        logCallEvent: db.logCallEvent,
        updateCall: db.updateCall,
      };

      db.getBusiness = mockDb.getBusiness as any;
      db.createLead = mockDb.createLead as any;
      db.updateLead = mockDb.updateLead as any;
      db.logCallEvent = mockDb.logCallEvent as any;
      db.updateCall = mockDb.updateCall as any;

      try {
        const tool = createLeadCaptureTool({
          businessId: mockBusiness.id,
          callId: mockCall.id,
        });

        const result = await tool.execute(mockLeadParams);

        assert.ok(result);
        assert.ok(result.includes('saved your information'));
        assert.ok(result.includes(mockLeadParams.name));
      } finally {
        Object.assign(db, originalMethods);
      }
    });

    it('should handle lead with phone instead of email', async () => {
      const mockDb = {
        getBusiness: async () => mockBusiness,
        createLead: async (data: any) => ({
          id: 'new-lead-id',
          ...data,
        }),
        logCallEvent: async () => {},
        updateCall: async () => ({}),
      };

      const originalMethods = {
        getBusiness: db.getBusiness,
        createLead: db.createLead,
        logCallEvent: db.logCallEvent,
        updateCall: db.updateCall,
      };

      Object.assign(db, mockDb);

      try {
        const tool = createLeadCaptureTool({
          businessId: mockBusiness.id,
          callId: mockCall.id,
          callerPhone: '+15559998888',
        });

        const paramsWithoutEmail = {
          ...mockLeadParams,
          email: undefined,
        };

        const result = await tool.execute(paramsWithoutEmail);

        assert.ok(result.includes('saved your information'));
        assert.ok(result.includes(mockLeadParams.name));
      } finally {
        Object.assign(db, originalMethods);
      }
    });

    it('should reject lead without email or phone', async () => {
      const mockDb = {
        getBusiness: async () => mockBusiness,
      };

      const originalGetBusiness = db.getBusiness;
      db.getBusiness = mockDb.getBusiness as any;

      try {
        const tool = createLeadCaptureTool({
          businessId: mockBusiness.id,
          callId: mockCall.id,
        });

        const paramsWithoutContact = {
          name: 'Test User',
          company: 'Test Corp',
        };

        const result = await tool.execute(paramsWithoutContact as any);

        assert.ok(result.includes('email address or phone number'));
      } finally {
        db.getBusiness = originalGetBusiness;
      }
    });

    it('should sync to HubSpot when API key is configured', async () => {
      // Mock HubSpot API
      nock('https://api.hubapi.com')
        .post('/crm/v3/objects/contacts')
        .reply(200, mockHubSpotContact);

      const businessWithHubSpot = {
        ...mockBusiness,
        hubspot_api_key: 'test-hubspot-key',
      };

      const mockDb = {
        getBusiness: async () => businessWithHubSpot,
        createLead: async (data: any) => ({
          id: 'new-lead-id',
          ...data,
        }),
        updateLead: async (id: string, data: any) => {
          assert.ok(data.hubspot_contact_id);
          assert.ok(data.synced_at);
          return { id, ...data };
        },
        logCallEvent: async () => {},
        updateCall: async () => ({}),
      };

      const originalMethods = {
        getBusiness: db.getBusiness,
        createLead: db.createLead,
        updateLead: db.updateLead,
        logCallEvent: db.logCallEvent,
        updateCall: db.updateCall,
      };

      Object.assign(db, mockDb);

      try {
        const tool = createLeadCaptureTool({
          businessId: mockBusiness.id,
          callId: mockCall.id,
        });

        const result = await tool.execute(mockLeadParams);

        assert.ok(result.includes('saved your information'));
      } finally {
        Object.assign(db, originalMethods);
      }
    });

    it('should continue even if HubSpot sync fails', async () => {
      // Mock HubSpot API failure
      nock('https://api.hubapi.com')
        .post('/crm/v3/objects/contacts')
        .reply(500, { error: 'Internal Server Error' });

      const businessWithHubSpot = {
        ...mockBusiness,
        hubspot_api_key: 'test-hubspot-key',
      };

      const mockDb = {
        getBusiness: async () => businessWithHubSpot,
        createLead: async (data: any) => ({
          id: 'new-lead-id',
          ...data,
        }),
        updateLead: async () => ({}),
        logCallEvent: async () => {},
        updateCall: async () => ({}),
      };

      const originalMethods = {
        getBusiness: db.getBusiness,
        createLead: db.createLead,
        updateLead: db.updateLead,
        logCallEvent: db.logCallEvent,
        updateCall: db.updateCall,
      };

      Object.assign(db, mockDb);

      try {
        const tool = createLeadCaptureTool({
          businessId: mockBusiness.id,
          callId: mockCall.id,
        });

        const result = await tool.execute(mockLeadParams);

        // Should still succeed even if HubSpot fails
        assert.ok(result.includes('saved your information'));
      } finally {
        Object.assign(db, originalMethods);
      }
    });
  });

  describe('createLookupCustomerTool', () => {
    it('should create lookup customer tool with correct description', () => {
      const tool = createLookupCustomerTool({
        businessId: mockBusiness.id,
        callId: mockCall.id,
      });

      assert.ok(tool);
      assert.ok(tool.description.includes('Look up an existing customer'));
    });

    it('should find existing customer by phone', async () => {
      const mockClient = createMockSupabaseClient();
      mockClient.from = (table: string) => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                then: async (cb: any) => cb({ data: [mockLead], error: null }),
              }),
            }),
          }),
        }),
      }) as any;

      const originalClient = db['client'];
      db['client'] = mockClient;

      const originalLogCallEvent = db.logCallEvent;
      db.logCallEvent = async () => {};

      try {
        const tool = createLookupCustomerTool({
          businessId: mockBusiness.id,
          callId: mockCall.id,
          callerPhone: '+15557778888',
        });

        const result = await tool.execute({ phone: '+15557778888' });

        assert.ok(result.includes('Welcome back'));
        assert.ok(result.includes('we last spoke'));
      } finally {
        db['client'] = originalClient;
        db.logCallEvent = originalLogCallEvent;
      }
    });

    it('should handle new customer (no existing record)', async () => {
      const mockClient = createMockSupabaseClient();
      mockClient.from = (table: string) => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                then: async (cb: any) => cb({ data: [], error: null }),
              }),
            }),
          }),
        }),
      }) as any;

      const originalClient = db['client'];
      db['client'] = mockClient;

      try {
        const tool = createLookupCustomerTool({
          businessId: mockBusiness.id,
          callId: mockCall.id,
          callerPhone: '+15559998888',
        });

        const result = await tool.execute({ phone: '+15559998888' });

        assert.ok(result.includes('new customer'));
        assert.ok(result.includes('welcome'));
      } finally {
        db['client'] = originalClient;
      }
    });

    it('should use caller phone if not provided in params', async () => {
      const mockClient = createMockSupabaseClient();
      mockClient.from = (table: string) => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                then: async (cb: any) => cb({ data: [mockLead], error: null }),
              }),
            }),
          }),
        }),
      }) as any;

      const originalClient = db['client'];
      db['client'] = mockClient;

      const originalLogCallEvent = db.logCallEvent;
      db.logCallEvent = async () => {};

      try {
        const tool = createLookupCustomerTool({
          businessId: mockBusiness.id,
          callId: mockCall.id,
          callerPhone: '+15557778888',
        });

        const result = await tool.execute({});

        assert.ok(result.includes('Welcome back'));
      } finally {
        db['client'] = originalClient;
        db.logCallEvent = originalLogCallEvent;
      }
    });

    it('should handle database errors gracefully', async () => {
      const mockClient = createMockSupabaseClient();
      mockClient.from = (table: string) => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                then: async (cb: any) => cb({ data: null, error: { message: 'DB error' } }),
              }),
            }),
          }),
        }),
      }) as any;

      const originalClient = db['client'];
      db['client'] = mockClient;

      try {
        const tool = createLookupCustomerTool({
          businessId: mockBusiness.id,
          callId: mockCall.id,
          callerPhone: '+15559998888',
        });

        const result = await tool.execute({});

        // Should handle error gracefully
        assert.ok(result.includes('How can I help you'));
      } finally {
        db['client'] = originalClient;
      }
    });
  });
});
