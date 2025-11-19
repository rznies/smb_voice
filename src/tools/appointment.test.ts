/**
 * Appointment Tool Tests
 * Unit tests for appointment booking functionality
 */

import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { createBookAppointmentTool } from './appointment.js';
import {
  mockBusiness,
  mockCall,
  mockAppointmentParams,
  mockGoogleCalendarEvent,
  createMockSupabaseClient,
  setMockEnv,
  clearMockEnv,
} from '../test/fixtures.js';
import { db } from '../lib/database.js';
import nock from 'nock';

describe('Appointment Tool', () => {
  before(() => {
    setMockEnv();
  });

  after(() => {
    clearMockEnv();
    nock.cleanAll();
  });

  beforeEach(() => {
    // Reset nock
    nock.cleanAll();
  });

  describe('createBookAppointmentTool', () => {
    it('should create appointment tool with correct description', () => {
      const tool = createBookAppointmentTool({
        businessId: mockBusiness.id,
        callId: mockCall.id,
      });

      assert.ok(tool);
      assert.ok(tool.description.includes('Book an appointment'));
    });

    it('should successfully book an appointment', async () => {
      // Mock Supabase
      const mockDb = {
        getBusiness: async () => mockBusiness,
        createAppointment: async (data: any) => ({
          id: 'new-appt-id',
          ...data,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
        logCallEvent: async () => {},
        updateCall: async () => ({}),
      };

      // Replace db methods
      const originalGetBusiness = db.getBusiness;
      const originalCreateAppointment = db.createAppointment;
      const originalLogCallEvent = db.logCallEvent;
      const originalUpdateCall = db.updateCall;

      db.getBusiness = mockDb.getBusiness as any;
      db.createAppointment = mockDb.createAppointment as any;
      db.logCallEvent = mockDb.logCallEvent as any;
      db.updateCall = mockDb.updateCall as any;

      try {
        const tool = createBookAppointmentTool({
          businessId: mockBusiness.id,
          callId: mockCall.id,
          callerPhone: '+15559998888',
        });

        const result = await tool.execute(mockAppointmentParams);

        assert.ok(result);
        assert.ok(typeof result === 'string');
        assert.ok(result.includes('successfully booked'));
        assert.ok(result.includes(mockAppointmentParams.customer_name));
      } finally {
        // Restore original methods
        db.getBusiness = originalGetBusiness;
        db.createAppointment = originalCreateAppointment;
        db.logCallEvent = originalLogCallEvent;
        db.updateCall = originalUpdateCall;
      }
    });

    it('should reject past dates', async () => {
      const mockDb = {
        getBusiness: async () => mockBusiness,
      };

      const originalGetBusiness = db.getBusiness;
      db.getBusiness = mockDb.getBusiness as any;

      try {
        const tool = createBookAppointmentTool({
          businessId: mockBusiness.id,
          callId: mockCall.id,
        });

        const pastParams = {
          ...mockAppointmentParams,
          date: '2020-01-01',
          time: '10:00',
        };

        const result = await tool.execute(pastParams);

        assert.ok(result.includes('already passed'));
      } finally {
        db.getBusiness = originalGetBusiness;
      }
    });

    it('should handle Google Calendar integration', async () => {
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

      const mockDb = {
        getBusiness: async () => businessWithCalendar,
        createAppointment: async (data: any) => ({
          id: 'new-appt-id',
          ...data,
        }),
        logCallEvent: async () => {},
        updateCall: async () => ({}),
      };

      const originalGetBusiness = db.getBusiness;
      const originalCreateAppointment = db.createAppointment;
      const originalLogCallEvent = db.logCallEvent;
      const originalUpdateCall = db.updateCall;

      db.getBusiness = mockDb.getBusiness as any;
      db.createAppointment = mockDb.createAppointment as any;
      db.logCallEvent = mockDb.logCallEvent as any;
      db.updateCall = mockDb.updateCall as any;

      try {
        const tool = createBookAppointmentTool({
          businessId: mockBusiness.id,
          callId: mockCall.id,
        });

        const result = await tool.execute(mockAppointmentParams);

        assert.ok(result.includes('calendar invitation'));
      } finally {
        db.getBusiness = originalGetBusiness;
        db.createAppointment = originalCreateAppointment;
        db.logCallEvent = originalLogCallEvent;
        db.updateCall = originalUpdateCall;
      }
    });

    it('should handle missing business gracefully', async () => {
      const mockDb = {
        getBusiness: async () => null,
      };

      const originalGetBusiness = db.getBusiness;
      db.getBusiness = mockDb.getBusiness as any;

      try {
        const tool = createBookAppointmentTool({
          businessId: 'invalid-id',
          callId: mockCall.id,
        });

        const result = await tool.execute(mockAppointmentParams);

        assert.ok(result.includes('encountered an issue'));
      } finally {
        db.getBusiness = originalGetBusiness;
      }
    });

    it('should validate required parameters', async () => {
      const tool = createBookAppointmentTool({
        businessId: mockBusiness.id,
        callId: mockCall.id,
      });

      // Test that the tool requires all necessary parameters
      assert.ok(tool.parameters);
      const shape = tool.parameters._def.shape();

      assert.ok('date' in shape);
      assert.ok('time' in shape);
      assert.ok('customer_name' in shape);
      assert.ok('customer_email' in shape);
    });

    it('should use default duration if not provided', async () => {
      const mockDb = {
        getBusiness: async () => mockBusiness,
        createAppointment: async (data: any) => {
          assert.strictEqual(data.duration_minutes, 30);
          return { id: 'new-appt-id', ...data };
        },
        logCallEvent: async () => {},
        updateCall: async () => ({}),
      };

      const originalGetBusiness = db.getBusiness;
      const originalCreateAppointment = db.createAppointment;
      const originalLogCallEvent = db.logCallEvent;
      const originalUpdateCall = db.updateCall;

      db.getBusiness = mockDb.getBusiness as any;
      db.createAppointment = mockDb.createAppointment as any;
      db.logCallEvent = mockDb.logCallEvent as any;
      db.updateCall = mockDb.updateCall as any;

      try {
        const tool = createBookAppointmentTool({
          businessId: mockBusiness.id,
          callId: mockCall.id,
        });

        const paramsWithoutDuration = {
          ...mockAppointmentParams,
        };
        delete (paramsWithoutDuration as any).duration_minutes;

        await tool.execute(paramsWithoutDuration);
      } finally {
        db.getBusiness = originalGetBusiness;
        db.createAppointment = originalCreateAppointment;
        db.logCallEvent = originalLogCallEvent;
        db.updateCall = originalUpdateCall;
      }
    });
  });
});
