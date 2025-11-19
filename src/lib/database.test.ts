/**
 * Database Tests
 * Unit tests for Supabase database operations
 */

import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert';
import { Database, db } from './database.js';
import {
  mockBusiness,
  mockCall,
  mockLead,
  mockAppointment,
  mockPhoneNumber,
  createMockSupabaseClient,
  setMockEnv,
  clearMockEnv,
} from '../test/fixtures.js';

describe('Database', () => {
  before(() => {
    setMockEnv();
  });

  after(() => {
    clearMockEnv();
  });

  describe('Call Operations', () => {
    it('should create a call', async () => {
      const database = new Database();
      // Mock the Supabase client
      database['client'] = createMockSupabaseClient();

      const callData = {
        business_id: mockBusiness.id,
        phone_number_id: mockPhoneNumber.id,
        direction: 'inbound' as const,
        from_number: '+15559998888',
        to_number: '+15551234567',
        status: 'in_progress' as const,
      };

      const call = await database.createCall(callData);

      assert.ok(call);
      assert.strictEqual(call.business_id, mockBusiness.id);
      assert.strictEqual(call.direction, 'inbound');
      assert.strictEqual(call.from_number, '+15559998888');
    });

    it('should update a call', async () => {
      const database = new Database();
      database['client'] = createMockSupabaseClient();

      const updates = {
        status: 'completed' as const,
        ended_at: new Date().toISOString(),
        duration_seconds: 180,
      };

      const call = await database.updateCall(mockCall.id, updates);

      assert.ok(call);
      assert.strictEqual(call.status, 'completed');
      assert.ok(call.duration_seconds);
    });

    it('should get a call by ID', async () => {
      const database = new Database();
      database['client'] = createMockSupabaseClient();

      const call = await database.getCall(mockCall.id);

      assert.ok(call);
      assert.strictEqual(call.id, mockCall.id);
    });

    it('should get a call by room name', async () => {
      const database = new Database();
      database['client'] = createMockSupabaseClient();

      const call = await database.getCallByRoomName(mockCall.livekit_room_name!);

      assert.ok(call);
      assert.strictEqual(call.livekit_room_name, mockCall.livekit_room_name);
    });

    it('should get calls by business', async () => {
      const database = new Database();
      database['client'] = createMockSupabaseClient();

      const calls = await database.getCallsByBusiness(mockBusiness.id, 10);

      assert.ok(Array.isArray(calls));
      assert.ok(calls.length > 0);
      assert.strictEqual(calls[0].business_id, mockBusiness.id);
    });
  });

  describe('Lead Operations', () => {
    it('should create a lead', async () => {
      const database = new Database();
      database['client'] = createMockSupabaseClient();

      const leadData = {
        business_id: mockBusiness.id,
        call_id: mockCall.id,
        name: 'Test Lead',
        email: 'test@example.com',
        phone: '+15551112222',
        source: 'voice_call',
        status: 'new' as const,
      };

      const lead = await database.createLead(leadData);

      assert.ok(lead);
      assert.strictEqual(lead.name, 'Test Lead');
      assert.strictEqual(lead.email, 'test@example.com');
    });

    it('should update a lead', async () => {
      const database = new Database();
      database['client'] = createMockSupabaseClient();

      const updates = {
        status: 'qualified' as const,
        interest_level: 'high' as const,
      };

      const lead = await database.updateLead(mockLead.id, updates);

      assert.ok(lead);
    });

    it('should get leads by business', async () => {
      const database = new Database();
      database['client'] = createMockSupabaseClient();

      const leads = await database.getLeadsByBusiness(mockBusiness.id);

      assert.ok(Array.isArray(leads));
    });
  });

  describe('Appointment Operations', () => {
    it('should create an appointment', async () => {
      const database = new Database();
      database['client'] = createMockSupabaseClient();

      const appointmentData = {
        business_id: mockBusiness.id,
        call_id: mockCall.id,
        title: 'Test Appointment',
        scheduled_at: '2025-01-20T14:00:00Z',
        duration_minutes: 30,
        attendee_name: 'Test User',
        attendee_email: 'test@example.com',
        status: 'scheduled' as const,
      };

      const appointment = await database.createAppointment(appointmentData);

      assert.ok(appointment);
      assert.strictEqual(appointment.title, 'Test Appointment');
    });

    it('should update an appointment', async () => {
      const database = new Database();
      database['client'] = createMockSupabaseClient();

      const updates = {
        status: 'confirmed' as const,
        reminder_sent: true,
      };

      const appointment = await database.updateAppointment(mockAppointment.id, updates);

      assert.ok(appointment);
    });

    it('should get appointments by business', async () => {
      const database = new Database();
      database['client'] = createMockSupabaseClient();

      const appointments = await database.getAppointmentsByBusiness(mockBusiness.id);

      assert.ok(Array.isArray(appointments));
    });
  });

  describe('Business Operations', () => {
    it('should get a business by ID', async () => {
      const database = new Database();
      database['client'] = createMockSupabaseClient();

      const business = await database.getBusiness(mockBusiness.id);

      assert.ok(business);
      assert.strictEqual(business.id, mockBusiness.id);
      assert.strictEqual(business.name, mockBusiness.name);
    });

    it('should get a phone number', async () => {
      const database = new Database();
      database['client'] = createMockSupabaseClient();

      const phoneNumber = await database.getPhoneNumber(mockPhoneNumber.phone_number);

      assert.ok(phoneNumber);
      assert.strictEqual(phoneNumber.phone_number, mockPhoneNumber.phone_number);
    });
  });

  describe('Call Event Tracking', () => {
    it('should log a call event', async () => {
      const database = new Database();
      database['client'] = createMockSupabaseClient();

      await database.logCallEvent(mockCall.id, 'test_event', { data: 'test' });

      // Should not throw
      assert.ok(true);
    });
  });

  describe('Analytics', () => {
    it('should get call stats by business', async () => {
      const database = new Database();
      database['client'] = createMockSupabaseClient();

      const stats = await database.getCallStatsByBusiness(
        mockBusiness.id,
        '2025-01-01',
        '2025-01-31'
      );

      assert.ok(stats);
      assert.ok(typeof stats.total === 'number');
      assert.ok(typeof stats.completed === 'number');
      assert.ok(typeof stats.avgDuration === 'number');
    });
  });
});
