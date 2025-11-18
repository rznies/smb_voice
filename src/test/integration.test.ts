/**
 * Integration Tests
 * End-to-end tests for complete user flows and scenarios
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  mockBusiness,
  mockCall,
  mockPhoneNumber,
  mockAppointmentParams,
  mockLeadParams,
  mockGoogleCalendarEvent,
  mockHubSpotContact,
  createMockSupabaseClient,
  setMockEnv,
  clearMockEnv,
} from './fixtures.js';
import { db } from '../lib/database.js';
import { createBookAppointmentTool } from '../tools/appointment.js';
import { createLeadCaptureTool, createLookupCustomerTool } from '../tools/lead.js';
import { createTransferToHumanTool } from '../tools/transfer.js';
import nock from 'nock';

describe('Integration - Complete User Flows', () => {
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

  describe('Flow 1: New Customer Books Appointment', () => {
    it('should complete full appointment booking flow', async () => {
      // Mock Google Calendar API
      nock('https://www.googleapis.com')
        .post('/calendar/v3/calendars/test@gmail.com/events')
        .query(true)
        .reply(200, mockGoogleCalendarEvent);

      const businessWithCalendar = {
        ...mockBusiness,
        google_calendar_connected: true,
        google_calendar_id: 'test@gmail.com',
      };

      let callUpdated = false;
      let eventLogged = false;
      let appointmentCreated = false;

      const mockDb = {
        getBusiness: async () => businessWithCalendar,
        createAppointment: async (data: any) => {
          appointmentCreated = true;
          assert.strictEqual(data.business_id, mockBusiness.id);
          assert.strictEqual(data.call_id, mockCall.id);
          assert.strictEqual(data.attendee_email, mockAppointmentParams.customer_email);
          return { id: 'new-appt-id', ...data };
        },
        logCallEvent: async (callId: string, eventType: string) => {
          eventLogged = true;
          assert.strictEqual(eventType, 'appointment_booked');
        },
        updateCall: async (callId: string, data: any) => {
          callUpdated = true;
          assert.strictEqual(data.outcome, 'appointment_booked');
          return { id: callId, ...data };
        },
      };

      const originalMethods = {
        getBusiness: db.getBusiness,
        createAppointment: db.createAppointment,
        logCallEvent: db.logCallEvent,
        updateCall: db.updateCall,
      };

      Object.assign(db, mockDb);

      try {
        const tool = createBookAppointmentTool({
          businessId: mockBusiness.id,
          callId: mockCall.id,
        });

        const result = await tool.execute(mockAppointmentParams);

        // Verify all steps completed
        assert.ok(appointmentCreated, 'Appointment should be created');
        assert.ok(callUpdated, 'Call should be updated');
        assert.ok(eventLogged, 'Event should be logged');
        assert.ok(result.includes('successfully booked'));
        assert.ok(result.includes('calendar invitation'));
      } finally {
        Object.assign(db, originalMethods);
      }
    });
  });

  describe('Flow 2: Lead Capture with CRM Sync', () => {
    it('should complete full lead capture and HubSpot sync flow', async () => {
      // Mock HubSpot API
      nock('https://api.hubapi.com')
        .post('/crm/v3/objects/contacts')
        .reply(200, mockHubSpotContact);

      const businessWithHubSpot = {
        ...mockBusiness,
        hubspot_api_key: 'test-hubspot-key',
      };

      let leadCreated = false;
      let leadSynced = false;
      let callUpdated = false;

      const mockDb = {
        getBusiness: async () => businessWithHubSpot,
        createLead: async (data: any) => {
          leadCreated = true;
          assert.strictEqual(data.business_id, mockBusiness.id);
          assert.strictEqual(data.email, mockLeadParams.email);
          return { id: 'new-lead-id', ...data };
        },
        updateLead: async (id: string, data: any) => {
          leadSynced = true;
          assert.ok(data.hubspot_contact_id);
          assert.ok(data.synced_at);
          return { id, ...data };
        },
        logCallEvent: async () => {},
        updateCall: async (callId: string, data: any) => {
          callUpdated = true;
          assert.strictEqual(data.outcome, 'lead_captured');
          return { id: callId, ...data };
        },
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

        assert.ok(leadCreated, 'Lead should be created');
        assert.ok(leadSynced, 'Lead should be synced to HubSpot');
        assert.ok(callUpdated, 'Call should be updated');
        assert.ok(result.includes('saved your information'));
      } finally {
        Object.assign(db, originalMethods);
      }
    });
  });

  describe('Flow 3: Returning Customer Recognition', () => {
    it('should recognize and greet returning customer', async () => {
      const existingLead = {
        id: 'existing-lead',
        name: 'Returning Customer',
        email: 'returning@example.com',
        phone: '+15559998888',
        status: 'converted',
        created_at: '2025-01-01T00:00:00Z',
      };

      let customerLookedUp = false;

      const mockClient = createMockSupabaseClient();
      mockClient.from = (table: string) => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                then: async (cb: any) => {
                  customerLookedUp = true;
                  return cb({ data: [existingLead], error: null });
                },
              }),
            }),
          }),
        }),
      }) as any;

      const originalClient = db['client'];
      const originalLogCallEvent = db.logCallEvent;

      db['client'] = mockClient;
      db.logCallEvent = async () => {};

      try {
        const tool = createLookupCustomerTool({
          businessId: mockBusiness.id,
          callId: mockCall.id,
          callerPhone: '+15559998888',
        });

        const result = await tool.execute({});

        assert.ok(customerLookedUp, 'Customer should be looked up');
        assert.ok(result.includes('Welcome back'));
        assert.ok(result.includes('valued customer'));
      } finally {
        db['client'] = originalClient;
        db.logCallEvent = originalLogCallEvent;
      }
    });
  });

  describe('Flow 4: Complex Query Transfer to Human', () => {
    it('should complete transfer flow with context preservation', async () => {
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

      let callUpdated = false;
      let eventLogged = false;

      const mockDb = {
        getBusiness: async () => mockBusiness,
        getCall: async () => mockCall,
        updateCall: async (callId: string, data: any) => {
          callUpdated = true;
          assert.strictEqual(data.transferred_to_human, true);
          assert.strictEqual(data.outcome, 'transferred');
          assert.ok(data.notes);
          return { id: callId, ...data };
        },
        logCallEvent: async (callId: string, eventType: string, data: any) => {
          eventLogged = true;
          assert.strictEqual(eventType, 'transfer_initiated');
          assert.ok(data.reason);
          assert.ok(data.urgency);
        },
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

        const result = await tool.execute({
          reason: 'complex billing question',
          urgency: 'high',
          notes: 'Customer needs immediate assistance',
        });

        assert.ok(callUpdated, 'Call should be updated with transfer info');
        assert.ok(eventLogged, 'Transfer event should be logged');
        assert.ok(result.includes('connect you'));
      } finally {
        Object.assign(db, originalMethods);
      }
    });
  });

  describe('Flow 5: Multi-Step Booking with Lead Capture', () => {
    it('should handle lead capture followed by appointment booking', async () => {
      nock('https://www.googleapis.com')
        .post('/calendar/v3/calendars/test@gmail.com/events')
        .query(true)
        .reply(200, mockGoogleCalendarEvent);

      const businessWithCalendar = {
        ...mockBusiness,
        google_calendar_connected: true,
        google_calendar_id: 'test@gmail.com',
      };

      let leadId: string | null = null;

      const mockDb = {
        getBusiness: async () => businessWithCalendar,
        createLead: async (data: any) => {
          leadId = 'new-lead-id';
          return { id: leadId, ...data };
        },
        createAppointment: async (data: any) => {
          // Verify lead ID can be linked
          assert.ok(leadId);
          return { id: 'new-appt-id', lead_id: leadId, ...data };
        },
        logCallEvent: async () => {},
        updateCall: async () => ({}),
      };

      const originalMethods = {
        getBusiness: db.getBusiness,
        createLead: db.createLead,
        createAppointment: db.createAppointment,
        logCallEvent: db.logCallEvent,
        updateCall: db.updateCall,
      };

      Object.assign(db, mockDb);

      try {
        // Step 1: Capture lead
        const leadTool = createLeadCaptureTool({
          businessId: mockBusiness.id,
          callId: mockCall.id,
        });

        const leadResult = await leadTool.execute(mockLeadParams);
        assert.ok(leadResult.includes('saved your information'));

        // Step 2: Book appointment
        const appointmentTool = createBookAppointmentTool({
          businessId: mockBusiness.id,
          callId: mockCall.id,
        });

        const appointmentResult = await appointmentTool.execute(mockAppointmentParams);
        assert.ok(appointmentResult.includes('successfully booked'));

        // Verify both completed
        assert.ok(leadId, 'Lead should be created');
      } finally {
        Object.assign(db, originalMethods);
      }
    });
  });

  describe('Flow 6: Error Handling and Graceful Degradation', () => {
    it('should handle calendar API failure gracefully', async () => {
      // Mock Google Calendar API failure
      nock('https://www.googleapis.com')
        .post('/calendar/v3/calendars/test@gmail.com/events')
        .query(true)
        .reply(500, { error: 'Internal Server Error' });

      const businessWithCalendar = {
        ...mockBusiness,
        google_calendar_connected: true,
        google_calendar_id: 'test@gmail.com',
      };

      let appointmentStillCreated = false;

      const mockDb = {
        getBusiness: async () => businessWithCalendar,
        createAppointment: async (data: any) => {
          appointmentStillCreated = true;
          return { id: 'new-appt-id', ...data };
        },
        logCallEvent: async () => {},
        updateCall: async () => ({}),
      };

      const originalMethods = {
        getBusiness: db.getBusiness,
        createAppointment: db.createAppointment,
        logCallEvent: db.logCallEvent,
        updateCall: db.updateCall,
      };

      Object.assign(db, mockDb);

      try {
        const tool = createBookAppointmentTool({
          businessId: mockBusiness.id,
          callId: mockCall.id,
        });

        const result = await tool.execute(mockAppointmentParams);

        // Should still succeed even if calendar fails
        assert.ok(appointmentStillCreated, 'Appointment should still be created in database');
        assert.ok(result.includes('successfully booked'));
      } finally {
        Object.assign(db, originalMethods);
      }
    });

    it('should handle HubSpot API failure gracefully', async () => {
      // Mock HubSpot API failure
      nock('https://api.hubapi.com')
        .post('/crm/v3/objects/contacts')
        .reply(500, { error: 'Internal Server Error' });

      const businessWithHubSpot = {
        ...mockBusiness,
        hubspot_api_key: 'test-hubspot-key',
      };

      let leadStillCreated = false;

      const mockDb = {
        getBusiness: async () => businessWithHubSpot,
        createLead: async (data: any) => {
          leadStillCreated = true;
          return { id: 'new-lead-id', ...data };
        },
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
        assert.ok(leadStillCreated, 'Lead should still be created in database');
        assert.ok(result.includes('saved your information'));
      } finally {
        Object.assign(db, originalMethods);
      }
    });
  });
});
