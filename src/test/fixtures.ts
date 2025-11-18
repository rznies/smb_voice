/**
 * Test Fixtures and Mock Data
 * Provides realistic test data for all test suites
 */

import { Business, Call, Lead, Appointment, PhoneNumber, User } from '../lib/database.js';

// Mock User
export const mockUser: User = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  email: 'test@example.com',
  full_name: 'Test User',
  avatar_url: 'https://example.com/avatar.jpg',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

// Mock Business
export const mockBusiness: Business = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  owner_id: mockUser.id,
  name: 'Acme Corp',
  industry: 'Technology',
  website: 'https://acme.com',
  agent_name: 'Sarah',
  agent_personality: 'professional',
  system_prompt: 'You are Sarah, a professional AI receptionist for Acme Corp.',
  agent_voice: 'pNInz6obpgDQGcFmaJgB',
  business_hours: {
    monday: { open: '09:00', close: '17:00' },
    tuesday: { open: '09:00', close: '17:00' },
    wednesday: { open: '09:00', close: '17:00' },
    thursday: { open: '09:00', close: '17:00' },
    friday: { open: '09:00', close: '17:00' },
  },
  timezone: 'America/New_York',
  google_calendar_connected: true,
  google_calendar_id: 'test@gmail.com',
  hubspot_api_key: 'test-hubspot-key',
  slack_webhook_url: null,
  stripe_customer_id: 'cus_test123',
  subscription_status: 'active',
  subscription_plan: 'pro',
  trial_ends_at: '2025-02-01T00:00:00Z',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

