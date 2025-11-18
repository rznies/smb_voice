/**
 * Supabase Database Client
 * Handles all database operations for the SMB Voice AI platform
 */

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient as SupabaseClientType } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

type SupabaseClient = SupabaseClientType<any, 'public', any>;

// Database types
export interface User {
  id: string;
  email: string;
  full_name?: string;
  avatar_url?: string;
  created_at: string;
  updated_at: string;
}

export interface Business {
  id: string;
  owner_id: string;
  name: string;
  industry?: string;
  website?: string;
  agent_name?: string;
  agent_personality?: string;
  system_prompt?: string;
  agent_voice?: string;
  business_hours?: Record<string, any>;
  timezone?: string;
  google_calendar_connected?: boolean;
  google_calendar_id?: string;
  hubspot_api_key?: string;
  slack_webhook_url?: string;
  stripe_customer_id?: string;
  subscription_status?: string;
  subscription_plan?: string;
  trial_ends_at?: string;
  created_at: string;
  updated_at: string;
}

export interface PhoneNumber {
  id: string;
  business_id: string;
  phone_number: string;
  friendly_name?: string;
  country_code?: string;
  twilio_sid?: string;
  twilio_account_sid?: string;
  capabilities?: Record<string, any>;
  is_active?: boolean;
  forward_to?: string;
  greeting_message?: string;
  created_at: string;
  updated_at: string;
}

export interface Call {
  id: string;
  business_id: string;
  phone_number_id?: string;
  direction: 'inbound' | 'outbound';
  from_number: string;
  to_number: string;
  caller_name?: string;
  caller_email?: string;
  livekit_room_name?: string;
  livekit_session_id?: string;
  twilio_call_sid?: string;
  twilio_status?: string;
  started_at: string;
  answered_at?: string;
  ended_at?: string;
  duration_seconds?: number;
  status: 'in_progress' | 'completed' | 'failed' | 'abandoned';
  outcome?: string;
  transferred_to_human?: boolean;
  transcript?: Array<{ speaker: string; text: string; timestamp: string }>;
  summary?: string;
  recording_url?: string;
  recording_duration_seconds?: number;
  sentiment?: 'positive' | 'neutral' | 'negative';
  lead_score?: number;
  intent_detected?: string;
  tags?: string[];
  notes?: string;
  cost_stt?: number;
  cost_llm?: number;
  cost_tts?: number;
  cost_twilio?: number;
  cost_total?: number;
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  business_id: string;
  call_id?: string;
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  source?: string;
  status?: 'new' | 'contacted' | 'qualified' | 'converted' | 'lost';
  interest_level?: 'high' | 'medium' | 'low';
  hubspot_contact_id?: string;
  salesforce_id?: string;
  synced_at?: string;
  notes?: string;
  tags?: string[];
  created_at: string;
  updated_at: string;
}

export interface Appointment {
  id: string;
  business_id: string;
  call_id?: string;
  lead_id?: string;
  title: string;
  description?: string;
  scheduled_at: string;
  duration_minutes?: number;
  attendee_name?: string;
  attendee_email?: string;
  attendee_phone?: string;
  google_calendar_event_id?: string;
  google_meet_link?: string;
  ical_uid?: string;
  status?: 'scheduled' | 'confirmed' | 'canceled' | 'completed' | 'no_show';
  reminder_sent?: boolean;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface CallEvent {
  id: string;
  call_id: string;
  event_type: string;
  event_data?: Record<string, any>;
  created_at: string;
}

// Create Supabase client
let supabaseClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase configuration. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
    }

    supabaseClient = createClient(supabaseUrl, supabaseKey);
  }

  return supabaseClient;
}

// Database helper functions
export class Database {
  private client: SupabaseClient;

  constructor() {
    this.client = getSupabaseClient();
  }

  // Call operations
  async createCall(data: Partial<Call>): Promise<Call> {
    const { data: call, error } = await this.client
      .from('calls')
      .insert(data)
      .select()
      .single();

    if (error) throw error;
    return call;
  }