// Mock Phone Number
export const mockPhoneNumber: PhoneNumber = {
  id: '550e8400-e29b-41d4-a716-446655440002',
  business_id: mockBusiness.id,
  phone_number: '+15551234567',
  friendly_name: 'Main Line',
  country_code: 'US',
  twilio_sid: 'PNtestmock1234567890abcdefabcdef',
  twilio_account_sid: 'ACtestmock1234567890abcdefabcdef',
  capabilities: { voice: true, sms: true },
  is_active: true,
  forward_to: '+15559876543',
  greeting_message: 'Thank you for calling Acme Corp.',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

// Mock Call
export const mockCall: Call = {
  id: '550e8400-e29b-41d4-a716-446655440003',
  business_id: mockBusiness.id,
  phone_number_id: mockPhoneNumber.id,
  direction: 'inbound',
  from_number: '+15559998888',
  to_number: mockPhoneNumber.phone_number,
  caller_name: 'John Doe',
  caller_email: 'john@example.com',
  livekit_room_name: 'call-550e8400-e29b-41d4-a716-446655440003',
  livekit_session_id: 'RM_test123',
  twilio_call_sid: 'CAtestmock1234567890abcdefabcdef',
  twilio_status: 'completed',
  started_at: '2025-01-15T10:00:00Z',
  answered_at: '2025-01-15T10:00:02Z',
  ended_at: '2025-01-15T10:03:30Z',
  duration_seconds: 210,
  status: 'completed',
  outcome: 'appointment_booked',
  transferred_to_human: false,
  transcript: [
    { speaker: 'agent', text: 'Hello, thank you for calling Acme Corp. How can I help you today?', timestamp: '2025-01-15T10:00:02Z' },
    { speaker: 'user', text: 'Hi, I\'d like to book an appointment.', timestamp: '2025-01-15T10:00:05Z' },
    { speaker: 'agent', text: 'I\'d be happy to help you schedule an appointment. What day works best for you?', timestamp: '2025-01-15T10:00:08Z' },
  ],
  summary: 'Customer booked appointment for consultation on Jan 20 at 2 PM.',
  recording_url: 'https://recordings.example.com/call123.mp3',
  recording_duration_seconds: 208,
  sentiment: 'positive',
  lead_score: 85,
  intent_detected: 'booking',
  tags: ['appointment', 'new_customer'],
  notes: 'Customer interested in enterprise plan',
  cost_stt: 5,
  cost_llm: 2,
  cost_tts: 15,
  cost_twilio: 25,
  cost_total: 47,
  created_at: '2025-01-15T10:00:00Z',
  updated_at: '2025-01-15T10:03:30Z',
};

// Mock Lead
export const mockLead: Lead = {
  id: '550e8400-e29b-41d4-a716-446655440004',
  business_id: mockBusiness.id,
  call_id: mockCall.id,
  name: 'Jane Smith',
  email: 'jane@techcorp.com',
  phone: '+15557778888',
  company: 'Tech Corp',
  source: 'voice_call',
  status: 'new',
  interest_level: 'high',
  hubspot_contact_id: '12345',
  salesforce_id: null,
  synced_at: '2025-01-15T10:05:00Z',
  notes: 'Interested in enterprise plan. Budget: $10k/month',
  tags: ['enterprise', 'hot_lead'],
  created_at: '2025-01-15T10:04:00Z',
  updated_at: '2025-01-15T10:05:00Z',
};

// Mock Appointment
export const mockAppointment: Appointment = {
  id: '550e8400-e29b-41d4-a716-446655440005',
  business_id: mockBusiness.id,
  call_id: mockCall.id,
  lead_id: mockLead.id,
  title: 'Consultation with Jane Smith',
  description: 'Enterprise plan consultation',
  scheduled_at: '2025-01-20T14:00:00Z',
  duration_minutes: 30,
  attendee_name: 'Jane Smith',
  attendee_email: 'jane@techcorp.com',
  attendee_phone: '+15557778888',
  google_calendar_event_id: 'event123',
  google_meet_link: 'https://meet.google.com/abc-defg-hij',
  ical_uid: 'event123@google.com',
  status: 'scheduled',
  reminder_sent: false,
  notes: 'Prepare enterprise pricing deck',
  created_at: '2025-01-15T10:03:00Z',
  updated_at: '2025-01-15T10:03:00Z',
};

// Mock Twilio Request Bodies
export const mockTwilioInboundRequest = {
  From: '+15559998888',
  To: '+15551234567',
  CallSid: 'CAtestmock1234567890abcdefabcdef',
  AccountSid: 'ACtestmock1234567890abcdefabcdef',
  CallStatus: 'ringing',
};

export const mockTwilioStatusCallback = {
  CallSid: 'CA1234567890abcdef1234567890abcdef',
  CallStatus: 'completed',
  CallDuration: '210',
  From: '+15559998888',
  To: '+15551234567',
};

// Mock Tool Parameters
export const mockAppointmentParams = {
  date: '2025-01-20',
  time: '14:00',
  customer_name: 'Jane Smith',
  customer_email: 'jane@techcorp.com',
  customer_phone: '+15557778888',
  purpose: 'Enterprise plan consultation',
  duration_minutes: 30,
};

export const mockLeadParams = {
  name: 'Bob Johnson',
  email: 'bob@startup.io',
  phone: '+15556667777',
  company: 'Startup Inc',
  interest_level: 'high' as const,
  notes: 'Interested in Pro plan',
};

export const mockTransferParams = {
  reason: 'complex billing question',
  urgency: 'high' as const,
  notes: 'Customer needs immediate assistance with invoice',
};

// Mock Environment Variables
export const mockEnv = {
  LIVEKIT_URL: 'wss://test.livekit.cloud',
  LIVEKIT_API_KEY: 'APItest123',
  LIVEKIT_API_SECRET: 'secret123',
  DEEPGRAM_API_KEY: 'deepgram_test_key',
  GEMINI_API_KEY: 'gemini_test_key',
  ELEVENLABS_API_KEY: 'elevenlabs_test_key',
  TWILIO_ACCOUNT_SID: 'ACtestmock1234567890abcdefabcdef',
  TWILIO_AUTH_TOKEN: 'test_auth_token',
  TWILIO_WEBHOOK_URL: 'https://api.test.com',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'test_anon_key',
  SUPABASE_SERVICE_ROLE_KEY: 'test_service_role_key',
  NODE_ENV: 'test',
};

// Mock Supabase Responses
export const mockSupabaseSuccess = {
  data: null,
  error: null,
};

export const mockSupabaseError = {
  data: null,
  error: {
    message: 'Database error',
    code: 'PGRST116',
    details: 'Test error',
    hint: null,
  },
};

// Mock Google Calendar Event
export const mockGoogleCalendarEvent = {
  id: 'event123',
  summary: 'Consultation with Jane Smith',
  description: 'Enterprise plan consultation',
  start: {
    dateTime: '2025-01-20T14:00:00-05:00',
    timeZone: 'America/New_York',
  },
  end: {
    dateTime: '2025-01-20T14:30:00-05:00',
    timeZone: 'America/New_York',
  },
  hangoutLink: 'https://meet.google.com/abc-defg-hij',
  attendees: [
    { email: 'jane@techcorp.com', displayName: 'Jane Smith' },
  ],
};

// Mock HubSpot Response
export const mockHubSpotContact = {
  id: '12345',
  properties: {
    email: 'jane@techcorp.com',
    firstname: 'Jane',
    lastname: 'Smith',
    phone: '+15557778888',
    company: 'Tech Corp',
  },
  createdAt: '2025-01-15T10:05:00Z',
  updatedAt: '2025-01-15T10:05:00Z',
};

// Mock Deepgram Response
export const mockDeepgramTranscript = {
  results: {
    channels: [
      {
        alternatives: [
          {
            transcript: 'Hello, I would like to book an appointment.',
            confidence: 0.95,
          },
        ],
      },
    ],
  },
};

// Mock Gemini Response
export const mockGeminiResponse = {
  response: {
    text: () => 'I would be happy to help you book an appointment. What day works best for you?',
    functionCalls: () => null,
  },
};

// Mock Gemini Function Call Response
export const mockGeminiFunctionCallResponse = {
  response: {
    text: () => '',
    functionCalls: () => [
      {
        name: 'book_appointment',
        args: mockAppointmentParams,
      },
    ],
  },
};

// Mock ElevenLabs Audio
export const mockElevenLabsAudio = async function* () {
  yield new Uint8Array([1, 2, 3, 4, 5]);
  yield new Uint8Array([6, 7, 8, 9, 10]);
};

// Helper function to create mock Supabase client
export function createMockSupabaseClient() {
  const mockClient = {
    from: (table: string) => ({
      select: (columns = '*') => ({
        eq: (column: string, value: any) => ({
          single: async () => {
            if (table === 'businesses') return { data: mockBusiness, error: null };
            if (table === 'phone_numbers') return { data: mockPhoneNumber, error: null };
            if (table === 'calls') return { data: mockCall, error: null };
            return { data: null, error: null };
          },
          limit: (n: number) => ({
            then: async (cb: any) => cb({ data: [mockPhoneNumber], error: null }),
          }),
        }),
        gte: (column: string, value: any) => ({
          lte: (column: string, value: any) => ({
            then: async (cb: any) => cb({ data: [mockCall], error: null }),
          }),
        }),
        order: (column: string, options?: any) => ({
          limit: (n: number) => ({
            then: async (cb: any) => cb({ data: [mockCall], error: null }),
          }),
        }),
      }),
      insert: (data: any) => ({
        select: () => ({
          single: async () => {
            if (table === 'calls') return { data: { ...mockCall, ...data, id: 'new-call-id' }, error: null };
            if (table === 'leads') return { data: { ...mockLead, ...data, id: 'new-lead-id' }, error: null };
            if (table === 'appointments') return { data: { ...mockAppointment, ...data, id: 'new-appt-id' }, error: null };
            return { data: data, error: null };
          },
        }),
      }),
      update: (data: any) => ({
        eq: (column: string, value: any) => ({
          select: () => ({
            single: async () => ({ data: { ...mockCall, ...data }, error: null }),
          }),
        }),
      }),
    }),
  };

  return mockClient as any;
}

// Helper to set mock environment
export function setMockEnv() {
  Object.entries(mockEnv).forEach(([key, value]) => {
    process.env[key] = value;
  });
}

// Helper to clear mock environment
export function clearMockEnv() {
  Object.keys(mockEnv).forEach(key => {
    delete process.env[key];
  });
}