  async updateCall(id: string, data: Partial<Call>): Promise<Call> {
    const { data: call, error } = await this.client
      .from('calls')
      .update(data)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return call;
  }

  async getCall(id: string): Promise<Call | null> {
    const { data, error } = await this.client
      .from('calls')
      .select('*')
      .eq('id', id)
      .single();

    if (error) return null;
    return data;
  }

  async getCallByRoomName(roomName: string): Promise<Call | null> {
    const { data, error } = await this.client
      .from('calls')
      .select('*')
      .eq('livekit_room_name', roomName)
      .single();

    if (error) return null;
    return data;
  }

  async getCallsByBusiness(businessId: string, limit = 50): Promise<Call[]> {
    const { data, error } = await this.client
      .from('calls')
      .select('*')
      .eq('business_id', businessId)
      .order('started_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data;
  }

  // Lead operations
  async createLead(data: Partial<Lead>): Promise<Lead> {
    const { data: lead, error } = await this.client
      .from('leads')
      .insert(data)
      .select()
      .single();

    if (error) throw error;
    return lead;
  }

  async updateLead(id: string, data: Partial<Lead>): Promise<Lead> {
    const { data: lead, error } = await this.client
      .from('leads')
      .update(data)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return lead;
  }

  async getLeadsByBusiness(businessId: string): Promise<Lead[]> {
    const { data, error } = await this.client
      .from('leads')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  }

  // Appointment operations
  async createAppointment(data: Partial<Appointment>): Promise<Appointment> {
    const { data: appointment, error } = await this.client
      .from('appointments')
      .insert(data)
      .select()
      .single();

    if (error) throw error;
    return appointment;
  }

  async updateAppointment(id: string, data: Partial<Appointment>): Promise<Appointment> {
    const { data: appointment, error } = await this.client
      .from('appointments')
      .update(data)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return appointment;
  }

  async getAppointmentsByBusiness(businessId: string): Promise<Appointment[]> {
    const { data, error } = await this.client
      .from('appointments')
      .select('*')
      .eq('business_id', businessId)
      .order('scheduled_at', { ascending: true });

    if (error) throw error;
    return data;
  }

  // Business operations
  async getBusiness(id: string): Promise<Business | null> {
    const { data, error } = await this.client
      .from('businesses')
      .select('*')
      .eq('id', id)
      .single();

    if (error) return null;
    return data;
  }

  async getPhoneNumber(phoneNumber: string): Promise<PhoneNumber | null> {
    const { data, error } = await this.client
      .from('phone_numbers')
      .select('*')
      .eq('phone_number', phoneNumber)
      .single();

    if (error) return null;
    return data;
  }

  // Call event tracking
  async logCallEvent(callId: string, eventType: string, eventData?: Record<string, any>): Promise<void> {
    await this.client
      .from('call_events')
      .insert({
        call_id: callId,
        event_type: eventType,
        event_data: eventData || {},
      });
  }

  // Analytics
  async getCallStatsByBusiness(businessId: string, startDate: string, endDate: string): Promise<any> {
    const { data, error } = await this.client
      .from('calls')
      .select('*')
      .eq('business_id', businessId)
      .gte('started_at', startDate)
      .lte('started_at', endDate);

    if (error) throw error;

    // Calculate stats
    const total = data.length;
    const completed = data.filter(c => c.status === 'completed').length;
    const avgDuration = data.reduce((acc, c) => acc + (c.duration_seconds || 0), 0) / total;
    const appointmentsBooked = data.filter(c => c.outcome === 'appointment_booked').length;
    const leadsCaptured = data.filter(c => c.outcome === 'lead_captured').length;

    return {
      total,
      completed,
      avgDuration,
      appointmentsBooked,
      leadsCaptured,
    };
  }
}

// Export singleton instance
export const db = new Database();
